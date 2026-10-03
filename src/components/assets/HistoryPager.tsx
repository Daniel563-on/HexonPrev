import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MaintenanceLog } from '../../types';
import { dbGetAssetHistoryPage, HISTORY_PAGE_SIZE } from '../../db/firebase';

// Histórico em páginas de 12: busca a próxima página só quando a pessoa avança.
// Páginas já vistas ficam guardadas (voltar não lê o banco de novo).
export function useHistoryPages(assetId: string | undefined, publicView = false) {
  const [pages, setPages] = useState<{ items: MaintenanceLog[]; cursor: any; hasMore: boolean }[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const current = useRef(assetId);

  useEffect(() => {
    current.current = assetId;
    setPages([]);
    setIndex(0);
    setError(false);
    if (!assetId) return;
    setLoading(true);
    dbGetAssetHistoryPage(assetId, null, publicView)
      .then((p) => {
        if (current.current === assetId) setPages([p]);
      })
      .catch(() => {
        if (current.current === assetId) setError(true);
      })
      .finally(() => {
        if (current.current === assetId) setLoading(false);
      });
  }, [assetId, publicView]);

  const page = pages[index];
  const next = async () => {
    if (!assetId || !page?.hasMore || loading) return;
    if (pages[index + 1]) return setIndex(index + 1);
    setLoading(true);
    try {
      const p = await dbGetAssetHistoryPage(assetId, page.cursor, publicView);
      if (current.current !== assetId) return;
      setPages((prev) => [...prev.slice(0, index + 1), p]);
      setIndex(index + 1);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };
  const prev = () => {
    if (index > 0) setIndex(index - 1);
  };

  return {
    items: page?.items || [],
    latest: pages[0]?.items[0] || null, // registro mais recente (1ª página)
    pageNumber: index + 1,
    hasNext: !!page?.hasMore,
    hasPrev: index > 0,
    loading,
    error,
    next,
    prev
  };
}

export function HistoryPagerControls({
  pageNumber,
  hasNext,
  hasPrev,
  loading,
  onNext,
  onPrev
}: {
  pageNumber: number;
  hasNext: boolean;
  hasPrev: boolean;
  loading: boolean;
  onNext: () => void;
  onPrev: () => void;
}) {
  if (!hasNext && !hasPrev) return null;
  const btn = 'flex items-center gap-1 px-3 py-1.5 rounded-lg border text-[11px] font-bold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer';
  return (
    <div className="flex items-center justify-between gap-2 pt-3 mt-3 border-t border-gray-100">
      <button type="button" className={`${btn} border-gray-200 text-gray-700 hover:bg-gray-50`} disabled={!hasPrev || loading} onClick={onPrev}>
        <ChevronLeft className="w-3.5 h-3.5" /> Anterior
      </button>
      <span className="text-[11px] font-bold text-gray-500">
        {loading ? 'Carregando...' : `Página ${pageNumber} · ${HISTORY_PAGE_SIZE} por página`}
      </span>
      <button type="button" className={`${btn} border-indigo-200 text-indigo-700 hover:bg-indigo-50`} disabled={!hasNext || loading} onClick={onNext}>
        Próxima <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
