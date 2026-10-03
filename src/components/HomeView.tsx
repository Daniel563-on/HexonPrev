import React, { useMemo } from 'react';
import { ClipboardCheck, CalendarClock, Wrench, CheckCircle2, AlertTriangle, BellRing, ChevronRight } from 'lucide-react';
import { HexonUser, ServiceOrder } from '../types';
import { localMonthKey } from '../db/firebase';

// INÍCIO (Hexon 2.0, Fase 1): resumo de acordo com o perfil.
// Usa só as OS que o sistema já carregou (abertas + encerradas no mês, da gerência exibida) e o contador de
// solicitações que o menu já usa: nenhuma leitura extra no banco.
// Cada cartão aparece só para quem tem acesso à tela correspondente e leva até ela.

interface HomeViewProps {
  userProfile: HexonUser;
  orders: ServiceOrder[];
  pendingSolicitationsCount: number;
  canSeeOrders: boolean;
  canSeeSolicitations: boolean;
  activeUnit?: string; // gerência exibida para quem vê todas (escolhida no topo)
  onNavigate: (tab: string) => void;
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export default function HomeView({
  userProfile,
  orders,
  pendingSolicitationsCount,
  canSeeOrders,
  canSeeSolicitations,
  activeUnit,
  onNavigate
}: HomeViewProps) {
  const month = localMonthKey();
  const monthLabel = `${MONTHS[Number(month.slice(5, 7)) - 1]} de ${month.slice(0, 4)}`;

  const counts = useMemo(() => {
    const c = { novo: 0, planejada: 0, execucao: 0, atrasada: 0, concluida: 0, naoExecutada: 0 };
    orders.forEach((o) => {
      if (o.status === 'Novo') c.novo++;
      else if (o.status === 'Planejada') c.planejada++;
      else if (o.status === 'Em Execução') c.execucao++;
      else if (o.status === 'Atrasada') c.atrasada++;
      else if (o.status === 'Concluída' && o.closedMonth === month) c.concluida++;
      else if (o.status === 'Não Executada' && o.closedMonth === month) c.naoExecutada++;
    });
    return c;
  }, [orders, month]);

  const firstName = (userProfile.name || '').split(' ')[0];

  const cards: { key: string; label: string; hint: string; value: number; tab: string; icon: React.ReactNode; tone: string }[] = [];
  if (canSeeOrders) {
    cards.push(
      { key: 'novo', label: 'Aguardando planejamento', hint: 'PMOC › Preventivas', value: counts.novo, tab: 'pmoc-preventivas', icon: <CalendarClock className="w-4 h-4" />, tone: 'text-indigo-600 dark:text-indigo-400' },
      { key: 'planejada', label: 'Planejadas', hint: 'Ordens de Serviço › Preventivas', value: counts.planejada, tab: 'service-orders', icon: <ClipboardCheck className="w-4 h-4" />, tone: 'text-sky-600 dark:text-sky-400' },
      { key: 'execucao', label: 'Em execução', hint: 'Ordens de Serviço › Preventivas', value: counts.execucao, tab: 'service-orders', icon: <Wrench className="w-4 h-4" />, tone: 'text-amber-600 dark:text-amber-400' },
      { key: 'atrasada', label: 'Atrasadas', hint: 'Ordens de Serviço › Preventivas', value: counts.atrasada, tab: 'service-orders', icon: <AlertTriangle className="w-4 h-4" />, tone: 'text-rose-600 dark:text-rose-400' },
      { key: 'concluida', label: `Concluídas em ${MONTHS[Number(month.slice(5, 7)) - 1]}`, hint: 'PMOC › Preventivas › Consulta', value: counts.concluida, tab: 'pmoc-preventivas', icon: <CheckCircle2 className="w-4 h-4" />, tone: 'text-emerald-600 dark:text-emerald-400' },
      { key: 'naoExecutada', label: `Não executadas em ${MONTHS[Number(month.slice(5, 7)) - 1]}`, hint: 'PMOC › Preventivas › Consulta', value: counts.naoExecutada, tab: 'pmoc-preventivas', icon: <AlertTriangle className="w-4 h-4" />, tone: 'text-slate-500 dark:text-slate-400' }
    );
  }
  if (canSeeSolicitations) {
    cards.push({ key: 'solic', label: 'Solicitações aguardando decisão', hint: 'Solicitações', value: pendingSolicitationsCount, tab: 'solicitations', icon: <BellRing className="w-4 h-4" />, tone: 'text-orange-600 dark:text-orange-400' });
  }

  return (
    <div className="space-y-6 font-sans max-w-6xl">
      <div className="border-b pb-4 border-slate-200 dark:border-slate-800">
        <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">Olá, {firstName}</h2>
        <p className="text-xs text-slate-500 mt-1">
          Resumo de {monthLabel}
          {activeUnit ? ` · gerência ${activeUnit} (troque no topo da tela)` : ''}.
        </p>
      </div>

      {cards.length > 0 ? (
        <section className="space-y-3">
          {canSeeOrders && (
            <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-500">Preventivas</h3>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {cards.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => onNavigate(c.tab)}
                className="text-left p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b1220] hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors cursor-pointer flex flex-col gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <span className={`flex items-center gap-2 text-xs font-bold ${c.tone}`}>
                  {c.icon}
                  {c.label}
                </span>
                <span className="text-3xl font-black tabular-nums text-slate-900 dark:text-white">{c.value}</span>
                <span className="flex items-center gap-1 text-[11px] text-slate-500">
                  {c.hint}
                  <ChevronRight className="w-3 h-3" />
                </span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-500">
            Abertas = todas as que ainda não foram encerradas, de qualquer mês. Concluídas e não executadas = só as encerradas neste mês.
          </p>
        </section>
      ) : (
        <p className="text-sm text-slate-500">Use o menu ao lado para acessar as telas do seu perfil.</p>
      )}
    </div>
  );
}
