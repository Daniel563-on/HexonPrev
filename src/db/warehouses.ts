import { doc, getDoc, setDoc } from './guard';
import { Warehouse } from '../types';
import { firebaseActive, dbInstance, checkQuotaException } from './core';

// ALMOXARIFADOS (Fase 8B): lista única para todas as gerências, cadastrada pelo Super Administrador
// (Configurações › Almoxarifados). Registro "appControl/warehouses" (todos leem; só o Super Admin altera).
// 1 leitura por sessão; sem registro gravado, vale a lista inicial.

export const DEFAULT_WAREHOUSES: Warehouse[] = [
  { id: 'subalmoxarifado', name: 'Subalmoxarifado', active: true },
  { id: 'almoxarifado-central', name: 'Almoxarifado Central', active: true },
  { id: 'almoxarifado-benfica', name: 'Almoxarifado Benfica', active: true }
];

let cache: Warehouse[] | null = null;

export async function dbGetWarehouses(force = false): Promise<Warehouse[]> {
  if (cache && !force) return [...cache];
  if (!firebaseActive || !dbInstance) return [...DEFAULT_WAREHOUSES];
  try {
    const snap = await getDoc(doc(dbInstance, 'appControl', 'warehouses'));
    const list = snap.exists() ? ((snap.data().list || []) as Warehouse[]) : DEFAULT_WAREHOUSES;
    cache = list.length ? list : DEFAULT_WAREHOUSES;
    return [...cache];
  } catch (err: any) {
    checkQuotaException(err);
    return cache ? [...cache] : [...DEFAULT_WAREHOUSES];
  }
}

export async function dbSaveWarehouses(list: Warehouse[], by: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const clean = list.map((w) => ({ id: w.id, name: w.name.trim(), active: !!w.active })).filter((w) => w.name);
  await setDoc(doc(dbInstance, 'appControl', 'warehouses'), { list: clean, updatedAt: new Date().toISOString(), updatedBy: by });
  cache = clean;
}

// id estável a partir do nome (ex.: "Almoxarifado Central" -> "almoxarifado-central")
export function warehouseIdOf(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || `almox-${Date.now()}`
  );
}
