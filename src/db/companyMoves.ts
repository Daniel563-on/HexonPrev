import { runBulk } from './guard';
import { arrayRemove, arrayUnion, collection, doc, documentId, getDoc, getDocs, query, serverTimestamp, where, writeBatch } from './guard';
import { ServiceOrder } from '../types';
import { firebaseActive, dbInstance, checkQuotaException } from './core';
import { timelineEvent } from './executionTeam';
import { dbGetCompanies, inactiveCompanyIds, isCompanyPending } from './companies';
import { revertFields } from './blocks';

// A5-B: OS em aberto "sem empresa" (sem empresa gravada ou de empresa inativa) que recebe a empresa nova do ativo/endereço.
// Em qualquer situação aberta ela vai junto; a que estava programada (bloco/lote) pela empresa inativa volta para "Novo"
// (sai do bloco, sem técnico) — menos a que já está em execução, que continua com o técnico até terminar.
type MoveWrite = { id: string; lotId?: string; fields: Record<string, unknown> };
function moveFields(o: ServiceOrder, to: string, now: string, by: string, text: string, inactive: Set<string>): MoveWrite {
  const pending = isCompanyPending(o.company, inactive);
  const back = pending && o.status !== 'Em Execução' && o.status !== 'Novo' && (!!o.lotId || o.status === 'Planejada');
  const event = timelineEvent('Empresa alterada', by, text);
  if (!back) return { id: o.id, fields: { company: to, updatedAt: now, syncAt: serverTimestamp(), timeline: arrayUnion(event) } };
  const rev = revertFields(o, now, by, 'Saiu da programação da empresa inativa');
  return { id: o.id, lotId: o.lotId, fields: { ...rev, company: to, timeline: arrayUnion(event, timelineEvent('Voltou para Novo', by, 'Saiu da programação da empresa inativa')) } };
}

// Grava as mudanças (pacotes de 400) e tira as OS dos lotes que ainda existem
async function commitMoves(writes: MoveWrite[], now: string): Promise<void> {
  const db = dbInstance!;
  const lotIds = Array.from(new Set(writes.map((w) => w.lotId || '').filter(Boolean)));
  const existing = new Set<string>();
  for (const id of lotIds) if ((await getDoc(doc(db, 'planningLots', id))).exists()) existing.add(id);
  const ops: ((b: ReturnType<typeof writeBatch>) => void)[] = writes.map((w) => (b) => b.update(doc(db, 'serviceOrders', w.id), w.fields));
  for (const id of existing) {
    const ids = writes.filter((w) => w.lotId === id).map((w) => w.id);
    ops.push((b) => b.update(doc(db, 'planningLots', id), { orderIds: arrayRemove(...ids), updatedAt: now }));
  }
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    ops.slice(i, i + 400).forEach((op) => op(batch));
    await batch.commit();
  }
}

// TROCA DE EMPRESA DO ATIVO / ENDEREÇO (etapa especial E3): as preventivas e vistorias dele ainda "Novo"
// (não programadas) passam para a empresa nova; as programadas ou em execução ficam com a antiga até terminar.
// A5-B: as que estão "sem empresa" (empresa inativa) vão junto em qualquer situação aberta (ver moveFields).
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
    const [snap, companies] = await Promise.all([getDocs(query(collection(db, 'serviceOrders'), where('unitOpen', '==', unit))), dbGetCompanies().catch(() => [])]);
    const inactive = inactiveCompanyIds(companies);
    // "Novo": vai para a empresa nova; sem empresa (ou de empresa inativa): vai em qualquer situação aberta (A5-B)
    const toMove = snap.docs
      .map((d) => ({ ...(d.data() as ServiceOrder), id: d.id }))
      .filter((o) => {
        const to = target.get(String((o as any)[field] || ''));
        return !!to && o.company !== to && (o.status === 'Novo' || isCompanyPending(o.company, inactive));
      });
    const now = new Date().toISOString();
    const what = field === 'assetId' ? 'ativo' : 'endereço';
    const from = (c?: string) => (!c ? 'sem empresa' : inactive.has(c) ? `${companyLabel(c)} (inativa)` : companyLabel(c));
    await commitMoves(
      toMove.map((o) => {
        const to = target.get(String((o as any)[field]))!;
        return moveFields(o, to, now, by, `${from(o.company)} → ${companyLabel(to)} (o ${what} mudou de empresa)`, inactive);
      }),
      now
    );
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
    const [snap, companies] = await Promise.all([getDocs(query(collection(db, 'serviceOrders'), where('unitOpen', '==', unit))), dbGetCompanies().catch(() => [])]);
    const inactive = inactiveCompanyIds(companies);
    // Sem empresa gravada ou de empresa inativa (A5-B)
    const without = snap.docs.filter((d) => isCompanyPending((d.data() as any).company, inactive));
    const assetIds = Array.from(new Set(without.map((d) => String((d.data() as any).assetId || '')).filter(Boolean)));
    const addressIds = Array.from(new Set(without.map((d) => String((d.data() as any).addressId || '')).filter(Boolean)));
    const [assetCo, addressCo] = await Promise.all([companiesOf('assets', assetIds), companiesOf('addresses', addressIds)]);
    const plan: { id: string; company: string; from: string }[] = [];
    const missing: CompanyFixResult['missing'] = [];
    without.forEach((d) => {
      const o = d.data() as any;
      const company = o.assetId ? assetCo.get(String(o.assetId)) : o.addressId ? addressCo.get(String(o.addressId)) : '';
      // O ativo/endereço também precisa ter empresa ATIVA
      if (company && !inactive.has(company)) plan.push({ id: d.id, company, from: o.assetId ? 'ativo' : 'endereço' });
      else missing.push({ id: d.id, label: `${o.assetName || o.title || d.id}${o.assetCode ? ` (${o.assetCode})` : ''}${o.comarca ? ` · ${o.comarca}` : ''}` });
    });
    const now = new Date().toISOString();
    const byId = new Map(without.map((d) => [d.id, { ...(d.data() as ServiceOrder), id: d.id }]));
    await commitMoves(
      plan.map((p) => {
        const o = byId.get(p.id)!;
        const text = o.company
          ? `${companyLabel(o.company)} (inativa) → ${companyLabel(p.company)} (empresa do ${p.from})`
          : `sem empresa → ${companyLabel(p.company)} (empresa do ${p.from}; correção das OS geradas antes da separação por empresa)`;
        return moveFields(o, p.company, now, by, text, inactive);
      }),
      now
    );
    return { fixed: plan.length, missing };
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}
