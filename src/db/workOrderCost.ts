import { JobRole, Material, OrderParticipant, OvertimeRules, WorkOrder, WorkOrderOvertimeDay, WorkOrderPause } from '../types';
import { brl, fmtMinutes, localDate, toMillis, valueAt } from './manHours';
import type { OrderCostLine } from './manHours';
import { cargoKey, dbGetJobRoles, roleForCompany } from './workforce';
import { doc, getDoc, updateDoc } from './guard';
import { firebaseActive, dbInstance, checkQuotaException } from './core';
import { dbGetOvernightRate } from './planning';
import { dbGetOvertimeRules, overtimeDayKey, overtimeHourValue, rulesOfCompany, splitOvertime, OVERTIME_DAYS } from './overtime';
import { companyTracksCost, dbGetCompanies } from './companies';

// HOMEM-HORA E CUSTO DA OS (Hexon 2.0, igual ao principal com o almoço descontado):
// conta desde a atribuição até a assinatura do técnico, só seg–sex, 08:00–12:00 e 13:00–18:00 (hora do aparelho),
// sem as pausas (Pendente) e sem os dias marcados como feriado. Menos de 1 h cobra 1 h; acima, proporcional.
// Cada colaborador da OS: horas cobradas × valor do cargo. Hora extra e pernoite valem para todos da OS.
// Etapa especial E5: valores, regras de hora extra e pernoite são da EMPRESA da OS; empresa que não contabiliza
// homem-hora (caixa no cadastro da empresa) = custo só de materiais.

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
  costTracking: boolean;     // false = a empresa não contabiliza homem-hora, hora extra e pernoite (só materiais)
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Preço dos materiais: lê só os materiais usados na OS (1 leitura por material, guardada na sessão),
// em vez da lista inteira da gerência
const matCache = new Map<string, Material | null>();
async function materialsById(ids: string[]): Promise<Material[]> {
  const missing = Array.from(new Set(ids)).filter((id) => !matCache.has(id));
  if (missing.length && firebaseActive && dbInstance) {
    await Promise.all(
      missing.map(async (id) => {
        try {
          const snap = await getDoc(doc(dbInstance!, 'materials', id));
          matCache.set(id, snap.exists() ? ({ ...(snap.data() as Material), id: snap.id }) : null);
        } catch (err: any) {
          checkQuotaException(err);
          matCache.set(id, null);
        }
      })
    );
  }
  return ids.map((id) => matCache.get(id)).filter((m): m is Material => !!m);
}
// Valor do pernoite da empresa: 1 leitura por empresa na sessão
const overnightCache = new Map<string, ReturnType<typeof dbGetOvernightRate>>();
const overnightRateCached = (company: string) => {
  let p = overnightCache.get(company);
  if (!p) overnightCache.set(company, (p = dbGetOvernightRate(company)));
  return p;
};

// CUSTO GRAVADO NA OS CONCLUÍDA (Fase 6): resumo para a lista, sem precisar recalcular.
// É gravado na primeira vez que alguém com "Visualizar Valores" abre a OS concluída (os valores usam a data do fim).
export interface WorkOrderCostSnapshot {
  total: number;
  labor: number;
  overtime: number;
  overnight: number;
  materials: number;
  minutes: number;
  billedHours: number;
  missing: number;
  at: string;
}
export function osCostSnapshot(c: WorkOrderCost): WorkOrderCostSnapshot {
  const sum = (l: OrderCostLine[]) => round2(l.reduce((s, x) => s + (x.value || 0), 0));
  return {
    total: c.total,
    labor: sum(c.labor),
    overtime: sum(c.overtime),
    overnight: c.overnight?.value || 0,
    materials: sum(c.materials),
    minutes: c.minutes,
    billedHours: c.billedHours,
    missing: c.missing,
    at: new Date().toISOString()
  };
}
export async function dbSaveCostSnapshot(o: WorkOrder, c: WorkOrderCost): Promise<WorkOrderCostSnapshot | null> {
  if (!firebaseActive || !dbInstance || o.status !== 'Concluída' || o.costSnapshot) return o.costSnapshot || null;
  const snap = osCostSnapshot(c);
  try {
    await updateDoc(doc(dbInstance, 'workOrders', o.id), { costSnapshot: snap });
  } catch (err: any) {
    checkQuotaException(err); // sem gravar, a lista calcula de novo da próxima vez
  }
  return snap;
}
// Resumo para a lista: o gravado (concluída) ou calculado agora (parcial)
export async function dbGetWorkOrderCostSummary(o: WorkOrder): Promise<{ snap: WorkOrderCostSnapshot; partial: boolean }> {
  if (o.costSnapshot) return { snap: o.costSnapshot, partial: false };
  const c = await dbGetWorkOrderCost(o);
  if (o.status === 'Concluída') {
    const snap = await dbSaveCostSnapshot(o, c);
    o.costSnapshot = snap || undefined;
    return { snap: snap || osCostSnapshot(c), partial: false };
  }
  return { snap: osCostSnapshot(c), partial: c.partial };
}

// Custo da OS para quem pode ver valores. endIso = assinatura do técnico (sem ela, conta até agora)
export async function dbGetWorkOrderCost(o: WorkOrder, endIso?: string): Promise<WorkOrderCost> {
  const startMs = toMillis(o.assignedAt);
  // Fim: assinatura do técnico ou a resposta da última contestação (Aguardando assinaturas / Concluída);
  // contestada = conta até agora (o tempo esperando o cliente vira pausa); cancelada = hora do cancelamento
  const fixedEnd =
    endIso || (o.techSignedAt && ['Aguardando assinaturas', 'Concluída'].includes(o.status) ? o.workEndAt || o.techSignedAt : o.status === 'Cancelada' ? o.cancelledAt : undefined);
  const endMs = fixedEnd ? toMillis(fixedEnd) || Date.now() : Date.now();
  const date = localDate(new Date(endMs).toISOString());
  const exec = o.exec;
  const members = osMembers(o);
  const companies = await dbGetCompanies().catch(() => []);
  const tracks = companyTracksCost(companies, o.company);
  const company = o.company || '';
  const [roles, rules, mats, overnightRate] = await Promise.all([
    tracks ? dbGetJobRoles() : Promise.resolve([] as JobRole[]),
    tracks && exec?.overtime?.length ? dbGetOvertimeRules() : Promise.resolve([] as OvertimeRules[]),
    (exec?.materials || []).length ? materialsById(exec!.materials.map((m) => m.id)) : Promise.resolve([] as Material[]),
    tracks && exec?.overnightNights ? overnightRateCached(company) : Promise.resolve(null)
  ]);
  const roleByKey = new Map<string, JobRole>(roles.map((r) => [cargoKey(r.name), roleForCompany(r, company)]));
  const ruleById = new Map(rulesOfCompany(rules, company).map((r) => [r.roleId || '', r]));

  const minutes = startMs ? osWorkMinutes(startMs, endMs, o.pauses || [], osHolidays(o)) : 0;
  const billed = startMs ? osBilledHours(minutes) : 0;

  const labor: OrderCostLine[] = !tracks ? [] : members.map((p) => {
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
  (tracks ? exec?.overtime || [] : []).forEach((d) => {
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
  if (tracks && exec?.overnightNights) {
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
    partial: !fixedEnd,
    labor,
    overtime,
    overnight,
    materials,
    total: round2(all.reduce((s, l) => s + (l.value || 0), 0)),
    missing: all.filter((l) => l.value === null).length,
    warnings,
    costTracking: tracks
  };
}
