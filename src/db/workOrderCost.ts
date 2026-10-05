import { JobRole, Material, OrderParticipant, OvertimeRules, WorkOrder, WorkOrderOvertimeDay, WorkOrderPause } from '../types';
import { brl, fmtMinutes, localDate, toMillis, valueAt } from './manHours';
import type { OrderCostLine } from './manHours';
import { cargoKey, dbGetJobRoles } from './workforce';
import { dbGetMaterials } from './materials';
import { dbGetOvernightRate } from './planning';
import { dbGetOvertimeRules, overtimeDayKey, overtimeHourValue, splitOvertime, OVERTIME_DAYS } from './overtime';

// HOMEM-HORA E CUSTO DA OS (Hexon 2.0, igual ao principal com o almoço descontado):
// conta desde a atribuição até a assinatura do técnico, só seg–sex, 08:00–12:00 e 13:00–18:00 (hora do aparelho),
// sem as pausas (Pendente) e sem os dias marcados como feriado. Menos de 1 h cobra 1 h; acima, proporcional.
// Cada colaborador da OS: horas cobradas × valor do cargo. Hora extra e pernoite valem para todos da OS.

const WINDOWS: [number, number][] = [
  [8 * 60, 12 * 60],
  [13 * 60, 18 * 60]
];
const pad = (n: number) => String(n).padStart(2, '0');
const dayStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Minutos que contam entre o início e o fim (pausas e feriados fora)
export function osWorkMinutes(startMs: number, endMs: number, pauses: WorkOrderPause[] = [], holidays: string[] = []): number {
  if (!(endMs > startMs)) return 0;
  const hol = new Set(holidays);
  const paused = pauses
    .map((p) => [toMillis(p.start) || 0, p.end ? toMillis(p.end) || endMs : endMs] as [number, number])
    .filter(([a, b]) => b > a);
  let total = 0;
  const day = new Date(startMs);
  day.setHours(0, 0, 0, 0);
  for (let guard = 0; day.getTime() <= endMs && guard < 3700; guard++) {
    const wd = day.getDay();
    if (wd !== 0 && wd !== 6 && !hol.has(dayStr(day))) {
      for (const [from, to] of WINDOWS) {
        const a = Math.max(startMs, day.getTime() + from * 60000);
        const b = Math.min(endMs, day.getTime() + to * 60000);
        if (b <= a) continue;
        // tira as pausas que caem dentro da janela
        let ms = b - a;
        for (const [pa, pb] of paused) {
          const x = Math.max(a, pa);
          const y = Math.min(b, pb);
          if (y > x) ms -= y - x;
        }
        total += Math.max(0, ms);
      }
    }
    day.setDate(day.getDate() + 1);
  }
  return Math.round(total / 60000);
}

// Feriados da OS: dias de hora extra marcados como feriado (o homem-hora não conta nesses dias)
export const osHolidays = (o: WorkOrder): string[] =>
  Array.from(new Set([...(o.exec?.holidays || []), ...(o.exec?.overtime || []).filter((d) => d.holiday && d.date).map((d) => d.date)]));

// Menos de 1 h cobra 1 h; acima disso, proporcional
export const osBilledHours = (minutes: number) => (minutes < 60 ? 1 : Math.round((minutes / 60) * 100) / 100);

// Colaboradores da OS: os que o técnico lançou; antes disso, só o técnico atribuído
export function osMembers(o: WorkOrder): OrderParticipant[] {
  const team = o.exec?.team || [];
  if (team.length) return team;
  return o.assignedTechnicianMatricula ? [{ matricula: o.assignedTechnicianMatricula, name: o.assignedTechnicianName || '', cargo: '' }] : [];
}

// Avisos de máximo de hora extra (o técnico vê no celular; a equipe lê as regras, sem valores)
export function overtimeWarnings(days: WorkOrderOvertimeDay[], team: OrderParticipant[], rules: OvertimeRules[]): string[] {
  const byCargo = new Map(rules.map((r) => [cargoKey(r.roleName), r]));
  const out: string[] = [];
  days.forEach((d) => {
    if (!d.date || !(d.minutes > 0)) return;
    const key = overtimeDayKey(d.date, d.holiday);
    const label = OVERTIME_DAYS.find((x) => x.key === key)?.label || key;
    const seen = new Set<string>();
    team.forEach((p) => {
      const r = byCargo.get(cargoKey(p.cargo));
      const max = r?.days[key]?.maxHours;
      if (max === null || max === undefined || seen.has(p.cargo)) return;
      if (d.minutes / 60 > max) {
        seen.add(p.cargo);
        out.push(`${d.date.split('-').reverse().join('/')} (${label}): acima do máximo de ${String(max).replace('.', ',')} h para o cargo ${p.cargo}. O excesso não é pago.`);
      }
    });
  });
  return out;
}

