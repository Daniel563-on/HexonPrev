import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Asset, AssetTypeConfig, Company, Management } from '../../types';
import {
  assetTypeKey,
  companiesOfUnit,
  dbCancelOpenOrdersForAssets,
  dbGetAssetTypes,
  dbMoveNewOrdersToCompany,
  dbSaveAssetsBulk,
  dbSyncAssetTypes
} from '../../db/firebase';
import { assetType, autoMap, buildImportPlan, cell, ColumnMap, IMPORT_FIELDS, ImportField, ImportPlan, materialGroups, norm } from './assetImport';

// IMPORTAR PLANILHA DE ATIVOS (A4-A): 1 Arquivo (gerência + empresa) → 2 Colunas → 3 Tipos (por material) → 4 Conferência → gravar.
// A planilha é a lista completa daquela empresa na gerência: quem não vier nela é baixado (o usuário confere antes).
// A periodicidade fica no tipo (PMOC › Tipos de ativo e ciclo); aqui só se escolhe o tipo de cada material.

interface Props {
  isOpen: boolean;
  onClose: () => void;
  assets: Asset[];
  managements: Management[];
  companies: Company[];
  userName: string;
  canManageTypes: boolean; // "Criar e editar modelos de preventiva": cria no PMOC os tipos novos (sem periodicidade)
  onReloadAssets: () => Promise<void>;
  setCustomDynamicFields: (fields: string[]) => void;
}

const STEPS = ['Arquivo', 'Colunas', 'Tipos', 'Conferência'];
const FIELDS_SHOWN = ['CRAAI', 'COMARCA', 'LOCALIZAÇÃO', 'MATERIAL', 'CAPACIDADE', 'TIPO', 'MARCA', 'MODELO', 'Nº DE SÉRIE', 'DATA DE AQUISIÇÃO', 'VALOR LÍQUIDO'];
const n = (v: number) => v.toLocaleString('pt-BR');

