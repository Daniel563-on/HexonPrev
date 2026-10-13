import { runBulk } from './guard';
import { arrayUnion, collection, doc, documentId, getDocs, query, serverTimestamp, where, writeBatch } from './guard';
import { firebaseActive, dbInstance, checkQuotaException } from './core';
import { timelineEvent } from './executionTeam';

// TROCA DE EMPRESA DO ATIVO / ENDEREÇO (etapa especial E3): as preventivas e vistorias dele ainda "Novo"
// (não programadas) passam para a empresa nova; as programadas ou em execução ficam com a antiga até terminar.
// Lê uma vez as OS abertas da gerência (campo de controle unitOpen) — só acontece quando há troca, que é rara.
// Operação em massa: roda liberada do disjuntor (src/db/guard.ts)
export function dbMoveNewOrdersToCompany(...args: Parameters<typeof dbMoveNewOrdersNow>): ReturnType<typeof dbMoveNewOrdersNow> {
  return runBulk(() => dbMoveNewOrdersNow(...args));
}

async function dbMoveNewOrdersNow(
  unit: string,
  field: 'assetId' | 'addressId',
  moves: { id: string; company: string }[], // ativo/endereço -> empresa nova
  companyLabel: (id: string) => string,
  by: string
): Promise<number> {
  if (!firebaseActive || !dbInstance || !unit || moves.length === 0) return 0;
  const db = dbInstance;
  const target = new Map(moves.map((m) => [m.id, m.company]));
  try {
    const snap = await getDocs(query(collection(db, 'serviceOrders'), where('unitOpen', '==', unit)));
    const toMove = snap.docs.filter((d) => {
      const o = d.data() as any;
      const to = target.get(String(o[field] || ''));
      return o.status === 'Novo' && !!to && o.company !== to;
    });
    const now = new Date().toISOString();
    for (let i = 0; i < toMove.length; i += 400) {
      const batch = writeBatch(db);
      toMove.slice(i, i + 400).forEach((d) => {
        const o = d.data() as any;
        const to = target.get(String(o[field]))!;
        batch.update(doc(db, 'serviceOrders', d.id), {
          company: to,
          updatedAt: now,
          syncAt: serverTimestamp(),
          timeline: arrayUnion(
            timelineEvent('Empresa alterada', by, `${o.company ? companyLabel(o.company) : 'sem empresa'} → ${companyLabel(to)} (o ${field === 'assetId' ? 'ativo' : 'endereço'} mudou de empresa)`)
          )
        });
      });
      await batch.commit();
    }
    return toMove.length;
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}

// CORREÇÃO DAS OS ANTIGAS SEM EMPRESA (Programação, 13/10/2026): preventivas e vistorias geradas antes da separação por
// empresa (E3, 07/10) não têm a empresa gravada e não aparecem na Programação (que, como o PMOC, mostra só as da empresa
// escolhida). Só o Super Administrador: cada OS aberta da gerência sem empresa recebe a do ativo (preventiva) ou a do
// endereço (vistoria); as que o ativo/endereço também não tem ficam de fora e voltam na lista.
export interface CompanyFixResult {
  fixed: number;
  missing: { id: string; label: string }[];
}
export function dbFixOrdersWithoutCompany(...args: Parameters<typeof dbFixOrdersNow>): ReturnType<typeof dbFixOrdersNow> {
  return runBulk(() => dbFixOrdersNow(...args));
}

async function companiesOf(coll: 'assets' | 'addresses', ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await getDocs(query(collection(dbInstance!, coll), where(documentId(), 'in', ids.slice(i, i + 30))));
    snap.docs.forEach((d) => out.set(d.id, String((d.data() as any).company || '')));
  }
  return out;
}

async function dbFixOrdersNow(unit: string, companyLabel: (id: string) => string, by: string): Promise<CompanyFixResult> {
  if (!firebaseActive || !dbInstance || !unit) return { fixed: 0, missing: [] };
  const db = dbInstance;
  try {
    const snap = await getDocs(query(collection(db, 'serviceOrders'), where('unitOpen', '==', unit)));
    const without = snap.docs.filter((d) => !(d.data() as any).company);
    const assetIds = Array.from(new Set(without.map((d) => String((d.data() as any).assetId || '')).filter(Boolean)));
    const addressIds = Array.from(new Set(without.map((d) => String((d.data() as any).addressId || '')).filter(Boolean)));
    const [assetCo, addressCo] = await Promise.all([companiesOf('assets', assetIds), companiesOf('addresses', addressIds)]);
    const plan: { id: string; company: string; from: string }[] = [];
    const missing: CompanyFixResult['missing'] = [];
    without.forEach((d) => {
      const o = d.data() as any;
      const company = o.assetId ? assetCo.get(String(o.assetId)) : o.addressId ? addressCo.get(String(o.addressId)) : '';
      if (company) plan.push({ id: d.id, company, from: o.assetId ? 'ativo' : 'endereço' });
      else missing.push({ id: d.id, label: `${o.assetName || o.title || d.id}${o.assetCode ? ` (${o.assetCode})` : ''}${o.comarca ? ` · ${o.comarca}` : ''}` });
    });
    const now = new Date().toISOString();
    for (let i = 0; i < plan.length; i += 400) {
      const batch = writeBatch(db);
      plan.slice(i, i + 400).forEach((p) =>
        batch.update(doc(db, 'serviceOrders', p.id), {
          company: p.company,
          updatedAt: now,
          syncAt: serverTimestamp(),
          timeline: arrayUnion(timelineEvent('Empresa alterada', by, `sem empresa → ${companyLabel(p.company)} (empresa do ${p.from}; correção das OS geradas antes da separação por empresa)`))
        })
      );
      await batch.commit();
    }
    return { fixed: plan.length, missing };
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}
