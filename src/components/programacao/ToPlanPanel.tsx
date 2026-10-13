import React, { useState } from 'react';
import { Lock, MapPin, Search } from 'lucide-react';
import { ServiceOrder } from '../../types';
import { localLabel, splitKey } from './blockLayout';

// PROGRAMAÇÃO › A PROGRAMAR (Fase 7C-1): preventivas "Novo" da gerência e empresa que podem ser feitas nesta semana
// (o prazo do Super Admin cobre algum dia dela, a partir de hoje), por local. "Programar" abre um bloco já com o local.

export interface ToPlanGroup {
  key: string;
  orders: ServiceOrder[];
  minEnd: string;
}
const br = (d?: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');
const SHOW = 12;

export default function ToPlanPanel(props: { groups: ToPlanGroup[]; weekEnd: string; notYet: number; canProgram: boolean; onProgram: (key: string) => void }) {
  const { groups, weekEnd, notYet, canProgram, onProgram } = props;
  const [q, setQ] = useState('');
  const [more, setMore] = useState(false);
  const term = q.trim().toLowerCase();
  const shown = term ? groups.filter((g) => localLabel(splitKey(g.key)).toLowerCase().includes(term) || g.orders.some((o) => o.id.toLowerCase().includes(term))) : groups;
  const due = shown.filter((g) => g.minEnd && g.minEnd <= weekEnd);
  const rest = shown.filter((g) => !(g.minEnd && g.minEnd <= weekEnd));
  const total = groups.reduce((n, g) => n + g.orders.length, 0);
  const row = (g: ToPlanGroup, hot: boolean) => {
    const l = splitKey(g.key);
    const per = Array.from(new Set(g.orders.map((o) => (o.periodicity || '').toLowerCase()).filter(Boolean)));
    return (
      <div key={g.key} className={`p-2 rounded-lg border flex items-center gap-2 ${hot ? 'border-rose-300 bg-rose-50/60 dark:bg-rose-950/20' : 'border-slate-200 dark:border-slate-700'}`}>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-black text-slate-800 dark:text-slate-100 flex items-start gap-1">
            <MapPin className="w-3 h-3 mt-px shrink-0 text-indigo-600" />
            <span>
              {l.comarca}
              {l.address && <span className="block font-medium text-[10px] text-slate-500">{l.address}</span>}
            </span>
          </p>
          <p className="text-[10px] text-slate-600 dark:text-slate-400">
            <b className="text-emerald-700">
              {g.orders.length} preventiva{g.orders.length > 1 ? 's' : ''}
            </b>
            {per.length ? ` (${per.join(', ')})` : ''} · prazo até {br(g.minEnd)}
          </p>
        </div>
        {canProgram && (
          <button type="button" onClick={() => onProgram(g.key)} className="h-7 px-2 rounded-lg bg-indigo-600 text-white text-[10px] font-black cursor-pointer shrink-0">
            Programar
          </button>
        )}
      </div>
    );
  };
  const restShown = more || term ? rest : rest.slice(0, SHOW);
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b1220] p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-black text-slate-900 dark:text-white">A programar nesta semana</p>
        <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5">{total} preventivas</span>
      </div>
      <label className="relative block">
        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar local, comarca ou nº..." className="w-full h-8 pl-8 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
      </label>
      <p className="text-[10px] text-slate-500 leading-snug">
        Só o que <b>pode ser feito nesta semana</b>: o prazo do Super Admin cobre algum dia dela (vale até o <b>último dia</b> do prazo). Agrupado por local.
      </p>
      {groups.length === 0 && <p className="text-[11px] text-slate-500 py-4 text-center">Nada a programar nesta semana.</p>}
      {due.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-black uppercase tracking-wider text-rose-600">Vencem nesta semana</p>
          {due.map((g) => row(g, true))}
        </div>
      )}
      {rest.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Prazo depois desta semana</p>
          {restShown.map((g) => row(g, false))}
          {!term && rest.length > SHOW && (
            <button type="button" onClick={() => setMore(!more)} className="w-full text-[10px] font-black text-indigo-600 cursor-pointer">
              {more ? 'mostrar menos' : `mostrar mais ${rest.length - SHOW} locais`}
            </button>
          )}
        </div>
      )}
      {notYet > 0 && (
        <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[10px] text-slate-500 flex gap-1.5">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          <span>
            Ainda não podem (o prazo começa na semana que vem): <b>{notYet}</b> preventiva{notYet > 1 ? 's' : ''}.
          </span>
        </div>
      )}
    </div>
  );
}
