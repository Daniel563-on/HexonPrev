// QrCodeBatchView.tsx - Central de Impressão e Gestão de QR Codes em Lote com Customização Individual de Campos e Salvamento de Modelos
import React, { useState, useEffect, useMemo } from 'react';
import { 
  Printer, 
  QrCode, 
  Sliders, 
  Search, 
  CheckSquare, 
  Square, 
  RotateCcw, 
  ChevronLeft, 
  ChevronRight, 
  Eye, 
  ShieldCheck, 
  HelpCircle,
  Sparkles,
  Save,
  FolderOpen,
  Trash2,
  Check,
  X,
  Type,
  Maximize2,
  ArrowUp,
  ArrowDown,
  ChevronUp,
  WrapText,
  AlertTriangle,
  Layers,
  Database,
  Cloud,
  Loader2
} from 'lucide-react';
import { 
  Asset, 
  HexonUser, 
  FieldKey, 
  FieldStyle, 
  SheetConfig, 
  PlacardConfig, 
  SavedQrTemplate 
} from '../types';
import { 
  dbGetAssets, 
  dbGetQrTemplates, 
  dbSaveQrTemplate, 
  dbDeleteQrTemplate 
} from '../db/firebase';
import { 
  DEFAULT_FIELD_ORDER, 
  DEFAULT_SHEET_CONFIG, 
  DEFAULT_PLACARD_CONFIG, 
  DEFAULT_SAVED_TEMPLATES, 
  FONT_OPTIONS 
} from '../utils/qrDefaults';
import { getAssetQrDataUrl } from '../utils/qrUtils';
import { AssetQrCode } from './AssetQrCode';

interface QrCodeBatchViewProps {
  userProfile: HexonUser | null;
  darkMode: boolean;
}

