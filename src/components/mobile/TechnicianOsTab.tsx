import React, { useEffect, useState } from 'react';
import { ClipboardCheck, MapPin } from 'lucide-react';
import { HexonUser, WorkOrder } from '../../types';
import { dbGetMyWorkOrders, dbSyncOsValidation } from '../../db/firebase';
import OsExecutionForm from '../os/OsExecutionForm';
import { STATUS_STYLE, dayBR, isOverdue } from '../os/OsAnswersView';

// MINHAS OS (técnico): as OS de corretiva, layout e acompanhamento que estão com ele agora.
// Se a OS for passada para outro técnico, some daqui (o novo continua de onde parou).
// Botões "Em aberto" e "Contestadas" (Fase 8A): as contestadas pelo cliente ficam em destaque para o técnico responder.

export default function TechnicianOsTab({
  userProfile,
  darkMode,
  onCount,
  refreshKey = 0,
  canClientLink = false,
  canPdf = false
}: {
  userProfile: HexonUser;
  darkMode: boolean;
  onCount?: (n: number) => void;
  refreshKey?: number; // botão Atualizar do cabeçalho
  canClientLink?: boolean;
  canPdf?: boolean; // "Baixar PDF da OS": botão PDF na OS
}) {
  const [list, setList] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<WorkOrder | null>(null);
  const [view, setView] = useState<'open' | 'contested'>('open');

  const load = () => {
    setLoading(true);
    setError(null);
    dbGetMyWorkOrders(userProfile.matricula)
      .then(async (all) => {
        // Traz a resposta do link do cliente (aprovada → segue; contestada → volta para o técnico)
        const synced = await Promise.all(all.map((o) => dbSyncOsValidation(o, userProfile.name).then((u) => u || o).catch(() => o)));
        // Depois do cliente, a OS espera o engenheiro/gerente no sistema: sai da lista do técnico
        const l = synced.filter((o) => !(o.status === 'Aguardando assinaturas' && o.nextSigner !== 'cliente') && o.status !== 'Concluída');
        setList(l);
        onCount?.(l.length);
      })
      .catch((e) => setError(`Não foi possível carregar: ${e?.message || e}`))
      .finally(() => setLoading(false));
  };
  useEffect(load, [userProfile.matricula, refreshKey]);

  const card = darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200';
  const contested = list.filter((o) => o.status === 'Contestada');
  const shown = view === 'contested' ? contested : list.filter((o) => o.status !== 'Contestada');
  const tabBtn = (v: 'open' | 'contested', label: string, n: number) => {
    const on = view === v;
    const alert = v === 'contested' && n > 0;
    return (
      <button
        type="button"
        onClick={() => setView(v)}
        className={`min-h-[44px] py-2 px-1 rounded-xl text-center transition-all flex flex-col items-center justify-center cursor-pointer ${
          on
            ? alert
              ? 'bg-rose-600 text-white shadow-xs font-black'
              : 'bg-indigo-600 text-white shadow-xs font-black'
            : alert
            ? darkMode
              ? 'bg-rose-950/40 text-rose-300 border border-rose-800 font-bold'
              : 'bg-rose-50 text-rose-700 border border-rose-300 font-bold'
            : darkMode
            ? 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800 font-bold'
            : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200 shadow-2xs font-bold'
        }`}
      >
        <span className="text-xs sm:text-[13px] leading-tight">{label}</span>
        <span className={`text-[11px] font-mono leading-none mt-1 ${on ? 'text-white/80 font-bold' : alert ? 'font-black' : 'text-slate-400 font-semibold'}`}>({n})</span>
      </button>
    );
  };
  return (
    <main className="flex-1 px-4 pt-4 space-y-3">
      <div>
        <h2 className={`text-base font-black ${darkMode ? 'text-white' : 'text-slate-900'}`}>Minhas OS</h2>
        <p className="text-[11px] text-slate-500">Corretiva, layout e acompanhamento atribuídas a você.{loading ? ' Atualizando...' : ''}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 w-full">
        {tabBtn('open', 'Em aberto', list.length - contested.length)}
        {tabBtn('contested', 'Contestadas', contested.length)}
      </div>
      {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
      {!loading && shown.length === 0 && !error && (
        <p className="text-xs text-slate-500 py-6 text-center">{view === 'contested' ? 'Nenhuma OS contestada.' : 'Nenhuma OS com você agora.'}</p>
      )}
      {shown.map((o) => (
        <button key={o.id} type="button" onClick={() => setOpen(o)} className={`w-full text-left p-4 rounded-2xl border shadow-2xs space-y-1.5 cursor-pointer ${card}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-sm font-black text-indigo-600 flex items-center gap-1.5">
              <ClipboardCheck className="w-4 h-4" /> {o.number}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${STATUS_STYLE[o.status] || ''}`}>{o.status}</span>
          </div>
          <p className={`text-xs font-bold ${darkMode ? 'text-slate-200' : 'text-slate-800'}`}>{o.intervencao || 'OS'}{o.glpi ? ` · GLPI ${o.glpi}` : ''}</p>
          <p className="text-[11px] text-slate-500 flex items-start gap-1">
            <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {o.execAddressText} · {o.comarca}
          </p>
          <p className={`text-[11px] font-bold ${isOverdue(o) ? 'text-rose-600' : 'text-slate-500'}`}>Prazo {dayBR(o.deadline)}{isOverdue(o) ? ' · ATRASADA' : ''}</p>
        </button>
      ))}
      {open && (
        <OsExecutionForm
          order={open}
          userProfile={userProfile}
          canClientLink={canClientLink}
          canPdf={canPdf}
          onClose={() => {
            setOpen(null);
            load();
          }}
          onChanged={(u) => {
            setOpen(u);
            setList((prev) => prev.map((x) => (x.id === u.id ? u : x)));
          }}
        />
      )}
    </main>
  );
}
