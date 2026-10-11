import React from 'react';
import { CheckCircle2, ChevronRight } from 'lucide-react';

// INÍCIO › "PRECISA DE VOCÊ": só o que espera uma ação desta pessoa (número maior que zero).
// Cada linha leva direto à tela, já filtrada.

export interface HomeNeed {
  key: string;
  n: number;
  text: string;
  hint: string;
  icon: React.ReactNode;
  tone: string;
  onOpen: () => void;
}

export const homeCard = 'rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b1220]';
export const homeTitle = 'text-[11px] font-black uppercase tracking-widest text-slate-500';

export default function HomeNeeds({ items }: { items: HomeNeed[] }) {
  const rows = items.filter((r) => r.n > 0);
  return (
    <section className="space-y-3" aria-label="Precisa de você">
      <h3 className={homeTitle}>Precisa de você</h3>
      {rows.length === 0 ? (
        <div className={`${homeCard} p-5 flex items-center gap-3`}>
          <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0" />
          <div>
            <p className="text-sm font-black text-slate-900 dark:text-white">Nada pendente para você agora</p>
            <p className="text-xs text-slate-500">Quando algo precisar de você (assinar, planejar, decidir, aprovar), aparece aqui.</p>
          </div>
        </div>
      ) : (
        <div className={`${homeCard} grid grid-cols-1 ${rows.length > 1 ? 'lg:grid-cols-2' : ''} divide-y lg:divide-y-0 divide-slate-100 dark:divide-slate-800`}>
          {rows.map((r, i) => (
            <button
              key={r.key}
              type="button"
              onClick={r.onOpen}
              className={`text-left px-4 py-3 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer ${i >= 2 && rows.length > 1 ? 'lg:border-t lg:border-slate-100 lg:dark:border-slate-800' : ''}`}
            >
              <span className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center ${r.tone}`}>{r.icon}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-slate-800 dark:text-slate-100">
                  <strong className="text-base font-black text-slate-900 dark:text-white tabular-nums mr-1">{r.n}</strong>
                  {r.text}
                </span>
                <span className="block text-[11px] text-slate-500 truncate">{r.hint}</span>
              </span>
              <span className="shrink-0 flex items-center gap-0.5 text-xs font-bold text-indigo-600 dark:text-indigo-400">
                Abrir <ChevronRight className="w-3.5 h-3.5" />
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
