import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarRange, CheckCircle2, ChevronDown, ChevronRight, MapPin, QrCode, RotateCcw, Search, Star, Trash2 } from 'lucide-react';
import { Company, HexonUser, PlanningLot, ServiceOrder, UsualTeam } from '../../../types';
import {
  companiesOfUnit,
  dbAddWeekLog,
  dbDetachOrderFromLot,
  dbGetCompanies,
  dbGetLotsByIds,
  dbGetUnitPeopleInfo,
  dbListTeams,
  dbRevertOrderToNew,
  dbSaveServiceOrder,
  isCompanyVisible,
  isSectorVisible,
  localMonthKey,
  localTodayStr,
  runBulk,
  timelineEvent,
  UnitPersonInfo
} from '../../../db/firebase';
import { formatOrderNumber } from '../../../utils/orderNumber';
import { clearHomeLink, peekHomeLink, setHomeLink } from '../../../lib/homeLinks';
import { localKey, localLabel, splitKey } from '../../programacao/blockLayout';
import { DAY_LABEL, mondayOf, weekDays } from '../../programacao/weekDates';
import { teamLabel } from '../../programacao/TeamForm';
import ProgramPreventivesModal from './ProgramPreventivesModal';

// ORDENS DE SERVIÇO › PREVENTIVAS (Fase 7E-1, layout novo; etapa de junção: o planejamento individual que era do PMOC
// vem para cá e programa com o mesmo bloco da Programação). Contadores clicáveis; "A programar" agrupado por local com
// seleção do local inteiro → Programar (técnico, dias, pernoite) = bloco da semana; Programadas/Atrasadas com Técnico,
// Remarcar e Voltar p/ Novo (sozinha sai do bloco, o pernoite do bloco é redividido); Atrasadas voltam para "Novo" em massa.
// Prazo de cada preventiva = o do disparo (não existe mais o prazo de planejamento do Super Admin).

