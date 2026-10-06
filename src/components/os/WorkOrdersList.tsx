import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ChevronLeft, ChevronRight, FileSpreadsheet, PenTool, RefreshCw, Search, UserPlus, X } from 'lucide-react';
import { HexonUser, WorkOrder, WorkOrderStatus } from '../../types';
import {
  OS_ALL_STATUSES,
  OS_LIST_PAGE,
  OsCounters,
  OsListMode,
  brl,
  dbAssignWorkOrder,
  dbCountWorkOrders,
  dbFindWorkOrders,
  dbGetOsCounters,
  dbGetUsers,
  dbGetWorkOrderCostSummary,
  dbListWorkOrders,
  monthStartStr,
  runBulk,
  todayStr
} from '../../db/firebase';
import WorkOrderSheet from './WorkOrderSheet';
import OsSignQueue from './OsSignQueue';
import { STATUS_STYLE, dayBR, isOverdue } from './OsAnswersView';
import { buildOsPdfBytes, downloadBlob } from '../../lib/osPdf';
import { exportOsListXlsx } from '../../lib/osXlsx';
import { ZipBuilder } from '../../lib/zip';

// ORDENS DE SERVIÇO › CORRETIVAS (Fase 6): painel de acompanhamento (contadores), busca por nº da OS ou GLPI,
// filtros (gerência + situação OU técnico + período; intervenção e "só atrasadas" filtram o que já veio),
// lista em tabela (computador) e cartões (celular), valores para quem vê valores (concluída = custo gravado na OS;
// em aberto = parcial), planilha da lista filtrada e backup em ZIP só das concluídas (pastas por mês da conclusão).

interface Props {
  userProfile: HexonUser;
  unitOptions: string[]; // gerências que o usuário pode ver
  canAssign: boolean;
  canCancel: boolean;
  canReplyContest: boolean;
  canClientLink: boolean;
  canExport: boolean;
  canViewCosts: boolean;
  mySignRole: 'engenheiro' | 'gerente' | 'all' | null;
}

type CostInfo = Awaited<ReturnType<typeof dbGetWorkOrderCostSummary>>;
const ZIP_MAX = 500;
const EXPORT_MAX = 2000;
const field = 'h-8 px-2 text-xs border border-slate-200 rounded-lg bg-white';
const label = 'block text-[9px] font-black uppercase tracking-wider text-slate-400 mb-0.5';

