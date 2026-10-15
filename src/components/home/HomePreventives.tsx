import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, Wrench } from 'lucide-react';
import { ServiceOrder } from '../../types';
import { StatRow, dbGetMonthlySummaries, localMonthKey } from '../../db/firebase';
import { homeCard, homeTitle } from './HomeNeeds';

// INÍCIO › PREVENTIVAS: cartões das abertas (agora, até este mês) + cumprimento do mês escolhido.
// Cada OS conta 1: preventiva de ativo = 1 por ativo no mês (prazo = mês inteiro); vistoria = 1 por dia útil ou semana.
// Por isso uma barra por tipo: ativos com a linha de "hoje" (verde passando da linha = no ritmo); vistorias com o
// "% no prazo" das que já venceram. Mês atual: OS que o app já carregou. Meses anteriores: resumo gravado no
// fechamento do dia 1º (monthlySummaries, 1 leitura por gerência) — só para quem vê todas as empresas (o resumo não separa).

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const VISTORIA = ['Diária', 'Semanal', 'Quinzenal'];
const monthName = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1] || m;
const shiftMonth = (m: string, d: number) => {
  const [y, mo] = m.split('-').map(Number);
  return localMonthKey(new Date(y, mo - 1 + d, 1));
};
const pctOf = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

interface TypeStat {
  total: number;
  done: number;
  notDone: number;
  late: number;
  due: number; // já venceram (prazo antes de hoje)
  dueDone: number;
}
type Stats = { ativos: TypeStat; vistorias: TypeStat };
const blank = (): TypeStat => ({ total: 0, done: 0, notDone: 0, late: 0, due: 0, dueDone: 0 });

function liveStats(orders: ServiceOrder[], month: string, today: string): Stats {
  const s: Stats = { ativos: blank(), vistorias: blank() };
  orders.forEach((o) => {
    if (o.status === 'Cancelada' || (o.endDate || '').slice(0, 7) !== month) return;
    const t = VISTORIA.includes(o.periodicity || '') ? s.vistorias : s.ativos;
    t.total++;
    if (o.status === 'Concluída') t.done++;
    else if (o.status === 'Não Executada') t.notDone++;
    else if (o.status === 'Atrasada') t.late++;
    if ((o.endDate || '') < today) {
      t.due++;
      if (o.status === 'Concluída') t.dueDone++;
    }
  });
  return s;
}

function summaryStats(rows: StatRow[]): Stats {
  const s: Stats = { ativos: blank(), vistorias: blank() };
  rows.forEach((r) => {
    if (r.r === 'L') return;
    const t = VISTORIA.includes(r.p) ? s.vistorias : s.ativos;
    t.total += r.n;
    t.due += r.n;
    if (r.r === 'N') t.notDone += r.n;
    else {
      t.done += r.n;
      t.dueDone += r.n;
    }
  });
  return s;
}

const COLORS = { done: '#10b981', notDone: '#94a3b8', late: '#fb7185' };

