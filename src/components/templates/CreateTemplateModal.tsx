// CreateTemplateModal.tsx - Modal for creating a new Checklist / Preventive Template
import React, { useState } from 'react';
import { PlusCircle, Plus, FileText, Upload } from 'lucide-react';
import { MaintenanceTemplate, ChecklistTemplateItem, TemplateChangeLog, Asset, Management } from '../../types';
import { dbSaveTemplate } from '../../db/firebase';

interface CreateTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (template: MaintenanceTemplate) => void;
  existingAssetTypes: string[];
  existingComarcas: string[];
  assets: Asset[];
  managements: Management[];
  currentUserLabel: string;
}

export default function CreateTemplateModal({
  isOpen,
  onClose,
  onCreated,
  existingAssetTypes,
  existingComarcas,
  assets,
  managements,
  currentUserLabel
}: CreateTemplateModalProps) {
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateType, setNewTemplateType] = useState<'preventive' | 'survey'>('preventive');
  const [newTemplateTargetSector, setNewTemplateTargetSector] = useState('Refrigeração');
  const [newTemplateAssetType, setNewTemplateAssetType] = useState(() => existingAssetTypes[0] || '');
  const [newTemplatePeriodicities, setNewTemplatePeriodicities] = useState<string[]>(['Mensal']);
  const [newTemplateInitialTasks, setNewTemplateInitialTasks] = useState('');
  const [newTemplatePdfBase64, setNewTemplatePdfBase64] = useState<string | undefined>(undefined);
  const [newTemplatePdfName, setNewTemplatePdfName] = useState<string | undefined>(undefined);
  const [newTemplatePdfSize, setNewTemplatePdfSize] = useState<number | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  // Gerências disponíveis para a vistoria sem ativo (padrão: DOM, responsável pelas rondas)
  const surveyManagementOptions = managements.filter(m => m.name !== 'Todas').map(m => m.name);
  const defaultSurveyManagement =
    surveyManagementOptions.find(name => name.trim().toUpperCase() === 'DOM') || surveyManagementOptions[0] || 'DOM';

  const handleAssetTypeChange = (type: string) => {
    setNewTemplateAssetType(type);
    if (type) {
      const matchedAsset = assets.find(a => {
        const t = a.specs?.TIPO || a.specs?.tipo;
        return t && typeof t === 'string' && t.trim().toLowerCase() === type.trim().toLowerCase();
      });
      if (matchedAsset && matchedAsset.sector) {
        setNewTemplateTargetSector(matchedAsset.sector);
      } else {
        const activeMgmts = managements.filter(m => m.name !== 'Todas');
        setNewTemplateTargetSector(activeMgmts[0]?.name || 'Refrigeração');
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTemplateName.trim()) return;

    setIsSubmitting(true);
    try {
      const tasksArray = newTemplateInitialTasks
        .split('\n')
        .map(t => t.trim())
        .filter(Boolean);

      const initialChecklistItems: ChecklistTemplateItem[] = tasksArray.map((task, idx) => ({
        id: `ck_init_${Date.now()}_${idx}`,
        task,
        isActive: true,
        defaultChecked: false,
        observationRequired: false,
        criticality: 'Média',
        autoCreateCorrective: false
      }));

      const initialHistory: TemplateChangeLog[] = [{
        version: 1,
        updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
        changeDescription: 'Criação inicial do modelo de checklist.',
        user: currentUserLabel
      }];

      const newTemplate: MaintenanceTemplate = {
        id: `tmp_${newTemplateType === 'preventive' ? 'p' : 's'}_${Date.now().toString().slice(-4)}`,
        name: newTemplateName.trim(),
        type: newTemplateType,
        targetSectorOrType: newTemplateTargetSector.trim(),
        targetAssetType: newTemplateType === 'preventive' ? (newTemplateAssetType.trim() ? newTemplateAssetType.trim() : undefined) : undefined,
        periodicity: newTemplateType === 'preventive' 
          ? (newTemplatePeriodicities.length > 0 ? newTemplatePeriodicities.join(', ') : 'Mensal')
          : 'Semanal',
        checklistItems: initialChecklistItems,
        createdAt: new Date().toISOString(),
        version: 1,
        history: initialHistory,
        pdfTemplate: newTemplatePdfBase64 ? {
          pdfBase64: newTemplatePdfBase64,
          pdfName: newTemplatePdfName,
          pdfSize: newTemplatePdfSize,
          pageCount: 1,
          pins: []
        } : undefined
      };

      await dbSaveTemplate(newTemplate);
      onCreated(newTemplate);
      onClose();
    } catch (err) {
      console.error('Erro ao criar modelo:', err);
      alert('Ocorreu um erro ao salvar o novo modelo. Tente novamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-lg max-h-[90vh] overflow-y-auto flex flex-col animate-in zoom-in-95 duration-150">
        <div className="p-6 bg-[#0b1c30] text-white flex justify-between items-center shrink-0">
          <div>
            <h3 className="font-extrabold text-sm tracking-tight flex items-center gap-1.5">
              <PlusCircle className="w-5 h-5 text-blue-400" />
              Cadastrar Novo Modelo de Checklist
            </h3>
            <p className="text-[10px] text-slate-300 mt-0.5">Defina as parametrizações básicas e perguntas iniciais.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-white hover:opacity-80 p-1 bg-white/10 rounded-full transition-all cursor-pointer"
          >
            <Plus className="w-5 h-5 rotate-45" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-left">
          <div>
            <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">
              Nome do modelo descritivo*
            </label>
            <input
              type="text"
              required
              placeholder="Ex: Preventiva Trimestral - Geradores de Energia"
              value={newTemplateName}
              onChange={(e) => setNewTemplateName(e.target.value)}
              className="w-full text-xs py-2.5 px-3.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 font-semibold"
            />
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">
                Tipo de Fluxo*
              </label>
              <select
                value={newTemplateType}
                onChange={(e) => {
                  const type = e.target.value as 'preventive' | 'survey';
                  setNewTemplateType(type);
                  if (type === 'preventive') {
                    const firstType = existingAssetTypes[0] || '';
                    setNewTemplateAssetType(firstType);
                    if (firstType) {
                      const matchedAsset = assets.find(a => {
                        const t = a.specs?.TIPO || a.specs?.tipo;
                        return t && typeof t === 'string' && t.trim().toLowerCase() === firstType.trim().toLowerCase();
                      });
                      if (matchedAsset && matchedAsset.sector) {
                        setNewTemplateTargetSector(matchedAsset.sector);
                      } else {
                        const activeMgmts = managements.filter(m => m.name !== 'Todas');
                        setNewTemplateTargetSector(activeMgmts[0]?.name || 'Refrigeração');
                      }
                    } else {
                      const activeMgmts = managements.filter(m => m.name !== 'Todas');
                      setNewTemplateTargetSector(activeMgmts[0]?.name || 'Refrigeração');
                    }
                    setNewTemplatePeriodicities(['Mensal']);
                  } else {
                    setNewTemplateTargetSector(defaultSurveyManagement);
                    setNewTemplateAssetType('');
                    setNewTemplatePeriodicities(['Semanal']);
                  }
                }}
                className="w-full text-xs py-2 px-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none font-bold animate-transition"
              >
                <option value="preventive">Preventiva (Vinculada a Ativo)</option>
                <option value="survey">Vistoria (Sem Ativo / Independente)</option>
              </select>
            </div>

            {newTemplateType === 'preventive' ? (
              <>
                {/* PERIODICITIES SELECTION */}
                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-2">
                    Periodicidade(s) do Checklist (Selecione uma ou mais)*
                  </label>
                  <div className="flex flex-wrap gap-4 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    {['Mensal', 'Semestral', 'Anual'].map((p) => {
                      const isChecked = newTemplatePeriodicities.includes(p);
                      return (
                        <label key={p} className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              if (isChecked) {
                                if (newTemplatePeriodicities.length > 1) {
                                  setNewTemplatePeriodicities(newTemplatePeriodicities.filter(item => item !== p));
                                }
                              } else {
                                setNewTemplatePeriodicities([...newTemplatePeriodicities, p]);
                              }
                            }}
                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          />
                          {p}
                        </label>
                      );
                    })}
                  </div>
                  <span className="text-[8px] text-slate-400 mt-1 block">O checklist será instanciado na fila pelas preventivas ativadas.</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* LINKED ASSET TYPE SELECTOR */}
                  <div>
                    <label className="block text-[10px] font-extrabold text-[#3525cd] uppercase mb-1">
                      Vincular por TIPO (Ativos no Banco)*
                    </label>
                    <select
                      value={newTemplateAssetType}
                      onChange={(e) => handleAssetTypeChange(e.target.value)}
                      required
                      className="w-full text-xs py-2 px-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none font-bold"
                    >
                      <option value="">Selecione um Tipo do banco...</option>
                      {existingAssetTypes.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                    <span className="text-[8px] text-slate-400 mt-1 block">Filtra ativos que contenham esta palavra na especificação TIPO.</span>
                  </div>

                  {/* AUTO-FILLED TARGET SECTOR DISPLAY */}
                  <div>
                    <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">
                      Setor do Ativo (Preenchido Automaticamente)*
                    </label>
                    <input
                      type="text"
                      readOnly
                      disabled
                      value={newTemplateTargetSector}
                      className="w-full text-xs py-2 px-3 bg-slate-100 border border-slate-200 rounded-lg focus:outline-none font-bold text-slate-500 cursor-not-allowed"
                    />
                    <span className="text-[8px] text-slate-400 mt-1 block">Herdado diretamente do cadastro do ativo no banco.</span>
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* TARGET SURVEY WORKSPACE LOCATION */}
                <div>
                  <label className="block text-[10px] font-extrabold text-[#3525cd] uppercase mb-1">
                    Área / Local Principal da Vistoria (Comarcas)*
                  </label>
                  <input
                    type="text"
                    readOnly
                    disabled
                    value="Todas as Comarcas (Automático)"
                    className="w-full text-xs py-2 px-3 bg-slate-100 border border-slate-200 rounded-lg focus:outline-none font-bold text-slate-500 cursor-not-allowed"
                  />
                  <span className="text-[10px] text-slate-500 mt-2 block leading-relaxed">
                    A vistoria semanal será gerada em lote para todas as comarcas cadastradas no banco de dados de ativos:
                    <span className="flex flex-wrap gap-1.5 mt-1.5">
                      {existingComarcas.map((comarca) => (
                        <span key={comarca} className="px-2 py-0.5 bg-blue-50 border border-blue-100 rounded-md font-bold text-[9px] text-blue-700 uppercase">
                          {comarca}
                        </span>
                      ))}
                    </span>
                  </span>
                </div>

                {/* GERÊNCIA RESPONSÁVEL PELAS ORDENS DA VISTORIA */}
                <div>
                  <label className="block text-[10px] font-extrabold text-[#3525cd] uppercase mb-1">
                    Gerência Responsável*
                  </label>
                  <select
                    value={newTemplateTargetSector}
                    onChange={(e) => setNewTemplateTargetSector(e.target.value)}
                    required
                    className="w-full text-xs py-2 px-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none font-bold"
                  >
                    {!surveyManagementOptions.includes(newTemplateTargetSector) && (
                      <option value={newTemplateTargetSector}>{newTemplateTargetSector}</option>
                    )}
                    {surveyManagementOptions.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <span className="text-[8px] text-slate-400 mt-1 block">As ordens desta vistoria aparecem para o encarregado desta gerência.</span>
                </div>

                <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-lg flex items-center gap-2 text-[11px] font-medium text-emerald-800">
                  <span className="font-extrabold uppercase text-xs text-emerald-600">Frequência Semanal</span>
                  <span>• Todas as vistorias independentes sem ativos vinculados são semanais por padrão.</span>
                </div>
              </>
            )}
          </div>

          {/* IMPORT PDF FOR PREVENTIVE TEMPLATE */}
          <div>
            <label className="block text-[10px] font-extrabold text-[#3525cd] uppercase mb-1">
              Importar Documento PDF Oficial (Opcional)
            </label>
            <div className="border border-dashed border-slate-300 rounded-xl p-3 bg-slate-50 hover:bg-slate-100/70 transition-colors">
              {newTemplatePdfName ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                    <FileText className="w-4 h-4 text-blue-600 shrink-0" />
                    <span className="truncate max-w-[240px] font-mono">{newTemplatePdfName}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setNewTemplatePdfBase64(undefined);
                      setNewTemplatePdfName(undefined);
                      setNewTemplatePdfSize(undefined);
                    }}
                    className="text-[10px] font-bold text-rose-600 hover:text-rose-700 cursor-pointer"
                  >
                    Remover
                  </button>
                </div>
              ) : (
                <label className="flex items-center justify-center gap-2 text-xs font-bold text-slate-600 cursor-pointer py-1.5">
                  <Upload className="w-4 h-4 text-blue-600" />
                  <span>Selecionar PDF Base para Mapeamento de Respostas (.pdf)</span>
                  <input
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f && f.type === 'application/pdf') {
                        if (f.size > 3 * 1024 * 1024) {
                          alert('Atenção: O arquivo PDF selecionado é maior que 3MB. Recomendamos comprimir o PDF para evitar lentidão no salvamento.');
                        }
                        const reader = new FileReader();
                        reader.onload = (re) => {
                          setNewTemplatePdfBase64(re.target?.result as string);
                          setNewTemplatePdfName(f.name);
                          setNewTemplatePdfSize(f.size);
                        };
                        reader.readAsDataURL(f);
                      }
                    }}
                  />
                </label>
              )}
            </div>
            <span className="text-[8px] text-slate-400 mt-1 block">
              Permite mapear em forma de pinça onde as respostas do checklist aparecerão impressas no formulário.
            </span>
          </div>

          <div>
            <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">
              Perguntas Iniciais do Checklist (Uma por linha)*
            </label>
            <textarea
              rows={4}
              required
              placeholder="Verificação de fiação elétrica&#10;Limpeza e higienização física&#10;Controle térmico de operação"
              value={newTemplateInitialTasks}
              onChange={(e) => setNewTemplateInitialTasks(e.target.value)}
              className="w-full text-xs py-2.5 px-3.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 font-semibold"
            />
          </div>

          <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-200 text-slate-700 text-xs font-black rounded-lg transition-all active:scale-95 cursor-pointer hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-black rounded-lg transition-all active:scale-95 shadow-md cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
            >
              {isSubmitting ? 'Salvando...' : 'Criar Modelo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
