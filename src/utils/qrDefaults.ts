// src/utils/qrDefaults.ts - Configurações e Modelos Padrão para Etiquetas e QR Codes
import { SheetConfig, PlacardConfig, SavedQrTemplate, FieldKey } from '../types';

export const FONT_OPTIONS = [
  { label: 'Arial (Padrão)', value: 'Arial, sans-serif' },
  { label: 'Arial Black (Extra Negrito)', value: '"Arial Black", Gadget, sans-serif' },
  { label: 'Trebuchet MS (Moderna)', value: '"Trebuchet MS", "Lucida Grande", sans-serif' },
  { label: 'Monospace (Técnica / Código)', value: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
  { label: 'Impact (Industrial / Chamativa)', value: 'Impact, Haettenschweiler, sans-serif' },
  { label: 'Georgia (Serifada Elegante)', value: 'Georgia, "Times New Roman", serif' },
];

export const DEFAULT_FIELD_ORDER: FieldKey[] = [
  'header',
  'code',
  'name',
  'comarca',
  'location',
  'sector',
  'model',
  'serial'
];

export const DEFAULT_SHEET_CONFIG: SheetConfig = {
  paperType: 'A4',
  pageWidthMm: 210,
  pageHeightMm: 297,
  labelWidthMm: 63.5,
  labelHeightMm: 25.4,
  columns: 3,
  rows: 8,
  marginTopMm: 12.7,
  marginLeftMm: 7.2,
  gapXMm: 2.5,
  gapYMm: 0,
};

export const DEFAULT_PLACARD_CONFIG: PlacardConfig = {
  orientation: 'horizontal-left',
  qrScalePercent: 38,
  borderStyle: 'dashed',
  borderColor: '#94a3b8',
  borderRadiusMm: 1.5,
  backgroundColor: '#ffffff',
  headerCustomText: 'HEXON PREVENTIVA',
  fieldOrder: [...DEFAULT_FIELD_ORDER],
  fields: {
    header: {
      enabled: true,
      fontFamily: '"Arial Black", Gadget, sans-serif',
      fontSizePt: 9,
      fontWeight: '900',
      color: '#7c3aed', // Roxo de destaque
      uppercase: true,
      wordWrap: false
    },
    code: {
      enabled: true,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      fontSizePt: 10,
      fontWeight: '900',
      color: '#0f172a',
      uppercase: true,
      wordWrap: false
    },
    name: {
      enabled: true,
      fontFamily: 'Arial, sans-serif',
      fontSizePt: 8,
      fontWeight: 'bold',
      color: '#1e293b',
      uppercase: false,
      wordWrap: true
    },
    comarca: {
      enabled: true,
      fontFamily: '"Arial Black", Gadget, sans-serif',
      fontSizePt: 7.5,
      fontWeight: 'bold',
      color: '#4338ca',
      uppercase: true,
      wordWrap: false
    },
    location: {
      enabled: true,
      fontFamily: 'Arial, sans-serif',
      fontSizePt: 6.5,
      fontWeight: 'normal',
      color: '#64748b',
      uppercase: false,
      wordWrap: true
    },
    sector: {
      enabled: true,
      fontFamily: 'Arial, sans-serif',
      fontSizePt: 6.5,
      fontWeight: 'bold',
      color: '#64748b',
      uppercase: true,
      wordWrap: false
    },
    model: {
      enabled: true,
      fontFamily: 'Arial, sans-serif',
      fontSizePt: 6.5,
      fontWeight: 'normal',
      color: '#64748b',
      uppercase: false,
      wordWrap: false
    },
    serial: {
      enabled: false,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      fontSizePt: 6.5,
      fontWeight: 'normal',
      color: '#64748b',
      uppercase: true,
      wordWrap: false
    }
  }
};

export const DEFAULT_SAVED_TEMPLATES: SavedQrTemplate[] = [
  {
    id: 'tpl_a4_pimaco_roxo',
    name: 'A4 3x8 - Destaque Roxo & Arial Black',
    createdAt: '2026-09-10',
    sheet: { ...DEFAULT_SHEET_CONFIG },
    placard: { ...DEFAULT_PLACARD_CONFIG }
  },
  {
    id: 'tpl_a4_plaqueta_industrial',
    name: 'A4 2x5 - Plaqueta Grande Industrial',
    createdAt: '2026-09-10',
    sheet: {
      paperType: 'A4',
      pageWidthMm: 210,
      pageHeightMm: 297,
      labelWidthMm: 101.6,
      labelHeightMm: 50.8,
      columns: 2,
      rows: 5,
      marginTopMm: 12.7,
      marginLeftMm: 4.8,
      gapXMm: 2.0,
      gapYMm: 0,
    },
    placard: {
      ...DEFAULT_PLACARD_CONFIG,
      borderStyle: 'badge',
      borderColor: '#0f172a',
      borderRadiusMm: 2,
      fields: {
        ...DEFAULT_PLACARD_CONFIG.fields,
        header: {
          enabled: true,
          fontFamily: '"Arial Black", Gadget, sans-serif',
          fontSizePt: 13,
          fontWeight: '900',
          color: '#7c3aed',
          uppercase: true
        },
        code: {
          enabled: true,
          fontFamily: '"Arial Black", Gadget, sans-serif',
          fontSizePt: 15,
          fontWeight: '900',
          color: '#000000',
          uppercase: true
        },
        name: {
          enabled: true,
          fontFamily: 'Arial, sans-serif',
          fontSizePt: 11,
          fontWeight: 'bold',
          color: '#1e293b',
          uppercase: true
        },
        comarca: {
          enabled: true,
          fontFamily: '"Arial Black", Gadget, sans-serif',
          fontSizePt: 10,
          fontWeight: 'bold',
          color: '#312e81',
          uppercase: true
        }
      }
    }
  },
  {
    id: 'tpl_a3_lote_massivo',
    name: 'A3 4x12 - Folha Dupla A3 (48 por Folha)',
    createdAt: '2026-09-10',
    sheet: {
      paperType: 'A3',
      pageWidthMm: 297,
      pageHeightMm: 420,
      labelWidthMm: 65,
      labelHeightMm: 30,
      columns: 4,
      rows: 12,
      marginTopMm: 15,
      marginLeftMm: 15,
      gapXMm: 4,
      gapYMm: 2.5,
    },
    placard: {
      ...DEFAULT_PLACARD_CONFIG,
      borderStyle: 'solid-thin',
      borderColor: '#cbd5e1'
    }
  }
];