type View = 'aprog' | 'vence' | 'prog' | 'exec' | 'atr' | 'conc' | 'nexec' | 'canc';
const VIEWS: { key: View; label: string; tone: string }[] = [
  { key: 'aprog', label: 'A programar', tone: 'text-sky-700 dark:text-sky-400' },
  { key: 'vence', label: 'Vencem nesta semana', tone: 'text-rose-600' },
  { key: 'prog', label: 'Programadas', tone: 'text-indigo-700 dark:text-indigo-400' },
  { key: 'exec', label: 'Em execução', tone: 'text-violet-700 dark:text-violet-400' },
  { key: 'atr', label: 'Atrasadas', tone: 'text-amber-600' },
  { key: 'conc', label: 'Concluídas no mês', tone: 'text-emerald-700 dark:text-emerald-400' },
  { key: 'nexec', label: 'Não executadas', tone: 'text-slate-500' },
  { key: 'canc', label: 'Canceladas', tone: 'text-slate-400' }
];
const CLOSED = ['Concluída', 'Não Executada', 'Cancelada'];
const ST_CHIP: Record<string, string> = {
  Novo: 'border-sky-200 bg-sky-50 text-sky-700',
  Planejada: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  'Em Execução': 'border-violet-200 bg-violet-50 text-violet-700',
  Atrasada: 'border-amber-200 bg-amber-50 text-amber-700',
  Concluída: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  'Não Executada': 'border-rose-200 bg-rose-50 text-rose-700',
  Cancelada: 'border-slate-200 bg-slate-50 text-slate-500'
};
const PAGE = 50;
const GROUP_PAGE = 60;
const br = (d?: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');
const wd = (d: string) => {
  const n = new Date(`${d}T12:00:00`).getDay();
  return DAY_LABEL[(n + 6) % 7].toLowerCase();
};
const dayRange = (a?: string, b?: string) => {
  const s = (a || '').slice(0, 10);
  const e = (b || a || '').slice(0, 10);
  if (!s) return '—';
  return s === e ? `${wd(s)} ${br(s)}` : `${wd(s)} ${br(s)} a ${wd(e)} ${br(e)}`;
};
const prazo = (o: ServiceOrder) => (o.startDate || o.endDate ? `${br(o.startDate)} a ${br(o.endDate)}` : '—');
const assetText = (o: ServiceOrder) => (o.isSurvey ? o.title : o.assetName || o.title);

interface Props {
  user: HexonUser;
  orders: ServiceOrder[];
  visibleUnits: string[] | null;
  visibleCompanies: string[] | null;
  activeUnit?: string; // quem vê todas as gerências: a gerência escolhida (as OS carregadas são só dela)
  unitOptions?: string[];
  onActiveUnitChange?: (unit: string) => void;
  canProgram: boolean; // "Programar"
  canDelete: boolean; // Super Administrador: excluir preventivas "Novo"
  canOpenProgramacao: boolean;
  onOpen: (o: ServiceOrder) => void;
  onDelete: (ids: string[]) => void;
  onReload: () => void;
  onOpenScan: () => void;
  onNavigate?: (tab: string) => void;
  search: string;
  setSearch: (v: string) => void;
}

export default function PreventivesBoard(props: Props) {
  const { user, orders, visibleUnits, visibleCompanies, activeUnit, unitOptions, onActiveUnitChange, canProgram, canDelete, onOpen, onDelete, onReload, onOpenScan, search, setSearch } = props;
  const today = localTodayStr();
  const monthKey = localMonthKey();
  const weekEnd = weekDays(mondayOf(new Date()))[6];

  // Gerência: quem vê todas escolhe uma (o aparelho guarda só ela); perfil com várias gerências escolhe na tela
  const units = activeUnit ? (unitOptions && unitOptions.length ? unitOptions : [activeUnit]) : visibleUnits || [];
  const [ownUnit, setOwnUnit] = useState(() => (visibleUnits || [])[0] || '');
  const unit = activeUnit || ownUnit;
  const changeUnit = (u: string) => (activeUnit && onActiveUnitChange ? onActiveUnitChange(u) : setOwnUnit(u));

  const [companies, setCompanies] = useState<Company[]>([]);
  const [company, setCompany] = useState('Todas');
  const [teams, setTeams] = useState<UsualTeam[]>([]);
  const [people, setPeople] = useState<UnitPersonInfo[]>([]);
  const [view, setView] = useState<View>(() => (peekHomeLink<View>('preventives-view') as View) || 'aprog');
  // Veio com busca (Semana › "Abrir", Início › técnico): abre no 1º contador que tem resultado
  const [autoView, setAutoView] = useState(() => !!search.trim() && !peekHomeLink('preventives-view'));
  const [comarca, setComarca] = useState('');
  const [tech, setTech] = useState('');
  const [periodicity, setPeriodicity] = useState('');
  const [day, setDay] = useState('');
  const [grouped, setGrouped] = useState(true);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [groupLimit, setGroupLimit] = useState(GROUP_PAGE);
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [lots, setLots] = useState<Record<string, PlanningLot | null>>({});
  const [programming, setProgramming] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<{ id: string; mode: 'tech' | 'date' | 'revert' } | null>(null);
  const [newTech, setNewTech] = useState('');
  const [newStart, setNewStart] = useState('');
  const [newEnd, setNewEnd] = useState('');
  const [weekendOk, setWeekendOk] = useState(false);
  const [rowError, setRowError] = useState('');
  const [busy, setBusy] = useState(false);
  const [askRevert, setAskRevert] = useState<'sel' | 'all' | null>(null);

  useEffect(() => clearHomeLink('preventives-view'), []);
  useEffect(() => {
    dbGetCompanies()
      .then(setCompanies)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!unit) return;
    dbListTeams(unit)
      .then(setTeams)
      .catch(() => setTeams([]));
    dbGetUnitPeopleInfo(unit)
      .then(setPeople)
      .catch(() => setPeople([]));
  }, [unit]);
  const unitCompanies = useMemo(() => companiesOfUnit(companies, unit).filter((c) => isCompanyVisible(c.id, visibleCompanies)), [companies, unit, visibleCompanies]);
  useEffect(() => {
    if (company !== 'Todas' && companies.length > 0 && !unitCompanies.some((c) => c.id === company)) setCompany(unitCompanies.length === 1 ? unitCompanies[0].id : 'Todas');
    if (company === 'Todas' && unitCompanies.length === 1 && visibleCompanies !== null) setCompany(unitCompanies[0].id);
  }, [unitCompanies.map((c) => c.id).join('|')]);
  const companyName = (id?: string) => (id ? companies.find((c) => c.id === id)?.name || id : '');
  useEffect(() => {
    setSel(new Set());
    setPage(1);
    setEditing(null);
    setAskRevert(null);
  }, [view, unit, company]);
  useEffect(() => setPage(1), [search, comarca, tech, periodicity, day]);

  // Preventivas da gerência e empresa; fechadas só as do mês atual (as antigas ficam na Consulta do PMOC)
  const base = useMemo(
    () =>
      orders.filter((o) => {
        if (!(o.unit ? o.unit === unit : isSectorVisible(o.sector, [unit]))) return false;
        if (company === 'Todas' ? !isCompanyVisible(o.company, visibleCompanies) : o.company !== company) return false;
        return !CLOSED.includes(o.status) || o.closedMonth === monthKey;
      }),
    [orders, unit, company, visibleCompanies, monthKey]
  );
  const comarcas = useMemo(() => Array.from(new Set<string>(base.map((o) => o.comarca || o.surveyLocation || '').filter(Boolean))).sort((a, b) => a.localeCompare(b)), [base]);
  const techNames = useMemo(() => Array.from(new Set<string>(base.map((o) => o.assignedTechnician || '').filter(Boolean))).sort((a, b) => a.localeCompare(b)), [base]);
  const periodicities = useMemo(() => Array.from(new Set<string>(base.map((o) => o.periodicity || '').filter(Boolean))).sort((a, b) => a.localeCompare(b)), [base]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase().replace(/^#/, '');
    return base.filter((o) => {
      if (comarca && (o.comarca || o.surveyLocation || '') !== comarca) return false;
      if (tech && (o.assignedTechnician || '') !== tech) return false;
      if (periodicity && (o.periodicity || '') !== periodicity) return false;
      if (day) {
        const s = (o.scheduledDate || '').slice(0, 10);
        const e = (o.scheduledEndDate || o.scheduledDate || '').slice(0, 10);
        if (!s || s > day || e < day) return false;
      }
      if (!q) return true;
      return [o.id, formatOrderNumber(o.id), o.title, o.assetName, o.assetCode, o.comarca, o.addressText, o.assignedTechnician].some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [base, search, comarca, tech, periodicity, day]);
  const inView = (o: ServiceOrder, v: View) =>
    v === 'aprog'
      ? o.status === 'Novo'
      : v === 'vence'
        ? o.status === 'Novo' && !!o.endDate && o.endDate.slice(0, 10) <= weekEnd
        : v === 'prog'
          ? o.status === 'Planejada'
          : v === 'exec'
            ? o.status === 'Em Execução'
            : v === 'atr'
              ? o.status === 'Atrasada'
              : v === 'conc'
                ? o.status === 'Concluída'
                : v === 'nexec'
                  ? o.status === 'Não Executada'
                  : o.status === 'Cancelada';
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    VIEWS.forEach((v) => (c[v.key] = filtered.filter((o) => inView(o, v.key)).length));
    return c;
  }, [filtered, weekEnd]);
  useEffect(() => {
    if (!autoView || base.length === 0) return;
    const first = VIEWS.find((v) => counts[v.key] > 0);
    if (first) setView(first.key);
    setAutoView(false);
  }, [autoView, base.length, counts]);
  const list = useMemo(() => {
    const l = filtered.filter((o) => inView(o, view));
    const toPlan = view === 'aprog' || view === 'vence';
    return l.sort((a, b) =>
      toPlan
        ? (a.endDate || '').localeCompare(b.endDate || '') || localKey(a).localeCompare(localKey(b)) || a.id.localeCompare(b.id)
        : (a.scheduledDate || '').localeCompare(b.scheduledDate || '') || a.id.localeCompare(b.id)
    );
  }, [filtered, view, weekEnd]);
  const toPlanView = view === 'aprog' || view === 'vence';
  const actionsView = view === 'prog' || view === 'atr';
  const selectable = toPlanView ? canProgram || canDelete : view === 'atr' && canProgram;

  // Agrupado por local (A programar / Vencem): o mais urgente primeiro
  const groups = useMemo(() => {
    if (!toPlanView || !grouped) return [];
    const m = new Map<string, ServiceOrder[]>();
    list.forEach((o) => m.set(localKey(o), [...(m.get(localKey(o)) || []), o]));
    return Array.from(m.entries()).sort((a, b) => (a[1][0].endDate || '').localeCompare(b[1][0].endDate || '') || a[0].localeCompare(b[0]));
  }, [list, toPlanView, grouped]);
  const searching = !!(search.trim() || comarca || tech || periodicity || day);
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const pageRows = list.slice((Math.min(page, pages) - 1) * PAGE, Math.min(page, pages) * PAGE);

  // "Veio de": os blocos/lotes das linhas da página (1 leitura por bloco que ainda não foi lido)
  const lotIdsKey = actionsView || view === 'exec' || view === 'conc' || view === 'nexec' ? pageRows.map((o) => o.lotId || '').join('|') : '';
  useEffect(() => {
    const missing = Array.from(new Set<string>(lotIdsKey.split('|').filter((id) => id && !(id in lots))));
    if (missing.length === 0) return;
    dbGetLotsByIds(missing)
      .then((found) =>
        setLots((prev) => {
          const next = { ...prev };
          missing.forEach((id) => (next[id] = found.find((l) => l.id === id) || null));
          return next;
        })
      )
      .catch(() => {});
  }, [lotIdsKey]);
  const teamOf = (mat: string) => teams.find((t) => t.matricula === mat);
  const cameFrom = (o: ServiceOrder) => {
    if (!o.lotId) return { text: 'Pela lista (sem bloco)', lot: null as PlanningLot | null };
    const l = lots[o.lotId];
    if (l === undefined) return { text: '…', lot: null };
    if (!l || l.removedAt) return { text: 'Bloco tirado', lot: null };
    if (l.source === 'programacao') {
      const t = teamOf(l.technicianMatricula);
      return { text: `Bloco · ${t ? teamLabel(t) : l.technicianName}`, lot: l };
    }
    return { text: 'Lote antigo do PMOC', lot: null };
  };
  const openWeek = (l: PlanningLot) => {
    setHomeLink('programacao-week', { unit: l.unit, company: l.company || '', weekStart: l.weekStart || mondayOf(new Date(`${l.periodStart}T12:00:00`)) });
    props.onNavigate?.('programacao');
  };

  // Seleção
  const selOrders = list.filter((o) => sel.has(o.id));
  const toggle = (ids: string[], on: boolean) =>
    setSel((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  const selPlaces = Array.from(new Set<string>(selOrders.map(localKey)));
  const selCompanies = Array.from(new Set<string>(selOrders.map((o) => o.company || '')));
  const startProgram = () => {
    setMsg(null);
    if (selCompanies.length > 1) return setMsg({ ok: false, text: 'As preventivas marcadas são de empresas diferentes: programe uma empresa por vez (escolha a empresa no topo).' });
    if (!selCompanies[0] || !companies.some((c) => c.id === selCompanies[0]))
      return setMsg({ ok: false, text: 'Há preventiva sem empresa gravada: peça ao Super Administrador para corrigir (Programação › Semana › "Corrigir as empresas").' });
    setProgramming(true);
  };

  // Ações de uma programada (sozinha: sai do bloco, como no PMOC)
  const techsFor = (o: ServiceOrder) => people.filter((p) => p.login && p.perfil === 'Profissional' && (!o.company || p.companies.includes(o.company)));
  const canRevert = (o: ServiceOrder) => o.status === 'Atrasada' && (!o.endDate || today <= o.endDate.slice(0, 10));
  const canEditRow = (o: ServiceOrder) => canProgram && (o.status === 'Planejada' || canRevert(o));
  const startEdit = (o: ServiceOrder, mode: 'tech' | 'date' | 'revert') => {
    setRowError('');
    setEditing({ id: o.id, mode });
    const s = (o.scheduledDate || '').slice(0, 10);
    const e = (o.scheduledEndDate || o.scheduledDate || '').slice(0, 10);
    setNewStart(s && s >= today ? s : today);
    setNewEnd(e && e >= today ? e : today);
    setNewTech('');
    setWeekendOk(false);
  };
  const isWeekendDay = (d: string) => [0, 6].includes(new Date(`${d}T12:00:00`).getDay());
  const logInWeek = async (o: ServiceOrder, text: string) => {
    const l = o.lotId ? lots[o.lotId] : null;
    if (!l || l.source !== 'programacao' || !l.weekStart || !l.company) return;
    await dbAddWeekLog({ unit: l.unit, company: l.company, weekStart: l.weekStart }, user.name, text).catch(() => {});
  };
  const apply = async (o: ServiceOrder) => {
    if (!editing) return;
    setRowError('');
    const base0: ServiceOrder = { ...o, lotId: undefined, updatedAt: new Date().toISOString() };
    let updated: ServiceOrder;
    let text = '';
    if (editing.mode === 'tech') {
      const t = people.find((p) => p.matricula === newTech);
      if (!t) return setRowError('Escolha o técnico.');
      updated = { ...base0, assignedTechnician: t.name, assignedTechnicianMatricula: t.matricula };
      text = `OS ${formatOrderNumber(o.id)} passou para ${t.name}`;
    } else if (editing.mode === 'date') {
      if (!newStart || !newEnd || newEnd < newStart) return setRowError('Informe o início e o fim.');
      if (newStart < today) return setRowError('Não dá para programar em dia que já passou.');
      if ((o.startDate && newStart < o.startDate.slice(0, 10)) || (o.endDate && newEnd > o.endDate.slice(0, 10))) return setRowError(`Fora do prazo da preventiva (${prazo(o)}).`);
      if ((isWeekendDay(newStart) || isWeekendDay(newEnd)) && !weekendOk) return setRowError('Confirme o trabalho no fim de semana.');
      updated = { ...base0, scheduledDate: newStart, scheduledEndDate: newEnd > newStart ? newEnd : undefined, status: 'Planejada' };
      text = `OS ${formatOrderNumber(o.id)} remarcada para ${dayRange(newStart, newEnd)}`;
    } else {
      updated = { ...base0, status: 'Novo', scheduledDate: '', scheduledEndDate: undefined, assignedTechnician: '', assignedTechnicianMatricula: undefined };
      text = `OS ${formatOrderNumber(o.id)} voltou para "Novo"`;
    }
    const event = editing.mode === 'tech' ? 'Técnico trocado' : editing.mode === 'date' ? 'Remarcada' : 'Voltou para Novo';
    updated = { ...updated, timeline: [...(o.timeline || []), timelineEvent(event, user.name, `${text} (Ordens de Serviço › Preventivas)`)] };
    setBusy(true);
    try {
      if (o.lotId) await dbDetachOrderFromLot(o);
      await dbSaveServiceOrder(updated);
      await logInWeek(o, `${text} pela lista de preventivas (saiu do bloco)`);
      setEditing(null);
      setMsg({ ok: true, text: `${text}.${o.lotId ? ' Saiu do bloco (o pernoite do bloco é redividido entre as que ficam).' : ''}` });
      onReload();
    } catch (err: any) {
      setRowError(`Não foi possível salvar: ${err?.message || err}`);
    } finally {
      setBusy(false);
    }
  };

  // Atrasadas que ainda estão no prazo voltam para "Novo" (marcadas ou todas)
  const revertible = list.filter(canRevert);
  const revertSel = selOrders.filter(canRevert);
  const revertMany = async (which: ServiceOrder[]) => {
    setBusy(true);
    setMsg(null);
    try {
      await runBulk(async () => {
        for (const o of which) {
          await dbRevertOrderToNew(o, user.name, 'Atrasada voltou para "Novo" (Ordens de Serviço › Preventivas)');
          await logInWeek(o, `OS ${formatOrderNumber(o.id)} (atrasada) voltou para "Novo" pela lista de preventivas`);
        }
      });
      setAskRevert(null);
      setSel(new Set());
      setMsg({ ok: true, text: `${which.length} atrasada(s) voltaram para "Novo".` });
      onReload();
    } catch (err: any) {
      setMsg({ ok: false, text: `Não foi possível voltar para "Novo": ${err?.message || err}` });
    } finally {
      setBusy(false);
    }
  };

  const th = 'p-2 text-[10px] font-black uppercase tracking-wider text-slate-500 text-left whitespace-nowrap';
  const td = 'p-2 align-top';
  const sel_ = 'h-9 px-2 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 cursor-pointer';
  const smallBtn = 'px-2 py-1 rounded-md border text-[10px] font-bold cursor-pointer whitespace-nowrap';
  const box = (on: boolean, onChange: (v: boolean) => void, label: string, disabled = false) => (
    <input type="checkbox" checked={on} disabled={disabled} onChange={(ev) => onChange(ev.target.checked)} onClick={(ev) => ev.stopPropagation()} className="w-4 h-4 cursor-pointer" aria-label={label} />
  );
  const chip = (o: ServiceOrder) => <span className={`px-2 py-0.5 rounded-full border text-[10px] font-black whitespace-nowrap ${ST_CHIP[o.status] || ''}`}>{o.status === 'Novo' ? 'A programar' : o.status}</span>;
  const numCell = (o: ServiceOrder) => <span className="font-mono font-black text-indigo-700 dark:text-indigo-400 whitespace-nowrap">#{formatOrderNumber(o.id)}</span>;
  const trash = (o: ServiceOrder) =>
    canDelete && o.status === 'Novo' ? (
      <button type="button" onClick={(ev) => { ev.stopPropagation(); onDelete([o.id]); }} className="p-1.5 rounded-md border border-rose-100 bg-rose-50 text-rose-600 cursor-pointer" title="Excluir preventiva">
        <Trash2 className="w-3 h-3" />
      </button>
    ) : null;

  const companyCol = company === 'Todas' && unitCompanies.length > 1;
  // Linhas de "A programar"
  const planRow = (o: ServiceOrder, indent: boolean) => (
    <tr key={o.id} onClick={() => onOpen(o)} className="border-b border-slate-100 dark:border-slate-800 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20 cursor-pointer">
      <td className={`${td} w-8 ${indent ? 'pl-5' : ''}`}>{selectable && box(sel.has(o.id), (v) => toggle([o.id], v), `Marcar ${formatOrderNumber(o.id)}`)}</td>
      <td className={td}>{numCell(o)}</td>
      <td className={`${td} text-slate-800 dark:text-slate-100`}>
        {assetText(o)}
        {!grouped && <span className="block text-[10px] text-slate-500">{localLabel(splitKey(localKey(o)))}</span>}
      </td>
      <td className={`${td} font-mono text-slate-600 dark:text-slate-300`}>{o.isSurvey ? '—' : o.assetCode || '—'}</td>
      <td className={`${td} text-slate-600 dark:text-slate-300`}>{o.periodicity || '—'}</td>
      <td className={`${td} whitespace-nowrap ${o.endDate && o.endDate.slice(0, 10) <= weekEnd ? 'text-rose-600 font-bold' : 'text-slate-600 dark:text-slate-300'}`}>{prazo(o)}</td>
      <td className={td}>{chip(o)}</td>
      {companyCol && <td className={`${td} text-[10px] font-bold text-blue-700 dark:text-blue-400`}>{companyName(o.company) || '—'}</td>}
      <td className={`${td} text-right`}>{trash(o)}</td>
    </tr>
  );

  const summaryOf = (l: ServiceOrder[]) => {
    const per = new Map<string, number>();
    l.forEach((o) => per.set(o.periodicity || 'sem periodicidade', (per.get(o.periodicity || 'sem periodicidade') || 0) + 1));
    const perTxt = Array.from(per.entries())
      .map(([p, n]) => `${n} ${n > 1 ? p.toLowerCase().replace(/l$/, 'is').replace(/a$/, 'as') : p.toLowerCase()}`)
      .join(' + ');
    const starts = new Set(l.map((o) => o.startDate || ''));
    const ends = new Set(l.map((o) => o.endDate || ''));
    const pz = starts.size === 1 && ends.size === 1 ? `prazo ${prazo(l[0])}` : `prazos até ${br(l.reduce((m, o) => ((o.endDate || '') > m ? o.endDate || '' : m), ''))}`;
    return `${perTxt} · ${pz}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
        <div>
          <h2 className="text-xl font-black tracking-tight text-slate-900 dark:text-white">Preventivas</h2>
          <p className="text-xs text-slate-500 mt-1">
            Acompanhar e programar pela lista. A semana inteira das equipes se monta na aba <b>Programação</b>. Clique num contador para filtrar e na linha para abrir.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {units.length > 1 ? (
            <select value={unit} onChange={(ev) => changeUnit(ev.target.value)} className={sel_} aria-label="Gerência">
              {units.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          ) : (
            <span className="h-9 px-3 flex items-center text-xs font-black rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">{unit || '—'}</span>
          )}
          {unitCompanies.length > 1 || visibleCompanies === null ? (
            <select value={company} onChange={(ev) => setCompany(ev.target.value)} className={sel_} aria-label="Empresa">
              <option value="Todas">Todas as empresas</option>
              {unitCompanies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : unitCompanies.length === 1 ? (
            <span className="h-9 px-3 flex items-center text-xs font-black rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">{unitCompanies[0].name}</span>
          ) : null}
          <button type="button" onClick={onOpenScan} className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold flex items-center gap-1.5 cursor-pointer">
            <QrCode className="w-4 h-4" />
            Escanear ativo
          </button>
          <button type="button" onClick={onReload} className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold flex items-center gap-1.5 cursor-pointer">
            <RotateCcw className="w-4 h-4" />
            Atualizar
          </button>
        </div>
      </div>

      {!canProgram && <p className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 dark:bg-slate-900 text-[11px] font-bold text-slate-600">Seu perfil só consulta (programar precisa da permissão "Programar").</p>}

      <div className="flex flex-wrap gap-2">
        {VIEWS.filter((v) => v.key !== 'canc' || counts.canc > 0 || view === 'canc').map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => setView(v.key)}
            className={`min-w-[120px] text-left px-3 py-2 rounded-xl border cursor-pointer ${view === v.key ? 'border-indigo-500 ring-2 ring-indigo-200 bg-indigo-50/40 dark:bg-indigo-950/30' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'}`}
          >
            <p className={`text-lg font-black leading-none ${v.tone}`}>{counts[v.key].toLocaleString('pt-BR')}</p>
            <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300 mt-1">{v.label}</p>
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b1220] p-3 flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-[240px]">
          <span className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Buscar</span>
          <span className="relative block">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input value={search} onChange={(ev) => setSearch(ev.target.value)} placeholder="Nº, ativo, patrimônio, local ou técnico" className="w-full h-8 pl-8 pr-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" />
          </span>
        </label>
        <select value={comarca} onChange={(ev) => setComarca(ev.target.value)} className="h-8 px-2 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" aria-label="Comarca">
          <option value="">Comarca: todas</option>
          {comarcas.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={tech} onChange={(ev) => setTech(ev.target.value)} className="h-8 px-2 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" aria-label="Técnico">
          <option value="">Técnico: todos</option>
          {techNames.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={periodicity} onChange={(ev) => setPeriodicity(ev.target.value)} className="h-8 px-2 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" aria-label="Periodicidade">
          <option value="">Periodicidade: todas</option>
          {periodicities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label className="h-8 px-2 flex items-center gap-1 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
          <CalendarRange className="w-3.5 h-3.5 text-slate-400" />
          <input type="date" value={day} onChange={(ev) => setDay(ev.target.value)} className="bg-transparent text-xs" aria-label="Dia programado" title="Dia programado" />
        </label>
        {toPlanView && (
          <button
            type="button"
            onClick={() => setGrouped(!grouped)}
            className={`h-8 px-3 rounded-lg border text-xs font-black flex items-center gap-1 cursor-pointer ${grouped ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300' : 'border-slate-200 dark:border-slate-700 text-slate-600'}`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Agrupar por local
          </button>
        )}
        {searching && (
          <button type="button" onClick={() => { setSearch(''); setComarca(''); setTech(''); setPeriodicity(''); setDay(''); }} className="h-8 px-3 rounded-lg border border-dashed border-slate-300 text-xs font-bold text-slate-500 cursor-pointer">
            Limpar filtros
          </button>
        )}
      </div>

      {msg && (
        <div className={`px-3 py-2 rounded-lg border text-[11px] font-bold flex justify-between gap-2 ${msg.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
          <span>{msg.text}</span>
          <button type="button" onClick={() => setMsg(null)} className="cursor-pointer" title="Fechar">
            ×
          </button>
        </div>
      )}

      {view === 'atr' && canProgram && revertible.length > 0 && (
        <div className="p-3 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 text-xs flex flex-wrap items-center gap-3">
          <AlertTriangle className="w-4 h-4" />
          <span className="flex-1 min-w-[240px] font-bold">
            {revertible.length} atrasada(s) ainda estão no prazo e podem voltar para "Novo" (sem dia e sem técnico) para serem programadas de novo.
          </span>
          {askRevert ? (
            <>
              <span className="font-black">Voltar {askRevert === 'sel' ? revertSel.length : revertible.length} para "Novo"?</span>
              <button type="button" onClick={() => setAskRevert(null)} disabled={busy} className="h-8 px-3 rounded-lg border border-amber-400 bg-white text-[11px] font-black cursor-pointer">
                Cancelar
              </button>
              <button type="button" onClick={() => revertMany(askRevert === 'sel' ? revertSel : revertible)} disabled={busy} className="h-8 px-3 rounded-lg bg-amber-600 text-white text-[11px] font-black cursor-pointer disabled:opacity-50">
                {busy ? 'Voltando…' : 'Confirmar'}
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setAskRevert('sel')} disabled={revertSel.length === 0} className="h-8 px-3 rounded-lg bg-amber-600 text-white text-[11px] font-black cursor-pointer disabled:opacity-40">
                Voltar as {revertSel.length} marcadas p/ Novo
              </button>
              <button type="button" onClick={() => setAskRevert('all')} className="h-8 px-3 rounded-lg border border-amber-400 text-[11px] font-black cursor-pointer">
                Voltar todas as {revertible.length}
              </button>
            </>
          )}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b1220] overflow-hidden">
        <div className="overflow-x-auto">
          {toPlanView ? (
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className={`${th} w-8`} />
                  <th className={th}>Nº</th>
                  <th className={th}>Ativo</th>
                  <th className={th}>Patrimônio</th>
                  <th className={th}>Periodicidade</th>
                  <th className={th}>Prazo</th>
                  <th className={th}>Situação</th>
                  {companyCol && <th className={th}>Empresa</th>}
                  <th className={`${th} w-10`} />
                </tr>
              </thead>
              <tbody>
                {list.length === 0 && (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-slate-400 font-bold">
                      Nenhuma preventiva neste filtro.
                    </td>
                  </tr>
                )}
                {grouped
                  ? groups.slice(0, groupLimit).map(([k, l]) => {
                      const isOpen = searching || open.has(k);
                      const ids = l.map((o) => o.id);
                      const all = ids.every((id) => sel.has(id));
                      const some = !all && ids.some((id) => sel.has(id));
                      const minEnd = l.reduce((m, o) => (o.endDate && (!m || o.endDate < m) ? o.endDate : m), '');
                      const late = !!minEnd && minEnd.slice(0, 10) <= weekEnd;
                      return (
                        <React.Fragment key={k}>
                          <tr
                            className={`${late ? 'bg-rose-50 dark:bg-rose-950/20' : 'bg-slate-50 dark:bg-slate-900'} border-b border-slate-200 dark:border-slate-800 cursor-pointer`}
                            onClick={() => setOpen((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; })}
                          >
                            <td className={td}>{selectable && <span className={some ? 'opacity-60' : ''}>{box(all, (v) => toggle(ids, v), `Marcar o local ${localLabel(splitKey(k))}`)}</span>}</td>
                            <td colSpan={companyCol ? 7 : 6} className={td}>
                              <span className="font-black text-slate-900 dark:text-white flex items-center gap-1 flex-wrap">
                                <MapPin className="w-3.5 h-3.5 text-indigo-600" />
                                {localLabel(splitKey(k))}
                                {l[0].craai && <span className="font-medium text-slate-500">· CRAAI {l[0].craai}</span>}
                                <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-black ${late ? 'bg-rose-600 text-white' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'}`}>{summaryOf(l)}</span>
                                {late && <span className="text-[10px] font-black text-rose-600">vence {minEnd.slice(0, 10) === today ? 'hoje' : `${wd(minEnd.slice(0, 10))} ${br(minEnd)}`}</span>}
                                {(some || all) && <span className="text-[10px] font-black text-indigo-600">{ids.filter((id) => sel.has(id)).length} marcada(s)</span>}
                              </span>
                            </td>
                            <td className={`${td} text-right`}>{isOpen ? <ChevronDown className="w-4 h-4 text-slate-400 inline" /> : <ChevronRight className="w-4 h-4 text-slate-400 inline" />}</td>
                          </tr>
                          {isOpen && l.map((o) => planRow(o, true))}
                        </React.Fragment>
                      );
                    })
                  : pageRows.map((o) => planRow(o, false))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  {selectable && <th className={`${th} w-8`} />}
                  <th className={th}>Nº</th>
                  <th className={th}>Ativo</th>
                  <th className={th}>Local</th>
                  <th className={th}>Dia programado</th>
                  <th className={th}>Técnico</th>
                  {view !== 'canc' && <th className={th}>Veio de</th>}
                  <th className={th}>Prazo</th>
                  <th className={th}>Situação</th>
                  {actionsView && canProgram && <th className={th}>Ações</th>}
                </tr>
              </thead>
              <tbody>
                {list.length === 0 && (
                  <tr>
                    <td colSpan={10} className="p-8 text-center text-slate-400 font-bold">
                      Nenhuma preventiva neste filtro.
                    </td>
                  </tr>
                )}
                {pageRows.map((o) => {
                  const cf = cameFrom(o);
                  const isEd = editing?.id === o.id;
                  return (
                    <React.Fragment key={o.id}>
                      <tr onClick={() => onOpen(o)} className="border-b border-slate-100 dark:border-slate-800 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20 cursor-pointer">
                        {selectable && <td className={td}>{canRevert(o) && box(sel.has(o.id), (v) => toggle([o.id], v), `Marcar ${formatOrderNumber(o.id)}`)}</td>}
                        <td className={td}>{numCell(o)}</td>
                        <td className={`${td} text-slate-800 dark:text-slate-100`}>{assetText(o)}</td>
                        <td className={`${td} text-slate-600 dark:text-slate-300`}>{localLabel(splitKey(localKey(o)))}</td>
                        <td className={`${td} font-bold whitespace-nowrap ${o.status === 'Atrasada' ? 'text-amber-700' : 'text-slate-800 dark:text-slate-100'}`}>{dayRange(o.scheduledDate, o.scheduledEndDate)}</td>
                        <td className={`${td} text-slate-800 dark:text-slate-100 whitespace-nowrap`}>
                          {o.assignedTechnician ? (
                            <>
                              {teamOf(o.assignedTechnicianMatricula || '') && <Star className="inline w-3 h-3 text-amber-500 fill-amber-400 mr-0.5" />}
                              {o.assignedTechnician}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        {view !== 'canc' && (
                          <td className={`${td} text-slate-600 dark:text-slate-300`}>
                            {cf.text}
                            {cf.lot && props.canOpenProgramacao && props.onNavigate && (
                              <button type="button" onClick={(ev) => { ev.stopPropagation(); openWeek(cf.lot!); }} className="block text-[10px] font-bold text-indigo-600 underline cursor-pointer">
                                abrir na Programação
                              </button>
                            )}
                          </td>
                        )}
                        <td className={`${td} text-slate-600 dark:text-slate-300 whitespace-nowrap`}>{prazo(o)}</td>
                        <td className={td}>{chip(o)}</td>
                        {actionsView && canProgram && (
                          <td className={td} onClick={(ev) => ev.stopPropagation()}>
                            {canEditRow(o) ? (
                              <span className="flex gap-1">
                                <button type="button" onClick={() => startEdit(o, 'tech')} className={`${smallBtn} border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300`}>
                                  Técnico
                                </button>
                                <button type="button" onClick={() => startEdit(o, 'date')} className={`${smallBtn} border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300`}>
                                  Remarcar
                                </button>
                                <button type="button" onClick={() => startEdit(o, 'revert')} className={`${smallBtn} border-amber-200 bg-amber-50 text-amber-800`}>
                                  Voltar p/ Novo
                                </button>
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400">{o.status === 'Atrasada' ? 'prazo da preventiva acabou' : '—'}</span>
                            )}
                          </td>
                        )}
                      </tr>
                      {isEd && (
                        <tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
                          <td colSpan={10} className="p-3">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-black text-slate-700 dark:text-slate-200">
                                #{formatOrderNumber(o.id)} — {editing!.mode === 'tech' ? 'trocar o técnico' : editing!.mode === 'date' ? 'remarcar' : 'voltar para "Novo" (sem dia e sem técnico)?'}
                              </span>
                              {editing!.mode === 'tech' && (
                                <select value={newTech} onChange={(ev) => setNewTech(ev.target.value)} className="h-8 px-2 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                                  <option value="">Novo técnico...</option>
                                  {techsFor(o).map((t) => (
                                    <option key={t.matricula} value={t.matricula}>
                                      {t.name} ({t.matricula})
                                    </option>
                                  ))}
                                </select>
                              )}
                              {editing!.mode === 'date' && (
                                <>
                                  <input type="date" value={newStart} min={today} onChange={(ev) => { setNewStart(ev.target.value); if (newEnd < ev.target.value) setNewEnd(ev.target.value); }} className="h-8 px-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" aria-label="Início" />
                                  <span className="text-slate-500">até</span>
                                  <input type="date" value={newEnd} min={newStart} onChange={(ev) => setNewEnd(ev.target.value)} className="h-8 px-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" aria-label="Fim" />
                                  {(isWeekendDay(newStart) || isWeekendDay(newEnd)) && (
                                    <label className="flex items-center gap-1 font-bold text-amber-800 cursor-pointer">
                                      <input type="checkbox" checked={weekendOk} onChange={(ev) => setWeekendOk(ev.target.checked)} className="w-4 h-4" />
                                      Confirmo o fim de semana
                                    </label>
                                  )}
                                  <span className="text-[10px] text-slate-500">Prazo: {prazo(o)}</span>
                                </>
                              )}
                              {o.lotId && <span className="w-full text-[10px] text-slate-500">A preventiva sai do bloco; o pernoite do bloco é redividido entre as que ficam.</span>}
                              <button type="button" onClick={() => setEditing(null)} disabled={busy} className="h-8 px-3 rounded-lg border border-slate-300 text-[11px] font-bold text-slate-600 cursor-pointer">
                                Cancelar
                              </button>
                              <button type="button" onClick={() => apply(o)} disabled={busy} className="h-8 px-3 rounded-lg bg-indigo-600 text-white text-[11px] font-bold cursor-pointer disabled:opacity-50">
                                {busy ? 'Salvando…' : 'Confirmar'}
                              </button>
                              {rowError && <span className="w-full text-[11px] font-bold text-rose-600">{rowError}</span>}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {toPlanView && grouped && groups.length > groupLimit && (
          <button type="button" onClick={() => setGroupLimit(groupLimit + GROUP_PAGE)} className="w-full py-2 text-xs font-black text-indigo-600 border-t border-slate-100 dark:border-slate-800 cursor-pointer">
            Mostrar mais locais ({groups.length - groupLimit})
          </button>
        )}
        {(!toPlanView || !grouped) && pages > 1 && (
          <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs font-bold text-slate-500">
            <span>
              {(Math.min(page, pages) - 1) * PAGE + 1}–{Math.min(Math.min(page, pages) * PAGE, list.length)} de {list.length}
            </span>
            <span className="flex gap-1">
              <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="h-7 px-3 rounded-md border border-slate-200 cursor-pointer disabled:opacity-30">
                Anterior
              </button>
              <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="h-7 px-3 rounded-md border border-slate-200 cursor-pointer disabled:opacity-30">
                Próxima
              </button>
            </span>
          </div>
        )}
        {actionsView && (
          <div className="px-4 py-2 text-[11px] text-slate-500 border-t border-slate-100 dark:border-slate-800">
            <b>Veio de</b>: bloco da Programação (feito na grade ou pela lista), lote antigo do PMOC, ou programada sozinha. Trocar o técnico ou remarcar uma preventiva sozinha <b>tira ela do bloco</b> (o pernoite do bloco é redividido entre as que ficam).
          </div>
        )}
        {toPlanView && selOrders.length > 0 && (
          <div className="sticky bottom-0 px-4 py-3 bg-indigo-600 text-white flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-black">
              {selOrders.length} selecionada{selOrders.length > 1 ? 's' : ''} · {selPlaces.length === 1 ? localLabel(splitKey(selPlaces[0])) : `${selPlaces.length} locais`}
            </span>
            <div className="flex flex-wrap gap-2">
              {canProgram && (
                <button type="button" onClick={startProgram} className="px-3 py-1.5 rounded-lg bg-white text-indigo-700 text-xs font-black cursor-pointer">
                  Programar (técnico, dias, pernoite)
                </button>
              )}
              {canDelete && (
                <button type="button" onClick={() => onDelete(selOrders.map((o) => o.id))} className="px-3 py-1.5 rounded-lg border border-white/60 text-xs font-bold cursor-pointer">
                  Excluir ({selOrders.length})
                </button>
              )}
              <button type="button" onClick={() => setSel(new Set())} className="px-3 py-1.5 rounded-lg border border-white/50 text-xs font-bold cursor-pointer">
                Limpar seleção
              </button>
            </div>
          </div>
        )}
      </div>

      {programming && (
        <ProgramPreventivesModal
          user={user}
          unit={unit}
          company={companies.find((c) => c.id === selCompanies[0])!}
          orders={selOrders}
          unitOrders={orders.filter((o) => (o.unit ? o.unit === unit : isSectorVisible(o.sector, [unit])))}
          people={people}
          teams={teams}
          onClose={() => setProgramming(false)}
          onDone={(text) => {
            setProgramming(false);
            setSel(new Set());
            setMsg({ ok: true, text });
            onReload();
          }}
        />
      )}
    </div>
  );
}
