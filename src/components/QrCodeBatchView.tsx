// QrCodeBatchView.tsx - Central de Impressão e Gestão de QR Codes em Lote com Customização Individual de Campos e Salvamento de Modelos
import React, { useState, useEffect, useMemo } from 'react';
import { 
  Printer, 
  QrCode, 
  Sliders, 
  CheckSquare, 
  Eye, 
  ShieldCheck 
} from 'lucide-react';
import { 
  Asset, 
  Address,
  HexonUser, 
  FieldKey, 
  SheetConfig, 
  PlacardConfig, 
  SavedQrTemplate 
} from '../types';
import { 
  subscribeLocalAssets,
  dbGetAddresses,
  dbGetManagements,
  dbGetQrTemplates, 
  dbSaveQrTemplate, 
  dbDeleteQrTemplate 
} from '../db/firebase';
import { 
  DEFAULT_FIELD_ORDER, 
  DEFAULT_SHEET_CONFIG, 
  DEFAULT_PLACARD_CONFIG, 
  DEFAULT_SAVED_TEMPLATES 
} from '../utils/qrDefaults';
import { addressToAssetItem } from '../db/firebase';
import QrTemplateModals from './qrcode/QrTemplateModals';
import QrAssetSelectionTab from './qrcode/QrAssetSelectionTab';
import QrSheetPrintPreviewTab from './qrcode/QrSheetPrintPreviewTab';
import QrLayoutEditorTab from './qrcode/QrLayoutEditorTab';
import { executeBatchPrint } from './qrcode/qrPrintHelpers';

interface QrCodeBatchViewProps {
  userProfile: HexonUser | null;
  darkMode: boolean;
}

