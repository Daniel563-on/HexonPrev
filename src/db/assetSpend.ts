import { collection, doc, getDoc, getDocs, query, where } from './guard';
import { Material, ServiceOrder } from '../types';
import { firebaseActive, dbInstance, checkQuotaException } from './core';
import { dbGetMaterials } from './materials';
import { localDate, valueAt } from './manHours';

// GASTO DO ATIVO (Hexon 2.0, Fase 3) — só para quem tem "Ver valores em R$".
// Nada é gravado: o valor é calculado na hora, com o preço do material vigente na data da conclusão.
// As OS corretivas entram aqui quando o módulo de OS existir (Fase 5).

// Uma OS pelo número, sem buscar o checklist (para o valor de uma linha do histórico)
export async function dbGetOrderForCost(orderId: string): Promise<ServiceOrder | null> {
  if (!orderId || !firebaseActive || !dbInstance) return null;
  try {
    const snap = await getDoc(doc(dbInstance, 'serviceOrders', orderId));
    return snap.exists() ? ({ id: snap.id, ...snap.data() } as ServiceOrder) : null;
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}

export interface AssetMaterialSpend {
  total: number;      // R$ de materiais somados
  orders: number;     // OS concluídas que usaram material
  missing: number;    // materiais sem valor cadastrado na data (não entram no total)
}

// Soma dos materiais de todas as preventivas concluídas do ativo.
// Lê as OS do ativo (índice serviceOrders: assetId); quem não vê todas as gerências busca só as das suas.
export async function dbGetAssetMaterialSpend(assetId: string, units: string[] | null): Promise<AssetMaterialSpend> {
  if (!assetId || !firebaseActive || !dbInstance) return { total: 0, orders: 0, missing: 0 };
  if (units !== null && units.length === 0) return { total: 0, orders: 0, missing: 0 };
  try {
    const parts: any[] = [where('assetId', '==', assetId)];
    if (units !== null) parts.push(where('unit', 'in', units.slice(0, 10)));
    const snap = await getDocs(query(collection(dbInstance, 'serviceOrders'), ...parts));
    const done = snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as ServiceOrder))
      .filter((o) => o.status === 'Concluída' && (o.materialsUsed || []).length > 0);
    if (done.length === 0) return { total: 0, orders: 0, missing: 0 };

    const orderUnits = Array.from(new Set(done.map((o) => o.unit).filter(Boolean) as string[])).sort();
    const materials: Material[] = orderUnits.length > 0 ? await dbGetMaterials(orderUnits) : [];
    const byId = new Map<string, Material>(materials.map((m) => [m.id, m]));

    let total = 0;
    let missing = 0;
    done.forEach((o) => {
      const date = localDate(o.completedAt || o.updatedAt || new Date().toISOString());
      (o.materialsUsed || []).forEach((m) => {
        const mat = byId.get(m.id);
        const price = mat ? valueAt(mat.history, date) : null;
        if (price === null) missing++;
        else total += m.qty * price;
      });
    });
    return { total: Math.round(total * 100) / 100, orders: done.length, missing };
  } catch (err: any) {
    console.warn('Falha ao somar o gasto com materiais do ativo:', err);
    checkQuotaException(err);
    throw err;
  }
}
