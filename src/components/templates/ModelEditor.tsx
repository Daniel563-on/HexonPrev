import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, FileText, Trash2, Plus } from 'lucide-react';
import { Address, ChecklistTemplateItem, MaintenanceTemplate } from '../../types';
import { dbSaveTemplate } from '../../db/firebase';
import { isNewFormat, newChecklistItem } from './modelUtils';

// EDITOR DO MODELO: nome, descrição, checklist (itens com todos os recursos), endereços (vistoria) e versões.
// Cada gravação vira uma nova versão; as OS já criadas não mudam.

interface Props {
  template: MaintenanceTemplate;
  templates: MaintenanceTemplate[];
  addresses: Address[];
  canManage: boolean;
  canDelete: boolean;
  userName: string;
  onSaved: (t: MaintenanceTemplate) => void;
  onDuplicate: (t: MaintenanceTemplate) => void;
  onDelete: (t: MaintenanceTemplate) => void;
  onOpenPdfMapper: (t: MaintenanceTemplate) => void;
}

const RESPONSE_TYPES: { value: NonNullable<ChecklistTemplateItem['responseType']>; label: string }[] = [
  { value: 'three_states', label: 'Conforme / Não conforme / N.A.' },
  { value: 'boolean', label: 'Sim / Não' },
  { value: 'number', label: 'Número' },
  { value: 'text', label: 'Texto' },
  { value: 'date', label: 'Data' }
];

