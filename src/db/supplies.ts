import { runBulk } from './guard';
import { arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where, writeBatch } from './guard';
import { Material, SupplyBalance } from '../types';
import { firebaseActive, dbInstance, cleanUndefined, checkQuotaException } from './core';
import { catalogIdOf, catalogSyncStatus, dbDeleteCatalogItem, dbGetCatalog, dbSaveCatalogItem, dbSetCatalogCost, materialCodeKey } from './materials';
import { localTodayStr } from './serviceOrders';
import { markSyncStale, syncedList, syncStatus, syncTombstone } from './localSync';

// INSUMOS (coleção "supplies", Fase 8C): lista de cada gerência + empresa, igual à de materiais (mesmos campos,
// mesma tela "Gestão de Insumos", mesma importação). O técnico pede insumos pelo celular (8C-2).
// As funções são as do catálogo de materiais (src/db/materials.ts) com kind = 'supplies'.
// Lote 3 (15/10/2026): a lista virou o CONTRATO DA EMPRESA (gerência '*', uma lista para todas as gerências) — abaixo.
// As funções por gerência ficam para as listas antigas.

export const supplyIdOf = (unit: string, company: string, code: string) => catalogIdOf('supplies', unit, company, code);
export const dbGetSupplies = (units: string[] | null, force = false, company?: string): Promise<Material[]> =>
  dbGetCatalog('supplies', units, force, company);
export const suppliesSyncStatus = (unit: string, company?: string) => catalogSyncStatus('supplies', unit, company);
export const dbSaveSupply = (item: Material) => dbSaveCatalogItem('supplies', item);
export const dbDeleteSupply = (itemId: string, unit: string) => dbDeleteCatalogItem('supplies', itemId, unit);
export const dbSetSupplyCost = (item: Material, value: number, from: string, setBy: string, reason?: string) =>
  dbSetCatalogCost('supplies', item, value, from, setBy, reason);

// ===== LOTE 3: CONTRATO DE INSUMOS DA EMPRESA =====
// Planilha com Item (F00001…), Descrição, Unidade, Quantidade, Preço unitário e Preço total, importada uma vez e
// atualizada só nos aditivos (quantidade TOTAL; o preço pode mudar). Quem importa: permissão "Importar contrato e
// aditivos de insumos". O item fica em "supplies" (gerência '*': o técnico guarda a lista no celular) e o saldo fica
// separado em "supplyBalances" (o técnico não lê, e cada movimento não chega aos celulares).
// Saldo = contratado − fornecido − aprovado que ainda está no almoxarifado. A aprovação reserva, o "Fornecer" abate,
// a recusa do almoxarifado devolve (src/db/supplyRequests.ts). O preço novo vale a partir do dia da importação:
// o custo da OS usa o preço do dia em que ela foi concluída (OS fechadas ficam com o preço antigo).

export const SUPPLY_CONTRACT_UNIT = '*';
export const contractSupplyId = (company: string, code: string) => catalogIdOf('supplies', SUPPLY_CONTRACT_UNIT, company, code);
export const isContractSupply = (m: Pick<Material, 'unit'>) => m.unit === SUPPLY_CONTRACT_UNIT;
const contractFilters = (company: string): [string, string][] => [
  ['unit', SUPPLY_CONTRACT_UNIT],
  ['company', company]
];

export const round3 = (n: number) => Math.round(n * 1000) / 1000;
// Saldo do item (null = item sem saldo registrado)
export const balanceSaldo = (b?: SupplyBalance | null): number | null => (b ? round3(b.contractQty - b.suppliedQty - b.reservedQty) : null);

// Itens do contrato da empresa (cópia guardada no aparelho em tempo real; muda só na importação ou na correção de texto)
export async function dbGetSupplyContract(company: string, force = false): Promise<Material[]> {
  if (!firebaseActive || !dbInstance || !company) return [];
  const list = await syncedList<Material>('supplies', SUPPLY_CONTRACT_UNIT, contractFilters(company), force);
  return list.sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { numeric: true }));
}
export const supplyContractSyncStatus = (company: string) => syncStatus('supplies', contractFilters(company));

// Saldo de todos os itens da empresa (Gestão de Insumos, relatório, importação): 1 busca (índice "company"); 30 s na sessão
const balCompany = new Map<string, { at: number; list: SupplyBalance[] }>();
const balById = new Map<string, { at: number; value: SupplyBalance | null }>();
export function clearSupplyBalancesCache(): void {
  balCompany.clear();
  balById.clear();
}
const mapBalance = (id: string, data: any): SupplyBalance => ({
  ...(data as SupplyBalance),
  id,
  contractQty: Number(data.contractQty) || 0,
  suppliedQty: Number(data.suppliedQty) || 0,
  reservedQty: Number(data.reservedQty) || 0
});