export default function WorkOrdersList({ userProfile, unitOptions, canAssign, canCancel, canReplyContest, canClientLink, canExport, canViewCosts, mySignRole }: Props) {
  const [signView, setSignView] = useState(false); // "Precisam da minha assinatura"
  const [unit, setUnit] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('hexon_os_unit');
      if (saved && unitOptions.includes(saved)) return saved;
    } catch {
      /* ignora */
    }
    return unitOptions[0] || '';
  });
  // Filtros do banco
  const [status, setStatus] = useState<WorkOrderStatus | ''>('');
  const [tech, setTech] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [mode, setMode] = useState<OsListMode>({ kind: 'filter' });
  // Filtros do que já veio
  const [interv, setInterv] = useState('');
  const [onlyLate, setOnlyLate] = useState(false);
  // Busca
  const [term, setTerm] = useState('');
  const [found, setFound] = useState<WorkOrder[] | null>(null);

  const [pages, setPages] = useState<{ items: WorkOrder[]; cursor: any; hasMore: boolean }[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counters, setCounters] = useState<OsCounters | null>(null);
  const [unitTechs, setUnitTechs] = useState<HexonUser[]>([]);
  const [costs, setCosts] = useState<Record<string, CostInfo | null>>({});
  const [selected, setSelected] = useState<WorkOrder | null>(null);
  const [assigning, setAssigning] = useState<WorkOrder | null>(null);
  const [techs, setTechs] = useState<HexonUser[]>([]);
  const [assignTech, setAssignTech] = useState('');
  const [busy, setBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [zipOpen, setZipOpen] = useState(false);
  const current = useRef('');

  const modeKey = (m: OsListMode) => `${unit}|${JSON.stringify(m)}`;

  const loadFirst = (m: OsListMode = mode) => {
    const key = modeKey(m);
    current.current = key;
    setPages([]);
    setIndex(0);
    setError(null);
    setFound(null);
    if (!unit) return;
    setLoading(true);
    dbListWorkOrders(unit, m, null)
      .then((p) => current.current === key && setPages([p]))
      .catch((e) => current.current === key && setError(`Não foi possível carregar: ${e?.message || e}`))
      .finally(() => current.current === key && setLoading(false));
  };
  const loadCounters = () => {
    if (!unit) return;
    dbGetOsCounters(unit).then(setCounters).catch(() => setCounters(null));
  };
  const refresh = () => {
    loadFirst();
    loadCounters();
  };

  useEffect(() => {
    try {
      localStorage.setItem('hexon_os_unit', unit);
    } catch {
      /* ignora */
    }
    setStatus('');
    setTech('');
    setFrom('');
    setTo('');
    setInterv('');
    setOnlyLate(false);
    const m: OsListMode = { kind: 'filter' };
    setMode(m);
    loadFirst(m);
    loadCounters();
    dbGetUsers()
      .then((users) => setUnitTechs(users.filter((u) => u.perfil === 'Profissional' && (u.gerencia === unit || u.gerencia === 'Todas'))))
      .catch(() => setUnitTechs([]));
  }, [unit]);

  const applyFilters = () => {
    if (from && to && from > to) return setError('Período: a data inicial é depois da final.');
    const m: OsListMode = { kind: 'filter', status: status || undefined, tech: status ? undefined : tech || undefined, from: from || undefined, to: to || undefined };
    setMode(m);
    loadFirst(m);
  };
  const clearFilters = () => {
    setStatus('');
    setTech('');
    setFrom('');
    setTo('');
    setInterv('');
    setOnlyLate(false);
    setTerm('');
    const m: OsListMode = { kind: 'filter' };
    setMode(m);
    loadFirst(m);
  };
  const pickCounter = (m: OsListMode, st: WorkOrderStatus | '' = '') => {
    setStatus(st);
    setTech('');
    setFrom('');
    setTo('');
    setMode(m);
    loadFirst(m);
  };

  const search = async () => {
    if (!term.trim()) return setFound(null);
    setLoading(true);
    setError(null);
    try {
      setFound(await dbFindWorkOrders(unit, term));
    } catch (e: any) {
      setError(`Não foi possível buscar: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  const page = pages[index];
  const next = async () => {
    if (!page?.hasMore || loading) return;
    if (pages[index + 1]) return setIndex(index + 1);
    const key = modeKey(mode);
    setLoading(true);
    try {
      const p = await dbListWorkOrders(unit, mode, page.cursor);
      if (current.current !== key) return;
      setPages((prev) => [...prev.slice(0, index + 1), p]);
      setIndex(index + 1);
    } catch (e: any) {
      setError(`Não foi possível carregar: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  const baseItems = found ?? page?.items ?? [];
  const intervOptions = useMemo(() => Array.from(new Set(baseItems.map((o) => o.intervencao).filter(Boolean) as string[])).sort(), [baseItems]);
  const items = baseItems.filter((o) => (!interv || o.intervencao === interv) && (!onlyLate || isOverdue(o)));

  // Valores das OS que aparecem (concluída: custo gravado; em aberto: parcial)
  useEffect(() => {
    if (!canViewCosts) return;
    let alive = true;
    items
      .filter((o) => o.assignedAt && !(o.id in costs))
      .forEach((o) => {
        dbGetWorkOrderCostSummary(o)
          .then((c) => alive && setCosts((p) => ({ ...p, [o.id]: c })))
          .catch(() => alive && setCosts((p) => ({ ...p, [o.id]: null })));
      });
    return () => {
      alive = false;
    };
  }, [items.map((o) => o.id).join('|'), canViewCosts]);

  // ===== Atribuir técnico =====
  const openAssign = async (o: WorkOrder) => {
    setAssigning(o);
    setAssignTech(o.assignedTechnicianMatricula || '');
    setError(null);
    const users = await dbGetUsers().catch(() => []);
    setTechs(users.filter((u) => u.perfil === 'Profissional' && u.status === 'Ativo' && (u.gerencia === o.unit || u.gerencia === 'Todas')));
  };
  const assign = async () => {
    if (!assigning) return;
    const t = techs.find((x) => x.matricula === assignTech);
    if (!t) return setError('Escolha o técnico.');
    setBusy(true);
    try {
      await dbAssignWorkOrder(assigning, { matricula: t.matricula, name: t.name }, userProfile.name);
      setAssigning(null);
      refresh();
    } catch (e: any) {
      setError(e?.code === 'permission-denied' ? 'O banco recusou: seu perfil não pode atribuir OS nesta gerência.' : `Não foi possível atribuir: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  // ===== Planilha da lista filtrada (todas as páginas, até 2.000 OS) =====
  const exportXlsx = async () => {
    setExportMsg('Preparando a planilha...');
    try {
      await runBulk(async () => {
        let list: WorkOrder[] = [];
        if (found) list = found;
        else {
          let cursor: any = null;
          do {
            const p = await dbListWorkOrders(unit, mode, cursor, 200);
            list.push(...p.items);
            cursor = p.hasMore ? p.cursor : null;
            setExportMsg(`Lendo as OS... ${list.length}`);
          } while (cursor && list.length < EXPORT_MAX);
        }
        list = list.filter((o) => (!interv || o.intervencao === interv) && (!onlyLate || isOverdue(o))).slice(0, EXPORT_MAX);
        let costMap: Map<string, CostInfo> | null = null;
        if (canViewCosts) {
          costMap = new Map();
          let i = 0;
          for (const o of list) {
            i++;
            if (!o.assignedAt) continue;
            const c = costs[o.id] || (await dbGetWorkOrderCostSummary(o).catch(() => null));
            if (c) costMap.set(o.id, c);
            if (i % 20 === 0) setExportMsg(`Calculando valores... ${i} de ${list.length}`);
          }
        }
        exportOsListXlsx(list, `OS_${unit}_${todayStr()}.xlsx`, costMap);
        setExportMsg(`Planilha gerada com ${list.length} OS${list.length >= EXPORT_MAX ? ' (limite de 2.000: diminua o período para o resto)' : ''}.`);
      });
    } catch (e: any) {
      setExportMsg(`Não foi possível gerar a planilha: ${e?.message || e}`);
    }
  };

  const btn = 'flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-[11px] font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed bg-white';
  const chip = (text: string, n: number | undefined, active: boolean, onClick: () => void, tone = 'text-slate-800') => (
    <button
      key={text}
      type="button"
      onClick={onClick}
      className={`px-3 py-2 rounded-xl border text-left cursor-pointer min-w-[108px] ${active ? 'border-[#3525cd] bg-indigo-50' : 'border-slate-200 bg-white hover:border-indigo-300'}`}
    >
      <span className={`block text-lg font-black leading-none ${tone}`}>{n ?? '…'}</span>
      <span className="block text-[10px] font-bold text-slate-500 mt-0.5">{text}</span>
    </button>
  );
  const costCell = (o: WorkOrder) => {
    if (!o.assignedAt) return <span className="text-slate-400">—</span>;
    const c = costs[o.id];
    if (c === undefined) return <span className="text-slate-400">...</span>;
    if (c === null) return <span className="text-slate-400">—</span>;
    return (
      <span title={`HH ${brl(c.snap.labor)} · Hora extra ${brl(c.snap.overtime)} · Pernoite ${brl(c.snap.overnight)} · Materiais ${brl(c.snap.materials)}`}>
        <span className="font-black text-slate-800 tabular-nums">{brl(c.snap.total)}</span>
        {c.partial && <span className="block text-[9px] font-bold text-amber-600">parcial</span>}
      </span>
    );
  };
  const statusBadge = (o: WorkOrder) => (
    <>
      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${STATUS_STYLE[o.status] || 'bg-slate-100'}`}>{o.status}</span>
      {isOverdue(o) && <span className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-black bg-rose-600 text-white">ATRASADA</span>}
    </>
  );
  const manualBadge = (o: WorkOrder) =>
    o.execAddressManual ? <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[9px] font-black" title="Endereço digitado na emissão: não está no cadastro de Endereços e não gera histórico do endereço">NÃO CADASTRADO</span> : null;
  const assignBtn = (o: WorkOrder) =>
    canAssign && (o.status === 'Nova' || o.status === 'Em andamento' || o.status === 'Pendente') ? (
      <button type="button" onClick={(e) => { e.stopPropagation(); openAssign(o); }} className="h-7 px-2 rounded-md border border-indigo-200 bg-indigo-50 text-indigo-700 text-[10px] font-black inline-flex items-center gap-1 cursor-pointer">
        <UserPlus className="w-3 h-3" /> {o.assignedTechnicianMatricula ? 'Trocar' : 'Atribuir'}
      </button>
    ) : null;

  const isMode = (k: string, st?: string) => !found && mode.kind === k && (k !== 'filter' || ((mode as any).status || '') === (st || ''));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Gerência</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value)} className="h-8 px-2 text-xs font-bold border border-slate-200 rounded-lg bg-white cursor-pointer" aria-label="Gerência">
            {unitOptions.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          {mySignRole && (
            <button type="button" className={`${btn} ${signView ? '!bg-indigo-600 !text-white !border-indigo-600' : ''}`} onClick={() => setSignView(!signView)}>
              <PenTool className="w-3.5 h-3.5" /> Precisam da minha assinatura
            </button>
          )}
          {!signView && canExport && (
            <>
              <button type="button" className={btn} onClick={exportXlsx} disabled={!!exportMsg && exportMsg.endsWith('...')}>
                <FileSpreadsheet className="w-3.5 h-3.5" /> Exportar planilha
              </button>
              <button type="button" className={btn} onClick={() => setZipOpen(true)}>
                <Archive className="w-3.5 h-3.5" /> Backup PDFs (ZIP)
              </button>
            </>
          )}
          {!signView && (
            <button type="button" className={btn} onClick={refresh} disabled={loading}>
              <RefreshCw className="w-3.5 h-3.5" /> Atualizar
            </button>
          )}
        </div>
      </div>

      {signView && mySignRole && <OsSignQueue userProfile={userProfile} units={unitOptions} mySignRole={mySignRole} onOpen={setSelected} />}
      {!signView && (
        <>
          {/* Painel de acompanhamento */}
          <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Painel de acompanhamento">
            {chip('Todas', counters?.total, isMode('filter', '') && !tech && !from && !to, () => pickCounter({ kind: 'filter' }))}
            {(['Nova', 'Em andamento', 'Pendente', 'Aguardando assinaturas', 'Contestada'] as WorkOrderStatus[]).map((s) =>
              chip(s === 'Aguardando assinaturas' ? 'Aguardando assinaturas' : s === 'Nova' ? 'Novas' : s === 'Pendente' ? 'Pendentes' : s === 'Contestada' ? 'Contestadas' : s, counters?.byStatus[s], isMode('filter', s), () => pickCounter({ kind: 'filter', status: s }, s), s === 'Contestada' ? 'text-rose-700' : 'text-slate-800')
            )}
            {chip('Atrasadas', counters?.late, isMode('late'), () => pickCounter({ kind: 'late' }), 'text-rose-600')}
            {chip('Concluídas no mês', counters?.closedMonth, isMode('closed'), () => pickCounter({ kind: 'closed', from: monthStartStr(), to: todayStr() }), 'text-emerald-700')}
          </div>

          {/* Busca e filtros */}
          <div className="p-3 rounded-xl border border-slate-200 bg-white space-y-2">
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[220px]">
                <span className={label}>Buscar</span>
                <div className="flex gap-1">
                  <input value={term} onChange={(e) => setTerm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="Nº da OS ou nº do GLPI" className={`${field} flex-1`} aria-label="Buscar OS" />
                  <button type="button" onClick={search} className={btn} aria-label="Buscar"><Search className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              <label>
                <span className={label}>Situação</span>
                <select value={status} onChange={(e) => { setStatus(e.target.value as any); if (e.target.value) setTech(''); }} className={field} aria-label="Situação">
                  <option value="">Todas</option>
                  {OS_ALL_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className={label}>ou Técnico</span>
                <select value={tech} onChange={(e) => { setTech(e.target.value); if (e.target.value) setStatus(''); }} className={`${field} max-w-[200px]`} aria-label="Técnico">
                  <option value="">Todos</option>
                  {unitTechs.map((t) => (
                    <option key={t.matricula} value={t.matricula}>{t.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className={label}>Aberta de</span>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={field} aria-label="Aberta de" />
              </label>
              <label>
                <span className={label}>até</span>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={field} aria-label="Aberta até" />
              </label>
              <button type="button" onClick={applyFilters} className="h-8 px-3 rounded-lg bg-[#3525cd] text-white text-[11px] font-black cursor-pointer">Filtrar</button>
              <button type="button" onClick={clearFilters} className={btn}><X className="w-3.5 h-3.5" /> Limpar</button>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11px]">
              <label className="flex items-center gap-1.5">
                <span className="font-bold text-slate-500">Intervenção</span>
                <select value={interv} onChange={(e) => setInterv(e.target.value)} className="h-7 px-2 text-[11px] border border-slate-200 rounded-lg bg-white" aria-label="Intervenção">
                  <option value="">Todas</option>
                  {intervOptions.map((i) => (
                    <option key={i} value={i}>{i}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 font-bold text-slate-600">
                <input type="checkbox" checked={onlyLate} onChange={(e) => setOnlyLate(e.target.checked)} /> Só atrasadas
              </label>
              <span className="text-slate-400">(intervenção e "só atrasadas" filtram as OS já carregadas)</span>
            </div>
          </div>

          {found && (
            <p className="text-[11px] font-bold text-indigo-700">
              Resultado da busca "{term}": {found.length} OS. <button type="button" className="underline cursor-pointer" onClick={() => { setFound(null); setTerm(''); }}>voltar para a lista</button>
            </p>
          )}
          {exportMsg && <p className="text-[11px] font-bold text-slate-700">{exportMsg}</p>}
          {error && !assigning && <p className="text-xs font-bold text-rose-600">{error}</p>}

          {/* Computador: tabela */}
          <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-xs min-w-[960px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                  <th className="p-2.5">Número</th>
                  <th className="p-2.5">Tipo</th>
                  <th className="p-2.5">GLPI</th>
                  <th className="p-2.5">Local de execução</th>
                  <th className="p-2.5">Técnico</th>
                  <th className="p-2.5">Abertura</th>
                  <th className="p-2.5">Prazo</th>
                  <th className="p-2.5">Situação</th>
                  {canViewCosts && <th className="p-2.5 text-right">Valor</th>}
                  <th className="p-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((o) => (
                  <tr key={o.id} className="border-t border-slate-100 align-top hover:bg-slate-50 cursor-pointer" onClick={() => setSelected(o)}>
                    <td className="p-2.5 font-mono font-bold text-indigo-700 whitespace-nowrap">{o.number}</td>
                    <td className="p-2.5">{o.intervencao || '—'}</td>
                    <td className="p-2.5 font-mono">{o.glpi || '—'}</td>
                    <td className="p-2.5">
                      <span className="font-bold text-slate-800">{o.execAddressText}</span>
                      {manualBadge(o)}
                      <span className="block text-[10px] text-slate-500">{o.comarca}{o.craai ? ` · CRAAI ${o.craai}` : ''}{o.assetCode ? ` · Ativo ${o.assetCode}` : ''}</span>
                    </td>
                    <td className="p-2.5">{o.assignedTechnicianName || <span className="text-slate-400">Em aberto</span>}</td>
                    <td className="p-2.5 whitespace-nowrap">{dayBR(o.createdAt)}</td>
                    <td className="p-2.5 whitespace-nowrap">{dayBR(o.deadline)}</td>
                    <td className="p-2.5">{statusBadge(o)}</td>
                    {canViewCosts && <td className="p-2.5 text-right whitespace-nowrap">{costCell(o)}</td>}
                    <td className="p-2.5 text-right">{assignBtn(o)}</td>
                  </tr>
                ))}
                {!loading && items.length === 0 && (
                  <tr>
                    <td colSpan={canViewCosts ? 10 : 9} className="p-6 text-center text-slate-400">Nenhuma OS encontrada.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Celular: cartões */}
          <div className="md:hidden space-y-2">
            {items.map((o) => (
              <button key={o.id} type="button" onClick={() => setSelected(o)} className="w-full text-left p-3 rounded-xl border border-slate-200 bg-white space-y-1 cursor-pointer">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-black text-indigo-700">{o.number}</span>
                  <span>{statusBadge(o)}</span>
                </div>
                <p className="text-xs font-bold text-slate-800">{o.intervencao || 'OS'}{o.glpi ? ` · GLPI ${o.glpi}` : ''}</p>
                <p className="text-[11px] text-slate-600">{o.execAddressText}{manualBadge(o)} · {o.comarca}</p>
                <p className="text-[11px] text-slate-500">{o.assignedTechnicianName || 'Em aberto'} · aberta {dayBR(o.createdAt)} · prazo {dayBR(o.deadline)}</p>
                <div className="flex items-center justify-between">
                  {canViewCosts ? <span className="text-xs">{costCell(o)}</span> : <span />}
                  {assignBtn(o)}
                </div>
              </button>
            ))}
            {!loading && items.length === 0 && <p className="p-6 text-center text-xs text-slate-400">Nenhuma OS encontrada.</p>}
          </div>

          {!found && (
            <div className="flex items-center justify-between">
              <button type="button" className={btn} disabled={index === 0 || loading} onClick={() => setIndex(index - 1)}>
                <ChevronLeft className="w-3.5 h-3.5" /> Anterior
              </button>
              <span className="text-[11px] font-bold text-slate-500">{loading ? 'Carregando...' : `Página ${index + 1} · ${OS_LIST_PAGE} por página`}</span>
              <button type="button" className={btn} disabled={!page?.hasMore || loading} onClick={next}>
                Próxima <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </>
      )}

      {/* Ficha da OS */}
      {selected && (
        <WorkOrderSheet
          order={selected}
          userProfile={userProfile}
          canAssign={canAssign}
          canCancel={canCancel}
          canReplyContest={canReplyContest}
          canClientLink={canClientLink}
          canExport={canExport}
          canViewCosts={canViewCosts}
          mySignRole={mySignRole}
          onClose={() => setSelected(null)}
          onChanged={refresh}
        />
      )}

      {zipOpen && <ZipBackupModal unit={unit} onClose={() => setZipOpen(false)} />}

      {/* Atribuir técnico */}
      {assigning && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 space-y-3">
            <p className="text-sm font-black text-slate-900">{assigning.assignedTechnicianMatricula ? 'Trocar técnico' : 'Atribuir técnico'} — {assigning.number}</p>
            {assigning.status === 'Nova' ? (
              <p className="text-[11px] font-bold text-amber-700">Ao atribuir, a OS fica "Em andamento" e o homem-hora começa a contar.</p>
            ) : (
              <p className="text-[11px] text-slate-500">A contagem do homem-hora continua desde a primeira atribuição.</p>
            )}
            <select value={assignTech} onChange={(e) => setAssignTech(e.target.value)} className="w-full h-9 px-3 text-xs border border-slate-200 rounded-lg bg-white">
              <option value="">Selecione o técnico...</option>
              {[
                { label: `Técnicos da ${assigning.unit}`, list: techs.filter((t) => t.gerencia === assigning.unit) },
                { label: 'Técnicos de todas as gerências', list: techs.filter((t) => t.gerencia === 'Todas') }
              ]
                .filter((g) => g.list.length > 0)
                .map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.list.map((t) => (
                      <option key={t.matricula} value={t.matricula}>{t.name} ({t.matricula})</option>
                    ))}
                  </optgroup>
                ))}
            </select>
            {techs.length === 0 && <p className="text-[11px] text-slate-500">Nenhum técnico ativo nesta gerência.</p>}
            {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setAssigning(null); setError(null); }} className="h-8 px-3 rounded-lg border border-slate-200 text-xs font-bold cursor-pointer">Cancelar</button>
              <button type="button" onClick={assign} disabled={busy} className="h-8 px-3 rounded-lg bg-[#3525cd] text-white text-xs font-bold cursor-pointer disabled:opacity-50">
                {busy ? 'Salvando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// BACKUP DAS OS CONCLUÍDAS EM ZIP: período pela data da conclusão; um PDF por OS, em pastas por mês (AAAA-MM).
// Antes de gerar, conta as OS e mostra as leituras; até 500 OS por ZIP.
function ZipBackupModal({ unit, onClose }: { unit: string; onClose: () => void }) {
  const [from, setFrom] = useState(monthStartStr());
  const [to, setTo] = useState(todayStr());
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const check = async () => {
    if (!from || !to || from > to) return setMsg('Informe o período (a data inicial não pode ser depois da final).');
    setBusy(true);
    setMsg(null);
    setCount(null);
    try {
      setCount(await dbCountWorkOrders(unit, { kind: 'closed', from, to }));
    } catch (e: any) {
      setMsg(`Não foi possível contar: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    if (!count) return;
    setBusy(true);
    setMsg(null);
    try {
      await runBulk(async () => {
        const list: WorkOrder[] = [];
        let cursor: any = null;
        do {
          const p = await dbListWorkOrders(unit, { kind: 'closed', from, to }, cursor, 100);
          list.push(...p.items);
          cursor = p.hasMore ? p.cursor : null;
        } while (cursor && list.length < ZIP_MAX);
        const zip = new ZipBuilder();
        const layouts = new Map();
        const pad = (n: number) => String(n).padStart(2, '0');
        setProgress({ done: 0, total: list.length });
        for (let i = 0; i < list.length; i++) {
          const o = list[i];
          const closed = new Date(o.closedAt || o.createdAt);
          const folder = `${closed.getFullYear()}-${pad(closed.getMonth() + 1)}`;
          zip.add(`${folder}/${o.number}.pdf`, await buildOsPdfBytes(o, layouts), closed);
          setProgress({ done: i + 1, total: list.length });
        }
        downloadBlob(zip.build(), `Backup_OS_${unit}_${from}_a_${to}.zip`);
        setMsg(`ZIP gerado com ${list.length} PDF(s).`);
      });
    } catch (e: any) {
      setMsg(`Não foi possível gerar o ZIP: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] bg-slate-900/60 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-black text-slate-900">Backup das OS concluídas (ZIP) — {unit}</p>
          <button type="button" onClick={onClose} disabled={busy} className="h-8 w-8 rounded-lg border border-slate-200 flex items-center justify-center cursor-pointer" title="Fechar"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-[11px] text-slate-500">Só entram as OS <b>concluídas</b> no período (pela data da conclusão). Um PDF por OS, em pastas por mês. Até {ZIP_MAX} OS por ZIP.</p>
        <div className="flex gap-2">
          <label className="flex-1">
            <span className={label}>Concluídas de</span>
            <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setCount(null); }} className={`${field} w-full`} aria-label="Concluídas de" />
          </label>
          <label className="flex-1">
            <span className={label}>até</span>
            <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setCount(null); }} className={`${field} w-full`} aria-label="Concluídas até" />
          </label>
        </div>
        {count === null ? (
          <button type="button" onClick={check} disabled={busy} className="w-full h-9 rounded-lg border border-slate-300 text-xs font-black cursor-pointer disabled:opacity-50">{busy ? 'Contando...' : 'Contar OS do período'}</button>
        ) : count === 0 ? (
          <p className="text-xs font-bold text-slate-600">Nenhuma OS concluída nesse período.</p>
        ) : count > ZIP_MAX ? (
          <p className="text-xs font-bold text-rose-600">São {count} OS: o limite é {ZIP_MAX} por ZIP. Diminua o período.</p>
        ) : (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 space-y-2">
            <p className="text-xs font-bold text-amber-900">Vão ser gerados {count} PDF(s) (≈ até {count * 5} leituras no banco: a OS e as assinaturas).</p>
            <button type="button" onClick={generate} disabled={busy} className="w-full h-9 rounded-lg bg-[#3525cd] text-white text-xs font-black cursor-pointer disabled:opacity-50">
              {busy ? (progress ? `Gerando ${progress.done} de ${progress.total}...` : 'Lendo as OS...') : 'Gerar ZIP'}
            </button>
          </div>
        )}
        {msg && <p className="text-xs font-bold text-slate-700">{msg}</p>}
      </div>
    </div>
  );
}
