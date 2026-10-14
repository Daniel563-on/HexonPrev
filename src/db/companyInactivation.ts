import { runBulk } from './guard';
import { arrayRemove, arrayUnion, collection, deleteField, doc, getCountFromServer, getDoc, getDocs, query, serverTimestamp, where, writeBatch } from './guard';
import { Address, Asset, Company, HexonUser, WorkOrder, WorkforcePerson } from '../types';
import { firebaseActive, dbInstance, checkQuotaException } from './core';
import { clearCompaniesCache, dbGetCompanies, dbSaveCompany } from './companies';
import { dbCountWorkOrders } from './workOrderList';
import { dbGetAssets } from './assets';
import { dbGetAddresses } from './addresses';
import { clearUsersCache, dbGetUsers } from './users';
import { dbGetWorkforce } from './workforce';
import { markSyncStale } from './localSync';
import { dbAddAuditLog } from './audit';
import { dbBumpDataVersion } from './appControl';

// INATIVAR EMPRESA (ajuste A5-B, 14/10/2026; só o Super Administrador, em Configurações › Empresas).
// Antes de salvar, a tela mostra o que é da empresa. Ao inativar:
// - chamados e preventivas em aberto, ativos e endereços NÃO são regravados: aparecem como "Sem empresa (pendente)"
//   nas telas até receberem outra empresa (reativar a empresa devolve o que não mudou);
// - usuários e pessoas do efetivo da empresa ficam INATIVOS junto (o usuário não entra mais no app; se for trabalhar em
//   outra empresa, é cadastrado nela). Usuário com outra empresa ativa continua ativo. Super Administrador nunca é inativado.

export interface CompanyImpact {
  openWorkOrders: number; // chamados GLPI em aberto (Nova, Em andamento, Pendente)
  openOrders: number; // preventivas e vistorias em aberto
  assets: number; // ativos (fora os baixados)
  addresses: number; // endereços das vistorias
  users: HexonUser[]; // usuários que ficam inativos
  workforce: WorkforcePerson[]; // pessoas do efetivo que ficam inativas
}

// Usuário que fica inativo: ativo, da empresa e sem outra empresa ativa (Super Administrador nunca)
export function usersToInactivate(users: HexonUser[], company: string, activeIds: Set<string>): HexonUser[] {
  return users.filter(
    (u) =>
      u.status === 'Ativo' &&
      u.perfil !== 'Super Administrador' &&
      (u.companies || []).includes(company) &&
      !(u.companies || []).some((c) => c !== company && activeIds.has(c))
  );
}

// Conferência (só leituras; pode ler as abertas da gerência): liberada do disjuntor
export function dbCompanyImpact(company: Company): Promise<CompanyImpact> {
  return runBulk(() => companyImpactNow(company));
}
async function companyImpactNow(company: Company): Promise<CompanyImpact> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const db = dbInstance;
  try {
    const units = company.units || [];
    const [wo, so, assets, addresses, users, workforce, companies] = await Promise.all([
      Promise.all(units.map((u) => dbCountWorkOrders(u, { kind: 'pending' }, [company.id]))),
      // Preventivas/vistorias em aberto têm o campo de controle unitOpen (src/db/orderControl.ts). Contar custa pouco; se o
      // banco pedir índice para os dois campos, lê as abertas da gerência (índice unitOpen) e conta aqui (ação rara)
      Promise.all(
        units.map((u) =>
          getCountFromServer(query(collection(db, 'serviceOrders'), where('unitOpen', '==', u), where('company', '==', company.id)))
            .then((c) => c.data().count)
            .catch(async () => (await getDocs(query(collection(db, 'serviceOrders'), where('unitOpen', '==', u)))).docs.filter((d) => (d.data() as any).company === company.id).length)
        )
      ),
      dbGetAssets().catch(() => [] as Asset[]),
      dbGetAddresses(true).catch(() => [] as Address[]),
      dbGetUsers(true),
      dbGetWorkforce(true, units).catch(() => [] as WorkforcePerson[]),
      dbGetCompanies(true)
    ]);
    const activeIds = new Set(companies.filter((c) => c.active && c.id !== company.id).map((c) => c.id));
    return {
      openWorkOrders: wo.reduce((s, n) => s + n, 0),
      openOrders: so.reduce((s, n) => s + n, 0),
      assets: assets.filter((a) => a.company === company.id && a.status !== 'Baixado').length,
      addresses: addresses.filter((a) => a.company === company.id).length,
      users: usersToInactivate(users, company.id, activeIds),
      workforce: workforce.filter((p) => p.company === company.id && p.status === 'Ativo')
    };
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}