export default function ModelEditor({ template, templates, addresses, canManage, canDelete, userName, onSaved, onDuplicate, onDelete, onOpenPdfMapper }: Props) {
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description || '');
  const [items, setItems] = useState<ChecklistTemplateItem[]>(template.checklistItems || []);
  const [addressIds, setAddressIds] = useState<string[]>(template.addressIds || []);
  const [newTask, setNewTask] = useState('');
  const [addrSearch, setAddrSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    setName(template.name);
    setDescription(template.description || '');
    setItems(template.checklistItems || []);
    setAddressIds(template.addressIds || []);
    setError(null);
    setSavedMsg(null);
  }, [template.id, template.version]);

  const dirty =
    name !== template.name ||
    description !== (template.description || '') ||
    JSON.stringify(items) !== JSON.stringify(template.checklistItems || []) ||
    JSON.stringify(addressIds) !== JSON.stringify(template.addressIds || []);

  const isSurvey = template.type === 'survey';
  // Endereços que já estão em outro modelo de vistoria (com endereços escolhidos) da mesma gerência
  const takenBy = useMemo(() => {
    const map = new Map<string, string>();
    templates
      .filter((t) => isNewFormat(t) && t.type === 'survey' && t.unit === template.unit && t.id !== template.id && t.addressScope === 'selected')
      .forEach((t) => (t.addressIds || []).forEach((id) => map.set(id, t.name)));
    return map;
  }, [templates, template.id, template.unit]);
  const activeAddresses = addresses.filter((a) => a.active);
  const restCount = activeAddresses.filter((a) => !takenBy.has(a.id)).length;

  const updateItem = (id: string, patch: Partial<ChecklistTemplateItem>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  const move = (idx: number, dir: -1 | 1) =>
    setItems((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  const addItem = () => {
    if (!newTask.trim()) return;
    setItems((prev) => [...prev, newChecklistItem(newTask.trim())]);
    setNewTask('');
  };

  const save = async () => {
    setError(null);
    setSavedMsg(null);
    if (!name.trim()) return setError('Informe o nome do modelo.');
    if (items.some((it) => !it.task.trim())) return setError('Há item do checklist sem descrição.');
    if (items.filter((it) => it.isActive).length === 0) return setError('O checklist precisa de pelo menos um item ativo.');
    if (isSurvey && template.addressScope === 'selected' && addressIds.length === 0) return setError('Marque pelo menos um endereço.');
    const changes: string[] = [];
    if (name !== template.name) changes.push('nome');
    if (description !== (template.description || '')) changes.push('descrição');
    if (JSON.stringify(items) !== JSON.stringify(template.checklistItems || [])) changes.push(`checklist (${items.length} itens)`);
    if (JSON.stringify(addressIds) !== JSON.stringify(template.addressIds || [])) changes.push(`endereços (${addressIds.length})`);
    const version = (template.version || 1) + 1;
    const now = new Date().toISOString();
    const updated: MaintenanceTemplate = {
      ...template,
      name: name.trim(),
      description: description.trim(),
      checklistItems: items.map((it) => ({ ...it, task: it.task.trim() })),
      addressIds: isSurvey ? addressIds : template.addressIds,
      version,
      updatedAt: now,
      history: [{ version, updatedAt: now.replace('T', ' ').slice(0, 16), changeDescription: `Alterado: ${changes.join(', ')}.`, user: userName }, ...(template.history || [])]
    };
    setSaving(true);
    try {
      await dbSaveTemplate(updated);
      onSaved(updated);
      setSavedMsg(`Versão ${version} salva. As OS já criadas não mudam; vale para os próximos disparos.`);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  const ro = !canManage;
  const field = 'w-full h-9 text-xs px-3 border border-slate-200 rounded-lg outline-none font-semibold bg-white disabled:bg-slate-50';
  const label = 'block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500';
  const filteredAddr = activeAddresses.filter((a) => {
    const q = addrSearch.trim().toLowerCase();
    return !q || [a.code, a.address, a.comarca, a.craai].some((v) => (v || '').toLowerCase().includes(q));
  });

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-xs p-5 space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase ${isSurvey ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'}`}>
            {isSurvey ? 'Vistoria' : 'Preventiva'}
          </span>
          {!isSurvey && <span className="px-2 py-0.5 rounded-md bg-slate-100 text-[10px] font-black text-slate-700">{template.assetTypeName}</span>}
          <span className="px-2 py-0.5 rounded-md bg-slate-100 text-[10px] font-black text-slate-700">{template.periodicity}</span>
          <span className="px-2 py-0.5 rounded-md bg-slate-100 text-[10px] font-black text-slate-700">{template.unit}</span>
          <span className="text-[10px] font-bold text-slate-400">Versão {template.version || 1}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && (
            <button type="button" onClick={() => onDuplicate(template)} className="h-8 px-3 rounded-lg border border-slate-200 text-[11px] font-bold text-slate-600 flex items-center gap-1 cursor-pointer">
              <Copy className="w-3.5 h-3.5" /> Duplicar
            </button>
          )}
          {canManage && (
            <button type="button" onClick={() => onOpenPdfMapper(template)} className="h-8 px-3 rounded-lg border border-slate-200 text-[11px] font-bold text-slate-600 flex items-center gap-1 cursor-pointer">
              <FileText className="w-3.5 h-3.5" /> Mapear PDF
            </button>
          )}
          {canDelete && (
            <button type="button" onClick={() => onDelete(template)} className="h-8 px-3 rounded-lg border border-rose-200 bg-rose-50 text-[11px] font-bold text-rose-700 flex items-center gap-1 cursor-pointer">
              <Trash2 className="w-3.5 h-3.5" /> Excluir
            </button>
          )}
        </div>
      </div>

      {/* Dados */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block">
          <span className={label}>Nome do modelo *</span>
          <input value={name} disabled={ro} onChange={(e) => setName(e.target.value)} className={field} />
        </label>
        <label className="block">
          <span className={label}>Descrição</span>
          <input value={description} disabled={ro} onChange={(e) => setDescription(e.target.value)} placeholder="Orientações gerais para o técnico" className={field} />
        </label>
      </div>

      {/* Endereços (vistoria) */}
      {isSurvey && (
        <div className="space-y-2">
          <span className={label}>Endereços</span>
          {template.addressScope === 'rest' ? (
            <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
              <strong>Todos os demais endereços:</strong> {restCount} endereço(s) ativo(s) — todos os que não estão em um modelo com endereços escolhidos.
            </p>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center justify-between">
                <input value={addrSearch} onChange={(e) => setAddrSearch(e.target.value)} placeholder="Buscar código, endereço, comarca..." className={`${field} sm:max-w-xs`} />
                <span className="text-[11px] font-bold text-slate-600">{addressIds.length} endereço(s) marcado(s)</span>
              </div>
              <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                {filteredAddr.map((a) => {
                  const other = takenBy.get(a.id);
                  const checked = addressIds.includes(a.id);
                  return (
                    <label key={a.id} className={`flex items-start gap-2 px-3 py-2 text-xs ${other ? 'opacity-50' : 'cursor-pointer hover:bg-slate-50'}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={ro || !!other}
                        onChange={() => setAddressIds((prev) => (checked ? prev.filter((x) => x !== a.id) : [...prev, a.id]))}
                        className="mt-0.5"
                      />
                      <span>
                        <strong className="font-mono">{a.code}</strong> — {a.address} <span className="text-slate-500">({a.comarca})</span>
                        {other && <em className="block text-[10px]">Já está em "{other}"</em>}
                      </span>
                    </label>
                  );
                })}
                {filteredAddr.length === 0 && <p className="p-3 text-xs text-slate-400">Nenhum endereço encontrado.</p>}
              </div>
            </>
          )}
        </div>
      )}

      {/* Checklist */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className={label}>Checklist ({items.filter((i) => i.isActive).length} ativo(s) de {items.length})</span>
        </div>
        {items.length === 0 && <p className="text-xs text-slate-400">Nenhum item. Adicione abaixo.</p>}
        <div className="space-y-2">
          {items.map((it, idx) => (
            <div key={it.id} className={`border rounded-lg p-3 space-y-2 ${it.isActive ? 'border-slate-200' : 'border-slate-200 bg-slate-50 opacity-70'}`}>
              <div className="flex gap-2 items-start">
                <span className="text-[11px] font-black text-slate-400 pt-2 w-5 text-right">{idx + 1}.</span>
                <input value={it.task} disabled={ro} onChange={(e) => updateItem(it.id, { task: e.target.value })} className={field} placeholder="Descrição do item" />
                {!ro && (
                  <div className="flex gap-1 shrink-0">
                    <button type="button" onClick={() => move(idx, -1)} disabled={idx === 0} className="h-9 w-8 flex items-center justify-center border border-slate-200 rounded-lg disabled:opacity-30 cursor-pointer" title="Subir"><ArrowUp className="w-3.5 h-3.5" /></button>
                    <button type="button" onClick={() => move(idx, 1)} disabled={idx === items.length - 1} className="h-9 w-8 flex items-center justify-center border border-slate-200 rounded-lg disabled:opacity-30 cursor-pointer" title="Descer"><ArrowDown className="w-3.5 h-3.5" /></button>
                    <button type="button" onClick={() => setItems((prev) => prev.filter((x) => x.id !== it.id))} className="h-9 w-8 flex items-center justify-center border border-rose-200 text-rose-600 rounded-lg cursor-pointer" title="Remover"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                )}
              </div>
              <div className="pl-7 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px]">
                <select value={it.responseType || 'three_states'} disabled={ro} onChange={(e) => {
                  const responseType = e.target.value as ChecklistTemplateItem['responseType'];
                  // Solicitação de corretiva só existe na pergunta Conforme / Não conforme / N.A.
                  updateItem(it.id, responseType === 'three_states' ? { responseType } : { responseType, autoCreateCorrective: false });
                }} className="h-8 px-2 border border-slate-200 rounded-lg font-semibold">
                  {RESPONSE_TYPES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                {/* "Não conforme" já exige observação; N.A. não pede observação (Etapa 8) */}
                {[
                  ...((it.responseType || 'three_states') === 'three_states' ? [['autoCreateCorrective', '"Não conforme" gera solicitação de corretiva']] : []),
                  ['isActive', 'Ativo']
                ].map(([key, text]) => (
                  <label key={key} className="flex items-center gap-1.5 font-semibold text-slate-600 cursor-pointer">
                    <input type="checkbox" disabled={ro} checked={!!(it as any)[key]} onChange={(e) => updateItem(it.id, { [key]: e.target.checked } as any)} />
                    {text}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        {!ro && (
          <div className="flex gap-2">
            <input
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addItem()}
              placeholder="Novo item do checklist (Enter para adicionar)"
              className={field}
            />
            <button type="button" onClick={addItem} className="h-9 px-3 rounded-lg bg-slate-800 text-white text-xs font-bold flex items-center gap-1 cursor-pointer shrink-0">
              <Plus className="w-3.5 h-3.5" /> Adicionar
            </button>
          </div>
        )}
      </div>

      {/* Salvar */}
      {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
      {savedMsg && !dirty && <p className="text-xs font-bold text-emerald-600">{savedMsg}</p>}
      {canManage && (
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
          {dirty && <span className="text-[11px] font-bold text-amber-600 mr-auto">Alterações não salvas</span>}
          {dirty && (
            <button
              type="button"
              onClick={() => { setName(template.name); setDescription(template.description || ''); setItems(template.checklistItems || []); setAddressIds(template.addressIds || []); }}
              className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-xs font-bold cursor-pointer"
            >
              Descartar
            </button>
          )}
          <button type="button" onClick={save} disabled={!dirty || saving} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer disabled:opacity-40">
            {saving ? 'Salvando...' : 'Salvar nova versão'}
          </button>
        </div>
      )}

      {/* Histórico */}
      <div className="border-t border-slate-100 pt-3">
        <button type="button" onClick={() => setShowHistory(!showHistory)} className="text-[11px] font-bold text-slate-500 cursor-pointer">
          {showHistory ? '▾' : '▸'} Histórico de versões ({(template.history || []).length})
        </button>
        {showHistory && (
          <ul className="mt-2 space-y-1 text-[11px] text-slate-600">
            {(template.history || []).map((h, i) => (
              <li key={i}><strong>v{h.version}</strong> — {h.updatedAt} — {h.user}: {h.changeDescription}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
