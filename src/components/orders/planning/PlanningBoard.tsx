import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { HexonUser, OvernightRateSetting, PlanningLot, ServiceOrder } from '../../../types';
import {
  dbDetachOrderFromLot, dbGetManagements, dbGetOvernightRate, dbGetPlanningLots, dbSaveServiceOrder,
  isSectorVisible, localTodayStr, PlanningDeadline, timelineEvent
} from '../../../db/firebase';
import { formatOrderNumber } from '../../../utils/orderNumber';
import UsualTeamEditor from '../execution/UsualTeamEditor';
import ScheduleLotModal from './ScheduleLotModal';
import ScheduledList from './ScheduledList';
import {
  dayBR, isOrderOfTechnician, MONTH_NAMES, monthWeeks, overlaps, parseYmd, scheduledRange, STATUS_ORDER, STATUS_STYLE,
  WEEKDAY_SHORT, ymd
} from './planningUtils';

// PLANEJAMENTO (Etapa 5b): calendário só de dias úteis + painel "A programar" / "Programadas" + visão "Por técnico".
// Seleção: clique num dia; arraste ou Shift+clique para um período. Dias passados: só consulta.

interface Props {
  orders: ServiceOrder[];
  users: HexonUser[];
  userProfile?: HexonUser | null;
  visibleUnits: string[] | null;
  userHasActionPermission?: (actionId: string) => boolean;
  canRevertUnexecutedOrder: (os: ServiceOrder, targetMonthDate?: Date) => boolean;
  deadlines: PlanningDeadline[];
  getCountdownText: (expiresAt: string) => { isExpired: boolean; text: string; hoursLeft: number };
  onReload: () => void;
  onViewOrder: (os: ServiceOrder) => void;
  currentCalendarDate: Date;
  setCurrentCalendarDate: (d: Date) => void;
  activeUnit?: string; // quem vê todas as gerências: a gerência escolhida (as OS carregadas são só dela)
  unitOptions?: string[];
  onActiveUnitChange?: (unit: string) => void;
}

const comarcaOf = (o: ServiceOrder) => o.comarca || o.surveyLocation || 'Sem comarca';

