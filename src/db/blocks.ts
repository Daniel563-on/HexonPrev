import { arrayRemove, arrayUnion, collection, deleteField, doc, getDocs, query, serverTimestamp, setDoc, where, writeBatch } from './guard';
import { PlanningLot, ServiceOrder, WeekLogEntry, WeekVisit } from '../types';
import { firebaseActive, dbInstance, cleanUndefined } from './core';
import { timelineEvent } from './executionTeam';
import { orderControlUpdate } from './orderControl';
import { weekPlanId } from './weekPlans';

// PROGRAMAÇÃO › BLOCOS (Fase 7C-1): o bloco da grade é um lote de planejamento ("planningLots", o mesmo do PMOC)
// com equipe, local, dias, noites fora e observação. Salvar faz com as preventivas o mesmo que o lote do PMOC
// (Planejada, técnico e dias); tirar uma preventiva do bloco a devolve para "Novo". Tudo num pacote só (tudo ou nada),
// com uma linha no histórico da semana (weekPlans.log).

export type WeekKey = { unit: string; company: string; weekStart: string };

const MAX_BATCH_OPS = 500;
const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number);
  const x = new Date(y, m - 1, d + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const logEntry = (by: string, text: string): WeekLogEntry => ({ at: new Date().toISOString(), by, text: text.slice(0, 300) });
const weekRef = (key: WeekKey) => doc(dbInstance!, 'weekPlans', weekPlanId(key.unit, key.company, key.weekStart));
const logData = (key: WeekKey, by: string, text: string, now: string) => ({ ...key, updatedAt: now, updatedBy: by, log: arrayUnion(logEntry(by, text)) });

// Blocos e lotes que cruzam a semana (os lotes começam no máximo 5 semanas antes): 1 busca
export async function dbListWeekLots(unit: string, weekStart: string): Promise<PlanningLot[]> {
  if (!firebaseActive || !dbInstance || !unit) return [];
  const weekEnd = addDays(weekStart, 6);
  const snap = await getDocs(
    query(collection(dbInstance, 'planningLots'), where('unit', '==', unit), where('periodStart', '>=', addDays(weekStart, -35)), where('periodStart', '<=', weekEnd))
  );
  return snap.docs.map((d) => ({ ...(d.data() as PlanningLot), id: d.id })).filter((l) => l.periodEnd >= weekStart && !l.removedAt);
}

// Preventiva programada no bloco (mesmos campos do lote do PMOC) ou devolvida para "Novo"
function plannedFields(o: ServiceOrder, s: string, e: string, tech: { name: string; matricula: string }, lotId: string, now: string, by: string, note: string) {
  return {
    status: 'Planejada',
    scheduledDate: s,
    scheduledEndDate: e > s ? e : deleteField(),
    assignedTechnician: tech.name,
    assignedTechnicianMatricula: tech.matricula,
    lotId,
    updatedAt: now,
    syncAt: serverTimestamp(),
    ...orderControlUpdate({ ...o, status: 'Planejada', scheduledDate: s, scheduledEndDate: e > s ? e : undefined, assignedTechnicianMatricula: tech.matricula, updatedAt: now }),
    timeline: arrayUnion(timelineEvent('Programada', by, note))
  };
}
function revertFields(o: ServiceOrder, now: string, by: string, note: string) {
  return {
    status: 'Novo',
    scheduledDate: '',
    scheduledEndDate: deleteField(),
    assignedTechnician: '',
    assignedTechnicianMatricula: deleteField(),
    lotId: deleteField(),
    updatedAt: now,
    syncAt: serverTimestamp(),
    ...orderControlUpdate({ ...o, status: 'Novo', scheduledDate: '', scheduledEndDate: undefined, assignedTechnicianMatricula: undefined, updatedAt: now }),
    timeline: arrayUnion(timelineEvent('Voltou para Novo', by, note))
  };
}

export interface BlockSave {
  lot: PlanningLot | null; // bloco existente (null = novo)
  key: WeekKey;
  technician: { name: string; matricula: string };
  periodStart: string;
  periodEnd: string;
  local: { comarca: string; address: string };
  pdfText: string;
  note: string;
  nights: string[];
  people: number;
  plan: ServiceOrder[]; // marcadas que podem mudar (novas ou já no bloco): ficam Planejadas com os dias do bloco
  fixedIds: string[]; // já no bloco e em execução/concluídas (ou fora da cópia do aparelho): continuam no bloco, sem mudar
  drop: ServiceOrder[]; // estavam no bloco e foram desmarcadas: voltam para "Novo"
  by: string;
  logText: string;
}

export async function dbSaveBlock(input: BlockSave): Promise<PlanningLot> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const db = dbInstance;
  const now = new Date().toISOString();
  const lotRef = input.lot ? doc(db, 'planningLots', input.lot.id) : doc(collection(db, 'planningLots'));
  const { periodStart: s, periodEnd: e, technician: tech } = input;
  const changed = input.plan.filter(
    (o) =>
      o.lotId !== lotRef.id ||
      o.assignedTechnicianMatricula !== tech.matricula ||
      (o.scheduledDate || '').slice(0, 10) !== s ||
      (o.scheduledEndDate || o.scheduledDate || '').slice(0, 10) !== e ||
      !['Planejada', 'Atrasada'].includes(o.status)
  );
  const moving = changed.filter((o) => o.lotId && o.lotId !== lotRef.id);
  const ops = 2 + changed.length + input.drop.length + moving.length;
  if (ops > MAX_BATCH_OPS) throw new Error(`Muitas preventivas de uma vez (${changed.length + input.drop.length}). Divida em blocos menores.`);

  const overnight = input.nights.length > 0 && input.people > 0 ? { people: input.people, nights: input.nights.length } : null;
  const lot: PlanningLot = {
    ...(input.lot || { id: lotRef.id, createdAt: now, createdBy: input.by }),
    id: lotRef.id,
    unit: input.key.unit,
    company: input.key.company,
    periodStart: s,
    periodEnd: e,
    technicianName: tech.name,
    technicianMatricula: tech.matricula,
    orderIds: Array.from(new Set([...input.plan.map((o) => o.id), ...input.fixedIds])),
    overnight,
    updatedAt: now,
    updatedBy: input.by,
    source: 'programacao',
    weekStart: input.key.weekStart,
    local: input.local,
    pdfText: input.pdfText.trim().slice(0, 80),
    note: input.note.trim().slice(0, 300),
    nights: input.nights
  };
  const batch = writeBatch(db);
  batch.set(lotRef, cleanUndefined(lot));
  const where_ = `${input.local.comarca}${input.local.address ? ` · ${input.local.address}` : ''}`;
  const note = `${tech.name} • ${s}${e > s ? ` a ${e}` : ''} • ${where_} (Programação)`;
  for (const o of moving) batch.set(doc(db, 'planningLots', o.lotId!), { orderIds: arrayRemove(o.id), updatedAt: now }, { merge: true });
  for (const o of changed) batch.update(doc(db, 'serviceOrders', o.id), plannedFields(o, s, e, tech, lotRef.id, now, input.by, note));
  for (const o of input.drop) batch.update(doc(db, 'serviceOrders', o.id), revertFields(o, now, input.by, `Saiu do bloco ${where_} (Programação)`));
  batch.set(weekRef(input.key), logData(input.key, input.by, input.logText, now), { merge: true });
  await batch.commit();
  return lot;
}

