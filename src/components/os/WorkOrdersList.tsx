import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ChevronLeft, ChevronRight, Copy, FileSpreadsheet, Link2, Mail, PenTool, RefreshCw, Search, UserPlus, X } from 'lucide-react';
import { Company, HexonUser, WorkOrder, WorkOrderStatus } from '../../types';
import {
  companiesOfUnit,
  dbGetCompanies,
  inactiveCompanyIds,
  OS_OPEN_STATUSES,
  OS_FILTER_STATUSES,
  OS_PANEL_STATUSES,
  OsStatusFilter,
  osFilterLabel,
  osStatusLabel,
  OS_LIST_PAGE,
  OsCounters,
  OsListMode,
  brl,
  dbAssignWorkOrder,
  dbCountWorkOrders,
  dbFindWorkOrders,
  dbGetOsCounters,
  dbGetProfiles,
  dbGetUsers,
  isOfficeExecutor,
  dbGetWorkOrderCostSummary,
  dbListWorkOrders,
  osMatchesMode,
  subscribeWorkOrderChanges,
  markOsCountsStale,
  monthStartStr,
  osValidationLink,
  runBulk,
  todayStr
} from '../../db/firebase';
import WorkOrderSheet from './WorkOrderSheet';
import OsSignQueue from './OsSignQueue';
import AssignWorkOrderModal from './AssignWorkOrderModal';
import ChooseCompanyModal from './ChooseCompanyModal';
import OsRef from './OsRef';
import { osCategory } from '../../lib/osRef';
import { dayBR, isOverdue, osStatusStyle } from './OsAnswersView';
import { buildOsPdfBytes, downloadBlob } from '../../lib/osPdf';
import { exportOsListXlsx } from '../../lib/osXlsx';
import { ZipBuilder } from '../../lib/zip';
import { HomeOsLink, clearHomeLink, peekHomeLink } from '../../lib/homeLinks';
import { isLocalTech } from '../../lib/localTech';
import { dateTimeBR, linkDue, osValidationMailto } from '../../lib/osLink';

// ORDENS DE SERVIÇO › CORRETIVAS (Fase 6): painel de acompanhamento (contadores), busca por nº da OS ou GLPI,
// filtros (gerência + situação OU técnico + período; intervenção e "só atrasadas" filtram o que já veio),
// lista em tabela (computador) e cartões (celular), valores para quem vê valores (concluída = custo gravado na OS;
// em aberto = parcial), planilha da lista filtrada e backup em ZIP só das concluídas (pastas por mês da conclusão).
// Empresa (etapa especial E4): filtro no banco (lista, contadores, planilha e ZIP); perfil "só as empresas do usuário"
// vê só as dele. Atribuir/trocar lista só os técnicos da empresa da OS.
// A5-B: chamado em aberto de empresa inativa = "Sem empresa": opção no filtro, aviso, etiqueta e "Escolher empresa"
// (só o Super Administrador).

const PENDING = '__sem_empresa__'; // filtro "Sem empresa" (em aberto das empresas inativas da gerência)

interface Props {
  userProfile: HexonUser;
  unitOptions: string[]; // gerências que o usuário pode ver
  canAssign: boolean;
  canProgram?: boolean; // Fase 7E-2: "Programar" — o Atribuir técnico também programa o dia e o pernoite
  canEdit?: boolean;
  visibleCompanies?: string[] | null; // empresas que vê (null = todas as da gerência)
  canCancel: boolean;
  canReplyContest: boolean;
  canClientLink: boolean;
  canExport: boolean; // "Exportar OS (planilha e backup ZIP)"
  canPdf: boolean;    // "Baixar PDF da OS" (ficha)
  canViewCosts: boolean;
  mySignRole: 'engenheiro' | 'gerente' | 'all' | null;
  canFieldExec?: boolean; // U3: "Executar OS atribuídas a mim" (botão na ficha da OS que está com a pessoa)
}

type CostInfo = Awaited<ReturnType<typeof dbGetWorkOrderCostSummary>>;
const ZIP_MAX = 500;
const EXPORT_MAX = 2000;
const field = 'h-8 px-2 text-xs border border-slate-200 rounded-lg bg-white';
const label = 'block text-[9px] font-black uppercase tracking-wider text-slate-400 mb-0.5';

