import React, { useEffect, useState } from 'react';
import { getLoadTimes, LoadTime, onLoadTimes } from '../../utils/loadTimes';

// TEMPO DE CARREGAMENTO (diagnóstico, Meu Perfil): quanto cada carga demorou neste aparelho desde que o app abriu.
// O print desta tela mostra onde está a demora (verde até 1 s, amarelo até 3 s, vermelho acima).
export default function LoadTimesCard({ darkMode }: { darkMode: boolean }) {
  const [list, setList] = useState<LoadTime[]>(() => getLoadTimes());
  useEffect(() => onLoadTimes(() => setList(getLoadTimes())), []);
  const sec = (ms: number) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
  const hour = (at: number) => new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 px-1">Tempo de carregamento</h4>
      <div className={`px-4 py-2 rounded-2xl border divide-y ${darkMode ? 'bg-slate-900/90 border-slate-800 divide-slate-800 text-slate-100' : 'bg-white border-slate-200 divide-slate-100 text-slate-800'}`}>
        {list.length === 0 && <p className="py-2 text-xs text-slate-500">Nada carregado ainda nesta sessão.</p>}
        {list.map((t) => (
          <div key={t.label} className="flex items-start justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="text-xs font-bold leading-snug">{t.label}</p>
              <p className="text-[10px] text-slate-500">
                {hour(t.at)}
                {t.detail ? ` · ${t.detail}` : ''}
              </p>
              {t.error && <p className="text-[10px] font-bold text-rose-600 break-words">{t.error}</p>}
            </div>
            <span className={`shrink-0 text-xs font-mono font-black ${t.ms > 3000 ? 'text-rose-600' : t.ms > 1000 ? 'text-amber-600' : 'text-emerald-600'}`}>
              {sec(t.ms)}
            </span>
          </div>
        ))}
        <p className="py-2 text-[10px] text-slate-400">Desde que o app abriu neste aparelho (some ao recarregar).</p>
      </div>
    </div>
  );
}
