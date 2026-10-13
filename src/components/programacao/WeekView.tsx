import React, { useEffect, useMemo, useState } from 'react';
import { CalendarRange, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, Clock, Eye, History, Info, Lock, MapPin, Moon, MoreHorizontal, Pencil, Plus, RefreshCw, Star, Trash2, Wrench } from 'lucide-react';
import { Absence, Company, DayMarkKind, HexonUser, OrderParticipant, PlanningLot, ServiceOrder, UsualTeam, WeekPlan, WeekVisit, WorkOrder } from '../../types';
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
  dbListWeekLots,
  dbPatchWeekPlan,
  dbSetWeekVisit,
  isCompanyVisible,
  localTodayStr,
  UnitPersonInfo
} from '../../db/firebase';
import { setHomeLink } from '../../lib/homeLinks';
import { isOrderOfTechnician } from '../orders/planning/planningUtils';
import { teamLabel } from './TeamForm';
import { DAY_LABEL, addDays, isoWeek, mondayOf, weekDays } from './weekDates';
import { AbsenceForm, DayListModal, DayMarkModal, MARK_LABEL, TeamWeekModal, VisitModal, WeekHistoryModal } from './WeekModals';
import BlockEditor from './BlockEditor';
import ToPlanPanel, { ToPlanGroup } from './ToPlanPanel';
import { GridItem, Placed, blockItems, coversDay, localKey, localLabel, looseItems, placeLanes } from './blockLayout';

// PROGRAMAÇÃO › SEMANA (Fase 7B ver e organizar; 7C-1 blocos de preventivas; 7C-2 chamados nos blocos). Etapa de junção:
// planilha semanal (PSS) + lote do PMOC + atribuição de chamados do Hexon principal. Linhas = equipes; cada bloco = local em
// dias seguidos com as preventivas, os chamados e o pernoite. "A programar" ao lado; histórico da semana.

interface Props {
  user: HexonUser;
  unitOptions: string[];
  visibleCompanies: string[] | null;
  canEdit: boolean; // "Programar"
  orders: ServiceOrder[]; // preventivas da cópia local deste aparelho
  activeUnit?: string; // quem vê todas as gerências: a gerência cuja cópia está no aparelho
  onActiveUnitChange?: (unit: string) => void;
  limitedUnits?: boolean;
  onViewedMonthChange?: (month: string) => void;
  onNavigate: (tab: string) => void;
}

type Modal =
  | { kind: 'mark'; index: number }
  | { kind: 'team'; team: UsualTeam }
  | { kind: 'absence'; absence: Absence | null }
  | { kind: 'list'; title: string; sub: string; orders: ServiceOrder[] }
  | { kind: 'block'; lot: PlanningLot | null; team?: string; local?: string; days?: [string, string]; wos?: string[] }
  | { kind: 'visit'; team: UsualTeam }
  | { kind: 'history' }
  | null;

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