export default function QrCodeBatchView({ userProfile, darkMode }: QrCodeBatchViewProps) {
  // Assets & loading
  const [allAssets, setAllAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'selection' | 'layout' | 'preview'>(() => {
    try {
      const saved = localStorage.getItem('hexon_qrcode_active_tab');
      if (saved === 'selection' || saved === 'layout' || saved === 'preview') return saved;
    } catch {
      // ignore
    }
    return 'layout';
  });

  useEffect(() => {
    try {
      localStorage.setItem('hexon_qrcode_active_tab', activeTab);
    } catch {
      // ignore
    }
  }, [activeTab]);

  // Asset Selection Set
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());

  // Sheet Manual Config
  const [sheetConfig, setSheetConfig] = useState<SheetConfig>(DEFAULT_SHEET_CONFIG);

  // Placard Individual Fields Config
  const [placardConfig, setPlacardConfig] = useState<PlacardConfig>(DEFAULT_PLACARD_CONFIG);

  // Saved templates state (loaded from Firestore database)
  const [savedTemplates, setSavedTemplates] = useState<SavedQrTemplate[]>(() => {
    try {
      const stored = localStorage.getItem('hexon_saved_qr_templates_v2');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((t: SavedQrTemplate) => ({
            ...t,
            placard: {
              ...t.placard,
              fieldOrder: t.placard.fieldOrder && t.placard.fieldOrder.length > 0
                ? t.placard.fieldOrder
                : [...DEFAULT_FIELD_ORDER]
            }
          }));
        }
      }
    } catch (e) {
      console.warn('Erro ao ler cache local de modelos:', e);
    }
    return DEFAULT_SAVED_TEMPLATES;
  });

  const [loadingTemplates, setLoadingTemplates] = useState<boolean>(true);
  const [isSavingTemplate, setIsSavingTemplate] = useState<boolean>(false);
  const [isDeletingTemplate, setIsDeletingTemplate] = useState<boolean>(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('tpl_a4_pimaco_roxo');
  const [showSaveModal, setShowSaveModal] = useState<boolean>(false);
  const [newTemplateName, setNewTemplateName] = useState<string>('');
  const [saveModalError, setSaveModalError] = useState<string>('');
  const [templateToDelete, setTemplateToDelete] = useState<SavedQrTemplate | null>(null);
  const [showManageTemplatesModal, setShowManageTemplatesModal] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'info' | 'error' } | null>(null);

  // Auto-dismiss toast after 3.5s
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => {
      setToastMessage(null);
    }, 3500);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // Preview pagination state
  const [previewPage, setPreviewPage] = useState<number>(1);
  const [isPrinting, setIsPrinting] = useState<boolean>(false);
  const [printProgress, setPrintProgress] = useState<string>('');

  // Carregar templates do Banco de Dados Firestore na montagem
  useEffect(() => {
    let isMounted = true;
    async function loadTemplatesFromDb() {
      setLoadingTemplates(true);
      try {
        const templates = await dbGetQrTemplates();
        if (!isMounted) return;
        if (templates && templates.length > 0) {
          const sanitized = templates.map(t => ({
            ...t,
            placard: {
              ...t.placard,
              fieldOrder: t.placard.fieldOrder && t.placard.fieldOrder.length > 0
                ? t.placard.fieldOrder
                : [...DEFAULT_FIELD_ORDER]
            }
          }));
          setSavedTemplates(sanitized);
          // Manter seleção ou selecionar o primeiro modelo do banco
          setSelectedTemplateId(prev => sanitized.some(t => t.id === prev) ? prev : sanitized[0].id);
        }
      } catch (err) {
        console.error('Erro ao carregar modelos do banco de dados:', err);
      } finally {
        if (isMounted) setLoadingTemplates(false);
      }
    }
    loadTemplatesFromDb();
    return () => { isMounted = false; };
  }, []);

  // Ativos da cópia local (sincronizada, sem leitura extra) + endereços como "Imóvel". Nada vem marcado.
  const [localAssets, setLocalAssets] = useState<Asset[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [managementNames, setManagementNames] = useState<string[]>([]);
  useEffect(() => {
    const unsubscribe = subscribeLocalAssets((list) => {
      setLocalAssets(list);
      setLoading(false);
    });
    dbGetAddresses().then(setAddresses).catch(() => {});
    dbGetManagements().then((list) => setManagementNames(list.map((m) => m.name))).catch(() => {});
    return unsubscribe;
  }, []);
  useEffect(() => {
    setAllAssets([...localAssets, ...addresses.map(addressToAssetItem)]);
  }, [localAssets, addresses]);

  // Template actions
  const handleLoadTemplate = (id: string) => {
    setSelectedTemplateId(id);
    const found = savedTemplates.find(t => t.id === id);
    if (found) {
      setSheetConfig({ ...found.sheet });
      setPlacardConfig({
        ...found.placard,
        fieldOrder: found.placard.fieldOrder && found.placard.fieldOrder.length > 0
          ? found.placard.fieldOrder
          : [...DEFAULT_FIELD_ORDER]
      });
    }
  };

  const handleSaveCurrentAsNewTemplate = async () => {
    if (!newTemplateName.trim()) {
      setSaveModalError('Digite um nome para o modelo de etiqueta.');
      return;
    }
    const newId = `tpl_${Date.now()}`;
    const newTpl: SavedQrTemplate = {
      id: newId,
      name: newTemplateName.trim(),
      createdAt: new Date().toISOString().split('T')[0],
      sheet: { ...sheetConfig },
      placard: { ...placardConfig }
    };
    
    setIsSavingTemplate(true);
    setSaveModalError('');
    try {
      await dbSaveQrTemplate(newTpl);
      const updated = [newTpl, ...savedTemplates.filter(t => t.id !== newId)];
      setSavedTemplates(updated);
      setSelectedTemplateId(newId);
      setShowSaveModal(false);
      setNewTemplateName('');
      setSaveModalError('');
      setToastMessage({ text: `Modelo "${newTpl.name}" salvo no banco de dados com sucesso!`, type: 'success' });
    } catch (err) {
      console.error('Erro ao salvar modelo no banco de dados Firestore:', err);
      setSaveModalError('Falha ao conectar com o banco de dados. Tente novamente.');
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const promptDeleteTemplate = (id: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const found = savedTemplates.find(t => t.id === id) || savedTemplates.find(t => t.id === selectedTemplateId) || savedTemplates[0];
    if (found) {
      setTemplateToDelete(found);
    }
  };

  const handleDeleteTemplateById = (id: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const target = savedTemplates.find(t => t.id === id);
    if (target) {
      setTemplateToDelete(target);
    }
  };

  const handleConfirmDeleteTemplate = async () => {
    if (!templateToDelete) return;
    const idToDelete = templateToDelete.id;
    const nameDeleted = templateToDelete.name;
    
    setIsDeletingTemplate(true);
    try {
      await dbDeleteQrTemplate(idToDelete);
      const updated = savedTemplates.filter(t => t.id !== idToDelete);

      // If all deleted, fallback to a clean basic custom template
      const finalTemplates = updated.length > 0 ? updated : [
        {
          id: 'tpl_custom_basico',
          name: 'Modelo Básico A4 (Personalizado)',
          createdAt: new Date().toISOString().split('T')[0],
          sheet: { ...DEFAULT_SHEET_CONFIG },
          placard: { ...DEFAULT_PLACARD_CONFIG }
        }
      ];
      setSavedTemplates(finalTemplates);

      const nextSelected = finalTemplates[0];
      setSelectedTemplateId(nextSelected.id);
      setSheetConfig({ ...nextSelected.sheet });
      setPlacardConfig({
        ...nextSelected.placard,
        fieldOrder: nextSelected.placard.fieldOrder && nextSelected.placard.fieldOrder.length > 0
          ? nextSelected.placard.fieldOrder
          : [...DEFAULT_FIELD_ORDER]
      });
      setTemplateToDelete(null);
      setToastMessage({ text: `Modelo "${nameDeleted}" excluído do banco de dados!`, type: 'success' });
    } catch (err) {
      console.error('Erro ao excluir modelo do banco de dados:', err);
      setToastMessage({ text: 'Falha ao excluir modelo no banco de dados.', type: 'error' });
    } finally {
      setIsDeletingTemplate(false);
    }
  };

  const selectedAssetsToPrint = useMemo(() => {
    return allAssets.filter(a => selectedAssetIds.has(a.id));
  }, [allAssets, selectedAssetIds]);

  const labelsPerPage = Math.max(1, sheetConfig.columns * sheetConfig.rows);
  const totalPages = Math.max(1, Math.ceil(selectedAssetsToPrint.length / labelsPerPage));

  useEffect(() => {
    if (previewPage > totalPages) {
      setPreviewPage(totalPages);
    }
  }, [previewPage, totalPages]);

  // Memoized active field order ensuring all fields exist
  const activeFieldOrder = useMemo<FieldKey[]>(() => {
    if (placardConfig.fieldOrder && Array.isArray(placardConfig.fieldOrder) && placardConfig.fieldOrder.length > 0) {
      const present = new Set(placardConfig.fieldOrder);
      const full = [...placardConfig.fieldOrder];
      DEFAULT_FIELD_ORDER.forEach(k => {
        if (!present.has(k)) full.push(k);
      });
      return full;
    }
    return DEFAULT_FIELD_ORDER;
  }, [placardConfig.fieldOrder]);

  const handleMoveField = (index: number, direction: 'up' | 'down', e: React.MouseEvent) => {
    e.stopPropagation();
    const newOrder = [...activeFieldOrder];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newOrder.length) return;

    const temp = newOrder[index];
    newOrder[index] = newOrder[targetIndex];
    newOrder[targetIndex] = temp;

    setPlacardConfig(prev => ({
      ...prev,
      fieldOrder: newOrder
    }));
  };

  const handleResetFieldOrder = () => {
    setPlacardConfig(prev => ({
      ...prev,
      fieldOrder: [...DEFAULT_FIELD_ORDER]
    }));
  };

  // High-Precision Batch Printing Engine (Executado via qrPrintHelpers)
  const handlePrintBatch = async () => {
    if (selectedAssetsToPrint.length === 0) {
      alert("Selecione ao menos 1 ativo para imprimir.");
      return;
    }

    setIsPrinting(true);
    try {
      await executeBatchPrint({
        selectedAssets: selectedAssetsToPrint,
        sheetConfig,
        placardConfig,
        activeFieldOrder,
        onProgress: setPrintProgress
      });
    } catch (err) {
      console.error("Falha ao compilar lote de impressão:", err);
      alert("Ocorreu um erro ao preparar a impressão em lote.");
    } finally {
      setIsPrinting(false);
      setPrintProgress("");
    }
  };

  // Field names mapping for the customizer
  const fieldList: { key: keyof PlacardConfig['fields']; title: string; sample: string }[] = [
    { key: 'header', title: 'Cabeçalho Principal', sample: placardConfig.headerCustomText || 'HEXON PREVENTIVA' },
    { key: 'code', title: 'Código do Ativo', sample: 'ACJ-001' },
    { key: 'name', title: 'Nome do Equipamento', sample: 'CONDICIONADOR DE AR' },
    { key: 'comarca', title: 'Comarcas', sample: 'COMARCA DE MANAUS' },
    { key: 'location', title: 'Localização / Sala / Prédio', sample: '2º ANDAR - SALA 204' },
    { key: 'sector', title: 'Gerência / Setor', sample: 'MANUTENÇÃO PREDIAL' },
    { key: 'model', title: 'Modelo / Fabricante', sample: 'MOD: SPLIT 12000 BTUS' },
    { key: 'serial', title: 'Nº de Série', sample: 'SÉRIE: SN8847192' },
  ];

  return (
    <div className={`w-full max-w-[1600px] mx-auto space-y-5 font-sans pb-10 ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>
      
      {/* HEADER BAR */}
      <div className={`rounded-2xl border transition-all overflow-hidden ${darkMode ? 'bg-slate-900/70 border-slate-800' : 'bg-white border-slate-200 shadow-xs'}`}>
        <div className="p-5 sm:p-6 pb-4 sm:pb-4">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
            {/* Title & Info */}
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <div className="p-2 rounded-xl bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 shrink-0">
                  <QrCode className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <h1 className="text-lg sm:text-xl font-extrabold tracking-tight text-slate-900 dark:text-white uppercase">
                  Central de Etiquetas &amp; QR-Codes em Lote
                </h1>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25 font-mono shrink-0">
                  <ShieldCheck className="w-3 h-3" />
                  Super Administrador
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-2xl leading-relaxed">
                Configure margens milimétricas livres, personalize cada campo individualmente com cores, fontes e tamanhos, e salve modelos reutilizáveis.
              </p>
            </div>

            {/* Metrics & Main Print Action - Organized side by side */}
            <div className="flex items-center gap-3 shrink-0 flex-wrap sm:flex-nowrap">
              <div className={`flex items-center divide-x divide-slate-200 dark:divide-slate-700/80 rounded-xl border px-3.5 py-1.5 shadow-2xs ${
                darkMode ? 'bg-slate-800/70 border-slate-700/80' : 'bg-slate-50/80 border-slate-200/80'
              }`}>
                <div className="pr-3 text-right">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block font-mono">Fila</span>
                  <span className="text-sm font-black text-indigo-600 dark:text-indigo-400 font-mono">
                    {selectedAssetsToPrint.length} <span className="text-[10px] font-normal text-slate-400">/ {allAssets.length}</span>
                  </span>
                </div>
                <div className="pl-3 text-right">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block font-mono">Folhas</span>
                  <span className="text-sm font-black text-slate-700 dark:text-slate-200 font-mono">
                    {totalPages} <span className="text-[10px] font-normal text-slate-400">{sheetConfig.paperType}</span>
                  </span>
                </div>
              </div>

              <button
                onClick={handlePrintBatch}
                disabled={selectedAssetsToPrint.length === 0 || isPrinting}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50 text-white rounded-xl font-black text-xs tracking-wider shadow-md shadow-indigo-600/20 flex items-center gap-2 cursor-pointer transition-all whitespace-nowrap"
              >
                <Printer className="w-4 h-4 animate-pulse" />
                <span>{isPrinting ? 'Processando...' : 'IMPRIMIR LOTE'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Integrated Navigation Tab Bar with active context */}
        <div className={`px-5 sm:px-6 pt-1 border-t flex flex-wrap items-center justify-between gap-2 ${
          darkMode ? 'bg-slate-800/40 border-slate-800' : 'bg-slate-50/80 border-slate-200/70'
        }`}>
          <div className="flex items-center gap-1 sm:gap-3 overflow-x-auto">
            <button
              onClick={() => setActiveTab('selection')}
              className={`py-2.5 px-3 text-xs font-bold uppercase tracking-wider flex items-center gap-2 border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                activeTab === 'selection'
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 font-black'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <CheckSquare className="w-3.5 h-3.5" />
              <span>1. Seleção de Ativos</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
                activeTab === 'selection'
                  ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                  : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
              }`}>
                {selectedAssetsToPrint.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('layout')}
              className={`py-2.5 px-3 text-xs font-bold uppercase tracking-wider flex items-center gap-2 border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                activeTab === 'layout'
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 font-black'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>2. Margens, Campos &amp; Estilo Individual</span>
            </button>

            <button
              onClick={() => setActiveTab('preview')}
              className={`py-2.5 px-3 text-xs font-bold uppercase tracking-wider flex items-center gap-2 border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                activeTab === 'preview'
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 font-black'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>3. Pré-visualização da Folha</span>
              <span className="text-[10px] font-mono text-slate-400">
                (Pág {previewPage}/{totalPages})
              </span>
            </button>
          </div>

          <div className="hidden md:flex items-center gap-2 py-1 text-xs text-slate-400 font-medium">
            <span className="text-[10px] uppercase font-bold tracking-wider font-mono text-slate-400">Modelo:</span>
            <span className="text-slate-700 dark:text-slate-300 font-bold truncate max-w-xs">
              {savedTemplates.find(t => t.id === selectedTemplateId)?.name || 'Padrão'}
            </span>
          </div>
        </div>
      </div>

      {/* TAB 1: ASSET SELECTION (EXTRAÍDO NA ETAPA 2) */}
      {activeTab === 'selection' && (
        <QrAssetSelectionTab
          allAssets={allAssets}
          loading={loading}
          selectedAssetIds={selectedAssetIds}
          setSelectedAssetIds={setSelectedAssetIds}
          darkMode={darkMode}
          addresses={addresses}
          managementNames={managementNames}
        />
      )}

      {/* TAB 2: MARGINS, CUSTOMIZATION & SAVED TEMPLATES (EXTRAÍDO NA ETAPA 4) */}
      {activeTab === 'layout' && (
        <QrLayoutEditorTab
          sheetConfig={sheetConfig}
          setSheetConfig={setSheetConfig}
          placardConfig={placardConfig}
          setPlacardConfig={setPlacardConfig}
          savedTemplates={savedTemplates}
          selectedTemplateId={selectedTemplateId}
          loadingTemplates={loadingTemplates}
          onLoadTemplate={handleLoadTemplate}
          onPromptDeleteTemplate={promptDeleteTemplate}
          onOpenManageTemplatesModal={() => setShowManageTemplatesModal(true)}
          onOpenSaveModal={() => {
            setNewTemplateName('');
            setSaveModalError('');
            setShowSaveModal(true);
          }}
          toastMessage={toastMessage}
          activeFieldOrder={activeFieldOrder}
          onMoveField={handleMoveField}
          onResetFieldOrder={handleResetFieldOrder}
          sampleAsset={selectedAssetsToPrint[0] || allAssets[0]}
          darkMode={darkMode}
        />
      )}

      {/* TAB 3: REALISTIC WYSIWYG PREVIEW (EXTRAÍDO NA ETAPA 3) */}
      {activeTab === 'preview' && (
        <QrSheetPrintPreviewTab
          sheetConfig={sheetConfig}
          placardConfig={placardConfig}
          selectedAssetsToPrint={selectedAssetsToPrint}
          previewPage={previewPage}
          setPreviewPage={setPreviewPage}
          totalPages={totalPages}
          labelsPerPage={labelsPerPage}
          activeFieldOrder={activeFieldOrder}
          isPrinting={isPrinting}
          onPrintBatch={handlePrintBatch}
          darkMode={darkMode}
        />
      )}

      {/* MODAIS DE GESTÃO DE MODELOS (EXTRAÍDOS NA ETAPA 1) */}
      <QrTemplateModals
        showSaveModal={showSaveModal}
        onCloseSaveModal={() => setShowSaveModal(false)}
        newTemplateName={newTemplateName}
        setNewTemplateName={setNewTemplateName}
        saveModalError={saveModalError}
        setSaveModalError={setSaveModalError}
        isSavingTemplate={isSavingTemplate}
        onSaveCurrentAsNewTemplate={handleSaveCurrentAsNewTemplate}
        templateToDelete={templateToDelete}
        onCloseDeleteModal={() => setTemplateToDelete(null)}
        isDeletingTemplate={isDeletingTemplate}
        onConfirmDeleteTemplate={handleConfirmDeleteTemplate}
        totalSavedTemplatesCount={savedTemplates.length}
        showManageTemplatesModal={showManageTemplatesModal}
        onCloseManageTemplatesModal={() => setShowManageTemplatesModal(false)}
        savedTemplates={savedTemplates}
        selectedTemplateId={selectedTemplateId}
        onLoadTemplate={(id, tplName) => {
          handleLoadTemplate(id);
          setToastMessage({ text: `Modelo "${tplName}" carregado!`, type: 'info' });
        }}
        onDeleteTemplateById={handleDeleteTemplateById}
      />

      {/* PRINT ENGINE PROGRESS OVERLAY */}
      {isPrinting && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs z-[9999] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 text-center">
            <div className="w-12 h-12 rounded-full bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto animate-pulse">
              <Printer className="w-6 h-6" />
            </div>
            <h3 className="text-base font-extrabold tracking-tight uppercase">Preparando Impressão em Alta Resolução</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {printProgress || 'Processando matriz gráfica...'}
            </p>
            <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div className="bg-indigo-600 h-full w-full animate-indeterminate" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
