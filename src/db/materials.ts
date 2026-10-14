import { runBulk } from './guard';
import { deleteDoc, doc, serverTimestamp, setDoc, writeBatch } from './guard';
import { Material } from '../types';
import { firebaseActive, dbInstance, cleanUndefined } from './core';
import { localTodayStr } from './serviceOrders';
import { markSyncStale, syncedList, syncStatus, syncTombstone } from './localSync';
import { dbGetManagements } from './organization';

// MATERIAIS (coleção "materials") e INSUMOS (coleção "supplies", Fase 8C): cada gerência + empresa tem a sua lista
// (etapa especial E2). As duas listas funcionam igual (mesmos campos, mesma tela, mesma importação): "kind" diz qual.
// Sem controle de estoque. Valor R$ 0,00 = o técnico não pode usar (ex.: saiu da planilha); o item fica para o histórico.
// Leitura: cópia guardada no aparelho em tempo real (src/db/localSync.ts) — baixa 1 vez e depois só o que mudou.
// Toda gravação leva syncAt (horário do servidor); excluir registra em syncDeletions.

export type CatalogKind = 'materials' | 'supplies';
const ID_PREFIX: Record<CatalogKind, string> = { materials: 'mat_', supplies: 'sup_' };

export const materialCodeKey = (c: unknown) => String(c ?? '').trim().toUpperCase();
export const catalogIdOf = (kind: CatalogKind, unit: string, company: string, code: string) =>
  ID_PREFIX[kind] + `${unit.trim().toUpperCase()}_${company.trim().toUpperCase()}_${materialCodeKey(code)}`.replace(/[^A-Z0-9_-]/g, '_');
export const materialIdOf = (unit: string, company: string, code: string) => catalogIdOf('materials', unit, company, code);

export function clearMaterialsCache(): void {
  markSyncStale('materials');
}

const catalogFilters = (unit: string, company?: string): [string, string][] => (company ? [['unit', unit], ['company', company]] : [['unit', unit]]);

// Lista de uma ou mais gerências (null = todas). "company": só a lista daquela empresa
// (o técnico só pode ler a da empresa dele; índice gerência + empresa + syncAt). force = conferir o que mudou agora.
export async function dbGetCatalog(kind: CatalogKind, units: string[] | null, force = false, company?: string): Promise<Material[]> {
  if (!firebaseActive || !dbInstance) return [];
  const list =
    units === null
      ? (await dbGetManagements().catch(() => [])).map((m) => m.name).filter((n) => n && n !== 'Todas')
      : units;
  const parts = await Promise.all(list.map((u) => syncedList<Material>(kind, u, catalogFilters(u, company), force)));
  return parts.flat().sort((a, b) => a.unit.localeCompare(b.unit) || a.description.localeCompare(b.description));
}
export const dbGetMaterials = (units: string[] | null, force = false, company?: string) => dbGetCatalog('materials', units, force, company);

// Situação da lista guardada de uma gerência + empresa (para a tela explicar quando vem vazia)
export const catalogSyncStatus = (kind: CatalogKind, unit: string, company?: string) => syncStatus(kind, catalogFilters(unit, company));
export const materialsSyncStatus = (unit: string, company?: string) => catalogSyncStatus('materials', unit, company);

// Cadastro manual (novo ou edição de código/descrição/unidade de medida). O valor muda por dbSetCatalogCost.
export async function dbSaveCatalogItem(kind: CatalogKind, item: Material): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  await setDoc(doc(dbInstance, kind, item.id), { ...cleanUndefined({ ...item, updatedAt: new Date().toISOString() }), syncAt: serverTimestamp() });
  markSyncStale(kind);
}
export const dbSaveMaterial = (material: Material) => dbSaveCatalogItem('materials', material);

// Exclusão manual (só Super Administrador, para corrigir erro de cadastro).
// As OS guardam uma cópia do que usaram (código, descrição e valor), então o histórico delas não se perde.
export async function dbDeleteCatalogItem(kind: CatalogKind, itemId: string, unit: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  await deleteDoc(doc(dbInstance, kind, itemId));
  await syncTombstone(kind, unit, itemId); // os aparelhos apagam a cópia local
  markSyncStale(kind);
}
export const dbDeleteMaterial = (materialId: string, unit: string) => dbDeleteCatalogItem('materials', materialId, unit);