export default function WeekView({ user, unitOptions, visibleCompanies, canEdit, orders, activeUnit, onActiveUnitChange, limitedUnits, onViewedMonthChange, onNavigate }: Props) {
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
  const [lots, setLots] = useState<PlanningLot[]>([]);
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
      const [pl, ab, lt] = await Promise.all([dbGetWeekPlan(unit, company, weekStart), dbListAbsences(unit, weekStart), dbListWeekLots(unit, weekStart)]);
      setPlan(pl);
      setAbsences(ab);
      setLots(lt);
    } catch (err: any) {
      setPlan(null);
      setAbsences([]);
      setLots([]);
      setMsg({ ok: false, text: err?.code === 'permission-denied' ? 'O banco não deixou ler a semana.' : `Não foi possível ler a semana: ${err?.message || err}` });
    }
  };
  useEffect(() => {
    loadWeek();
  }, [unit, company, weekStart]);

  const days = weekDays(weekStart);
  const weekEnd = days[6];
  const todayStr = localTodayStr();
  const today = days.includes(todayStr) ? todayStr : '';
  const pastWeek = weekStart < mondayOf(new Date());
  const readOnly = !canEdit || pastWeek;
  const deadlineValid = !!deadline && deadline !== 'none' && !Number.isNaN(new Date(deadline).getTime());
  const deadlineLocked = !!limitedUnits && deadlineValid && new Date(deadline!).getTime() < Date.now();
  const canProgram = !readOnly && !deadlineLocked;
  const lockReason = !canEdit ? 'Seu perfil só consulta a Programação.' : pastWeek ? 'Semana que já passou: só consulta.' : deadlineLocked ? 'Prazo de planejamento vencido: só consulta. Peça ao Super Administrador para estender.' : '';
  const companyObj = unitCompanies.find((c) => c.id === company);
  const companyName = companyObj?.name || company;
  const personOf = (mat: string) => people.find((p) => p.matricula === mat);
  const teamCos = (t: UsualTeam) => (t.company ? [t.company] : personOf(t.matricula)?.companies || []);
  const here = teams
    .filter((t) => {
      const cs = teamCos(t);
      return cs.length === 0 || cs.includes(company);
    })
    .sort(byOrder);
  const isTech = (t: UsualTeam) => personOf(t.matricula)?.perfil === 'Profissional';
  const respNameOf = (mat: string) => personOf(mat)?.name || here.find((t) => t.matricula === mat)?.respName || mat;
  const weekMembers = (t: UsualTeam) => plan?.teams?.[t.matricula] ?? t.members;
  const candidates = people.filter((p) => p.companies.length === 0 || p.companies.includes(company));
  const myAbs = absences.filter((a) => a.company === company && a.from <= weekEnd && a.to >= weekStart).sort((a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name));
  const absOn = (mat: string, day: string) => myAbs.find((a) => a.matricula === mat && a.from <= day && a.to >= day);
  const absentDays = (mat: string) => days.filter((d) => absOn(mat, d));

  // Preventivas desta gerência e empresa; programadas nesta semana; lotes/blocos da semana
  const unitOrders = useMemo(() => orders.filter((o) => o.unit === unit && (!o.company || o.company === company)), [orders, unit, company]);
  const prevs = unitOrders.filter((o) => SHOWN.includes(o.status) && days.some((d) => coversDay(o, d)));
  const weekLots = lots.filter((l) => !l.company || l.company === company);
  const lotIds = new Set(weekLots.map((l) => l.id));
  const ordersOfLot = (id: string) => unitOrders.filter((o) => o.lotId === id);
  const techOf = (mat: string) => ({ matricula: mat, name: respNameOf(mat) });
  const ordersOf = (mat: string) => prevs.filter((o) => isOrderOfTechnician(o, techOf(mat)));
  const itemsOf = (mat: string): GridItem[] => [
    ...weekLots.filter((l) => l.technicianMatricula === mat).flatMap((l) => blockItems(l, ordersOfLot(l.id), days)),
    ...looseItems(
      ordersOf(mat).filter((o) => !o.lotId || !lotIds.has(o.lotId)),
      days
    )
  ];
  const teamLabelOf = (mat: string) => {
    const t = here.find((x) => x.matricula === mat);
    return t ? teamLabel(t) : respNameOf(mat);
  };
  const visitsOf = (t: UsualTeam): GridItem[] =>
    Object.entries((plan?.visits || {}) as Record<string, WeekVisit>)
      .filter(([, v]) => v.resp === t.matricula)
      .flatMap(([id, v]) => {
        const lot = weekLots.find((l) => l.id === v.lotId);
        if (!lot) return [];
        return blockItems(lot, ordersOfLot(lot.id), days).map((b) => ({ kind: 'visit' as const, id: `${id}_${b.from}`, from: b.from, to: b.to, lot, of: teamLabelOf(lot.technicianMatricula) }));
      });
  const inTeams = new Set(here.map((t) => t.matricula));
  const outside = new Map<string, string>();
  prevs.forEach((o) => {
    const k = o.assignedTechnicianMatricula || '';
    if (k && !inTeams.has(k) && !outside.has(k)) outside.set(k, o.assignedTechnician || respNameOf(k));
  });
  // Chamados abertos da empresa (Fase 7C-2): sem dia = ainda não estão num bloco
  const companyWos = openWos.filter((w) => !w.company || w.company === company);
  const woCount = (mat: string) => companyWos.filter((w) => w.assignedTechnicianMatricula === mat && !w.scheduledDate).length;
  const wosNew = companyWos.filter((w) => w.status === 'Nova' || !w.assignedTechnicianMatricula);
  const wosNoDay = companyWos.filter((w) => w.status !== 'Nova' && !!w.assignedTechnicianMatricula && !w.scheduledDate);
  const woInWeek = weekLots.reduce((n, l) => n + (l.woIds?.length || 0), 0);

  // A programar: preventivas "Novo" cujo prazo cobre algum dia da semana a partir de hoje
  const fromDay = today && today > weekStart ? today : weekStart;
  const toPlan = useMemo<ToPlanGroup[]>(() => {
    const m = new Map<string, ServiceOrder[]>();
    unitOrders
      .filter((o) => o.status === 'Novo' && (!o.startDate || o.startDate.slice(0, 10) <= weekEnd) && (!o.endDate || o.endDate.slice(0, 10) >= fromDay))
      .forEach((o) => m.set(localKey(o), [...(m.get(localKey(o)) || []), o]));
    return Array.from(m.entries())
      .map(([key, list]) => ({ key, orders: list, minEnd: list.reduce((min, o) => (o.endDate && (!min || o.endDate.slice(0, 10) < min) ? o.endDate.slice(0, 10) : min), '') }))
      .sort((a, b) => (a.minEnd || '9999').localeCompare(b.minEnd || '9999') || a.key.localeCompare(b.key));
  }, [unitOrders, weekEnd, fromDay]);
  const notYet = unitOrders.filter((o) => o.status === 'Novo' && !!o.startDate && o.startDate.slice(0, 10) > weekEnd && o.startDate.slice(0, 10) <= addDays(weekEnd, 7)).length;
  // Locais para um bloco novo: os das preventivas a programar e os dos chamados sem dia
  const localOptions = (() => {
    const m = new Map<string, number>();
    toPlan.forEach((g) => m.set(g.key, g.orders.length));
    [...wosNew, ...wosNoDay].forEach((w) => {
      const k = `${w.comarca || ''}|${w.execAddressText || ''}`;
      m.set(k, (m.get(k) || 0) + 1);
    });
    return Array.from(m.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => a.key.localeCompare(b.key));
  })();

  // Onde cada pessoa está nesta semana
  const placeInWeek = (mat: string, except: string): { label: string; resp: boolean } | null => {
    for (const t of here) {
      if (t.matricula === mat) return { label: teamLabel(t), resp: true };
      if (t.matricula !== except && weekMembers(t).some((m) => m.matricula === mat)) return { label: teamLabel(t), resp: false };
    }
    return null;
  };
  const baseTeamOf = (mat: string, except: string) => here.find((t) => t.matricula !== except && t.members.some((m) => m.matricula === mat));
  // Quem vai com o responsável nesses dias (equipe da semana; ausente em algum dia fica marcado)
  const teamPeople = (resp: string, s: string, e: string) => {
    const t = here.find((x) => x.matricula === resp);
    const list = [{ matricula: resp, name: respNameOf(resp) }, ...(t ? weekMembers(t) : []).map((m) => ({ matricula: m.matricula, name: m.name }))];
    const range = days.filter((d) => d >= s && d <= e);
    return list.map((p) => ({ ...p, absent: range.some((d) => !!absOn(p.matricula, d)) }));
  };

  // Resumo (igual ao topo do PDF)
  const teamPeopleSet = new Set<string>(here.flatMap((t) => [t.matricula, ...weekMembers(t).map((m) => m.matricula)]));
  const efetivo = teamPeopleSet.size;
  const absentInTeams = Array.from(teamPeopleSet).filter((m) => absentDays(m).length > 0).length;
  const absentCount = new Set(myAbs.map((a) => a.matricula)).size;
  const openCount = wosNew.length + wosNoDay.length;
  const pernoites = weekLots.reduce((n, l) => n + (l.nights || []).filter((d) => d >= weekStart && d <= weekEnd).length * (l.overnight?.people || 0), 0);

  // Gravação da semana: só o que mudou; a tela já mostra a mudança
  const patch = async (change: { days?: Record<string, { kind: DayMarkKind; text: string } | null>; teams?: Record<string, OrderParticipant[] | null> }, logText?: string): Promise<boolean> => {
    setMsg(null);
    try {
      await dbPatchWeekPlan({ unit, company, weekStart }, user.name, change, logText);
      setPlan((prev) => {
        const next: WeekPlan = { ...(prev || { unit, company, weekStart, updatedAt: '', updatedBy: '' }), days: { ...(prev?.days || {}) }, teams: { ...(prev?.teams || {}) } };
        Object.entries(change.days || {}).forEach(([k, v]) => (v === null ? delete next.days![k] : (next.days![k] = v)));
        Object.entries(change.teams || {}).forEach(([k, v]) => (v === null ? delete next.teams![k] : (next.teams![k] = v)));
        if (logText) next.log = [...(prev?.log || []), { at: new Date().toISOString(), by: user.name, text: logText }];
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
    return patch({ teams: change }, `Equipe da semana da ${teamLabel(t)}: ${members.map((m) => m.name.split(' ')[0]).join(', ') || 'só o responsável'}`);
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
    return patch({ teams: change }, `Equipe da semana da ${teamLabel(t)} voltou para a cadastrada`);
  };
  const saveMark = (index: number, m: { kind: DayMarkKind; text: string } | null) => {
    const d = days[index];
    return patch({ days: { [d]: m } }, m ? `Marcou ${DAY_LABEL[index].toLowerCase()} ${br(d)}: ${MARK_LABEL[m.kind].toLowerCase()}${m.text ? ` (${m.text})` : ''}` : `Desmarcou ${DAY_LABEL[index].toLowerCase()} ${br(d)}`);
  };
  const saveVisit = async (t: UsualTeam, lotId: string, on: boolean): Promise<boolean> => {
    const lot = weekLots.find((l) => l.id === lotId);
    const id = `${t.matricula}_${lotId}`;
    const text = `${on ? '' : 'Deixou de acompanhar: '}${teamLabel(t)}${on ? ' acompanha' : ' →'} ${lot ? `${teamLabelOf(lot.technicianMatricula)} · ${lot.local ? localLabel(lot.local) : 'bloco do PMOC'}` : 'bloco'}`;
    try {
      await dbSetWeekVisit({ unit, company, weekStart }, user.name, id, on ? { resp: t.matricula, lotId } : null, text);
      setPlan((prev) => {
        const base: WeekPlan = prev || { unit, company, weekStart, updatedAt: '', updatedBy: '' };
        const visits = { ...(base.visits || {}) };
        if (on) visits[id] = { resp: t.matricula, lotId };
        else delete visits[id];
        return { ...base, visits, log: [...(base.log || []), { at: new Date().toISOString(), by: user.name, text }] };
      });
      return true;
    } catch (err: any) {
      setMsg({ ok: false, text: err?.code === 'permission-denied' ? 'O banco recusou: seu perfil não tem "Programar" nesta gerência.' : `Não foi possível salvar: ${err?.message || err}` });
      return false;
    }
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
  const techTeams = here.filter(isTech).map((t) => ({ matricula: t.matricula, label: teamLabel(t), name: respNameOf(t.matricula) }));

  const sel = 'h-9 px-2 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900';
  const card = 'rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b1220]';
  const colBg = (i: number) => (plan?.days?.[days[i]] ? 'bg-rose-50/70 dark:bg-rose-950/20' : i >= 5 ? 'bg-slate-50 dark:bg-slate-900/40' : '');
  const stat = (label: string, value: React.ReactNode, warn = false) => (
    <div key={label} className={`px-3 py-2 rounded-xl border ${warn ? 'border-amber-200 bg-amber-50 dark:bg-amber-950/30' : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b1220]'}`}>
      <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`text-base font-black ${warn ? 'text-amber-700' : 'text-slate-900 dark:text-white'}`}>{value}</p>
    </div>
  );
  const badge = (cls: string, text: React.ReactNode, key: string) => (
    <p key={key} className={`mt-1 text-[9px] font-bold rounded px-1 inline-block border ${cls}`}>
      {text}
    </p>
  );
  const counts = (list: ServiceOrder[], total: number, chamados = 0) => {
    const done = list.filter((o) => o.status === 'Concluída').length;
    const late = list.filter((o) => o.status === 'Atrasada').length;
    const run = list.filter((o) => o.status === 'Em Execução').length;
    return (
      <>
        {total > 0 && (
          <p className="text-[10px] font-bold text-emerald-700 flex items-center gap-1 mt-0.5">
            <ClipboardCheck className="w-3 h-3" />
            {total} preventiva{total > 1 ? 's' : ''}
          </p>
        )}
        {chamados > 0 && (
          <p className="text-[10px] font-bold text-indigo-700 flex items-center gap-1 mt-0.5">
            <Wrench className="w-3 h-3" />
            {chamados} chamado{chamados > 1 ? 's' : ''}
          </p>
        )}
        {(done > 0 || run > 0 || late > 0) && (
          <p className="text-[9px] font-bold text-slate-500 flex flex-wrap gap-x-1.5">
            {done > 0 && (
              <span className="flex items-center gap-0.5">
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                {done} concluída{done > 1 ? 's' : ''}
              </span>
            )}
            {run > 0 && <span className="text-blue-700">{run} em execução</span>}
            {late > 0 && <span className="text-amber-700 font-black">{late} atrasada{late > 1 ? 's' : ''}</span>}
          </p>
        )}
      </>
    );
  };

  // Um item da grade (bloco, lote do PMOC, programadas sem bloco, acompanhamento)
  const itemCard = (it: Placed, t: UsualTeam | null, title: string) => {
    if (it.kind === 'visit')
      return (
        <button
          type="button"
          onClick={() => t && !readOnly && setModal({ kind: 'visit', team: t })}
          className="h-full w-full text-left p-1.5 rounded-lg border border-dashed border-slate-400 bg-slate-100 dark:bg-slate-800/60 cursor-pointer"
        >
          <p className="text-[10px] font-black text-slate-700 dark:text-slate-200 leading-tight flex items-start gap-1">
            <Eye className="w-3 h-3 mt-px shrink-0" />
            {it.lot.local ? localLabel(it.lot.local) : 'Bloco do PMOC'}
          </p>
          <p className="text-[9px] font-bold text-slate-500 mt-0.5">acompanha a {it.of}</p>
        </button>
      );
    if (it.kind === 'loose')
      return (
        <button
          type="button"
          onClick={() => setModal({ kind: 'list', title: `${title} · ${it.comarca}`, sub: it.address || 'Preventivas programadas sem bloco (pela lista ou remarcadas).', orders: it.orders })}
          className="h-full w-full text-left p-1.5 rounded-lg border border-dashed border-indigo-300 bg-indigo-50/40 dark:bg-indigo-950/30 hover:border-indigo-500 cursor-pointer"
        >
          <p className="text-[10px] font-black text-slate-800 dark:text-slate-100 leading-tight flex items-start gap-1">
            <MapPin className="w-3 h-3 mt-px shrink-0 text-indigo-600" />
            {it.comarca}
          </p>
          {it.address && <p className="text-[9px] text-slate-500 leading-tight truncate ml-4">{it.address}</p>}
          {counts(it.orders, it.orders.length)}
          <p className="mt-0.5 text-[9px] font-bold text-indigo-700">sem bloco (lista ou remarcada)</p>
        </button>
      );
    const { lot } = it;
    const local = lot.local ? localLabel(lot.local) : '';
    const firstLocal = it.orders[0] ? localLabel({ comarca: it.orders[0].comarca || '', address: it.orders[0].addressText || '' }) : 'Lote do PMOC';
    const nightsHere = (lot.nights || []).filter((d) => d >= days[it.from] && d <= days[it.to]).length;
    return (
      <button
        type="button"
        onClick={() => setModal({ kind: 'block', lot })}
        className={`h-full w-full text-left p-1.5 rounded-lg border cursor-pointer ${
          it.mine ? 'bg-white dark:bg-[#0b1220] border-slate-200 dark:border-slate-700 hover:border-indigo-400' : 'border-dashed border-indigo-300 bg-indigo-50/40 dark:bg-indigo-950/30 hover:border-indigo-500'
        }`}
        style={it.mine ? { borderLeft: '4px solid #4f46e5' } : undefined}
      >
        <p className="text-[10px] font-black text-slate-900 dark:text-slate-100 leading-tight flex items-start gap-1">
          <MapPin className="w-3 h-3 mt-px shrink-0 text-indigo-600" />
          {local || firstLocal}
        </p>
        {counts(it.orders, lot.orderIds.length, lot.woIds?.length || 0)}
        {nightsHere > 0 && lot.overnight && (
          <p className="mt-1 px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-950/50 border border-sky-200 dark:border-sky-900 text-[9px] font-black text-sky-800 dark:text-sky-200 flex items-center gap-1">
            <Moon className="w-3 h-3" />
            {nightsHere} noite{nightsHere > 1 ? 's' : ''} × {lot.overnight.people} = {nightsHere * lot.overnight.people} pernoites
          </p>
        )}
        {lot.note && <p className="mt-0.5 text-[9px] text-slate-500 truncate">{lot.note}</p>}
        {!it.mine && <p className="mt-0.5 text-[9px] font-bold text-indigo-700">programado no PMOC</p>}
      </button>
    );
  };

  // Linha da grade: faixas (blocos que se cruzam ficam um embaixo do outro), "+" nos dias livres e ausentes do dia
  const gridRow = (key: string, head: React.ReactNode, items: GridItem[], t: UsualTeam | null, title: string, offFor: (d: string) => string[], extraCls = '') => {
    const { placed, lanes } = placeLanes(items);
    const covered = new Set(placed.flatMap((p) => Array.from({ length: p.to - p.from + 1 }, (_, k) => p.from + k)));
    const offs = days.map((d) => offFor(d));
    const hasOff = offs.some((o) => o.length > 0);
    const rows = lanes + (hasOff ? 1 : 0);
    const tech = !!t && isTech(t);
    return (
      <div key={key} className={`grid border-b border-slate-200 dark:border-slate-800 ${extraCls}`} style={{ gridTemplateColumns: COLS, gridTemplateRows: `repeat(${rows}, auto)` }}>
        <div className="p-3" style={{ gridColumn: '1', gridRow: `1 / span ${rows}` }}>
          {head}
        </div>
        {days.map((d, i) => (
          <div key={`bg${d}`} className={colBg(i)} style={{ gridColumn: `${2 + i}`, gridRow: `1 / span ${rows}` }} />
        ))}
        {placed.map((p) => (
          <div key={p.id} className="p-1 relative" style={{ gridColumn: `${2 + p.from} / span ${p.to - p.from + 1}`, gridRow: `${p.lane + 1}` }}>
            {itemCard(p, t, title)}
          </div>
        ))}
        {t &&
          days.map((d, i) =>
            covered.has(i) ? null : (
              <div key={`add${d}`} className="p-1 relative" style={{ gridColumn: `${2 + i}`, gridRow: `1 / span ${lanes}` }}>
                {tech && canProgram && d >= todayStr ? (
                  <button
                    type="button"
                    title="Novo bloco"
                    onClick={() => setModal({ kind: 'block', lot: null, team: t.matricula, days: [d, d] })}
                    className="h-full min-h-[52px] w-full rounded-lg border border-dashed border-slate-200 dark:border-slate-700 text-slate-300 hover:text-indigo-600 hover:border-indigo-300 flex items-center justify-center cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                ) : !tech && !readOnly ? (
                  <button
                    type="button"
                    title="Acompanhar um bloco de outra equipe"
                    onClick={() => setModal({ kind: 'visit', team: t })}
                    className="h-full min-h-[52px] w-full rounded-lg border border-dashed border-slate-200 dark:border-slate-700 text-slate-300 hover:text-slate-600 hover:border-slate-400 flex items-center justify-center cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <div className="min-h-[52px]" />
                )}
              </div>
            )
          )}
        {hasOff &&
          days.map((d, i) =>
            offs[i].length ? (
              <p key={`off${d}`} className="px-1 pb-1 text-[9px] font-bold text-rose-600 leading-tight relative" style={{ gridColumn: `${2 + i}`, gridRow: `${rows}` }}>
                ausente: {offs[i].join(', ')}
              </p>
            ) : null
          )}
      </div>
    );
  };

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
        {company && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setModal({ kind: 'history' })} className={`${sel} px-3 flex items-center gap-1.5 cursor-pointer`}>
              <History className="w-4 h-4" />
              Histórico
            </button>
            {!readOnly && (
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
        )}
      </div>

      {msg && <p className={`text-xs font-bold ${msg.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{msg.text}</p>}
      {unitCompanies.length === 0 && !loading && <p className="text-xs text-slate-500">Nenhuma empresa ativa nesta gerência (Configurações › Empresas).</p>}
      {deadlineLocked && !readOnly && (
        <p className="px-3 py-2 rounded-lg border border-rose-200 bg-rose-50 text-[11px] font-bold text-rose-800">
          Prazo de planejamento da {unit} vencido: os blocos ficam só para consulta. Peça ao Super Administrador para estender o prazo.
        </p>
      )}

      {company && (
        <>
          <div className="flex flex-wrap gap-2">
            {stat('Efetivo', efetivo)}
            {stat('Disponível', efetivo - absentInTeams)}
            {stat('Equipes', here.length)}
            {stat('Ausentes', absentCount, absentCount > 0)}
            {stat('Preventivas programadas', prevs.length)}
            {stat('Pernoites (pessoa)', pernoites)}
            {stat('Chamados programados', woInWeek)}
            {stat('Chamados sem dia', openCount, openCount > 0)}
            {stat(
              'Prazo de planejamento',
              <span className="flex items-center gap-1">
                <Clock className="w-4 h-4" />
                {deadlineValid ? new Date(deadline!).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'sem prazo'}
              </span>,
              deadlineValid
            )}
          </div>

          {!loading && here.length === 0 && (
            <p className={`${card} p-6 text-center text-sm text-slate-500`}>Nenhuma equipe da {companyName} ainda. Monte as equipes na aba Equipes: elas viram as linhas da semana.</p>
          )}

          <div className={`grid grid-cols-1 ${!pastWeek ? '2xl:grid-cols-[minmax(0,1fr)_300px]' : ''} gap-4 items-start`}>
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
                  const respName = respNameOf(t.matricula);
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
                  if (!isTech(t)) badges.push(badge('text-slate-600 bg-slate-100 border-slate-200', 'responsável sem perfil de técnico: acompanha blocos', 'notech'));
                  const wo = woCount(t.matricula);
                  const head = (
                    <>
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
                          {wo} chamado{wo > 1 ? 's' : ''} com ele sem dia
                        </button>
                      )}
                    </>
                  );
                  const items = isTech(t) ? itemsOf(t.matricula) : [...visitsOf(t), ...itemsOf(t.matricula)];
                  const offFor = (d: string) =>
                    [t.matricula, ...members.map((m) => m.matricula)].filter((m) => absOn(m, d)).map((m) => (m === t.matricula ? respName : members.find((x) => x.matricula === m)?.name || m).split(' ')[0]);
                  return gridRow(t.matricula, head, items, t, teamLabel(t), offFor);
                })}

                {Array.from(outside.entries()).map(([k, name]) =>
                  gridRow(
                    `fora${k}`,
                    <>
                      <p className="text-[11px] font-black text-slate-600 dark:text-slate-300">FORA DAS EQUIPES</p>
                      <p className="text-[10px] text-slate-500">Preventiva programada para quem não é responsável de equipe: {name}</p>
                    </>,
                    itemsOf(k),
                    null,
                    name,
                    () => [],
                    'bg-slate-50/60 dark:bg-slate-900/40'
                  )
                )}

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
            {!pastWeek && (
              <ToPlanPanel
                groups={toPlan}
                weekEnd={weekEnd}
                notYet={notYet}
                canProgram={canProgram && techTeams.length > 0}
                onProgram={(key) => setModal({ kind: 'block', lot: null, local: key })}
                wosNew={wosNew}
                wosNoDay={wosNoDay}
                techName={(mat) => (mat ? respNameOf(mat) : '')}
                onProgramWo={(w) =>
                  setModal({
                    kind: 'block',
                    lot: null,
                    local: `${w.comarca || ''}|${w.execAddressText || ''}`,
                    wos: [w.id],
                    team: techTeams.some((t) => t.matricula === w.assignedTechnicianMatricula) ? w.assignedTechnicianMatricula : undefined
                  })
                }
              />
            )}
          </div>

          <div className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900 text-[11px] text-indigo-900 dark:text-indigo-200 flex gap-2">
            <Info className="w-4 h-4 shrink-0" />
            <span>
              <b>Bloco</b> = local em dias seguidos (clique para mudar; <b>+</b> no dia livre = novo bloco). Tracejado = programado no PMOC ou sem bloco (abrir e salvar transforma em bloco). Equipe cujo
              responsável não é técnico (ex.: Engenharia) <b>acompanha</b> blocos de outras equipes. Chamado tirado do bloco perde o dia e continua com o técnico.
              {lockReason && (
                <>
                  {' '}
                  <Lock className="inline w-3 h-3" /> {lockReason}
                </>
              )}
            </span>
          </div>
        </>
      )}

      {modal?.kind === 'mark' && <DayMarkModal day={days[modal.index]} index={modal.index} mark={plan?.days?.[days[modal.index]]} onSave={(m) => saveMark(modal.index, m)} onClose={() => setModal(null)} />}
      {modal?.kind === 'team' && (
        <TeamWeekModal
          title={`${teamLabel(modal.team)} — equipe desta semana (${br(weekStart)} a ${br(weekEnd)})`}
          respName={respNameOf(modal.team.matricula)}
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
      {modal?.kind === 'block' && (
        <BlockEditor
          user={user}
          weekKey={{ unit, company, weekStart }}
          days={days}
          today={todayStr}
          lot={modal.lot}
          readOnly={canProgram ? '' : lockReason}
          teams={techTeams}
          initialTeam={modal.team}
          initialLocal={modal.local}
          initialDays={modal.days}
          orders={unitOrders}
          workOrders={companyWos}
          initialWos={modal.wos}
          localOptions={localOptions}
          dayMarks={plan?.days || {}}
          teamPeople={teamPeople}
          costTracking={!!companyObj?.costTracking}
          onSaved={(text) => {
            setModal(null);
            setMsg({ ok: true, text });
            loadWeek();
            // Os chamados mudaram (técnico, dia, bloco): relê os abertos da gerência (Fase 7C-2)
            dbListOpenWorkOrders(unit)
              .then(setOpenWos)
              .catch(() => {});
          }}
          onClose={() => setModal(null)}
          onOpen={openPreventive}
        />
      )}
      {modal?.kind === 'visit' && (
        <VisitModal
          teamLabel={teamLabel(modal.team)}
          options={weekLots
            .filter((l) => l.technicianMatricula !== modal.team.matricula)
            .map((l) => ({
              lotId: l.id,
              text: `${teamLabelOf(l.technicianMatricula)} · ${l.local ? localLabel(l.local) : 'bloco do PMOC'} · ${br(l.periodStart)}${l.periodEnd > l.periodStart ? ` a ${br(l.periodEnd)}` : ''}`
            }))}
          current={Object.values((plan?.visits || {}) as Record<string, WeekVisit>)
            .filter((v) => v.resp === modal.team.matricula)
            .map((v) => v.lotId)}
          onSave={(lotId, on) => saveVisit(modal.team, lotId, on)}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === 'history' && <WeekHistoryModal title={`Histórico da semana ${isoWeek(weekStart)} — ${companyName} · ${unit}`} log={plan?.log || []} onClose={() => setModal(null)} />}
    </div>
  );
}
