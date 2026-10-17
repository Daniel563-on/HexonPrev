import { useState, useEffect, useRef } from 'react';
import { Search, ShieldAlert, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { ServiceOrder, HexonUser, ChecklistItem, formatDateBR, Company, LiveState } from '../types';
import { formatOrderNumber } from '../utils/orderNumber';
import {
  dbGetHandledSolicitationsPage, dbCountSolicitations, dbDecideCorrective, dbFixCorrective,
  requestedItems, isItemPending, CorrectiveDecision, dbGetCompanies, dbGetManagements, isCompanyVisible
} from '../db/firebase';
import CorrectiveDecisionNote from './orders/execution/CorrectiveDecisionNote';

// SOLICITAÇÕES DE CORRETIVA (Etapa 8)
// Cada "Não conforme" de pergunta marcada no modelo vira um item de solicitação. O planejador decide item por item:
// "Abrir corretiva" (nº do chamado GLPI obrigatório) ou "Não abrir" (justificativa obrigatória).
// A decisão não muda depois; quem tem a permissão só corrige o nº do GLPI ou o texto da justificativa.
// Layout igual ao de Material e Insumos: busca + gerência + empresa e as situações em botões (com os números).

type SolicitationFilter = 'Pendente' | 'Com Acao' | 'Resolvido' | 'Cancelado';
const HANDLED_PAGE_SIZE = 20;

interface SolicitationsViewProps {
  pendingOrders: ServiceOrder[]; // OS com item aguardando decisão (tempo real, já filtradas pela gerência)
  pendingState?: LiveState;      // S14: a escuta das pendentes já respondeu? (até lá, "Carregando..." e não "nenhuma")
  scopeUnits: string[] | null;   // unidades do usuário; null = todas
  visibleCompanies?: string[] | null; // empresas que vê (null = todas as das gerências que vê; etapa especial E3)
  onNavigateToOS: (osId?: string) => void;
  onReload?: () => void;
  userProfile?: HexonUser | null;
  userHasActionPermission?: (actionId: string) => boolean;
}

// Edição em andamento de um item: decidir (abrir/não abrir) ou corrigir o texto de uma decisão
type Editing = { orderId: string; itemId: string; mode: CorrectiveDecision | 'fix'; text: string } | null;

export default function SolicitationsView({ pendingOrders, pendingState = 'ok', scopeUnits, visibleCompanies = null, onReload, userProfile, userHasActionPermission }: SolicitationsViewProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [company, setCompany] = useState('Todas');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [units, setUnits] = useState<string[]>(scopeUnits || []);
  const [unit, setUnit] = useState(''); // '' = todas as gerências que vê
  useEffect(() => {
    dbGetCompanies().then(setCompanies).catch(() => {});
    if (scopeUnits === null) {
      dbGetManagements()
        .then((l) => setUnits(l.map((m) => m.name).filter((n) => n && n !== 'Todas')))
        .catch(() => {});
    }
  }, []);
  const [statusFilter, setStatusFilter] = useState<SolicitationFilter>('Pendente');
  const [handledOrders, setHandledOrders] = useState<ServiceOrder[]>([]);
  const [handledCursor, setHandledCursor] = useState<unknown>(null);
  const [handledHasMore, setHandledHasMore] = useState(false);
  const [loadingHandled, setLoadingHandled] = useState(false);
  // S14 (Lote 6): null = contando (mostra "…"), 'erro' = a contagem falhou (mostra "—"); antes começava com 0
  const [counts, setCounts] = useState<{ pendente: number; resolvido: number; cancelado: number } | null | 'erro'>(null);
  const countsSeq = useRef(0); // nº da última contagem pedida
  const countsShown = useRef(0); // nº da contagem que está na tela (uma mais antiga não troca uma mais nova)
  const countsFloor = useRef(0); // contagens pedidas antes da troca de gerência não valem mais
  const countsKey = useRef('');
  const [local, setLocal] = useState<Record<string, ServiceOrder>>({}); // OS já alteradas nesta tela (antes do banco devolver)
  const [editing, setEditing] = useState<Editing>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ orderId: string; ok: boolean; text: string } | null>(null);

  // Gerência escolhida: só ela; senão, todas as que a pessoa vê
  const queryUnits = unit ? [unit] : scopeUnits;
  const scopeUnitsKey = `${scopeUnits === null ? '*' : scopeUnits.join('|')}#${unit}`;
  const userName = userProfile?.name || 'Usuário';

  const canManage = (): boolean => {
    if (!userProfile) return false;
    if (userProfile.perfil === 'Super Administrador') return true;
    return userHasActionPermission ? userHasActionPermission('manage_solicitations') : false;
  };

  const handledStatuses = (filter: SolicitationFilter): Array<'Resolvido' | 'Cancelado'> =>
    filter === 'Resolvido' ? ['Resolvido'] : filter === 'Cancelado' ? ['Cancelado'] : ['Resolvido', 'Cancelado'];

  const loadHandledPage = async (filter: SolicitationFilter, reset: boolean) => {
    if (filter === 'Pendente') return;
    setLoadingHandled(true);
    try {
      const page = await dbGetHandledSolicitationsPage({ units: queryUnits }, handledStatuses(filter), HANDLED_PAGE_SIZE, reset ? undefined : handledCursor);
      setHandledOrders((prev) => (reset ? page.orders : [...prev, ...page.orders]));
      setHandledCursor(page.cursor);
      setHandledHasMore(page.hasMore);
    } finally {
      setLoadingHandled(false);
    }
  };

  // Recontar depois de uma decisão mantém o número antigo até chegar o novo; trocar a gerência volta para "…"
  const refreshCounts = (reset = false) => {
    const seq = ++countsSeq.current;
    if (reset) {
      countsFloor.current = seq;
      setCounts(null);
    }
    const show = (c: { pendente: number; resolvido: number; cancelado: number } | 'erro') => {
      if (seq < countsFloor.current || seq <= countsShown.current) return;
      countsShown.current = seq;
      setCounts(c);
    };
    dbCountSolicitations({ units: queryUnits })
      .then(show)
      .catch(() => show('erro'));
  };

  useEffect(() => {
    setHandledOrders([]);
    setHandledCursor(null);
    setHandledHasMore(false);
    setLocal({});
    loadHandledPage(statusFilter, true);
  }, [statusFilter, scopeUnitsKey]);

  useEffect(() => {
    const keyChanged = countsKey.current !== scopeUnitsKey;
    countsKey.current = scopeUnitsKey;
    refreshCounts(keyChanged);
  }, [pendingOrders.length, scopeUnitsKey]);

  // Lista atual (com as alterações feitas aqui por cima) e só as OS que têm itens de solicitação
  const source = statusFilter === 'Pendente' ? pendingOrders : handledOrders;
  const orders = source
    .map((o) => local[o.id] || o)
    .filter((o) => o.checklistPending || requestedItems(o).length > 0)
    .filter((o) => !unit || o.unit === unit)
    .filter((o) => isCompanyVisible(o.company, visibleCompanies) && (company === 'Todas' || o.company === company))
    .filter((o) => {
      const q = searchTerm.trim().toLowerCase();
      if (!q) return true;
      return [o.id, o.title, o.assetName, o.assetCode, o.assignedTechnician, o.comarca]
        .some((v) => (v || '').toLowerCase().includes(q));
    });

  const save = async (order: ServiceOrder, item: ChecklistItem) => {
    if (!editing) return;
    setSaving(true);
    setMsg(null);
    try {
      const updated = editing.mode === 'fix'
        ? await dbFixCorrective(order, item.id, editing.text, userName)
        : await dbDecideCorrective(order, item.id, editing.mode, editing.text, userName);
      setLocal((prev) => ({ ...prev, [order.id]: updated }));
      setEditing(null);
      setMsg({ orderId: order.id, ok: true, text: editing.mode === 'fix' ? 'Correção salva.' : 'Decisão salva.' });
      refreshCounts();
      onReload?.();
    } catch (err: any) {
      setMsg({ orderId: order.id, ok: false, text: err?.message || 'Não foi possível salvar.' });
    } finally {
      setSaving(false);
    }
  };

  const itemRow = (order: ServiceOrder, item: ChecklistItem) => {
    const pending = isItemPending(item);
    const isEditing = editing && editing.orderId === order.id && editing.itemId === item.id ? editing : null;
    const open = isEditing?.mode === 'open' || (isEditing?.mode === 'fix' && item.autoCorrectiveStatus === 'Resolvido');
    return (
      <div key={item.id} className="bg-white p-2.5 rounded-lg border border-slate-200 text-[11px] space-y-2">
        <div>
          <p className="font-extrabold text-slate-800">• {item.task}</p>
          <p className="text-[10.5px] text-rose-700 font-semibold italic mt-0.5">Relato do técnico: "{item.observations || 'sem observação'}"</p>
        </div>
        <CorrectiveDecisionNote item={item} />
        {isEditing ? (
          <div className="space-y-1.5">
            <input
              autoFocus
              value={isEditing.text}
              onChange={(e) => setEditing({ ...isEditing, text: e.target.value })}
              placeholder={open ? 'Nº do chamado GLPI' : 'Justificativa para não abrir corretiva'}
              className="w-full h-9 px-3 text-xs border border-slate-300 rounded-lg font-semibold"
            />
            <div className="flex gap-2">
              <button type="button" disabled={saving || !isEditing.text.trim()} onClick={() => save(order, item)} className="flex-1 h-9 rounded-lg bg-[#3525cd] text-white text-[11px] font-black cursor-pointer disabled:opacity-40">
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
              <button type="button" disabled={saving} onClick={() => setEditing(null)} className="flex-1 h-9 rounded-lg border border-slate-300 text-slate-600 text-[11px] font-bold cursor-pointer">
                Cancelar
              </button>
            </div>
          </div>
        ) : canManage() && !order.checklistPending && (
          pending ? (
            <div className="flex gap-2">
              <button type="button" onClick={() => { setMsg(null); setEditing({ orderId: order.id, itemId: item.id, mode: 'open', text: '' }); }} className="flex-1 h-9 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-black cursor-pointer flex items-center justify-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Abrir corretiva
              </button>
              <button type="button" onClick={() => { setMsg(null); setEditing({ orderId: order.id, itemId: item.id, mode: 'skip', text: '' }); }} className="flex-1 h-9 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 text-[11px] font-black cursor-pointer flex items-center justify-center gap-1">
                <XCircle className="w-3.5 h-3.5" /> Não abrir
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setMsg(null); setEditing({ orderId: order.id, itemId: item.id, mode: 'fix', text: (item.autoCorrectiveStatus === 'Resolvido' ? item.correctiveTicket : item.correctiveReason) || '' }); }}
              className="text-[10px] font-bold text-indigo-700 underline cursor-pointer"
            >
              {item.autoCorrectiveStatus === 'Resolvido' ? 'Corrigir nº do GLPI' : 'Corrigir justificativa'}
            </button>
          )
        )}
      </div>
    );
  };

  const num = (pick: (c: { pendente: number; resolvido: number; cancelado: number }) => number) =>
    counts === null ? '…' : counts === 'erro' ? '—' : String(pick(counts));
  const FILTERS: { key: SolicitationFilter; label: string; n: string }[] = [
    { key: 'Pendente', label: 'Aguardando decisão', n: num((c) => c.pendente) },
    { key: 'Resolvido', label: 'Com corretiva aberta', n: num((c) => c.resolvido) },
    { key: 'Cancelado', label: 'Todos "não abrir"', n: num((c) => c.cancelado) },
    { key: 'Com Acao', label: 'Decididas (todas)', n: num((c) => c.resolvido + c.cancelado) }
  ];
  const selectCls = 'text-xs font-bold border border-slate-200 bg-slate-50 rounded-lg px-3 py-2.5 cursor-pointer text-slate-700 shrink-0';

  return (
    <div className="space-y-5 font-sans">
      <section className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <div className="border-l-4 border-indigo-500 pl-4">
          <h1 className="text-xl font-black text-slate-800 tracking-tight">Solicitações de corretiva</h1>
          <p className="text-xs text-slate-500 mt-1">
            Itens que o técnico marcou "Não conforme" em perguntas que geram solicitação. Decida cada item: "Abrir corretiva" (informe o nº do
            chamado GLPI) ou "Não abrir" (informe a justificativa). A preventiva continua concluída; o técnico acompanha pelo celular e, decidido o último item, vê a resposta até tocar em "Ciente".
          </p>
        </div>
      </section>

      <div className="bg-white p-3 rounded-xl border border-slate-200 flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Buscar por nº da OS, ativo, técnico, comarca..." className="w-full text-xs pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg font-bold text-slate-800" />
        </div>
        {units.length > 1 && (
          <select value={unit} onChange={(e) => { setUnit(e.target.value); setCompany('Todas'); }} aria-label="Gerência" className={selectCls}>
            <option value="">Todas as gerências</option>
            {units.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        )}
        {companies.some((c) => isCompanyVisible(c.id, visibleCompanies)) && (
          <select value={company} onChange={(e) => setCompany(e.target.value)} aria-label="Empresa" className={selectCls}>
            <option value="Todas">Todas as empresas</option>
            {companies
              .filter((c) => c.active && isCompanyVisible(c.id, visibleCompanies) && (unit ? c.units.includes(unit) : scopeUnits === null || c.units.some((u) => scopeUnits.includes(u))))
              .map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setStatusFilter(f.key)}
            title={counts === 'erro' ? 'Não foi possível contar agora' : undefined}
            className={`px-4 py-2 rounded-lg text-xs font-black cursor-pointer border ${statusFilter === f.key ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200'}`}
          >
            {f.label} ({f.n})
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 pb-6">
        {orders.length === 0 ? (
          <div className="xl:col-span-2 bg-white p-8 rounded-xl border border-slate-200 text-center text-sm font-bold text-slate-500">
            {loadingHandled || (statusFilter === 'Pendente' && pendingState === 'loading')
              ? 'Carregando...'
              : statusFilter === 'Pendente' && pendingState === 'erro'
                ? 'Não foi possível acompanhar as solicitações agora.'
                : 'Nenhuma solicitação nesta situação.'}
          </div>
        ) : (
          orders.map((o) => {
            const items = requestedItems(o);
            const pendingCount = items.filter(isItemPending).length;
            return (
              <div key={o.id} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                <div className="flex flex-wrap justify-between items-start gap-2 pb-2 border-b border-slate-100">
                  <div className="min-w-0">
                    <span className="font-mono text-[10px] font-black text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-100">OS #{formatOrderNumber(o.id)}</span>
                    <h3 className="text-sm font-black text-slate-800 mt-1.5 leading-snug">{o.title}</h3>
                  </div>
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black border ${pendingCount > 0 ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-emerald-50 text-emerald-800 border-emerald-200'}`}>
                    {pendingCount > 0 ? <><Clock className="w-3 h-3 inline -mt-0.5" /> {pendingCount} aguardando</> : 'Todos decididos'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10.5px]">
                  <p><span className="text-slate-400 font-bold block text-[9px] uppercase">Ativo</span><span className="font-bold text-slate-800">{o.assetName || '—'} {o.assetCode ? `(${o.assetCode})` : ''}</span></p>
                  <p><span className="text-slate-400 font-bold block text-[9px] uppercase">Comarca / CRAAI</span><span className="font-bold text-slate-800">{o.comarca || o.surveyLocation || '—'} • {o.craai || '—'}</span></p>
                  <p><span className="text-slate-400 font-bold block text-[9px] uppercase">Técnico</span><span className="font-bold text-indigo-700">{o.assignedTechnician || '—'}</span></p>
                  <p><span className="text-slate-400 font-bold block text-[9px] uppercase">Concluída em</span><span className="font-bold text-slate-800">{formatDateBR(o.signedAt || o.completedAt)}</span></p>
                </div>
                <div className="space-y-2">
                  <p className="text-[9px] font-black text-rose-600 uppercase tracking-wider flex items-center gap-1">
                    <ShieldAlert className="w-3.5 h-3.5" /> Itens não conformes ({items.length})
                  </p>
                  {o.checklistPending ? <p className="text-[11px] text-slate-400 font-bold">Carregando checklist...</p> : items.map((item) => itemRow(o, item))}
                </div>
                {msg && msg.orderId === o.id && (
                  <p className={`text-[11px] font-bold ${msg.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{msg.text}</p>
                )}
                {!canManage() && pendingCount > 0 && (
                  <p className="text-[10px] text-slate-400 font-bold text-center">A decisão é de quem tem a permissão "Gerenciar Solicitações".</p>
                )}
              </div>
            );
          })
        )}
      </div>

      {statusFilter !== 'Pendente' && handledHasMore && (
        <div className="flex justify-center -mt-2 pb-6">
          <button type="button" disabled={loadingHandled} onClick={() => loadHandledPage(statusFilter, false)} className="px-5 py-2.5 bg-white border border-slate-200 text-xs font-black text-slate-700 rounded-xl cursor-pointer disabled:opacity-60">
            {loadingHandled ? 'Carregando...' : `Carregar mais ${HANDLED_PAGE_SIZE}`}
          </button>
        </div>
      )}
    </div>
  );
}
