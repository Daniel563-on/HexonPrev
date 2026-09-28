import { collection, deleteDoc, doc, getDocs, query, setDoc, where, writeBatch } from 'firebase/firestore';
import { AssetPeriodicity, AssetTypeConfig, CycleSetting } from '../types';
import { firebaseActive, dbInstance, cleanUndefined, checkQuotaException } from './core';

// CICLO DE PREVENTIVAS POR GERÊNCIA
// - Tipos de ativo (coleção "assetTypes"): cada tipo tem as suas periodicidades; o ativo herda do tipo.
// - Início do ciclo (coleção "cycleSettings"): o "mês 1" de cada gerência. Em cada mês vale só a de maior peso.

// Peso e intervalo (em meses) de cada periodicidade de ativo
export const ASSET_PERIODICITIES: { name: AssetPeriodicity; everyMonths: number; short: string }[] = [
  { name: 'Mensal', everyMonths: 1, short: 'M' },
  { name: 'Trimestral', everyMonths: 3, short: 'T' },
  { name: 'Semestral', everyMonths: 6, short: 'S' },
  { name: 'Anual', everyMonths: 12, short: 'A' }
];

// Mês do ciclo (1, 2, 3...) de um mês "AAAA-MM", contado a partir do início ("AAAA-MM"). 0 = antes do início.
export function cycleMonthIndex(cycleStart: string, month: string): number {
  if (!cycleStart || !month) return 0;
  const [sy, sm] = cycleStart.split('-').map(Number);
  const [y, m] = month.split('-').map(Number);
  const diff = (y - sy) * 12 + (m - sm);
  return diff < 0 ? 0 : diff + 1;
}

// Periodicidade que vale no mês do ciclo: a de maior peso que "vence" nesse mês (entre as do tipo)
export function duePeriodicity(periodicities: AssetPeriodicity[], cycleMonth: number): AssetPeriodicity | null {
  if (cycleMonth < 1) return null;
  let due: AssetPeriodicity | null = null;
  for (const p of ASSET_PERIODICITIES) {
    if (periodicities.includes(p.name) && cycleMonth % p.everyMonths === 0) due = p.name;
  }
  return due;
}

// Soma meses a "AAAA-MM"
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export const assetTypeKey = (t: unknown) =>
  String(t ?? '').trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
export const assetTypeIdOf = (unit: string, name: string) =>
  `tipo_${unit.trim().toUpperCase()}_${assetTypeKey(name)}`.replace(/[^A-Z0-9_-]/g, '_');

// ===== TIPOS DE ATIVO =====
export async function dbGetAssetTypes(units: string[] | null): Promise<AssetTypeConfig[]> {
  if (!firebaseActive || !dbInstance) return [];
  try {
    const ref = collection(dbInstance, 'assetTypes');
    const snaps = units === null ? [await getDocs(ref)] : await Promise.all(units.map((u) => getDocs(query(ref, where('unit', '==', u)))));
    return snaps
      .flatMap((snap) => snap.docs.map((d) => ({ ...(d.data() as AssetTypeConfig), id: d.id })))
      .sort((a, b) => a.unit.localeCompare(b.unit) || a.name.localeCompare(b.name));
  } catch (err: any) {
    console.warn('Não foi possível ler os tipos de ativo:', err);
    checkQuotaException(err);
    return [];
  }
}

export interface AssetTypeSyncResult {
  created: string[];
  archived: string[];
  restored: string[];
}

// "Atualizar tipos": deixa a lista da gerência igual aos tipos que existem nos ativos dela.
// Tipo novo entra sem periodicidade; tipo que nenhum ativo tem mais é arquivado; se voltar, volta como estava.
export async function dbSyncAssetTypes(unit: string, typeNames: string[], current: AssetTypeConfig[]): Promise<AssetTypeSyncResult> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const mine = current.filter((t) => t.unit === unit);
  const inUse = new Set(typeNames.map(assetTypeKey).filter(Boolean));
  const known = new Set(mine.map((t) => assetTypeKey(t.name)));
  const now = new Date().toISOString();
  const result: AssetTypeSyncResult = { created: [], archived: [], restored: [] };
  const batch = writeBatch(dbInstance);
  for (const t of mine) {
    const used = inUse.has(assetTypeKey(t.name));
    if (!used && !t.archived) {
      batch.set(doc(dbInstance, 'assetTypes', t.id), { ...t, archived: true, updatedAt: now });
      result.archived.push(t.name);
    } else if (used && t.archived) {
      batch.set(doc(dbInstance, 'assetTypes', t.id), { ...t, archived: false, updatedAt: now });
      result.restored.push(t.name);
    }
  }
  for (const name of typeNames) {
    const key = assetTypeKey(name);
    if (!key || known.has(key)) continue;
    known.add(key);
    const t: AssetTypeConfig = { id: assetTypeIdOf(unit, name), unit, name: name.trim(), periodicities: [], createdAt: now, updatedAt: now };
    batch.set(doc(dbInstance, 'assetTypes', t.id), t);
    result.created.push(t.name);
  }
  if (result.created.length + result.archived.length + result.restored.length > 0) await batch.commit();
  return result;
}

export async function dbSaveAssetTypePeriodicities(t: AssetTypeConfig, periodicities: AssetPeriodicity[]): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  // Guarda na ordem de peso (Mensal, Trimestral, Semestral, Anual)
  const ordered = ASSET_PERIODICITIES.map((p) => p.name).filter((n) => periodicities.includes(n));
  await setDoc(doc(dbInstance, 'assetTypes', t.id), cleanUndefined({ ...t, periodicities: ordered, updatedAt: new Date().toISOString() }));
}

// ===== INÍCIO DO CICLO =====
export async function dbGetCycleSettings(): Promise<CycleSetting[]> {
  if (!firebaseActive || !dbInstance) return [];
  try {
    const snap = await getDocs(collection(dbInstance, 'cycleSettings'));
    return snap.docs.map((d) => ({ ...(d.data() as CycleSetting), unit: d.id }));
  } catch (err: any) {
    console.warn('Não foi possível ler o início do ciclo:', err);
    checkQuotaException(err);
    return [];
  }
}

export async function dbSetCycleStart(unit: string, cycleStart: string, setBy: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const setting: CycleSetting = { unit, cycleStart, setAt: new Date().toISOString(), setBy };
  await setDoc(doc(dbInstance, 'cycleSettings', unit), setting);
}

export async function dbClearCycleStart(unit: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  await deleteDoc(doc(dbInstance, 'cycleSettings', unit));
}