// Grava a empresa inativa e inativa os usuários e o efetivo dela (operação em massa: liberada do disjuntor)
export function dbInactivateCompany(...args: Parameters<typeof inactivateNow>): ReturnType<typeof inactivateNow> {
  return runBulk(() => inactivateNow(...args));
}

async function inactivateNow(company: Company, impact: CompanyImpact, by: { name: string; matricula: string }): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const db = dbInstance;
  try {
    await dbSaveCompany({ ...company, active: false }, by.name);
    const now = new Date().toISOString();
    const writes: ((b: ReturnType<typeof writeBatch>) => void)[] = [
      ...impact.users.map((u) => (b: ReturnType<typeof writeBatch>) => b.set(doc(db, 'users', u.id), { status: 'Inativo', syncAt: serverTimestamp() }, { merge: true })),
      ...impact.workforce.map(
        (p) => (b: ReturnType<typeof writeBatch>) =>
          b.set(doc(db, 'workforce', p.id), { status: 'Inativo', updatedAt: now, inactivatedAt: now, syncAt: serverTimestamp() }, { merge: true })
      )
    ];
    for (let i = 0; i < writes.length; i += 400) {
      const batch = writeBatch(db);
      writes.slice(i, i + 400).forEach((w) => w(batch));
      await batch.commit();
    }
    clearUsersCache();
    markSyncStale('users');
    markSyncStale('workforce');
    clearCompaniesCache();
    await dbAddAuditLog({
      userMatricula: by.matricula,
      userName: by.name,
      action: 'Inativou empresa',
      target: `companies/${company.id}`,
      details:
        `Empresa ${company.name} inativada. Ficaram sem empresa (pendentes): ${impact.openWorkOrders} chamado(s) em aberto, ` +
        `${impact.openOrders} preventiva(s)/vistoria(s) em aberto, ${impact.assets} ativo(s), ${impact.addresses} endereço(s). ` +
        `Inativados junto: ${impact.users.length} usuário(s)${impact.users.length ? ` (${impact.users.map((u) => u.matricula).join(', ')})` : ''} e ` +
        `${impact.workforce.length} pessoa(s) do efetivo.`,
      timestamp: now
    }).catch(() => {});
    dbBumpDataVersion();
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}

// ESCOLHER EMPRESA do chamado GLPI em aberto de empresa inativa (só o Super Administrador; regra do banco
// "TROCAR EMPRESA INATIVA"): recebe uma empresa ativa da gerência; se estava num bloco da Programação, sai dele
// (perde o dia) e continua com o técnico. A linha do tempo registra a troca.
export async function dbChangeWorkOrderCompany(o: WorkOrder, to: string, labels: { from: string; to: string }, by: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const db = dbInstance;
  const now = new Date().toISOString();
  const inBlock = !!(o.scheduledDate || o.scheduledEndDate || o.lotId);
  try {
    const lotExists = o.lotId ? await getDoc(doc(db, 'planningLots', o.lotId)).then((d) => d.exists()).catch(() => false) : false;
    const batch = writeBatch(db);
    batch.update(doc(db, 'workOrders', o.id), {
      company: to,
      updatedAt: now,
      ...(inBlock ? { scheduledDate: deleteField(), scheduledEndDate: deleteField(), lotId: deleteField() } : {}),
      timeline: arrayUnion({
        at: now,
        by,
        action: 'Empresa alterada',
        note: `${labels.from} (inativa) → ${labels.to}${inBlock ? '; saiu da programação da empresa inativa (perdeu o dia; continua com o técnico)' : ''}`
      })
    });
    if (lotExists) batch.update(doc(db, 'planningLots', o.lotId!), { woIds: arrayRemove(o.id), updatedAt: now });
    await batch.commit();
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}
