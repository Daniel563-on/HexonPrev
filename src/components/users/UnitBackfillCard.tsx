import React, { useState } from 'react';
import { dbBackfillOrderUnits, UnitBackfillResult } from '../../db/firebase';

// CORREÇÃO ÚNICA: grava a unidade em todas as OS (antes das novas regras do banco)
export default function UnitBackfillCard({ darkMode }: { darkMode: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<UnitBackfillResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      setResult(await dbBackfillOrderUnits());
      setConfirming(false);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setRunning(false);
    }
  };

  const box = darkMode ? 'bg-[#0a1122]/40 border-slate-800' : 'bg-white border-slate-200';
  const strong = darkMode ? 'text-slate-200' : 'text-slate-800';

  return (
    <div className={`p-5 rounded-xl border mb-4 space-y-3 ${box}`}>
      <div>
        <h3 className={`text-sm font-black uppercase tracking-wider ${strong}`}>Corrigir unidade das OS</h3>
        <p className="text-xs text-slate-500 mt-1">
          Preenche nas ordens de serviço o que estiver faltando: unidade (nome da gerência), CRAAI e comarca do ativo e mês de encerramento
          das concluídas/não executadas; e liga o histórico das vistorias ao QR do imóvel. Nada é apagado. Pode ser executado mais de uma vez.
        </p>
      </div>

      {!confirming ? (
        <button
          type="button"
          onClick={() => { setConfirming(true); setResult(null); setError(null); }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold cursor-pointer"
        >
          Corrigir unidade das OS
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs font-bold ${strong}`}>Confirma a correção de todas as OS?</span>
          <button
            type="button"
            onClick={run}
            disabled={running}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold cursor-pointer disabled:opacity-50"
          >
            {running ? 'Corrigindo...' : 'Sim, corrigir'}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={running}
            className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-xs font-bold cursor-pointer"
          >
            Cancelar
          </button>
        </div>
      )}

      {error && <p className="text-xs font-bold text-rose-600">Não foi possível corrigir: {error}</p>}

      {result && (
        <div className={`text-xs space-y-1 ${strong}`}>
          <p className="font-bold text-emerald-600">Correção concluída.</p>
          <p>OS lidas: {result.total} • OS atualizadas: {result.updated}</p>
          <p>
            Preenchidos agora: unidade em {result.unitsFilled} • CRAAI/comarca em {result.locationFilled} • mês de encerramento em{' '}
            {result.closedMonthFilled} • históricos de vistoria ligados ao imóvel: {result.historiesFixed}
          </p>
          <p>Por unidade: {Object.entries(result.perUnit).map(([u, n]) => `${u}: ${n}`).join(' • ') || '—'}</p>
          <p>Por status: {Object.entries(result.perStatus).map(([st, n]) => `${st}: ${n}`).join(' • ') || '—'}</p>
          {result.withoutUnit > 0 && (
            <p className="font-bold text-amber-600">
              {result.withoutUnit} OS ficaram sem unidade (setor não corresponde a uma gerência):{' '}
              {Object.entries(result.unresolvedSectors).map(([s, n]) => `"${s}": ${n}`).join(' • ')}. Me envie esta lista.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
