import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, PlusCircle, Save, X, Edit } from 'lucide-react';
import { Asset, AssetTypeConfig, Company, Management } from '../../types';
import {
  assetTypeKey,
  companiesOfUnit,
  dbCancelOpenOrdersForAssets,
  dbGetAssetTypes,
  dbMoveNewOrdersToCompany,
  dbSaveAsset,
  dbSyncAssetTypes
} from '../../db/firebase';
import { assetType, norm } from './assetImport';
import { assetCapacity, assetRoom, buildingOf } from './AssetGroupedList';

// CADASTRAR / EDITAR ATIVO (A4-C): os mesmos campos da planilha; o tipo de manutenção decide a preventiva
// (a periodicidade fica no tipo, em PMOC › Tipos de ativo e ciclo). Grava com as mesmas chaves da importação.

interface Props {
  isOpen: boolean;
  asset: Asset | null; // null = novo
  onClose: () => void;
  assets: Asset[];
  managements: Management[];
  companies: Company[];
  userName: string;
  canViewCosts: boolean;
  canManageTypes: boolean;
  onSaved: (a: Asset) => void;
}

type Form = {
  unit: string;
  company: string;
  code: string;
  material: string;
  capacity: string;
  brand: string;
  model: string;
  serial: string;
  type: string;
  building: string;
  room: string;
  craai: string;
  comarca: string;
  status: Asset['status'];
  date: string;
  value: string;
};

const s = (a: Asset | null, ...keys: string[]) => {
  for (const k of keys) {
    const v = a?.specs?.[k];
    if (v !== undefined && String(v).trim() !== '') return String(v).trim();
  }
  return '';
};

