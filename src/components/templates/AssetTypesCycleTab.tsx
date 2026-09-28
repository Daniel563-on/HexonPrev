import React, { useEffect, useMemo, useState } from 'react';
import { Asset, AssetPeriodicity, AssetTypeConfig, CycleSetting } from '../../types';
import {
  addMonths,
  ASSET_PERIODICITIES,
  assetTypeKey,
  cycleMonthIndex,
  dbClearCycleStart,
  dbGetAssetTypes,
  dbGetCycleSettings,
  dbSaveAssetTypePeriodicities,
  dbSetCycleStart,
  dbSyncAssetTypes,
  duePeriodicity,
  isSectorVisible,
  localMonthKey
} from '../../db/firebase';

// TIPOS DE ATIVO E CICLO (por gerência)
// 1) Início do ciclo oficial ("mês 1"): só o Super Administrador define. Antes disso, tudo é teste.
// 2) Tipos de ativo: cada tipo tem as suas periodicidades; em cada mês vale só a de maior peso.

interface Props {
  units: string[];            // gerências que o usuário enxerga
  assets: Asset[];
  userName: string;
  canManage: boolean;         // permissão "Configurar Modelos de Cronograma"
  isSuperAdmin: boolean;
}

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const monthLabel = (m: string) => {
  const [y, mm] = m.split('-').map(Number);
  return `${MONTHS[mm - 1]}/${String(y).slice(2)}`;
};
const COLORS: Record<AssetPeriodicity, string> = {
  Mensal: 'bg-sky-100 text-sky-800 border-sky-200',
  Trimestral: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  Semestral: 'bg-amber-100 text-amber-800 border-amber-200',
  Anual: 'bg-rose-100 text-rose-800 border-rose-200'
};

