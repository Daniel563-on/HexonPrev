import React, { useEffect, useMemo, useState } from 'react';
import { Company, ServiceOrder, WorkOrder } from '../../types';
import { onSyncChange, syncedList } from '../../db/localSync';
import { subscribeTeamWorkOrders } from '../../db/homeTeam';
import { homeCard, homeTitle } from './HomeNeeds';

// INÍCIO › EQUIPE AGORA: o que cada técnico da gerência tem com ele — preventivas para executar (atribuídas e ainda
// não feitas: Planejada, Atrasada ou Em Execução, deste mês e de antes), chamados em andamento e pendentes.
// Não mostra "em preventiva agora" (a preventiva dura minutos; o número mudaria o tempo todo). Técnicos: cópia guardada
// no aparelho (0 leitura); preventivas: o que o app já carrega; chamados: escuta só dos "Em andamento" e "Pendente".

const SHOW = 12;
const TO_DO = ['Planejada', 'Atrasada', 'Em Execução'];

interface Tech {
  matricula: string;
  name: string;
  companies: string[];
}

const pl = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function HomeTeam(props: {
  units: string[];
  cos: string[] | null;
  orders: ServiceOrder[];
  companies: Company[];
  onOpenOs: (matricula: string) => void;
  onOpenPreventives: (name: string) => void;
}) {
  const { units, cos, orders, companies } = props;
  const unitsKey = units.join('|');
  const cosKey = cos === null ? '*' : cos.join(',');
  const [techs, setTechs] = useState<Tech[] | null>(null);
  const [calls, setCalls] = useState<WorkOrder[]>([]);
  const [all, setAll] = useState(false);
  // Técnicos ativos das gerências (cópia no aparelho; cadastro novo ou alterado chega sozinho)
  useEffect(() => {
    let alive = true;
    const load = () =>
      Promise.all(units.map((u) => syncedList<any>('users', u, [['gerencia', u]])))
        .then((lists) => {
          if (!alive) return;
          const byMat = new Map<string, Tech>();
          lists.flat().forEach((x) => {
            if (x.perfil !== 'Profissional' || x.status !== 'Ativo' || !x.matricula) return;
            const cs: string[] = Array.isArray(x.companies) ? x.companies : [];
            if (cos && !cs.some((c) => cos.includes(c))) return;
            byMat.set(String(x.matricula), { matricula: String(x.matricula), name: x.name || String(x.matricula), companies: cs });
          });
          setTechs(Array.from(byMat.values()));
        })
        .catch(() => alive && setTechs([]));
    load();
    const stop = onSyncChange('users', load);
    return () => {
      alive = false;
      stop();
    };
  }, [unitsKey, cosKey]);

  // Chamados em andamento e pendentes (tempo real)
  useEffect(() => subscribeTeamWorkOrders(units, (list) => setCalls(cos ? list.filter((o) => cos.includes(o.company || '')) : list)), [unitsKey, cosKey]);

  const rows = useMemo(() => {
    if (!techs) return null;
    const d = new Date();
    const end = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-31`;
    const toDo = orders.filter((o) => TO_DO.includes(o.status) && (o.startDate || o.scheduledDate || o.endDate || '') <= end);
    return techs
      .map((t) => {
        const prevs = toDo.filter((o) => o.assignedTechnicianMatricula === t.matricula || (!o.assignedTechnicianMatricula && o.assignedTechnician === t.name));
        const late = prevs.filter((o) => o.status === 'Atrasada').length;
        const mine = calls.filter((o) => o.assignedTechnicianMatricula === t.matricula);
        const andamento = mine.filter((o) => o.status === 'Em andamento').length;
        const pend = mine.filter((o) => o.status === 'Pendente').length;
        return { t, prevs: prevs.length, late, andamento, pend, load: prevs.length + andamento + pend };
      })
      .sort((a, b) => b.load - a.load || a.t.name.localeCompare(b.t.name));
  }, [techs, calls, orders]);
  const companyName = (id?: string) => (id ? companies.find((c) => c.id === id)?.name || id : '');
  const busy = rows ? rows.filter((r) => r.load > 0) : [];
  const free = rows ? rows.filter((r) => r.load === 0) : [];
  const shown = all ? busy : busy.slice(0, SHOW);
  const sum = (k: 'prevs' | 'late' | 'andamento' | 'pend') => (rows ? rows.reduce((s, r) => s + r[k], 0) : null);
  const cards = [
    { label: 'Preventivas para executar', n: sum('prevs'), color: '#10b981', note: rows ? pl(sum('late') || 0, 'atrasada', 'atrasadas') : '' },
    { label: 'Chamados em andamento', n: sum('andamento'), color: '#1d4ed8', note: '' },
    { label: 'Chamados pendentes', n: sum('pend'), color: '#f59e0b', note: '' },
    { label: 'Técnicos sem nada aberto', n: rows ? free.length : null, color: '#94a3b8', note: '' }
  ];
  const link = 'px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:border-indigo-300 cursor-pointer';

  return (
    <section className="space-y-3" aria-label="Equipe agora">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={homeTitle}>Equipe agora</h3>
        <span className="text-[11px] text-slate-500">Técnicos da gerência · o que está com cada um · atualiza sozinho</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((c) => (
          <div key={c.label} className={`${homeCard} p-3.5`}>
            <span className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 dark:text-slate-300">
              <i className="w-2 h-2 rounded-full inline-block" style={{ background: c.color }} />
              {c.label}
            </span>
            <span className="block text-2xl font-black tabular-nums text-slate-900 dark:text-white mt-1">{c.n ?? '…'}</span>
            {c.note && <span className="block text-[11px] font-bold text-rose-600 dark:text-rose-400">{c.note}</span>}
          </div>
        ))}
      </div>
      {rows && rows.length === 0 && <p className="text-xs text-slate-500">Nenhum técnico ativo cadastrado nesta gerência.</p>}
      {busy.length > 0 && (
        <div className={`${homeCard} grid grid-cols-1 2xl:grid-cols-2 divide-y 2xl:divide-y-0 divide-slate-100 dark:divide-slate-800`}>
          {shown.map((r, i) => (
            <div key={r.t.matricula} className={`px-4 py-3 flex items-center gap-3 ${i >= 2 ? '2xl:border-t 2xl:border-slate-100 2xl:dark:border-slate-800' : ''}`}>
              <span className="w-9 h-9 shrink-0 rounded-xl bg-indigo-600 text-white flex items-center justify-center text-sm font-black">{r.t.name.charAt(0)}</span>
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-bold text-slate-900 dark:text-white">{r.t.name}</span>
                  {r.t.companies[0] && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300">{companyName(r.t.companies[0])}</span>
                  )}
                </span>
                <span className="block text-xs text-slate-600 dark:text-slate-300">
                  {r.prevs > 0 && (
                    <b className="text-emerald-700 dark:text-emerald-300">
                      {pl(r.prevs, 'preventiva para executar', 'preventivas para executar')}
                      {r.late > 0 && <span className="text-rose-600 dark:text-rose-400"> ({pl(r.late, 'atrasada', 'atrasadas')})</span>}
                    </b>
                  )}
                  {r.prevs > 0 && r.andamento + r.pend > 0 && ' · '}
                  {r.andamento > 0 && <b className="text-blue-700 dark:text-blue-300">{pl(r.andamento, 'chamado em andamento', 'chamados em andamento')}</b>}
                  {r.andamento > 0 && r.pend > 0 && ' · '}
                  {r.pend > 0 && <b className="text-amber-700 dark:text-amber-300">{pl(r.pend, 'pendente', 'pendentes')}</b>}
                </span>
              </span>
              <span className="shrink-0 flex flex-wrap justify-end gap-1.5">
                {r.prevs > 0 && (
                  <button type="button" className={link} onClick={() => props.onOpenPreventives(r.t.name)}>
                    Preventivas
                  </button>
                )}
                {r.andamento + r.pend > 0 && (
                  <button type="button" className={link} onClick={() => props.onOpenOs(r.t.matricula)}>
                    Chamados
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      {busy.length > SHOW && (
        <button type="button" onClick={() => setAll(!all)} className="text-xs font-bold text-indigo-600 dark:text-indigo-400 cursor-pointer">
          {all ? 'Mostrar menos' : `Ver todos (${busy.length})`}
        </button>
      )}
      {free.length > 0 && (
        <p className="text-xs text-slate-500">
          <b className="text-slate-600 dark:text-slate-300">Sem nada aberto:</b> {free.map((r) => r.t.name).join(', ')}
        </p>
      )}
    </section>
  );
}