const ITEMS_PER_TABLE_PAGE = 35;

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

  // Filter states
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedComarca, setSelectedComarca] = useState<string>('Todas');
  const [selectedSector, setSelectedSector] = useState<string>('Todos');
  const [selectedStatus, setSelectedStatus] = useState<string>('Todos');

  // Table pagination state
  const [tablePage, setTablePage] = useState<number>(1);

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

  // Active accordion or panel for field styling
  const [activeFieldEdit, setActiveFieldEdit] = useState<keyof PlacardConfig['fields'] | null>('header');

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

  // Load assets on mount
  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      setLoading(true);
      try {
        const data = await dbGetAssets();
        if (!isMounted) return;
        setAllAssets(data);
        const initialSelection = new Set<string>();
        data.slice(0, 24).forEach(a => initialSelection.add(a.id));
        setSelectedAssetIds(initialSelection);
      } catch (err) {
        console.error('Erro ao carregar ativos para impressão de QR codes:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadData();
    return () => { isMounted = false; };
  }, []);

  // Quick paper format preset handler
  const handlePaperTypeSelect = (type: 'A4' | 'A3' | 'Custom') => {
    if (type === 'A4') {
      setSheetConfig(prev => ({
        ...prev,
        paperType: 'A4',
        pageWidthMm: 210,
        pageHeightMm: 297,
      }));
    } else if (type === 'A3') {
      setSheetConfig(prev => ({
        ...prev,
        paperType: 'A3',
        pageWidthMm: 297,
        pageHeightMm: 420,
      }));
    } else {
      setSheetConfig(prev => ({
        ...prev,
        paperType: 'Custom'
      }));
    }
  };

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

  // Helper to update individual field style
  const updateField = (
    fieldName: keyof PlacardConfig['fields'], 
    changes: Partial<FieldStyle>
  ) => {
    setPlacardConfig(prev => ({
      ...prev,
      fields: {
        ...prev.fields,
        [fieldName]: {
          ...prev.fields[fieldName],
          ...changes
        }
      }
    }));
  };

  // Extract unique comarcas and sectors
  const uniqueComarcas = useMemo(() => {
    const set = new Set<string>();
    allAssets.forEach(a => {
      const c = a.specs?.COMARCA || a.specs?.comarca || (a.location ? a.location.split(' - ')[0] : '');
      if (c && c.trim()) set.add(c.trim());
    });
    return Array.from(set).sort();
  }, [allAssets]);

  const uniqueSectors = useMemo(() => {
    const set = new Set<string>();
    allAssets.forEach(a => {
      if (a.sector) set.add(a.sector);
    });
    return Array.from(set).sort();
  }, [allAssets]);

  // Filtered assets
  const filteredAssets = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return allAssets.filter(asset => {
      if (q) {
        const matchCode = (asset.code || '').toLowerCase().includes(q);
        const matchName = (asset.name || '').toLowerCase().includes(q);
        const matchLoc = (asset.location || '').toLowerCase().includes(q);
        const matchSerial = (asset.specs?.serialNumber || asset.specs?.['Nº DE SÉRIE'] || '').toLowerCase().includes(q);
        const matchModel = (asset.specs?.model || asset.specs?.MODELO || '').toLowerCase().includes(q);
        if (!matchCode && !matchName && !matchLoc && !matchSerial && !matchModel) {
          return false;
        }
      }
      if (selectedComarca !== 'Todas') {
        const c = asset.specs?.COMARCA || asset.specs?.comarca || (asset.location ? asset.location.split(' - ')[0] : '');
        if (c !== selectedComarca) return false;
      }
      if (selectedSector !== 'Todos') {
        if (asset.sector !== selectedSector) return false;
      }
      if (selectedStatus !== 'Todos') {
        if (asset.status !== selectedStatus) return false;
      }
      return true;
    });
  }, [allAssets, searchTerm, selectedComarca, selectedSector, selectedStatus]);

  useEffect(() => {
    setTablePage(1);
  }, [searchTerm, selectedComarca, selectedSector, selectedStatus]);

  const totalTablePages = Math.max(1, Math.ceil(filteredAssets.length / ITEMS_PER_TABLE_PAGE));
  const paginatedAssets = useMemo(() => {
    const start = (tablePage - 1) * ITEMS_PER_TABLE_PAGE;
    return filteredAssets.slice(start, start + ITEMS_PER_TABLE_PAGE);
  }, [filteredAssets, tablePage]);

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

  // Batch selection handlers
  const handleToggleSelectAsset = (id: string) => {
    const next = new Set(selectedAssetIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedAssetIds(next);
  };

  const handleSelectAllFiltered = () => {
    const next = new Set(selectedAssetIds);
    filteredAssets.forEach(a => next.add(a.id));
    setSelectedAssetIds(next);
  };

  const handleDeselectAllFiltered = () => {
    const next = new Set(selectedAssetIds);
    filteredAssets.forEach(a => next.delete(a.id));
    setSelectedAssetIds(next);
  };

  const handleClearAll = () => {
    setSelectedAssetIds(new Set());
  };

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

  const fieldTitles: Record<FieldKey, string> = {
    header: 'Cabeçalho Principal',
    code: 'Código do Ativo',
    name: 'Nome do Equipamento',
    comarca: 'Comarcas',
    location: 'Localização / Sala / Prédio',
    sector: 'Gerência / Setor',
    model: 'Modelo / Fabricante',
    serial: 'Nº de Série',
  };

  const getFieldContent = (key: FieldKey, asset?: Asset) => {
    switch (key) {
      case 'header':
        return placardConfig.headerCustomText || 'HEXON PREVENTIVA';
      case 'code':
        return asset?.code || 'ACJ-001';
      case 'name':
        return asset?.name || 'CONDICIONADOR DE AR SPLIT 12000 BTUS';
      case 'comarca':
        return asset 
          ? (asset.specs?.COMARCA || asset.specs?.comarca || (asset.location ? asset.location.split(' - ')[0] : 'Geral'))
          : 'COMARCA DE MANAUS';
      case 'location':
        return asset?.location || '2º ANDAR - SALA 204';
      case 'sector':
        return asset?.sector || (asset ? '' : 'MANUTENÇÃO PREDIAL');
      case 'model': {
        const m = asset?.specs?.model || asset?.specs?.MODELO;
        return m ? `MOD: ${m}` : (asset ? '' : 'MOD: SPLIT 12000 BTUS');
      }
      case 'serial': {
        const s = asset?.specs?.serialNumber || asset?.specs?.['Nº DE SÉRIE'];
        return s ? `SÉRIE: ${s}` : (asset ? '' : 'SÉRIE: SN8847192');
      }
    }
  };

  // Border CSS generator helper
  const getBorderCss = (style: string, color: string) => {
    switch (style) {
      case 'dashed':
        return `border: 0.25mm dashed ${color};`;
      case 'dotted':
        return `border: 0.25mm dotted ${color};`;
      case 'solid-thin':
        return `border: 0.25mm solid ${color};`;
      case 'solid-thick':
        return `border: 0.75mm solid ${color};`;
      case 'badge':
        return `border: 0.6mm solid ${color}; outline: 0.25mm solid ${color}; outline-offset: -1mm;`;
      case 'rounded-frame':
        return `border: 0.4mm solid ${color}; box-shadow: inset 0 0 0 0.2mm ${color};`;
      default:
        return 'border: none;';
    }
  };

  const currentBorderCss = useMemo(() => {
    return getBorderCss(placardConfig.borderStyle, placardConfig.borderColor);
  }, [placardConfig.borderStyle, placardConfig.borderColor]);

  const currentOrientationLayout = useMemo(() => {
    let flexDirection = 'row';
    let flexAlign = 'center';
    let textAlign = 'left';
    let qrOrder = 0;
    let textOrder = 1;
    let qrWidthPercent = `${placardConfig.qrScalePercent}%`;
    let qrHeightPercent = '100%';

    if (placardConfig.orientation === 'horizontal-left') {
      flexDirection = 'row';
      qrOrder = 0;
      textOrder = 1;
      textAlign = 'left';
      qrWidthPercent = `${placardConfig.qrScalePercent}%`;
      qrHeightPercent = '100%';
    } else if (placardConfig.orientation === 'horizontal-right') {
      flexDirection = 'row';
      qrOrder = 1;
      textOrder = 0;
      textAlign = 'left';
      qrWidthPercent = `${placardConfig.qrScalePercent}%`;
      qrHeightPercent = '100%';
    } else if (placardConfig.orientation === 'vertical-top') {
      flexDirection = 'column';
      qrOrder = 0;
      textOrder = 1;
      textAlign = 'center';
      qrWidthPercent = '100%';
      qrHeightPercent = `${placardConfig.qrScalePercent}%`;
    } else if (placardConfig.orientation === 'vertical-bottom') {
      flexDirection = 'column';
      qrOrder = 1;
      textOrder = 0;
      textAlign = 'center';
      qrWidthPercent = '100%';
      qrHeightPercent = `${placardConfig.qrScalePercent}%`;
    }

    return { flexDirection, flexAlign, textAlign, qrOrder, textOrder, qrWidthPercent, qrHeightPercent };
  }, [placardConfig.orientation, placardConfig.qrScalePercent]);

  // High-Precision Batch Printing Engine
  const handlePrintBatch = async () => {
    if (selectedAssetsToPrint.length === 0) {
      alert('Selecione ao menos 1 ativo para imprimir.');
      return;
    }

    setIsPrinting(true);
    setPrintProgress(`Gerando QR Codes para ${selectedAssetsToPrint.length} ativos...`);

    try {
      const qrDataUrls: { [assetId: string]: string } = {};
      const batchChunk = 40;
      for (let i = 0; i < selectedAssetsToPrint.length; i += batchChunk) {
        const chunk = selectedAssetsToPrint.slice(i, i + batchChunk);
        await Promise.all(
          chunk.map(async (asset) => {
            qrDataUrls[asset.id] = await getAssetQrDataUrl(asset.id, 260);
          })
        );
        setPrintProgress(`Processando (${Math.min(i + batchChunk, selectedAssetsToPrint.length)} de ${selectedAssetsToPrint.length})...`);
      }

      setPrintProgress('Montando páginas de impressão de alta fidelidade...');

      const win = window.open('', '_blank');
      if (!win) {
        alert('Por favor, permita pop-ups neste navegador para abrir a página de impressão.');
        setIsPrinting(false);
        return;
      }

      const pages: Asset[][] = [];
      for (let i = 0; i < selectedAssetsToPrint.length; i += labelsPerPage) {
        pages.push(selectedAssetsToPrint.slice(i, i + labelsPerPage));
      }

      const borderCss = getBorderCss(placardConfig.borderStyle, placardConfig.borderColor);

      // Flex direction and ordering logic for the 4 orientations
      let flexDirection = 'row';
      let flexAlign = 'center';
      let textAlign = 'left';
      let qrOrder = 0;
      let textOrder = 1;
      let qrWidthPercent = `${placardConfig.qrScalePercent}%`;
      let qrHeightPercent = '100%';

      if (placardConfig.orientation === 'horizontal-left') {
        flexDirection = 'row';
        qrOrder = 0;
        textOrder = 1;
        textAlign = 'left';
        qrWidthPercent = `${placardConfig.qrScalePercent}%`;
        qrHeightPercent = '100%';
      } else if (placardConfig.orientation === 'horizontal-right') {
        flexDirection = 'row';
        qrOrder = 1;
        textOrder = 0;
        textAlign = 'left';
        qrWidthPercent = `${placardConfig.qrScalePercent}%`;
        qrHeightPercent = '100%';
      } else if (placardConfig.orientation === 'vertical-top') {
        flexDirection = 'column';
        qrOrder = 0;
        textOrder = 1;
        textAlign = 'center';
        qrWidthPercent = '100%';
        qrHeightPercent = `${placardConfig.qrScalePercent}%`;
      } else if (placardConfig.orientation === 'vertical-bottom') {
        flexDirection = 'column';
        qrOrder = 1;
        textOrder = 0;
        textAlign = 'center';
        qrWidthPercent = '100%';
        qrHeightPercent = `${placardConfig.qrScalePercent}%`;
      }

      // Generate CSS for each individual field with support for word-wrap
      const generateFieldStyleCss = (f: FieldStyle) => {
        const wrapCss = f.wordWrap
          ? 'white-space: normal; word-break: break-word; overflow-wrap: anywhere;'
          : 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
        return `
          font-family: ${f.fontFamily};
          font-size: ${f.fontSizePt}pt;
          font-weight: ${f.fontWeight};
          color: ${f.color};
          text-transform: ${f.uppercase ? 'uppercase' : 'none'};
          line-height: 1.16;
          margin-top: 0.3mm;
          ${wrapCss}
        `;
      };

      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8" />
            <title>Lote de QR Codes - Hexon Preventiva (${selectedAssetsToPrint.length} Ativos)</title>
            <style>
              @page {
                size: ${sheetConfig.pageWidthMm}mm ${sheetConfig.pageHeightMm}mm;
                margin: 0;
              }
              *, *::before, *::after {
                box-sizing: border-box;
                margin: 0;
                padding: 0;
              }
              body {
                margin: 0;
                padding: 0;
                background: #ffffff;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
              .page {
                width: ${sheetConfig.pageWidthMm}mm;
                height: ${sheetConfig.pageHeightMm}mm;
                max-height: ${sheetConfig.pageHeightMm}mm;
                overflow: hidden;
                position: relative;
                padding-top: ${sheetConfig.marginTopMm}mm;
                padding-left: ${sheetConfig.marginLeftMm}mm;
                page-break-after: always;
                break-after: page;
              }
              .grid-container {
                display: grid;
                grid-template-columns: repeat(${sheetConfig.columns}, ${sheetConfig.labelWidthMm}mm);
                grid-auto-rows: ${sheetConfig.labelHeightMm}mm;
                column-gap: ${sheetConfig.gapXMm}mm;
                row-gap: ${sheetConfig.gapYMm}mm;
              }
              .label {
                width: ${sheetConfig.labelWidthMm}mm;
                height: ${sheetConfig.labelHeightMm}mm;
                max-height: ${sheetConfig.labelHeightMm}mm;
                overflow: hidden;
                ${borderCss}
                border-radius: ${placardConfig.borderRadiusMm}mm;
                padding: 1.5mm;
                display: flex;
                flex-direction: ${flexDirection};
                align-items: ${flexAlign};
                justify-content: ${flexDirection === 'row' ? 'flex-start' : 'center'};
                gap: 2mm;
                background: ${placardConfig.backgroundColor};
              }
              .qr-box {
                order: ${qrOrder};
                flex-shrink: 0;
                width: ${qrWidthPercent};
                height: ${qrHeightPercent};
                display: flex;
                align-items: center;
                justify-content: center;
              }
              .qr-box img {
                max-width: 100%;
                max-height: 100%;
                object-fit: contain;
                display: block;
              }
              .info-box {
                order: ${textOrder};
                flex: 1;
                min-width: 0;
                display: flex;
                flex-direction: column;
                justify-content: center;
                text-align: ${textAlign};
                overflow: hidden;
              }
              .f-header { ${generateFieldStyleCss(placardConfig.fields.header)} }
              .f-code { ${generateFieldStyleCss(placardConfig.fields.code)} }
              .f-name { ${generateFieldStyleCss(placardConfig.fields.name)} }
              .f-comarca { ${generateFieldStyleCss(placardConfig.fields.comarca)} }
              .f-location { ${generateFieldStyleCss(placardConfig.fields.location)} }
              .f-sector { ${generateFieldStyleCss(placardConfig.fields.sector)} }
              .f-model { ${generateFieldStyleCss(placardConfig.fields.model)} }
              .f-serial { ${generateFieldStyleCss(placardConfig.fields.serial)} }
              @media screen {
                body {
                  background: #e2e8f0;
                  padding: 20px;
                }
                .page {
                  margin: 0 auto 20px auto;
                  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                  background: #ffffff;
                }
              }
            </style>
          </head>
          <body>
            ${pages.map((pageAssets, pIdx) => `
              <div class="page" id="page-${pIdx + 1}">
                <div class="grid-container">
                  ${pageAssets.map((asset) => {
                    const qrUrl = qrDataUrls[asset.id] || '';

                    return `
                      <div class="label">
                        <div class="qr-box">
                          <img src="${qrUrl}" alt="${asset.code}" />
                        </div>
                        <div class="info-box">
                          ${activeFieldOrder.map((key) => {
                            const f = placardConfig.fields[key];
                            if (!f || !f.enabled) return '';
                            const text = getFieldContent(key, asset);
                            if (!text) return '';
                            return `<div class="f-${key}">${text}</div>`;
                          }).join('')}
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>
            `).join('')}

            <script>
              window.onload = function() {
                setTimeout(function() {
                  window.focus();
                  window.print();
                }, 400);
              };
            </script>
          </body>
        </html>
      `;

      win.document.open();
      win.document.write(htmlContent);
      win.document.close();
    } catch (err) {
      console.error('Falha ao compilar lote de impressão:', err);
      alert('Ocorreu um erro ao preparar a impressão em lote.');
    } finally {
      setIsPrinting(false);
      setPrintProgress('');
    }
  };

  const startIndex = (previewPage - 1) * labelsPerPage;
  const previewPageAssets = selectedAssetsToPrint.slice(startIndex, startIndex + labelsPerPage);

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

      {/* TAB 1: ASSET SELECTION */}
      {activeTab === 'selection' && (
        <div className="space-y-4">
          {/* FILTER BAR */}
          <div className={`p-4 rounded-2xl border ${darkMode ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200'}`}>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar por código, nome, local..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className={`w-full pl-9 pr-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-medium ${
                    darkMode ? 'bg-slate-800/80 border-slate-700 text-white' : 'bg-slate-50 border-slate-200 text-slate-800'
                  }`}
                />
              </div>

              <div>
                <select
                  value={selectedComarca}
                  onChange={(e) => setSelectedComarca(e.target.value)}
                  className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-semibold ${
                    darkMode ? 'bg-slate-800/80 border-slate-700 text-white' : 'bg-slate-50 border-slate-200 text-slate-800'
                  }`}
                >
                  <option value="Todas">Comarca: Todas ({uniqueComarcas.length})</option>
                  {uniqueComarcas.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div>
                <select
                  value={selectedSector}
                  onChange={(e) => setSelectedSector(e.target.value)}
                  className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-semibold ${
                    darkMode ? 'bg-slate-800/80 border-slate-700 text-white' : 'bg-slate-50 border-slate-200 text-slate-800'
                  }`}
                >
                  <option value="Todos">Setor: Todos ({uniqueSectors.length})</option>
                  {uniqueSectors.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              <div>
                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-semibold ${
                    darkMode ? 'bg-slate-800/80 border-slate-700 text-white' : 'bg-slate-50 border-slate-200 text-slate-800'
                  }`}
                >
                  <option value="Todos">Status: Todos</option>
                  <option value="Operando">Operando</option>
                  <option value="Em Manutenção">Em Manutenção</option>
                  <option value="Parado">Parado</option>
                </select>
              </div>
            </div>

            {/* Mass Selection Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-3 border-t border-slate-200/60 dark:border-slate-800">
              <div className="flex items-center flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleSelectAllFiltered}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <CheckSquare className="w-3.5 h-3.5" />
                  Selecionar Todos Filtrados ({filteredAssets.length})
                </button>

                <button
                  type="button"
                  onClick={handleDeselectAllFiltered}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <Square className="w-3.5 h-3.5" />
                  Desmarcar Filtrados
                </button>

                <button
                  type="button"
                  onClick={handleClearAll}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/50 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Limpar Seleção
                </button>
              </div>

              <div className="text-xs font-bold text-slate-500 font-mono">
                Filtrados: <span className="text-slate-900 dark:text-white font-black">{filteredAssets.length}</span> &bull; Marcados para Imprimir: <span className="text-indigo-600 dark:text-indigo-400 font-black">{selectedAssetsToPrint.length}</span>
              </div>
            </div>
          </div>

          {/* ASSET TABLE WITH INSTANT PAGINATION */}
          <div className={`rounded-2xl border overflow-hidden ${darkMode ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200 shadow-xs'}`}>
            {loading ? (
              <div className="p-12 text-center text-slate-400 space-y-3">
                <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-xs font-bold uppercase tracking-wider font-mono">Carregando base de ativos...</p>
              </div>
            ) : filteredAssets.length === 0 ? (
              <div className="p-12 text-center text-slate-400 space-y-2">
                <Search className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600" />
                <p className="text-sm font-bold">Nenhum ativo encontrado com os filtros selecionados.</p>
                <p className="text-xs">Tente alterar os termos de busca ou comarca.</p>
              </div>
            ) : (
              <div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className={`text-[10px] font-black uppercase tracking-wider font-mono border-b ${
                      darkMode ? 'bg-slate-900 border-slate-800 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-500'
                    }`}>
                      <tr>
                        <th className="py-3 px-4 w-12 text-center">
                          <input
                            type="checkbox"
                            checked={paginatedAssets.length > 0 && paginatedAssets.every(a => selectedAssetIds.has(a.id))}
                            onChange={(e) => {
                              const next = new Set(selectedAssetIds);
                              if (e.target.checked) {
                                paginatedAssets.forEach(a => next.add(a.id));
                              } else {
                                paginatedAssets.forEach(a => next.delete(a.id));
                              }
                              setSelectedAssetIds(next);
                            }}
                            className="rounded text-indigo-600 cursor-pointer"
                            title="Selecionar todos os itens desta página"
                          />
                        </th>
                        <th className="py-3 px-3 w-12 text-center">Tipo</th>
                        <th className="py-3 px-4">Código</th>
                        <th className="py-3 px-4">Nome do Ativo</th>
                        <th className="py-3 px-4">Comarca / Localização</th>
                        <th className="py-3 px-4">Setor</th>
                        <th className="py-3 px-4">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                      {paginatedAssets.map(asset => {
                        const isSelected = selectedAssetIds.has(asset.id);
                        const comarcaStr = asset.specs?.COMARCA || asset.specs?.comarca || (asset.location ? asset.location.split(' - ')[0] : '-');

                        return (
                          <tr
                            key={asset.id}
                            onClick={() => handleToggleSelectAsset(asset.id)}
                            className={`cursor-pointer transition-colors ${
                              isSelected
                                ? darkMode ? 'bg-indigo-950/30 hover:bg-indigo-950/50' : 'bg-indigo-50/70 hover:bg-indigo-50'
                                : darkMode ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50/80'
                            }`}
                          >
                            <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleSelectAsset(asset.id)}
                                className="rounded text-indigo-600 cursor-pointer"
                              />
                            </td>
                            <td className="py-2 px-3 text-center">
                              <div className="w-7 h-7 mx-auto bg-indigo-50 dark:bg-indigo-950/50 rounded-lg flex items-center justify-center text-indigo-600 dark:text-indigo-400 border border-indigo-200/50 dark:border-indigo-800/50">
                                <QrCode className="w-3.5 h-3.5" />
                              </div>
                            </td>
                            <td className="py-3 px-4 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                              {asset.code}
                            </td>
                            <td className="py-3 px-4 text-slate-800 dark:text-slate-100 font-bold">
                              {asset.name}
                            </td>
                            <td className="py-3 px-4 text-slate-500 dark:text-slate-400">
                              <span className="font-semibold text-slate-700 dark:text-slate-300">{comarcaStr}</span>
                              <span className="block text-[10px] text-slate-400 truncate max-w-xs">{asset.location}</span>
                            </td>
                            <td className="py-3 px-4 text-slate-600 dark:text-slate-300 font-semibold">
                              {asset.sector}
                            </td>
                            <td className="py-3 px-4">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                asset.status === 'Operando'
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                  : asset.status === 'Em Manutenção'
                                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                  : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                              }`}>
                                {asset.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* TABLE PAGINATION BAR */}
                <div className={`p-3 border-t flex flex-wrap items-center justify-between gap-3 text-xs ${
                  darkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'
                }`}>
                  <div className="text-slate-500 font-mono">
                    Mostrando itens {(tablePage - 1) * ITEMS_PER_TABLE_PAGE + 1} a {Math.min(tablePage * ITEMS_PER_TABLE_PAGE, filteredAssets.length)} de {filteredAssets.length}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setTablePage(p => Math.max(1, p - 1))}
                      disabled={tablePage <= 1}
                      className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-30 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer font-bold flex items-center gap-1"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" /> Anterior
                    </button>

                    <span className="font-mono font-bold px-2">
                      {tablePage} / {totalTablePages}
                    </span>

                    <button
                      onClick={() => setTablePage(p => Math.min(totalTablePages, p + 1))}
                      disabled={tablePage >= totalTablePages}
                      className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-30 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer font-bold flex items-center gap-1"
                    >
                      Próxima <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: MARGINS, CUSTOMIZATION & SAVED TEMPLATES */}
      {activeTab === 'layout' && (
        <div className="space-y-6">
          
          {/* TOP BAR: SAVED TEMPLATES MANAGER */}
          <div className={`p-4 rounded-2xl border flex flex-wrap items-center justify-between gap-4 ${
            darkMode ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-200 shadow-xs'
          }`}>
            <div className="flex items-center flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-indigo-500" />
                <span className="text-xs font-black uppercase tracking-wider font-mono">Modelos:</span>
                <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 px-2 py-0.5 rounded-md" title="Modelos sincronizados no banco de dados Firestore">
                  <Cloud className="w-3 h-3" />
                  Banco de Dados
                </span>
              </div>

              <select
                value={selectedTemplateId}
                disabled={loadingTemplates}
                onChange={(e) => handleLoadTemplate(e.target.value)}
                className={`px-3 py-1.5 text-xs rounded-xl border font-bold max-w-xs md:max-w-md truncate ${
                  darkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-800'
                }`}
              >
                {savedTemplates.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.sheet.paperType} - {t.sheet.columns * t.sheet.rows} etiq.)
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={(e) => promptDeleteTemplate(selectedTemplateId, e)}
                title="Excluir o modelo atualmente selecionado"
                className="px-3 py-1.5 rounded-xl border border-rose-200 dark:border-rose-900/70 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/50 text-rose-600 dark:text-rose-400 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Excluir Modelo</span>
              </button>

              <button
                type="button"
                onClick={() => setShowManageTemplatesModal(true)}
                title="Visualizar e gerenciar todos os modelos salvos"
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <Layers className="w-3.5 h-3.5 text-indigo-500" />
                <span>Gerenciar Todos ({savedTemplates.length})</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              {toastMessage && (
                <div className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 animate-in fade-in slide-in-from-top-1 ${
                  toastMessage.type === 'success' 
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                    : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                }`}>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  {toastMessage.text}
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  setNewTemplateName('');
                  setSaveModalError('');
                  setShowSaveModal(true);
                }}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black tracking-wider flex items-center gap-1.5 shadow-sm cursor-pointer transition-all active:scale-[0.98]"
              >
                <Save className="w-4 h-4" />
                SALVAR MODELO ATUAL
              </button>
            </div>
          </div>

          {/* TWO MAIN COLUMNS: 1. SHEET & MARGINS (mm) | 2. INDIVIDUAL FIELD STYLES */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* LEFT: SHEET SETUP & MARGINS IN MILLIMETERS (5 COLS) */}
            <div className={`lg:col-span-5 p-6 rounded-2xl border space-y-5 ${
              darkMode ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200 shadow-xs'
            }`}>
              <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <Sliders className="w-5 h-5 text-indigo-500" />
                  <h3 className="text-sm font-extrabold uppercase tracking-wider">Configuração da Folha &amp; Margens (mm)</h3>
                </div>
              </div>

              {/* Paper Format Selector */}
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1.5 font-mono">Formato do Papel Base</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => handlePaperTypeSelect('A4')}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                      sheetConfig.paperType === 'A4'
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    A4 (210 x 297)
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePaperTypeSelect('A3')}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                      sheetConfig.paperType === 'A3'
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    A3 (297 x 420)
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePaperTypeSelect('Custom')}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                      sheetConfig.paperType === 'Custom'
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Personalizado
                  </button>
                </div>
              </div>

              {/* Millimeter Grid Inputs */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1 font-mono">Colunas por Folha</label>
                  <input
                    type="number"
                    min="1"
                    max="12"
                    value={sheetConfig.columns}
                    onChange={(e) => setSheetConfig({ ...sheetConfig, columns: Math.max(1, parseInt(e.target.value) || 1) })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 font-bold"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1 font-mono">Linhas por Folha</label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={sheetConfig.rows}
                    onChange={(e) => setSheetConfig({ ...sheetConfig, rows: Math.max(1, parseInt(e.target.value) || 1) })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 font-bold"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1 font-mono">Largura Etiqueta (mm)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={sheetConfig.labelWidthMm}
                    onChange={(e) => setSheetConfig({ ...sheetConfig, labelWidthMm: parseFloat(e.target.value) || 10 })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 font-bold"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1 font-mono">Altura Etiqueta (mm)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={sheetConfig.labelHeightMm}
                    onChange={(e) => setSheetConfig({ ...sheetConfig, labelHeightMm: parseFloat(e.target.value) || 10 })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 font-bold"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1 font-mono">Margem Superior (mm)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={sheetConfig.marginTopMm}
                    onChange={(e) => setSheetConfig({ ...sheetConfig, marginTopMm: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 font-bold"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1 font-mono">Margem Esquerda (mm)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={sheetConfig.marginLeftMm}
                    onChange={(e) => setSheetConfig({ ...sheetConfig, marginLeftMm: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 font-bold"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1 font-mono">Espaço Horiz. Gap (mm)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={sheetConfig.gapXMm}
                    onChange={(e) => setSheetConfig({ ...sheetConfig, gapXMm: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 font-bold"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1 font-mono">Espaço Vert. Gap (mm)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={sheetConfig.gapYMm}
                    onChange={(e) => setSheetConfig({ ...sheetConfig, gapYMm: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 font-bold"
                  />
                </div>
              </div>

              {/* 4 Placard Orientations */}
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
                <label className="block text-[10px] font-bold uppercase text-slate-400 font-mono">Orientação Visual da Plaqueta (4 Posições)</label>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setPlacardConfig({ ...placardConfig, orientation: 'horizontal-left' })}
                    className={`py-2 px-2.5 rounded-xl border font-bold transition-all cursor-pointer ${
                      placardConfig.orientation === 'horizontal-left'
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Horizontal (QR Esq.)
                  </button>

                  <button
                    type="button"
                    onClick={() => setPlacardConfig({ ...placardConfig, orientation: 'horizontal-right' })}
                    className={`py-2 px-2.5 rounded-xl border font-bold transition-all cursor-pointer ${
                      placardConfig.orientation === 'horizontal-right'
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Horizontal (QR Dir.)
                  </button>

                  <button
                    type="button"
                    onClick={() => setPlacardConfig({ ...placardConfig, orientation: 'vertical-top' })}
                    className={`py-2 px-2.5 rounded-xl border font-bold transition-all cursor-pointer ${
                      placardConfig.orientation === 'vertical-top'
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Vertical (QR Topo)
                  </button>

                  <button
                    type="button"
                    onClick={() => setPlacardConfig({ ...placardConfig, orientation: 'vertical-bottom' })}
                    className={`py-2 px-2.5 rounded-xl border font-bold transition-all cursor-pointer ${
                      placardConfig.orientation === 'vertical-bottom'
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Vertical (QR Abaixo)
                  </button>
                </div>
              </div>

              {/* Placard Borders, Colors & QR Scale */}
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-3">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1 font-mono">Estilo de Borda</label>
                    <select
                      value={placardConfig.borderStyle}
                      onChange={(e) => setPlacardConfig({ ...placardConfig, borderStyle: e.target.value as any })}
                      className="w-full px-2.5 py-1.5 rounded-xl border bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 font-bold"
                    >
                      <option value="none">Sem Borda</option>
                      <option value="dashed">Tracejada (Guia de Corte)</option>
                      <option value="dotted">Pontilhada</option>
                      <option value="solid-thin">Linha Fina (0.25mm)</option>
                      <option value="solid-thick">Linha Grossa (0.75mm)</option>
                      <option value="badge">Plaqueta Dupla</option>
                      <option value="rounded-frame">Moldura com Rebaixo</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1 font-mono">Cor da Borda</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={placardConfig.borderColor}
                        onChange={(e) => setPlacardConfig({ ...placardConfig, borderColor: e.target.value })}
                        className="w-8 h-8 rounded-lg cursor-pointer border-0 p-0"
                      />
                      <input
                        type="text"
                        value={placardConfig.borderColor}
                        onChange={(e) => setPlacardConfig({ ...placardConfig, borderColor: e.target.value })}
                        className="w-full px-2 py-1 text-xs font-mono font-bold rounded-lg border bg-slate-50 dark:bg-slate-800"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1 font-mono">Fundo da Plaqueta</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={placardConfig.backgroundColor}
                        onChange={(e) => setPlacardConfig({ ...placardConfig, backgroundColor: e.target.value })}
                        className="w-8 h-8 rounded-lg cursor-pointer border-0 p-0"
                      />
                      <input
                        type="text"
                        value={placardConfig.backgroundColor}
                        onChange={(e) => setPlacardConfig({ ...placardConfig, backgroundColor: e.target.value })}
                        className="w-full px-2 py-1 text-xs font-mono font-bold rounded-lg border bg-slate-50 dark:bg-slate-800"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1 font-mono">Cantos Arred. (mm)</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="6"
                      value={placardConfig.borderRadiusMm}
                      onChange={(e) => setPlacardConfig({ ...placardConfig, borderRadiusMm: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-1.5 rounded-xl border bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 font-bold"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase text-slate-400 font-mono mb-1">
                    <span>Proporção do QR Code</span>
                    <span className="text-indigo-600 dark:text-indigo-400">{placardConfig.qrScalePercent}%</span>
                  </div>
                  <input
                    type="range"
                    min="20"
                    max="60"
                    value={placardConfig.qrScalePercent}
                    onChange={(e) => setPlacardConfig({ ...placardConfig, qrScalePercent: parseInt(e.target.value) })}
                    className="w-full accent-indigo-600 cursor-pointer"
                  />
                </div>
              </div>
            </div>

            {/* RIGHT: INDIVIDUAL FIELD STYLING ENGINE (7 COLS) */}
            <div className={`lg:col-span-7 p-6 rounded-2xl border space-y-5 ${
              darkMode ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200 shadow-xs'
            }`}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800 gap-2">
                <div className="flex items-center gap-2">
                  <Type className="w-5 h-5 text-indigo-500" />
                  <h3 className="text-sm font-extrabold uppercase tracking-wider">Ordem & Estilo Individual dos Campos</h3>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleResetFieldOrder}
                    className="text-[11px] font-bold text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    title="Voltar os campos para a sequência original"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Restaurar Ordem Padrão</span>
                  </button>
                </div>
              </div>

              {/* Informative Hint Banner */}
              <div className="p-3 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/40 text-[11px] text-indigo-950 dark:text-indigo-200 flex items-start gap-2">
                <Sparkles className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                <p>
                  Use os botões <strong>▲ Subir</strong> e <strong>▼ Descer</strong> para organizar a posição de cada campo na plaqueta. Ative a opção <strong>Quebrar Texto</strong> para nomes compridos e locais não serem cortados.
                </p>
              </div>

              {/* LIVE PLACARD PREVIEW CARD - BALANCES LAYOUT & ELIMINATES BLANK VOID */}
              <div className="p-4 rounded-xl border border-indigo-100 dark:border-indigo-900/60 bg-gradient-to-b from-indigo-50/40 to-white dark:from-slate-800/80 dark:to-slate-900/80 shadow-2xs space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Eye className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <span className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                      Pré-visualização em Tempo Real da Plaqueta
                    </span>
                  </div>
                  <span className="text-[11px] font-mono font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-100/60 dark:bg-indigo-950/60 px-2 py-0.5 rounded-lg border border-indigo-200 dark:border-indigo-800">
                    {sheetConfig.labelWidthMm}mm × {sheetConfig.labelHeightMm}mm
                  </span>
                </div>

                <div className="p-4 bg-slate-100 dark:bg-slate-950/60 rounded-xl flex items-center justify-center overflow-hidden border border-slate-200/80 dark:border-slate-800">
                  <div
                    style={{
                      width: `${Math.min(380, Math.max(220, sheetConfig.labelWidthMm * 3.8))}px`,
                      minHeight: `${Math.min(220, Math.max(100, sheetConfig.labelHeightMm * 2.8))}px`,
                      backgroundColor: placardConfig.backgroundColor,
                      borderColor: placardConfig.borderColor,
                      borderRadius: `${placardConfig.borderRadiusMm}mm`,
                      padding: '8px 10px',
                      display: 'flex',
                      flexDirection: currentOrientationLayout.flexDirection as any,
                      alignItems: currentOrientationLayout.flexAlign as any,
                      justifyContent: 'flex-start',
                      gap: '8px',
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)'
                    }}
                    className={placardConfig.borderStyle === 'dashed' ? 'border border-dashed' : placardConfig.borderStyle === 'dotted' ? 'border border-dotted' : placardConfig.borderStyle === 'solid-thick' ? 'border-2 border-solid' : placardConfig.borderStyle === 'none' ? 'border-0' : 'border border-solid'}
                  >
                    {/* Live QR Code Box */}
                    <div
                      style={{
                        order: currentOrientationLayout.qrOrder,
                        flexShrink: 0,
                        width: currentOrientationLayout.qrWidthPercent,
                        height: currentOrientationLayout.qrHeightPercent,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <div className="p-1 bg-white rounded-md border border-slate-200 shadow-2xs flex items-center justify-center">
                        <QrCode className="w-12 h-12 text-slate-900" />
                      </div>
                    </div>

                    {/* Live Fields Box */}
                    <div
                      style={{
                        order: currentOrientationLayout.textOrder,
                        flex: 1,
                        minWidth: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'flex-start',
                        textAlign: currentOrientationLayout.textAlign as any,
                        overflow: 'hidden'
                      }}
                    >
                      {activeFieldOrder.map((key) => {
                        const f = placardConfig.fields[key];
                        if (!f || !f.enabled) return null;
                        const sampleText = getFieldContent(key);

                        return (
                          <span
                            key={key}
                            style={{
                              fontFamily: f.fontFamily,
                              fontSize: `${Math.max(7, f.fontSizePt * 0.95)}pt`,
                              fontWeight: f.fontWeight === '900' ? 900 : f.fontWeight === 'bold' ? 700 : 400,
                              color: f.color,
                              textTransform: f.uppercase ? 'uppercase' : 'none',
                              whiteSpace: f.wordWrap ? 'normal' : 'nowrap',
                              wordBreak: f.wordWrap ? 'break-word' : 'normal',
                              overflowWrap: f.wordWrap ? 'anywhere' : 'normal',
                              overflow: 'hidden',
                              textOverflow: f.wordWrap ? 'clip' : 'ellipsis',
                              lineHeight: 1.18,
                              marginTop: '2px'
                            }}
                          >
                            {sampleText}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                  <span>Atualização instantânea com as cores e fontes configuradas abaixo.</span>
                  <span className="font-bold text-slate-600 dark:text-slate-300 font-mono">
                    {activeFieldOrder.filter(k => placardConfig.fields[k]?.enabled).length} campos visíveis
                  </span>
                </div>
              </div>

              {/* Field Cards Accordion with Up/Down Reordering */}
              <div className="space-y-3 max-h-[640px] overflow-y-auto pr-1">
                {activeFieldOrder.map((key, idx) => {
                  const f = placardConfig.fields[key];
                  const isOpen = activeFieldEdit === key;
                  const title = fieldTitles[key] || key;
                  const sample = getFieldContent(key);

                  return (
                    <div
                      key={key}
                      className={`rounded-xl border transition-all ${
                        isOpen
                          ? 'border-indigo-600 bg-indigo-50/20 dark:bg-indigo-950/20 ring-1 ring-indigo-500/30'
                          : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30'
                      }`}
                    >
                      {/* Header row of field */}
                      <div
                        onClick={() => setActiveFieldEdit(isOpen ? null : key)}
                        className="p-3.5 flex items-center justify-between cursor-pointer gap-2"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {/* Reorder Up / Down Controls */}
                          <div className="flex flex-col items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={(e) => handleMoveField(idx, 'up', e)}
                              className="p-1 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-20 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
                              title="Subir campo na etiqueta"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <span className="text-[10px] font-mono font-black text-indigo-600 dark:text-indigo-400 leading-none">
                              {idx + 1}º
                            </span>
                            <button
                              type="button"
                              disabled={idx === activeFieldOrder.length - 1}
                              onClick={(e) => handleMoveField(idx, 'down', e)}
                              className="p-1 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-20 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
                              title="Descer campo na etiqueta"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* Enable/Disable Checkbox */}
                          <input
                            type="checkbox"
                            checked={f.enabled}
                            onChange={(e) => {
                              e.stopPropagation();
                              updateField(key, { enabled: e.target.checked });
                            }}
                            className="rounded text-indigo-600 cursor-pointer w-4 h-4 shrink-0"
                            title={f.enabled ? 'Campo ativo na plaqueta' : 'Campo desativado'}
                          />

                          {/* Field Title & Visual Preview */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-black block truncate">{title}</span>
                              {f.wordWrap && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.2 text-[9px] font-bold rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
                                  <WrapText className="w-2.5 h-2.5" />
                                  Quebra
                                </span>
                              )}
                            </div>
                            <span 
                              style={{
                                fontFamily: f.fontFamily,
                                color: f.color,
                                fontWeight: f.fontWeight === '900' ? 900 : f.fontWeight === 'bold' ? 700 : 400,
                                textTransform: f.uppercase ? 'uppercase' : 'none',
                                fontSize: '11px'
                              }}
                              className="block truncate max-w-[220px] sm:max-w-xs opacity-90"
                            >
                              {sample}
                            </span>
                          </div>
                        </div>

                        {/* Right side badges */}
                        <div className="flex items-center gap-2 shrink-0">
                          <div
                            className="w-4 h-4 rounded-full border border-slate-300 dark:border-slate-700 shadow-2xs"
                            style={{ backgroundColor: f.color }}
                            title={`Cor: ${f.color}`}
                          />
                          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                            {f.fontSizePt}pt
                          </span>
                          <span className="text-slate-400 text-xs">
                            {isOpen ? '▲' : '▼'}
                          </span>
                        </div>
                      </div>

                      {/* Expanded customization controls for this specific field */}
                      {isOpen && (
                        <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-4 bg-white dark:bg-slate-900 rounded-b-xl">
                          
                          {/* If header, allow editing custom header text */}
                          {key === 'header' && (
                            <div>
                              <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1 font-mono">Texto do Cabeçalho</label>
                              <input
                                type="text"
                                value={placardConfig.headerCustomText}
                                onChange={(e) => setPlacardConfig({ ...placardConfig, headerCustomText: e.target.value })}
                                placeholder="HEXON PREVENTIVA"
                                className="w-full px-3 py-2 text-xs rounded-xl border bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 font-black"
                              />
                            </div>
                          )}

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                            {/* Font Family */}
                            <div>
                              <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1 font-mono">Família da Fonte</label>
                              <select
                                value={f.fontFamily}
                                onChange={(e) => updateField(key, { fontFamily: e.target.value })}
                                className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 font-bold"
                              >
                                {FONT_OPTIONS.map(opt => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            </div>

                            {/* Font Size (pt) */}
                            <div>
                              <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1 font-mono">Tamanho da Fonte (pt)</label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="number"
                                  step="0.5"
                                  min="4"
                                  max="36"
                                  value={f.fontSizePt}
                                  onChange={(e) => updateField(key, { fontSizePt: parseFloat(e.target.value) || 8 })}
                                  className="w-20 px-3 py-2 rounded-xl border bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 font-black font-mono text-center"
                                />
                                <input
                                  type="range"
                                  min="5"
                                  max="28"
                                  step="0.5"
                                  value={f.fontSizePt}
                                  onChange={(e) => updateField(key, { fontSizePt: parseFloat(e.target.value) })}
                                  className="w-full accent-indigo-600 cursor-pointer"
                                />
                              </div>
                            </div>

                            {/* Font Weight */}
                            <div>
                              <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1 font-mono">Peso / Destaque</label>
                              <div className="grid grid-cols-3 gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => updateField(key, { fontWeight: 'normal' })}
                                  className={`py-1.5 px-2 rounded-lg border text-xs font-medium cursor-pointer ${
                                    f.fontWeight === 'normal' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                                  }`}
                                >
                                  Normal
                                </button>
                                <button
                                  type="button"
                                  onClick={() => updateField(key, { fontWeight: 'bold' })}
                                  className={`py-1.5 px-2 rounded-lg border text-xs font-bold cursor-pointer ${
                                    f.fontWeight === 'bold' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                                  }`}
                                >
                                  Negrito
                                </button>
                                <button
                                  type="button"
                                  onClick={() => updateField(key, { fontWeight: '900' })}
                                  className={`py-1.5 px-2 rounded-lg border text-xs font-black cursor-pointer ${
                                    f.fontWeight === '900' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                                  }`}
                                >
                                  Black
                                </button>
                              </div>
                            </div>

                            {/* Color Picker */}
                            <div>
                              <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1 font-mono">Cor do Texto</label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="color"
                                  value={f.color}
                                  onChange={(e) => updateField(key, { color: e.target.value })}
                                  className="w-9 h-9 rounded-lg cursor-pointer border-0 p-0"
                                />
                                <input
                                  type="text"
                                  value={f.color}
                                  onChange={(e) => updateField(key, { color: e.target.value })}
                                  className="w-full px-3 py-2 text-xs font-mono font-bold rounded-xl border bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700"
                                />
                              </div>
                            </div>
                          </div>

                          {/* Options: Word Wrap and Uppercase */}
                          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
                            {/* Word Wrap Toggle (Quebrar Texto) */}
                            <label className="flex items-start gap-2.5 text-xs font-semibold cursor-pointer p-2.5 rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/40 dark:bg-indigo-950/20 hover:bg-indigo-50/70 dark:hover:bg-indigo-950/40 transition-colors">
                              <input
                                type="checkbox"
                                checked={f.wordWrap ?? false}
                                onChange={(e) => updateField(key, { wordWrap: e.target.checked })}
                                className="rounded text-indigo-600 cursor-pointer mt-0.5 w-4 h-4"
                              />
                              <div className="flex-1">
                                <span className="font-bold flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
                                  <WrapText className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                                  Quebrar texto para textos grandes caberem na etiqueta
                                </span>
                                <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400 block mt-0.5 leading-snug">
                                  Quando ativado, o texto desce para as linhas seguintes caso exceda a largura da plaqueta (evita reticências e cortes).
                                </span>
                              </div>
                            </label>

                            {/* Uppercase toggle */}
                            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer px-1">
                              <input
                                type="checkbox"
                                checked={f.uppercase}
                                onChange={(e) => updateField(key, { uppercase: e.target.checked })}
                                className="rounded text-indigo-600 cursor-pointer"
                              />
                              <span>Forçar Texto em Maiúsculas (UPPERCASE)</span>
                            </label>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: REALISTIC WYSIWYG PREVIEW */}
      {activeTab === 'preview' && (
        <div className="space-y-4">
          {/* Controls bar */}
          <div className={`p-4 rounded-2xl border flex flex-wrap items-center justify-between gap-4 ${
            darkMode ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200'
          }`}>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPreviewPage(p => Math.max(1, p - 1))}
                disabled={previewPage <= 1}
                className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 disabled:opacity-30 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <span className="text-xs font-bold font-mono px-3">
                Folha <strong className="text-indigo-600 dark:text-indigo-400">{previewPage}</strong> de <strong>{totalPages}</strong> ({sheetConfig.paperType})
              </span>

              <button
                onClick={() => setPreviewPage(p => Math.min(totalPages, p + 1))}
                disabled={previewPage >= totalPages}
                className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 disabled:opacity-30 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-slate-500 font-medium">
              Mostrando etiquetas <strong className="text-slate-800 dark:text-slate-200 font-mono">{startIndex + 1}</strong> a <strong className="text-slate-800 dark:text-slate-200 font-mono">{Math.min(startIndex + labelsPerPage, selectedAssetsToPrint.length)}</strong> de <strong className="text-indigo-600 dark:text-indigo-400 font-mono">{selectedAssetsToPrint.length}</strong>
            </div>

            <button
              onClick={handlePrintBatch}
              disabled={selectedAssetsToPrint.length === 0 || isPrinting}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black tracking-wider flex items-center gap-2 shadow-sm cursor-pointer transition-all"
            >
              <Printer className="w-4 h-4" />
              IMPRIMIR TODAS AS {totalPages} FOLHAS
            </button>
          </div>

          {/* PHYSICAL SHEET PREVIEW IN EXACT MILLIMETERS */}
          <div className="p-8 bg-slate-300 dark:bg-slate-950/80 rounded-2xl overflow-x-auto flex justify-center border border-slate-400/30">
            <div 
              style={{
                width: `${sheetConfig.pageWidthMm}mm`,
                minHeight: `${sheetConfig.pageHeightMm}mm`,
                paddingTop: `${sheetConfig.marginTopMm}mm`,
                paddingLeft: `${sheetConfig.marginLeftMm}mm`,
                background: '#ffffff',
                boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.25), 0 8px 10px -6px rgba(0, 0, 0, 0.2)',
                color: '#0f172a'
              }}
              className="relative transition-all"
            >
              <div 
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${sheetConfig.columns}, ${sheetConfig.labelWidthMm}mm)`,
                  gridAutoRows: `${sheetConfig.labelHeightMm}mm`,
                  columnGap: `${sheetConfig.gapXMm}mm`,
                  rowGap: `${sheetConfig.gapYMm}mm`
                }}
              >
                {previewPageAssets.map((asset) => {
                  const comarcaStr = asset.specs?.COMARCA || asset.specs?.comarca || (asset.location ? asset.location.split(' - ')[0] : 'Geral');
                  const sectorStr = asset.sector || '';
                  const modelStr = asset.specs?.model || asset.specs?.MODELO || '';
                  const serialStr = asset.specs?.serialNumber || asset.specs?.['Nº DE SÉRIE'] || '';

                  let borderCss = 'none';
                  if (placardConfig.borderStyle === 'dashed') borderCss = `0.25mm dashed ${placardConfig.borderColor}`;
                  else if (placardConfig.borderStyle === 'dotted') borderCss = `0.25mm dotted ${placardConfig.borderColor}`;
                  else if (placardConfig.borderStyle === 'solid-thin') borderCss = `0.25mm solid ${placardConfig.borderColor}`;
                  else if (placardConfig.borderStyle === 'solid-thick') borderCss = `0.75mm solid ${placardConfig.borderColor}`;
                  else if (placardConfig.borderStyle === 'badge') borderCss = `0.6mm solid ${placardConfig.borderColor}`;

                  // Flex direction and ordering for preview
                  let isRow = placardConfig.orientation === 'horizontal-left' || placardConfig.orientation === 'horizontal-right';
                  let qrOrder = (placardConfig.orientation === 'horizontal-left' || placardConfig.orientation === 'vertical-top') ? 0 : 1;
                  let textOrder = qrOrder === 0 ? 1 : 0;
                  let textAlign = isRow ? 'left' : 'center';

                  return (
                    <div
                      key={asset.id}
                      style={{
                        width: `${sheetConfig.labelWidthMm}mm`,
                        height: `${sheetConfig.labelHeightMm}mm`,
                        border: borderCss,
                        borderRadius: `${placardConfig.borderRadiusMm}mm`,
                        padding: '1.5mm',
                        display: 'flex',
                        flexDirection: isRow ? 'row' : 'column',
                        alignItems: 'center',
                        justifyContent: isRow ? 'flex-start' : 'center',
                        gap: '2mm',
                        overflow: 'hidden',
                        background: placardConfig.backgroundColor,
                        boxSizing: 'border-box'
                      }}
                    >
                      {/* Dynamic Vector QR Code */}
                      <div 
                        style={{
                          order: qrOrder,
                          width: isRow ? `${placardConfig.qrScalePercent}%` : '100%',
                          height: isRow ? '100%' : `${placardConfig.qrScalePercent}%`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0
                        }}
                      >
                        <AssetQrCode assetId={asset.id} size={130} className="w-full h-full object-contain mix-blend-multiply" />
                      </div>

                      {/* Tag Metadata with Individual Field Styles & Dynamic Order */}
                      <div 
                        style={{
                          order: textOrder,
                          flex: 1,
                          minWidth: 0,
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'center',
                          textAlign: textAlign as any,
                          overflow: 'hidden'
                        }}
                      >
                        {activeFieldOrder.map((key) => {
                          const f = placardConfig.fields[key];
                          if (!f || !f.enabled) return null;
                          const text = getFieldContent(key, asset);
                          if (!text) return null;

                          return (
                            <span 
                              key={key}
                              style={{
                                fontFamily: f.fontFamily,
                                fontSize: `${f.fontSizePt}pt`,
                                fontWeight: f.fontWeight === '900' ? 900 : f.fontWeight === 'bold' ? 700 : 400,
                                color: f.color,
                                textTransform: f.uppercase ? 'uppercase' : 'none',
                                whiteSpace: f.wordWrap ? 'normal' : 'nowrap',
                                wordBreak: f.wordWrap ? 'break-word' : 'normal',
                                overflowWrap: f.wordWrap ? 'anywhere' : 'normal',
                                overflow: 'hidden',
                                textOverflow: f.wordWrap ? 'clip' : 'ellipsis',
                                lineHeight: 1.16,
                                marginTop: '0.3mm'
                              }}
                            >
                              {text}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: SALVAR NOVO MODELO */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs z-[9999] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Save className="w-5 h-5 text-emerald-600" />
                <h3 className="text-base font-extrabold uppercase tracking-tight">Salvar Modelo de Etiqueta</h3>
              </div>
              <button
                onClick={() => setShowSaveModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              Todas as margens em milímetros, medidas da folha, formato (A4/A3), bordas, cores e tipografias individuais dos campos serão salvas para você carregar sempre que precisar.
            </p>

            {saveModalError && (
              <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs font-bold text-rose-600 dark:text-rose-400 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{saveModalError}</span>
              </div>
            )}

            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1 font-mono">Nome do Modelo</label>
              <input
                type="text"
                value={newTemplateName}
                onChange={(e) => {
                  setNewTemplateName(e.target.value);
                  if (saveModalError) setSaveModalError('');
                }}
                placeholder="Ex: Plaqueta Metálica Roxa 100x50"
                className="w-full px-3 py-2 text-xs rounded-xl border bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                autoFocus
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={isSavingTemplate}
                onClick={() => setShowSaveModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isSavingTemplate}
                onClick={handleSaveCurrentAsNewTemplate}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-black tracking-wider flex items-center gap-1.5 shadow-sm cursor-pointer disabled:cursor-not-allowed"
              >
                {isSavingTemplate ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Salvando no Banco...
                  </>
                ) : (
                  <>
                    <Database className="w-4 h-4" />
                    Salvar no Banco de Dados
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CONFIRMAR EXCLUSÃO DE MODELO */}
      {templateToDelete && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs z-[9999] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-start gap-3">
              <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900/60 shrink-0">
                <Trash2 className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-extrabold tracking-tight text-slate-900 dark:text-white">Excluir Modelo do Banco</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Tem certeza que deseja excluir o modelo <strong className="text-slate-800 dark:text-slate-200 font-bold">"{templateToDelete.name}"</strong> do banco de dados na nuvem?
                </p>
                {savedTemplates.length <= 1 && (
                  <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 p-2.5 rounded-xl mt-2">
                    Aviso: Como este é o único modelo cadastrado, o sistema reinicializará os padrões originais de fábrica para que você continue usando o editor normalmente.
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                disabled={isDeletingTemplate}
                onClick={() => setTemplateToDelete(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isDeletingTemplate}
                onClick={handleConfirmDeleteTemplate}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-xl text-xs font-black tracking-wider flex items-center gap-1.5 shadow-sm cursor-pointer transition-colors active:scale-[0.98] disabled:cursor-not-allowed"
              >
                {isDeletingTemplate ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Excluindo do Banco...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Sim, Excluir do Banco
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: GERENCIAR TODOS OS MODELOS SALVOS */}
      {showManageTemplatesModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs z-[9998] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-xl w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 flex flex-col max-h-[85vh]">
            <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/60">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-white">Gerenciar Modelos Salvos</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Selecione um modelo para carregar no editor ou exclua modelos que não utiliza mais.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowManageTemplatesModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 space-y-3">
              {savedTemplates.map((tpl) => {
                const isCurrent = tpl.id === selectedTemplateId;
                const labelCount = tpl.sheet.columns * tpl.sheet.rows;
                return (
                  <div
                    key={tpl.id}
                    className={`pt-3 first:pt-0 flex items-center justify-between gap-3 p-3 rounded-xl transition-all ${
                      isCurrent
                        ? 'bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/80'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 border border-transparent'
                    }`}
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-slate-900 dark:text-white truncate">
                          {tpl.name}
                        </span>
                        {isCurrent && (
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-indigo-600 text-white shrink-0">
                            Ativo
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                        <span>{tpl.sheet.paperType} ({tpl.sheet.pageWidthMm}×{tpl.sheet.pageHeightMm}mm)</span>
                        <span>•</span>
                        <span>{labelCount} etiq./folha ({tpl.sheet.labelWidthMm}×{tpl.sheet.labelHeightMm}mm)</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {!isCurrent && (
                        <button
                          type="button"
                          onClick={() => {
                            handleLoadTemplate(tpl.id);
                            setShowManageTemplatesModal(false);
                            setToastMessage({ text: `Modelo "${tpl.name}" carregado!`, type: 'info' });
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100/60 dark:hover:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 transition-colors cursor-pointer"
                        >
                          Carregar
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteTemplateById(tpl.id, e);
                        }}
                        title="Excluir este modelo"
                        className="p-1.5 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/60 border border-rose-200 dark:border-rose-900/60 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setShowManageTemplatesModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

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
