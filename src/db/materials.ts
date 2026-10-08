import { runBulk } from './guard';
import { deleteDoc, doc, serverTimestamp, setDoc, writeBatch } from './guard';
import { Material } from '../types';
import { firebaseActive, dbInstance, cleanUndefined } from './core';
import { localTodayStr } from './serviceOrders';
import { markSyncStale, syncedList, syncTombstone } from './localSync';
import { dbGetManagements } from './organization';

// MATERIAIS (coleção "materials"): cada gerência + empresa tem a sua lista (etapa especial E2). Sem controle de estoque.
// Valor R$ 0,00 = o técnico não pode usar (ex.: saiu da planilha); o material fica para o histórico.
// Leitura: cópia guardada no aparelho (src/db/localSync.ts) — baixa 1 vez e depois só o que mudou.
// Toda gravação leva syncAt (horário do servidor); excluir registra em syncDeletions.

export const materialCodeKey = (c: unknown) => String(c ?? '').trim().toUpperCase();
export const materialIdOf = (unit: string, company: string, code: string) =>
  'mat_' + `${unit.trim().toUpperCase()}_${company.trim().toUpperCase()}_${materialCodeKey(code)}`.replace(/[^A-Z0-9_-]/g, '_');

export function clearMaterialsCache(): void {
  markSyncStale('materials');
}

// Lista de uma ou mais gerências (null = todas). "company": só a lista daquela empresa
// (o técnico só pode ler a da empresa dele; índice gerência + empresa + syncAt). force = conferir o que mudou agora.
export async function dbGetMaterials(units: string[] | null, force = false, company?: string): Promise<Material[]> {
  if (!firebaseActive || !dbInstance) return [];
  const list =
    units === null
      ? (await dbGetManagements().catch(() => [])).map((m) => m.name).filter((n) => n && n !== 'Todas')
      : units;
  const parts = await Promise.all(
    list.map((u) => syncedList<Material>('materials', u, company ? [['unit', u], ['company', company]] : [['unit', u]], force))
  );
  return parts.flat().sort((a, b) => a.unit.localeCompare(b.unit) || a.description.localeCompare(b.description));
}

// Cadastro manual (novo ou edição de código/descrição/unidade de medida). O valor muda por dbSetMaterialCost.
export async function dbSaveMaterial(material: Material): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  await setDoc(doc(dbInstance, 'materials', material.id), { ...cleanUndefined({ ...material, updatedAt: new Date().toISOString() }), syncAt: serverTimestamp() });
  markSyncStale('materials');
}

// Exclusão manual (só Super Administrador, para corrigir erro de cadastro).
// As OS guardam uma cópia do material usado (código, descrição e valor), então o histórico delas não se perde.
export async function dbDeleteMaterial(materialId: string, unit: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  await deleteDoc(doc(dbInstance, 'materials', materialId));
  await syncTombstone('materials', unit, materialId); // os aparelhos apagam a cópia local
  markSyncStale('materials');
}

// Novo valor do material a partir de uma data (o anterior fica no histórico)
export async function dbSetMaterialCost(material: Material, value: number, from: string, setBy: string, reason?: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const now = new Date().toISOString();
  await setDoc(doc(dbInstance, 'materials', material.id), {
    ...cleanUndefined({
      ...material,
      cost: value,
      costFrom: from,
      history: [...(material.history || []), { value, from, setAt: now, setBy, reason }],
      updatedAt: now
    }),
    syncAt: serverTimestamp()
  });
  markSyncStale('materials');
}

// ===== IMPORTAÇÃO POR GERÊNCIA + EMPRESA =====
export interface MaterialImportRow {
  code: string;
  description: string;
  measureUnit: string;
  cost: number | null; // null = coluna de valor não informada / vazia
  line: number;
}

export interface MaterialImportPlan {
  unit: string;
  company: string;
  toCreate: Material[];
  toUpdate: { before: Material; after: Material }[];
  toZero: Material[];                               // saíram da planilha: valor vai a R$ 0,00
  skippedDuplicate: MaterialImportRow[];
  skippedInvalid: { row: MaterialImportRow; reason: string }[];
  unchanged: number;
}

export function planMaterialImport(unit: string, company: string, rows: MaterialImportRow[], existing: Material[], setBy: string): MaterialImportPlan {
  const plan: MaterialImportPlan = { unit, company, toCreate: [], toUpdate: [], toZero: [], skippedDuplicate: [], skippedInvalid: [], unchanged: 0 };
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
    const id = materialIdOf(unit, company, code);
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
    writes.slice(i, i + 400).forEach((m) => batch.set(doc(db, 'materials', m.id), { ...cleanUndefined(m), syncAt: serverTimestamp() }));
    await batch.commit();
  }
  markSyncStale('materials');
}
