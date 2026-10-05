import React, { useEffect, useState } from 'react';
import { ClipboardCheck, MapPin } from 'lucide-react';
import { HexonUser, WorkOrder } from '../../types';
import { dbGetMyWorkOrders } from '../../db/firebase';
import OsExecutionForm from '../os/OsExecutionForm';
import { STATUS_STYLE, dayBR, isOverdue } from '../os/OsAnswersView';

// MINHAS OS (técnico): as OS de corretiva, layout e acompanhamento que estão com ele agora.
// Se a OS for passada para outro técnico, some daqui (o novo continua de onde parou).

export default function TechnicianOsTab({
  userProfile,
  darkMode,
  onCount,
  refreshKey = 0
}: {
  userProfile: HexonUser;
  darkMode: boolean;
  onCount?: (n: number) => void;
  refreshKey?: number; // botão Atualizar do cabeçalho
}) {
  const [list, setList] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<WorkOrder | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    dbGetMyWorkOrders(userProfile.matricula)
      .then((l) => {
        setList(l);
        onCount?.(l.length);
      })
      .catch((e) => setError(`Não foi possível carregar: ${e?.message || e}`))
      .finally(() => setLoading(false));
  };
  useEffect(load, [userProfile.matricula, refreshKey]);

  const card = darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200';
  return (
    <main className="flex-1 px-4 pt-4 space-y-3">
      <div>
        <h2 className={`text-base font-black ${darkMode ? 'text-white' : 'text-slate-900'}`}>Minhas OS</h2>
        <p className="text-[11px] text-slate-500">Corretiva, layout e acompanhamento atribuídas a você.{loading ? ' Atualizando...' : ''}</p>
      </div>
      {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
      {!loading && list.length === 0 && !error && <p className="text-xs text-slate-500 py-6 text-center">Nenhuma OS com você agora.</p>}
      {list.map((o) => (
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