// Novo valor a partir de uma data (o anterior fica no histórico)
export async function dbSetCatalogCost(kind: CatalogKind, item: Material, value: number, from: string, setBy: string, reason?: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const now = new Date().toISOString();
  await setDoc(doc(dbInstance, kind, item.id), {
    ...cleanUndefined({
      ...item,
      cost: value,
      costFrom: from,
      history: [...(item.history || []), { value, from, setAt: now, setBy, reason }],
      updatedAt: now
    }),
    syncAt: serverTimestamp()
  });
  markSyncStale(kind);
}
export const dbSetMaterialCost = (material: Material, value: number, from: string, setBy: string, reason?: string) =>
  dbSetCatalogCost('materials', material, value, from, setBy, reason);

// ===== IMPORTAÇÃO POR GERÊNCIA + EMPRESA =====
export interface MaterialImportRow {
  code: string;
  description: string;
  measureUnit: string;
  cost: number | null; // null = coluna de valor não informada / vazia
  line: number;
}

export interface MaterialImportPlan {
  kind: CatalogKind;
  unit: string;
  company: string;
  toCreate: Material[];
  toUpdate: { before: Material; after: Material }[];
  toZero: Material[];                               // saíram da planilha: valor vai a R$ 0,00
  skippedDuplicate: MaterialImportRow[];
  skippedInvalid: { row: MaterialImportRow; reason: string }[];
  unchanged: number;
}

export function planMaterialImport(
  unit: string,
  company: string,
  rows: MaterialImportRow[],
  existing: Material[],
  setBy: string,
  kind: CatalogKind = 'materials'
): MaterialImportPlan {
  const plan: MaterialImportPlan = { kind, unit, company, toCreate: [], toUpdate: [], toZero: [], skippedDuplicate: [], skippedInvalid: [], unchanged: 0 };
  const now = new Date().toISOString();
  const today = localTodayStr();
  const mine = existing.filter((m) => m.unit === unit && m.company === company);
  const byId = new Map(mine.map((m) => [m.id, m]));
  const seen = new Set<string>();

  for (const row of rows) {
    const code = String(row.code ?? '').trim();
    const description = String(row.description ?? '').trim();
    if (!code || !description) {
      plan.skippedInvalid.push({ row, reason: 'sem código ou descrição' });
      continue;
    }
    if (row.cost !== null && (!Number.isFinite(row.cost) || row.cost < 0)) {
      plan.skippedInvalid.push({ row, reason: 'valor inválido' });
      continue;
    }
    const id = catalogIdOf(kind, unit, company, code);
    if (seen.has(id)) {
      plan.skippedDuplicate.push(row);
      continue;
    }
    seen.add(id);
    const measureUnit = String(row.measureUnit ?? '').trim().toUpperCase() || 'UN';
    const before = byId.get(id);
    if (!before) {
      const cost = row.cost ?? 0;
      plan.toCreate.push({
        id, unit, company, code, description, measureUnit, cost,
        costFrom: cost > 0 ? today : '',
        history: cost > 0 ? [{ value: cost, from: today, setAt: now, setBy, reason: 'importação' }] : [],
        createdAt: now, updatedAt: now
      });
      continue;
    }
    const costChanged = row.cost !== null && row.cost !== before.cost;
    if (before.description !== description || before.measureUnit !== measureUnit || before.code !== code || costChanged) {
      plan.toUpdate.push({
        before,
        after: {
          ...before, code, description, measureUnit, updatedAt: now,
          ...(costChanged
            ? {
                cost: row.cost as number,
                costFrom: today,
                history: [...(before.history || []), { value: row.cost as number, from: today, setAt: now, setBy, reason: 'importação' }]
              }
            : {})
        }
      });
    } else {
      plan.unchanged++;
    }
  }

  // Quem saiu da planilha continua na lista (histórico), com valor R$ 0,00
  plan.toZero = mine
    .filter((m) => !seen.has(m.id) && m.cost > 0)
    .map((m) => ({
      ...m,
      cost: 0,
      costFrom: today,
      history: [...(m.history || []), { value: 0, from: today, setAt: now, setBy, reason: 'saiu da planilha' }],
      updatedAt: now
    }));
  return plan;
}

