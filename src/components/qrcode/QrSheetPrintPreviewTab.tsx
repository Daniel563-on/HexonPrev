import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight, Printer } from 'lucide-react';
import { Asset, FieldKey, PlacardConfig, SheetConfig } from '../../types';
import { AssetQrCode } from '../AssetQrCode';
import { getBorderCssValue, getFieldContent } from './qrPrintHelpers';

export interface QrSheetPrintPreviewTabProps {
  sheetConfig: SheetConfig;
  placardConfig: PlacardConfig;
  selectedAssetsToPrint: Asset[];
  previewPage: number;
  setPreviewPage: React.Dispatch<React.SetStateAction<number>>;
  totalPages: number;
  labelsPerPage: number;
  activeFieldOrder: FieldKey[];
  isPrinting: boolean;
  onPrintBatch: () => void;
  darkMode: boolean;
}

export const QrSheetPrintPreviewTab = React.memo(function QrSheetPrintPreviewTab({
  sheetConfig,
  placardConfig,
  selectedAssetsToPrint,
  previewPage,
  setPreviewPage,
  totalPages,
  labelsPerPage,
  activeFieldOrder,
  isPrinting,
  onPrintBatch,
  darkMode
}: QrSheetPrintPreviewTabProps) {
  const startIndex = (previewPage - 1) * labelsPerPage;
  const previewPageAssets = useMemo(() => {
    return selectedAssetsToPrint.slice(startIndex, startIndex + labelsPerPage);
  }, [selectedAssetsToPrint, startIndex, labelsPerPage]);

  const borderCss = useMemo(() => {
    return getBorderCssValue(placardConfig.borderStyle, placardConfig.borderColor);
  }, [placardConfig.borderStyle, placardConfig.borderColor]);

  // Flex direction and ordering for preview
  const isRow = placardConfig.orientation === 'horizontal-left' || placardConfig.orientation === 'horizontal-right';
  const qrOrder = (placardConfig.orientation === 'horizontal-left' || placardConfig.orientation === 'vertical-top') ? 0 : 1;
  const textOrder = qrOrder === 0 ? 1 : 0;
  const textAlign = isRow ? 'left' : 'center';

  return (
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
            title="Folha anterior"
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
            title="Próxima folha"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="text-xs text-slate-500 font-medium">
          Mostrando etiquetas <strong className="text-slate-800 dark:text-slate-200 font-mono">{selectedAssetsToPrint.length === 0 ? 0 : startIndex + 1}</strong> a <strong className="text-slate-800 dark:text-slate-200 font-mono">{Math.min(startIndex + labelsPerPage, selectedAssetsToPrint.length)}</strong> de <strong className="text-indigo-600 dark:text-indigo-400 font-mono">{selectedAssetsToPrint.length}</strong>
        </div>

        <button
          onClick={onPrintBatch}
          disabled={selectedAssetsToPrint.length === 0 || isPrinting}
          className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black tracking-wider flex items-center gap-2 shadow-sm cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
                      const text = getFieldContent(key, placardConfig.headerCustomText, asset);
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
  );
});

export default QrSheetPrintPreviewTab;
