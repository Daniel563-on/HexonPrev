import React from 'react';
import { ServiceOrder } from '../../../types';

// LINHA DO TEMPO DA OS (Etapa 6.2): eventos guardados na própria OS, sem gravação extra
const fmt = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function OrderTimeline({ order }: { order: ServiceOrder }) {
  // "Disparada" vem da data de criação da OS (não é gravado de novo, para a OS ficar menor)
  const events = [
    ...(order.createdAt ? [{ at: order.createdAt, event: order.isTest ? 'Disparada (teste)' : 'Disparada' }] : []),
    ...(order.timeline || [])
  ].sort((a, b) => a.at.localeCompare(b.at)) as { at: string; event: string; by?: string; detail?: string }[];
  if (order.inExecution) {
    events.push({ at: order.inExecution.deviceStartedAt, event: 'Em execução', by: order.inExecution.name });
  }
  if (events.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Linha do tempo</p>
      <ol className="border-l-2 border-slate-200 ml-1.5 space-y-2">
        {events.map((e, i) => (
          <li key={`${e.at}-${i}`} className="pl-3 relative">
            <span className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-indigo-500" />
            <p className="text-[11px] font-bold text-slate-800">
              {e.event}
              {e.by && <span className="font-semibold text-slate-500"> • {e.by}</span>}
            </p>
            <p className="text-[10px] text-slate-500">
              {fmt(e.at)}
              {e.detail && ` • ${e.detail}`}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
