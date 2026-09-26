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
  addressToAssetItem,
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
      
      {/* CABEÇALHO: título, contadores e impressão + etapas */}
      <div className={`rounded-2xl border overflow-hidden ${darkMode ? 'bg-slate-900/70 border-slate-800' : 'bg-white border-slate-200 shadow-xs'}`}>
        <div className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-indigo-600 text-white shrink-0 shadow-sm">
              <QrCode className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-black tracking-tight text-slate-900 dark:text-white">Etiquetas e QR Codes</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Selecione os ativos, ajuste o modelo da etiqueta e imprima em lote.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className={`flex items-center gap-4 rounded-xl border px-4 py-2 ${darkMode ? 'bg-slate-800/70 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Selecionados</span>
                <span className="text-sm font-black text-indigo-600 dark:text-indigo-400">
                  {selectedAssetsToPrint.length.toLocaleString('pt-BR')}
                  <span className="text-[11px] font-semibold text-slate-400"> de {allAssets.length.toLocaleString('pt-BR')}</span>
                </span>
              </div>
              <div className="w-px h-8 bg-slate-200 dark:bg-slate-700" />
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Folhas</span>
                <span className="text-sm font-black text-slate-700 dark:text-slate-200">
                  {totalPages} <span className="text-[11px] font-semibold text-slate-400">{sheetConfig.paperType}</span>
                </span>
              </div>
            </div>
            <button
              onClick={handlePrintBatch}
              disabled={selectedAssetsToPrint.length === 0 || isPrinting}
              className="px-5 py-3 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50 text-white rounded-xl font-black text-xs tracking-wide shadow-md shadow-indigo-600/20 flex items-center gap-2 cursor-pointer transition-all whitespace-nowrap"
            >
              <Printer className="w-4 h-4" />
              <span>{isPrinting ? 'Processando...' : 'Imprimir lote'}</span>
            </button>
          </div>
        </div>

        {/* Etapas */}
        <div className={`px-5 py-2.5 border-t flex flex-wrap items-center justify-between gap-2 ${darkMode ? 'bg-slate-800/40 border-slate-800' : 'bg-slate-50/70 border-slate-200'}`}>
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {([
              { key: 'selection', n: 1, label: 'Seleção', icon: CheckSquare, extra: `${selectedAssetsToPrint.length}` },
              { key: 'layout', n: 2, label: 'Modelo da etiqueta', icon: Sliders, extra: '' },
              { key: 'preview', n: 3, label: 'Pré-visualização', icon: Eye, extra: `${previewPage}/${totalPages}` }
            ] as const).map((step) => {
              const active = activeTab === step.key;
              return (
                <button
                  key={step.key}
                  onClick={() => setActiveTab(step.key)}
                  className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-xs border border-indigo-200 dark:border-indigo-800'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 border border-transparent'
                  }`}
                >
                  <span className={`w-5 h-5 rounded-full text-[10px] font-black flex items-center justify-center ${
                    active ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                  }`}>
                    {step.n}
                  </span>
                  <span>{step.label}</span>
                  {step.extra && (
                    <span className={`px-1.5 rounded-full text-[10px] font-bold ${
                      active ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                    }`}>
                      {step.extra}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="hidden md:flex items-center gap-1.5 text-xs">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Modelo:</span>
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
