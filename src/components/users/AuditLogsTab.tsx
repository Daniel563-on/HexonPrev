import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { AccessLog, AuditLog } from '../../types';
import { dbGetAccessLogsPage, dbGetAuditLogsPage, LOG_PAGE_SIZE } from '../../db/firebase';

// AUDITORIA (só Super Admin): ações registradas no sistema e acessos (logins), 20 por página, mais recentes primeiro.
// Busca a próxima página só quando a pessoa avança; páginas já vistas ficam guardadas.
type Kind = 'actions' | 'access';
type Row = (AuditLog | AccessLog) & { id: string };

const fmt = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR');
};

export default function AuditLogsTab({ darkMode }: { darkMode: boolean }) {
  const [kind, setKind] = useState<Kind>('actions');
  const [pages, setPages] = useState<{ items: Row[]; cursor: any; hasMore: boolean }[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(kind);

  const fetchPage = (k: Kind, after: any) => (k === 'actions' ? dbGetAuditLogsPage(after) : dbGetAccessLogsPage(after));

  const loadFirst = (k: Kind) => {
    current.current = k;
    setPages([]);
    setIndex(0);
    setError(null);
    setLoading(true);
    fetchPage(k, null)
      .then((p) => current.current === k && setPages([p as any]))
      .catch((e) => current.current === k && setError(e?.message || String(e)))
      .finally(() => current.current === k && setLoading(false));
  };
  useEffect(() => loadFirst(kind), [kind]);

  const page = pages[index];
  const next = async () => {
    if (!page?.hasMore || loading) return;
    if (pages[index + 1]) return setIndex(index + 1);
    setLoading(true);
    try {
      const p = await fetchPage(kind, page.cursor);
      if (current.current !== kind) return;
      setPages((prev) => [...prev.slice(0, index + 1), p as any]);
      setIndex(index + 1);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const card = darkMode ? 'bg-[#0a1122]/40 border-slate-800' : 'bg-white border-slate-200';
  const muted = darkMode ? 'text-slate-400' : 'text-slate-500';
  const strong = darkMode ? 'text-slate-200' : 'text-slate-800';
  const tab = (k: Kind, label: string) => (
    <button
      type="button"
      onClick={() => setKind(k)}
      className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wide cursor-pointer ${
        kind === k ? 'bg-blue-600 text-white' : darkMode ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {label}
    </button>
  );
  const btn = `flex items-center gap-1 px-3 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
    darkMode ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-700'
  }`;

  return (
    <div className={`max-w-5xl mx-auto p-5 rounded-xl border space-y-4 ${card}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          {tab('actions', 'Ações no sistema')}
          {tab('access', 'Acessos')}
        </div>
        <button type="button" className={btn} onClick={() => loadFirst(kind)} disabled={loading}>
          <RefreshCw className="w-3.5 h-3.5" /> Atualizar
        </button>
      </div>
      <p className={`text-[11px] ${muted}`}>
        {kind === 'actions'
          ? 'O que foi feito no sistema: redefinição de senha, proteção do sistema (disjuntor) e outras ações registradas.'
          : 'Entradas no sistema, incluindo tentativas de login com falha.'}{' '}
        Mais recentes primeiro, {LOG_PAGE_SIZE} por página.
      </p>

      {error && <p className="text-xs font-bold text-rose-600">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className={`text-left uppercase text-[10px] tracking-wider ${muted}`}>
              <th className="py-2 pr-3">Quando</th>
              <th className="py-2 pr-3">Quem</th>
              <th className="py-2 pr-3">{kind === 'actions' ? 'Ação' : 'Evento'}</th>
              {kind === 'actions' && <th className="py-2 pr-3">Detalhes</th>}
            </tr>
          </thead>
          <tbody>
            {(page?.items || []).map((r) => (
              <tr key={r.id} className={`border-t ${darkMode ? 'border-slate-800' : 'border-slate-100'} align-top`}>
                <td className={`py-2 pr-3 whitespace-nowrap ${muted}`}>{fmt(r.timestamp)}</td>
                <td className={`py-2 pr-3 ${strong}`}>
                  <span className="font-bold">{r.userName || '—'}</span>
                  {r.userMatricula && <span className={`block text-[10px] ${muted}`}>{r.userMatricula}</span>}
                </td>
                <td className={`py-2 pr-3 font-bold ${strong}`}>
                  {kind === 'actions' ? (r as AuditLog).action : (r as AccessLog).event}
                  {kind === 'actions' && (r as AuditLog).target && <span className={`block text-[10px] font-normal ${muted}`}>{(r as AuditLog).target}</span>}
                </td>
                {kind === 'actions' && <td className={`py-2 pr-3 ${muted}`}>{(r as AuditLog).details}</td>}
              </tr>
            ))}
            {!loading && !error && (page?.items || []).length === 0 && (
              <tr>
                <td colSpan={4} className={`py-6 text-center ${muted}`}>Nenhum registro.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <button type="button" className={btn} disabled={index === 0 || loading} onClick={() => setIndex(index - 1)}>
          <ChevronLeft className="w-3.5 h-3.5" /> Anterior
        </button>
        <span className={`text-[11px] font-bold ${muted}`}>{loading ? 'Carregando...' : `Página ${index + 1}`}</span>
        <button type="button" className={btn} disabled={!page?.hasMore || loading} onClick={next}>
          Próxima <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