// Operação em massa: roda liberada do disjuntor (src/db/guard.ts)
export function dbApplyMaterialImport(...args: Parameters<typeof dbApplyMaterialImportNow>): ReturnType<typeof dbApplyMaterialImportNow> {
  return runBulk(() => dbApplyMaterialImportNow(...args));
}
async function dbApplyMaterialImportNow(plan: MaterialImportPlan): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const db = dbInstance;
  const writes: Material[] = [...plan.toCreate, ...plan.toUpdate.map((u) => u.after), ...plan.toZero];
  for (let i = 0; i < writes.length; i += 400) {
    const batch = writeBatch(db);
    writes.slice(i, i + 400).forEach((m) => batch.set(doc(db, plan.kind, m.id), { ...cleanUndefined(m), syncAt: serverTimestamp() }));
    await batch.commit();
  }
  markSyncStale(plan.kind);
}

// ===== PLANILHA DO ALMOXARIFADO (ajuste A7, 14/10/2026) =====
// Colunas: GERÊNCIA, ALMOXARIFADO, CÓDIGO, MATERIAL, MATERIAL RESUMIDO, U.M., TOTAL - QTDE., TOTAL - VALOR, VALOR UNITÁRIO.
// A planilha é a posição completa do almoxarifado da gerência (uma empresa escolhida na tela). Um material por código,
// com o saldo de cada almoxarifado; valor = soma dos valores ÷ soma das quantidades (ao centavo). Quem saiu da planilha
// fica sem saldo (o técnico não pede; continua na lista e no "material usado" da OS). Saldo só para consulta.

// O técnico pode pedir? Com posição de almoxarifado: precisa de saldo; sem posição (cadastro antigo): valor > 0
export const materialRequestable = (m: Material): boolean => m.cost > 0 && (!m.stockAt || (m.stockTotal || 0) > 0);

export interface StockImportRow {
  unit: string;
  warehouse: string; // nome como veio na planilha
  code: string;
  description: string;
  shortDescription: string;
  measureUnit: string;
  qty: number;
  totalValue: number | null;
  unitValue: number | null;
  line: number;
}

