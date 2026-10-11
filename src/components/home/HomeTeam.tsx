import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Company, ServiceOrder, WorkOrder } from '../../types';
import { onSyncChange, syncedList } from '../../db/localSync';
import { subscribeTeamWorkOrders } from '../../db/homeTeam';
import { formatOrderNumber } from '../../utils/orderNumber';
import { homeCard, homeTitle } from './HomeNeeds';

// INÍCIO › EQUIPE AGORA: técnicos da gerência e o que cada um tem aberto.
// "Em preventiva agora" é real (horário do "Iniciar"); chamado não tem "Iniciar" (fica "Em andamento" desde a
// atribuição), então para chamados mostra quantos estão com o técnico. Técnicos: cópia guardada no aparelho (0 leitura);
// preventivas iniciadas: o que o app já carrega; chamados: escuta só dos "Em andamento" e "Pendente".

type Group = 'prev' | 'os' | 'pend' | 'free';
const GROUPS: { key: Group; label: string; color: string }[] = [
  { key: 'prev', label: 'Em preventiva agora', color: '#10b981' },
  { key: 'os', label: 'Com chamados em andamento', color: '#1d4ed8' },
  { key: 'pend', label: 'Só com pendentes', color: '#f59e0b' },
  { key: 'free', label: 'Sem nada aberto', color: '#94a3b8' }
];
const SHOW = 12;

interface Tech {
  matricula: string;
  name: string;
  companies: string[];
}

const toDate = (v: any): Date | null => {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};
const since = (v: any) => {
  const d = toDate(v);
  if (!d) return '';
  const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? hm : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hm}`;
};
const pl = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function HomeTeam(props: { units: string[]; cos: string[] | null; orders: ServiceOrder[]; companies: Company[]; onOpenTech: (matricula: string) => void }) {
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
    const order = (g: Group) => GROUPS.findIndex((x) => x.key === g);
    return techs
      .map((t) => {
        const prev = orders.find((o) => o.inExecution?.matricula === t.matricula) || null;
        const mine = calls.filter((o) => o.assignedTechnicianMatricula === t.matricula);
        const andamento = mine.filter((o) => o.status === 'Em andamento');
        const pend = mine.filter((o) => o.status === 'Pendente');
        const group: Group = prev ? 'prev' : andamento.length ? 'os' : pend.length ? 'pend' : 'free';
        return { t, prev, andamento, pend, group };
      })
      .sort((a, b) => order(a.group) - order(b.group) || a.t.name.localeCompare(b.t.name));
  }, [techs, calls, orders]);

  const companyName = (id?: string) => (id ? companies.find((c) => c.id === id)?.name || id : '');
  const color = (g: Group) => GROUPS.find((x) => x.key === g)!.color;
  const busy = rows ? rows.filter((r) => r.group !== 'free') : [];
  const free = rows ? rows.filter((r) => r.group === 'free') : [];
  const shown = all ? busy : busy.slice(0, SHOW);

  const detail = (r: NonNullable<typeof rows>[number]) => {
    if (r.andamento.length === 1) {
      const o = r.andamento[0];
      return ` · ${o.number} · ${o.execAddressText || ''}${o.assignedAt ? ` · desde ${since(o.assignedAt)}` : ''}`;
    }
    if (!r.andamento.length && r.pend.length === 1) {
      const p = r.pend[0].pauses?.[r.pend[0].pauses.length - 1];
      return ` · ${r.pend[0].number}${p?.reason ? ` · ${p.reason}` : ''}`;
    }
    return '';
  };

  return (
    <section className="space-y-3" aria-label="Equipe agora">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={homeTitle}>Equipe agora</h3>
        <span className="text-[11px] text-slate-500">Técnicos da gerência · atualiza sozinho · toque no técnico para ver os chamados dele</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {GROUPS.map((g) => (
          <div key={g.key} className={`${homeCard} p-3.5`}>
            <span className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 dark:text-slate-300">
              <i className="w-2 h-2 rounded-full inline-block" style={{ background: g.color }} />
              {g.label}
            </span>
            <span className="block text-2xl font-black tabular-nums text-slate-900 dark:text-white mt-1">{rows ? rows.filter((r) => r.group === g.key).length : '…'}</span>
          </div>
        ))}
      </div>
      {rows && rows.length === 0 && <p className="text-xs text-slate-500">Nenhum técnico ativo cadastrado nesta gerência.</p>}
      {busy.length > 0 && (
        <div className={`${homeCard} grid grid-cols-1 2xl:grid-cols-2 divide-y 2xl:divide-y-0 divide-slate-100 dark:divide-slate-800`}>
          {shown.map((r, i) => (
            <button
              key={r.t.matricula}
              type="button"
              onClick={() => props.onOpenTech(r.t.matricula)}
              className={`w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer ${i >= 2 ? '2xl:border-t 2xl:border-slate-100 2xl:dark:border-slate-800' : ''}`}
            >
              <span className="relative w-9 h-9 shrink-0 rounded-xl bg-indigo-600 text-white flex items-center justify-center text-sm font-black">
                {r.t.name.charAt(0)}
                <i className="absolute -right-0.5 -bottom-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-[#0b1220]" style={{ background: color(r.group) }} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-bold text-slate-900 dark:text-white">{r.t.name}</span>
                  {r.t.companies[0] && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300">{companyName(r.t.companies[0])}</span>
                  )}
                </span>
                {r.prev && (
                  <span className="block text-xs text-slate-600 dark:text-slate-300 truncate">
                    <b className="text-emerald-700 dark:text-emerald-300">Preventiva {formatOrderNumber(r.prev.id)}</b> · {r.prev.assetName || r.prev.title}
                    {r.prev.inExecution ? ` · desde ${since(r.prev.inExecution.deviceStartedAt)}` : ''}
                  </span>
                )}
                {(r.andamento.length > 0 || r.pend.length > 0) && (
                  <span className="block text-xs text-slate-600 dark:text-slate-300 truncate">
                    {r.andamento.length > 0 && <b className="text-blue-700 dark:text-blue-300">{pl(r.andamento.length, 'chamado em andamento', 'chamados em andamento')}</b>}
                    {r.andamento.length > 0 && r.pend.length > 0 && ' · '}
                    {r.pend.length > 0 && <b className="text-amber-700 dark:text-amber-300">{pl(r.pend.length, 'pendente', 'pendentes')}</b>}
                    {detail(r)}
                  </span>
                )}
              </span>
              <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
            </button>
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
