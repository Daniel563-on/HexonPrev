import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { formatDateBR } from '../../types';
import { brl, dbGetWorkOrder, dbGetWorkOrderCost } from '../../db/firebase';
import { useHistoryPages, HistoryPagerControls } from './HistoryPager';

// CORRETIVAS DO ATIVO: OS (corretiva, layout, acompanhamento) concluídas com este ativo vinculado.
// Ficam no histórico com o id "os:<ativo>" (separadas das preventivas). 12 por página, mais recentes primeiro.
// Valor da linha só para quem vê valores (nunca na página pública do QR).

export default function AssetCorrectiveHistory({ assetId, canViewCosts, publicView = false }: { assetId: string; canViewCosts: boolean; publicView?: boolean }) {
  const pages = useHistoryPages(`os:${assetId}`, publicView);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, number | null>>({});

  useEffect(() => {
    if (!canViewCosts || publicView) return;
    let alive = true;
    pages.items.forEach(async (log) => {
      if (!log.osId || log.osId in values) return;
      const o = await dbGetWorkOrder(log.osId).catch(() => null);
      const v = o ? (await dbGetWorkOrderCost(o).catch(() => null))?.total ?? null : null;
      if (alive) setValues((p) => ({ ...p, [log.osId]: v }));
    });
    return () => {
      alive = false;
    };
  }, [pages.items, canViewCosts, publicView]);

  if (pages.items.length === 0)
    return (
      <div className="text-center py-10">
        <p className="text-xs text-gray-400 font-bold italic">{pages.loading ? 'Carregando...' : 'Nenhuma OS corretiva concluída neste ativo.'}</p>
      </div>
    );

  return (
    <div className="space-y-2">
      {pages.items.map((log) => {
        const isOpen = !!open[log.id];
        const value = values[log.osId];
        return (
          <div key={log.id} className="rounded-xl border border-gray-200 text-xs">
            <button type="button" onClick={() => setOpen((p) => ({ ...p, [log.id]: !p[log.id] }))} className="w-full p-3 flex items-center gap-3 text-left cursor-pointer" aria-expanded={isOpen}>
              {isOpen ? <ChevronDown className="w-4 h-4 text-indigo-600 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
              <div className="min-w-0 flex-1">
                <p className="font-extrabold text-[#0b1c30] truncate">
                  {log.osTitle}
                  <span className="font-mono text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded text-[10px] font-bold ml-2">{log.osId}</span>
                </p>
                <p className="text-[10px] text-slate-500">
                  {formatDateBR(log.date)} · {log.technician || '—'}
                </p>
              </div>
              <span className="hidden sm:inline-block text-[9px] px-2 py-0.5 font-black rounded-full bg-emerald-100 text-emerald-800 shrink-0">Concluída</span>
              {canViewCosts && !publicView && (
                <span className="font-black tabular-nums text-slate-800 shrink-0 min-w-[84px] text-right">{value === undefined ? '...' : value === null ? '—' : brl(value)}</span>
              )}
            </button>
            {isOpen && (
              <div className="px-4 pb-3 text-[11px] text-slate-700">
                <p className="font-black text-slate-500 uppercase text-[10px] mb-1">Serviço executado</p>
                <p className="whitespace-pre-wrap">{log.notes || '—'}</p>
              </div>
            )}
          </div>
        );
      })}
      <HistoryPagerControls pageNumber={pages.pageNumber} hasNext={pages.hasNext} hasPrev={pages.hasPrev} loading={pages.loading} onNext={pages.next} onPrev={pages.prev} />
    </div>
  );
}