export default function AssetImportWizard(props: Props) {
  const { isOpen, onClose, assets, managements, companies, userName, canManageTypes, onReloadAssets, setCustomDynamicFields } = props;
  const units = useMemo(() => managements.map((m) => m.name).filter((x) => x && x !== 'Todas'), [managements]);
  const [step, setStep] = useState(0);
  const [unit, setUnit] = useState('');
  const [company, setCompany] = useState('');
  const [fileName, setFileName] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [map, setMap] = useState<ColumnMap>({});
  const [companyOk, setCompanyOk] = useState(false);
  const [types, setTypes] = useState<AssetTypeConfig[]>([]);
  const [typeByMaterial, setTypeByMaterial] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<null | { saved: number; retired: number; cancelled: number; movedOrders: number; newTypes: string[]; typesNote: string }>(null);
  const [showList, setShowList] = useState<'retire' | 'moved' | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setStep(0);
    setUnit(units[0] || '');
    setCompany('');
    setFileName('');
    setRows([]);
    setHeaders([]);
    setMap({});
    setCompanyOk(false);
    setTypeByMaterial({});
    setPlan(null);
    setError('');
    setDone(null);
    setShowList(null);
  }, [isOpen]);

  const unitCompanies = useMemo(() => companiesOfUnit(companies, unit).filter((c) => c.active), [companies, unit]);
  const companyName = (id?: string) => (id ? companies.find((c) => c.id === id)?.name || id : 'sem empresa');
  const chosenName = companyName(company);

  // Tipos da gerência (para escolher e para mostrar as periodicidades do PMOC)
  useEffect(() => {
    if (!isOpen || !unit) return;
    let alive = true;
    dbGetAssetTypes([unit]).then((t) => alive && setTypes(t));
    return () => {
      alive = false;
    };
  }, [isOpen, unit]);

  const groups = useMemo(() => (step >= 2 ? materialGroups(rows, map, assets, unit) : []), [step, rows, map, assets, unit]);
  useEffect(() => {
    if (step !== 2) return;
    setTypeByMaterial((prev) => {
      const next: Record<string, string> = {};
      groups.forEach((g) => (next[g.key] = prev[g.key] ?? g.suggested));
      return next;
    });
  }, [step, groups]);

  const typeNames = useMemo(() => {
    const s = new Set<string>();
    types.filter((t) => !t.archived).forEach((t) => s.add(t.name));
    assets.filter((a) => norm(a.sector) === norm(unit)).forEach((a) => assetType(a) && s.add(assetType(a)));
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [types, assets, unit]);
  const typeInfo = (name: string) => {
    if (!name.trim()) return { kind: 'none' as const, label: 'Sem tipo: não gera preventiva' };
    const t = types.find((x) => assetTypeKey(x.name) === assetTypeKey(name));
    if (!t) return { kind: 'new' as const, label: 'Tipo novo: depois de importar, marque as periodicidades no PMOC' };
    if (!t.periodicities.length) return { kind: 'noPeriod' as const, label: 'Sem periodicidade no PMOC: ainda não gera preventiva' };
    return { kind: 'ok' as const, label: `${t.periodicities.join(' · ')} — gera preventiva` };
  };

  // Empresa da planilha (coluna EMPRESA) × empresa escolhida
  const sheetCompanies = useMemo(() => {
    if (!map.company) return [];
    const m = new Map<string, number>();
    rows.forEach((r) => {
      const v = cell(r, map, 'company');
      if (v) m.set(v, (m.get(v) || 0) + 1);
    });
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows, map]);
  const companyMatches = !map.company || (sheetCompanies.length > 0 && sheetCompanies.every(([v]) => norm(chosenName).includes(norm(v)) || norm(v).includes(norm(chosenName))));

  if (!isOpen) return null;

  const readFile = (file: File) => {
    setError('');
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(new Uint8Array(ev.target?.result as ArrayBuffer), { type: 'array' });
        const sheet = wb.SheetNames[0];
        const data = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '' }) as Record<string, unknown>[];
        if (!data.length) {
          setError('A planilha está sem linhas.');
          return;
        }
        const hs = Object.keys(data[0]);
        setFileName(file.name);
        setSheetName(sheet);
        setRows(data);
        setHeaders(hs);
        setMap(autoMap(hs));
        setCompanyOk(false);
        setPlan(null);
      } catch (e) {
        console.error('Planilha de ativos não lida:', e);
        setError('Não foi possível ler o arquivo. Confira se é uma planilha .xlsx, .xls ou .csv.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const missingRequired = IMPORT_FIELDS.filter((f) => f.required && !map[f.key]);
  const canNext = [
    !!unit && !!company && rows.length > 0,
    missingRequired.length === 0 && (companyMatches || companyOk),
    true,
    !!plan && (plan.toSave.length > 0 || plan.toRetire.length > 0)
  ][step];

  const goConference = () => {
    setPlan(buildImportPlan({ rows, map, unit, company, typeByMaterial, existing: assets, now: new Date().toISOString() }));
    setShowList(null);
    setStep(3);
  };

  const apply = async () => {
    if (!plan) return;
    setBusy(true);
    setError('');
    try {
      const now = new Date().toISOString();
      if (plan.toSave.length) await dbSaveAssetsBulk(plan.toSave);
      let cancelled = 0;
      if (plan.toRetire.length) {
        await dbSaveAssetsBulk(plan.toRetire.map((a) => ({ ...a, status: 'Baixado' as const, retiredAt: now, updatedAt: now })));
        cancelled = await dbCancelOpenOrdersForAssets(plan.toRetire.map((a) => a.id), `Ativo baixado: não constava na planilha de importação da gerência (${chosenName})`, unit);
      }
      // Ativos que vieram de outra empresa: as OS deles ainda "Novo" passam para a empresa nova
      let movedOrders = 0;
      const bySector = new Map<string, string[]>();
      plan.moved.forEach(({ asset }) => bySector.set(asset.sector || unit, [...(bySector.get(asset.sector || unit) || []), asset.id]));
      for (const [sector, ids] of bySector) {
        try {
          movedOrders += await dbMoveNewOrdersToCompany(sector, 'assetId', ids.map((id) => ({ id, company })), (id) => companyName(id), userName);
        } catch (e) {
          console.warn('OS "Novo" não passaram para a empresa nova:', e);
        }
      }
      // Tipos novos vão para o PMOC (sem periodicidade) — só quem pode mexer nos tipos
      const usedTypes = Array.from(new Set<string>(Object.values(typeByMaterial).map((t) => String(t).trim()).filter(Boolean)));
      const newTypes = usedTypes.filter((t) => !types.some((x) => assetTypeKey(x.name) === assetTypeKey(t)));
      let typesNote = '';
      if (newTypes.length && canManageTypes) {
        try {
          const unitTypeNames = [
            ...assets.filter((a) => norm(a.sector) === norm(unit) && a.status !== 'Baixado' && !plan.toRetire.some((r) => r.id === a.id)).map(assetType),
            ...plan.toSave.map(assetType)
          ].filter(Boolean);
          await dbSyncAssetTypes(unit, unitTypeNames, types);
          typesNote = 'Criados no PMOC sem periodicidade: marque em PMOC › Modelos e Protocolos › Tipos de ativo e ciclo.';
        } catch (e) {
          console.warn('Tipos novos não criados no PMOC:', e);
          typesNote = 'Não foi possível criar os tipos novos no PMOC: use "Atualizar tipos" lá e marque as periodicidades.';
        }
      } else if (newTypes.length) {
        typesNote = 'Peça a quem cuida do PMOC para clicar em "Atualizar tipos" e marcar as periodicidades.';
      }
      try {
        localStorage.setItem('HEXON_CUSTOM_FIELDS', JSON.stringify(FIELDS_SHOWN));
      } catch {
        /* ignora */
      }
      setCustomDynamicFields(FIELDS_SHOWN);
      setDone({ saved: plan.toSave.length, retired: plan.toRetire.length, cancelled, movedOrders, newTypes, typesNote });
      await onReloadAssets();
    } catch (e: any) {
      console.error('Importação de ativos:', e);
      setError(`Não foi possível gravar: ${e?.message || e}. Nada foi perdido; pode tentar de novo.`);
    } finally {
      setBusy(false);
    }
  };

  const sample = rows[0] || {};
  const lbl = 'text-[10px] font-black uppercase tracking-wider text-slate-500';
  const sel = 'w-full h-9 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-800 dark:text-slate-100';
  const btn = 'px-4 py-2 rounded-lg text-xs font-black cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5';
  const chip = (kind: string) =>
    kind === 'ok' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : kind === 'none' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-amber-50 text-amber-800 border-amber-200';

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-3 font-sans">
      <div className="w-full max-w-5xl max-h-[94vh] flex flex-col rounded-2xl bg-white dark:bg-[#0e1a3a] border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden">
        {/* TOPO */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-base font-black text-slate-900 dark:text-white">Importar planilha de ativos</h2>
              <p className="text-[11px] text-slate-500">A planilha é a lista completa da empresa na gerência. Nada é gravado antes da conferência.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="h-8 w-8 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center cursor-pointer" aria-label="Fechar">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        {/* ETAPAS */}
        {!done && (
          <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-2">
            {STEPS.map((s, i) => (
              <React.Fragment key={s}>
                {i > 0 && <span className="w-6 h-px bg-slate-200 dark:bg-slate-700" />}
                <span className={`flex items-center gap-1.5 text-[11px] font-black ${i === step ? 'text-indigo-700 dark:text-indigo-300' : i < step ? 'text-emerald-700' : 'text-slate-400'}`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${i === step ? 'bg-indigo-600 text-white' : i < step ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                    {i < step ? <Check className="w-3 h-3" /> : i + 1}
                  </span>
                  {s}
                </span>
              </React.Fragment>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* 1 ARQUIVO */}
          {!done && step === 0 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className={lbl}>Gerência *</span>
                  <select value={unit} onChange={(e) => { setUnit(e.target.value); setCompany(''); }} className={sel}>
                    {units.map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className={lbl}>Empresa da planilha *</span>
                  <select value={company} onChange={(e) => { setCompany(e.target.value); setCompanyOk(false); }} className={sel}>
                    <option value="">Escolha a empresa...</option>
                    {unitCompanies.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 p-6 text-center cursor-pointer hover:border-indigo-400">
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
                <Upload className="w-6 h-6 mx-auto text-indigo-500" />
                {fileName ? (
                  <p className="mt-2 text-xs font-black text-slate-800 dark:text-slate-100">
                    {fileName} <span className="font-bold text-slate-500">· aba "{sheetName}" · {n(rows.length)} linhas · {headers.length} colunas</span>
                    <span className="block text-[11px] font-bold text-indigo-600 mt-1">Clique para trocar o arquivo</span>
                  </p>
                ) : (
                  <p className="mt-2 text-xs font-bold text-slate-600 dark:text-slate-300">Clique para escolher a planilha (.xlsx, .xls ou .csv)</p>
                )}
              </label>
              <p className="text-[11px] text-slate-500 flex gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" />
                <span>Ativos da empresa escolhida nesta gerência que <b>não</b> estiverem na planilha serão <b>baixados</b>. Você vê a lista antes de gravar.</span>
              </p>
            </div>
          )}

          {/* 2 COLUNAS */}
          {!done && step === 1 && (
            <div className="space-y-3">
              <p className="text-xs text-slate-600 dark:text-slate-300">As colunas foram reconhecidas pelo nome. Confira; o exemplo é a 1ª linha da planilha.</p>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-900/60">
                    <tr className="text-left">
                      <th className={`${lbl} px-3 py-2`}>No sistema</th>
                      <th className={`${lbl} px-3 py-2 w-64`}>Coluna da planilha</th>
                      <th className={`${lbl} px-3 py-2`}>Exemplo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {IMPORT_FIELDS.map((f) => (
                      <tr key={f.key} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="px-3 py-1.5">
                          <span className="font-black text-slate-800 dark:text-slate-100">{f.label}{f.required && <span className="text-rose-600"> *</span>}</span>
                          {f.hint && <span className="block text-[10px] text-slate-500">{f.hint}</span>}
                        </td>
                        <td className="px-3 py-1.5">
                          <select
                            value={map[f.key] || ''}
                            onChange={(e) => setMap((m) => ({ ...m, [f.key]: e.target.value || undefined }))}
                            className={`${sel} ${f.required && !map[f.key] ? 'border-rose-400' : ''}`}
                            aria-label={`Coluna de ${f.label}`}
                          >
                            <option value="">— não importar —</option>
                            {headers.map((h) => (
                              <option key={h} value={h}>{h}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-1.5 text-slate-500 truncate max-w-[18rem]">{map[f.key] ? String(sample[map[f.key]!] ?? '') : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {missingRequired.length > 0 && <p className="text-xs font-bold text-rose-600">Escolha a coluna de: {missingRequired.map((f) => f.label).join(', ')}.</p>}
              {map.company && (
                <div className={`p-3 rounded-xl border text-xs ${companyMatches ? 'border-emerald-200 bg-emerald-50/60 text-emerald-800' : 'border-rose-300 bg-rose-50 text-rose-800'}`}>
                  <p className="font-black flex items-center gap-1.5">
                    {companyMatches ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                    Empresa na planilha: {sheetCompanies.map(([v, c]) => `${v} (${n(c)})`).join(', ') || 'vazia'} · escolhida: {chosenName}
                  </p>
                  {!companyMatches && (
                    <label className="mt-2 flex items-center gap-2 font-bold cursor-pointer">
                      <input type="checkbox" checked={companyOk} onChange={(e) => setCompanyOk(e.target.checked)} />
                      Confirmo que esta planilha é da {chosenName} (os ativos da {chosenName} que não estiverem nela serão baixados).
                    </label>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 3 TIPOS */}
          {!done && step === 2 && (
            <div className="space-y-3">
              <p className="text-xs text-slate-600 dark:text-slate-300">
                A planilha tem <b>{groups.length} material(is)</b>. Escolha o <b>tipo de manutenção</b> de cada um (um tipo da {unit} ou digite um novo). O tipo decide a preventiva; a
                periodicidade fica no PMOC.
              </p>
              <datalist id="asset-import-types">
                {typeNames.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              <div className="space-y-2">
                {groups.map((g) => {
                  const v = typeByMaterial[g.key] ?? '';
                  const info = typeInfo(v);
                  return (
                    <div key={g.key} className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 grid grid-cols-1 md:grid-cols-[1fr_16rem] gap-3 items-start">
                      <div>
                        <p className="text-xs font-black text-slate-900 dark:text-white">{g.material}</p>
                        <p className="text-[11px] text-slate-500">
                          {n(g.count)} ativo(s){g.capacities.length > 0 && ` · ${g.capacities.length === 1 ? g.capacities[0] : `${g.capacities[0]} a ${g.capacities[g.capacities.length - 1]}`}`}
                        </p>
                        <span className={`inline-block mt-1.5 px-2 py-0.5 rounded-md border text-[10px] font-black ${chip(info.kind)}`}>{info.label}</span>
                      </div>
                      <label className="space-y-1">
                        <span className={lbl}>Tipo de manutenção</span>
                        <input
                          list="asset-import-types"
                          value={v}
                          onChange={(e) => setTypeByMaterial((m) => ({ ...m, [g.key]: e.target.value.toUpperCase() }))}
                          placeholder="Escolha ou digite..."
                          className={sel}
                          aria-label={`Tipo de ${g.material}`}
                        />
                        {g.suggestedFrom && v === g.suggested && (
                          <span className="block text-[10px] text-slate-500">{g.suggestedFrom === 'ativos' ? 'Sugerido pelos ativos já cadastrados' : 'Sugerido pela coluna TIPO da planilha'}</span>
                        )}
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 4 CONFERÊNCIA */}
          {!done && step === 3 && plan && (
            <div className="space-y-4">
              <p className="text-xs text-slate-600 dark:text-slate-300">
                <b>{unit} · {chosenName}</b> — {n(plan.sectorTotal)} ativo(s) cadastrados hoje; a planilha tem {n(plan.newCount + plan.updatedCount + plan.unchangedCount)}.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                {[
                  { t: 'Novos', v: plan.newCount, c: 'text-indigo-700' },
                  { t: 'Atualizados', v: plan.updatedCount, c: 'text-sky-700' },
                  { t: 'Sem mudança', v: plan.unchangedCount, c: 'text-slate-600' },
                  { t: 'Vão ser baixados', v: plan.toRetire.length, c: 'text-rose-700', list: 'retire' as const },
                  { t: 'Mudam de empresa', v: plan.moved.length, c: 'text-amber-700', list: 'moved' as const }
                ].map((k) => (
                  <button
                    key={k.t}
                    type="button"
                    disabled={!k.list || !k.v}
                    onClick={() => k.list && setShowList(showList === k.list ? null : k.list)}
                    className={`p-3 rounded-xl border text-left ${showList === k.list ? 'border-indigo-400 bg-indigo-50/50' : 'border-slate-200 dark:border-slate-700'} ${k.list && k.v ? 'cursor-pointer' : 'cursor-default'}`}
                  >
                    <span className={`block text-xl font-black ${k.c}`}>{n(k.v)}</span>
                    <span className="block text-[11px] font-bold text-slate-500">{k.t}{k.list && k.v ? ' · ver' : ''}</span>
                  </button>
                ))}
              </div>
              {showList && (
                <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800 text-[11px]">
                  {(showList === 'retire' ? plan.toRetire.map((a) => ({ a, extra: '' })) : plan.moved.map((m) => ({ a: m.asset, extra: `de ${companyName(m.from)}` }))).map(({ a, extra }) => (
                    <p key={a.id} className="px-3 py-1.5 text-slate-700 dark:text-slate-200">
                      <b className="font-mono">{a.code}</b> · {a.name} · {a.location}{extra && ` · ${extra}`}
                    </p>
                  ))}
                </div>
              )}
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                <p className={lbl}>Por tipo de manutenção</p>
                <div className="mt-2 space-y-1">
                  {plan.byType.map((t) => {
                    const info = typeInfo(t.type);
                    return (
                      <p key={t.type || '-'} className="flex flex-wrap items-center gap-2 text-xs">
                        <b className="text-slate-800 dark:text-slate-100">{t.type || 'Sem tipo'}</b>
                        <span className="text-slate-500">{n(t.count)} ativo(s)</span>
                        <span className={`px-2 py-0.5 rounded-md border text-[10px] font-black ${chip(info.kind)}`}>{info.label}</span>
                      </p>
                    );
                  })}
                </div>
              </div>
              {(plan.skipped > 0 || plan.duplicates.length > 0) && (
                <p className="text-[11px] text-amber-700 flex gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    {plan.skipped > 0 && `${n(plan.skipped)} linha(s) sem patrimônio ou material ficam de fora. `}
                    {plan.duplicates.length > 0 && `Patrimônio repetido na planilha (vale a última linha): ${plan.duplicates.slice(0, 10).join(', ')}${plan.duplicates.length > 10 ? '...' : ''}.`}
                  </span>
                </p>
              )}
              {plan.toRetire.length > 0 && (
                <p className="text-[11px] text-rose-700 flex gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>Os baixados saem das preventivas: as OS abertas deles são canceladas.</span>
                </p>
              )}
            </div>
          )}

          {/* PRONTO */}
          {done && (
            <div className="py-6 text-center space-y-2">
              <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-600" />
              <p className="text-sm font-black text-slate-900 dark:text-white">Importação concluída</p>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                {n(done.saved)} ativo(s) gravados · {n(done.retired)} baixado(s){done.cancelled ? ` (${n(done.cancelled)} OS canceladas)` : ''}
                {done.movedOrders ? ` · ${n(done.movedOrders)} OS passaram para a ${chosenName}` : ''}
              </p>
              {done.newTypes.length > 0 && (
                <p className="text-xs text-amber-800">
                  Tipos novos: <b>{done.newTypes.join(', ')}</b>. {done.typesNote}
                </p>
              )}
            </div>
          )}
          {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
        </div>

        {/* RODAPÉ */}
        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
          {done ? (
            <span />
          ) : (
            <button type="button" onClick={() => (step === 0 ? onClose() : setStep(step - 1))} disabled={busy} className={`${btn} border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200`}>
              <ArrowLeft className="w-3.5 h-3.5" />
              {step === 0 ? 'Cancelar' : 'Voltar'}
            </button>
          )}
          {done ? (
            <button type="button" onClick={onClose} className={`${btn} bg-indigo-600 text-white`}>
              Fechar
            </button>
          ) : step < 2 ? (
            <button type="button" disabled={!canNext} onClick={() => setStep(step + 1)} className={`${btn} bg-indigo-600 text-white`}>
              Próximo <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : step === 2 ? (
            <button type="button" onClick={goConference} className={`${btn} bg-indigo-600 text-white`}>
              Conferir <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button type="button" disabled={!canNext || busy} onClick={apply} className={`${btn} bg-emerald-600 text-white`}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {busy ? 'Gravando...' : `Gravar (${n((plan?.toSave.length || 0) + (plan?.toRetire.length || 0))})`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