export interface StockImportPlan {
  company: string;
  units: string[];
  stockAt: string;
  warehouses: { id: string; name: string; isNew: boolean }[];
  toCreate: Material[];
  toUpdate: { before: Material; after: Material }[];
  unchanged: Material[]; // só a data da posição muda (também gravados)
  toEmpty: Material[]; // saíram da planilha: ficam sem saldo
  averaged: { code: string; description: string; values: number[]; cost: number }[]; // valor diferente entre almoxarifados
  skipped: { row: StockImportRow; reason: string }[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const sameStock = (a?: Record<string, number>, b?: Record<string, number>) => {
  const ka = Object.keys(a || {}).filter((k) => (a as any)[k] > 0).sort();
  const kb = Object.keys(b || {}).filter((k) => (b as any)[k] > 0).sort();
  return ka.join('|') === kb.join('|') && ka.every((k) => (a as any)[k] === (b as any)[k]);
};

export function planStockImport(
  rows: StockImportRow[],
  existing: Material[],
  company: string,
  knownWarehouses: { id: string; name: string }[],
  warehouseIdOf: (name: string) => string,
  setBy: string
): StockImportPlan {
  const now = new Date().toISOString();
  const today = localTodayStr();
  const plan: StockImportPlan = { company, units: [], stockAt: today, warehouses: [], toCreate: [], toUpdate: [], unchanged: [], toEmpty: [], averaged: [], skipped: [] };
  // Almoxarifados: pelo id (nome sem acento/maiúsculas); o que não existe será criado
  const whById = new Map<string, { id: string; name: string; isNew: boolean }>();
  // Agrupa por gerência + código
  const groups = new Map<string, StockImportRow[]>();
  for (const r of rows) {
    const code = materialCodeKey(r.code);
    const unit = String(r.unit || '').trim().toUpperCase();
    if (!code || !String(r.description || '').trim()) {
      plan.skipped.push({ row: r, reason: 'sem código ou material' });
      continue;
    }
    if (!unit) {
      plan.skipped.push({ row: r, reason: 'sem gerência' });
      continue;
    }
    if (!String(r.warehouse || '').trim()) {
      plan.skipped.push({ row: r, reason: 'sem almoxarifado' });
      continue;
    }
    if (!Number.isFinite(r.qty) || r.qty < 0) {
      plan.skipped.push({ row: r, reason: 'quantidade inválida' });
      continue;
    }
    const whId = warehouseIdOf(r.warehouse);
    if (!whById.has(whId)) {
      const known = knownWarehouses.find((w) => w.id === whId);
      whById.set(whId, { id: whId, name: known ? known.name : r.warehouse.trim(), isNew: !known });
    }
    const k = `${unit}|${code}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push({ ...r, unit, code });
  }
  plan.warehouses = Array.from(whById.values());
  plan.units = Array.from(new Set(Array.from(groups.values()).map((g) => g[0].unit))).sort();

  const seen = new Set<string>();
  for (const g of groups.values()) {
    const first = g[0];
    const id = catalogIdOf('materials', first.unit, company, first.code);
    seen.add(id);
    const stock: Record<string, number> = {};
    let qty = 0;
    let value = 0;
    let valueOk = true;
    const unitValues: number[] = [];
    for (const r of g) {
      const w = warehouseIdOf(r.warehouse);
      stock[w] = (stock[w] || 0) + r.qty;
      qty += r.qty;
      const total = r.totalValue ?? (r.unitValue !== null ? r.unitValue * r.qty : null);
      if (total === null || !Number.isFinite(total)) valueOk = false;
      else value += total;
      if (r.unitValue !== null && Number.isFinite(r.unitValue)) unitValues.push(round2(r.unitValue));
    }
    const cost = valueOk && qty > 0 ? round2(value / qty) : unitValues.length ? unitValues[0] : 0;
    if (new Set(unitValues).size > 1) plan.averaged.push({ code: first.code, description: first.description.trim(), values: Array.from(new Set(unitValues)), cost });
    const description = first.description.trim();
    const shortDescription = String(first.shortDescription || '').trim() || description;
    const measureUnit = String(first.measureUnit || '').trim().toUpperCase() || 'UN';
    const before = existing.find((m) => m.id === id);
    const stockFields = { stock, stockTotal: qty, stockAt: today };
    if (!before) {
      plan.toCreate.push({
        id, unit: first.unit, company, code: first.code, description, shortDescription, measureUnit, cost,
        costFrom: cost > 0 ? today : '',
        history: cost > 0 ? [{ value: cost, from: today, setAt: now, setBy, reason: 'planilha do almoxarifado' }] : [],
        createdAt: now, updatedAt: now, ...stockFields
      });
      continue;
    }
    const costChanged = cost !== before.cost;
    const changed =
      costChanged || before.description !== description || (before.shortDescription || '') !== shortDescription || before.measureUnit !== measureUnit || !sameStock(before.stock, stock);
    const after: Material = {
      ...before, description, shortDescription, measureUnit, updatedAt: now, ...stockFields,
      ...(costChanged
        ? { cost, costFrom: today, history: [...(before.history || []), { value: cost, from: today, setAt: now, setBy, reason: 'planilha do almoxarifado' }] }
        : {})
    };
    if (changed) plan.toUpdate.push({ before, after });
    else plan.unchanged.push(after);
  }
  // Saíram da planilha (mesma gerência + empresa): ficam sem saldo e continuam na lista. Os que já estavam sem saldo
  // não mudam (não aparecem de novo na conferência)
  plan.toEmpty = existing
    .filter((m) => m.company === company && plan.units.includes(m.unit) && !seen.has(m.id) && (!m.stockAt || (m.stockTotal || 0) > 0))
    .map((m) => ({ ...m, stock: {}, stockTotal: 0, stockAt: today, updatedAt: now }));
  return plan;
}

// Grava a planilha (operação em massa: liberada do disjuntor). Os almoxarifados novos entram antes, na lista de Configurações.
export function dbApplyStockImport(...args: Parameters<typeof dbApplyStockImportNow>): ReturnType<typeof dbApplyStockImportNow> {
  return runBulk(() => dbApplyStockImportNow(...args));
}
async function dbApplyStockImportNow(plan: StockImportPlan, addWarehouses: (list: { id: string; name: string }[]) => Promise<void>): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const db = dbInstance;
  const fresh = plan.warehouses.filter((w) => w.isNew);
  if (fresh.length) await addWarehouses(fresh);
  const writes: Material[] = [...plan.toCreate, ...plan.toUpdate.map((u) => u.after), ...plan.unchanged, ...plan.toEmpty];
  for (let i = 0; i < writes.length; i += 400) {
    const batch = writeBatch(db);
    writes.slice(i, i + 400).forEach((m) => batch.set(doc(db, 'materials', m.id), { ...cleanUndefined(m), syncAt: serverTimestamp() }));
    await batch.commit();
  }
  markSyncStale('materials');
}
