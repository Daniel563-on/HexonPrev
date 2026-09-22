import React, { useState, useEffect } from 'react';
import { PlusCircle, Plus, X } from 'lucide-react';
import { ServiceOrder, Asset, ChecklistItem } from '../../types';
import { dbSaveServiceOrder } from '../../db/firebase';

export interface CreateOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  assets: Asset[];
  templates: any[];
  onReload: () => void;
  checkTechAssignment?: (techName: string, dateStr: string, os: ServiceOrder) => boolean;
}

export default function CreateOrderModal({
  isOpen,
  onClose,
  assets,
  templates,
  onReload,
  checkTechAssignment
}: CreateOrderModalProps) {
  const [osAssetId, setOsAssetId] = useState('');
  const [osTitle, setOsTitle] = useState('');
  const [osDescription, setOsDescription] = useState('');
  const [osPriority, setOsPriority] = useState<'Baixa' | 'Média' | 'Alta' | 'Urgente'>('Média');
  const [osScheduledDate, setOsScheduledDate] = useState('');
  const [osTechnician, setOsTechnician] = useState('Daniel Torres');
  const [osChecklist, setOsChecklist] = useState<string[]>([]);
  const [newChecklistItemText, setNewChecklistItemText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Set default asset when list is provided
  useEffect(() => {
    if (assets.length > 0 && !osAssetId) {
      setOsAssetId(assets[0].id);
    }
  }, [assets]);

  // Handle asset-based checklist template loader
  useEffect(() => {
    if (osAssetId && assets.length > 0) {
      const selectedAssetObj = assets.find((a) => a.id === osAssetId);
      if (selectedAssetObj) {
        // Find existing template matching target sector or category
        const matchingTemplate = templates.find(
          (t) => t.targetSectorOrType?.toLowerCase() === selectedAssetObj.sector?.toLowerCase()
        );
        if (matchingTemplate && matchingTemplate.checklistItems) {
          const loadedTasks = matchingTemplate.checklistItems
            .filter((item: any) => item.isActive !== false)
            .map((item: any) => item.task);
          setOsChecklist(loadedTasks);
        } else {
          setOsChecklist([]);
        }
      }
    } else {
      setOsChecklist([]);
    }
  }, [osAssetId, assets, templates]);

  if (!isOpen) return null;

  const addCustomChecklistItem = () => {
    if (!newChecklistItemText.trim()) return;
    setOsChecklist([...osChecklist, newChecklistItemText.trim()]);
    setNewChecklistItemText('');
  };

  const removeChecklistItem = (indexToRem: number) => {
    setOsChecklist(osChecklist.filter((_, idx) => idx !== indexToRem));
  };

  const handleCreateOSSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!osTitle || !osDescription || !osScheduledDate) {
      alert('Por favor, preencha todos os campos fundamentais (Título, Escopo e Agendamento).');
      return;
    }

    const selectedAsset = osAssetId ? assets.find((a) => a.id === osAssetId) : undefined;

    // Build the dynamic Checklist items
    const checklistItems: ChecklistItem[] = osChecklist.map((task, idx) => ({
      id: `ck_${Date.now()}_${idx}`,
      task: task,
      checked: false,
      checkedAt: null,
      observations: null
    }));

    const newOSId = (28000 + Math.floor(Math.random() * 1000)).toString();

    const newServiceOrder: ServiceOrder = {
      id: newOSId,
      assetId: selectedAsset ? selectedAsset.id : null,
      assetName: selectedAsset ? selectedAsset.name : 'S/V - Vistoria / Serviço Geral',
      assetCode: selectedAsset ? selectedAsset.code : 'VISTORIA',
      sector: selectedAsset ? selectedAsset.sector : 'Vistoria',
      title: osTitle.trim(),
      description: osDescription.trim(),
      priority: osPriority,
      status: 'Planejada',
      scheduledDate: osScheduledDate,
      assignedTechnician: osTechnician,
      checklist: checklistItems,
      notes: '',
      signature: null,
      signedBy: null,
      signedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      photoEvidence: null
    };

    // Validate technician daily availability
    if (osScheduledDate && osTechnician && checkTechAssignment) {
      const proceed = checkTechAssignment(osTechnician, osScheduledDate, newServiceOrder);
      if (!proceed) return;
    }

    setIsSubmitting(true);
    try {
      await dbSaveServiceOrder(newServiceOrder);
      alert(`Ordem de serviço #${newOSId} registrada e planejada com checklist de ${checklistItems.length} itens!`);
      onClose();

      // Reset form fields
      setOsTitle('');
      setOsDescription('');
      setOsScheduledDate('');

      // Reload lists
      onReload();
    } catch (err) {
      console.error(err);
      alert('Erro ao registrar ordem de serviço.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl p-6 max-w-lg w-full border border-gray-200 my-8">
        <div className="flex justify-between items-center pb-3 border-b border-gray-100 mb-4">
          <h3 className="font-extrabold text-[#0b1c30] text-sm flex items-center gap-1.5">
            <PlusCircle className="w-5 h-5 text-[#3525cd]" />
            Abrir Nova Ordem de Serviço Preventiva
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-rose-600 font-extrabold text-sm cursor-pointer"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleCreateOSSubmit} className="space-y-4">
          {/* Every preventive order can originate from a selected asset or be a general survey */}
          <div>
            <label className="block text-[10px] font-extrabold text-gray-500 uppercase tracking-wider mb-1">
              Ativo de Origem (Opcional)
            </label>
            <select
              value={osAssetId}
              onChange={(e) => setOsAssetId(e.target.value)}
              className="w-full text-xs py-2 px-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold text-slate-800"
            >
              <option value="">-- Sem vínculo (Vistoria oú Serviço Geral) --</option>
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  [{asset.code}] {asset.name} ({asset.sector})
                </option>
              ))}
            </select>
            <p className="text-[10px] text-slate-500 mt-1">
              * Selecione um ativo para carregar automaticamente o checklist do modelo preventiva, ou deixe vazio para vistorias em geral.
            </p>
          </div>

          <div>
            <label className="block text-[10px] font-extrabold text-gray-500 uppercase tracking-wider mb-1">
              Título do Serviço*
            </label>
            <input
              type="text"
              required
              placeholder="Ex: Preventiva Geral de Compressor"
              value={osTitle}
              onChange={(e) => setOsTitle(e.target.value)}
              className="w-full text-xs py-2 px-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
            />
          </div>

          <div>
            <label className="block text-[10px] font-extrabold text-gray-500 uppercase tracking-wider mb-1">
              Escopo descritivo do trabalho*
            </label>
            <textarea
              required
              rows={2}
              placeholder="Ex: Efetuar reaperto de conexões, drenagem de óleo e higienização geral das colunas de resfriamento."
              value={osDescription}
              onChange={(e) => setOsDescription(e.target.value)}
              className="w-full text-xs py-2 px-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-[10px] font-extrabold text-gray-500 uppercase tracking-wider mb-1">
                Prioridade
              </label>
              <select
                value={osPriority}
                onChange={(e) => setOsPriority(e.target.value as any)}
                className="w-full text-xs py-2 px-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none"
              >
                <option value="Baixa">Baixa</option>
                <option value="Média">Média</option>
                <option value="Alta">Alta</option>
                <option value="Urgente">Urgente</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-extrabold text-gray-500 uppercase tracking-wider mb-1">
                Agendamento*
              </label>
              <input
                type="date"
                required
                value={osScheduledDate}
                onChange={(e) => setOsScheduledDate(e.target.value)}
                className="w-full text-xs py-2 px-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#3525cd]"
              />
            </div>

            <div>
              <label className="block text-[10px] font-extrabold text-gray-500 uppercase tracking-wider mb-1">
                Técnico Nome
              </label>
              <input
                type="text"
                required
                placeholder="Nome do Técnico Executor"
                value={osTechnician}
                onChange={(e) => setOsTechnician(e.target.value)}
                className="w-full text-xs py-2 px-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#3525cd]"
              />
            </div>
          </div>

          {/* Dynamic Checklist Customizer Layout */}
          <div className="p-4 bg-indigo-50/20 border border-indigo-100 rounded-xl space-y-3">
            <div className="flex justify-between items-center border-b border-indigo-100/60 pb-1.5">
              <span className="text-[10px] font-black text-[#3525cd] uppercase tracking-wider block">
                Checklist de Conformidade ({osChecklist.length} Tarefas dadas)
              </span>
            </div>

            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
              {osChecklist.map((task, idx) => (
                <div
                  key={idx}
                  className="flex justify-between items-center text-[11px] bg-white p-2 rounded border border-slate-100 font-semibold group"
                >
                  <span className="text-slate-700 truncate">{task}</span>
                  <button
                    type="button"
                    onClick={() => removeChecklistItem(idx)}
                    className="text-stone-400 hover:text-rose-600 ml-2 cursor-pointer"
                    title="Remover item"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            {/* checklist item creator injector */}
            <div className="flex gap-1.5">
              <input
                type="text"
                placeholder="Adicionar tarefa personalizada à preventiva..."
                value={newChecklistItemText}
                onChange={(e) => setNewChecklistItemText(e.target.value)}
                className="flex-1 text-[11px] py-1.5 px-2 bg-white border border-gray-200 rounded focus:outline-none"
              />
              <button
                type="button"
                onClick={addCustomChecklistItem}
                className="bg-[#3525cd]/15 text-[#3525cd] text-xs font-bold px-3 py-1.5 rounded hover:bg-[#3525cd]/25 cursor-pointer flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                Inserir
              </button>
            </div>
          </div>

          <div className="flex gap-2 justify-end text-xs pt-3 border-t">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 font-bold cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-[#3525cd] text-white rounded-lg font-bold hover:bg-indigo-700 cursor-pointer shadow disabled:opacity-50"
            >
              {isSubmitting ? 'Salvando...' : 'Planejar & Automatizar OS'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
