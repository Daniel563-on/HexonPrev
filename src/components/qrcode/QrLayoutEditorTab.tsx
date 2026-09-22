import React, { useState, useMemo } from 'react';
import { 
  FolderOpen, 
  Trash2, 
  Layers, 
  Check, 
  Save, 
  Sliders, 
  Type, 
  RotateCcw, 
  Sparkles, 
  Eye, 
  QrCode, 
  ArrowUp, 
  ArrowDown, 
  WrapText, 
  Cloud 
} from 'lucide-react';
import { 
  Asset, 
  FieldKey, 
  FieldStyle, 
  PlacardConfig, 
  SavedQrTemplate, 
  SheetConfig 
} from '../../types';
import { AssetQrCode } from '../AssetQrCode';
import { getBorderCssValue, getFieldContent } from './qrPrintHelpers';

export const FONT_OPTIONS = [
  { label: 'Inter (Padrão Limpo)', value: 'Inter, sans-serif' },
  { label: 'Arial (Alta Legibilidade)', value: 'Arial, sans-serif' },
  { label: 'Roboto (Moderno)', value: 'Roboto, sans-serif' },
  { label: 'Courier New (Monospaçado)', value: '"Courier New", monospace' },
  { label: 'Trebuchet MS (Corporativo)', value: '"Trebuchet MS", sans-serif' },
  { label: 'Verdana (Econômico)', value: 'Verdana, sans-serif' },
  { label: 'Georgia (Serifado Elegante)', value: 'Georgia, serif' }
];

export const FIELD_TITLES: Record<FieldKey, string> = {
  header: 'Cabeçalho Superior',
  code: 'Código Patrimonial',
  name: 'Nome do Equipamento',
  comarca: 'Comarca / Unidade',
  location: 'Localização / Sala',
  sector: 'Setor / Departamento',
  model: 'Modelo do Ativo',
  serial: 'Número de Série'
};

const DEFAULT_FIELD_ORDER: FieldKey[] = [
  'header',
  'code',
  'name',
  'comarca',
  'location',
  'sector',
  'model',
  'serial'
];

export interface QrLayoutEditorTabProps {
  sheetConfig: SheetConfig;
  setSheetConfig: React.Dispatch<React.SetStateAction<SheetConfig>>;
  placardConfig: PlacardConfig;
  setPlacardConfig: React.Dispatch<React.SetStateAction<PlacardConfig>>;
  savedTemplates: SavedQrTemplate[];
  selectedTemplateId: string;
  loadingTemplates: boolean;
  onLoadTemplate: (id: string) => void;
  onPromptDeleteTemplate: (id: string, e: React.MouseEvent) => void;
  onOpenManageTemplatesModal: () => void;
  onOpenSaveModal: () => void;
  toastMessage: { text: string; type: 'success' | 'info' | 'error' } | null;
  activeFieldOrder: FieldKey[];
  onMoveField: (index: number, direction: 'up' | 'down', e: React.MouseEvent) => void;
  onResetFieldOrder: () => void;
  sampleAsset?: Asset;
  darkMode: boolean;
}

export const QrLayoutEditorTab: React.FC<QrLayoutEditorTabProps> = ({
  sheetConfig,
  setSheetConfig,
  placardConfig,
  setPlacardConfig,
  savedTemplates,
  selectedTemplateId,
  loadingTemplates,
  onLoadTemplate,
  onPromptDeleteTemplate,
  onOpenManageTemplatesModal,
  onOpenSaveModal,
  toastMessage,
  activeFieldOrder,
  onMoveField,
  onResetFieldOrder,
  sampleAsset,
  darkMode
}) => {
  const [activeFieldEdit, setActiveFieldEdit] = useState<FieldKey | null>('header');

  const handlePaperTypeSelect = (paper: 'A4' | 'A3' | 'Custom') => {
    if (paper === 'A4') {
      setSheetConfig(prev => ({
        ...prev,
        paperType: 'A4',
        pageWidthMm: 210,
        pageHeightMm: 297
      }));
    } else if (paper === 'A3') {
      setSheetConfig(prev => ({
        ...prev,
        paperType: 'A3',
        pageWidthMm: 297,
        pageHeightMm: 420
      }));
    } else {
      setSheetConfig(prev => ({
        ...prev,
        paperType: 'Custom'
      }));
    }
  };

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

  return (
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
            onChange={(e) => onLoadTemplate(e.target.value)}
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
            onClick={(e) => onPromptDeleteTemplate(selectedTemplateId, e)}
            title="Excluir o modelo atualmente selecionado"
            className="px-3 py-1.5 rounded-xl border border-rose-200 dark:border-rose-900/70 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/50 text-rose-600 dark:text-rose-400 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Excluir Modelo</span>
          </button>

          <button
            type="button"
            onClick={onOpenManageTemplatesModal}
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
            onClick={onOpenSaveModal}
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
              <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1 font-mono">Margem Topo (mm)</label>
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
              <h3 className="text-sm font-extrabold uppercase tracking-wider">Ordem &amp; Estilo Individual dos Campos</h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onResetFieldOrder}
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

          {/* LIVE PLACARD PREVIEW CARD */}
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
                className={
                  placardConfig.borderStyle === 'dashed' 
                    ? 'border border-dashed' 
                    : placardConfig.borderStyle === 'dotted' 
                    ? 'border border-dotted' 
                    : placardConfig.borderStyle === 'solid-thick' 
                    ? 'border-2 border-solid' 
                    : placardConfig.borderStyle === 'none' 
                    ? 'border-0' 
                    : 'border border-solid'
                }
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
                    {sampleAsset ? (
                      <AssetQrCode assetId={sampleAsset.id} size={48} className="w-12 h-12 text-slate-900 mix-blend-multiply" />
                    ) : (
                      <QrCode className="w-12 h-12 text-slate-900" />
                    )}
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
                    const sampleText = getFieldContent(key, placardConfig.headerCustomText, sampleAsset);
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
              const title = FIELD_TITLES[key] || key;
              const sample = getFieldContent(key, placardConfig.headerCustomText, sampleAsset);

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
                          onClick={(e) => onMoveField(idx, 'up', e)}
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
                          onClick={(e) => onMoveField(idx, 'down', e)}
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
                      />

                      <div className="min-w-0">
                        <span className="font-extrabold text-xs block truncate text-slate-800 dark:text-slate-100">
                          {title}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono block truncate">
                          {sample}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] font-mono text-slate-400 hidden sm:inline">
                        {f.fontSizePt}pt • {f.fontWeight}
                      </span>
                      <div
                        className="w-3.5 h-3.5 rounded-full border border-slate-300 dark:border-slate-600"
                        style={{ backgroundColor: f.color }}
                      />
                    </div>
                  </div>

                  {/* Expanded Settings Panel for this field */}
                  {isOpen && (
                    <div className="p-4 border-t border-indigo-100 dark:border-indigo-900/40 bg-white dark:bg-slate-900/60 rounded-b-xl space-y-4">
                      {key === 'header' && (
                        <div>
                          <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1 font-mono">
                            Texto do Cabeçalho
                          </label>
                          <input
                            type="text"
                            value={placardConfig.headerCustomText}
                            onChange={(e) => setPlacardConfig({ ...placardConfig, headerCustomText: e.target.value })}
                            className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-xs font-bold"
                            placeholder="Ex: HEXON PREVENTIVA"
                          />
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
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
                        {/* Word Wrap Toggle */}
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
  );
};

export default QrLayoutEditorTab;
