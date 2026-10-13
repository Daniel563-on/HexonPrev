import { arrayUnion, collection, deleteDoc, deleteField, doc, getDoc, getDocs, query, setDoc, where } from './guard';
import { Absence, DayMarkKind, OrderParticipant, WeekPlan, WorkOrder } from '../types';
import { firebaseActive, dbInstance, cleanUndefined } from './core';
import { dbGetUsualTeam } from './executionTeam';

// PROGRAMAÇÃO › SEMANA (Fase 7B): dias marcados e equipe da semana (coleção "weekPlans", 1 registro por
// gerência + empresa + semana), ausências (coleção "absences", por pessoa e datas) e os chamados em aberto da gerência.
// Só quem tem "Programar" grava (regra do banco). Nada aqui altera OS ou preventiva.

export const weekPlanId = (unit: string, company: string, weekStart: string) => `${unit}__${company}__${weekStart}`;

// A semana (1 leitura)
export async function dbGetWeekPlan(unit: string, company: string, weekStart: string): Promise<WeekPlan | null> {
  if (!firebaseActive || !dbInstance || !unit || !company) return null;
  const snap = await getDoc(doc(dbInstance, 'weekPlans', weekPlanId(unit, company, weekStart)));
  return snap.exists() ? (snap.data() as WeekPlan) : null;
}

// Grava só o que mudou (null = apagar): dois planejadores mexendo na mesma semana não apagam o que o outro fez
export async function dbPatchWeekPlan(
  key: { unit: string; company: string; weekStart: string },
  by: string,
  change: { days?: Record<string, { kind: DayMarkKind; text: string } | null>; teams?: Record<string, OrderParticipant[] | null> },
  logText?: string // linha no histórico da semana (Fase 7C)
): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const del = <T>(o: Record<string, T | null>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === null ? deleteField() : v]));
  const now = new Date().toISOString();
  const data: Record<string, unknown> = { ...key, updatedAt: now, updatedBy: by };
  if (change.days) data.days = del(change.days);
  if (change.teams) data.teams = del(change.teams);
  if (logText) data.log = arrayUnion({ at: now, by, text: logText.slice(0, 300) });
  await setDoc(doc(dbInstance, 'weekPlans', weekPlanId(key.unit, key.company, key.weekStart)), data, { merge: true });
}

// Ausências da gerência que ainda valem a partir de um dia (as que terminam antes não vêm)
export async function dbListAbsences(unit: string, fromDay: string): Promise<Absence[]> {
  if (!firebaseActive || !dbInstance || !unit) return [];
  const snap = await getDocs(query(collection(dbInstance, 'absences'), where('unit', '==', unit), where('to', '>=', fromDay)));
  return snap.docs.map((d) => ({ ...(d.data() as Absence), id: d.id }));
}

export async function dbSaveAbsence(a: Absence): Promise<Absence> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const ref = a.id ? doc(dbInstance, 'absences', a.id) : doc(collection(dbInstance, 'absences'));
  const { id: _id, ...data } = a;
  await setDoc(ref, cleanUndefined(data));
  return { ...a, id: ref.id };
}

export async function dbDeleteAbsence(id: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  await deleteDoc(doc(dbInstance, 'absences', id));
}

// Chamados em andamento ou pendentes da gerência (com quem está cada um): lidos 1 vez ao abrir a semana
export async function dbListOpenWorkOrders(unit: string): Promise<WorkOrder[]> {
  if (!firebaseActive || !dbInstance || !unit) return [];
  const snap = await getDocs(query(collection(dbInstance, 'workOrders'), where('unit', '==', unit), where('status', 'in', ['Em andamento', 'Pendente'])));
  return snap.docs.map((d) => ({ ...(d.data() as WorkOrder), id: d.id }));
}

// EQUIPE NA EXECUÇÃO (Fase 7C): quem vai junto com o responsável num dia = equipe desta semana na Programação
// (ou a equipe cadastrada), sem quem está de férias/atestado nesse dia. Sem resposta do banco em poucos segundos
// (ex.: sem internet), fica a equipe cadastrada — o técnico continua podendo tirar ou pôr gente na OS.
const within = <T>(p: Promise<T>, ms = 4000) => Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('tempo esgotado')), ms))]);
const mondayOfDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  const x = new Date(y, m - 1, d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
export async function dbGetDayTeam(unit: string | undefined, company: string | undefined, day: string, matricula: string): Promise<OrderParticipant[]> {
  const usual = await dbGetUsualTeam(matricula).catch(() => null);
  let members: OrderParticipant[] = usual?.members || [];
  if (!firebaseActive || !dbInstance || !unit || !company) return members;
  try {
    const plan = await within(dbGetWeekPlan(unit, company, mondayOfDay(day)));
    if (plan?.teams?.[matricula]) members = plan.teams[matricula];
  } catch {
    /* fica a equipe cadastrada */
  }
  try {
    const off = await within(dbListAbsences(unit, day));
    const absent = new Set(off.filter((a) => a.from <= day && a.to >= day).map((a) => a.matricula));
    members = members.filter((m) => !absent.has(m.matricula));
  } catch {
    /* sem a lista de ausentes: fica como está */
  }
  return members.filter((m) => m.matricula !== matricula);
}
