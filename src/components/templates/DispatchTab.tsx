import React, { useEffect, useState } from 'react';
import { Address, Asset, AssetTypeConfig, Company, CycleSetting, MaintenanceTemplate } from '../../types';
import {
  addMonths,
  dbGetCompanies,
  dbApplyDispatch,
  dbGetAssetTypes,
  dbGetTemplates,
  dbGetCycleSettings,
  dbSplitExistingOrders,
  DispatchPlan,
  localMonthKey,
  localTodayStr,
  MAX_DISPATCH_MONTHS,
  monthRange,
  planDispatch
} from '../../db/firebase';

// DISPARO: gerência + mês(es) → conferência (nada gravado) → gerar as OS.
// Só mês atual ou futuros, no máximo 12 meses. Antes do início do ciclo, é teste (o 1º mês escolhido é o mês 1).

interface Props {
  units: string[];
  assets: Asset[];
  templates: MaintenanceTemplate[];
  addresses: Address[];
  canDispatch: boolean;
  onDispatched: () => void;
}

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const monthLabel = (m: string) => {
  const [y, mm] = m.split('-').map(Number);
  return `${MONTHS[mm - 1]}/${String(y).slice(2)}`;
};
const PERIOD_COLUMNS: Record<'preventive' | 'survey', string[]> = {
  preventive: ['Mensal', 'Trimestral', 'Semestral', 'Anual'],
  survey: ['Diária', 'Semanal', 'Quinzenal']
};

