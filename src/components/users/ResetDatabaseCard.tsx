import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, DatabaseZap, Loader2 } from 'lucide-react';
import { dbResetCount, dbResetRun, ResetCount, ResetMode, ResetProgress, subscribeResetProgress } from '../../db/resetDatabase';

// ZERAR O BANCO (ajuste A2; só Super Administrador): escolhe o modo → conta → digita ZERAR → o servidor apaga
// (com o modo manutenção ligado) e cada aparelho apaga a própria cópia guardada ao abrir o sistema.

const MODES: { key: ResetMode; title: string; tag: string; text: string }[] = [
  {
    key: 'movimento',
    title: 'Limpar movimento',
    tag: 'testes',
    text: 'Apaga OS, preventivas, chamados, programação, pedidos, numeração e avisos. Mantém usuários, cadastros, Auditoria e início do ciclo oficial.'
  },
  {
    key: 'implantacao',
    title: 'Zerar para implantação',
    tag: 'começo oficial',
    text: 'Tudo do anterior + Auditoria, registros de acesso, início do ciclo oficial e usuários: ficam só os Super Administradores (com os logins deles).'
  }
];

const KEEP_ALWAYS =
  'empresas, gerências, perfis, ativos e tipos, endereços, modelos (preventiva, OS, PDF e etiqueta), materiais, insumos, efetivo, cargos e valores, regras de hora extra, pernoite, equipes habituais, almoxarifados, logo e tela de login, painel do Histórico GLPI';

const n = (v: number) => v.toLocaleString('pt-BR');
const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');

