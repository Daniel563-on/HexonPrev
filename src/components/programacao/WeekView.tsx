import React, { useEffect, useMemo, useState } from 'react';
import { CalendarRange, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, Clock, Info, Lock, MapPin, MoreHorizontal, Pencil, Plus, RefreshCw, Star, Trash2, Wrench } from 'lucide-react';
import { Absence, Company, DayMarkKind, HexonUser, OrderParticipant, ServiceOrder, UsualTeam, WeekPlan, WorkOrder } from '../../types';
import {
  companiesOfUnit,
  dbDeleteAbsence,
  dbGetCompanies,
  dbGetPlanningDeadlines,
  dbGetUnitPeopleInfo,
  dbGetWeekPlan,
  dbListAbsences,
  dbListOpenWorkOrders,
  dbListTeams,
  dbPatchWeekPlan,
  isCompanyVisible,
  UnitPersonInfo
} from '../../db/firebase';
import { setHomeLink } from '../../lib/homeLinks';
import { isOrderOfTechnician, isWeekend, scheduledRange } from '../orders/planning/planningUtils';
import { teamLabel } from './TeamForm';
import { DAY_LABEL, addDays, isoWeek, mondayOf, weekDays } from './weekDates';
import { AbsenceForm, DayListModal, DayMarkModal, MARK_LABEL, TeamWeekModal } from './WeekModals';

// PROGRAMAÇÃO › SEMANA (Fase 7B, etapa de junção: planilha semanal + preventivas programadas no PMOC + chamados GLPI).
// Só ver e organizar: mostra o que JÁ está programado para o responsável de cada equipe (preventivas da cópia local)
// e os chamados em aberto com ele; organiza a equipe da semana, os dias marcados e as ausências. Não altera OS.
// Blocos (local + preventivas + chamados + pernoite) chegam na 7C.

interface Props {
  user: HexonUser;
  unitOptions: string[];
  visibleCompanies: string[] | null;
  canEdit: boolean; // "Programar"
  orders: ServiceOrder[]; // preventivas da cópia local deste aparelho
  activeUnit?: string; // quem vê todas as gerências: a gerência cuja cópia está no aparelho
  onActiveUnitChange?: (unit: string) => void;
  onViewedMonthChange?: (month: string) => void;
  onNavigate: (tab: string) => void;
}

type Modal =
  | { kind: 'mark'; index: number }
  | { kind: 'team'; team: UsualTeam }
  | { kind: 'absence'; absence: Absence | null }
  | { kind: 'list'; title: string; sub: string; orders: ServiceOrder[] }
  | null;
type Group = { key: string; comarca: string; address: string; orders: ServiceOrder[] };

const SHOWN = ['Planejada', 'Em Execução', 'Atrasada', 'Concluída', 'Não Executada'];
const COLS = '230px repeat(5, minmax(120px, 1fr)) repeat(2, minmax(96px, 0.75fr))';
const byOrder = (a: UsualTeam, b: UsualTeam) => (a.order ?? 9999) - (b.order ?? 9999) || teamLabel(a).localeCompare(teamLabel(b));
const same = (list: OrderParticipant[], base: OrderParticipant[]) => list.length === base.length && list.every((m) => base.some((b) => b.matricula === m.matricula));
const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const localMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const saveLocal = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignora */
  }
};
// A preventiva está programada neste dia? (fim de semana só se o período começa ou termina nele)
const coversDay = (o: ServiceOrder, day: string) => {
  const r = scheduledRange(o);
  return !!r && r[0] <= day && r[1] >= day && (!isWeekend(day) || r[0] === day || r[1] === day);
};
function groupsOf(list: ServiceOrder[]): Group[] {
  const m = new Map<string, Group>();
  list.forEach((o) => {
    const key = `${o.comarca || ''}|${o.addressText || ''}`;
    if (!m.has(key)) m.set(key, { key, comarca: o.comarca || 'Sem comarca', address: o.addressText || '', orders: [] });
    m.get(key)!.orders.push(o);
  });
  return Array.from(m.values()).sort((a, b) => a.comarca.localeCompare(b.comarca));
}

