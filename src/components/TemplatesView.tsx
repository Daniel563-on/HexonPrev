import React, { useState, useEffect, useMemo } from 'react';
import {
  Trash2,
  ListChecks,
  Calendar,
  Sliders,
  Layers
} from 'lucide-react';
import {
  MaintenanceTemplate,
  TemplateChangeLog,
  Asset,
  Management,
  Address,
  ServiceOrder,
  PdfTemplateConfig,
  HexonUser
} from '../types';
import PdfTemplateMapper from './PdfTemplateMapper';
import CreateTemplateModal from './templates/CreateTemplateModal';
import DispatchTab from './templates/DispatchTab';
import AssetTypesCycleTab from './templates/AssetTypesCycleTab';
import ModelsTab from './templates/ModelsTab';
import {
  dbGetTemplates,
  dbSaveTemplate,
  dbDeleteTemplate,
  dbGetAssets,
  dbGetManagements,
  dbGetAddresses,
  getDatabaseMode
} from '../db/firebase';

interface TemplatesViewProps {
  onTemplatesUpdated?: () => void;
  userProfile: HexonUser;
  visibleUnits: string[] | null; // gerências do perfil (null = todas)
  canManage: boolean;            // permissão "Configurar Modelos de Cronograma"
  canDelete: boolean;            // permissão "Excluir Modelos"
  canDispatch: boolean;          // permissão "Disparar OS"
}

