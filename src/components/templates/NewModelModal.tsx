import React, { useMemo, useState } from 'react';
import { Address, AssetTypeConfig, ChecklistTemplateItem, MaintenanceTemplate } from '../../types';
import { dbSaveTemplate } from '../../db/firebase';
import { isNewFormat, missingPeriodicities, newChecklistItem, preventiveModelId, SURVEY_PERIODICITIES } from './modelUtils';

// NOVO MODELO (ou DUPLICAR): preventiva = tipo de ativo + periodicidade; vistoria = periodicidade + endereços

export interface NewModelPreset {
  kind: 'preventive' | 'survey';
  assetTypeName?: string;
  periodicity?: string;
  copyFrom?: MaintenanceTemplate; // duplicar: copia o checklist
}

interface Props {
  unit: string;
  isSurveyUnit: boolean;          // gerência que trabalha com endereços (DOM)
  assetTypes: AssetTypeConfig[];  // tipos da gerência (não arquivados)
  templates: MaintenanceTemplate[];
  addresses: Address[];
  preset?: NewModelPreset;
  userName: string;
  onClose: () => void;
  onCreated: (t: MaintenanceTemplate) => void;
}

export default function NewModelModal({ unit, isSurveyUnit, assetTypes, templates, addresses, preset, userName, onClose, onCreated }: Props) {
  const [kind, setKind] = useState<'preventive' | 'survey'>(preset?.kind || (isSurveyUnit && assetTypes.length === 0 ? 'survey' : 'preventive'));
  const [typeName, setTypeName] = useState(preset?.assetTypeName || '');
  const [periodicity, setPeriodicity] = useState(preset?.periodicity || '');
  const [scope, setScope] = useState<'rest' | 'selected'>('selected');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const typesWithRoom = assetTypes.filter((t) => missingPeriodicities(t, templates).length > 0);
  const selectedType = assetTypes.find((t) => t.name === typeName);
  const periodOptions = kind === 'preventive' ? (selectedType ? missingPeriodicities(selectedType, templates) : []) : [...SURVEY_PERIODICITIES];
  const hasRestModel = templates.some((t) => isNewFormat(t) && t.type === 'survey' && t.unit === unit && t.addressScope === 'rest');
  const suggestedName = kind === 'preventive' ? (typeName && periodicity ? `${typeName} – ${periodicity}` : '') : periodicity ? `Vistoria ${periodicity}` : '';

  const activeAddresses = useMemo(() => addresses.filter((a) => a.active).length, [addresses]);

  const create = async () => {
    setError(null);
    const finalName = (name || suggestedName).trim();
    if (kind === 'preventive') {
      if (!typeName || !periodicity) return setError('Escolha o tipo de ativo e a periodicidade.');
    } else {
      if (!periodicity) return setError('Escolha a periodicidade.');
      if (scope === 'rest' && hasRestModel) return setError('Já existe um modelo "todos os demais endereços" nesta gerência.');
    }
    if (!finalName) return setError('Informe o nome do modelo.');
    const id =
      kind === 'preventive'
        ? preventiveModelId(unit, typeName, periodicity)
        : `MDL_${unit}_VST_${periodicity}_${Date.now()}`.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]/g, '_');
    if (templates.some((t) => t.id === id)) return setError('Já existe um modelo para este tipo e periodicidade.');

    const now = new Date().toISOString();
    const checklist: ChecklistTemplateItem[] = preset?.copyFrom
      ? preset.copyFrom.checklistItems.map((it) => ({ ...it, id: newChecklistItem().id }))
      : [];
    const template: MaintenanceTemplate = {
      id,
      format: 'v2',
      unit,
      name: finalName,
      description: preset?.copyFrom?.description || '',
      type: kind,
      targetSectorOrType: kind === 'preventive' ? unit : 'Vistoria',
      targetAssetType: kind === 'preventive' ? typeName : undefined,
      assetTypeName: kind === 'preventive' ? typeName : undefined,
      periodicity,
      addressScope: kind === 'survey' ? scope : undefined,
      addressIds: kind === 'survey' ? [] : undefined,
      checklistItems: checklist,
      createdAt: now,
      updatedAt: now,
      version: 1,
      history: [
        {
          version: 1,
          updatedAt: now.replace('T', ' ').slice(0, 16),
          changeDescription: preset?.copyFrom ? `Criado a partir de "${preset.copyFrom.name}".` : 'Modelo criado.',
          user: userName
        }
      ]
    };
    setSaving(true);
    try {
      await dbSaveTemplate(template);
      onCreated(template);
    } catch (err: any) {
      setError(err?.message || String(err));
      setSaving(false);
    }
  };

  const field = 'w-full h-9 text-xs px-3 border border-slate-200 rounded-lg outline-none font-semibold bg-white';
  const label = 'block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500';

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl p-6 space-y-3">
        <h3 className="text-base font-black text-slate-800">{preset?.copyFrom ? `Duplicar "${preset.copyFrom.name}"` : 'Novo modelo'} — {unit}</h3>

        {!preset?.copyFrom && (
          <div className="flex gap-2">
            {(['preventive', 'survey'] as const)
              .filter((k) => (k === 'survey' ? isSurveyUnit : assetTypes.length > 0))
              .map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => { setKind(k); setPeriodicity(''); }}
                  className={`flex-1 h-9 rounded-lg text-xs font-black border cursor-pointer ${kind === k ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-200 text-slate-600'}`}
                >
                  {k === 'preventive' ? 'Preventiva (equipamentos)' : 'Vistoria (endereços)'}
                </button>
              ))}
          </div>
        )}

        {kind === 'preventive' ? (
          <>
            <label className="block">
              <span className={label}>Tipo de ativo *</span>
              <select value={typeName} onChange={(e) => { setTypeName(e.target.value); setPeriodicity(''); }} className={field}>
                <option value="">Selecione...</option>
                {(typeName && !typesWithRoom.some((t) => t.name === typeName) ? [...typesWithRoom, ...assetTypes.filter((t) => t.name === typeName)] : typesWithRoom).map((t) => (
                  <option key={t.id} value={t.name}>{t.name}</option>
                ))}
              </select>
              {typesWithRoom.length === 0 && <span className="text-[10px] text-slate-500">Todos os tipos já têm modelo para as suas periodicidades.</span>}
            </label>
            <label className="block">
              <span className={label}>Periodicidade *</span>
              <select value={periodicity} onChange={(e) => setPeriodicity(e.target.value)} className={field} disabled={!typeName}>
                <option value="">{typeName ? 'Selecione...' : 'Escolha o tipo primeiro'}</option>
                {periodOptions.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <span className="text-[10px] text-slate-500">Só aparecem as periodicidades marcadas no tipo (aba 1) que ainda não têm modelo.</span>
            </label>
          </>
        ) : (
          <>
            <label className="block">
              <span className={label}>Periodicidade *</span>
              <select value={periodicity} onChange={(e) => setPeriodicity(e.target.value)} className={field}>
                <option value="">Selecione...</option>
                {periodOptions.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <div>
              <span className={label}>Endereços *</span>
              <div className="space-y-1.5 text-xs">
                <label className={`flex items-start gap-2 ${hasRestModel ? 'opacity-50' : 'cursor-pointer'}`}>
                  <input type="radio" checked={scope === 'rest'} disabled={hasRestModel} onChange={() => setScope('rest')} className="mt-0.5" />
                  <span>
                    <strong>Todos os demais endereços</strong> ({activeAddresses} ativos, menos os que estiverem em outro modelo)
                    {hasRestModel && <em className="block text-[10px]">Já existe um modelo assim nesta gerência.</em>}
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="radio" checked={scope === 'selected'} onChange={() => setScope('selected')} className="mt-0.5" />
                  <span><strong>Endereços escolhidos</strong> (você marca os endereços depois de criar)</span>
                </label>
              </div>
            </div>
          </>
        )}

        <label className="block">
          <span className={label}>Nome do modelo</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={suggestedName || 'Ex.: Ar de janela – Mensal'} className={field} />
        </label>
        {preset?.copyFrom && <p className="text-[11px] text-slate-500">O checklist de "{preset.copyFrom.name}" ({preset.copyFrom.checklistItems.length} itens) será copiado.</p>}
        {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-xs font-bold cursor-pointer">Cancelar</button>
          <button type="button" onClick={create} disabled={saving} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50">
            {saving ? 'Criando...' : 'Criar modelo'}
          </button>
        </div>
      </div>
    </div>
  );
}

