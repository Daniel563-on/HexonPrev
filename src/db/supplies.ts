import { Material } from '../types';
import { catalogIdOf, catalogSyncStatus, dbDeleteCatalogItem, dbGetCatalog, dbSaveCatalogItem, dbSetCatalogCost } from './materials';

// INSUMOS (coleção "supplies", Fase 8C): lista de cada gerência + empresa, igual à de materiais (mesmos campos,
// mesma tela "Gestão de Insumos", mesma importação). O técnico pede insumos pelo celular (8C-2).
// As funções são as do catálogo de materiais (src/db/materials.ts) com kind = 'supplies'.

export const supplyIdOf = (unit: string, company: string, code: string) => catalogIdOf('supplies', unit, company, code);
export const dbGetSupplies = (units: string[] | null, force = false, company?: string): Promise<Material[]> =>
  dbGetCatalog('supplies', units, force, company);
export const suppliesSyncStatus = (unit: string, company?: string) => catalogSyncStatus('supplies', unit, company);
export const dbSaveSupply = (item: Material) => dbSaveCatalogItem('supplies', item);
export const dbDeleteSupply = (itemId: string, unit: string) => dbDeleteCatalogItem('supplies', itemId, unit);
export const dbSetSupplyCost = (item: Material, value: number, from: string, setBy: string, reason?: string) =>
  dbSetCatalogCost('supplies', item, value, from, setBy, reason);