export default function PlanningBoard({
  orders, users, userProfile, visibleUnits, userHasActionPermission, canRevertUnexecutedOrder, deadlines, getCountdownText,
  onReload, onViewOrder, currentCalendarDate, setCurrentCalendarDate, activeUnit, unitOptions, onActiveUnitChange
}: Props) {
  const todayStr = localTodayStr();
  const year = currentCalendarDate.getFullYear();
  const month = currentCalendarDate.getMonth();
  const monthStart = ymd(new Date(year, month, 1));
  const monthEnd = ymd(new Date(year, month + 1, 0));
  const canViewCosts = !!userHasActionPermission?.('view_costs');

  const [unitNames, setUnitNames] = useState<string[]>(visibleUnits || []);
  const [unit, setUnit] = useState<string>(visibleUnits?.[0] || '');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [view, setView] = useState<'calendario' | 'tecnico'>('calendario');
  const [panel, setPanel] = useState<'programar' | 'programadas'>('programar');
  const [sel, setSel] = useState<[string, string] | null>(null);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [search, setSearch] = useState('');
  const [checked, setChecked] = useState<string[]>([]);
  const [lots, setLots] = useState<PlanningLot[]>([]);
  const [overnightRate, setOvernightRate] = useState<OvernightRateSetting | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [weekIdx, setWeekIdx] = useState(0);
  const [teamOf, setTeamOf] = useState<HexonUser | null>(null); // equipe habitual sendo editada

  // Gerências do perfil (ou todas, para quem vê todas)
  useEffect(() => {
    if (activeUnit) {
      setUnitNames(unitOptions && unitOptions.length > 0 ? unitOptions : [activeUnit]);
      setUnit(activeUnit);
      return;
    }
    if (visibleUnits) {
      setUnitNames(visibleUnits);
      if (!visibleUnits.includes(unit)) setUnit(visibleUnits[0] || '');
      return;
    }
    dbGetManagements()
      .then((list) => {
        const names = list.map((m) => m.name).filter((n) => n !== 'Todas');
        setUnitNames(names);
        setUnit((u) => (u && names.includes(u) ? u : names[0] || ''));
      })
      .catch(() => {});
  }, [(visibleUnits || []).join('|'), activeUnit, (unitOptions || []).join('|')]);

  useEffect(() => {
    if (canViewCosts) dbGetOvernightRate().then(setOvernightRate);
  }, [canViewCosts]);

  // Lotes que começam no mês (ou até 31 dias antes, para pegar os que atravessam a virada do mês)
  const loadLots = () => {
    if (!unit) return setLots([]);
    const from = ymd(new Date(year, month, -30));
    dbGetPlanningLots(unit, from, monthEnd).then((list) => setLots(list.filter((l) => overlaps(l.periodStart, l.periodEnd, monthStart, monthEnd))));
  };
  useEffect(loadLots, [unit, year, month]);

  useEffect(() => {
    setSel(null);
    setChecked([]);
    setWeekIdx(0);
  }, [unit, year, month]);

  useEffect(() => {
    const up = () => setDragging(false);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const inUnit = (o: ServiceOrder) => (o.unit ? o.unit === unit : isSectorVisible(o.sector, [unit]));
  const unitOrders = useMemo(() => orders.filter(inUnit), [orders, unit]);
  const technicians = useMemo(
    () => users.filter((u) => u.perfil === 'Profissional' && u.status === 'Ativo' && (u.gerencia === unit || u.gerencia === 'Todas'))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [users, unit]
  );

  // Prazo de planejamento da gerência (só vale para perfis limitados a unidades)
  const deadline = deadlines.find((d) => d.id === unit);
  const countdown = deadline && deadline.expiresAt && deadline.expiresAt !== 'none' ? getCountdownText(deadline.expiresAt) : null;
  const locked = visibleUnits !== null && !!countdown?.isExpired;

  const passFilter = (o: ServiceOrder) => statusFilter.length === 0 || statusFilter.includes(o.status);
  const novoInWindow = (o: ServiceOrder, s: string, e: string) =>
    o.status === 'Novo' && (!o.startDate || o.startDate <= s) && (!o.endDate || o.endDate >= e);
  const scheduledIn = (o: ServiceOrder, s: string, e: string) => {
    if (o.status === 'Novo') return false;
    const r = scheduledRange(o);
    return !!r && overlaps(r[0], r[1], s, e);
  };

  // Contagem do mês por status (chips)
  const monthCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const o of unitOrders) {
      const hit = o.status === 'Novo'
        ? (!o.startDate || o.startDate <= monthEnd) && (!o.endDate || o.endDate >= monthStart)
        : scheduledIn(o, monthStart, monthEnd);
      if (hit) c[o.status] = (c[o.status] || 0) + 1;
    }
    return c;
  }, [unitOrders, monthStart, monthEnd]);

  const dayCounts = (d: string) => {
    const c: Record<string, number> = {};
    for (const o of unitOrders) {
      if (!passFilter(o)) continue;
      if (o.status === 'Novo' ? novoInWindow(o, d, d) : scheduledIn(o, d, d)) c[o.status] = (c[o.status] || 0) + 1;
    }
    return c;
  };

  const weeks = useMemo(() => monthWeeks(year, month), [year, month]);
  const inMonth = (d: string) => parseYmd(d).getMonth() === month;

  // ===== Seleção no calendário =====
  const pick = (d: string, shift: boolean) => {
    if (shift && sel) {
      const a = anchor || sel[0];
      setSel(a <= d ? [a, d] : [d, a]);
    } else {
      setAnchor(d);
      setSel([d, d]);
      setDragging(true);
    }
    setChecked([]);
    setMessage(null);
  };
  const extend = (d: string) => {
    if (!dragging || !anchor) return;
    setSel(anchor <= d ? [anchor, d] : [d, anchor]);
  };

  const [selStart, selEnd] = sel || [monthStart, monthEnd];
  const isPastSel = !!sel && sel[0] < todayStr;

  // ===== A programar =====
  const toProgram = useMemo(() => {
    if (!sel) return [];
    const q = search.trim().toLowerCase();
    return unitOrders
      .filter((o) => novoInWindow(o, sel[0], sel[1]))
      .filter((o) => !q || [o.id, formatOrderNumber(o.id), o.title, comarcaOf(o), o.craai || '', o.assetId || ''].some((v) => String(v).toLowerCase().includes(q)));
  }, [unitOrders, sel, search]);
  const groups = useMemo(() => {
    const map = new Map<string, ServiceOrder[]>();
    toProgram.forEach((o) => map.set(comarcaOf(o), [...(map.get(comarcaOf(o)) || []), o]));
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [toProgram]);
  const toggle = (ids: string[], on: boolean) =>
    setChecked((prev) => (on ? Array.from(new Set([...prev, ...ids])) : prev.filter((id) => !ids.includes(id))));
  const checkedOrders = toProgram.filter((o) => checked.includes(o.id));

  // ===== Programadas =====
  const scheduledOrders = useMemo(
    () => unitOrders.filter((o) => scheduledIn(o, selStart, selEnd) && passFilter(o))
      .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || (a.scheduledDate || '').localeCompare(b.scheduledDate || '')),
    [unitOrders, selStart, selEnd, statusFilter]
  );
  const periodLots = lots.filter((l) => overlaps(l.periodStart, l.periodEnd, selStart, selEnd));
  const revertible = unitOrders.filter((o) => scheduledIn(o, selStart, selEnd) && canRevertUnexecutedOrder(o, currentCalendarDate));

  const changed = (msg?: string) => {
    if (msg) setMessage(msg);
    setChecked([]);
    onReload();
    loadLots();
  };

  const revertAll = async () => {
    setBusy(true);
    try {
      for (const o of revertible) {
        if (o.lotId) await dbDetachOrderFromLot(o);
        await dbSaveServiceOrder({
          ...o, lotId: undefined, status: 'Novo', scheduledDate: '', scheduledEndDate: undefined,
          assignedTechnician: '', assignedTechnicianMatricula: undefined, updatedAt: new Date().toISOString(),
          timeline: [...(o.timeline || []), timelineEvent('Voltou para Novo', userProfile?.name, 'Atrasada revertida em lote')]
        });
      }
      setConfirmRevert(false);
      changed(`${revertible.length} OS atrasada(s) voltaram para "Novo".`);
    } catch (err: any) {
      setMessage(`Não foi possível reverter: ${err?.message || err}`);
    } finally {
      setBusy(false);
    }
  };

  const goMonth = (delta: number) => setCurrentCalendarDate(new Date(year, month + delta, 1));
  const chip = 'px-2.5 py-1 rounded-full border text-[10px] font-black uppercase tracking-wide cursor-pointer transition-all';
  const tabBtn = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wide cursor-pointer ${active ? 'bg-[#3525cd] text-white' : 'text-slate-600 hover:bg-slate-100'}`;

  if (!unit) return <p className="text-xs text-slate-500 py-10 text-center">Nenhuma gerência disponível para o seu perfil.</p>;

  const week = weeks[Math.min(weekIdx, weeks.length - 1)] || [];

  return (
    <div className="space-y-4 animate-fadeIn select-none">
      {/* Cabeçalho: mês, gerência, visão */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => goMonth(-1)} className="h-8 w-8 rounded-lg border border-slate-200 bg-white flex items-center justify-center cursor-pointer"><ChevronLeft className="w-4 h-4" /></button>
          <h3 className="text-sm font-black text-slate-800 min-w-[140px] text-center">{MONTH_NAMES[month]} {year}</h3>
          <button type="button" onClick={() => goMonth(1)} className="h-8 w-8 rounded-lg border border-slate-200 bg-white flex items-center justify-center cursor-pointer"><ChevronRight className="w-4 h-4" /></button>
          <button type="button" onClick={() => setCurrentCalendarDate(new Date())} className="h-8 px-3 rounded-lg border border-slate-200 bg-white text-[11px] font-bold text-slate-600 cursor-pointer">Hoje</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {unitNames.length > 1 ? (
            <select value={unit} onChange={(e) => (activeUnit && onActiveUnitChange ? onActiveUnitChange(e.target.value) : setUnit(e.target.value))} className="h-8 px-2 text-xs font-bold border border-slate-200 rounded-lg bg-white">
              {unitNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          ) : (
            <span className="h-8 px-3 flex items-center text-xs font-black border border-slate-200 rounded-lg bg-white">{unit}</span>
          )}
          <div className="flex bg-slate-50 border border-slate-200 rounded-lg p-0.5">
            <button type="button" onClick={() => setView('calendario')} className={tabBtn(view === 'calendario')}>Calendário</button>
            <button type="button" onClick={() => setView('tecnico')} className={tabBtn(view === 'tecnico')}>Por técnico</button>
          </div>
        </div>
      </div>

      {/* Prazo de planejamento */}
      {countdown && visibleUnits !== null && (
        <div className={`px-3 py-2 rounded-lg border text-[11px] font-bold ${locked ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
          {locked
            ? `Prazo de planejamento da ${unit} expirado: só consulta. Peça ao Super Administrador para estender o prazo.`
            : `Prazo de planejamento da ${unit}: ${countdown.text}`}
        </div>
      )}

      {/* Chips de status (filtram calendário e "Programadas") */}
      <div className="flex flex-wrap gap-1.5">
        {STATUS_ORDER.map((s) => {
          const on = statusFilter.includes(s);
          const st = STATUS_STYLE[s];
          return (
            <button key={s} type="button" onClick={() => setStatusFilter((p) => (on ? p.filter((x) => x !== s) : [...p, s]))}
              className={`${chip} ${on ? st.chip + ' ring-2 ring-offset-1 ring-slate-300' : 'bg-white text-slate-600 border-slate-200'}`}>
              <span className={`inline-block w-2 h-2 rounded-full mr-1 ${st.dot}`} />{st.label} {monthCounts[s] || 0}
            </button>
          );
        })}
        {statusFilter.length > 0 && (
          <button type="button" onClick={() => setStatusFilter([])} className={`${chip} bg-white text-slate-500 border-dashed border-slate-300`}>Limpar filtro</button>
        )}
      </div>

      {message && (
        <div className="px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-[11px] font-bold text-emerald-800 flex justify-between gap-2">
          <span>{message}</span>
          <button type="button" onClick={() => setMessage(null)} className="cursor-pointer">×</button>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-4 items-start">
        {/* ESQUERDA: calendário ou visão por técnico */}
        <div className="bg-white border border-slate-200 rounded-2xl p-3">
          {view === 'calendario' ? (
            <>
              <div className="grid grid-cols-5 gap-1.5 mb-1.5">
                {WEEKDAY_SHORT.map((w) => <div key={w} className="text-center text-[10px] font-black uppercase text-slate-400">{w}</div>)}
              </div>
              {weeks.map((wk) => (
                <div key={wk[0]} className="grid grid-cols-5 gap-1.5 mb-1.5">
                  {wk.map((d) => {
                    if (!inMonth(d)) return <div key={d} className="h-20 rounded-lg bg-slate-50/50" />;
                    const past = d < todayStr;
                    const selected = !!sel && d >= sel[0] && d <= sel[1];
                    const counts = dayCounts(d);
                    return (
                      <div key={d}
                        onMouseDown={(e) => pick(d, e.shiftKey)}
                        onMouseEnter={() => extend(d)}
                        className={`h-20 rounded-lg border p-1.5 cursor-pointer flex flex-col transition-all ${
                          selected ? 'border-[#3525cd] bg-indigo-50 ring-1 ring-[#3525cd]' : past ? 'border-slate-100 bg-slate-100/70' : 'border-slate-200 bg-white hover:border-indigo-300'
                        }`}>
                        <span className={`text-[11px] font-black ${d === todayStr ? 'text-[#3525cd]' : past ? 'text-slate-400' : 'text-slate-700'}`}>{Number(d.slice(8))}</span>
                        <div className="mt-auto flex flex-wrap gap-1">
                          {STATUS_ORDER.filter((s) => counts[s]).map((s) => (
                            <span key={s} title={STATUS_STYLE[s].label} className={`px-1 rounded text-[9px] font-black border ${STATUS_STYLE[s].chip}`}>{counts[s]}</span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
              <p className="text-[10px] text-slate-400 mt-2">Clique num dia; arraste ou use Shift+clique para selecionar um período. Dias passados: só consulta.</p>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <button type="button" disabled={weekIdx === 0} onClick={() => setWeekIdx(weekIdx - 1)} className="h-7 w-7 rounded-md border border-slate-200 flex items-center justify-center cursor-pointer disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
                <span className="text-xs font-black text-slate-700">Semana {dayBR(week[0] || '')} a {dayBR(week[4] || '')}</span>
                <button type="button" disabled={weekIdx >= weeks.length - 1} onClick={() => setWeekIdx(weekIdx + 1)} className="h-7 w-7 rounded-md border border-slate-200 flex items-center justify-center cursor-pointer disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr>
                      <th className="text-left p-1.5 text-[10px] font-black uppercase text-slate-400">Técnico</th>
                      {week.map((d, i) => <th key={d} className="p-1.5 text-[10px] font-black uppercase text-slate-400">{WEEKDAY_SHORT[i]} {dayBR(d)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {technicians.map((t) => (
                      <tr key={t.id} className="border-t border-slate-100">
                        <td className="p-1.5 font-bold text-slate-700 whitespace-nowrap">
                          {t.name}
                          <button type="button" onClick={() => setTeamOf(t)} title="Equipe habitual do técnico"
                            className="ml-2 h-6 px-2 rounded-md border border-slate-200 text-[10px] font-bold text-slate-600 cursor-pointer">Equipe</button>
                        </td>
                        {week.map((d) => {
                          const n = unitOrders.filter((o) => passFilter(o) && scheduledIn(o, d, d) && isOrderOfTechnician(o, t)).length;
                          const selected = !!sel && d >= sel[0] && d <= sel[1];
                          return (
                            <td key={d} className="p-1 text-center">
                              <button type="button" onClick={() => { setSel([d, d]); setAnchor(d); setPanel('programadas'); }}
                                className={`w-full h-8 rounded-md border text-[11px] font-black cursor-pointer ${
                                  selected ? 'border-[#3525cd] bg-indigo-50' : n === 0 ? 'border-slate-100 text-slate-300' : n >= 5 ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-indigo-100 bg-indigo-50/40 text-indigo-800'
                                }`}>{n}</button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {technicians.length === 0 && <p className="text-xs text-slate-400 py-6 text-center">Nenhum técnico ativo na {unit}.</p>}
              </div>
            </>
          )}
        </div>

        {/* DIREITA: A programar / Programadas */}
        <div className="bg-white border border-slate-200 rounded-2xl p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex bg-slate-50 border border-slate-200 rounded-lg p-0.5">
              <button type="button" onClick={() => setPanel('programar')} className={tabBtn(panel === 'programar')}>A programar</button>
              <button type="button" onClick={() => setPanel('programadas')} className={tabBtn(panel === 'programadas')}>Programadas</button>
            </div>
            <span className="text-[10px] font-bold text-slate-500">
              {sel ? `${dayBR(sel[0])}${sel[1] !== sel[0] ? ` a ${dayBR(sel[1])}` : ''}` : 'Mês inteiro'}
            </span>
          </div>

          {panel === 'programar' ? (
            !sel ? (
              <p className="text-xs text-slate-400 py-8 text-center">Selecione um dia ou período no calendário para ver as OS que podem ser programadas nele.</p>
            ) : (
              <>
                {isPastSel && <p className="text-[11px] font-bold text-amber-700">Período com dia passado: só consulta (não é possível programar antes de hoje).</p>}
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nº, título, comarca, CRAAI ou ativo..."
                  className="w-full h-8 px-3 text-xs border border-slate-200 rounded-lg" />
                <div className="max-h-[520px] overflow-y-auto space-y-2 pr-1">
                  {groups.length === 0 && <p className="text-xs text-slate-400 py-6 text-center">Nenhuma OS aguardando cujo prazo cubra este período.</p>}
                  {groups.map(([comarca, list]) => {
                    const ids = list.map((o) => o.id);
                    const all = ids.every((id) => checked.includes(id));
                    return (
                      <div key={comarca} className="border border-slate-200 rounded-xl overflow-hidden">
                        <label className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={all} disabled={locked || isPastSel} onChange={(e) => toggle(ids, e.target.checked)} className="w-4 h-4" />
                          <span className="text-xs font-black text-slate-800 flex-1">{comarca}</span>
                          <span className="text-[10px] font-bold text-slate-500">{list.length} OS</span>
                        </label>
                        {list.map((o) => (
                          <div key={o.id} className="px-3 py-1.5 flex items-center gap-2 text-xs border-t border-slate-100 first:border-t-0">
                            <input type="checkbox" checked={checked.includes(o.id)} disabled={locked || isPastSel} onChange={(e) => toggle([o.id], e.target.checked)} className="w-4 h-4" />
                            <div className="min-w-0 flex-1">
                              <span className="font-mono text-[10px] font-bold text-indigo-600">#{formatOrderNumber(o.id)}</span>
                              <p className="font-bold text-slate-800 truncate">{o.title}</p>
                              <p className="text-[10px] text-slate-500">Prazo {dayBR(o.startDate || '')} a {dayBR(o.endDate || '')}{o.craai ? ` • ${o.craai}` : ''}</p>
                            </div>
                            <button type="button" onClick={() => onViewOrder(o)} className="h-7 px-2 rounded-md border border-slate-200 text-[10px] font-bold text-slate-600 cursor-pointer">Abrir</button>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
                <div className="sticky bottom-0 pt-2 bg-white">
                  <button type="button" disabled={locked || isPastSel || checkedOrders.length === 0} onClick={() => setShowSchedule(true)}
                    className="w-full h-10 rounded-lg bg-[#3525cd] text-white text-xs font-black uppercase tracking-wide cursor-pointer disabled:opacity-40">
                    Programar lote ({checkedOrders.length})
                  </button>
                </div>
              </>
            )
          ) : (
            <>
              {revertible.length > 0 && !locked && (
                <div className="p-2.5 rounded-lg border border-amber-200 bg-amber-50 text-[11px] space-y-2">
                  <p className="font-bold text-amber-900">
                    {revertible.length} OS atrasada(s) no período ainda estão no prazo do Super Administrador e podem voltar para "Novo".
                  </p>
                  {confirmRevert ? (
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setConfirmRevert(false)} disabled={busy} className="h-7 px-3 rounded-md border border-slate-300 bg-white font-bold text-slate-600 cursor-pointer">Cancelar</button>
                      <button type="button" onClick={revertAll} disabled={busy} className="h-7 px-3 rounded-md bg-amber-600 text-white font-bold cursor-pointer disabled:opacity-50">
                        {busy ? 'Revertendo...' : `Confirmar (${revertible.length})`}
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setConfirmRevert(true)} className="h-7 px-3 rounded-md bg-amber-600 text-white font-bold cursor-pointer">Voltar atrasadas p/ Novo</button>
                  )}
                </div>
              )}
              <div className="max-h-[560px] overflow-y-auto pr-1">
                <ScheduledList
                  orders={scheduledOrders}
                  technicians={technicians}
                  lots={periodLots}
                  overnightRate={overnightRate}
                  canViewCosts={canViewCosts}
                  locked={locked}
                  todayStr={todayStr}
                  canRevertUnexecutedOrder={(o) => canRevertUnexecutedOrder(o, currentCalendarDate)}
                  onViewOrder={onViewOrder}
                  onChanged={changed}
                  userName={userProfile?.name}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {teamOf && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl p-5">
            <UsualTeamEditor
              matricula={teamOf.matricula}
              techName={teamOf.name}
              unit={unit}
              editorName={userProfile?.name || ''}
              onClose={() => setTeamOf(null)}
            />
          </div>
        </div>
      )}

      {showSchedule && sel && (
        <ScheduleLotModal
          unit={unit}
          orders={checkedOrders}
          allOrders={unitOrders}
          technicians={technicians}
          periodStart={sel[0]}
          periodEnd={sel[1]}
          userName={userProfile?.name || ''}
          onClose={() => setShowSchedule(false)}
          onDone={(msg) => { setShowSchedule(false); setPanel('programadas'); changed(msg); }}
        />
      )}
    </div>
  );
}