export default function WorkOrdersList({ userProfile, unitOptions, canAssign, canProgram = false, canEdit = false, visibleCompanies = null, canCancel, canReplyContest, canClientLink, canExport, canPdf, canViewCosts, canFieldExec = false, mySignRole }: Props) {
  // Atalho do Início: a lista abre já filtrada (situação, atrasadas ou "Precisam da minha assinatura")
  const [homeLink] = useState(() => peekHomeLink<HomeOsLink>('os-list'));
  useEffect(() => clearHomeLink('os-list'), []);
  const [signView, setSignView] = useState(() => !!homeLink?.sign); // "Precisam da minha assinatura"
  const [unit, setUnit] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('hexon_os_unit');
      if (saved && unitOptions.includes(saved)) return saved;
    } catch {
      /* ignora */
    }
    return unitOptions[0] || '';
  });
  const linkUnit = useRef<string | null>(unit); // o atalho do Início vale só para a gerência com que a tela abriu
  const linkStatus = (homeLink?.late || homeLink?.tech ? '' : homeLink?.status || 'Nova') as OsStatusFilter | '';
  const linkMode: OsListMode = homeLink?.late ? { kind: 'late' } : homeLink?.tech ? { kind: 'filter', tech: homeLink.tech } : { kind: 'filter', status: linkStatus || 'Nova' };
  // Filtros do banco
  // Abre em Novas para todo mundo (ajustes da etapa 8); as concluídas só aparecem pelos filtros
  const [status, setStatus] = useState<OsStatusFilter | ''>(linkStatus);
  const [tech, setTech] = useState(homeLink?.tech || '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [mode, setMode] = useState<OsListMode>(linkMode);
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
  const [assignMsg, setAssignMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(''); // U16: "Copiado" no botão do link
  const [zipOpen, setZipOpen] = useState(false);
  const current = useRef('');
  // Empresa
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyFilter, setCompanyFilter] = useState('');
  useEffect(() => {
    dbGetCompanies().then(setCompanies).catch(() => {});
  }, []);
  const unitCompanies = useMemo(
    () => companiesOfUnit(companies, unit).filter((c) => c.active && (visibleCompanies === null || visibleCompanies.includes(c.id))),
    [companies, unit, visibleCompanies]
  );
  // Empresas inativas da gerência (A5-B): o que está em aberto delas aparece como "Sem empresa"
  const inactive = useMemo(() => inactiveCompanyIds(companies), [companies]);
  const unitInactive = useMemo(
    () => companiesOfUnit(companies, unit).filter((c) => !c.active && (visibleCompanies === null || visibleCompanies.includes(c.id))).map((c) => c.id).slice(0, 10),
    [companies, unit, visibleCompanies]
  );
  const [pendingCount, setPendingCount] = useState(0);
  const isSuper = userProfile.perfil === 'Super Administrador';
  const [choosing, setChoosing] = useState<WorkOrder | null>(null);
  const isPending = (o: WorkOrder) => !!o.company && inactive.has(o.company) && OS_OPEN_STATUSES.includes(o.status);
  // Empresas da busca: a escolhida; "Sem empresa" = as inativas da gerência; senão as que o perfil vê (null = todas)
  const cos: string[] | null =
    companyFilter === PENDING ? unitInactive : companyFilter ? [companyFilter] : visibleCompanies === null ? null : [...visibleCompanies];
  const cosKey = cos === null ? '*' : cos.join(',');
  const companyName = (id?: string) => (id ? companies.find((c) => c.id === id)?.name || id : '—');

  const modeKey = (m: OsListMode) => `${unit}|${cosKey}|${JSON.stringify(m)}`;

  // Primeira página de cada filtro guardada enquanto a tela está aberta: voltar a um card já visto não lê de novo.
  // Qualquer mudança nas OS da gerência apaga a guarda; "Atualizar" sempre lê (ajustes da etapa 8)
  const pageCache = useRef(new Map<string, { items: WorkOrder[]; cursor: any; hasMore: boolean }>());
  const loadFirst = (m: OsListMode = mode, force = false) => {
    const key = modeKey(m);
    current.current = key;
    setPages([]);
    setIndex(0);
    setError(null);
    setFound(null);
    if (!unit) return;
    const hit = force ? undefined : pageCache.current.get(key);
    if (hit) {
      setPages([hit]);
      setLoading(false);
      return;
    }
    setLoading(true);
    dbListWorkOrders(unit, m, null, undefined, cos)
      .then((p) => {
        // U16: OS de link antigo foram para "Link enviado": a lista guardada dele e os números ficaram velhos
        if (p.fixed) {
          pageCache.current.clear();
          loadCounters(true);
        }
        pageCache.current.set(key, p);
        if (current.current === key) setPages([p]);
      })
      .catch((e) => current.current === key && setError(`Não foi possível carregar: ${e?.message || e}`))
      .finally(() => current.current === key && setLoading(false));
  };
  // quiet: recontagem em segundo plano (mantém os números na tela até chegarem os novos)
  const loadCounters = (quiet = false) => {
    if (!unit) return;
    // Chamados em aberto "Sem empresa" (A5-B): 1 contagem, só se a gerência tem empresa inativa
    if (unitInactive.length) dbCountWorkOrders(unit, { kind: 'pending' }, unitInactive).then(setPendingCount).catch(() => {});
    else setPendingCount(0);
    if (!quiet) setCounters(null);
    dbGetOsCounters(unit, cos)
      .then(setCounters)
      .catch(() => !quiet && setCounters(null));
  };
  const refresh = () => {
    loadFirst(mode, true);
    markOsCountsStale(unit); // "Atualizar": conta de novo, sem usar o que está guardado na sessão
    loadCounters();
  };

  // NÚMEROS DOS CARDS EM TEMPO REAL (ajustes da etapa 8): escuta só as OS da gerência que mudarem depois de abrir a
  // tela. Mudou: refaz as contagens (junta as mudanças de 3 s), atualiza a linha na tela e apaga a guarda das páginas.
  // Margem de 10 min no início para pegar aparelho com o relógio um pouco atrasado.
  const loadCountersRef = useRef(loadCounters);
  loadCountersRef.current = loadCounters;
  const cosRef = useRef(cos);
  cosRef.current = cos;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [costVersion, setCostVersion] = useState(0);
  const costLoading = useRef(new Set<string>()); // valores sendo calculados
  const costStale = useRef(new Set<string>()); // mudaram durante o cálculo: calcular de novo
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!unit) return;
    let timer: number | undefined;
    const stop = subscribeWorkOrderChanges(unit, new Date(Date.now() - 10 * 60000).toISOString(), (changed) => {
      const cs = cosRef.current;
      const mine = cs ? changed.filter((o) => cs.includes(o.company || '')) : changed;
      if (!mine.length) return;
      pageCache.current.clear();
      const byId = new Map(mine.map((o) => [o.id, o]));
      const patchList = (list: WorkOrder[]) => list.map((o) => byId.get(o.id) || o);
      // A que saiu do filtro sai da lista; a que passou a combinar entra na 1ª página (ordem de abertura)
      const m = modeRef.current;
      setPages((prev) => {
        const shown = new Set(prev.flatMap((p) => p.items.map((o) => o.id)));
        const enter = mine.filter((o) => !shown.has(o.id) && osMatchesMode(o, m, cs));
        return prev.map((p, i) => {
          let items = patchList(p.items).filter((o) => !byId.has(o.id) || osMatchesMode(o, m, cs));
          if (i === 0 && enter.length) items = [...items, ...enter].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          return { ...p, items };
        });
      });
      setFound((prev) => (prev ? patchList(prev) : prev));
      mine.forEach((o) => costLoading.current.has(o.id) && costStale.current.add(o.id));
      setCosts((prev) => {
        const n = { ...prev };
        mine.forEach((o) => delete n[o.id]);
        return n;
      });
      setCostVersion((v) => v + 1);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => loadCountersRef.current(true), 3000);
    }, () => loadCountersRef.current(true)); // S10: números guardados da sessão ficaram velhos: conta de novo
    return () => {
      stop();
      window.clearTimeout(timer);
    };
  }, [unit]);

  useEffect(() => {
    try {
      localStorage.setItem('hexon_os_unit', unit);
    } catch {
      /* ignora */
    }
    const l = homeLink && unit === linkUnit.current ? homeLink : undefined;
    if (unit !== linkUnit.current) linkUnit.current = null;
    const st = (l?.late || l?.tech ? '' : l?.status || 'Nova') as OsStatusFilter | '';
    setStatus(st);
    setTech(l?.tech || '');
    setFrom('');
    setTo('');
    setInterv('');
    setOnlyLate(false);
    setCompanyFilter('');
    const m: OsListMode = l ? linkMode : { kind: 'filter', status: 'Nova' };
    setMode(m);
    loadFirst(m);
    loadCounters();
    // Filtro "Técnico": técnicos de campo e, do escritório, quem também executa OS (U3)
    Promise.all([dbGetUsers(), dbGetProfiles().catch(() => [])])
      .then(([users, profiles]) =>
        setUnitTechs(
          users.filter(
            (u) =>
              (u.perfil === 'Profissional' && (u.gerencia === unit || u.gerencia === 'Todas' || isLocalTech(u))) ||
              ((u.gerencia === unit || u.gerencia === 'Todas') && isOfficeExecutor(u, profiles))
          )
        )
      )
      .catch(() => setUnitTechs([]));
  }, [unit]);
  // Trocou a empresa: recarrega a lista (mesmos filtros) e os contadores
  const firstCompanyRun = useRef(true);
  useEffect(() => {
    if (firstCompanyRun.current) {
      firstCompanyRun.current = false;
      return;
    }
    // "Sem empresa" mostra só as em aberto; ao sair dele, volta para as Novas
    const m: OsListMode = companyFilter === PENDING ? { kind: 'pending' } : mode.kind === 'pending' ? { kind: 'filter', status: 'Nova' } : mode;
    if (m !== mode) {
      setMode(m);
      setStatus(m.kind === 'filter' ? m.status || '' : '');
    }
    loadFirst(m);
    loadCounters();
  }, [companyFilter]);
  // As empresas chegaram depois da 1ª contagem: conta os "Sem empresa"
  useEffect(() => {
    if (unit && unitInactive.length) dbCountWorkOrders(unit, { kind: 'pending' }, unitInactive).then(setPendingCount).catch(() => {});
    else setPendingCount(0);
  }, [unit, unitInactive.join(',')]);

  const applyFilters = () => {
    if (from && to && from > to) return setError('Período: a data inicial é depois da final.');
    const m: OsListMode = { kind: 'filter', status: status || undefined, tech: status ? undefined : tech || undefined, from: from || undefined, to: to || undefined };
    setMode(m);
    loadFirst(m);
  };
  const clearFilters = () => {
    setStatus('Nova');
    setTech('');
    setFrom('');
    setTo('');
    setInterv('');
    setOnlyLate(false);
    setTerm('');
    const m: OsListMode = { kind: 'filter', status: 'Nova' };
    setMode(m);
    loadFirst(m);
  };
  const pickCounter = (m: OsListMode, st: OsStatusFilter | '' = '') => {
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
      setFound(await dbFindWorkOrders(unit, term, cos));
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
      const p = await dbListWorkOrders(unit, mode, page.cursor, undefined, cos);
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

  // Valores das OS que aparecem (concluída: custo gravado; em aberto: parcial). Um cálculo por OS de cada vez; o que
  // está em andamento não é cancelado (com as mudanças em tempo real ele recomeçaria sem parar). Se a OS mudou durante o
  // cálculo, o resultado antigo é descartado e ela é calculada de novo.
  useEffect(() => {
    if (!canViewCosts) return;
    items
      .filter((o) => o.assignedAt && !(o.id in costs) && !costLoading.current.has(o.id))
      .forEach((o) => {
        costLoading.current.add(o.id);
        dbGetWorkOrderCostSummary(o)
          .then((c) => ({ c }))
          .catch(() => ({ c: null }))
          .then(({ c }) => {
            costLoading.current.delete(o.id);
            if (!mounted.current) return;
            if (costStale.current.delete(o.id)) return setCostVersion((v) => v + 1);
            setCosts((p) => ({ ...p, [o.id]: c }));
          });
      });
  }, [items.map((o) => o.id).join('|'), canViewCosts, costVersion]);

  // ===== Atribuir técnico =====
  const openAssign = async (o: WorkOrder) => {
    setAssigning(o);
    setAssignMsg(null);
    setError(null);
    const [users, profiles] = await Promise.all([dbGetUsers().catch(() => []), dbGetProfiles().catch(() => [])]);
    // Só os técnicos da empresa da OS: da gerência e, em outra lista, os técnicos locais (Lote 2; e os antigos com "Todas").
    // U3: do escritório, quem tem "Executar OS atribuídas a mim" entra na lista da gerência
    setTechs(
      users.filter(
        (u) =>
          u.status === 'Ativo' &&
          (!o.company || (u.companies || []).includes(o.company)) &&
          ((u.perfil === 'Profissional' && (u.gerencia === o.unit || u.gerencia === 'Todas' || isLocalTech(u))) ||
            ((u.gerencia === o.unit || u.gerencia === 'Todas') && isOfficeExecutor(u, profiles)))
      )
    );
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
            const p = await dbListWorkOrders(unit, mode, cursor, 200, cos);
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
        exportOsListXlsx(list, `OS_${unit}_${todayStr()}.xlsx`, costMap, companyName);
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
      <span title={`HH ${brl(c.snap.labor)} · Hora extra ${brl(c.snap.overtime)} · Pernoite ${brl(c.snap.overnight)} · Materiais ${brl(c.snap.materials)} · Insumos ${brl(c.snap.supplies || 0)}`}>
        <span className="font-black text-slate-800 tabular-nums">{brl(c.snap.total)}</span>
        {c.partial && <span className="block text-[9px] font-bold text-amber-600">parcial</span>}
      </span>
    );
  };
  // U16: vez do cliente com link enviado = "Link enviado ao cliente" (verde-água); vencido = etiqueta vermelha
  const withLink = (o: WorkOrder) => o.status === 'Aguardando assinaturas' && o.nextSigner === 'cliente' && !!o.linkExp;
  const statusBadge = (o: WorkOrder) => (
    <>
      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${osStatusStyle(o) || 'bg-slate-100'}`}>{osStatusLabel(o)}</span>
      {withLink(o) && linkDue(o)?.tone === 'late' && <span className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-black bg-rose-600 text-white">LINK VENCIDO</span>}
      {isOverdue(o) && <span className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-black bg-rose-600 text-white">ATRASADA</span>}
    </>
  );
  // U16: cartão "Link enviado ao cliente": quando enviou, quando vence e os botões copiar / e-mail
  const linkView = !found && mode.kind === 'filter' && mode.status === 'link';
  const dueText = (o: WorkOrder) => {
    const d = linkDue(o);
    return d ? <span className={`block text-[10px] font-black ${d.tone === 'late' ? 'text-rose-600' : d.tone === 'soon' ? 'text-amber-600' : 'text-teal-700'}`}>{d.text}</span> : null;
  };
  const sentCell = (o: WorkOrder) => (
    <>
      {dateTimeBR(o.linkAt)}
      {o.linkBy && <span className="block text-[10px] text-slate-500">por {o.linkBy}</span>}
    </>
  );
  const dueCell = (o: WorkOrder) => (
    <>
      {dateTimeBR(o.linkExp)}
      {dueText(o)}
    </>
  );
  const linkBtns = (o: WorkOrder) =>
    linkDue(o)?.tone === 'late' ? (
      // vencido: o novo link sai da ficha (escolhe a validade lá)
      <button type="button" data-link-acts onClick={(e) => { e.stopPropagation(); setSelected(o); }} className="h-7 px-2 rounded-md border border-rose-200 bg-rose-50 text-rose-700 text-[10px] font-black inline-flex items-center gap-1 cursor-pointer">
        <Link2 className="w-3 h-3" /> Gerar novo link
      </button>
    ) : o.validationToken ? (
      <span data-link-acts className="inline-flex gap-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            navigator.clipboard?.writeText(osValidationLink(o.validationToken!)).then(() => {
              setCopied(o.id);
              setTimeout(() => setCopied((c) => (c === o.id ? '' : c)), 2000);
            });
          }}
          className="h-7 px-2 rounded-md border border-teal-200 bg-teal-50 text-teal-800 text-[10px] font-black inline-flex items-center gap-1 cursor-pointer"
        >
          <Copy className="w-3 h-3" /> {copied === o.id ? 'Copiado' : 'Copiar link'}
        </button>
        <a href={osValidationMailto(o)} onClick={(e) => e.stopPropagation()} className="h-7 px-2 rounded-md border border-teal-200 bg-teal-50 text-teal-800 text-[10px] font-black inline-flex items-center gap-1">
          <Mail className="w-3 h-3" /> E-mail
        </a>
      </span>
    ) : null;
  const manualBadge = (o: WorkOrder) =>
    o.execAddressManual ? <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[9px] font-black" title="Endereço digitado na emissão: não está no cadastro de Endereços e não gera histórico do endereço">NÃO CADASTRADO</span> : null;
  const assignBtn = (o: WorkOrder) =>
    canAssign && (o.status === 'Nova' || o.status === 'Em andamento' || o.status === 'Pendente') ? (
      <button type="button" onClick={(e) => { e.stopPropagation(); openAssign(o); }} className="h-7 px-2 rounded-md border border-indigo-200 bg-indigo-50 text-indigo-700 text-[10px] font-black inline-flex items-center gap-1 cursor-pointer">
        <UserPlus className="w-3 h-3" /> {o.assignedTechnicianMatricula ? 'Trocar' : 'Atribuir'}
      </button>
    ) : null;

  // A5-B: em aberto de empresa inativa = "Sem empresa"; concluída de empresa inativa mostra o nome com "(inativa)"
  const companyCell = (o: WorkOrder) =>
    isPending(o) ? (
      <span>
        <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[9px] font-black">SEM EMPRESA</span>
        <span className="block text-[10px] font-normal normal-case tracking-normal text-slate-500">era {companyName(o.company)} (inativa)</span>
      </span>
    ) : o.company && inactive.has(o.company) ? (
      <>
        {companyName(o.company)} <span className="text-[10px] font-normal text-slate-400">(inativa)</span>
      </>
    ) : (
      companyName(o.company)
    );
  const chooseBtn = (o: WorkOrder) =>
    isSuper && isPending(o) ? (
      <button type="button" onClick={(e) => { e.stopPropagation(); setChoosing(o); }} className="h-7 px-2 rounded-md border border-amber-300 bg-amber-50 text-amber-800 text-[10px] font-black inline-flex items-center gap-1 cursor-pointer">
        Escolher empresa
      </button>
    ) : null;

  const isMode = (k: string, st?: string) => !found && mode.kind === k && (k !== 'filter' || ((mode as any).status || '') === (st || ''));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* S15 (Lote 6): no celular, "Empresa" desce para a linha de baixo em vez de passar da borda */}
        <div className="flex flex-wrap items-center gap-2 min-w-0 max-w-full">
          <span className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Gerência</span>
            <select value={unit} onChange={(e) => setUnit(e.target.value)} className="h-8 px-2 text-xs font-bold border border-slate-200 rounded-lg bg-white cursor-pointer" aria-label="Gerência">
              {unitOptions.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </span>
          {(unitCompanies.length > 0 || pendingCount > 0) && !signView && (
            <span className="flex items-center gap-2 min-w-0 max-w-full sm:ml-2">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Empresa</span>
              <select
                value={companyFilter}
                onChange={(e) => setCompanyFilter(e.target.value)}
                className={`h-8 px-2 text-xs font-bold border rounded-lg cursor-pointer min-w-0 max-w-full ${companyFilter === PENDING ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white'}`}
                aria-label="Empresa"
              >
                <option value="">{visibleCompanies === null ? 'Todas' : 'Todas as minhas'}</option>
                {unitCompanies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
                {(pendingCount > 0 || companyFilter === PENDING) && <option value={PENDING}>⚠ Sem empresa ({pendingCount})</option>}
              </select>
            </span>
          )}
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
          {/* A5-B: chamados em aberto de empresa inativa */}
          {pendingCount > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-3.5 py-2.5 text-xs flex flex-wrap items-center gap-2" role="status">
              <span>
                <b>
                  {pendingCount} chamado{pendingCount > 1 ? 's' : ''} em aberto {pendingCount > 1 ? 'estão' : 'está'} sem empresa
                </b>{' '}
                (empresa inativada).{' '}
                {isSuper ? (
                  <>
                    Em cada um, use <b>Escolher empresa</b>.
                  </>
                ) : (
                  'Peça ao Super Administrador para escolher a empresa.'
                )}{' '}
                <span className="text-amber-700">(As OS concluídas continuam com o nome da empresa.)</span>
              </span>
              {companyFilter !== PENDING && (
                <button type="button" onClick={() => setCompanyFilter(PENDING)} className="h-7 px-2.5 rounded-md border border-amber-400 bg-white text-amber-800 text-[10px] font-black cursor-pointer">
                  Ver os sem empresa
                </button>
              )}
            </div>
          )}
          {/* Painel de acompanhamento */}
          <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Painel de acompanhamento">
            {OS_PANEL_STATUSES.map((s) =>
              chip(s === 'Nova' ? 'Novas' : s === 'Pendente' ? 'Pendentes' : s === 'Contestada' ? 'Contestadas' : s === 'Cancelada' ? 'Canceladas' : osFilterLabel(s), counters?.byStatus[s], isMode('filter', s), () => pickCounter({ kind: 'filter', status: s }, s), s === 'Contestada' ? 'text-rose-700' : s === 'Cancelada' ? 'text-slate-500' : 'text-slate-800')
            )}
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
                  {OS_FILTER_STATUSES.map((s) => (
                    <option key={s} value={s}>{osFilterLabel(s)}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className={label}>ou Técnico</span>
                <select value={tech} onChange={(e) => { setTech(e.target.value); if (e.target.value) setStatus(''); }} className={`${field} max-w-[200px]`} aria-label="Técnico">
                  <option value="">Todos</option>
                  {unitTechs.filter((t) => !cos || (t.companies || []).some((c) => cos.includes(c))).map((t) => (
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
          {assignMsg && <p className="text-[11px] font-bold text-emerald-700">{assignMsg}</p>}
          {error && !assigning && <p className="text-xs font-bold text-rose-600">{error}</p>}

          {/* Computador: tabela */}
          <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-xs min-w-[1040px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                  <th className="p-2.5">GLPI</th>
                  <th className="p-2.5">Empresa</th>
                  <th className="p-2.5">Intervenção</th>
                  <th className="p-2.5">Categoria</th>
                  <th className="p-2.5">Nº da OS</th>
                  <th className="p-2.5">Local de execução</th>
                  <th className="p-2.5">Técnico</th>
                  <th className="p-2.5">Abertura</th>
                  <th className="p-2.5">Prazo</th>
                  {linkView && <th className="p-2.5">Link enviado</th>}
                  {linkView && <th className="p-2.5">Vence o link</th>}
                  <th className="p-2.5">Situação</th>
                  {canViewCosts && <th className="p-2.5 text-right">Valor</th>}
                  <th className="p-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((o) => (
                  <tr key={o.id} className="border-t border-slate-100 align-top hover:bg-slate-50 cursor-pointer" onClick={() => setSelected(o)}>
                    <td className="p-2.5 whitespace-nowrap font-mono text-sm font-black text-indigo-700">{o.glpi || '—'}</td>
                    <td className="p-2.5 font-bold text-slate-700">{companyCell(o)}</td>
                    <td className="p-2.5">{o.intervencao || '—'}</td>
                    <td className="p-2.5">{osCategory(o) || '—'}</td>
                    <td className="p-2.5 font-mono text-[11px] text-slate-500 whitespace-nowrap">{o.number}</td>
                    <td className="p-2.5">
                      <span className="font-bold text-slate-800">{o.execAddressText}</span>
                      {manualBadge(o)}
                      <span className="block text-[10px] text-slate-500">{o.comarca}{o.craai ? ` · CRAAI ${o.craai}` : ''}{o.assetCode ? ` · Ativo ${o.assetCode}` : ''}</span>
                    </td>
                    <td className="p-2.5">
                      {o.assignedTechnicianName || <span className="text-slate-400">Em aberto</span>}
                      {o.scheduledDate && (
                        <span className="block text-[10px] font-bold text-indigo-700">
                          programada {dayBR(o.scheduledDate)}
                          {o.scheduledEndDate && o.scheduledEndDate !== o.scheduledDate ? ` a ${dayBR(o.scheduledEndDate)}` : ''}
                        </span>
                      )}
                    </td>
                    <td className="p-2.5 whitespace-nowrap">{dayBR(o.createdAt)}</td>
                    <td className="p-2.5 whitespace-nowrap">{dayBR(o.deadline)}</td>
                    {linkView && <td className="p-2.5 whitespace-nowrap">{sentCell(o)}</td>}
                    {linkView && <td className="p-2.5 whitespace-nowrap">{dueCell(o)}</td>}
                    <td className="p-2.5">{statusBadge(o)}</td>
                    {canViewCosts && <td className="p-2.5 text-right whitespace-nowrap">{costCell(o)}</td>}
                    <td className="p-2.5 text-right whitespace-nowrap">{chooseBtn(o) || assignBtn(o) || (linkView && linkBtns(o))}</td>
                  </tr>
                ))}
                {!loading && items.length === 0 && (
                  <tr>
                    <td colSpan={(canViewCosts ? 12 : 11) + (linkView ? 2 : 0)} className="p-6 text-center text-slate-400">Nenhuma OS encontrada.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Celular: cartões (div clicável, não <button>: o cartão tem o botão "Atribuir/Trocar" dentro) */}
          <div className="md:hidden space-y-2">
            {items.map((o) => (
              <div
                key={o.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelected(o)}
                onKeyDown={(e) => {
                  if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    setSelected(o);
                  }
                }}
                className="w-full text-left p-3 rounded-xl border border-slate-200 bg-white space-y-1 cursor-pointer"
              >
                <div className="flex items-center justify-between gap-2">
                  <OsRef o={o} />
                  <span>{statusBadge(o)}</span>
                </div>
                <p className="text-xs font-bold text-slate-800">{o.intervencao || 'OS'}{osCategory(o) ? ` · ${osCategory(o)}` : ''}</p>
                <p className="text-[10px] font-black uppercase tracking-wide text-blue-700">Empresa: {companyCell(o)}</p>
                <p className="text-[11px] text-slate-600">{o.execAddressText}{manualBadge(o)} · {o.comarca}</p>
                <p className="text-[11px] text-slate-500">
                  {o.assignedTechnicianName || 'Em aberto'} · aberta {dayBR(o.createdAt)} · prazo {dayBR(o.deadline)}
                  {o.scheduledDate ? ` · programada ${dayBR(o.scheduledDate)}${o.scheduledEndDate && o.scheduledEndDate !== o.scheduledDate ? ` a ${dayBR(o.scheduledEndDate)}` : ''}` : ''}
                </p>
                {withLink(o) && (
                  <div className="text-[11px] text-slate-600">
                    Link enviado {dateTimeBR(o.linkAt)}{o.linkBy ? ` por ${o.linkBy}` : ''} · vence {dateTimeBR(o.linkExp)}
                    {dueText(o)}
                  </div>
                )}
                <div className="flex items-center justify-between">
                  {canViewCosts ? <span className="text-xs">{costCell(o)}</span> : <span />}
                  {chooseBtn(o) || assignBtn(o) || (linkView && linkBtns(o))}
                </div>
              </div>
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
          canEdit={canEdit}
          canCancel={canCancel}
          canReplyContest={canReplyContest}
          canClientLink={canClientLink}
          canExport={canExport}
          canPdf={canPdf}
          canViewCosts={canViewCosts}
          canFieldExec={canFieldExec}
          mySignRole={mySignRole}
          onClose={() => setSelected(null)}
          onChanged={refresh}
        />
      )}

      {zipOpen && <ZipBackupModal unit={unit} cos={cos} label={companyFilter ? companyName(companyFilter) : ''} onClose={() => setZipOpen(false)} />}

      {/* Escolher empresa (A5-B, só o Super Administrador) */}
      {choosing && (
        <ChooseCompanyModal
          order={choosing}
          companies={companies}
          userName={userProfile.name}
          onClose={() => setChoosing(null)}
          onSaved={(o, msg) => {
            setChoosing(null);
            setAssignMsg(msg);
            pageCache.current.clear();
            // Na lista "Sem empresa" ela sai; nas outras, a linha mostra a empresa nova
            setPages((prev) => prev.map((p) => ({ ...p, items: companyFilter === PENDING ? p.items.filter((x) => x.id !== o.id) : p.items.map((x) => (x.id === o.id ? o : x)) })));
            setFound((prev) => (prev ? prev.map((x) => (x.id === o.id ? o : x)) : prev));
            loadCounters(true);
          }}
        />
      )}

      {/* Atribuir técnico (Fase 7E-2: com dia e pernoite para quem também tem "Programar") */}
      {assigning && (
        <AssignWorkOrderModal
          order={assigning}
          techs={techs}
          user={userProfile}
          canProgram={canProgram}
          onClose={() => setAssigning(null)}
          onDone={(msg) => {
            setAssigning(null);
            setAssignMsg(msg);
            refresh();
          }}
        />
      )}
    </div>
  );
}

// BACKUP DAS OS CONCLUÍDAS EM ZIP: período pela data da conclusão; um PDF por OS, em pastas por mês (AAAA-MM).
// Antes de gerar, conta as OS; até 500 OS por ZIP.
function ZipBackupModal({ unit, cos, label: companyLabel, onClose }: { unit: string; cos: string[] | null; label: string; onClose: () => void }) {
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
      setCount(await dbCountWorkOrders(unit, { kind: 'closed', from, to }, cos));
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
          const p = await dbListWorkOrders(unit, { kind: 'closed', from, to }, cursor, 100, cos);
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
          <p className="text-sm font-black text-slate-900">Backup das OS concluídas (ZIP) — {unit}{companyLabel ? ` · ${companyLabel}` : ''}</p>
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
            <p className="text-xs font-bold text-amber-900">Vão ser gerados {count} PDF(s).</p>
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
