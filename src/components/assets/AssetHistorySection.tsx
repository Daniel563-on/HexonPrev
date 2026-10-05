import React, { useEffect, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, FileSearch, History, Calculator } from 'lucide-react';
import { Asset, MaintenanceLog, ServiceOrder, formatDateBR } from '../../types';
import { AssetMaterialSpend, brl, dbGetAssetMaterialSpend, dbGetOrderCost, dbGetOrderForCost } from '../../db/firebase';
import { formatOrderNumber } from '../../utils/orderNumber';
import { useHistoryPages, HistoryPagerControls } from './HistoryPager';
import OrderTimeCost from '../orders/execution/OrderTimeCost';
import AssetCorrectiveHistory from './AssetCorrectiveHistory';

// HISTÓRICO DO ATIVO (Hexon 2.0, Fase 3): abas Preventivas e Corretivas, 12 por página, mais recentes primeiro.
// Cada linha abre com a setinha. Quem tem "Ver valores em R$" vê o valor de cada linha e o total gasto com materiais
// (calculados na hora; nada é gravado). Corretivas: OS concluídas com este ativo vinculado (Fase 5B).

type Tab = 'preventivas' | 'corretivas';

interface Props {
  asset: Asset;
  history?: MaintenanceLog[]; // histórico já carregado por quem chamou (sem paginação)
  canViewCosts: boolean;
  visibleUnits: string[] | null; // unidades do perfil (null = todas)
  localOrders?: ServiceOrder[]; // OS já carregadas no aparelho (evita ler o banco de novo)
  onViewOrder?: (orderId: string) => void;
}