// Tirar o bloco: as preventivas que ainda não começaram voltam para "Novo"; o lote fica marcado como tirado
export async function dbRemoveBlock(lot: PlanningLot, drop: ServiceOrder[], key: WeekKey, by: string, logText: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  if (drop.length + 2 > MAX_BATCH_OPS) throw new Error('Muitas preventivas no bloco para tirar de uma vez.');
  const db = dbInstance;
  const now = new Date().toISOString();
  const where_ = lot.local ? `${lot.local.comarca}${lot.local.address ? ` · ${lot.local.address}` : ''}` : 'bloco';
  const batch = writeBatch(db);
  batch.set(doc(db, 'planningLots', lot.id), { orderIds: [], overnight: null, nights: [], removedAt: now, updatedAt: now, updatedBy: by }, { merge: true });
  for (const o of drop) batch.update(doc(db, 'serviceOrders', o.id), revertFields(o, now, by, `Bloco ${where_} tirado da Programação`));
  batch.set(weekRef(key), logData(key, by, logText, now), { merge: true });
  await batch.commit();
}

// Acompanhar um bloco de outra equipe (ex.: Engenharia) ou deixar de acompanhar (null). Não muda nenhuma OS.
export async function dbSetWeekVisit(key: WeekKey, by: string, id: string, visit: WeekVisit | null, logText: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const now = new Date().toISOString();
  await setDoc(weekRef(key), { ...logData(key, by, logText, now), visits: { [id]: visit === null ? deleteField() : visit } }, { merge: true });
}

// Linha no histórico da semana (mudanças feitas fora dos blocos: equipe da semana, dias marcados, ausências)
export async function dbAddWeekLog(key: WeekKey, by: string, text: string): Promise<void> {
  if (!firebaseActive || !dbInstance) return;
  await setDoc(weekRef(key), logData(key, by, text, new Date().toISOString()), { merge: true });
}
