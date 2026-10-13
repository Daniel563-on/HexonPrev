import { arrayRemove, arrayUnion, collection, deleteField, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where, writeBatch } from './guard';
import { BlockStop, PlanningLot, ServiceOrder, WeekLogEntry, WeekVisit, WorkOrder } from '../types';
import { firebaseActive, dbInstance, cleanUndefined } from './core';
import { timelineEvent } from './executionTeam';
import { orderControlUpdate } from './orderControl';
import { weekPlanId } from './weekPlans';

// PROGRAMAÇÃO › BLOCOS (Fase 7C-1): o bloco da grade é um lote de planejamento ("planningLots", o mesmo do PMOC)
// com equipe, local, dias, noites fora e observação. Salvar faz com as preventivas o mesmo que o lote do PMOC
// (Planejada, técnico e dias); tirar uma preventiva do bloco a devolve para "Novo". Tudo num pacote só (tudo ou nada),
// com uma linha no histórico da semana (weekPlans.log).
// Fase 7C-2: chamados GLPI no bloco — ganham o técnico (Nova → Em andamento) e o dia programado; tirado do bloco,
// o chamado perde o dia e continua com o técnico (resposta do usuário em 13/10/2026).
// Fase 7C-3: bloco com vários locais (roteiro) — cada local tem os seus dias seguidos dentro do bloco; a preventiva
// fica programada nos dias do seu local e o chamado nos dias do local da sua comarca. Pernoite continua por viagem.

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
const stopLabel = (st: { comarca: string; address: string }) => `${st.comarca}${st.address ? ` · ${st.address}` : ''}`;
const blockLabel = (stops: { comarca: string; address: string }[]) =>
  stops.length === 0 ? 'bloco' : stops.length === 1 ? stopLabel(stops[0]) : `${stopLabel(stops[0])} e mais ${stops.length - 1} local(is)`;

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

// Chamado no bloco: técnico do bloco (se ainda não for dele) + dia programado + bloco; ou só perde o dia
function woPlanFields(w: WorkOrder, s: string, e: string, tech: { name: string; matricula: string }, lotId: string, now: string, by: string, where_: string) {
  const newTech = w.assignedTechnicianMatricula !== tech.matricula;
  const action = w.status === 'Nova' ? `Atribuída a ${tech.name} (${tech.matricula}) pela Programação` : newTech ? `Técnico trocado pela Programação: ${w.assignedTechnicianName || '—'} → ${tech.name} (${tech.matricula})` : 'Dia programado pela Programação';
  return {
    status: w.status === 'Nova' ? 'Em andamento' : w.status,
    ...(newTech ? { assignedTechnicianMatricula: tech.matricula, assignedTechnicianName: tech.name, techOpen: tech.matricula } : {}),
    ...(w.status === 'Nova' ? { assignedAt: serverTimestamp() } : {}),
    scheduledDate: s,
    scheduledEndDate: e > s ? e : deleteField(),
    lotId,
    updatedAt: now,
    timeline: arrayUnion(cleanUndefined({ at: now, by, action, note: `${s}${e > s ? ` a ${e}` : ''} • ${where_}` }))
  };
}
function woDropFields(now: string, by: string, note: string) {
  return {
    scheduledDate: deleteField(),
    scheduledEndDate: deleteField(),
    lotId: deleteField(),
    updatedAt: now,
    timeline: arrayUnion({ at: now, by, action: 'Saiu do bloco da Programação (perdeu o dia; continua com o técnico)', note })
  };
}

export async function dbGetLot(id: string): Promise<PlanningLot | null> {
  if (!firebaseActive || !dbInstance || !id) return null;
  const snap = await getDoc(doc(dbInstance, 'planningLots', id));
  return snap.exists() ? ({ ...(snap.data() as PlanningLot), id: snap.id }) : null;
}

// Preventiva ou chamado marcado no bloco, com os dias do seu local
export interface BlockPlanItem<T> {
  item: T;
  s: string;
  e: string;
  where: string;
}

