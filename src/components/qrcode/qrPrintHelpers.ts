import { Asset, FieldKey, FieldStyle, PlacardConfig, SheetConfig } from '../../types';
import { getAssetQrDataUrl } from '../../utils/qrUtils';

export const getFieldContent = (key: FieldKey, headerCustomText: string, asset?: Asset): string => {
  switch (key) {
    case 'header':
      return headerCustomText || 'HEXON PREVENTIVA';
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
    default:
      return '';
  }
};

export const getBorderCssValue = (style: string, color: string): string => {
  switch (style) {
    case 'dashed':
      return `0.25mm dashed ${color}`;
    case 'dotted':
      return `0.25mm dotted ${color}`;
    case 'solid-thin':
      return `0.25mm solid ${color}`;
    case 'solid-thick':
      return `0.75mm solid ${color}`;
    case 'badge':
      return `0.6mm solid ${color}`;
    case 'rounded-frame':
      return `0.4mm solid ${color}`;
    default:
      return 'none';
  }
};

export interface PrintBatchOptions {
  selectedAssets: Asset[];
  sheetConfig: SheetConfig;
  placardConfig: PlacardConfig;
  activeFieldOrder: FieldKey[];
  onProgress?: (msg: string) => void;
}

export async function executeBatchPrint({
  selectedAssets,
  sheetConfig,
  placardConfig,
  activeFieldOrder,
  onProgress
}: PrintBatchOptions): Promise<void> {
  if (selectedAssets.length === 0) {
    alert('Selecione ao menos 1 ativo para imprimir.');
    return;
  }

  onProgress?.(`Gerando QR Codes para ${selectedAssets.length} ativos...`);

  const qrDataUrls: { [assetId: string]: string } = {};
  const batchChunk = 40;
  for (let i = 0; i < selectedAssets.length; i += batchChunk) {
    const chunk = selectedAssets.slice(i, i + batchChunk);
    await Promise.all(
      chunk.map(async (asset) => {
        qrDataUrls[asset.id] = await getAssetQrDataUrl(asset.id, 260);
      })
    );
    onProgress?.(`Processando (${Math.min(i + batchChunk, selectedAssets.length)} de ${selectedAssets.length})...`);
  }

  onProgress?.('Montando páginas de impressão de alta fidelidade...');

  const win = window.open('', '_blank');
  if (!win) {
    alert('Por favor, permita pop-ups neste navegador para abrir a página de impressão.');
    return;
  }

  const labelsPerPage = Math.max(1, sheetConfig.columns * sheetConfig.rows);
  const pages: Asset[][] = [];
  for (let i = 0; i < selectedAssets.length; i += labelsPerPage) {
    pages.push(selectedAssets.slice(i, i + labelsPerPage));
  }

  const borderCss = `border: ${getBorderCssValue(placardConfig.borderStyle, placardConfig.borderColor)};`;

  // Flex direction and ordering logic for orientations
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
        <title>Lote de QR Codes - Hexon Preventiva (${selectedAssets.length} Ativos)</title>
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
                        const text = getFieldContent(key, placardConfig.headerCustomText, asset);
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
}