export async function dbGetSupplyBalances(company: string, force = false): Promise<SupplyBalance[]> {
  if (!firebaseActive || !dbInstance || !company) return [];
  const hit = balCompany.get(company);
  if (hit && !force && Date.now() - hit.at < 30000) return hit.list;
  try {
    const snap = await getDocs(query(collection(dbInstance, 'supplyBalances'), where('company', '==', company)));
    const list = snap.docs.map((d) => mapBalance(d.id, d.data()));
    const at = Date.now();
    balCompany.set(company, { at, list });
    list.forEach((b) => balById.set(b.id, { at, value: b }));
    return list;
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}

// Saldo de alguns itens (aprovação dos pedidos): 1 leitura por item que ainda não está na sessão (30 s)
export async function dbGetSupplyBalancesByIds(ids: string[], force = false): Promise<Map<string, SupplyBalance | null>> {
  const out = new Map<string, SupplyBalance | null>();
  if (!firebaseActive || !dbInstance) return out;
  const db = dbInstance;
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const missing = unique.filter((id) => {
    const hit = balById.get(id);
    return force || !hit || Date.now() - hit.at >= 30000;
  });
  if (missing.length) {
    // Leitura em grupo e limitada aos itens dos pedidos na tela: fora do contador do disjuntor
    await runBulk(() =>
      Promise.all(
        missing.map(async (id) => {
          try {
            const snap = await getDoc(doc(db, 'supplyBalances', id));
            balById.set(id, { at: Date.now(), value: snap.exists() ? mapBalance(snap.id, snap.data()) : null });
          } catch (err: any) {
            checkQuotaException(err);
            throw err;
          }
        })
      )
    );
  }
  unique.forEach((id) => out.set(id, balById.get(id)?.value ?? null));
  return out;
}

// ===== IMPORTAÇÃO DO CONTRATO / ADITIVO =====
export interface SupplyContractRow {
  code: string;
  description: string;
  measureUnit: string;
  qty: number | null;    // quantidade TOTAL (contrato + aditivos)
  price: number | null;  // preço unitário (valor completo da célula)
  total: number | null;  // preço total (só para conferir)
  line: number;
}

export interface SupplyContractChange {
  id: string;
  line: number;
  code: string;
  description: string;
  measureUnit: string;
  isNew: boolean;
  qtyBefore?: number;
  qtyAfter: number;
  priceBefore?: number;
  priceAfter: number;
  textChanged: boolean;  // descrição ou unidade mudou
  item: Material;        // item como fica (gravado se novo, preço ou texto mudou)
  writeItem: boolean;
  writeBalance: 'create' | 'qty' | null;
}

export interface SupplyContractPlan {
  company: string;
  first: boolean;        // ainda não havia contrato da empresa
  today: string;
  changes: SupplyContractChange[];
  unchanged: number;
  errors: { line: number; code: string; description: string; reason: string }[];
  missing: Material[];   // estão no contrato e não vieram na planilha: continuam como estão
  totalMismatch: { line: number; code: string; computed: number; total: number }[];
}

export function planSupplyContractImport(
  company: string,
  rows: SupplyContractRow[],
  contract: Material[],
  balances: SupplyBalance[],
  setBy: string
): SupplyContractPlan {
  const now = new Date().toISOString();
  const today = localTodayStr();
  const mine = contract.filter((m) => m.company === company && isContractSupply(m));
  const byId = new Map(mine.map((m) => [m.id, m]));
  const balOf = new Map(balances.map((b) => [b.id, b]));
  const plan: SupplyContractPlan = { company, first: mine.length === 0, today, changes: [], unchanged: 0, errors: [], missing: [], totalMismatch: [] };
  const seen = new Set<string>();

  for (const row of rows) {
    const code = materialCodeKey(row.code);
    const description = String(row.description ?? '').trim();
    const err = (reason: string) => plan.errors.push({ line: row.line, code, description, reason });
    if (!code || !description) {
      err('sem item ou descrição');
      continue;
    }
    if (row.qty === null || !Number.isFinite(row.qty) || row.qty < 0) {
      err('quantidade inválida');
      continue;
    }
    if (row.price === null || !Number.isFinite(row.price) || row.price < 0) {
      err('preço unitário inválido');
      continue;
    }
    const id = contractSupplyId(company, code);
    if (seen.has(id)) {
      err('item repetido na planilha (vale a 1ª linha)');
      continue;
    }
    seen.add(id);
    const qty = round3(row.qty);
    const price = row.price;
    const measureUnit = String(row.measureUnit ?? '').trim().toUpperCase() || 'UN';
    if (row.total !== null && Number.isFinite(row.total) && Math.abs(qty * price - row.total) > 0.05)
      plan.totalMismatch.push({ line: row.line, code, computed: Math.round(qty * price * 100) / 100, total: row.total });
    const before = byId.get(id);
    const bal = balOf.get(id) || null;
    if (!before) {
      plan.changes.push({
        id, line: row.line, code, description, measureUnit, isNew: true, qtyAfter: qty, priceAfter: price, textChanged: false,
        item: {
          id, unit: SUPPLY_CONTRACT_UNIT, company, code, description, measureUnit, cost: price, costFrom: today,
          history: [{ value: price, from: today, setAt: now, setBy, reason: plan.first ? 'contrato' : 'aditivo' }],
          createdAt: now, updatedAt: now
        },
        writeItem: true,
        writeBalance: bal ? 'qty' : 'create'
      });
      continue;
    }
    const used = bal ? round3(bal.suppliedQty + bal.reservedQty) : 0;
    if (qty < used) {
      err(`quantidade total ${fmt(qty)} menor que o já fornecido + aprovado (${fmt(used)}) — corrija a planilha`);
      continue;
    }
    const qtyBefore = bal ? bal.contractQty : undefined;
    const qtyChanged = !bal || bal.contractQty !== qty;
    const priceChanged = before.cost !== price;
    const textChanged = before.description !== description || before.measureUnit !== measureUnit;
    if (!qtyChanged && !priceChanged && !textChanged) {
      plan.unchanged++;
      continue;
    }
    plan.changes.push({
      id, line: row.line, code, description, measureUnit, isNew: false,
      qtyBefore, qtyAfter: qty, priceBefore: before.cost, priceAfter: price, textChanged,
      item: {
        ...before, code, description, measureUnit, updatedAt: now,
        ...(priceChanged
          ? { cost: price, costFrom: today, history: [...(before.history || []), { value: price, from: today, setAt: now, setBy, reason: 'aditivo' }] }
          : {})
      },
      writeItem: priceChanged || textChanged,
      writeBalance: !bal ? 'create' : qtyChanged ? 'qty' : null
    });
  }
  plan.missing = mine.filter((m) => !seen.has(m.id));
  return plan;
}
const fmt = (n: number) => String(round3(n)).replace('.', ',');

// Grava (operação em massa: liberada do disjuntor). Item e saldo vão no mesmo pacote. Se alguém aprovar/fornecer
// no meio e a quantidade nova ficar menor que o usado, o banco recusa aquele pacote: conferir de novo e repetir.
export function dbApplySupplyContractImport(plan: SupplyContractPlan, setBy: string): Promise<void> {
  return runBulk(() => applyContractNow(plan, setBy));
}
async function applyContractNow(plan: SupplyContractPlan, setBy: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const db = dbInstance;
  const now = new Date().toISOString();
  const reason = plan.first ? 'contrato' : 'aditivo';
  for (let i = 0; i < plan.changes.length; i += 200) {
    const batch = writeBatch(db);
    plan.changes.slice(i, i + 200).forEach((c) => {
      if (c.writeItem) batch.set(doc(db, 'supplies', c.id), { ...cleanUndefined(c.item), syncAt: serverTimestamp() });
      const log = { qty: c.qtyAfter, at: now, by: setBy, reason };
      if (c.writeBalance === 'create')
        batch.set(doc(db, 'supplyBalances', c.id), { company: plan.company, code: c.code, contractQty: c.qtyAfter, suppliedQty: 0, reservedQty: 0, qtyHistory: [log], updatedAt: now });
      else if (c.writeBalance === 'qty')
        batch.update(doc(db, 'supplyBalances', c.id), { contractQty: c.qtyAfter, qtyHistory: arrayUnion(log), updatedAt: now });
    });
    try {
      await batch.commit();
    } catch (err: any) {
      checkQuotaException(err);
      const done = i ? ` (${i} de ${plan.changes.length} itens já gravados)` : '';
      throw new Error(`${err?.message || err}${done}. Confira de novo e grave outra vez: o que já foi gravado aparece como "sem mudança".`);
    }
  }
  markSyncStale('supplies');
  balCompany.delete(plan.company);
  plan.changes.forEach((c) => balById.delete(c.id));
}

// Correção de texto (permissão "Editar descrição e unidade dos insumos"): quantidade e preço só mudam pela importação
export async function dbEditContractSupply(item: Material, description: string, measureUnit: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const d = description.trim();
  if (!d) throw new Error('Informe a descrição.');
  await updateDoc(doc(dbInstance, 'supplies', item.id), {
    description: d,
    measureUnit: measureUnit.trim().toUpperCase() || 'UN',
    updatedAt: new Date().toISOString(),
    syncAt: serverTimestamp()
  });
  markSyncStale('supplies');
}

// Exclusão (só Super Administrador, para corrigir erro de importação): só item que nunca saiu nem está aprovado
export async function dbDeleteContractSupply(item: Material): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const db = dbInstance;
  const snap = await getDoc(doc(db, 'supplyBalances', item.id));
  if (snap.exists()) {
    const b = mapBalance(snap.id, snap.data());
    if (b.suppliedQty > 0 || b.reservedQty > 0) throw new Error('Este item já foi aprovado ou fornecido: não pode ser excluído (fica no contrato para o histórico).');
  }
  await deleteDoc(doc(db, 'supplies', item.id));
  if (snap.exists()) await deleteDoc(doc(db, 'supplyBalances', item.id));
  await syncTombstone('supplies', SUPPLY_CONTRACT_UNIT, item.id); // os celulares apagam a cópia
  markSyncStale('supplies');
  balCompany.delete(item.company);
  balById.delete(item.id);
}