export default function AssetForm(p: Props) {
  const { isOpen, asset, onClose, assets, managements, companies, userName, canViewCosts, canManageTypes, onSaved } = p;
  const units = useMemo(() => managements.map((m) => m.name).filter((x) => x && x !== 'Todas'), [managements]);
  const [f, setF] = useState<Form | null>(null);
  const [types, setTypes] = useState<AssetTypeConfig[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setBusy(false);
    setF({
      unit: asset?.sector || units[0] || '',
      company: asset?.company || '',
      code: asset?.code || '',
      material: asset?.name || '',
      capacity: asset ? assetCapacity(asset) : '',
      brand: s(asset, 'MARCA', 'manufacturer'),
      model: s(asset, 'MODELO', 'model'),
      serial: s(asset, 'Nº DE SÉRIE', 'serialNumber'),
      type: asset ? assetType(asset) : '',
      building: asset ? asset.location || '' : '',
      room: asset ? assetRoom(asset) : '',
      craai: s(asset, 'CRAAI', 'craai'),
      comarca: s(asset, 'COMARCA', 'comarca'),
      status: asset?.status || 'Operando',
      date: s(asset, 'DATA DE AQUISIÇÃO', 'installationDate').slice(0, 10),
      value: s(asset, 'VALOR LÍQUIDO')
    });
  }, [isOpen, asset]);

  useEffect(() => {
    if (!isOpen || !f?.unit) return;
    let alive = true;
    dbGetAssetTypes([f.unit]).then((t) => alive && setTypes(t));
    return () => {
      alive = false;
    };
  }, [isOpen, f?.unit]);

  const unitAssets = useMemo(() => (f ? assets.filter((a) => a.kind !== 'address' && norm(a.sector) === norm(f.unit)) : []), [assets, f?.unit]);
  const uniq = (list: string[]) => Array.from(new Set(list.map((x) => x.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const typeNames = useMemo(() => uniq([...types.filter((t) => !t.archived).map((t) => t.name), ...unitAssets.map(assetType)]), [types, unitAssets]);
  const buildings = useMemo(() => uniq(unitAssets.map(buildingOf).filter((b) => b !== 'Sem endereço')), [unitAssets]);
  const craais = useMemo(() => uniq(unitAssets.map((a) => s(a, 'CRAAI', 'craai'))), [unitAssets]);
  const comarcas = useMemo(() => uniq(unitAssets.map((a) => s(a, 'COMARCA', 'comarca'))), [unitAssets]);

  if (!isOpen || !f) return null;

  const set = (k: keyof Form, v: string) => {
    setError('');
    setF((prev) => (prev ? { ...prev, [k]: v } : prev));
  };
  // Prédio já cadastrado: CRAAI e comarca vêm dos ativos dele (se ainda estiverem vazios)
  const pickBuilding = (v: string) => {
    setError('');
    const same = unitAssets.find((a) => norm(buildingOf(a)) === norm(v));
    setF((prev) =>
      prev ? { ...prev, building: v, craai: prev.craai || (same ? s(same, 'CRAAI', 'craai') : ''), comarca: prev.comarca || (same ? s(same, 'COMARCA', 'comarca') : '') } : prev
    );
  };
  const unitCompanies = companiesOfUnit(companies, f.unit).filter((c) => c.active || c.id === f.company);
  const companyName = (id: string) => companies.find((c) => c.id === id)?.name || id;
  const typeInfo = (() => {
    if (!f.type.trim()) return { kind: 'none', label: 'Sem tipo: não gera preventiva' };
    const t = types.find((x) => assetTypeKey(x.name) === assetTypeKey(f.type));
    if (!t) return { kind: 'new', label: 'Tipo novo: depois de salvar, marque as periodicidades no PMOC' };
    if (!t.periodicities.length) return { kind: 'noPeriod', label: 'Sem periodicidade no PMOC: ainda não gera preventiva' };
    return { kind: 'ok', label: `${t.periodicities.join(' · ')} — gera preventiva` };
  })();
  const chip =
    typeInfo.kind === 'ok' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : typeInfo.kind === 'none' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-amber-50 text-amber-800 border-amber-200';

  const save = async () => {
    setError('');
    const code = f.code.trim().toUpperCase();
    const missing = [!f.unit && 'Gerência', !f.company && 'Empresa', !code && 'Patrimônio', !f.material.trim() && 'Material', !f.building.trim() && 'Endereço (prédio)'].filter(Boolean);
    if (missing.length) {
      setError(`Preencha: ${missing.join(', ')}.`);
      return;
    }
    const dup = assets.find((a) => a.kind !== 'address' && a.id !== asset?.id && (a.code || '').trim().toUpperCase() === code);
    if (dup) {
      setError(`O patrimônio ${code} já está cadastrado (${dup.name}, ${dup.sector}). Abra esse ativo pela lista.`);
      return;
    }
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const specs: Record<string, string | undefined> = { ...(asset?.specs || {}) };
      // Chaves antigas do cadastro manual da primeira versão (minúsculas) e o status repetido saem
      ['status', 'STATUS', 'acquisitionValue', 'netValue', 'craai', 'comarca', 'material', 'tipo'].forEach((k) => delete specs[k]);
      const put = (keys: string[], v: string) => keys.forEach((k) => (specs[k] = v.trim()));
      put(['MATERIAL'], f.material);
      put(['TIPO'], f.type.toUpperCase());
      put(['CAPACIDADE', 'capacity'], f.capacity);
      put(['MARCA', 'manufacturer'], f.brand);
      put(['MODELO', 'model'], f.model);
      put(['Nº DE SÉRIE', 'serialNumber'], f.serial);
      put(['LOCALIZAÇÃO'], f.room);
      put(['CRAAI'], f.craai);
      put(['COMARCA'], f.comarca);
      put(['DATA DE AQUISIÇÃO', 'installationDate'], f.date);
      if (canViewCosts) put(['VALOR LÍQUIDO'], f.value);
      const wasRetired = asset?.status === 'Baixado';
      const next: Asset = {
        ...(asset || ({} as Asset)),
        id: asset?.id || `as_${f.unit.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now().toString().slice(-4)}_${Math.random().toString(36).slice(2, 6)}`,
        code,
        name: f.material.trim(),
        sector: f.unit,
        company: f.company,
        location: f.building.trim(),
        status: f.status,
        specs: specs as Asset['specs'],
        createdAt: asset?.createdAt || now,
        updatedAt: now,
        retiredAt: f.status === 'Baixado' ? (wasRetired ? asset?.retiredAt : now) : undefined
      };
      delete next.periodicities; // a periodicidade vem do tipo (PMOC)
      if (asset && (asset.company || '') !== f.company) {
        next.companyHistory = [...(asset.companyHistory || []), { from: asset.company || '', to: f.company, at: now, via: 'manual' }];
      }
      await dbSaveAsset(next);
      // Mudou de empresa: as OS dele ainda "Novo" passam para a empresa nova
      if (asset && asset.company && asset.company !== f.company) {
        await dbMoveNewOrdersToCompany(asset.sector || f.unit, 'assetId', [{ id: next.id, company: f.company }], companyName, userName).catch((e) =>
          console.warn('OS "Novo" não passaram para a empresa nova:', e)
        );
      }
      // Baixado agora: sai das preventivas (as OS abertas dele são canceladas), como na importação
      if (f.status === 'Baixado' && !wasRetired && asset) {
        await dbCancelOpenOrdersForAssets([next.id], `Ativo baixado no cadastro por ${userName}`, f.unit).catch((e) => console.warn('OS do ativo baixado não canceladas:', e));
      }
      // Tipo novo vai para o PMOC sem periodicidade (quem pode mexer nos modelos)
      if (f.type.trim() && canManageTypes && !types.some((t) => assetTypeKey(t.name) === assetTypeKey(f.type))) {
        const names = [...unitAssets.filter((a) => a.id !== next.id && a.status !== 'Baixado').map(assetType), f.type.toUpperCase()].filter(Boolean);
        await dbSyncAssetTypes(f.unit, names, types).catch((e) => console.warn('Tipo novo não criado no PMOC:', e));
      }
      onSaved(next);
      onClose();
    } catch (e: any) {
      console.error('Ativo não salvo:', e);
      setError(`Não foi possível salvar: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const lbl = 'block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1';
  const inp = 'w-full h-9 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-800 dark:text-slate-100';
  const sec = 'p-3 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3';
  const secTitle = 'text-[11px] font-black text-slate-800 dark:text-slate-100';
  const field = (k: keyof Form, label: string, opts: { req?: boolean; list?: string; ph?: string; upper?: boolean } = {}) => (
    <label className="block min-w-0">
      <span className={lbl}>
        {label}
        {opts.req && <span className="text-rose-600"> *</span>}
      </span>
      <input
        value={f[k]}
        list={opts.list}
        placeholder={opts.ph}
        onChange={(e) => (k === 'building' ? pickBuilding(e.target.value) : set(k, opts.upper ? e.target.value.toUpperCase() : e.target.value))}
        className={inp}
        aria-label={label}
      />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-3 font-sans">
      <div className="w-full max-w-3xl max-h-[94vh] flex flex-col rounded-2xl bg-white dark:bg-[#0e1a3a] border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
            {asset ? <Edit className="w-5 h-5 text-indigo-600" /> : <PlusCircle className="w-5 h-5 text-indigo-600" />}
            {asset ? `Editar ativo ${asset.code}` : 'Novo ativo'}
          </h2>
          <button type="button" onClick={onClose} disabled={busy} className="h-8 w-8 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center cursor-pointer" aria-label="Fechar">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <datalist id="af-types">{typeNames.map((t) => <option key={t} value={t} />)}</datalist>
          <datalist id="af-buildings">{buildings.map((t) => <option key={t} value={t} />)}</datalist>
          <datalist id="af-craai">{craais.map((t) => <option key={t} value={t} />)}</datalist>
          <datalist id="af-comarca">{comarcas.map((t) => <option key={t} value={t} />)}</datalist>

          <div className={`${sec} grid grid-cols-1 md:grid-cols-2 gap-3 space-y-0`}>
            <label className="block">
              <span className={lbl}>Gerência <span className="text-rose-600">*</span></span>
              <select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value, company: '' })} className={inp} aria-label="Gerência">
                {units.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={lbl}>Empresa <span className="text-rose-600">*</span></span>
              <select value={f.company} onChange={(e) => set('company', e.target.value)} className={inp} aria-label="Empresa">
                <option value="">Escolha a empresa...</option>
                {unitCompanies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          </div>

          <div className={sec}>
            <p className={secTitle}>Equipamento</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {field('code', 'Patrimônio', { req: true, upper: true, ph: 'Ex.: 158068' })}
              <div className="md:col-span-2">{field('material', 'Material', { req: true, upper: true, ph: 'Ex.: CONDICIONADOR DE AR DE PAREDE' })}</div>
              {field('capacity', 'Capacidade', { upper: true, ph: 'Ex.: 18.000 BTUS' })}
              {field('brand', 'Marca', { upper: true })}
              {field('model', 'Modelo', { upper: true })}
              {field('serial', 'Nº de série', { upper: true })}
            </div>
          </div>

          <div className={sec}>
            <p className={secTitle}>Tipo de manutenção</p>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
              {field('type', 'Tipo (decide a preventiva)', { list: 'af-types', upper: true, ph: 'Escolha ou digite...' })}
              <span className={`px-2 py-1 rounded-md border text-[10px] font-black ${chip}`}>{typeInfo.label}</span>
            </div>
            <p className="text-[10px] text-slate-500">A periodicidade é do tipo: PMOC › Modelos e Protocolos › Tipos de ativo e ciclo.</p>
          </div>

          <div className={sec}>
            <p className={secTitle}>Onde fica</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {field('building', 'Endereço (prédio)', { req: true, list: 'af-buildings', upper: true, ph: 'Rua e número' })}
              {field('room', 'Localização (sala / setor)', { upper: true })}
              {field('craai', 'CRAAI', { list: 'af-craai', upper: true })}
              {field('comarca', 'Comarca / unidade', { list: 'af-comarca', upper: true })}
            </div>
          </div>

          <div className={sec}>
            <p className={secTitle}>Situação</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="block">
                <span className={lbl}>Status</span>
                <select value={f.status} onChange={(e) => set('status', e.target.value)} className={inp} aria-label="Status">
                  {['Operando', 'Em Manutenção', 'Parado', 'Baixado'].map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              </label>
              <label className="block">
                <span className={lbl}>Data de aquisição</span>
                <input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} className={inp} aria-label="Data de aquisição" />
              </label>
              {canViewCosts && field('value', 'Valor líquido (R$)', { ph: '0,00' })}
            </div>
            {f.status === 'Baixado' && asset?.status !== 'Baixado' && asset && (
              <p className="text-[11px] text-rose-700 flex gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                Baixado: sai das preventivas e as OS abertas dele são canceladas.
              </p>
            )}
          </div>
          {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-xs font-black text-slate-700 dark:text-slate-200 cursor-pointer">
            Cancelar
          </button>
          <button type="button" onClick={save} disabled={busy} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-black inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {busy ? 'Salvando...' : asset ? 'Salvar alterações' : 'Cadastrar ativo'}
          </button>
        </div>
      </div>
    </div>
  );
}
