import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, X } from 'lucide-react';
import { HexonUser, Notice } from '../../types';
import { noticeRecent, sortNotices } from '../../db/notices';
import { markNotices, noticeIds } from '../../lib/noticeSeen';
import NoticeCard from '../notices/NoticeCard';
import { useNoticeState } from '../notices/useNoticeState';

// QUADRO DE AVISOS no celular do técnico: sino com o número de avisos novos (e urgentes sem "Li e estou ciente").
// Urgente ainda não confirmado abre sozinho na tela, uma vez por aparelho — ajuste S2: só o publicado nos últimos
// 3 dias (os mais antigos ficam no sino) e, com mais de um, botão "Li e estou ciente de todos". As janelas vão direto
// no <body>: dentro da barra de cima (efeito de vidro) elas ficariam presas no tamanho da barra.
export default function MobileNotices({ notices, user }: { notices: Notice[]; user: HexonUser }) {
  const state = useNoticeState(user.matricula, user.name, notices);
  const [open, setOpen] = useState(false);
  const [auto, setAuto] = useState<Notice | null>(null);
  const list = sortNotices(notices);

  useEffect(() => {
    if (open || auto) return;
    // espera um instante: o aparelho confere no banco se o urgente já foi confirmado em outro lugar
    const t = setTimeout(() => {
      const shown = noticeIds(user.matricula, 'shown');
      const next = list.find((n) => state.needs(n) && noticeRecent(n) && !shown.has(n.id));
      if (next) {
        markNotices(user.matricula, 'shown', [next.id]);
        setAuto(next);
      }
    }, 2000);
    return () => clearTimeout(t);
  }, [list.map((n) => n.id).join('|'), state.pending, open, !!auto]);

  // Urgentes sem "ciente": os recentes (os que abrem sozinhos) e todos (lista do sino)
  const recentPending = list.filter((n) => state.needs(n) && noticeRecent(n));
  const allPending = list.filter((n) => state.needs(n));
  const confirmAll = async (items: Notice[]) => {
    const ids = items.map((n) => n.id);
    markNotices(user.matricula, 'shown', ids);
    await state.confirmMany(ids);
    setAuto(null);
  };
  const allButton = (items: Notice[]) =>
    items.length > 1 && (
      <button
        type="button"
        disabled={state.busy === '*'}
        onClick={() => confirmAll(items)}
        className="w-full py-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-black cursor-pointer disabled:opacity-60"
      >
        {state.busy === '*' ? 'Gravando…' : `Li e estou ciente de todos (${items.length})`}
      </button>
    );

  const openList = () => {
    setOpen(true);
    state.markSeen(list.map((n) => n.id));
  };
  const card = (n: Notice) => (
    <NoticeCard
      key={n.id}
      notice={n}
      companies={[]}
      isNew={state.isNew(n)}
      confirm={n.kind === 'urgente' ? (state.needs(n) ? 'need' : 'done') : undefined}
      confirming={state.busy === n.id}
      onConfirm={() => state.confirm(n.id)}
    />
  );

  return (
    <>
      <button
        type="button"
        onClick={openList}
        title="Avisos"
        className="relative p-2 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center cursor-pointer"
      >
        <Bell className="w-4.5 h-4.5 text-indigo-600 dark:text-indigo-400" />
        {state.pending > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-black flex items-center justify-center">{state.pending}</span>
        )}
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-[1400] bg-slate-50 dark:bg-[#08122b] overflow-y-auto">
            <div className="sticky top-0 z-10 px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0e1a3a] flex items-center justify-between">
              <p className="text-base font-black text-slate-900 dark:text-white">Avisos</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-9 w-9 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center cursor-pointer"
                title="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3 max-w-2xl mx-auto">
              {state.error && <p className="text-xs font-bold text-rose-600">{state.error}</p>}
              {allButton(allPending)}
              {list.length === 0 && <p className="p-8 text-center text-sm text-slate-500">Nenhum aviso agora.</p>}
              {list.map(card)}
            </div>
          </div>,
          document.body
        )}

      {auto &&
        !open &&
        createPortal(
          <div className="fixed inset-0 z-[1450] bg-slate-900/70 flex items-center justify-center p-3">
            <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-2">
              <p className="text-center text-xs font-black uppercase tracking-widest text-white">Aviso urgente</p>
              {card(auto)}
              {state.error && <p className="text-xs font-bold text-rose-300 text-center">{state.error}</p>}
              {allButton(recentPending)}
              <button type="button" onClick={() => setAuto(null)} className="w-full py-3 rounded-xl bg-white/90 text-slate-800 text-sm font-black cursor-pointer">
                Fechar
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
