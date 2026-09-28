import { collection, doc, getDocs, query, setDoc, where, writeBatch } from 'firebase/firestore';
import { Material } from '../types';
import { firebaseActive, dbInstance, cleanUndefined, checkQuotaException } from './core';
import { localTodayStr } from './serviceOrders';

// MATERIAIS (coleção "materials"): cada gerência tem a sua lista. Sem controle de estoque.
// Valor R$ 0,00 = o técnico não pode usar (ex.: saiu da planilha); o material fica para o histórico.

export const materialCodeKey = (c: unknown) => String(c ?? '').trim().toUpperCase();
export const materialIdOf = (unit: string, code: string) =>
  `mat_${unit.trim().toUpperCase()}_${materialCodeKey(code)}`.replace(/[^A-Z0-9_-]/g, '_');

let cacheMaterials: { key: string; list: Material[] } | null = null;

export function clearMaterialsCache(): void {
  cacheMaterials = null;
}

// Uma busca por gerência (as regras do banco só liberam as gerências do perfil); null = todas
export async function dbGetMaterials(units: string[] | null, force = false): Promise<Material[]> {
  const key = units === null ? '*' : units.join('|');
  if (cacheMaterials && cacheMaterials.key === key && !force) return [...cacheMaterials.list];
  if (!firebaseActive || !dbInstance) return [];
  try {
    const ref = collection(dbInstance, 'materials');
    const snaps = units === null ? [await getDocs(ref)] : await Promise.all(units.map((u) => getDocs(query(ref, where('unit', '==', u)))));
    const list = snaps
      .flatMap((snap) => snap.docs.map((d) => ({ ...(d.data() as Material), id: d.id })))
      .sort((a, b) => a.unit.localeCompare(b.unit) || a.description.localeCompare(b.description));
    cacheMaterials = { key, list };
    return [...list];
  } catch (err: any) {
    console.warn('Não foi possível ler os materiais:', err);
    checkQuotaException(err);
    return [];
  }
}

// Cadastro manual (novo ou edição de código/descrição/unidade de medida). O valor muda por dbSetMaterialCost.
export async function dbSaveMaterial(material: Material): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  await setDoc(doc(dbInstance, 'materials', material.id), cleanUndefined({ ...material, updatedAt: new Date().toISOString() }));
  cacheMaterials = null;
}

// Novo valor do material a partir de uma data (o anterior fica no histórico)
export async function dbSetMaterialCost(material: Material, value: number, from: string, setBy: string, reason?: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const now = new Date().toISOString();
  await setDoc(
    doc(dbInstance, 'materials', material.id),
    cleanUndefined({
      ...material,
      cost: value,
      costFrom: from,
      history: [...(material.history || []), { value, from, setAt: now, setBy, reason }],
      updatedAt: now
    })
  );
  cacheMaterials = null;
}

// ===== IMPORTAÇÃO POR GERÊNCIA =====
export interface MaterialImportRow {
  code: string;
  description: string;
  measureUnit: string;
  cost: number | null; // null = coluna de valor não informada / vazia
  line: number;
}

export interface MaterialImportPlan {
  unit: string;
  toCreate: Material[];
  toUpdate: { before: Material; after: Material }[];
  toZero: Material[];                               // saíram da planilha: valor vai a R$ 0,00
  skippedDuplicate: MaterialImportRow[];
  skippedInvalid: { row: MaterialImportRow; reason: string }[];
  unchanged: number;
}

export function planMaterialImport(unit: string, rows: MaterialImportRow[], existing: Material[], setBy: string): MaterialImportPlan {
  const plan: MaterialImportPlan = { unit, toCreate: [], toUpdate: [], toZero: [], skippedDuplicate: [], skippedInvalid: [], unchanged: 0 };
  const now = new Date().toISOString();
  const today = localTodayStr();
  const mine = existing.filter((m) => m.unit === unit);
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
    const id = materialIdOf(unit, code);
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
        id, unit, code, description, measureUnit, cost,
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

export async function dbApplyMaterialImport(plan: MaterialImportPlan): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const db = dbInstance;
  const writes: Material[] = [...plan.toCreate, ...plan.toUpdate.map((u) => u.after), ...plan.toZero];
  for (let i = 0; i < writes.length; i += 400) {
    const batch = writeBatch(db);
    writes.slice(i, i + 400).forEach((m) => batch.set(doc(db, 'materials', m.id), cleanUndefined(m)));
    await batch.commit();
  }
  cacheMaterials = null;
}
