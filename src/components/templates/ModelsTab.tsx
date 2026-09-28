import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Address, AssetTypeConfig, MaintenanceTemplate } from '../../types';
import { assetTypeKey, ASSET_PERIODICITIES, dbDeleteTemplate, dbGetAssetTypes } from '../../db/firebase';
import { isNewFormat } from './modelUtils';
import ModelEditor from './ModelEditor';
import NewModelModal, { NewModelPreset } from './NewModelModal';

// MODELOS (formato novo): cobertura por tipo × periodicidade, lista, editor, duplicar e excluir.
// Os modelos antigos ficam em "Formato antigo — recriar e apagar".

interface Props {
  units: string[];
  templates: MaintenanceTemplate[];
  addresses: Address[];
  userName: string;
  canManage: boolean;
  canDelete: boolean;
  onChanged: () => Promise<void> | void;
  onOpenPdfMapper: (t: MaintenanceTemplate) => void;
}

// Gerência que trabalha com endereços (vistorias)
const isSurveyUnit = (unit: string) => unit.trim().toUpperCase() === 'DOM';

export default function ModelsTab({ units, templates, addresses, userName, canManage, canDelete, onChanged, onOpenPdfMapper }: Props) {
  const [unit, setUnit] = useState(units[0] || '');
  const [assetTypes, setAssetTypes] = useState<AssetTypeConfig[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newPreset, setNewPreset] = useState<NewModelPreset | null>(null);
  const [toDelete, setToDelete] = useState<MaintenanceTemplate | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!unit && units.length > 0) setUnit(units[0]);
  }, [units]);
  useEffect(() => {
    if (units.length > 0) dbGetAssetTypes(units).then(setAssetTypes);
  }, [units.join('|')]);

  const unitTypes = assetTypes.filter((t) => t.unit === unit && !t.archived);
  const unitModels = templates
    .filter((t) => isNewFormat(t) && t.unit === unit)
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'preventive' ? -1 : 1));
  const oldModels = templates.filter((t) => !isNewFormat(t));
  const selected = templates.find((t) => t.id === selectedId && isNewFormat(t) && t.unit === unit) || null;

  const modelFor = (typeName: string, periodicity: string) =>
    unitModels.find((t) => t.type === 'preventive' && t.periodicity === periodicity && assetTypeKey(t.assetTypeName) === assetTypeKey(typeName));
  const missingCount = unitTypes.reduce((n, t) => n + t.periodicities.filter((p) => !modelFor(t.name, p)).length, 0);

  const surveyModels = unitModels.filter((t) => t.type === 'survey');
  const activeAddresses = addresses.filter((a) => a.active);
  const coveredAddresses = useMemo(() => {
    const ids = new Set<string>();
    surveyModels.filter((t) => t.addressScope === 'selected').forEach((t) => (t.addressIds || []).forEach((id) => ids.add(id)));
    const hasRest = surveyModels.some((t) => t.addressScope === 'rest');
    return hasRest ? activeAddresses.length : activeAddresses.filter((a) => ids.has(a.id)).length;
  }, [surveyModels, activeAddresses]);

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await dbDeleteTemplate(toDelete.id);
      if (selectedId === toDelete.id) setSelectedId(null);
      setToDelete(null);
      await onChanged();
    } catch (err: any) {
      setDeleteError(err?.message || String(err));
    } finally {
      setDeleting(false);
    }
  };

  const card = 'bg-white border border-slate-200 rounded-xl p-5 shadow-xs';

  return (
    <div className="space-y-4">
      {/* Gerência */}
      <div className={`${card} flex flex-col sm:flex-row sm:items-center justify-between gap-3`}>
        <div>
          <h2 className="text-sm font-black text-slate-800">Modelos</h2>
          <p className="text-xs text-slate-500">
            {isSurveyUnit(unit)
              ? 'Vistorias por endereço: cada endereço pertence a um único modelo.'
              : 'Um modelo por tipo de ativo e periodicidade. Tipo sem modelo não gera OS no disparo.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {units.length > 1 ? (
            <select value={unit} onChange={(e) => { setUnit(e.target.value); setSelectedId(null); }} className="h-9 px-3 text-xs font-bold border border-slate-200 rounded-lg bg-white">
              {units.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          ) : (
            <span className="px-3 py-1.5 rounded-lg bg-slate-100 text-xs font-black text-slate-700">{unit}</span>
          )}
          {canManage && (
            <button type="button" onClick={() => setNewPreset({ kind: isSurveyUnit(unit) && unitTypes.length === 0 ? 'survey' : 'preventive' })} className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1 cursor-pointer">
              <Plus className="w-4 h-4" /> Novo modelo
            </button>
          )}
        </div>
      </div>

      {/* Cobertura: preventivas */}
      {unitTypes.length > 0 && (
        <div className={`${card} space-y-3`}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-black uppercase tracking-wider text-slate-600">Cobertura — tipos × periodicidades</p>
            <span className={`text-[11px] font-bold ${missingCount > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
              {missingCount > 0 ? `${missingCount} modelo(s) faltando` : 'Todos os tipos têm modelo'}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="p-2">Tipo de ativo</th>
                  {ASSET_PERIODICITIES.map((p) => <th key={p.name} className="p-2 text-center">{p.name}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {unitTypes.map((t) => (
                  <tr key={t.id}>
                    <td className="p-2 font-bold text-slate-800">{t.name}</td>
                    {ASSET_PERIODICITIES.map((p) => {
                      if (!t.periodicities.includes(p.name)) return <td key={p.name} className="p-2 text-center text-slate-300">—</td>;
                      const m = modelFor(t.name, p.name);
                      return (
                        <td key={p.name} className="p-2 text-center">
                          {m ? (
                            <button type="button" onClick={() => setSelectedId(m.id)} className={`px-2 py-1 rounded-md text-[10px] font-black cursor-pointer ${selectedId === m.id ? 'bg-emerald-600 text-white' : 'bg-emerald-100 text-emerald-800'}`}>
                              ✔ modelo
                            </button>
                          ) : canManage ? (
                            <button type="button" onClick={() => setNewPreset({ kind: 'preventive', assetTypeName: t.name, periodicity: p.name })} className="px-2 py-1 rounded-md bg-amber-100 text-amber-800 text-[10px] font-black cursor-pointer">
                              ⚠ criar
                            </button>
                          ) : (
                            <span className="px-2 py-1 rounded-md bg-amber-100 text-amber-800 text-[10px] font-black">⚠ falta</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {unitTypes.some((t) => t.periodicities.length === 0) && (
            <p className="text-[11px] text-amber-700 font-bold">Há tipos sem periodicidade marcada (aba 1): eles não aparecem aqui.</p>
          )}
        </div>
      )}

      {/* Cobertura: vistorias */}
      {isSurveyUnit(unit) && (
        <div className={`${card} text-xs`}>
          <p className="font-black uppercase tracking-wider text-slate-600 text-[11px]">Cobertura — endereços</p>
          <p className={`mt-1 font-bold ${coveredAddresses < activeAddresses.length ? 'text-amber-600' : 'text-emerald-600'}`}>
            {coveredAddresses} de {activeAddresses.length} endereço(s) ativo(s) com modelo de vistoria.
            {coveredAddresses < activeAddresses.length && ' Crie um modelo "todos os demais endereços" para cobrir o restante.'}
          </p>
        </div>
      )}

      {/* Lista + editor */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 items-start">
        <div className={`${card} p-3 space-y-1`}>
          {unitModels.length === 0 && <p className="text-xs text-slate-400 p-2">Nenhum modelo nesta gerência.</p>}
          {unitModels.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelectedId(t.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs cursor-pointer ${selectedId === t.id ? 'bg-blue-600 text-white' : 'hover:bg-slate-50 text-slate-700'}`}
            >
              <span className="font-bold block truncate">{t.name}</span>
              <span className={`text-[10px] ${selectedId === t.id ? 'text-blue-100' : 'text-slate-400'}`}>
                {t.type === 'survey' ? `Vistoria • ${t.periodicity} • ${t.addressScope === 'rest' ? 'demais endereços' : `${(t.addressIds || []).length} endereço(s)`}` : `${t.periodicity} • ${t.checklistItems.filter((i) => i.isActive).length} itens`}
              </span>
            </button>
          ))}
        </div>

        {selected ? (
          <ModelEditor
            template={selected}
            templates={templates}
            addresses={addresses}
            canManage={canManage}
            canDelete={canDelete}
            userName={userName}
            onSaved={() => onChanged()}
            onDuplicate={(t) => setNewPreset({ kind: t.type, assetTypeName: t.assetTypeName, copyFrom: t })}
            onDelete={(t) => { setDeleteError(null); setToDelete(t); }}
            onOpenPdfMapper={onOpenPdfMapper}
          />
        ) : (
          <div className={`${card} text-xs text-slate-400`}>Selecione um modelo na lista ou na cobertura.</div>
        )}
      </div>

      {/* Modelos antigos */}
      {oldModels.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
          <p className="text-xs font-black text-amber-900">Formato antigo — recriar e apagar ({oldModels.length})</p>
          <p className="text-[11px] text-amber-800">Estes modelos não têm gerência nem tipo no formato novo e não serão usados no disparo novo.</p>
          <div className="space-y-1">
            {oldModels.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-2 bg-white border border-amber-100 rounded-lg px-3 py-1.5 text-xs">
                <span className="truncate"><strong>{t.name}</strong> <span className="text-slate-500">({t.type === 'survey' ? 'vistoria' : 'preventiva'} • {t.periodicity})</span></span>
                {canDelete && (
                  <button type="button" onClick={() => { setDeleteError(null); setToDelete(t); }} className="h-7 px-2.5 rounded-lg border border-rose-200 bg-rose-50 text-[10px] font-bold text-rose-700 flex items-center gap-1 cursor-pointer shrink-0">
                    <Trash2 className="w-3 h-3" /> Excluir
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {newPreset && (
        <NewModelModal
          unit={unit}
          isSurveyUnit={isSurveyUnit(unit)}
          assetTypes={unitTypes}
          templates={templates}
          addresses={addresses}
          preset={newPreset}
          userName={userName}
          onClose={() => setNewPreset(null)}
          onCreated={async (t) => { setNewPreset(null); await onChanged(); setSelectedId(t.id); }}
        />
      )}

      {toDelete && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-2xl p-6 space-y-3">
            <h3 className="text-base font-black text-slate-800">Excluir modelo</h3>
            <p className="text-xs text-slate-600">
              Excluir <strong>{toDelete.name}</strong>? As OS já criadas continuam como estão; os próximos disparos deixam de usar este modelo.
            </p>
            {deleteError && <p className="text-xs font-bold text-rose-600">{deleteError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setToDelete(null)} disabled={deleting} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-xs font-bold cursor-pointer">Cancelar</button>
              <button type="button" onClick={confirmDelete} disabled={deleting} className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50">
                {deleting ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