export default function AssetHistorySection({ asset, history: propHistory, canViewCosts, visibleUnits, localOrders = [], onViewOrder }: Props) {
  const [tab, setTab] = useState<Tab>('preventivas');
  const historyPages = useHistoryPages(propHistory !== undefined ? undefined : asset?.id);
  const history = propHistory !== undefined ? propHistory : historyPages.items;

  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [orders, setOrders] = useState<Record<string, ServiceOrder | null>>({});
  const [values, setValues] = useState<Record<string, number | null>>({});

  const [spend, setSpend] = useState<AssetMaterialSpend | null>(null);
  const [spendBusy, setSpendBusy] = useState(false);
  const [spendError, setSpendError] = useState<string | null>(null);

  useEffect(() => {
    setOpen({});
    setSpend(null);
    setSpendError(null);
  }, [asset?.id]);

  const loadOrder = async (osId: string): Promise<ServiceOrder | null> => {
    if (osId in orders) return orders[osId];
    const local = localOrders.find((o) => o.id === osId) || null;
    const o = local || (await dbGetOrderForCost(osId).catch(() => null));
    setOrders((prev) => ({ ...prev, [osId]: o }));
    return o;
  };

  // Valor de cada linha da página (só para quem vê valores)
  useEffect(() => {
    if (!canViewCosts || tab !== 'preventivas') return;
    let alive = true;
    history.forEach(async (log) => {
      if (!log.osId || log.osId in values) return;
      const o = await loadOrder(log.osId);
      const v = o ? (await dbGetOrderCost(o).catch(() => null))?.total ?? null : null;
      if (alive) setValues((prev) => ({ ...prev, [log.osId]: v }));
    });
    return () => {
      alive = false;
    };
  }, [history, canViewCosts, tab]);

  const toggle = (log: MaintenanceLog) => {
    const willOpen = !open[log.id];
    setOpen((prev) => ({ ...prev, [log.id]: willOpen }));
    if (willOpen && canViewCosts && log.osId) loadOrder(log.osId);
  };

  const calcSpend = async () => {
    setSpendBusy(true);
    setSpendError(null);
    try {
      setSpend(await dbGetAssetMaterialSpend(asset.id, visibleUnits));
    } catch (err: any) {
      setSpendError(`Não foi possível calcular: ${err?.message || err}`);
    } finally {
      setSpendBusy(false);
    }
  };

  const tabBtn = (key: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={`px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wide cursor-pointer ${
        tab === key ? 'bg-[#3525cd] text-white' : 'text-slate-500 hover:bg-slate-100'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4 pb-3 border-b border-gray-100">
        <h4 className="font-bold text-[#0b1c30] text-xs uppercase tracking-wider flex items-center gap-2">
          <History className="w-4 h-4 text-[#3525cd]" />
          Histórico do ativo
        </h4>
        <div className="flex gap-1 bg-slate-50 border border-slate-200 rounded-xl p-1">
          {tabBtn('preventivas', 'Preventivas')}
          {tabBtn('corretivas', 'Corretivas')}
        </div>
      </div>

      {/* Total gasto com materiais (só quem vê valores) */}
      {canViewCosts && (
        <div className="mb-4 p-3 rounded-xl border border-emerald-200 bg-emerald-50/60 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs">
            <p className="font-black text-emerald-900">Gasto total com materiais neste ativo</p>
            {spend ? (
              <p className="text-emerald-900">
                <span className="text-lg font-black tabular-nums">{brl(spend.total)}</span>{' '}
                <span className="text-[11px]">em {spend.orders} preventiva(s) concluída(s)</span>
                {spend.missing > 0 && (
                  <span className="block text-[10px] font-bold text-rose-700">
                    {spend.missing} material(is) sem valor cadastrado na data não entraram na soma.
                  </span>
                )}
              </p>
            ) : (
              <p className="text-[11px] text-emerald-800">Soma de todas as preventivas concluídas. As corretivas entram quando o módulo de OS estiver pronto.</p>
            )}
            {spendError && <p className="text-[11px] font-bold text-rose-700">{spendError}</p>}
          </div>
          <button
            type="button"
            onClick={calcSpend}
            disabled={spendBusy}
            className="h-8 px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <Calculator className="w-3.5 h-3.5" />
            {spendBusy ? 'Calculando...' : spend ? 'Recalcular' : 'Calcular'}
          </button>
        </div>
      )}

      {tab === 'corretivas' ? (
        <AssetCorrectiveHistory assetId={asset.id} canViewCosts={canViewCosts} />
      ) : history.length === 0 ? (
        <div className="text-center py-10">
          <p className="text-xs text-gray-400 font-bold italic">
            {historyPages.loading ? 'Carregando...' : 'Nenhuma preventiva concluída neste ativo.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {history.map((log) => {
            const isOpen = !!open[log.id];
            const listVerified = log.verifiedItemsText ? log.verifiedItemsText.split(';').map((s) => s.trim()).filter(Boolean) : [];
            const listFailed = log.nonConformItemsText ? log.nonConformItemsText.split(';').map((s) => s.trim()).filter(Boolean) : [];
            const order = log.osId ? orders[log.osId] : undefined;
            const value = log.osId ? values[log.osId] : undefined;
            const cleanNotes = (log.notes || '')
              .replace(/⚙️\s*Desdobramento[\s\S]*?(?=(📋|⚠|$))/gi, '')
              .replace(/⚙️[\s\S]*?(?=(📋|⚠|$))/gi, '')
              .trim();
            return (
              <div key={log.id} className="rounded-xl border border-gray-200 hover:border-indigo-200 text-xs transition-all">
                {/* Linha (clique para abrir) */}
                <button
                  type="button"
                  onClick={() => toggle(log)}
                  className="w-full p-3 flex items-center gap-3 text-left cursor-pointer"
                  aria-expanded={isOpen}
                >
                  {isOpen ? <ChevronDown className="w-4 h-4 text-indigo-600 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <p className="font-extrabold text-[#0b1c30] truncate">
                      {log.osTitle}
                      <span className="font-mono text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded text-[10px] font-bold ml-2">#{formatOrderNumber(log.osId)}</span>
                    </p>
                    <p className="text-[10px] text-slate-500">
                      {formatDateBR(log.date)} · {log.technician || '—'}
                    </p>
                  </div>
                  <span
                    className={`hidden sm:inline-block text-[9px] px-2 py-0.5 font-black rounded-full shrink-0 ${
                      log.resultStatus === 'Aprovado'
                        ? 'bg-emerald-100 text-emerald-800'
                        : log.resultStatus === 'Aprovado com Ressalvas'
                        ? 'bg-amber-100 text-amber-800'
                        : log.resultStatus === 'Não Conforme'
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {log.resultStatus || 'Concluído'}
                  </span>
                  {canViewCosts && (
                    <span className="font-black tabular-nums text-slate-800 shrink-0 min-w-[84px] text-right">
                      {value === undefined ? '...' : value === null ? '—' : brl(value)}
                    </span>
                  )}
                </button>

                {/* Detalhes */}
                {isOpen && (
                  <div className="px-4 pb-4 pt-1 space-y-3 border-t border-gray-100">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-slate-600 pt-2">
                      <div>
                        <span className="text-[9px] text-gray-400 block font-bold uppercase">Tipo</span>
                        <span className="font-black text-slate-800 text-xs">{log.preventiveType || 'Preventiva'}</span>
                      </div>
                      <div>
                        <span className="text-[9px] text-gray-400 block font-bold uppercase">Checklist</span>
                        <span className="font-black text-emerald-600 text-xs">
                          {log.checkedCount} de {log.checklistCount} itens
                        </span>
                      </div>
                      <div>
                        <span className="text-[9px] text-gray-400 block font-bold uppercase">Resultado</span>
                        <span className="font-black text-slate-800 text-xs">{log.resultStatus || 'Concluído'}</span>
                      </div>
                    </div>

                    {listVerified.length > 0 && (
                      <div className="text-[11px]">
                        <span className="font-black text-slate-700 block mb-1">✓ Itens verificados ({listVerified.length}):</span>
                        <div className="flex flex-wrap gap-1">
                          {listVerified.map((v, i) => (
                            <span key={i} className="bg-slate-50 border border-slate-100 px-2 py-0.5 rounded text-[10px] text-slate-600">
                              {v}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {listFailed.length > 0 && (
                      <div className="bg-rose-50/50 p-2.5 rounded-lg border border-rose-100 text-[11px]">
                        <span className="font-black text-rose-700 flex items-center gap-1 mb-1">
                          <AlertCircle className="w-3.5 h-3.5" />
                          ✗ Itens não conformes ({listFailed.length}):
                        </span>
                        <ul className="list-disc list-inside space-y-0.5 text-[10px] text-rose-900 font-semibold">
                          {listFailed.map((f, i) => (
                            <li key={i}>{f}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {cleanNotes && (
                      <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg text-slate-500 italic text-xs leading-relaxed">
                        <span className="font-bold not-italic text-slate-700 block text-[10px] uppercase mb-0.5">Observações do técnico:</span>"{cleanNotes}"
                      </div>
                    )}

                    {/* Tempo, homem-hora e valores (valores só para quem pode ver) */}
                    {canViewCosts && order && <OrderTimeCost order={order} canViewCosts={canViewCosts} />}
                    {canViewCosts && order === null && (
                      <p className="text-[11px] text-slate-500">Não foi possível abrir a OS desta linha para calcular os valores.</p>
                    )}

                    {onViewOrder && log.osId && (
                      <button
                        type="button"
                        onClick={() => onViewOrder(log.osId)}
                        className="py-1.5 px-3 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-[10px] font-black text-indigo-700 rounded-lg flex items-center gap-1 cursor-pointer"
                        title="Abrir a ordem de serviço completa: checklist, observações, assinatura e PDF"
                      >
                        <FileSearch className="w-3 h-3" />
                        VER PREVENTIVA COMPLETA
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'preventivas' && propHistory === undefined && (
        <HistoryPagerControls
          pageNumber={historyPages.pageNumber}
          hasNext={historyPages.hasNext}
          hasPrev={historyPages.hasPrev}
          loading={historyPages.loading}
          onNext={historyPages.next}
          onPrev={historyPages.prev}
        />
      )}
    </div>
  );
}
