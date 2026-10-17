import React from 'react';
import { AlertTriangle, Link2, PauseCircle, XCircle } from 'lucide-react';
import { HomeOsCounts } from '../../db/homeCounts';
import { homeCard, homeTitle } from './HomeNeeds';

// INÍCIO › "CHAMADOS GLPI AGORA": os números do painel da lista de OS (qualquer mês) + atrasadas.
// Cada cartão abre a lista já filtrada. Assinaturas na cor de cada papel (cliente verde, engenheiro roxo, gerente laranja).

// U16: 9 cartões em 3 colunas, na ordem do caminho da OS (aberta → execução → assinaturas → problemas)
const CARDS: { key: string; label: string; color: string; icon?: React.ReactNode; note?: string }[] = [
  { key: 'Nova', label: 'Novas', color: '#475569' },
  { key: 'Em andamento', label: 'Em andamento', color: '#1d4ed8' },
  { key: 'Pendente', label: 'Pendentes', color: '#b45309', icon: <PauseCircle className="w-3.5 h-3.5" /> },
  { key: 'sign:cliente', label: 'Aguardando assinatura do cliente', color: '#047857', note: 'link ainda não enviado' },
  { key: 'link', label: 'Link enviado ao cliente', color: '#0f766e', icon: <Link2 className="w-3.5 h-3.5" />, note: 'aguardando o cliente validar' },
  { key: 'sign:engenheiro', label: 'Aguardando assinatura do engenheiro', color: '#6d28d9' },
  { key: 'sign:gerente', label: 'Aguardando assinatura do gerente', color: '#c2410c' },
  { key: 'Contestada', label: 'Contestadas', color: '#be123c', icon: <XCircle className="w-3.5 h-3.5" /> },
  { key: 'late', label: 'Atrasadas', color: '#e11d48', icon: <AlertTriangle className="w-3.5 h-3.5" />, note: 'técnico ainda não assinou' }
];

export default function HomeOsNow({ counts, onOpen }: { counts: HomeOsCounts | null; onOpen: (key: string) => void }) {
  const value = (key: string) => (counts ? (key === 'late' ? counts.late : counts.byStatus[key as keyof HomeOsCounts['byStatus']] ?? 0) : null);
  return (
    <section className="space-y-3" aria-label="Chamados GLPI agora">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={homeTitle}>Chamados GLPI agora</h3>
        <span className="text-[11px] text-slate-500">Atualiza sozinho · toque para abrir a lista já filtrada</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {CARDS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => onOpen(c.key)}
            className={`${homeCard} text-left p-3.5 hover:border-indigo-300 dark:hover:border-indigo-700 cursor-pointer flex flex-col gap-1 border-l-4`}
            style={{ borderLeftColor: c.color }}
          >
            <span className="text-2xl font-black tabular-nums" style={{ color: c.color }}>
              {value(c.key) ?? '…'}
            </span>
            <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 leading-snug flex items-center gap-1">
              {c.icon}
              {c.label}
            </span>
            {c.note && <span className="text-[10px] text-slate-400">{c.note}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