export default function DispatchTab({ units, assets, templates, addresses, canDispatch, onDispatched }: Props) {
  const current = localMonthKey();
  const [unit, setUnit] = useState(units[0] || '');
  const [startMonth, setStartMonth] = useState(current);
  const [endMonth, setEndMonth] = useState(current);
  const [assetTypes, setAssetTypes] = useState<AssetTypeConfig[]>([]);
  const [cycles, setCycles] = useState<CycleSetting[]>([]);
  const [plan, setPlan] = useState<DispatchPlan | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const [openList, setOpenList] = useState<string | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  useEffect(() => {
    dbGetCompanies().then(setCompanies).catch(() => {});
  }, []);
  const companyName = (id: string) => companies.find((c) => c.id === id)?.name || id || 'Sem empresa';

  useEffect(() => {
    if (!unit && units.length > 0) setUnit(units[0]);
  }, [units]);
  useEffect(() => {
    if (units.length === 0) return;
    Promise.all([dbGetAssetTypes(units), dbGetCycleSettings()]).then(([t, c]) => {
      setAssetTypes(t);
      setCycles(c);
    });
  }, [units.join('|')]);

  const cycle = cycles.find((c) => c.unit === unit) || null;
  const isSurveyUnit = unit.trim().toUpperCase() === 'DOM';
  const columns = PERIOD_COLUMNS[isSurveyUnit ? 'survey' : 'preventive'];
  const minMonth = cycle && cycle.cycleStart > current ? cycle.cycleStart : current;
  const maxMonth = addMonths(startMonth, MAX_DISPATCH_MONTHS - 1);

  const reset = () => {
    setPlan(null);
    setError(null);
    setDoneMsg(null);
    setOpenList(null);
  };

  const check = async () => {
    reset();
    if (!unit) return setError('Escolha a gerência.');
    if (startMonth < current) return setError('Só é possível disparar o mês atual ou meses futuros.');
    if (cycle && startMonth < cycle.cycleStart) return setError(`O ciclo oficial da ${unit} começa em ${monthLabel(cycle.cycleStart)}.`);
    if (endMonth < startMonth) return setError('O mês final não pode ser antes do inicial.');
    if (monthRange(startMonth, endMonth).length > MAX_DISPATCH_MONTHS) return setError(`No máximo ${MAX_DISPATCH_MONTHS} meses por disparo.`);
    setChecking(true);
    try {
      // Modelos lidos do banco agora (nunca a cópia guardada: outro computador pode ter editado ou criado um modelo)
      const freshTemplates = await dbGetTemplates(true);
      const draft = planDispatch({ unit, startMonth, endMonth, assets, assetTypes, templates: freshTemplates, addresses, cycle, todayStr: localTodayStr() });
      setPlan(await dbSplitExistingOrders(draft));
    } catch (err: any) {
      setError(`Não foi possível conferir: ${err?.message || err}`);
    } finally {
      setChecking(false);
    }
  };

  const apply = async () => {
    if (!plan || plan.toCreate.length === 0) return;
    setSaving(true);
    setError(null);
    setProgress({ done: 0, total: plan.toCreate.length });
    try {
      const n = await dbApplyDispatch(plan, (done, total) => setProgress({ done, total }));
      setDoneMsg(`${n.toLocaleString('pt-BR')} OS criadas${plan.isTest ? ' (teste)' : ''} para ${unit}, ${monthLabel(plan.months[0])}${plan.months.length > 1 ? ` a ${monthLabel(plan.months[plan.months.length - 1])}` : ''}.`);
      setPlan(null);
      onDispatched();
    } catch (err: any) {
      setError(
        `A gravação parou: ${err?.message || err}. As OS já gravadas ficam; confira de novo para ver o que falta (as existentes serão barradas).`
      );
    } finally {
      setSaving(false);
      setProgress(null);
    }
  };

  const card = 'bg-white border border-slate-200 rounded-xl p-5 shadow-xs';
  const field = 'h-9 px-3 text-xs font-bold border border-slate-200 rounded-lg bg-white';

  if (!canDispatch) {
    return <div className={card}><p className="text-xs text-slate-500">Seu perfil não tem a permissão "Disparar OS".</p></div>;
  }

  return (
    <div className="space-y-4">
      {/* Escolha */}
      <div className={`${card} space-y-4`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-black text-slate-800">Disparo das OS</h2>
            <p className="text-xs text-slate-500">
              {isSurveyUnit
                ? 'Vistorias por endereço: Diária (dias úteis), Semanal (segunda a sexta) e Quinzenal.'
                : 'Uma OS por ativo por mês, da maior periodicidade que vence no mês do ciclo. Período: o mês inteiro.'}
            </p>
          </div>
          {cycle ? (
            <span className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-[11px] font-black text-emerald-800">
              Ciclo oficial desde {monthLabel(cycle.cycleStart)}
            </span>
          ) : (
            <span className="px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] font-black text-amber-800">
              Em teste — o 1º mês escolhido conta como mês 1
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <label className="block">
            <span className="block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500">Gerência</span>
            <select value={unit} onChange={(e) => { setUnit(e.target.value); reset(); }} className={`${field} w-full`}>
              {units.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500">De</span>
            <input type="month" min={minMonth} value={startMonth} onChange={(e) => { setStartMonth(e.target.value); if (endMonth < e.target.value) setEndMonth(e.target.value); reset(); }} className={`${field} w-full`} />
          </label>
          <label className="block">
            <span className="block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500">Até</span>
            <input type="month" min={startMonth} max={maxMonth} value={endMonth} onChange={(e) => { setEndMonth(e.target.value); reset(); }} className={`${field} w-full`} />
          </label>
          <button type="button" onClick={check} disabled={checking || saving} className="h-9 px-4 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold cursor-pointer disabled:opacity-50">
            {checking ? 'Conferindo...' : 'Conferir'}
          </button>
        </div>
      </div>

      {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
      {doneMsg && <p className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800">{doneMsg}</p>}

      {/* Conferência */}
      {plan && (
        <div className={`${card} space-y-4`}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-black uppercase tracking-wider text-slate-700">
              Conferência — {plan.unit}, {monthLabel(plan.months[0])}{plan.months.length > 1 ? ` a ${monthLabel(plan.months[plan.months.length - 1])}` : ''}
            </p>
            {plan.isTest && <span className="text-[10px] font-black text-amber-700 uppercase">Teste</span>}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="p-2">Mês</th>
                  <th className="p-2 text-center">Mês do ciclo</th>
                  {columns.map((c) => <th key={c} className="p-2 text-center">{c}</th>)}
                  <th className="p-2 text-center">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {plan.summary.map((s) => (
                  <tr key={s.month}>
                    <td className="p-2 font-bold">{monthLabel(s.month)}</td>
                    <td className="p-2 text-center font-mono">{s.cycleMonth > 0 ? s.cycleMonth : '—'}</td>
                    {columns.map((c) => <td key={c} className="p-2 text-center font-mono">{s.counts[c] ? s.counts[c].toLocaleString('pt-BR') : '—'}</td>)}
                    <td className="p-2 text-center font-black">{s.total.toLocaleString('pt-BR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 text-xs">
            <p className="font-black text-emerald-700">Serão criadas: {plan.toCreate.length.toLocaleString('pt-BR')} OS</p>
            {Object.keys(plan.byCompany || {}).length > 0 && (
              <div className="flex flex-wrap gap-1.5" aria-label="OS por empresa">
                {Object.entries(plan.byCompany)
                  .sort(([a], [b]) => companyName(a).localeCompare(companyName(b)))
                  .map(([id, n]) => (
                    <span key={id || '_'} className="px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-100 text-[11px] font-bold text-blue-800">
                      {companyName(id)}: {Number(n).toLocaleString('pt-BR')}
                    </span>
                  ))}
              </div>
            )}
            {plan.blocked.length > 0 && (
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <button type="button" onClick={() => setOpenList(openList === 'blocked' ? null : 'blocked')} className="font-bold text-slate-700 cursor-pointer">
                  {openList === 'blocked' ? '▾' : '▸'} Barradas por já existirem: {plan.blocked.length.toLocaleString('pt-BR')}
                </button>
                {openList === 'blocked' && (
                  <ul className="mt-2 max-h-48 overflow-y-auto space-y-0.5 text-[11px] text-slate-600">
                    {plan.blocked.slice(0, 500).map((o) => <li key={o.id}>{o.id} — {o.title}</li>)}
                  </ul>
                )}
              </div>
            )}
            {plan.skipped.map((s) => (
              <div key={s.reason} className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                <button type="button" onClick={() => setOpenList(openList === s.reason ? null : s.reason)} className="font-bold text-amber-900 cursor-pointer text-left">
                  {openList === s.reason ? '▾' : '▸'} Não geram OS — {s.reason}: {s.items.length.toLocaleString('pt-BR')}
                </button>
                {openList === s.reason && (
                  <ul className="mt-2 max-h-48 overflow-y-auto space-y-0.5 text-[11px] text-amber-900">
                    {s.items.slice(0, 500).map((i) => <li key={i}>{i}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>

          {progress && (
            <div className="space-y-1">
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-600 transition-all" style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
              </div>
              <p className="text-[11px] text-slate-500">Gravando {progress.done.toLocaleString('pt-BR')} de {progress.total.toLocaleString('pt-BR')}...</p>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button type="button" onClick={reset} disabled={saving} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-xs font-bold cursor-pointer">Cancelar</button>
            <button
              type="button"
              onClick={apply}
              disabled={saving || plan.toCreate.length === 0}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer disabled:opacity-40"
            >
              {saving ? 'Gerando...' : `Gerar ${plan.toCreate.length.toLocaleString('pt-BR')} OS${plan.isTest ? ' (teste)' : ''}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