export default function AssetTypesCycleTab({ units, assets, userName, canManage, isSuperAdmin }: Props) {
  const [unit, setUnit] = useState(units[0] || '');
  const [types, setTypes] = useState<AssetTypeConfig[]>([]);
  const [cycles, setCycles] = useState<CycleSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [cycleInput, setCycleInput] = useState('');
  const [confirmCycle, setConfirmCycle] = useState<'set' | 'clear' | null>(null);

  useEffect(() => {
    if (!unit && units.length > 0) setUnit(units[0]);
  }, [units]);

  const load = async () => {
    setLoading(true);
    const [t, c] = await Promise.all([dbGetAssetTypes(units), dbGetCycleSettings()]);
    setTypes(t);
    setCycles(c);
    setLoading(false);
  };
  useEffect(() => {
    if (units.length > 0) load();
  }, [units.join('|')]);

  const cycle = cycles.find((c) => c.unit === unit);
  const currentMonth = localMonthKey();
  const currentIndex = cycle ? cycleMonthIndex(cycle.cycleStart, currentMonth) : 0;

  // Ativos (não baixados) da gerência escolhida, agrupados pelo TIPO
  const assetsByType = useMemo(() => {
    const map = new Map<string, { name: string; count: number }>();
    assets
      .filter((a) => a.status !== 'Baixado' && a.kind !== 'address' && isSectorVisible(a.sector || '', [unit]))
      .forEach((a) => {
        const name = String(a.specs?.TIPO || a.specs?.tipo || '').trim();
        if (!name) return;
        const k = assetTypeKey(name);
        const item = map.get(k) || { name, count: 0 };
        item.count++;
        map.set(k, item);
      });
    return map;
  }, [assets, unit]);
  const assetsWithoutType = useMemo(
    () =>
      assets.filter(
        (a) => a.status !== 'Baixado' && a.kind !== 'address' && isSectorVisible(a.sector || '', [unit]) && !String(a.specs?.TIPO || a.specs?.tipo || '').trim()
      ).length,
    [assets, unit]
  );

  const unitTypes = types.filter((t) => t.unit === unit && !t.archived);
  // Gerência sem equipamentos (ex.: DOM, cujo "ativo" é o endereço): trabalha só com vistorias por endereço
  const onlySurveys = assetsByType.size === 0 && assetsWithoutType === 0 && unitTypes.length === 0;
  const withoutPeriodicity = unitTypes.filter((t) => t.periodicities.length === 0).length;

  // Próximos 12 meses a partir do mês atual (ou do início do ciclo, se ainda não chegou)
  const stripStart = cycle && cycle.cycleStart > currentMonth ? cycle.cycleStart : currentMonth;
  const strip = Array.from({ length: 12 }, (_, i) => addMonths(stripStart, i));

  const sync = async () => {
    setSyncing(true);
    setMessage(null);
    setError(null);
    try {
      const names = Array.from(assetsByType.values()).map((v: { name: string }) => v.name);
      const res = await dbSyncAssetTypes(unit, names, types);
      const parts = [
        res.created.length > 0 ? `Novos (sem periodicidade): ${res.created.join(', ')}` : '',
        res.archived.length > 0 ? `Removidos da lista (nenhum ativo tem mais): ${res.archived.join(', ')}` : '',
        res.restored.length > 0 ? `Voltaram: ${res.restored.join(', ')}` : ''
      ].filter(Boolean);
      setMessage(parts.length > 0 ? `${parts.join('. ')}.` : 'A lista já está igual aos tipos dos ativos desta gerência.');
      await load();
    } catch (err: any) {
      setError(`Não foi possível atualizar: ${err?.message || err}`);
    } finally {
      setSyncing(false);
    }
  };

  const togglePeriodicity = async (t: AssetTypeConfig, p: AssetPeriodicity) => {
    if (!canManage) return;
    const next = t.periodicities.includes(p) ? t.periodicities.filter((x) => x !== p) : [...t.periodicities, p];
    setSavingId(t.id);
    setError(null);
    try {
      await dbSaveAssetTypePeriodicities(t, next);
      setTypes((prev) => prev.map((x) => (x.id === t.id ? { ...x, periodicities: ASSET_PERIODICITIES.map((a) => a.name).filter((n) => next.includes(n)) } : x)));
    } catch (err: any) {
      setError(`Não foi possível salvar: ${err?.message || err}`);
    } finally {
      setSavingId(null);
    }
  };

  const applyCycle = async () => {
    setError(null);
    try {
      if (confirmCycle === 'set') await dbSetCycleStart(unit, cycleInput, userName);
      else await dbClearCycleStart(unit);
      setConfirmCycle(null);
      setCycleInput('');
      await load();
    } catch (err: any) {
      setError(`Não foi possível salvar o início do ciclo: ${err?.message || err}`);
      setConfirmCycle(null);
    }
  };

  const card = 'bg-white border border-slate-200 rounded-xl p-5 shadow-xs';

  if (units.length === 0) {
    return <div className={card}><p className="text-xs text-slate-500">Nenhuma gerência disponível para o seu perfil.</p></div>;
  }

  return (
    <div className="space-y-4">
      {/* Gerência */}
      <div className={`${card} flex flex-col sm:flex-row sm:items-center justify-between gap-3`}>
        <div>
          <h2 className="text-sm font-black text-slate-800">Tipos de ativo e ciclo</h2>
          <p className="text-xs text-slate-500">Cada gerência tem o seu ciclo. O ativo herda as periodicidades do seu tipo; em cada mês vale só a de maior peso.</p>
        </div>
        {units.length > 1 ? (
          <select value={unit} onChange={(e) => { setUnit(e.target.value); setMessage(null); }} className="h-9 px-3 text-xs font-bold border border-slate-200 rounded-lg bg-white">
            {units.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        ) : (
          <span className="px-3 py-1.5 rounded-lg bg-slate-100 text-xs font-black text-slate-700">{unit}</span>
        )}
      </div>

      {error && <p className="text-xs font-bold text-rose-600">{error}</p>}

      {/* Ciclo */}
      <div className={`${card} space-y-4`}>
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Início do ciclo oficial — {unit}</p>
            {cycle ? (
              <>
                <p className="text-lg font-black text-slate-800">{monthLabel(cycle.cycleStart)} <span className="text-xs font-bold text-slate-500">(mês 1)</span></p>
                <p className="text-xs text-slate-500">
                  {currentIndex > 0 ? `Mês atual: ${currentIndex} do ciclo.` : 'O ciclo ainda não começou.'} Definido por {cycle.setBy}.
                </p>
              </>
            ) : (
              <>
                <p className="text-lg font-black text-amber-600">Não definido — em teste</p>
                <p className="text-xs text-slate-500">Enquanto não houver início, os disparos são apenas testes.</p>
              </>
            )}
          </div>
          {isSuperAdmin && (
            <div className="flex flex-wrap items-center gap-2">
              <input type="month" value={cycleInput} onChange={(e) => setCycleInput(e.target.value)} className="h-9 px-3 text-xs font-bold border border-slate-200 rounded-lg" />
              <button
                type="button"
                disabled={!cycleInput}
                onClick={() => setConfirmCycle('set')}
                className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer disabled:opacity-40"
              >
                {cycle ? 'Alterar início' : 'Definir início'}
              </button>
              {cycle && (
                <button type="button" onClick={() => setConfirmCycle('clear')} className="h-9 px-3 rounded-lg border border-slate-200 text-slate-600 text-xs font-bold cursor-pointer">
                  Remover
                </button>
              )}
            </div>
          )}
        </div>

        {cycle && (
          <div className="overflow-x-auto">
            <div className="grid grid-cols-12 gap-1.5 min-w-[640px]">
              {strip.map((m) => {
                const idx = cycleMonthIndex(cycle.cycleStart, m);
                const due = duePeriodicity(['Mensal', 'Trimestral', 'Semestral', 'Anual'], idx);
                return (
                  <div key={m} className={`rounded-lg border p-2 text-center ${m === currentMonth ? 'ring-2 ring-blue-500' : ''} ${due ? COLORS[due] : 'bg-slate-50 text-slate-400 border-slate-200'}`}>
                    <p className="text-[10px] font-black">{monthLabel(m)}</p>
                    <p className="text-[10px] font-bold">{idx > 0 ? `mês ${idx}` : '—'}</p>
                    <p className="text-[9px] font-black uppercase">{due || ''}</p>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-slate-500 mt-2">
              Maior periodicidade possível em cada mês (para um tipo que tenha todas). Cada tipo usa só as que tiver marcadas.
            </p>
          </div>
        )}
      </div>

      {onlySurveys && !loading && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-900">
          <p className="font-black">{unit} não tem equipamentos cadastrados.</p>
          <p className="mt-1">
            As preventivas desta gerência são as <strong>vistorias por endereço</strong> (Semanal e Diária), configuradas na aba
            <strong> 2. Modelos</strong>. Os tipos de ativo abaixo só se aplicam a gerências com equipamentos. O início do ciclo acima vale
            também para marcar quando os disparos da {unit} deixam de ser teste.
          </p>
        </div>
      )}

      {/* Tipos */}
      {!onlySurveys && (
      <div className={`${card} space-y-3`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black text-slate-800">Tipos de ativo — {unit}</p>
            <p className="text-xs text-slate-500">
              {unitTypes.length} tipo(s){withoutPeriodicity > 0 ? ` • ${withoutPeriodicity} sem periodicidade (não geram OS)` : ''}
              {assetsWithoutType > 0 ? ` • ${assetsWithoutType} ativo(s) sem TIPO no cadastro (não geram OS)` : ''}
            </p>
          </div>
          {canManage && (
            <button type="button" onClick={sync} disabled={syncing} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer shrink-0 disabled:opacity-50">
              {syncing ? 'Atualizando...' : 'Atualizar tipos'}
            </button>
          )}
        </div>
        {message && <p className="text-xs font-bold text-blue-600">{message}</p>}

        {loading ? (
          <p className="text-xs text-slate-400">Carregando...</p>
        ) : unitTypes.length === 0 ? (
          <p className="text-xs text-slate-500">Nenhum tipo cadastrado. Clique em "Atualizar tipos" para gerar a lista a partir dos ativos da gerência.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="p-2.5">Tipo de ativo</th>
                  <th className="p-2.5 text-center">Ativos</th>
                  {ASSET_PERIODICITIES.map((p) => <th key={p.name} className="p-2.5 text-center">{p.name}</th>)}
                  <th className="p-2.5">Sequência (12 meses do ciclo)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {unitTypes.map((t) => (
                  <tr key={t.id} className={t.periodicities.length === 0 ? 'bg-amber-50/50' : ''}>
                    <td className="p-2.5 font-bold text-slate-800">{t.name}</td>
                    <td className="p-2.5 text-center font-mono">{assetsByType.get(assetTypeKey(t.name))?.count || 0}</td>
                    {ASSET_PERIODICITIES.map((p) => (
                      <td key={p.name} className="p-2.5 text-center">
                        <input
                          type="checkbox"
                          checked={t.periodicities.includes(p.name)}
                          disabled={!canManage || savingId === t.id}
                          onChange={() => togglePeriodicity(t, p.name)}
                          className="w-4 h-4 cursor-pointer"
                        />
                      </td>
                    ))}
                    <td className="p-2.5">
                      {t.periodicities.length === 0 ? (
                        <span className="text-[10px] font-bold text-amber-700">Marque ao menos uma periodicidade</span>
                      ) : (
                        <div className="flex gap-0.5">
                          {Array.from({ length: 12 }, (_, i) => {
                            const due = duePeriodicity(t.periodicities, i + 1);
                            const short = ASSET_PERIODICITIES.find((p) => p.name === due)?.short || '·';
                            return (
                              <span key={i} title={`Mês ${i + 1}: ${due || 'nada'}`} className={`w-5 h-5 rounded text-[9px] font-black flex items-center justify-center border ${due ? COLORS[due] : 'bg-slate-50 text-slate-300 border-slate-200'}`}>
                                {short}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-slate-500 mt-2">M = Mensal • T = Trimestral • S = Semestral • A = Anual. Ex.: com Mensal e Semestral, o mês 6 e o mês 12 fazem só a Semestral.</p>
          </div>
        )}
      </div>
      )}

      {confirmCycle && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-2xl p-6 space-y-3">
            <h3 className="text-base font-black text-slate-800">{confirmCycle === 'set' ? 'Início do ciclo oficial' : 'Remover início do ciclo'}</h3>
            <p className="text-xs text-slate-600">
              {confirmCycle === 'set'
                ? `A gerência ${unit} passa a ter ${monthLabel(cycleInput)} como mês 1 do ciclo. A partir daí, cada mês do disparo segue essa contagem.${cycle ? ' Atenção: alterar o início muda a periodicidade dos meses seguintes.' : ''}`
                : `A gerência ${unit} volta a ficar sem ciclo oficial (em teste).`}
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmCycle(null)} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-xs font-bold cursor-pointer">Cancelar</button>
              <button type="button" onClick={applyCycle} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer">Confirmar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
