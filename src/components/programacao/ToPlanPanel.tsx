import React, { useState } from 'react';
import { Lock, MapPin, Search, Wrench } from 'lucide-react';
import { ServiceOrder, WorkOrder } from '../../types';
import { localLabel, splitKey } from './blockLayout';

// PROGRAMAÇÃO › A PROGRAMAR (Fase 7C-1): preventivas "Novo" da gerência e empresa que podem ser feitas nesta semana
// (o prazo do Super Admin cobre algum dia dela, a partir de hoje), por local. "Programar" abre um bloco já com o local.
// Fase 7C-2: aba Chamados — abertos sem técnico e com técnico sem dia programado.

export interface ToPlanGroup {
  key: string;
  orders: ServiceOrder[];
  minEnd: string;
}
const br = (d?: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');
const SHOW = 12;

export default function ToPlanPanel(props: {
  groups: ToPlanGroup[];
  weekEnd: string;
  notYet: number;
  canProgram: boolean;
  onProgram: (key: string) => void;
  wosNew: WorkOrder[];
  wosNoDay: WorkOrder[];
  techName: (mat?: string) => string;
  onProgramWo: (w: WorkOrder) => void;
}) {
  const { groups, weekEnd, notYet, canProgram, onProgram, wosNew, wosNoDay, techName, onProgramWo } = props;
  const [tab, setTab] = useState<'prev' | 'ch'>('prev');
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
  const woMatch = (w: WorkOrder) => !term || [w.number, w.id, w.comarca || '', w.execAddressText || '', w.glpi || ''].some((v) => String(v).toLowerCase().includes(term));
  const woRow = (w: WorkOrder) => (
    <div key={w.id} className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-black text-slate-800 dark:text-slate-100">
          <span className="font-mono text-indigo-700 dark:text-indigo-300">{w.number || w.id}</span>
          {w.intervencao ? <span className="font-bold text-slate-500"> · {w.intervencao}</span> : null}
        </p>
        <p className="text-[10px] text-slate-600 dark:text-slate-400 flex items-start gap-1">
          <MapPin className="w-3 h-3 mt-px shrink-0 text-indigo-600" />
          <span>
            {w.comarca || 'Sem comarca'}
            {w.execAddressText ? ` · ${w.execAddressText}` : ''}
          </span>
        </p>
        <p className="text-[10px] text-slate-500">
          {w.assignedTechnicianMatricula ? `com ${techName(w.assignedTechnicianMatricula) || w.assignedTechnicianName}` : 'sem técnico'}
          {w.status === 'Pendente' ? ' · pendente' : ''} · {w.deadline ? `prazo ${br(w.deadline)}` : 'sem prazo'}
        </p>
      </div>
      {canProgram && (
        <button type="button" onClick={() => onProgramWo(w)} className="h-7 px-2 rounded-lg bg-indigo-600 text-white text-[10px] font-black cursor-pointer shrink-0">
          Programar
        </button>
      )}
    </div>
  );
  const tabBtn = (k: 'prev' | 'ch', label: string) => (
    <button
      type="button"
      onClick={() => setTab(k)}
      className={`py-1.5 rounded-md text-center cursor-pointer ${tab === k ? 'bg-white dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 shadow-sm' : 'text-slate-500'}`}
    >
      {label}
    </button>
  );
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b1220] p-3 space-y-3">
      <p className="text-xs font-black text-slate-900 dark:text-white">A programar nesta semana</p>
      <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 text-xs font-black">
        {tabBtn('prev', `Preventivas (${total})`)}
        {tabBtn('ch', `Chamados (${wosNew.length + wosNoDay.length})`)}
      </div>
      <label className="relative block">
        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar local, comarca ou nº..."
          className="w-full h-8 pl-8 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
        />
      </label>
      {tab === 'ch' ? (
        <>
          <p className="text-[10px] text-slate-500 leading-snug">
            Chamados GLPI abertos da empresa: os que ainda não têm técnico e os que estão com alguém <b>sem dia programado</b>. "Programar" abre um bloco já com o chamado.
          </p>
          {wosNew.length + wosNoDay.length === 0 && <p className="text-[11px] text-slate-500 py-4 text-center">Nenhum chamado esperando dia.</p>}
          {wosNew.filter(woMatch).length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1">
                <Wrench className="w-3 h-3" />
                Sem técnico (Nova)
              </p>
              {wosNew.filter(woMatch).map(woRow)}
            </div>
          )}
          {wosNoDay.filter(woMatch).length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1">
                <Wrench className="w-3 h-3" />
                Com técnico, sem dia
              </p>
              {wosNoDay.filter(woMatch).map(woRow)}
            </div>
          )}
        </>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
