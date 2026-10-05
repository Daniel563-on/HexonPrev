import { collection, doc, getDocs, setDoc } from './guard';
import { JobRole, OvertimeDayKey, OvertimeDayRule, OvertimeRules } from '../types';
import { firebaseActive, dbInstance, cleanUndefined, checkQuotaException } from './core';
import { valueAt } from './manHours';
import { clearWorkforceCache } from './workforce';

// HORA EXTRA (Hexon 2.0): regras por cargo (coleção "overtimeRules") e tarifas em R$ (no cargo, "jobRoles").
// O técnico lança por dia (data, horas, feriado); o tipo do dia sai da data: seg–sex, sábado, domingo/feriado.

export const OVERTIME_DAYS: { key: OvertimeDayKey; label: string }[] = [
  { key: 'seg', label: 'Segunda-feira' },
  { key: 'ter', label: 'Terça-feira' },
  { key: 'qua', label: 'Quarta-feira' },
  { key: 'qui', label: 'Quinta-feira' },
  { key: 'sex', label: 'Sexta-feira' },
  { key: 'sab', label: 'Sábado' },
  { key: 'dom', label: 'Domingo / feriado' }
];

// Ponto de partida do formulário (só vale depois que o Super Administrador salvar)
export function blankOvertimeDays(): Record<OvertimeDayKey, OvertimeDayRule> {
  const weekday: OvertimeDayRule = { firstHours: 1, firstPct: 50, restPct: 100, maxHours: null };
  return {
    seg: { ...weekday },
    ter: { ...weekday },
    qua: { ...weekday },
    qui: { ...weekday },
    sex: { ...weekday },
    sab: { firstHours: 0, firstPct: 0, restPct: 100, maxHours: null },
    dom: { firstHours: 0, firstPct: 0, restPct: 100, maxHours: null }
  };
}

// Tipo do dia de um lançamento ("AAAA-MM-DD"); feriado conta como domingo
export function overtimeDayKey(dateStr: string, holiday: boolean): OvertimeDayKey {
  if (holiday) return 'dom';
  const [y, m, d] = dateStr.split('-').map(Number);
  const wd = new Date(y, (m || 1) - 1, d || 1).getDay();
  return (['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as OvertimeDayKey[])[wd];
}

// Divide as horas de um dia pela regra: [{pct, hours}] pagas e o excesso acima do máximo (não pago)
export function splitOvertime(rule: OvertimeDayRule, hours: number): { parts: { pct: number; hours: number }[]; excess: number } {
  const h = Math.max(0, hours);
  const paid = rule.maxHours !== null && rule.maxHours !== undefined ? Math.min(h, Math.max(0, rule.maxHours)) : h;
  const first = Math.min(paid, Math.max(0, rule.firstHours));
  const parts: { pct: number; hours: number }[] = [];
  if (first > 0) parts.push({ pct: rule.firstPct, hours: first });
  if (paid - first > 0) parts.push({ pct: rule.restPct, hours: paid - first });
  return { parts, excess: Math.round((h - paid) * 1000) / 1000 };
}

// R$ de 1 hora extra a "pct"% para o cargo, na data: tarifa própria ou valor da hora vigente × (1 + %)
export function overtimeHourValue(role: JobRole, pct: number, dateStr: string): number | null {
  const own = role.overtimeTariffs?.[String(pct)];
  if (typeof own === 'number' && own > 0) return own;
  const base = valueAt(role.history, dateStr) ?? (role.hourlyRate || null);
  return base ? Math.round(base * (1 + pct / 100) * 100) / 100 : null;
}

// Percentuais usados nas regras (para as tarifas próprias)
export function overtimePercents(rules: OvertimeRules | null | undefined): number[] {
  if (!rules) return [];
  const set = new Set<number>();
  Object.values(rules.days).forEach((r) => {
    if (r.firstHours > 0 && r.firstPct > 0) set.add(r.firstPct);
    if (r.restPct > 0) set.add(r.restPct);
  });
  return Array.from(set).sort((a, b) => a - b);
}

let cacheRules: OvertimeRules[] | null = null;

export async function dbGetOvertimeRules(force = false): Promise<OvertimeRules[]> {
  if (cacheRules && !force) return [...cacheRules];
  if (!firebaseActive || !dbInstance) return [];
  try {
    const snap = await getDocs(collection(dbInstance, 'overtimeRules'));
    cacheRules = snap.docs.map((d) => ({ ...(d.data() as OvertimeRules), id: d.id }));
    return [...cacheRules];
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}

export async function dbSaveOvertimeRules(rules: OvertimeRules): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  await setDoc(doc(dbInstance, 'overtimeRules', rules.id), cleanUndefined(rules));
  cacheRules = null;
}

// Tarifas próprias de hora extra do cargo (R$ por percentual); vazio = cálculo automático
export async function dbSetJobRoleOvertimeTariffs(role: JobRole, tariffs: Record<string, number>): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const updated: JobRole = { ...role, overtimeTariffs: tariffs, updatedAt: new Date().toISOString() };
  await setDoc(doc(dbInstance, 'jobRoles', role.id), cleanUndefined(updated));
  clearWorkforceCache();
}