export default function ResetDatabaseCard({ darkMode }: { darkMode: boolean }) {
  const [mode, setMode] = useState<ResetMode>('movimento');
  const [count, setCount] = useState<ResetCount | null>(null);
  const [counting, setCounting] = useState(false);
  const [typed, setTyped] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<ResetProgress | null>(null);

  useEffect(() => subscribeResetProgress(setProgress), []);

  const pick = (m: ResetMode) => {
    setMode(m);
    setCount(null);
    setTyped('');
    setError('');
  };

  const doCount = async () => {
    setCounting(true);
    setError('');
    setCount(null);
    try {
      setCount(await dbResetCount(mode));
    } catch (e: any) {
      setError(`Não foi possível contar: ${e?.message || e}`);
    } finally {
      setCounting(false);
    }
  };

  const doRun = async () => {
    setStarting(true);
    setError('');
    try {
      await dbResetRun(mode, typed.trim());
      setCount(null);
      setTyped('');
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setStarting(false);
    }
  };

  const running = !!progress?.running || starting;
  const pct = progress?.total ? Math.min(100, Math.round(((progress.done || 0) / progress.total) * 100)) : 0;
  const box = darkMode ? 'bg-[#0a1122]/40 border-rose-900/60' : 'bg-white border-rose-200';
  const strong = darkMode ? 'text-slate-200' : 'text-slate-800';
  const btn = 'px-4 py-2 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
  const keepText = mode === 'movimento' ? `${KEEP_ALWAYS}, usuários, Auditoria e início do ciclo oficial` : KEEP_ALWAYS;

  return (
    <div className={`p-5 rounded-xl border-2 space-y-4 ${box}`}>
      <div>
        <h3 className={`flex items-center gap-2 text-sm font-black uppercase tracking-wider ${strong}`}>
          <span className="w-7 h-7 shrink-0 rounded-lg bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 flex items-center justify-center">
            <DatabaseZap className="w-4 h-4" />
          </span>
          Zerar o banco
        </h3>
        <p className="text-xs text-slate-500 mt-1">
          Apaga o movimento do sistema para recomeçar (testes ou implantação). Quem apaga é o servidor. <b className="text-rose-600">Não tem volta.</b>
        </p>
      </div>

      {/* MODO */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2" role="radiogroup" aria-label="Modo do zerar">
        {MODES.map((m) => {
          const on = mode === m.key;
          return (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={running}
              onClick={() => pick(m.key)}
              className={`text-left p-3 rounded-xl border-2 cursor-pointer disabled:cursor-not-allowed ${
                on ? 'border-rose-500 bg-rose-50/70 dark:bg-rose-950/30' : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              <span className="flex items-center gap-2">
                <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${on ? 'border-rose-600' : 'border-slate-300'}`}>
                  {on && <span className="w-2 h-2 rounded-full bg-rose-600" />}
                </span>
                <span className={`text-xs font-black ${strong}`}>{m.title}</span>
                <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-500">{m.tag}</span>
              </span>
              <span className="block text-[11px] text-slate-500 mt-1.5 leading-snug">{m.text}</span>
            </button>
          );
        })}
      </div>

      <p className="text-[11px] text-emerald-700 dark:text-emerald-400 flex gap-1.5">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          <b>Ficam:</b> {keepText}.
        </span>
      </p>

      {/* CONTAR */}
      {!running && (
        <button type="button" disabled={counting} onClick={doCount} className={`${btn} border border-slate-300 dark:border-slate-600 ${strong}`}>
          {counting ? 'Contando...' : count ? 'Contar de novo' : 'Contar o que vai ser apagado'}
        </button>
      )}

      {count && !running && (
        <div className="space-y-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-slate-400 text-left">
                <th className="py-1.5 font-black">Vai ser apagado</th>
                <th className="py-1.5 font-black text-right">Quantidade</th>
              </tr>
            </thead>
            <tbody>
              {count.groups.map((g) => (
                <tr key={g.key} className="border-t border-slate-100 dark:border-slate-800">
                  <td className={`py-1.5 pr-2 ${strong}`}>
                    {g.label}
                    {g.keepAdmins && (
                      <span className="block text-[10px] text-slate-500">
                        Ficam: {g.keepAdmins.join(', ') || '—'} · logins que saem: {n(g.logins || 0)}
                      </span>
                    )}
                  </td>
                  <td className={`py-1.5 text-right font-mono font-bold ${g.count ? strong : 'text-slate-400'}`}>{n(g.count)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-200 dark:border-slate-700">
                <td className={`py-2 font-black ${strong}`}>Total</td>
                <td className="py-2 text-right font-mono font-black text-rose-600">{n(count.total)}</td>
              </tr>
            </tbody>
          </table>

          <div className="p-3 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/60 dark:bg-rose-950/20 space-y-2">
            <p className="text-[11px] text-rose-800 dark:text-rose-300 flex gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                Durante o zerar o <b>modo manutenção</b> fica ligado (todos, menos o Super Administrador, são desconectados). No fim, cada computador e celular
                apaga a cópia guardada ao abrir o sistema.{mode === 'implantacao' && ' Faça antes a cópia de segurança do banco.'}
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value.toUpperCase())}
                placeholder="Digite ZERAR"
                aria-label="Digite ZERAR para confirmar"
                className="w-40 h-9 px-3 rounded-lg border border-rose-300 bg-white dark:bg-slate-900 text-xs font-black tracking-widest text-rose-700"
              />
              <button type="button" disabled={typed.trim() !== 'ZERAR' || count.total === 0} onClick={doRun} className={`${btn} bg-rose-600 hover:bg-rose-700 text-white`}>
                Zerar o banco ({n(count.total)})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ANDAMENTO */}
      {running && (
        <div className="p-3 rounded-xl border border-amber-300 bg-amber-50/70 dark:bg-amber-950/20 space-y-2">
          <p className="text-xs font-black text-amber-900 dark:text-amber-300 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Zerando ({progress?.modeLabel || MODES.find((m) => m.key === mode)?.title})...
          </p>
          <div className="h-2.5 rounded-full bg-amber-100 dark:bg-amber-900/40 overflow-hidden">
            <div className="h-full bg-amber-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[11px] text-amber-900 dark:text-amber-300">
            {progress?.step || 'Começando'} · {n(progress?.done || 0)} de {n(progress?.total || 0)} ({pct}%)
          </p>
          <p className="text-[10px] text-slate-500">Não precisa ficar nesta tela: o servidor continua sozinho. No fim, esta página recarrega para apagar a cópia deste aparelho.</p>
        </div>
      )}

      {error && <p className="text-xs font-bold text-rose-600">{error}</p>}

      {/* ÚLTIMO ZERAR */}
      {progress && !progress.running && progress.finishedAt && (
        <p className={`text-[11px] ${progress.ok ? 'text-slate-500' : 'text-rose-600 font-bold'}`}>
          {progress.ok
            ? `Último zerar: ${fmt(progress.finishedAt)} por ${progress.by} — ${progress.modeLabel} — ${n(progress.done || 0)} documentos apagados.`
            : `O último zerar (${fmt(progress.finishedAt)}, ${progress.by}) parou no meio depois de ${n(progress.done || 0)} documentos: ${progress.error}. Pode rodar de novo para terminar.`}
        </p>
      )}
    </div>
  );
}