export interface BlockSave {
  lot: PlanningLot | null; // bloco existente (null = novo)
  key: WeekKey;
  technician: { name: string; matricula: string };
  periodStart: string;
  periodEnd: string;
  stops: BlockStop[]; // locais do bloco, com os dias de cada um (Fase 7C-3)
  note: string;
  nights: string[];
  people: number;
  plan: BlockPlanItem<ServiceOrder>[]; // marcadas que podem mudar (novas ou já no bloco): ficam Planejadas nos dias do seu local
  fixedIds: string[]; // já no bloco e em execução/concluídas (ou fora da cópia do aparelho): continuam no bloco, sem mudar
  drop: ServiceOrder[]; // estavam no bloco e foram desmarcadas (ou o local saiu): voltam para "Novo"
  woPlan: BlockPlanItem<WorkOrder>[]; // chamados marcados: ficam com o técnico do bloco e com os dias do local da comarca
  woFixedIds: string[]; // chamados do bloco já fora da lista de abertos (concluídos etc.): continuam no bloco
  woDrop: WorkOrder[]; // chamados desmarcados: perdem o dia e continuam com o técnico
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
    ({ item: o, s: os, e: oe }) =>
      o.lotId !== lotRef.id ||
      o.assignedTechnicianMatricula !== tech.matricula ||
      (o.scheduledDate || '').slice(0, 10) !== os ||
      (o.scheduledEndDate || o.scheduledDate || '').slice(0, 10) !== oe ||
      !['Planejada', 'Atrasada'].includes(o.status)
  );
  const moving = changed.map((p) => p.item).filter((o) => o.lotId && o.lotId !== lotRef.id);
  const woChanged = input.woPlan.filter(
    ({ item: w, s: ws, e: we }) =>
      w.lotId !== lotRef.id || w.assignedTechnicianMatricula !== tech.matricula || w.status === 'Nova' || (w.scheduledDate || '') !== ws || (w.scheduledEndDate || w.scheduledDate || '') !== we
  );
  const woMoving = woChanged.map((p) => p.item).filter((w) => w.lotId && w.lotId !== lotRef.id);
  const ops = 2 + changed.length + input.drop.length + moving.length + woChanged.length + woMoving.length + input.woDrop.length;
  if (ops > MAX_BATCH_OPS) throw new Error(`Muitas OS de uma vez (${changed.length + input.drop.length + woChanged.length + input.woDrop.length}). Divida em blocos menores.`);

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
    orderIds: Array.from(new Set([...input.plan.map((p) => p.item.id), ...input.fixedIds])),
    woIds: Array.from(new Set([...input.woPlan.map((p) => p.item.id), ...input.woFixedIds])),
    overnight,
    updatedAt: now,
    updatedBy: input.by,
    source: 'programacao',
    weekStart: input.key.weekStart,
    local: input.stops[0] ? { comarca: input.stops[0].comarca, address: input.stops[0].address } : undefined,
    pdfText: (input.stops[0]?.pdfText || '').trim().slice(0, 80),
    stops: input.stops.map((st) => ({ comarca: st.comarca, address: st.address, from: st.from, to: st.to, pdfText: (st.pdfText || '').trim().slice(0, 80) })),
    note: input.note.trim().slice(0, 300),
    nights: input.nights
  };
  const batch = writeBatch(db);
  batch.set(lotRef, cleanUndefined(lot));
  const where_ = blockLabel(input.stops);
  for (const o of moving) batch.set(doc(db, 'planningLots', o.lotId!), { orderIds: arrayRemove(o.id), updatedAt: now }, { merge: true });
  for (const p of changed)
    batch.update(doc(db, 'serviceOrders', p.item.id), plannedFields(p.item, p.s, p.e, tech, lotRef.id, now, input.by, `${tech.name} • ${p.s}${p.e > p.s ? ` a ${p.e}` : ''} • ${p.where} (Programação)`));
  for (const o of input.drop) batch.update(doc(db, 'serviceOrders', o.id), revertFields(o, now, input.by, `Saiu do bloco ${where_} (Programação)`));
  for (const w of woMoving) batch.set(doc(db, 'planningLots', w.lotId!), { woIds: arrayRemove(w.id), updatedAt: now }, { merge: true });
  for (const p of woChanged) batch.update(doc(db, 'workOrders', p.item.id), woPlanFields(p.item, p.s, p.e, tech, lotRef.id, now, input.by, p.where));
  for (const w of input.woDrop) batch.update(doc(db, 'workOrders', w.id), woDropFields(now, input.by, where_));
  batch.set(weekRef(input.key), logData(input.key, input.by, input.logText, now), { merge: true });
  await batch.commit();
  return lot;
}

// Tirar o bloco: as preventivas que ainda não começaram voltam para "Novo"; os chamados perdem o dia (continuam com
// o técnico); o lote fica marcado como tirado
export async function dbRemoveBlock(lot: PlanningLot, drop: ServiceOrder[], key: WeekKey, by: string, logText: string, woDrop: WorkOrder[] = []): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  if (drop.length + woDrop.length + 2 > MAX_BATCH_OPS) throw new Error('Muitas OS no bloco para tirar de uma vez.');
  const db = dbInstance;
  const now = new Date().toISOString();
  const where_ = blockLabel(lot.stops?.length ? lot.stops : lot.local ? [lot.local] : []);
  const batch = writeBatch(db);
  batch.set(doc(db, 'planningLots', lot.id), { orderIds: [], woIds: [], overnight: null, nights: [], removedAt: now, updatedAt: now, updatedBy: by }, { merge: true });
  for (const o of drop) batch.update(doc(db, 'serviceOrders', o.id), revertFields(o, now, by, `Bloco ${where_} tirado da Programação`));
  for (const w of woDrop) batch.update(doc(db, 'workOrders', w.id), woDropFields(now, by, where_));
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