export interface WorkOrderCost {
  minutes: number;           // minutos que contaram
  billedHours: number;       // horas cobradas por pessoa
  partial: boolean;          // ainda sem a assinatura do técnico (conta até agora)
  labor: OrderCostLine[];
  overtime: OrderCostLine[];
  overnight: OrderCostLine | null;
  materials: OrderCostLine[];
  total: number;
  missing: number;           // linhas sem valor (cargo sem valor, sem regra...)
  warnings: string[];        // excesso de hora extra
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Custo da OS para quem pode ver valores. endIso = assinatura do técnico (sem ela, conta até agora)
export async function dbGetWorkOrderCost(o: WorkOrder, endIso?: string): Promise<WorkOrderCost> {
  const startMs = toMillis(o.assignedAt);
  const endMs = endIso ? toMillis(endIso) || Date.now() : o.status === 'Cancelada' && o.cancelledAt ? toMillis(o.cancelledAt) || Date.now() : Date.now();
  const date = localDate(new Date(endMs).toISOString());
  const exec = o.exec;
  const members = osMembers(o);
  const [roles, rules, mats, overnightRate] = await Promise.all([
    dbGetJobRoles(),
    exec?.overtime?.length ? dbGetOvertimeRules() : Promise.resolve([] as OvertimeRules[]),
    (exec?.materials || []).length ? dbGetMaterials([o.unit]) : Promise.resolve([] as Material[]),
    exec?.overnightNights ? dbGetOvernightRate() : Promise.resolve(null)
  ]);
  const roleByKey = new Map<string, JobRole>(roles.map((r) => [cargoKey(r.name), r]));
  const ruleById = new Map(rules.map((r) => [r.id, r]));

  const minutes = startMs ? osWorkMinutes(startMs, endMs, o.pauses || [], osHolidays(o)) : 0;
  const billed = startMs ? osBilledHours(minutes) : 0;

  const labor: OrderCostLine[] = members.map((p) => {
    const role = roleByKey.get(cargoKey(p.cargo));
    const rate = role ? valueAt(role.history, date) : null;
    return {
      label: `${p.name}${p.cargo ? ` (${p.cargo})` : ''}`,
      detail: !startMs ? 'OS ainda não atribuída' : rate ? `${fmtMinutes(minutes)} → ${String(billed).replace('.', ',')} h × ${brl(rate)}/h` : p.cargo ? 'cargo sem valor cadastrado' : 'pessoa sem cargo',
      value: startMs && rate ? round2(billed * rate) : startMs ? null : 0
    };
  });

  const overtime: OrderCostLine[] = [];
  const warnings: string[] = [];
  (exec?.overtime || []).forEach((d) => {
    if (!d.date || !(d.minutes > 0)) return;
    const key = overtimeDayKey(d.date, d.holiday);
    const dayLabel = `${d.date.split('-').reverse().join('/')} ${OVERTIME_DAYS.find((x) => x.key === key)?.label || ''}`;
    members.forEach((p) => {
      const role = roleByKey.get(cargoKey(p.cargo));
      const rule = role ? ruleById.get(role.id) : undefined;
      if (!role || !rule) {
        overtime.push({ label: `${dayLabel} · ${p.name}`, detail: !role ? 'cargo sem valor cadastrado' : 'regras de hora extra do cargo não configuradas', value: null });
        return;
      }
      const { parts, excess } = splitOvertime(rule.days[key], d.minutes / 60);
      let value = 0;
      let missing = false;
      const desc = parts.map((pt) => {
        const v = overtimeHourValue(role, pt.pct, d.date);
        if (v === null) missing = true;
        else value += pt.hours * v;
        return `${String(round2(pt.hours)).replace('.', ',')} h a +${pt.pct}%${v !== null ? ` (${brl(v)}/h)` : ''}`;
      });
      if (excess > 0) warnings.push(`${dayLabel}: ${p.name} passou ${String(excess).replace('.', ',')} h do máximo do cargo (não pago).`);
      overtime.push({ label: `${dayLabel} · ${p.name}`, detail: desc.join(' + ') || '—', value: missing ? null : round2(value) });
    });
  });

  let overnight: OrderCostLine | null = null;
  if (exec?.overnightNights) {
    const rate = overnightRate ? valueAt(overnightRate.history, date) ?? overnightRate.value : null;
    overnight = {
      label: 'Pernoite',
      detail: rate ? `${exec.overnightNights} diária(s) × ${brl(rate)} × ${members.length} colaborador(es)` : 'valor do pernoite não informado',
      value: rate ? round2(exec.overnightNights * rate * members.length) : null
    };
  }

  const matById = new Map(mats.map((m) => [m.id, m]));
  const materials: OrderCostLine[] = (exec?.materials || []).map((m) => {
    const mat = matById.get(m.id);
    const price = mat ? valueAt(mat.history, date) : null;
    const qty = String(m.qty).replace('.', ',');
    return {
      label: `${m.description} (${m.code})`,
      detail: price ? `${qty} ${m.measureUnit} × ${brl(price)}` : `${qty} ${m.measureUnit} • sem valor cadastrado`,
      value: price ? round2(m.qty * price) : null
    };
  });

  const all = [...labor, ...overtime, ...(overnight ? [overnight] : []), ...materials];
  return {
    minutes,
    billedHours: billed,
    partial: !endIso,
    labor,
    overtime,
    overnight,
    materials,
    total: round2(all.reduce((s, l) => s + (l.value || 0), 0)),
    missing: all.filter((l) => l.value === null).length,
    warnings
  };
}
