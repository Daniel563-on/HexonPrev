import { arrayRemove, collection, deleteDoc, deleteField, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where, writeBatch } from 'firebase/firestore';
import { HexonUser, OvernightRateSetting, PlanningLot, ServiceOrder } from '../types';
import { firebaseActive, dbInstance, cleanUndefined, checkQuotaException } from './core';

// PLANEJAMENTO (Etapa 5): lotes de agendamento e valor do pernoite.
// A OS guarda só o lote (lotId); o custo do pernoite é calculado na hora, para quem pode ver valores.

// ===== VALOR DO PERNOITE (coleção "costSettings", documento "overnight") =====
export async function dbGetOvernightRate(): Promise<OvernightRateSetting | null> {
  if (!firebaseActive || !dbInstance) return null;
  try {
    const snap = await getDoc(doc(dbInstance, 'costSettings', 'overnight'));
    return snap.exists() ? (snap.data() as OvernightRateSetting) : null;
  } catch (err: any) {
    // Sem a permissão "Visualizar Valores (R$)" o banco não entrega o valor (esperado)
    checkQuotaException(err);
    return null;
  }
}

export async function dbSetOvernightRate(current: OvernightRateSetting | null, value: number, from: string, setBy: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const entry = { value, from, setAt: new Date().toISOString(), setBy };
  const history = [...(current?.history || []), entry].sort((a, b) => a.from.localeCompare(b.from) || a.setAt.localeCompare(b.setAt));
  const latest = history[history.length - 1];
  await setDoc(doc(dbInstance, 'costSettings', 'overnight'), { value: latest.value, from: latest.from, history });
}

// Exclui um lançamento errado do histórico (Super Administrador). O valor atual passa a ser o último que sobrar;
// se não sobrar nenhum, o valor do pernoite fica "não informado".
export async function dbRemoveOvernightRateEntry(current: OvernightRateSetting, entry: OvernightRateSetting['history'][number]): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const history = current.history
    .filter((h) => !(h.setAt === entry.setAt && h.from === entry.from && h.value === entry.value))
    .sort((a, b) => a.from.localeCompare(b.from) || a.setAt.localeCompare(b.setAt));
  const ref = doc(dbInstance, 'costSettings', 'overnight');
  if (history.length === 0) {
    await deleteDoc(ref);
    return;
  }
  const latest = history[history.length - 1];
  await setDoc(ref, { value: latest.value, from: latest.from, history });
}

// Valor vigente numa data ("AAAA-MM-DD"): o último que começou até essa data
export function overnightRateAt(setting: OvernightRateSetting | null, dateStr: string): number {
  if (!setting) return 0;
  let value = 0;
  for (const h of [...setting.history].sort((a, b) => a.from.localeCompare(b.from) || a.setAt.localeCompare(b.setAt))) {
    if (h.from <= dateStr) value = h.value;
  }
  return value;
}

// Custo do pernoite do lote e a parte de cada OS (redividido entre as OS que continuam no lote)
export function lotOvernightCost(lot: PlanningLot, setting: OvernightRateSetting | null): { total: number; perOrder: number } {
  if (!lot.overnight) return { total: 0, perOrder: 0 };
  const rate = overnightRateAt(setting, lot.createdAt.slice(0, 10));
  const total = Math.round(lot.overnight.people * lot.overnight.nights * rate * 100) / 100;
  const count = lot.orderIds.length;
  return { total, perOrder: count > 0 ? Math.round((total / count) * 100) / 100 : 0 };
}

// ===== LOTES (coleção "planningLots") =====
export async function dbGetPlanningLots(unit: string, fromDate: string, toDate: string): Promise<PlanningLot[]> {
  if (!firebaseActive || !dbInstance) return [];
  try {
    const snap = await getDocs(
      query(collection(dbInstance, 'planningLots'), where('unit', '==', unit), where('periodStart', '>=', fromDate), where('periodStart', '<=', toDate))
    );
    return snap.docs.map((d) => ({ ...(d.data() as PlanningLot), id: d.id }));
  } catch (err: any) {
    console.warn('Não foi possível ler os lotes de planejamento:', err);
    checkQuotaException(err);
    return [];
  }
}

export interface ScheduleLotInput {
  unit: string;
  orders: ServiceOrder[];
  periodStart: string;
  periodEnd: string;
  technician: Pick<HexonUser, 'name' | 'matricula'>;
  overnight: { people: number; nights: number } | null;
  createdBy: string;
}

// Agenda as OS em lote (tudo ou nada). Se alguma OS já estava em outro lote, sai dele (a parte dela é redividida).
export async function dbScheduleLot(input: ScheduleLotInput): Promise<PlanningLot> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const db = dbInstance;
  const now = new Date().toISOString();
  const lotRef = doc(collection(db, 'planningLots'));
  const lot: PlanningLot = {
    id: lotRef.id,
    unit: input.unit,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    technicianName: input.technician.name,
    technicianMatricula: input.technician.matricula,
    orderIds: input.orders.map((o) => o.id),
    overnight: input.overnight && input.overnight.people > 0 && input.overnight.nights > 0 ? input.overnight : null,
    createdAt: now,
    createdBy: input.createdBy,
    updatedAt: now
  };
  const batch = writeBatch(db);
  batch.set(lotRef, cleanUndefined(lot));
  for (const o of input.orders) {
    if (o.lotId) batch.set(doc(db, 'planningLots', o.lotId), { orderIds: arrayRemove(o.id), updatedAt: now }, { merge: true });
    batch.update(doc(db, 'serviceOrders', o.id), {
      status: 'Planejada',
      scheduledDate: input.periodStart,
      scheduledEndDate: input.periodEnd > input.periodStart ? input.periodEnd : deleteField(),
      assignedTechnician: input.technician.name,
      assignedTechnicianMatricula: input.technician.matricula,
      lotId: lotRef.id,
      updatedAt: now,
      syncAt: serverTimestamp()
    });
  }
  await batch.commit();
  return lot;
}

// Tira a OS do lote (remarcada sozinha ou devolvida para "Novo"): a parte do pernoite é redividida entre as que ficam
export async function dbDetachOrderFromLot(order: ServiceOrder): Promise<void> {
  if (!firebaseActive || !dbInstance || !order.lotId) return;
  const now = new Date().toISOString();
  const batch = writeBatch(dbInstance);
  batch.set(doc(dbInstance, 'planningLots', order.lotId), { orderIds: arrayRemove(order.id), updatedAt: now }, { merge: true });
  batch.update(doc(dbInstance, 'serviceOrders', order.id), { lotId: deleteField(), updatedAt: now, syncAt: serverTimestamp() });
  await batch.commit();
}
