import React, { useState, useRef, useMemo } from 'react';
import {
  FileText,
  Plus,
  Trash2,
  Check,
  ToggleLeft,
  ToggleRight,
  Settings,
  Clock,
  CheckCircle,
  Info,
  Edit2,
  ChevronDown,
  ChevronUp,
  Search,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Upload,
  Crosshair,
  FileCheck
} from 'lucide-react';
import {
  MaintenanceTemplate,
  ChecklistTemplateItem,
  TemplateChangeLog,
  Management,
  PdfTemplateConfig
} from '../../types';
import { dbSaveTemplate } from '../../db/firebase';

export interface TemplateManagerTabProps {
  templates: MaintenanceTemplate[];
  selectedTemplate: MaintenanceTemplate | null;
  onSelectTemplate: (template: MaintenanceTemplate | null) => void;
  onTemplateUpdated: (updatedTemplate: MaintenanceTemplate) => void;
  onOpenAddModal: () => void;
  onOpenPdfMapper: () => void;
  onRequestDeleteTemplate: (templateId: string) => void;
  managements: Management[];
  existingSectors: string[];
  currentUserLabel: string;
}

export default function TemplateManagerTab({
  templates,
  selectedTemplate,
  onSelectTemplate,
  onTemplateUpdated,
  onOpenAddModal,
  onOpenPdfMapper,
  onRequestDeleteTemplate,
  managements,
  existingSectors,
  currentUserLabel
}: TemplateManagerTabProps) {
  const [templateFilter, setTemplateFilter] = useState<'all' | 'preventive' | 'survey'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileActiveView, setMobileActiveView] = useState<'list' | 'detail'>('list');
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [newCustomTaskText, setNewCustomTaskText] = useState('');

  // Inline editing states
  const [isEditingTargetSector, setIsEditingTargetSector] = useState(false);
  const [editingTargetSectorValue, setEditingTargetSectorValue] = useState('');
  const [isEditingPeriodicity, setIsEditingPeriodicity] = useState(false);
  const [editingPeriodicityValue, setEditingPeriodicityValue] = useState('');

  // PDF direct upload file ref
  const directPdfInputRef = useRef<HTMLInputElement>(null);

  const managementsList = useMemo(() => {
    if (managements.length > 0) {
      return managements.filter(m => m.name !== 'Todas').map(m => m.name);
    }
    return existingSectors;
  }, [managements, existingSectors]);

  // Filter templates based on type and search query
  const filteredTemplates = useMemo(() => {
    return templates.filter((template) => {
      if (templateFilter !== 'all' && template.type !== templateFilter) {
        return false;
      }
      if (searchQuery.trim() !== '') {
        const query = searchQuery.toLowerCase();
        const matchesName = template.name.toLowerCase().includes(query);
        const matchesSector = template.targetSectorOrType.toLowerCase().includes(query);
        const matchesAssetType = template.targetAssetType?.toLowerCase().includes(query) || false;
        return matchesName || matchesSector || matchesAssetType;
      }
      return true;
    });
  }, [templates, templateFilter, searchQuery]);

  // Direct upload/replace PDF file on selected template
  const handleUploadPdfDirectly = (file: File) => {
    if (!selectedTemplate || !file || file.type !== 'application/pdf') {
      alert('Por favor selecione um arquivo válido no formato PDF (.pdf).');
      return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target?.result as string;
      if (base64) {
        const newConfig: PdfTemplateConfig = {
          pdfBase64: base64,
          pdfName: file.name,
          pdfSize: file.size,
          pageCount: 1,
          pins: selectedTemplate.pdfTemplate?.pins || []
        };
        const newVersion = (selectedTemplate.version || 1) + 1;
        const historyEntry: TemplateChangeLog = {
          version: newVersion,
          updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
          changeDescription: `Documento PDF atualizado: ${file.name}.`,
          user: currentUserLabel
        };
        const updatedTemplate: MaintenanceTemplate = {
          ...selectedTemplate,
          version: newVersion,
          pdfTemplate: newConfig,
          history: [historyEntry, ...(selectedTemplate.history || [])]
        };
        await dbSaveTemplate(updatedTemplate);
        onTemplateUpdated(updatedTemplate);
        onOpenPdfMapper();
      }
    };
    reader.readAsDataURL(file);
  };

  // Remove PDF mapping from selected template
  const handleRemovePdfFromSelected = async () => {
    if (!selectedTemplate || !window.confirm('Tem certeza que deseja remover o PDF base e os marcadores de resposta deste modelo?')) return;
    const newVersion = (selectedTemplate.version || 1) + 1;
    const historyEntry: TemplateChangeLog = {
      version: newVersion,
      updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
      changeDescription: 'Documento PDF base e mapeamento de pinça removidos do modelo.',
      user: currentUserLabel
    };

    const updatedTemplate: MaintenanceTemplate = {
      ...selectedTemplate,
      version: newVersion,
      pdfTemplate: undefined,
      history: [historyEntry, ...(selectedTemplate.history || [])]
    };

    await dbSaveTemplate(updatedTemplate);
    onTemplateUpdated(updatedTemplate);
  };

  // Update template target sector
  const handleUpdateTemplateSector = async (newSector: string) => {
    if (!selectedTemplate || !newSector.trim()) return;

    const newVersion = (selectedTemplate.version || 1) + 1;
    const historyEntry: TemplateChangeLog = {
      version: newVersion,
      updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
      changeDescription: `Setor Alvo alterado de "${selectedTemplate.targetSectorOrType}" para "${newSector.trim()}".`,
      user: currentUserLabel
    };

    const updatedTemplate: MaintenanceTemplate = {
      ...selectedTemplate,
      version: newVersion,
      targetSectorOrType: newSector.trim(),
      history: [historyEntry, ...(selectedTemplate.history || [])]
    };

    await dbSaveTemplate(updatedTemplate);
    onTemplateUpdated(updatedTemplate);
    setIsEditingTargetSector(false);
  };

  // Update template periodicity
  const handleUpdateTemplatePeriodicity = async (newPeriodicity: string) => {
    if (!selectedTemplate || !newPeriodicity.trim()) return;

    const newVersion = (selectedTemplate.version || 1) + 1;
    const historyEntry: TemplateChangeLog = {
      version: newVersion,
      updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
      changeDescription: `Periodicidade alterada de "${selectedTemplate.periodicity}" para "${newPeriodicity.trim()}".`,
      user: currentUserLabel
    };

    const updatedTemplate: MaintenanceTemplate = {
      ...selectedTemplate,
      version: newVersion,
      periodicity: newPeriodicity.trim(),
      history: [historyEntry, ...(selectedTemplate.history || [])]
    };

    await dbSaveTemplate(updatedTemplate);
    onTemplateUpdated(updatedTemplate);
    setIsEditingPeriodicity(false);
  };

  // Add individual checklist item
  const handleAddNewItemToSelected = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTemplate || !newCustomTaskText.trim()) return;

    const newItem: ChecklistTemplateItem = {
      id: `ck_item_add_${Date.now()}`,
      task: newCustomTaskText.trim(),
      isActive: true,
      defaultChecked: false,
      observationRequired: false,
      criticality: 'Média',
      autoCreateCorrective: false,
      responseType: 'three_states',
      naObservationRequired: false
    };

    const newVersion = (selectedTemplate.version || 1) + 1;
    const historyEntry: TemplateChangeLog = {
      version: newVersion,
      updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
      changeDescription: `Adicionado item de checklist: "${newCustomTaskText.trim()}".`,
      user: currentUserLabel
    };

    const updatedTemplate: MaintenanceTemplate = {
      ...selectedTemplate,
      version: newVersion,
      checklistItems: [...selectedTemplate.checklistItems, newItem],
      history: [historyEntry, ...(selectedTemplate.history || [])]
    };

    await dbSaveTemplate(updatedTemplate);
    onTemplateUpdated(updatedTemplate);
    setNewCustomTaskText('');
  };

  // Toggle checklist item active state
  const handleToggleItemActive = async (itemId: string) => {
    if (!selectedTemplate) return;

    const updatedChecklist = selectedTemplate.checklistItems.map((item) => {
      if (item.id === itemId) {
        return { ...item, isActive: !item.isActive };
      }
      return item;
    });

    const isCurrentlyActive = selectedTemplate.checklistItems.find(i => i.id === itemId)?.isActive;
    const taskName = selectedTemplate.checklistItems.find(i => i.id === itemId)?.task || '';

    const newVersion = (selectedTemplate.version || 1) + 1;
    const historyEntry: TemplateChangeLog = {
      version: newVersion,
      updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
      changeDescription: `${isCurrentlyActive ? 'Desativado' : 'Ativado'} item de checklist: "${taskName}".`,
      user: currentUserLabel
    };

    const updatedTemplate: MaintenanceTemplate = {
      ...selectedTemplate,
      version: newVersion,
      checklistItems: updatedChecklist,
      history: [historyEntry, ...(selectedTemplate.history || [])]
    };

    await dbSaveTemplate(updatedTemplate);
    onTemplateUpdated(updatedTemplate);
  };

  // Update specific checklist item configuration rules
  const handleUpateItemRules = async (
    itemId: string,
    fields: Partial<Omit<ChecklistTemplateItem, 'id' | 'task'>>
  ) => {
    if (!selectedTemplate) return;

    const updatedChecklist = selectedTemplate.checklistItems.map((item) => {
      if (item.id === itemId) {
        return { ...item, ...fields };
      }
      return item;
    });

    const taskName = selectedTemplate.checklistItems.find(i => i.id === itemId)?.task || '';
    const fieldKeys = Object.keys(fields).join(', ');

    const newVersion = (selectedTemplate.version || 1) + 1;
    const historyEntry: TemplateChangeLog = {
      version: newVersion,
      updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
      changeDescription: `Regra de verificação alterada para o item "${taskName}" (${fieldKeys}).`,
      user: currentUserLabel
    };

    const updatedTemplate: MaintenanceTemplate = {
      ...selectedTemplate,
      version: newVersion,
      checklistItems: updatedChecklist,
      history: [historyEntry, ...(selectedTemplate.history || [])]
    };

    await dbSaveTemplate(updatedTemplate);
    onTemplateUpdated(updatedTemplate);
  };

  // Delete individual checklist item
  const handleDeleteItem = async (itemId: string) => {
    if (!selectedTemplate) return;

    const taskName = selectedTemplate.checklistItems.find(i => i.id === itemId)?.task || '';
    const updatedChecklist = selectedTemplate.checklistItems.filter(item => item.id !== itemId);

    const newVersion = (selectedTemplate.version || 1) + 1;
    const historyEntry: TemplateChangeLog = {
      version: newVersion,
      updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
      changeDescription: `Removido item de checklist: "${taskName}".`,
      user: currentUserLabel
    };

    const updatedTemplate: MaintenanceTemplate = {
      ...selectedTemplate,
      version: newVersion,
      checklistItems: updatedChecklist,
      history: [historyEntry, ...(selectedTemplate.history || [])]
    };

    await dbSaveTemplate(updatedTemplate);
    onTemplateUpdated(updatedTemplate);
  };

  // Move checklist item up or down in order
  const handleMoveItem = async (itemId: string, direction: 'up' | 'down') => {
    if (!selectedTemplate) return;

    const checklist = [...selectedTemplate.checklistItems];
    const index = checklist.findIndex(item => item.id === itemId);
    if (index === -1) return;

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= checklist.length) return;

    // Swap items
    const temp = checklist[index];
    checklist[index] = checklist[targetIndex];
    checklist[targetIndex] = temp;

    const newVersion = (selectedTemplate.version || 1) + 1;
    const historyEntry: TemplateChangeLog = {
      version: newVersion,
      updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
      changeDescription: `Reordenada pergunta: "${temp.task}" para ${direction === 'up' ? 'cima' : 'baixo'}.`,
      user: currentUserLabel
    };

    const updatedTemplate: MaintenanceTemplate = {
      ...selectedTemplate,
      version: newVersion,
      checklistItems: checklist,
      history: [historyEntry, ...(selectedTemplate.history || [])]
    };

    await dbSaveTemplate(updatedTemplate);
    onTemplateUpdated(updatedTemplate);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full items-start">
      {/* LEFT PANELS: Filters and Templates Map */}
      <div className={`lg:col-span-4 space-y-4 ${mobileActiveView === 'list' ? 'block' : 'hidden lg:block'}`}>
        {/* Filter controls */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">
              Filtrar Classificações
            </span>
            <span className="text-[10px] bg-slate-100 py-0.5 px-2 rounded-full font-bold text-slate-600">
              {filteredTemplates.length} Modelos
            </span>
          </div>

          <div className="grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-lg text-[11px] font-extrabold">
            <button
              onClick={() => setTemplateFilter('all')}
              className={`py-1.5 rounded-md transition-all text-center cursor-pointer ${
                templateFilter === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Todos
            </button>
            <button
              onClick={() => setTemplateFilter('preventive')}
              className={`py-1.5 rounded-md transition-all text-center cursor-pointer ${
                templateFilter === 'preventive'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Preventivas
            </button>
            <button
              onClick={() => setTemplateFilter('survey')}
              className={`py-1.5 rounded-md transition-all text-center cursor-pointer ${
                templateFilter === 'survey'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Vistorias
            </button>
          </div>

          {/* Text Search inside side view */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Pesquisar por nome, setor, tipo..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-gray-250 rounded-lg text-xs font-semibold focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Creator button */}
          <button
            onClick={onOpenAddModal}
            className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-black rounded-lg flex items-center justify-center gap-1.5 transition-all shadow-sm cursor-pointer active:scale-95"
          >
            <Plus className="w-4 h-4" />
            Criar Novo Modelo
          </button>
        </div>

        {/* Scrollable checklist items */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-xs">
          <div className="p-4 bg-slate-50 border-b border-gray-100 flex justify-between items-center">
            <span className="text-xs font-black text-slate-700 uppercase tracking-tight flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-slate-500" />
              Modelos Disponíveis
            </span>
          </div>

          <div className="divide-y divide-gray-100 max-h-[500px] overflow-y-auto">
            {filteredTemplates.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                Nenhum modelo cadastrado para este critério de filtro.
              </div>
            ) : (
              filteredTemplates.map((tmp) => {
                const isSelected = selectedTemplate?.id === tmp.id;
                return (
                  <div
                    key={tmp.id}
                    onClick={() => {
                      onSelectTemplate(tmp);
                      setExpandedItemId(null);
                      setMobileActiveView('detail');
                    }}
                    className={`p-4 transition-all duration-150 cursor-pointer text-left ${
                      isSelected ? 'bg-blue-50/40 border-l-4 border-blue-600' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <h3 className="text-xs font-black text-slate-900 leading-snug">{tmp.name}</h3>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span
                          className={`text-[8px] px-1.5 py-0.5 font-bold rounded-full select-none ${
                            tmp.type === 'preventive'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-purple-100 text-purple-700'
                          }`}
                        >
                          {tmp.type === 'preventive' ? 'PREVENTIVA' : 'VISTORIA'}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRequestDeleteTemplate(tmp.id);
                          }}
                          className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                          title="Excluir este modelo"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mt-2 text-[10px] text-slate-500 font-bold flex-wrap">
                      <span className="bg-slate-100 py-0.5 px-1.5 rounded text-slate-700">
                        {tmp.targetSectorOrType}
                      </span>

                      {tmp.targetAssetType && (
                        <span className="bg-indigo-50 text-[#3525cd] py-0.5 px-1.5 rounded font-black">
                          Tipo: {tmp.targetAssetType}
                        </span>
                      )}

                      <span className="flex items-center gap-0.5 text-slate-600">
                        <Clock className="w-3 h-3" />
                        {tmp.periodicity}
                      </span>

                      <span className="text-blue-600">
                        • {tmp.checklistItems.length} Itens
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* RIGHT PANELS: Visual builder with advanced forms config */}
      <div className={`lg:col-span-8 ${mobileActiveView === 'detail' ? 'block' : 'hidden lg:block'}`}>
        {selectedTemplate ? (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm flex flex-col">
            {/* Visual Metadata Overview */}
            <div className="p-6 bg-slate-50/70 border-b border-gray-100 space-y-4">
              {/* MOBILE BACK BUTTON */}
              <div className="lg:hidden">
                <button
                  type="button"
                  onClick={() => setMobileActiveView('list')}
                  className="inline-flex items-center gap-2 text-xs font-black text-blue-700 bg-blue-100/60 hover:bg-blue-100 border border-blue-200/50 py-2 px-3.5 rounded-xl transition-all active:scale-95 cursor-pointer shadow-2xs"
                >
                  <ArrowLeft className="w-4 h-4 text-blue-600 shrink-0" />
                  Voltar para lista de modelos
                </button>
              </div>

              <div className="flex justify-between items-start gap-4">
                <div className="space-y-1">
                  <h2 className="text-xl font-black text-[#0b1c30] tracking-tight">
                    {selectedTemplate.name}
                  </h2>
                </div>

                <button
                  onClick={() => onRequestDeleteTemplate(selectedTemplate.id)}
                  className="p-2 text-rose-600 hover:bg-rose-50 text-xs font-black rounded-lg border border-rose-200 transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                  Apagar Modelo
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                <div className="p-3 bg-white rounded-xl border border-gray-200">
                  <span className="text-[9px] font-extrabold text-slate-400 uppercase block">Categoria</span>
                  <span className="text-xs font-black text-slate-800">
                    {selectedTemplate.type === 'preventive' ? 'Manutenção Preventiva' : 'Vistoria Sem Ativo'}
                  </span>
                </div>

                <div className="p-3 bg-white rounded-xl border border-gray-200 transition-all hover:bg-slate-50/50 relative group">
                  <div className="flex justify-between items-start">
                    <span className="text-[9px] font-extrabold text-slate-400 uppercase block mb-1">Setor Alvo</span>
                    {!isEditingTargetSector && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsEditingTargetSector(true);
                          setEditingTargetSectorValue(selectedTemplate.targetSectorOrType);
                        }}
                        className="text-indigo-600 hover:text-indigo-800 text-[10px] font-bold flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity cursor-pointer"
                      >
                        <Edit2 className="w-3 h-3" />
                        Editar
                      </button>
                    )}
                  </div>

                  {isEditingTargetSector ? (
                    <div className="mt-1 space-y-2">
                      <select
                        value={editingTargetSectorValue}
                        onChange={(e) => setEditingTargetSectorValue(e.target.value)}
                        className="w-full text-xs py-1.5 px-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none font-bold text-slate-800 cursor-pointer"
                      >
                        <option value="">Selecione a Gerência/Setor...</option>
                        {managementsList.map((sector) => (
                          <option key={sector} value={sector}>
                            {sector}
                          </option>
                        ))}
                        {!managementsList.includes(selectedTemplate.targetSectorOrType) && selectedTemplate.targetSectorOrType && (
                          <option value={selectedTemplate.targetSectorOrType}>
                            {selectedTemplate.targetSectorOrType} (Atual)
                          </option>
                        )}
                      </select>

                      {/* Text input to allow other custom names */}
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={editingTargetSectorValue}
                          onChange={(e) => setEditingTargetSectorValue(e.target.value)}
                          placeholder="Nome de outro setor..."
                          className="w-full text-[10px] py-1 px-1.5 bg-slate-50 border border-gray-200 rounded-lg text-slate-800 uppercase font-bold"
                        />
                      </div>

                      <div className="flex items-center gap-1.5 mt-1.5">
                        <button
                          type="button"
                          onClick={() => handleUpdateTemplateSector(editingTargetSectorValue)}
                          className="text-[10px] font-black text-white bg-emerald-600 hover:bg-emerald-700 py-1 px-2.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                        >
                          <Check className="w-3 h-3" />
                          Salvar
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsEditingTargetSector(false)}
                          className="text-[10px] font-black text-slate-500 hover:bg-slate-100 py-1 px-2 rounded-lg transition-all cursor-pointer"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <span className="text-xs font-black text-slate-800 uppercase tracking-wide">
                        {selectedTemplate.targetSectorOrType}
                      </span>
                      {selectedTemplate.type === 'survey' && (
                        <span className="text-[8px] text-slate-450 block leading-tight font-medium">
                          Vistoria sem vínculo. Altere o Setor Alvo para encaminhar para outra gerência.
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {selectedTemplate.type === 'preventive' && (
                  <div className="p-3 bg-white rounded-xl border border-gray-200">
                    <span className="text-[9px] font-extrabold text-slate-400 uppercase block">Vínculo Dinâmico (TIPO)</span>
                    <span className="text-xs font-black text-[#3525cd] flex items-center gap-1">
                      {selectedTemplate.targetAssetType ? (
                        <>
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                          {selectedTemplate.targetAssetType}
                        </>
                      ) : (
                        <span className="text-amber-600 font-extrabold flex items-center gap-1">
                          <Info className="w-3.5 h-3.5" />
                          Por Setor
                        </span>
                      )}
                    </span>
                  </div>
                )}

                <div className="p-3 bg-white rounded-xl border border-gray-200 transition-all hover:bg-slate-50/50 relative group">
                  <div className="flex justify-between items-start">
                    <span className="text-[9px] font-extrabold text-slate-400 uppercase block mb-1">Periodicidade Agendada</span>
                    {!isEditingPeriodicity && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsEditingPeriodicity(true);
                          setEditingPeriodicityValue(selectedTemplate.periodicity);
                        }}
                        className="text-indigo-600 hover:text-indigo-800 text-[10px] font-bold flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity cursor-pointer"
                      >
                        <Edit2 className="w-3 h-3" />
                        Editar
                      </button>
                    )}
                  </div>

                  {isEditingPeriodicity ? (
                    <div className="mt-1 space-y-2">
                      {/* Option Checkboxes */}
                      <div className="flex flex-wrap gap-2.5 p-2 bg-slate-50 rounded-lg border border-slate-150">
                        {['Semanal', 'Mensal', 'Semestral', 'Anual'].map((p) => {
                          const currentSelectedList = editingPeriodicityValue.split(',').map(x => x.trim()).filter(Boolean);
                          const isChecked = currentSelectedList.includes(p);
                          return (
                            <label key={p} className="flex items-center gap-1.5 text-[10.5px] font-bold text-slate-700 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  let newList;
                                  if (isChecked) {
                                    newList = currentSelectedList.filter(x => x !== p);
                                  } else {
                                    newList = [...currentSelectedList, p];
                                  }
                                  const order = ['Semanal', 'Mensal', 'Semestral', 'Anual'];
                                  newList.sort((a, b) => order.indexOf(a) - order.indexOf(b));
                                  setEditingPeriodicityValue(newList.join(', '));
                                }}
                                className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                              />
                              {p}
                            </label>
                          );
                        })}
                      </div>

                      {/* Manual Input Override */}
                      <div className="space-y-1">
                        <span className="text-[8px] font-extrabold text-slate-400 uppercase block">Edição Direta/Customizada</span>
                        <input
                          type="text"
                          value={editingPeriodicityValue}
                          onChange={(e) => setEditingPeriodicityValue(e.target.value)}
                          placeholder="Outra periodicidade (ex: Trimestral, Bimensal)..."
                          className="w-full text-[10px] py-1 px-1.5 bg-slate-50 border border-gray-250 rounded-lg text-slate-800 font-bold"
                        />
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center gap-1.5 mt-1">
                        <button
                          type="button"
                          onClick={() => handleUpdateTemplatePeriodicity(editingPeriodicityValue)}
                          className="text-[10px] font-black text-white bg-emerald-600 hover:bg-emerald-700 py-1 px-2.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                        >
                          <Check className="w-3 h-3" />
                          Salvar
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsEditingPeriodicity(false)}
                          className="text-[10px] font-black text-slate-500 hover:bg-slate-100 py-1 px-2 rounded-lg transition-all cursor-pointer"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <span className="text-xs font-black text-slate-800">
                        {selectedTemplate.periodicity}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Sub-view: Official PDF Document & Pin Mapping Section */}
            <div className="px-6 pt-6 pb-2">
              <input
                ref={directPdfInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUploadPdfDirectly(file);
                  e.target.value = '';
                }}
              />

              <div className="bg-slate-900 border border-slate-800/90 rounded-2xl p-5 text-white shadow-xl shadow-slate-950/20">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
                  {/* Left info column */}
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-12 h-12 bg-blue-500/10 border border-blue-400/20 text-blue-400 rounded-2xl flex items-center justify-center shrink-0 shadow-inner">
                      <FileCheck className="w-6 h-6" />
                    </div>

                    <div className="space-y-1.5 min-w-0 text-left">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <h3 className="text-xs font-black uppercase tracking-wider text-slate-100">
                          Documento PDF Oficial & Mapeamento de Respostas
                        </h3>
                        {selectedTemplate.pdfTemplate?.pdfBase64 ? (
                          <span className="inline-flex items-center gap-1.5 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                            PDF Vinculado
                          </span>
                        ) : (
                          <span className="text-[10px] bg-slate-800 text-slate-400 px-2.5 py-0.5 rounded-full font-bold border border-slate-700">
                            Sem PDF Base
                          </span>
                        )}
                      </div>

                      <div className="text-[11px] text-slate-300 flex flex-wrap items-center gap-2">
                        {selectedTemplate.pdfTemplate?.pdfBase64 ? (
                          <>
                            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold text-slate-200 bg-slate-800/90 px-2.5 py-0.5 rounded-md border border-slate-700 truncate max-w-[280px]">
                              <FileText className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                              <span className="truncate">{selectedTemplate.pdfTemplate.pdfName || 'Modelo_Oficial.pdf'}</span>
                            </span>
                            <span className="text-slate-400">•</span>
                            <span className="text-blue-300 font-bold">
                              {selectedTemplate.pdfTemplate.pins?.length || 0} {selectedTemplate.pdfTemplate.pins?.length === 1 ? 'área mapeada' : 'áreas mapeadas'}
                            </span>
                          </>
                        ) : (
                          <span className="text-slate-400 leading-relaxed">
                            Importe o formulário ou laudo em PDF para desenhar as caixas onde as respostas serão impressas.
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right action button bar with uniform height and spacing */}
                  <div className="flex items-center gap-2.5 shrink-0 self-start lg:self-center">
                    {selectedTemplate.pdfTemplate?.pdfBase64 ? (
                      <>
                        {/* Primary Button */}
                        <button
                          type="button"
                          onClick={onOpenPdfMapper}
                          className="h-10 px-4 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-black text-xs rounded-xl flex items-center gap-2 shadow-md shadow-blue-600/30 transition-all cursor-pointer whitespace-nowrap"
                        >
                          <Crosshair className="w-4 h-4 text-blue-200" />
                          <span>Mapear Áreas no PDF</span>
                        </button>

                        {/* Secondary Button */}
                        <button
                          type="button"
                          onClick={() => directPdfInputRef.current?.click()}
                          className="h-10 px-3.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 hover:text-white border border-slate-700 font-bold text-xs rounded-xl flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap"
                          title="Substituir arquivo PDF deste modelo"
                        >
                          <Upload className="w-3.5 h-3.5 text-slate-400" />
                          <span>Trocar PDF</span>
                        </button>

                        {/* Delete Button */}
                        <button
                          type="button"
                          onClick={handleRemovePdfFromSelected}
                          className="h-10 w-10 flex items-center justify-center bg-slate-800/80 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border border-slate-700 hover:border-rose-500/40 rounded-xl transition-all cursor-pointer shrink-0 active:scale-95"
                          title="Remover PDF deste modelo"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => directPdfInputRef.current?.click()}
                        className="h-10 px-5 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-black text-xs rounded-xl flex items-center gap-2 shadow-lg shadow-blue-600/30 transition-all cursor-pointer whitespace-nowrap"
                      >
                        <Upload className="w-4 h-4" />
                        <span>Importar PDF & Mapear Áreas</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Sub-view: Questionnaire List Configuration */}
            <div className="p-6 space-y-6">
              {/* Section Title */}
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-xs font-black text-[#0b1c30] uppercase tracking-wider">
                    Perguntas & Regras de Não Conformidade
                  </h3>
                  <p className="text-[10px] text-slate-500">
                    Configure pesos, criticidade, requisitos de preenchimento e abertura imediata de corretivas.
                  </p>
                </div>
                <span className="text-xs font-extrabold text-slate-500">
                  Total: {selectedTemplate.checklistItems.length} Itens
                </span>
              </div>

              {/* Checklist Items Interactive Accordions */}
              <div className="space-y-3">
                {selectedTemplate.checklistItems.length === 0 ? (
                  <div className="p-12 text-center text-xs text-slate-400 border border-dashed rounded-xl">
                    Ainda não há perguntas cadastradas neste modelo de checklist. Adicione uma no formulário abaixo!
                  </div>
                ) : (
                  selectedTemplate.checklistItems.map((item, index) => {
                    const isExpanded = expandedItemId === item.id;
                    return (
                      <div
                        key={item.id}
                        className={`border rounded-xl transition-all ${
                          item.isActive
                            ? 'bg-white border-gray-200 shadow-xs'
                            : 'bg-slate-50/70 border-dashed border-slate-200 opacity-60'
                        }`}
                      >
                        {/* Header Slot */}
                        <div className="p-4 flex items-center justify-between gap-4">
                          <div className="flex items-start gap-3 min-w-0 flex-1">
                            <button
                              type="button"
                              onClick={() => handleToggleItemActive(item.id)}
                              className="mt-1 flex-shrink-0"
                            >
                              {item.isActive ? (
                                <ToggleLeft className="w-7 h-7 text-emerald-600 cursor-pointer" />
                              ) : (
                                <ToggleRight className="w-7 h-7 text-slate-400 cursor-pointer" />
                              )}
                            </button>

                            <div className="min-w-0">
                              <p
                                className={`text-xs font-bold ${
                                  item.isActive ? 'text-slate-900' : 'text-slate-400 line-through'
                                }`}
                              >
                                {item.task}
                              </p>

                              {/* Badges indicators */}
                              <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[9px] font-black">
                                {/* Tipo de resposta badge */}
                                <span
                                  className={`px-2 py-0.5 rounded-full ${
                                    (item.responseType || 'three_states') === 'three_states'
                                      ? 'bg-indigo-50 text-[#3525cd] border border-indigo-100'
                                      : item.responseType === 'text'
                                      ? 'bg-indigo-100 text-indigo-700'
                                      : item.responseType === 'number'
                                      ? 'bg-cyan-50 text-cyan-700'
                                      : item.responseType === 'boolean'
                                      ? 'bg-teal-50 text-teal-700'
                                      : 'bg-slate-150 text-slate-700'
                                  }`}
                                >
                                  Resposta:{' '}
                                  {(item.responseType || 'three_states') === 'three_states'
                                    ? 'Check (Atestado/Não Atestado/N.A.)'
                                    : item.responseType === 'text'
                                    ? 'Texto Livre'
                                    : item.responseType === 'number'
                                    ? 'Número'
                                    : item.responseType === 'boolean'
                                    ? 'Sim/Não'
                                    : 'Data'}
                                </span>

                                {item.observationRequired && (
                                  <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                                    Observação Obrigatória
                                  </span>
                                )}

                                {item.autoCreateCorrective && (
                                  <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-600 border border-rose-100 uppercase tracking-widest text-[8px]">
                                    Solicitação de Corretiva Aut.
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {/* Order buttons (Up and Down) */}
                            <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg p-0.5 divide-x divide-slate-150 shrink-0 shadow-3xs">
                              <button
                                type="button"
                                onClick={() => handleMoveItem(item.id, 'up')}
                                disabled={index === 0}
                                className={`p-1 transition-all rounded-l ${
                                  index === 0
                                    ? 'text-slate-200 cursor-not-allowed bg-slate-50'
                                    : 'text-slate-600 hover:text-[#3525cd] hover:bg-white active:scale-90 cursor-pointer'
                                }`}
                                title="Mover Pergunta para Cima"
                              >
                                <ArrowUp className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleMoveItem(item.id, 'down')}
                                disabled={index === selectedTemplate.checklistItems.length - 1}
                                className={`p-1 transition-all rounded-r ${
                                  index === selectedTemplate.checklistItems.length - 1
                                    ? 'text-slate-200 cursor-not-allowed bg-slate-50'
                                    : 'text-slate-600 hover:text-[#3525cd] hover:bg-white active:scale-90 cursor-pointer'
                                }`}
                                title="Mover Pergunta para Baixo"
                              >
                                <ArrowDown className="w-3 h-3" />
                              </button>
                            </div>

                            <button
                              type="button"
                              onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                              className="p-1 px-2.5 rounded hover:bg-slate-100 text-[10px] text-blue-600 font-bold flex items-center gap-1 cursor-pointer"
                            >
                              {isExpanded ? (
                                <>
                                  Fechar <ChevronUp className="w-3.5 h-3.5" />
                                </>
                              ) : (
                                <>
                                  Regras <ChevronDown className="w-3.5 h-3.5" />
                                </>
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDeleteItem(item.id)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-all cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Expanded parameters form */}
                        {isExpanded && (
                          <div className="px-4 pb-4 border-t border-slate-100 bg-slate-50/50 p-4 rounded-b-xl space-y-4 text-xs">
                            {/* Custom Response Types Setting */}
                            <div className="space-y-1.5 pt-1">
                              <label className="block text-[10px] font-extrabold text-slate-500 uppercase">
                                Tipo de Resposta do Checklist / Pergunta
                              </label>
                              <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 bg-white p-1.5 rounded-lg border border-gray-200">
                                {[
                                  { val: 'three_states', label: 'Check (Atestado/Não/N.A.)', desc: 'Atestado, Não Atestado ou Não se Aplica' },
                                  { val: 'text', label: 'Texto Livre', desc: 'Campo de texto descritivo de campo' },
                                  { val: 'number', label: 'Número', desc: 'Valor para medições numéricas' },
                                  { val: 'boolean', label: 'Sim ou Não', desc: 'Alternância simples Sim/Não' },
                                  { val: 'date', label: 'Data', desc: 'Input formatado para data técnica' }
                                ].map((opt) => {
                                  const activeVal = item.responseType || 'three_states';
                                  const isSel = activeVal === opt.val;
                                  return (
                                    <button
                                      key={opt.val}
                                      type="button"
                                      onClick={() => handleUpateItemRules(item.id, { responseType: opt.val as any })}
                                      className={`py-2 px-1 rounded text-[10px] font-bold text-center transition-all border flex flex-col items-center justify-center cursor-pointer ${
                                        isSel
                                          ? 'bg-[#3525cd] text-white border-[#3525cd] shadow-xs'
                                          : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border-gray-200 hover:text-slate-950'
                                      }`}
                                      title={opt.desc}
                                    >
                                      {opt.label}
                                    </button>
                                  );
                                })}
                              </div>
                              {(item.responseType || 'three_states') === 'three_states' ? (
                                <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg text-[10px] font-medium leading-normal flex items-start gap-1.5 shadow-3xs mt-1">
                                  <span className="text-[12px] leading-none shrink-0">💡</span>
                                  <span>
                                    <strong>Regra Técnica Base:</strong> Ao selecionar a opção <strong>"Check"</strong>, se o técnico marcar <strong>"Não Atestado"</strong> em campo, o sistema exigirá <strong>obrigatoriamente</strong> um <strong>motivo</strong> descritivo antes de salvar.
                                  </span>
                                </div>
                              ) : (
                                <span className="text-[9px] text-slate-400 block mt-1">
                                  Determina qual componente de entrada será fornecido na vistoria do técnico de campo.
                                </span>
                              )}
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                              <div className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-gray-200">
                                <div>
                                  <span className="font-bold block text-[10.5px] text-slate-800">Observação Obrigatória</span>
                                  <span className="text-[9px] text-slate-400">Exigir preenchimento descritivo</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleUpateItemRules(item.id, { observationRequired: !item.observationRequired })}
                                  className={`px-2.5 py-1 rounded text-[10px] font-black cursor-pointer ${
                                    item.observationRequired ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-600'
                                  }`}
                                >
                                  {item.observationRequired ? 'SIM' : 'NÃO'}
                                </button>
                              </div>

                              <div className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-gray-200">
                                <div>
                                  <span className="font-bold block text-[10.5px] text-slate-800">Solicitação de Corretiva Aut.</span>
                                  <span className="text-[9px] text-slate-400">Gera OS corretivo imediato</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleUpateItemRules(item.id, { autoCreateCorrective: !item.autoCreateCorrective })}
                                  className={`px-2.5 py-1 rounded text-[10px] font-black cursor-pointer ${
                                    item.autoCreateCorrective ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-600'
                                  }`}
                                >
                                  {item.autoCreateCorrective ? 'ATIVO' : 'DESL.'}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Add New Check Item inline form */}
              <form onSubmit={handleAddNewItemToSelected} className="flex gap-2 pt-2 border-t border-slate-100">
                <input
                  type="text"
                  required
                  placeholder="Adicionar nova pergunta padrão de controle de qualidade física..."
                  value={newCustomTaskText}
                  onChange={(e) => setNewCustomTaskText(e.target.value)}
                  className="flex-1 text-xs py-2.5 px-4 bg-slate-50 border border-slate-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-white transition-all font-semibold"
                />
                <button
                  type="submit"
                  className="px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl flex items-center justify-center cursor-pointer transition-all active:scale-95 text-xs font-black gap-1.5 shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  Inserir Item
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 p-16 text-center text-slate-400 flex flex-col items-center justify-center min-h-[450px]">
            <Settings className="w-12 h-12 text-slate-300 mb-3 animate-pulse" />
            <p className="text-xs font-bold text-slate-600">Nenhum Modelo Operacional Selecionado</p>
            <p className="text-[10px] text-slate-400 max-w-sm mt-1 leading-normal">
              Selecione um dos checklists da lista à esquerda ou clique no botão azul para configurar uma nova ementa de preventiva do zero.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