function TypeBar(props: { label: string; sub: string; t: TypeStat; head: string; ok: boolean; note: string; todayPct: number | null }) {
  const { t } = props;
  const w = (n: number) => `${(n / t.total) * 100}%`;
  const dot = (c: string) => <i className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: c }} />;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-black text-slate-800 dark:text-slate-100">
          {props.label} <span className="font-semibold text-slate-500">· {props.sub}</span>
        </p>
        <p className="text-xs text-slate-600 dark:text-slate-300">
          <b className="text-slate-900 dark:text-white tabular-nums">{t.done}</b> de {t.total} feitas ·{' '}
          <b className={props.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>{props.head}</b>
        </p>
      </div>
      <div className="relative">
        <div className="h-3.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex">
          <div className="h-full" style={{ width: w(t.done), background: COLORS.done }} />
          <div className="h-full" style={{ width: w(t.notDone), background: COLORS.notDone }} />
          <div className="h-full" style={{ width: w(t.late), background: COLORS.late }} />
        </div>
        {props.todayPct !== null && (
          <div className="absolute -top-1 -bottom-1 w-0.5 bg-slate-900 dark:bg-white" style={{ left: `${props.todayPct}%` }} title="Hoje" />
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5">{dot(COLORS.done)} Feitas {t.done}</span>
        <span className="flex items-center gap-1.5">{dot(COLORS.notDone)} Não executadas {t.notDone}</span>
        {props.todayPct !== null && (
          <>
            <span className="flex items-center gap-1.5">{dot(COLORS.late)} Atrasadas {t.late}</span>
            <span className="flex items-center gap-1.5">
              <i className="w-2.5 h-2.5 rounded-full inline-block bg-slate-200 dark:bg-slate-700" /> Ainda no prazo {t.total - t.done - t.notDone - t.late}
            </span>
          </>
        )}
      </div>
      <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300">{props.note}</p>
    </div>
  );
}

// Fase 7E-1: abre Ordens de Serviço › Preventivas já no contador certo (o planejamento saiu do PMOC)
type Target = 'aprog' | 'prog' | 'exec' | 'atr' | 'consulta';

// Ajuste S4 (simulação geral): loading = a cópia das OS deste aparelho ainda não chegou — mostra "Carregando…" e "…"
// em vez de "ainda não foram disparadas" e zeros (no computador novo a 1ª carga pode levar um tempo).
export default function HomePreventives(props: { orders: ServiceOrder[]; units: string[]; canSeePast: boolean; loading?: boolean; onOpen: (t: Target) => void }) {
  const { orders, units, canSeePast, loading } = props;
  const now = new Date();
  const current = localMonthKey(now);
  const today = `${current}-${String(now.getDate()).padStart(2, '0')}`;
  const todayPct = Math.round((now.getDate() / new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()) * 100);
  const [month, setMonth] = useState(current);
  const [summaries, setSummaries] = useState<Record<string, StatRow[] | 'loading'>>({});
  const unitsKey = units.join('|');

  // Resumos gravados no fechamento: o mês escolhido (se não for o atual) e o mês passado (linha "mês passado")
  useEffect(() => setSummaries({}), [unitsKey]);
  useEffect(() => {
    if (!canSeePast || units.length === 0) return;
    const need = [shiftMonth(current, -1), month].filter((m) => m !== current && summaries[m] === undefined);
    if (need.length === 0) return;
    setSummaries((p) => ({ ...p, ...Object.fromEntries(need.map((m) => [m, 'loading' as const])) }));
    need.forEach((m) =>
      dbGetMonthlySummaries([m], units)
        .then((rows) => setSummaries((p) => ({ ...p, [m]: rows })))
        .catch(() => setSummaries((p) => ({ ...p, [m]: [] })))
    );
  }, [month, unitsKey, canSeePast, summaries]);

  // Abertas (agora): deste mês e de antes — meses futuros já disparados ficam no PMOC
  const open = useMemo(() => {
    const c = { novo: 0, planejada: 0, execucao: 0, atrasada: 0 };
    const end = `${current}-31`;
    orders.forEach((o) => {
      if ((o.startDate || o.scheduledDate || o.endDate || '') > end) return;
      if (o.status === 'Novo') c.novo++;
      else if (o.status === 'Planejada') c.planejada++;
      else if (o.status === 'Em Execução') c.execucao++;
      else if (o.status === 'Atrasada') c.atrasada++;
    });
    return c;
  }, [orders, current]);

  const isCurrent = month === current;
  const stats = useMemo<Stats | null>(() => {
    if (isCurrent) return loading ? null : liveStats(orders, month, today);
    const rows = summaries[month];
    return Array.isArray(rows) ? summaryStats(rows) : null;
  }, [orders, month, isCurrent, today, summaries, loading]);
  const prevRows = summaries[shiftMonth(current, -1)];
  const prev = Array.isArray(prevRows) ? summaryStats(prevRows) : null;
  const empty = !!stats && stats.ativos.total + stats.vistorias.total === 0;

  const ativosRow = (t: TypeStat) => {
    if (!isCurrent) return { head: `fechou com ${pctOf(t.done, t.total)}% feitas`, ok: true, note: 'Mês fechado: o que não foi feito no prazo virou "não executada".' };
    const ok = pctOf(t.done, t.total) >= todayPct;
    return {
      head: `${ok ? 'no ritmo' : 'abaixo do ritmo'} (${pctOf(t.done, t.total)}% feitas, ${todayPct}% do mês passou)`,
      ok,
      note: 'O prazo é o mês inteiro: verde passando da linha de hoje = no ritmo.'
    };
  };
  const vistoriasRow = (t: TypeStat) => {
    if (!isCurrent) return { head: `fechou com ${pctOf(t.done, t.total)}% feitas`, ok: true, note: 'Mês fechado: o que não foi feito no prazo virou "não executada".' };
    if (t.due === 0) return { head: 'nenhuma venceu ainda', ok: true, note: 'Conta só os dias e semanas que já passaram.' };
    return {
      head: `${pctOf(t.dueDone, t.due)}% no prazo`,
      ok: pctOf(t.dueDone, t.due) >= 90,
      note: `Das ${t.due} que já venceram (dias e semanas que passaram), ${t.dueDone} foram feitas no prazo. As outras ${t.total - t.due} são dos dias e semanas que ainda vêm.`
    };
  };

  const openCards = [
    { label: 'Aguardando planejamento', n: loading ? null : open.novo, tone: 'text-indigo-600 dark:text-indigo-400', icon: <CalendarClock className="w-4 h-4" />, hint: 'Ordens de Serviço › Preventivas', to: 'aprog' as Target },
    { label: 'Planejadas', n: loading ? null : open.planejada, tone: 'text-sky-600 dark:text-sky-400', icon: <ClipboardCheck className="w-4 h-4" />, hint: 'Ordens de Serviço › Preventivas', to: 'prog' as Target },
    { label: 'Em execução', n: loading ? null : open.execucao, tone: 'text-amber-600 dark:text-amber-400', icon: <Wrench className="w-4 h-4" />, hint: 'Ordens de Serviço › Preventivas', to: 'exec' as Target },
    { label: 'Atrasadas', n: loading ? null : open.atrasada, tone: 'text-rose-600 dark:text-rose-400', icon: <AlertTriangle className="w-4 h-4" />, hint: 'Ordens de Serviço › Preventivas', to: 'atr' as Target },
    { label: `Concluídas em ${monthName(month)}`, n: stats ? stats.ativos.done + stats.vistorias.done : null, tone: 'text-emerald-600 dark:text-emerald-400', icon: <CheckCircle2 className="w-4 h-4" />, hint: 'PMOC › Preventivas › Consulta', to: 'consulta' as Target },
    { label: `Não executadas em ${monthName(month)}`, n: stats ? stats.ativos.notDone + stats.vistorias.notDone : null, tone: 'text-slate-500 dark:text-slate-400', icon: <AlertTriangle className="w-4 h-4" />, hint: 'PMOC › Preventivas › Consulta', to: 'consulta' as Target }
  ];
  const arrow = 'p-1 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-indigo-600 disabled:opacity-30 disabled:pointer-events-none cursor-pointer';

  return (
    <section className="space-y-3" aria-label="Preventivas">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={homeTitle}>Preventivas e vistorias</h3>
        {canSeePast && (
          <div className="flex items-center gap-1.5">
            <button type="button" className={arrow} onClick={() => setMonth(shiftMonth(month, -1))} disabled={month <= shiftMonth(current, -12)} aria-label="Mês anterior">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="min-w-[130px] text-center text-xs font-black text-slate-700 dark:text-slate-200">
              {monthName(month).charAt(0).toUpperCase() + monthName(month).slice(1)} de {month.slice(0, 4)}
            </span>
            <button type="button" className={arrow} onClick={() => setMonth(shiftMonth(month, 1))} disabled={isCurrent} aria-label="Próximo mês">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
      {/* Em tela larga: cumprimento à esquerda, cartões à direita */}
      <div className="grid grid-cols-1 2xl:grid-cols-5 gap-3 items-start">
      <div className={`${homeCard} p-4 space-y-5 2xl:col-span-3`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-black text-slate-900 dark:text-white">Cumprimento de {monthName(month)}</p>
          {isCurrent && (
            <p className="text-[11px] text-slate-500">
              Cada OS conta 1 · a linha preta é <b>hoje</b> (dia {now.getDate()} = {todayPct}% do mês)
            </p>
          )}
        </div>
        {!stats && <p className="text-xs text-slate-500">Carregando…</p>}
        {stats && empty && (
          <p className="text-xs font-bold text-slate-500">
            {isCurrent
              ? `As preventivas de ${monthName(month)} ainda não foram disparadas.`
              : `Sem resumo de ${monthName(month)}: o fechamento grava o resumo no dia 1º do mês seguinte.`}
          </p>
        )}
        {stats && stats.ativos.total > 0 && (
          <TypeBar label="Preventivas (ativos)" sub="1 por ativo no mês" t={stats.ativos} todayPct={isCurrent ? todayPct : null} {...ativosRow(stats.ativos)} />
        )}
        {stats && stats.vistorias.total > 0 && (
          <TypeBar label="Vistorias (endereços)" sub="diárias, semanais e quinzenais" t={stats.vistorias} todayPct={isCurrent ? todayPct : null} {...vistoriasRow(stats.vistorias)} />
        )}
        {isCurrent && prev && prev.ativos.total + prev.vistorias.total > 0 && (
          <p className="text-[11px] text-slate-500 border-t border-slate-100 dark:border-slate-800 pt-3">
            <b className="text-slate-600 dark:text-slate-300">Mês passado ({monthName(shiftMonth(current, -1))}):</b>
            {prev.ativos.total > 0 && ` preventivas ${pctOf(prev.ativos.done, prev.ativos.total)}% feitas`}
            {prev.ativos.total > 0 && prev.vistorias.total > 0 && ' ·'}
            {prev.vistorias.total > 0 && ` vistorias ${pctOf(prev.vistorias.done, prev.vistorias.total)}% feitas`}
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 2xl:col-span-2">
        {openCards.map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={() => props.onOpen(c.to)}
            className={`${homeCard} text-left p-4 hover:border-indigo-300 dark:hover:border-indigo-700 cursor-pointer flex flex-col gap-1.5`}
          >
            <span className={`flex items-center gap-2 text-xs font-bold ${c.tone}`}>
              {c.icon}
              {c.label}
            </span>
            <span className="text-3xl font-black tabular-nums text-slate-900 dark:text-white">{c.n ?? '…'}</span>
            <span className="flex items-center gap-1 text-[11px] text-slate-500">
              {c.hint}
              <ChevronRight className="w-3 h-3" />
            </span>
          </button>
        ))}
      </div>
      </div>
      <p className="text-[11px] text-slate-500">Abertas = deste mês e de antes, ainda não encerradas (as de meses futuros já disparados ficam no PMOC).</p>
    </section>
  );
}