export default function TemplatesView({ onTemplatesUpdated, userProfile, visibleUnits, canManage, canDelete, canDispatch }: TemplatesViewProps) {
  // Navigation states (ordem do trabalho: 1. tipos e ciclo, 2. modelos, 3. disparo)
  const [subTab, setSubTab] = useState<'types' | 'templates' | 'generation'>('types');
  const [templates, setTemplates] = useState<MaintenanceTemplate[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [managements, setManagements] = useState<Management[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<MaintenanceTemplate | null>(null);

  // Form states for creating a new Template
  const [showAddModal, setShowAddModal] = useState(false);

  // PDF Mapping & Deletion State
  const [showPdfMapperModal, setShowPdfMapperModal] = useState(false);
  const [templateToDeleteId, setTemplateToDeleteId] = useState<string | null>(null);

  // Database mode / logged user details
  const dbMode = getDatabaseMode();
  const currentUserLabel = dbMode.userEmail || 'daniel.torres@hexon.com';

  // Dynamically extract unique asset types (specs.TIPO or specs.tipo) from the loaded assets list
  const existingAssetTypes = useMemo(() => {
    const types = new Set<string>();
    assets.forEach((asset) => {
      const t = asset.specs?.TIPO || asset.specs?.tipo;
      if (t && typeof t === 'string' && t.trim() !== '') {
        types.add(t.trim());
      }
    });

    if (types.size === 0) {
      types.add('Chiller');
      types.add('Ar Condicionado');
      types.add('Exaustor / Fancoil');
      types.add('Gerador de Energia');
      types.add('Quadro Elétrico');
      types.add('Subestação');
      types.add('Bomba Hidráulica');
    }

    return Array.from(types).sort((a, b) => a.localeCompare(b));
  }, [assets]);

  // Dynamically extract unique comarcas from registered assets
  const existingComarcas = useMemo(() => {
    const comarcas = new Set<string>();
    assets.forEach((asset) => {
      const c =
        asset.specs?.COMARCA ||
        asset.specs?.comarca ||
        (asset.location && asset.location.includes(' - ') ? asset.location.split(' - ')[0] : asset.location);
      if (c && typeof c === 'string' && c.trim() !== '') {
        comarcas.add(c.trim());
      }
    });
    // Comarcas dos endereços ativos cadastrados (rondas da DOM)
    addresses.forEach((a) => {
      if (a.active && a.comarca && a.comarca.trim() !== '') comarcas.add(a.comarca.trim());
    });
    if (comarcas.size === 0) {
      comarcas.add('Comarca Capital');
    }
    return Array.from(comarcas).sort((a, b) => a.localeCompare(b));
  }, [assets, addresses]);

  // Dynamically extract unique sectors from assets and template configurations
  const existingSectors = useMemo(() => {
    const sectors = new Set<string>();
    assets.forEach((asset) => {
      if (asset.sector && typeof asset.sector === 'string' && asset.sector.trim() !== '') {
        sectors.add(asset.sector.trim());
      }
    });
    if (sectors.size === 0) {
      sectors.add('Refrigeração');
      sectors.add('Elétrica');
      sectors.add('Civil');
    }
    return Array.from(sectors).sort((a, b) => a.localeCompare(b));
  }, [assets]);

  // Load backend configurations
  const loadData = async () => {
    const [tList, aList, mList, adList] = await Promise.all([
      dbGetTemplates(),
      dbGetAssets(),
      dbGetManagements(),
      dbGetAddresses(true)
    ]);
    setTemplates(tList);
    setAssets(aList);
    setManagements(mList);
    setAddresses(adList);

    // Automatically select the first template if none is currently selected
    if (tList.length > 0 && !selectedTemplate) {
      setSelectedTemplate(tList[0]);
    } else if (tList.length > 0 && selectedTemplate) {
      const reselected = tList.find((t) => t.id === selectedTemplate.id);
      if (reselected) {
        setSelectedTemplate(reselected);
      }
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Handle template created from modal
  const handleTemplateCreated = async (newTemplate: MaintenanceTemplate) => {
    await loadData();
    setSelectedTemplate(newTemplate);
    if (onTemplatesUpdated) onTemplatesUpdated();
    if (newTemplate.pdfTemplate?.pdfBase64) {
      setShowPdfMapperModal(true);
    }
  };

  // Handle template updated from TemplateManagerTab
  const handleTemplateUpdated = (updatedTemplate: MaintenanceTemplate) => {
    setSelectedTemplate(updatedTemplate);
    setTemplates((prev) => prev.map((t) => (t.id === updatedTemplate.id ? updatedTemplate : t)));
    if (onTemplatesUpdated) onTemplatesUpdated();
  };

  // Save PDF Mapping config to Firebase
  const handleSavePdfMapping = async (newConfig: PdfTemplateConfig) => {
    if (!selectedTemplate) return;
    const newVersion = (selectedTemplate.version || 1) + 1;
    const historyEntry: TemplateChangeLog = {
      version: newVersion,
      updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
      changeDescription: `Mapeamento de PDF atualizado (${newConfig.pins.length} marcadores posicionados com pinça).`,
      user: currentUserLabel
    };

    const updatedTemplate: MaintenanceTemplate = {
      ...selectedTemplate,
      version: newVersion,
      pdfTemplate: newConfig,
      history: [historyEntry, ...(selectedTemplate.history || [])]
    };

    setSelectedTemplate(updatedTemplate);
    await dbSaveTemplate(updatedTemplate);
    setTemplates(templates.map((t) => (t.id === updatedTemplate.id ? updatedTemplate : t)));
    if (onTemplatesUpdated) onTemplatesUpdated();
  };

  // Delete entire checklist template
  const handleDeleteTemplate = async (templateId: string) => {
    await dbDeleteTemplate(templateId);
    setSelectedTemplate(null);
    setTemplateToDeleteId(null);
    await loadData();

    if (onTemplatesUpdated) onTemplatesUpdated();
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto font-sans text-slate-900 pb-12">
      {/* CABEÇALHO: título + etapas do trabalho (1 → 2 → 3) */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 pt-5 pb-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
            <Sliders className="w-5 h-5 text-blue-600" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-black text-[#0b1c30] tracking-tight">Modelos e Protocolos</h1>
            <p className="text-xs text-slate-500">Configure na ordem: tipos de ativo e ciclo, depois os modelos, e por fim o disparo das OS.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 border-t border-gray-200">
          {([
            { key: 'types', n: 1, title: 'Tipos de ativo e ciclo', hint: 'Periodicidades e início do ciclo', icon: Layers },
            { key: 'templates', n: 2, title: 'Modelos', hint: 'Checklists por tipo e periodicidade', icon: ListChecks },
            { key: 'generation', n: 3, title: 'Disparo', hint: 'Gerar as OS do mês', icon: Calendar }
          ] as const).map((step, idx) => {
            const active = subTab === step.key;
            const Icon = step.icon;
            return (
              <button
                key={step.key}
                type="button"
                onClick={() => setSubTab(step.key)}
                className={`relative flex items-center gap-3 px-5 py-3.5 text-left transition-colors cursor-pointer ${
                  idx > 0 ? 'sm:border-l border-t sm:border-t-0 border-gray-200' : ''
                } ${active ? 'bg-blue-50/60' : 'hover:bg-slate-50'}`}
              >
                <span
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${
                    active ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {step.n}
                </span>
                <span className="min-w-0">
                  <span className={`flex items-center gap-1.5 text-xs font-black ${active ? 'text-blue-700' : 'text-slate-700'}`}>
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    {step.title}
                  </span>
                  <span className="block text-[11px] text-slate-500 truncate">{step.hint}</span>
                </span>
                {active && <span className="absolute left-0 right-0 bottom-0 h-0.5 bg-blue-600" />}
              </button>
            );
          })}
        </div>
      </div>

      {subTab === 'types' ? (
        <AssetTypesCycleTab
          units={visibleUnits || managements.map((m) => m.name).filter((n) => n && n !== 'Todas')}
          assets={assets}
          userName={userProfile.name}
          canManage={canManage}
          isSuperAdmin={userProfile.perfil === 'Super Administrador'}
        />
      ) : subTab === 'templates' ? (
        <ModelsTab
          units={visibleUnits || managements.map((m) => m.name).filter((n) => n && n !== 'Todas')}
          templates={templates}
          addresses={addresses}
          userName={userProfile.name}
          canManage={canManage}
          canDelete={canDelete}
          onChanged={async () => {
            await loadData();
            if (onTemplatesUpdated) onTemplatesUpdated();
          }}
          onOpenPdfMapper={(t) => {
            setSelectedTemplate(t);
            setShowPdfMapperModal(true);
          }}
        />
      ) : (
        <DispatchTab
          units={visibleUnits || managements.map((m) => m.name).filter((n) => n && n !== 'Todas')}
          assets={assets}
          templates={templates}
          addresses={addresses}
          canDispatch={canDispatch}
          onDispatched={() => {
            if (onTemplatesUpdated) onTemplatesUpdated();
          }}
        />
      )}

      {/* NEW TEMPLATE CREATION MODAL */}
      <CreateTemplateModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onCreated={handleTemplateCreated}
        existingAssetTypes={existingAssetTypes}
        existingComarcas={existingComarcas}
        assets={assets}
        managements={managements}
        currentUserLabel={currentUserLabel}
      />

      {/* PDF TEMPLATE MAPPER MODAL */}
      {showPdfMapperModal && selectedTemplate && (
        <PdfTemplateMapper
          template={selectedTemplate}
          onSaveConfig={handleSavePdfMapping}
          onClose={() => setShowPdfMapperModal(false)}
        />
      )}

      {/* CUSTOM DELETE CONFIRMATION MODAL */}
      {templateToDeleteId && (
        <div className="fixed inset-0 z-50 bg-slate-900/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full border border-gray-150 transform transition-all animate-in fade-in zoom-in-95 duration-150 text-left">
            <div className="flex items-center gap-3 text-rose-600 mb-4">
              <div className="bg-rose-50 p-2.5 rounded-full border border-rose-100">
                <Trash2 className="w-5 h-5 text-rose-600" />
              </div>
              <h3 className="font-extrabold text-[#0b1c30] text-sm tracking-tight uppercase">
                Excluir Modelo?
              </h3>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed mb-6 font-medium">
              Tem certeza de que deseja excluir permanentemente este modelo de checklist? As vistorias ou preventivas
              agendadas por este modelo deixarão de ser geradas automaticamente. Esta ação é irreversível.
            </p>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTemplateToDeleteId(null)}
                className="px-4 py-2 border border-gray-250 text-slate-650 rounded-lg text-[11px] font-black uppercase tracking-wider hover:bg-gray-50 active:scale-95 transition-all duration-150 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={async () => {
                  await handleDeleteTemplate(templateToDeleteId);
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[11px] font-black uppercase tracking-wider active:scale-95 transition-all duration-155 cursor-pointer shadow-sm border border-rose-700"
              >
                Sim, Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
