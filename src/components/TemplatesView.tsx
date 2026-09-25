import React, { useState, useEffect, useMemo } from 'react';
import {
  Trash2,
  ListChecks,
  Calendar,
  Sliders
} from 'lucide-react';
import {
  MaintenanceTemplate,
  TemplateChangeLog,
  Asset,
  Management,
  Address,
  ServiceOrder,
  PdfTemplateConfig
} from '../types';
import PdfTemplateMapper from './PdfTemplateMapper';
import CreateTemplateModal from './templates/CreateTemplateModal';
import TemplateManagerTab from './templates/TemplateManagerTab';
import TemplateGeneratorTab from './templates/TemplateGeneratorTab';
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
}

export default function TemplatesView({ onTemplatesUpdated }: TemplatesViewProps) {
  // Navigation states
  const [subTab, setSubTab] = useState<'templates' | 'generation'>('templates');
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
      {/* HEADER SECTION */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-6 rounded-2xl border border-gray-200 shadow-sm gap-4">
        <div>
          <h1 className="text-2xl font-black text-[#0b1c30] tracking-tight flex items-center gap-2">
            <Sliders className="w-6 h-6 text-blue-600" />
            Parametrização de Modelos e Protocolos
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Planeje, versione e gerencie procedimentos preventivos de ativos e vistorias semanais sem ativo, emitindo cronogramas em lote automaticamente.
          </p>
        </div>

        {/* Outer Tabs selector */}
        <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-gray-200 self-stretch md:self-auto gap-1">
          <button
            onClick={() => setSubTab('templates')}
            className={`flex-grow md:flex-initial h-9 px-4 rounded-lg text-xs font-black transition-all flex items-center justify-center gap-1.5 border whitespace-nowrap cursor-pointer ${
              subTab === 'templates'
                ? 'bg-white text-slate-900 shadow-sm border-gray-200'
                : 'text-slate-500 hover:text-slate-900 border-transparent'
            }`}
          >
            <ListChecks className="w-4 h-4 text-blue-600 shrink-0" />
            1. Modelos de Checklists
          </button>
          <button
            onClick={() => setSubTab('generation')}
            className={`flex-grow md:flex-initial h-9 px-4 rounded-lg text-xs font-black transition-all flex items-center justify-center gap-1.5 border whitespace-nowrap cursor-pointer ${
              subTab === 'generation'
                ? 'bg-white text-slate-900 shadow-sm border-gray-200'
                : 'text-slate-500 hover:text-slate-900 border-transparent'
            }`}
          >
            <Calendar className="w-4 h-4 text-emerald-600 shrink-0" />
            2. Geração Automática
          </button>
        </div>
      </div>

      {subTab === 'templates' ? (
        <TemplateManagerTab
          templates={templates}
          selectedTemplate={selectedTemplate}
          onSelectTemplate={setSelectedTemplate}
          onTemplateUpdated={handleTemplateUpdated}
          onOpenAddModal={() => setShowAddModal(true)}
          onOpenPdfMapper={() => setShowPdfMapperModal(true)}
          onRequestDeleteTemplate={(id) => setTemplateToDeleteId(id)}
          managements={managements}
          existingSectors={existingSectors}
          currentUserLabel={currentUserLabel}
        />
      ) : (
        <TemplateGeneratorTab
          templates={templates}
          assets={assets}
          existingComarcas={existingComarcas}
          existingSectors={existingSectors}
          managements={managements}
          addresses={addresses}
          onRefreshData={loadData}
          onTemplatesUpdated={onTemplatesUpdated}
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