export default function WeekView({ user, unitOptions, visibleCompanies, canEdit, orders, activeUnit, onActiveUnitChange, onViewedMonthChange, onNavigate }: Props) {
  const [unit, setUnit] = useState(() => (activeUnit && unitOptions.includes(activeUnit) ? activeUnit : unitOptions.includes(user.gerencia) ? user.gerencia : unitOptions[0] || ''));
  const [companies, setCompanies] = useState<Company[]>([]);
  const [company, setCompany] = useState('');
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [teams, setTeams] = useState<UsualTeam[]>([]);
  const [people, setPeople] = useState<UnitPersonInfo[]>([]);
  const [openWos, setOpenWos] = useState<WorkOrder[]>([]);
  const [deadline, setDeadline] = useState<string | null>(null);
  const [plan, setPlan] = useState<WeekPlan | null>(null);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [askDel, setAskDel] = useState('');

  useEffect(() => {
    dbGetCompanies()
      .then(setCompanies)
      .catch(() => {});
  }, []);
  const unitCompanies = useMemo(() => companiesOfUnit(companies, unit).filter((c) => c.active && isCompanyVisible(c.id, visibleCompanies)), [companies, unit, visibleCompanies]);
  useEffect(() => {
    if (!unitCompanies.some((c) => c.id === company)) setCompany(unitCompanies[0]?.id || '');
  }, [unitCompanies.map((c) => c.id).join('|')]);

  // Quem vê todas as gerências: o aparelho passa a guardar as preventivas da gerência escolhida aqui
  useEffect(() => {
    if (unit && onActiveUnitChange && activeUnit !== unit) onActiveUnitChange(unit);
  }, [unit]);
  // Preventivas concluídas do mês da semana (e de volta ao mês atual ao sair)
  useEffect(() => {
    onViewedMonthChange?.(addDays(weekStart, 3).slice(0, 7));
  }, [weekStart]);
  useEffect(() => () => onViewedMonthChange?.(localMonth()), []);

  const loadUnit = async () => {
    setLoading(true);
    setMsg(null);
    try {
      const [t, p, w, d] = await Promise.all([dbListTeams(unit), dbGetUnitPeopleInfo(unit), dbListOpenWorkOrders(unit).catch(() => [] as WorkOrder[]), dbGetPlanningDeadlines().catch(() => [])]);
      setTeams(t);
      setPeople(p);
      setOpenWos(w);
      setDeadline(d.find((x) => x.id === unit)?.expiresAt || null);
    } catch (err: any) {
      setMsg({ ok: false, text: err?.code === 'permission-denied' ? 'O banco não deixou ler as equipes.' : `Não foi possível ler as equipes: ${err?.message || err}` });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (unit) loadUnit();
  }, [unit]);
  const loadWeek = async () => {
    if (!unit || !company) return;
    try {
      const [pl, ab] = await Promise.all([dbGetWeekPlan(unit, company, weekStart), dbListAbsences(unit, weekStart)]);
      setPlan(pl);
      setAbsences(ab);
    } catch (err: any) {
      setPlan(null);
      setAbsences([]);
      setMsg({ ok: false, text: err?.code === 'permission-denied' ? 'O banco não deixou ler a semana.' : `Não foi possível ler a semana: ${err?.message || err}` });
    }
  };
  useEffect(() => {
    loadWeek();
  }, [unit, company, weekStart]);

  const days = weekDays(weekStart);
  const weekEnd = days[6];
  const today = mondayOf(new Date()) === weekStart ? days[(new Date().getDay() + 6) % 7] : '';
  const readOnly = !canEdit || weekStart < mondayOf(new Date());
  const companyName = unitCompanies.find((c) => c.id === company)?.name || company;
  const personOf = (mat: string) => people.find((p) => p.matricula === mat);
  const teamCos = (t: UsualTeam) => (t.company ? [t.company] : personOf(t.matricula)?.companies || []);
  const here = teams
    .filter((t) => {
      const cs = teamCos(t);
      return cs.length === 0 || cs.includes(company);
    })
    .sort(byOrder);
  const weekMembers = (t: UsualTeam) => plan?.teams?.[t.matricula] ?? t.members;
  const candidates = people.filter((p) => p.companies.length === 0 || p.companies.includes(company));
  const myAbs = absences.filter((a) => a.company === company && a.from <= weekEnd && a.to >= weekStart).sort((a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name));
  const absOn = (mat: string, day: string) => myAbs.find((a) => a.matricula === mat && a.from <= day && a.to >= day);
  const absentDays = (mat: string) => days.filter((d) => absOn(mat, d));

  // Preventivas programadas nesta semana (da gerência e empresa), por responsável
  const prevs = orders.filter((o) => o.unit === unit && (!o.company || o.company === company) && SHOWN.includes(o.status) && days.some((d) => coversDay(o, d)));
  const ordersOf = (t: UsualTeam) => prevs.filter((o) => isOrderOfTechnician(o, { matricula: t.matricula, name: personOf(t.matricula)?.name || t.respName || '' }));
  const inTeams = new Set(here.flatMap((t) => ordersOf(t).map((o) => o.id)));
  const outside = new Map<string, { name: string; orders: ServiceOrder[] }>();
  prevs
    .filter((o) => !inTeams.has(o.id))
    .forEach((o) => {
      const k = o.assignedTechnicianMatricula || o.assignedTechnician || '—';
      if (!outside.has(k)) outside.set(k, { name: o.assignedTechnician || personOf(k)?.name || k, orders: [] });
      outside.get(k)!.orders.push(o);
    });
  const woCount = (mat: string) => openWos.filter((w) => w.assignedTechnicianMatricula === mat && (!w.company || w.company === company)).length;

  // Onde cada pessoa está nesta semana
  const placeInWeek = (mat: string, except: string): { label: string; resp: boolean } | null => {
    for (const t of here) {
      if (t.matricula === mat) return { label: teamLabel(t), resp: true };
      if (t.matricula !== except && weekMembers(t).some((m) => m.matricula === mat)) return { label: teamLabel(t), resp: false };
    }
    return null;
  };
  const baseTeamOf = (mat: string, except: string) => here.find((t) => t.matricula !== except && t.members.some((m) => m.matricula === mat));

  // Resumo (igual ao topo do PDF)
  const teamPeople = new Set<string>(here.flatMap((t) => [t.matricula, ...weekMembers(t).map((m) => m.matricula)]));
  const efetivo = teamPeople.size;
  const absentInTeams = Array.from(teamPeople).filter((m) => absentDays(m).length > 0).length;
  const absentCount = new Set(myAbs.map((a) => a.matricula)).size;
  const openCount = here.reduce((n, t) => n + woCount(t.matricula), 0);

  // Gravação: só o que mudou; a tela já mostra a mudança
  const patch = async (change: { days?: Record<string, { kind: DayMarkKind; text: string } | null>; teams?: Record<string, OrderParticipant[] | null> }): Promise<boolean> => {
    setMsg(null);
    try {
      await dbPatchWeekPlan({ unit, company, weekStart }, user.name, change);
      setPlan((prev) => {
        const next: WeekPlan = { ...(prev || { unit, company, weekStart, updatedAt: '', updatedBy: '' }), days: { ...(prev?.days || {}) }, teams: { ...(prev?.teams || {}) } };
        Object.entries(change.days || {}).forEach(([k, v]) => (v === null ? delete next.days![k] : (next.days![k] = v)));
        Object.entries(change.teams || {}).forEach(([k, v]) => (v === null ? delete next.teams![k] : (next.teams![k] = v)));
        return next;
      });
      setMsg({ ok: true, text: 'Semana salva.' });
      return true;
    } catch (err: any) {
      setMsg({ ok: false, text: err?.code === 'permission-denied' ? 'O banco recusou: seu perfil não tem "Programar" nesta gerência.' : `Não foi possível salvar: ${err?.message || err}` });
      return false;
    }
  };
  // Equipe da semana: quem veio de outra equipe sai de lá nesta semana
  const saveTeamWeek = (t: UsualTeam, members: OrderParticipant[]) => {
    const change: Record<string, OrderParticipant[] | null> = { [t.matricula]: same(members, t.members) ? null : members };
    const mine = new Set(members.map((m) => m.matricula));
    here.forEach((o) => {
      if (o.matricula === t.matricula) return;
      const cur = weekMembers(o);
      if (cur.some((m) => mine.has(m.matricula))) {
        const next = cur.filter((m) => !mine.has(m.matricula));
        change[o.matricula] = same(next, o.members) ? null : next;
      }
    });
    return patch({ teams: change });
  };
  // Voltar para a cadastrada: os da equipe voltam para ela; quem ficou sem lugar volta para a equipe dele
  const resetTeamWeek = (t: UsualTeam) => {
    const after: Record<string, OrderParticipant[]> = { ...(plan?.teams || {}) };
    delete after[t.matricula];
    const tBase = new Set(t.members.map((m) => m.matricula));
    Object.keys(after).forEach((k) => (after[k] = after[k].filter((m) => !tBase.has(m.matricula))));
    const eff = (o: UsualTeam) => after[o.matricula] ?? o.members;
    const placed = new Set(here.flatMap((o) => [o.matricula, ...eff(o).map((m) => m.matricula)]));
    here.forEach((o) => {
      if (!after[o.matricula]) return;
      const lost = o.members.filter((b) => !placed.has(b.matricula));
      if (lost.length) after[o.matricula] = [...after[o.matricula], ...lost];
    });
    const change: Record<string, OrderParticipant[] | null> = { [t.matricula]: null };
    Object.keys(plan?.teams || {}).forEach((k) => {
      if (k === t.matricula) return;
      const o = here.find((x) => x.matricula === k);
      const next = after[k];
      if (!next || !o) return;
      if (!same(next, plan!.teams![k])) change[k] = same(next, o.members) ? null : next;
    });
    return patch({ teams: change });
  };
  const removeAbsence = async (a: Absence) => {
    try {
      await dbDeleteAbsence(a.id);
      setAbsences((prev) => prev.filter((x) => x.id !== a.id));
      setAskDel('');
    } catch (err: any) {
      setMsg({ ok: false, text: err?.code === 'permission-denied' ? 'O banco recusou: seu perfil não tem "Programar" nesta gerência.' : `Não foi possível excluir: ${err?.message || err}` });
    }
  };
  const openPreventive = (o: ServiceOrder) => {
    setHomeLink('preventives-search', o.id);
    saveLocal('hexon_orders_section', 'preventivas');
    onNavigate('service-orders');
  };
  const openTechOs = (mat: string) => {
    setHomeLink('os-list', { tech: mat });
    saveLocal('hexon_os_unit', unit);
    saveLocal('hexon_orders_section', 'os');
    onNavigate('service-orders');
  };

  const sel = 'h-9 px-2 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900';
  const card = 'rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b1220]';
  const colBg = (i: number) => (plan?.days?.[days[i]] ? 'bg-rose-50/70 dark:bg-rose-950/20' : i >= 5 ? 'bg-slate-50 dark:bg-slate-900/40' : '');
  const stat = (label: string, value: React.ReactNode, warn = false) => (
    <div key={label} className={`px-3 py-2 rounded-xl border ${warn ? 'border-amber-200 bg-amber-50 dark:bg-amber-950/30' : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b1220]'}`}>
      <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`text-base font-black ${warn ? 'text-amber-700' : 'text-slate-900 dark:text-white'}`}>{value}</p>
    </div>
  );
  const cell = (list: ServiceOrder[], i: number, title: string) => {
    const day = days[i];
    const groups = groupsOf(list.filter((o) => coversDay(o, day)));
    return groups.map((g) => {
      const done = g.orders.filter((o) => o.status === 'Concluída').length;
      const late = g.orders.filter((o) => o.status === 'Atrasada').length;
      return (
        <button
          key={g.key}
          type="button"
          onClick={() =>
            setModal({ kind: 'list', title: `${title} · ${DAY_LABEL[i].toLowerCase()} ${br(day)} · ${g.comarca}`, sub: g.address || 'Preventivas programadas neste dia.', orders: g.orders })
          }
          className="w-full text-left p-1.5 rounded-lg border border-dashed border-indigo-300 bg-indigo-50/40 dark:bg-indigo-950/30 hover:border-indigo-500 cursor-pointer"
        >
          <p className="text-[10px] font-black text-slate-800 dark:text-slate-100 leading-tight flex items-start gap-1">
            <MapPin className="w-3 h-3 mt-px shrink-0 text-indigo-600" />
            {g.comarca}
          </p>
          {g.address && <p className="text-[9px] text-slate-500 leading-tight truncate ml-4">{g.address}</p>}
          <p className="text-[10px] font-bold text-emerald-700 flex items-center gap-1 mt-0.5">
            <ClipboardCheck className="w-3 h-3" />
            {g.orders.length} preventiva{g.orders.length > 1 ? 's' : ''}
          </p>
          {done > 0 && (
            <p className="text-[9px] font-bold text-slate-500 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              {done} concluída{done > 1 ? 's' : ''}
            </p>
          )}
          {late > 0 && (
            <p className="text-[9px] font-black text-amber-700">
              {late} atrasada{late > 1 ? 's' : ''}
            </p>
          )}
        </button>
      );
    });
  };
  const badge = (cls: string, text: React.ReactNode, key: string) => (
    <p key={key} className={`mt-1 text-[9px] font-bold rounded px-1 inline-block border ${cls}`}>
      {text}
    </p>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setWeekStart(addDays(weekStart, -7))} className={`${sel} w-9 flex items-center justify-center cursor-pointer`} title="Semana anterior">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className={`${sel} px-4 flex items-center gap-2`}>
            <CalendarRange className="w-4 h-4 text-indigo-600" />
            <span className="text-sm font-black text-slate-900 dark:text-white">Semana {isoWeek(weekStart)}</span>
            <span className="text-xs font-medium text-slate-500">
              {br(weekStart)} a {br(weekEnd)}/{weekEnd.slice(0, 4)}
            </span>
          </div>
          <button type="button" onClick={() => setWeekStart(addDays(weekStart, 7))} className={`${sel} w-9 flex items-center justify-center cursor-pointer`} title="Próxima semana">
            <ChevronRight className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => setWeekStart(mondayOf(new Date()))} className={`${sel} px-3 cursor-pointer`}>
            Hoje
          </button>
          {unitOptions.length > 1 && (
            <select value={unit} onChange={(e) => setUnit(e.target.value)} className={sel}>
              {unitOptions.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          )}
          <select value={company} onChange={(e) => setCompany(e.target.value)} className={sel} disabled={unitCompanies.length === 0}>
            {unitCompanies.length === 0 && <option value="">Sem empresa nesta gerência</option>}
            {unitCompanies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              loadUnit();
              loadWeek();
            }}
            disabled={loading}
            className={`${sel} px-3 flex items-center gap-1.5 cursor-pointer`}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>
        {!readOnly && company && (
          <button
            type="button"
            onClick={() => setModal({ kind: 'absence', absence: null })}
            className="h-9 px-4 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-xs font-black flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Lançar férias ou atestado
          </button>
        )}
      </div>

      {msg && <p className={`text-xs font-bold ${msg.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{msg.text}</p>}
      {unitCompanies.length === 0 && !loading && <p className="text-xs text-slate-500">Nenhuma empresa ativa nesta gerência (Configurações › Empresas).</p>}

      {company && (
        <>
          <div className="flex flex-wrap gap-2">
            {stat('Efetivo', efetivo)}
            {stat('Disponível', efetivo - absentInTeams)}
            {stat('Equipes', here.length)}
            {stat('Ausentes', absentCount, absentCount > 0)}
            {stat('Preventivas programadas', prevs.length)}
            {stat('Chamados em aberto', openCount)}
            {stat(
              'Prazo de planejamento',
              <span className="flex items-center gap-1">
                <Clock className="w-4 h-4" />
                {deadline ? new Date(deadline).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'sem prazo'}
              </span>,
              !!deadline
            )}
          </div>

          {!loading && here.length === 0 && (
            <p className={`${card} p-6 text-center text-sm text-slate-500`}>Nenhuma equipe da {companyName} ainda. Monte as equipes na aba Equipes: elas viram as linhas da semana.</p>
          )}

          <div className={`${card} overflow-x-auto`}>
            <div className="min-w-[1080px]">
              <div className="grid border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900" style={{ gridTemplateColumns: COLS }}>
                <div className="p-3 text-[10px] font-black uppercase tracking-wider text-slate-500">Equipe · responsável · membros</div>
                {days.map((d, i) => {
                  const mark = plan?.days?.[d];
                  return (
                    <div key={d} className={`p-2 ${mark ? 'bg-rose-50 dark:bg-rose-950/30' : i >= 5 ? 'bg-slate-100 dark:bg-slate-800/60' : ''}`}>
                      <div className="flex items-center justify-between gap-1">
                        <p className={`text-[11px] font-black ${mark ? 'text-rose-600' : i >= 5 ? 'text-slate-500' : 'text-slate-700 dark:text-slate-200'}`}>
                          {DAY_LABEL[i]} <span className="font-medium text-slate-400">{br(d)}</span>
                          {d === today && <span className="ml-1 px-1.5 py-0.5 rounded bg-indigo-600 text-white text-[9px]">hoje</span>}
                        </p>
                        {!readOnly && (
                          <button
                            type="button"
                            onClick={() => setModal({ kind: 'mark', index: i })}
                            title="Marcar o dia"
                            className="h-5 w-5 rounded flex items-center justify-center text-slate-400 hover:text-indigo-600 cursor-pointer"
                          >
                            <MoreHorizontal className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      {mark && (
                        <p className="mt-0.5 text-[9px] font-black text-rose-600 leading-tight">
                          {MARK_LABEL[mark.kind].toUpperCase()}
                          {mark.text ? ` · ${mark.text}` : ''}
                        </p>
                      )}
                      {!mark && i >= 5 && <p className="mt-0.5 text-[9px] font-bold text-slate-400">fim de semana</p>}
                    </div>
                  );
                })}
              </div>

              {here.map((t) => {
                const members = weekMembers(t);
                const list = ordersOf(t);
                const resp = personOf(t.matricula);
                const respName = resp?.name || t.respName || t.matricula;
                const badges: React.ReactNode[] = [];
                members
                  .filter((m) => !t.members.some((b) => b.matricula === m.matricula))
                  .forEach((m) => {
                    const from = baseTeamOf(m.matricula, t.matricula);
                    badges.push(badge('text-amber-800 bg-amber-50 border-amber-200', `nesta semana: + ${m.name.split(' ')[0]}${from ? ` (da ${teamLabel(from)})` : ''}`, `in${m.matricula}`));
                  });
                t.members
                  .filter((b) => !members.some((m) => m.matricula === b.matricula))
                  .forEach((b) => {
                    const at = placeInWeek(b.matricula, t.matricula);
                    badges.push(badge('text-amber-800 bg-amber-50 border-amber-200', `nesta semana: ${b.name.split(' ')[0]} ${at ? `está na ${at.label}` : 'fora da equipe'}`, `out${b.matricula}`));
                  });
                [t.matricula, ...members.map((m) => m.matricula)].forEach((mat) => {
                  const ds = absentDays(mat);
                  if (ds.length) {
                    const a = absOn(mat, ds[0])!;
                    const name = (mat === t.matricula ? respName : members.find((m) => m.matricula === mat)?.name || a.name).split(' ')[0];
                    badges.push(badge('text-rose-700 bg-rose-50 border-rose-200', `${name}: ${a.kind.toLowerCase()} ${br(ds[0])}${ds.length > 1 ? ` a ${br(ds[ds.length - 1])}` : ''}`, `ab${mat}`));
                  }
                });
                const wo = woCount(t.matricula);
                return (
                  <div key={t.matricula} className="grid border-b border-slate-200 dark:border-slate-800" style={{ gridTemplateColumns: COLS }}>
                    <div className="p-3">
                      <div className="flex items-start justify-between gap-1">
                        <div>
                          <p className={`text-[11px] font-black tracking-wide uppercase ${t.name ? 'text-rose-700 dark:text-rose-400' : 'text-amber-800'}`}>{teamLabel(t)}</p>
                          {t.type && <p className="text-[10px] font-bold text-slate-500">{t.type}</p>}
                        </div>
                        {!readOnly && (
                          <button
                            type="button"
                            onClick={() => setModal({ kind: 'team', team: t })}
                            title="Equipe desta semana"
                            className="h-6 w-6 rounded-md border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-400 hover:text-indigo-600 cursor-pointer"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                      <p className="mt-1 text-[11px] font-black text-slate-900 dark:text-white flex items-center gap-1">
                        <Star className="w-3 h-3 text-amber-500 fill-amber-400" />
                        {respName}
                      </p>
                      <p className="text-[10px] text-slate-500 leading-snug">
                        {members.length ? `${members.map((m) => m.name.split(' ')[0]).join(', ')} · ` : ''}
                        {members.length + 1} pessoa{members.length ? 's' : ''}
                      </p>
                      {badges}
                      {wo > 0 && (
                        <button
                          type="button"
                          onClick={() => openTechOs(t.matricula)}
                          className="mt-1 text-[9px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-1 inline-flex items-center gap-1 cursor-pointer text-left"
                        >
                          <Wrench className="w-3 h-3 shrink-0" />
                          {wo} chamado{wo > 1 ? 's' : ''} em aberto com ele (sem dia)
                        </button>
                      )}
                    </div>
                    {days.map((d, i) => {
                      const off = [t.matricula, ...members.map((m) => m.matricula)].filter((m) => absOn(m, d));
                      return (
                        <div key={d} className={`p-1 space-y-1 ${colBg(i)}`}>
                          {cell(list, i, teamLabel(t))}
                          {off.length > 0 && (
                            <p className="text-[9px] font-bold text-rose-600 leading-tight">
                              ausente: {off.map((m) => (m === t.matricula ? respName : members.find((x) => x.matricula === m)?.name || m).split(' ')[0]).join(', ')}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              {Array.from(outside.entries()).map(([k, o]) => (
                <div key={`fora${k}`} className="grid border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40" style={{ gridTemplateColumns: COLS }}>
                  <div className="p-3">
                    <p className="text-[11px] font-black text-slate-600 dark:text-slate-300">FORA DAS EQUIPES</p>
                    <p className="text-[10px] text-slate-500">Preventiva programada para quem não é responsável de equipe: {o.name}</p>
                  </div>
                  {days.map((d, i) => (
                    <div key={d} className={`p-1 space-y-1 ${colBg(i)}`}>
                      {cell(o.orders, i, o.name)}
                    </div>
                  ))}
                </div>
              ))}

              {myAbs.length > 0 && (
                <div className="px-3 py-1.5 bg-rose-50 dark:bg-rose-950/30 border-b border-rose-200 dark:border-rose-900 text-[10px] font-black uppercase tracking-wider text-rose-700">
                  Ausentes na semana — nesses dias a pessoa sai da equipe
                </div>
              )}
              {myAbs.map((a) => {
                const s = days.indexOf(a.from > weekStart ? a.from : weekStart);
                const e = days.indexOf(a.to < weekEnd ? a.to : weekEnd);
                const team = here.find((t) => t.matricula === a.matricula || t.members.some((m) => m.matricula === a.matricula));
                return (
                  <div key={a.id} className="grid border-b border-slate-200 dark:border-slate-800" style={{ gridTemplateColumns: COLS }}>
                    <div className="p-2">
                      <p className="text-[10px] font-black text-rose-700">{a.kind.toUpperCase()}</p>
                      <p className="text-[11px] font-bold text-slate-800 dark:text-slate-200">{a.name}</p>
                      <p className="text-[10px] text-slate-500">
                        {a.cargo || '—'}
                        {team ? ` · ${teamLabel(team)}` : ''}
                      </p>
                    </div>
                    <div className="p-1" style={{ gridColumn: `${2 + s} / span ${e - s + 1}` }}>
                      <div
                        className={`h-full rounded-lg border px-2 py-1.5 text-[11px] font-black flex items-center justify-between gap-2 ${a.kind === 'Férias' ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-orange-50 border-orange-200 text-orange-700'}`}
                      >
                        <span>
                          {a.kind} · {br(a.from)} a {br(a.to)}
                          {a.note ? <span className="font-medium"> · {a.note}</span> : null}
                        </span>
                        {!readOnly &&
                          (askDel === a.id ? (
                            <span className="flex items-center gap-1.5 shrink-0">
                              <span className="text-[10px]">Excluir?</span>
                              <button type="button" onClick={() => removeAbsence(a)} className="px-2 py-0.5 rounded bg-rose-600 text-white text-[10px] cursor-pointer">
                                Sim
                              </button>
                              <button type="button" onClick={() => setAskDel('')} className="px-2 py-0.5 rounded border border-slate-300 text-[10px] cursor-pointer">
                                Não
                              </button>
                            </span>
                          ) : (
                            <span className="flex gap-1.5 shrink-0">
                              <button type="button" onClick={() => setModal({ kind: 'absence', absence: a })} title="Editar" className="cursor-pointer">
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button type="button" onClick={() => setAskDel(a.id)} title="Excluir" className="cursor-pointer">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </span>
                          ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900 text-[11px] text-indigo-900 dark:text-indigo-200 flex gap-2">
            <Info className="w-4 h-4 shrink-0" />
            <span>
              Tracejado = preventivas já programadas (PMOC). Clique para ver a lista e abrir. Montar blocos com local, preventivas, chamados e pernoite chega na próxima etapa.
              {weekStart < mondayOf(new Date()) && (
                <>
                  {' '}
                  <Lock className="inline w-3 h-3" /> Semana que já passou: só consulta.
                </>
              )}
            </span>
          </div>
        </>
      )}

      {modal?.kind === 'mark' && (
        <DayMarkModal day={days[modal.index]} index={modal.index} mark={plan?.days?.[days[modal.index]]} onSave={(m) => patch({ days: { [days[modal.index]]: m } })} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'team' && (
        <TeamWeekModal
          title={`${teamLabel(modal.team)} — equipe desta semana (${br(weekStart)} a ${br(weekEnd)})`}
          respName={personOf(modal.team.matricula)?.name || modal.team.respName || modal.team.matricula}
          members={weekMembers(modal.team)}
          base={modal.team.members}
          people={candidates}
          respMatricula={modal.team.matricula}
          placeOf={(mat) => placeInWeek(mat, modal.team.matricula)}
          onSave={(m) => saveTeamWeek(modal.team, m)}
          onReset={() => resetTeamWeek(modal.team)}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === 'absence' && (
        <AbsenceForm
          absence={modal.absence}
          people={candidates}
          unit={unit}
          company={company}
          companyName={companyName}
          user={user}
          onSaved={(a) => setAbsences((prev) => [...prev.filter((x) => x.id !== a.id), a])}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === 'list' && <DayListModal title={modal.title} sub={modal.sub} orders={modal.orders} onOpen={openPreventive} onClose={() => setModal(null)} />}
    </div>
  );
}
