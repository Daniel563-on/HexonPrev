import { PDFDocument, rgb, StandardFonts } from './pdfHelper';
import { PdfTemplateConfig, PdfMappingPin, ServiceOrder, Asset, MaintenanceTemplate, formatDateBR } from '../types';

/**
 * Converte cor hexadecimal (#RRGGBB) para valores rgb do pdf-lib (0-1)
 */
function hexToRgb(hexStr?: string) {
  if (!hexStr || !hexStr.startsWith('#') || (hexStr.length !== 7 && hexStr.length !== 4)) {
    return rgb(0.04, 0.11, 0.19); // Default dark navy
  }
  let hex = hexStr.slice(1);
  if (hex.length === 3) {
    hex = hex.split('').map(c => c + c).join('');
  }
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  return rgb(isNaN(r) ? 0 : r, isNaN(g) ? 0 : g, isNaN(b) ? 0 : b);
}

/**
 * Obtém o valor textual ou marcação para um marcador (Pin) baseado nos dados da OS
 */
export function getPinValue(
  pin: PdfMappingPin,
  order?: Partial<ServiceOrder> | null,
  asset?: Partial<Asset> | null,
  template?: Partial<MaintenanceTemplate> | null
): { text?: string; isImage?: boolean; imageData?: string } {
  // Simulação / Fallback quando nenhum dado real for passado (modo teste)
  const isMock = !order && !asset;

  if (pin.fieldType === 'fixed_text') {
    return { text: pin.fixedText || '' };
  }

  if (pin.fieldType === 'os_id') {
    return { text: order?.id ? `#${order.id}` : (isMock ? '#OS-2026-9481' : '') };
  }

  if (pin.fieldType === 'os_title') {
    return { text: order?.title || template?.name || (isMock ? 'Preventiva Mensal do Sistema' : '') };
  }

  if (pin.fieldType === 'technician') {
    return { text: order?.assignedTechnician || (isMock ? 'Daniel Torres (Técnico Responsável)' : '') };
  }

  if (pin.fieldType === 'scheduled_date') {
    const rawDate = order?.scheduledDate || order?.startDate || (isMock ? new Date().toISOString().slice(0, 10) : '');
    return { text: formatDateBR(rawDate) };
  }

  if (pin.fieldType === 'asset_name') {
    return { text: order?.assetName || asset?.name || (isMock ? 'Chiller de Água Gelada - Torre A' : '') };
  }

  if (pin.fieldType === 'asset_code') {
    return { text: order?.assetCode || asset?.code || (isMock ? 'PAT-HVAC-00829' : '') };
  }

  if (pin.fieldType === 'asset_sector') {
    return { text: order?.sector || asset?.sector || template?.targetSectorOrType || (isMock ? 'Refrigeração / HVAC' : '') };
  }

  if (pin.fieldType === 'asset_location') {
    return { text: order?.surveyLocation || asset?.location || (isMock ? 'Comarca Capital - Sala de Máquinas 02' : '') };
  }

  if (pin.fieldType === 'asset_specs') {
    if (asset?.specs) {
      const parts = [
        asset.specs.manufacturer ? `Fab: ${asset.specs.manufacturer}` : '',
        asset.specs.model ? `Mod: ${asset.specs.model}` : '',
        asset.specs.serialNumber ? `S/N: ${asset.specs.serialNumber}` : '',
        asset.specs.voltage ? `Tens: ${asset.specs.voltage}` : '',
        asset.specs.power ? `Pot: ${asset.specs.power}` : ''
      ].filter(Boolean);
      return { text: parts.join(' | ') };
    }
    return { text: isMock ? 'Carrier Mod. 30XW | S/N: BR-2024-8192 | 380V' : '' };
  }

  if (pin.fieldType === 'result_status') {
    if (order?.status === 'Concluída') return { text: 'CONFORME / APROVADO' };
    if (order?.status === 'Em Execução') return { text: 'EM ANDAMENTO' };
    return { text: order?.status || (isMock ? 'CONFORME / APROVADO' : 'PENDENTE') };
  }

  if (pin.fieldType === 'notes') {
    return { text: order?.notes || (isMock ? 'Equipamento operando dentro dos parâmetros nominais de pressão e temperatura.' : '') };
  }

  if (pin.fieldType === 'signed_by') {
    return { text: order?.signedBy || (isMock ? 'Daniel Torres' : '') };
  }

  if (pin.fieldType === 'signed_at') {
    return { text: formatDateBR(order?.signedAt) || (isMock ? formatDateBR(new Date().toISOString()) : '') };
  }

  if (pin.fieldType === 'signature') {
    if (order?.signature) {
      return { isImage: true, imageData: order.signature };
    }
    if (isMock) {
      return { text: '[ ASSINATURA DIGITAL VALIDADA ]' };
    }
    return { text: '' };
  }

  // CHECKLIST SPECIFIC FIELDS
  if (pin.fieldType.startsWith('checklist_')) {
    // Look for matching checklist item in order or template
    let matchedItem: any = null;
    if (order?.checklist && order.checklist.length > 0) {
      if (pin.targetItemId) {
        matchedItem = order.checklist.find(i => i.id === pin.targetItemId);
      }
      // If not found by ID, try matching by index or task label
      if (!matchedItem && pin.label) {
        matchedItem = order.checklist.find(i => pin.label?.toLowerCase().includes(i.task.toLowerCase()));
      }
    }

    if (!matchedItem && template?.checklistItems) {
      matchedItem = template.checklistItems.find(i => i.id === pin.targetItemId);
    }

    if (pin.fieldType === 'checklist_status') {
      if (matchedItem) {
        const s = matchedItem.statusCheck || (matchedItem.checked ? 'Atestado' : 'Não Atestado');
        return { text: s };
      }
      return { text: isMock ? 'Atestado' : '' };
    }

    if (pin.fieldType === 'checklist_status_mark') {
      const isOk = matchedItem 
        ? (matchedItem.statusCheck === 'Atestado' || matchedItem.checked === true)
        : isMock;
      
      if (pin.style === 'cross_mark') return { text: isOk ? 'X' : '' };
      if (pin.style === 'check_mark') return { text: isOk ? '✓' : '' };
      if (pin.style === 'box_checked') return { text: isOk ? '[X]' : '[ ]' };
      return { text: isOk ? 'X' : '' };
    }

    if (pin.fieldType === 'checklist_obs') {
      if (matchedItem?.observations) return { text: matchedItem.observations };
      return { text: isMock ? 'Conforme especificações técnicas' : '' };
    }

    if (pin.fieldType === 'checklist_val') {
      if (matchedItem?.observations) return { text: matchedItem.observations };
      if (matchedItem?.statusCheck) return { text: matchedItem.statusCheck };
      return { text: isMock ? '220 V / 4.5 bar' : '' };
    }
  }

  return { text: '' };
}

/**
 * Gera um novo arquivo PDF preenchido com as respostas da preventiva nos locais mapeados
 */
export async function generateFilledPdf(
  pdfConfig: PdfTemplateConfig,
  order?: Partial<ServiceOrder> | null,
  asset?: Partial<Asset> | null,
  template?: Partial<MaintenanceTemplate> | null
): Promise<{ pdfBytes: Uint8Array; blobUrl: string }> {
  if (!pdfConfig.pdfBase64) {
    throw new Error('O modelo não possui arquivo PDF base importado.');
  }

  // Limpa prefixo data:application/pdf;base64, se houver
  const base64Data = pdfConfig.pdfBase64.includes(',') 
    ? pdfConfig.pdfBase64.split(',')[1] 
    : pdfConfig.pdfBase64;

  const pdfDoc = await PDFDocument.load(base64Data);
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const totalPages = pdfDoc.getPageCount();

  const pins = pdfConfig.pins || [];

  for (const pin of pins) {
    const pageIndex = (pin.page || 1) - 1;
    if (pageIndex < 0 || pageIndex >= totalPages) continue;

    const page = pdfDoc.getPage(pageIndex);
    const { width, height } = page.getSize();

    // No PDF, a origem (0,0) é no canto inferior esquerdo.
    // pin.x, pin.y, pin.width, pin.height vêm como % do canto superior esquerdo (0 a 100).
    const boxX = (pin.x / 100) * width;
    const boxWidth = pin.width ? Math.max(10, (pin.width / 100) * width) : 100;
    const boxHeight = pin.height ? Math.max(8, (pin.height / 100) * height) : 20;
    const boxTopY = height - ((pin.y / 100) * height);
    const fontSize = pin.fontSize || 10;

    const pinVal = getPinValue(pin, order, asset, template);
    const textColor = hexToRgb(pin.fontColor);

    if (pinVal.isImage && pinVal.imageData && pinVal.imageData.startsWith('data:image/png;base64,')) {
      try {
        const rawPng = pinVal.imageData.split(',')[1];
        const embeddedImg = await pdfDoc.embedPng(rawPng);
        
        // Preserve image proportions within box
        const imgDims = embeddedImg.scale(1);
        const imgAspect = imgDims.width / imgDims.height;
        const boxAspect = boxWidth / boxHeight;
        
        let drawWidth = boxWidth;
        let drawHeight = boxHeight;
        let imgX = boxX;
        let imgY = boxTopY - boxHeight;

        if (imgAspect > boxAspect) {
          drawWidth = boxWidth;
          drawHeight = boxWidth / imgAspect;
          imgY = boxTopY - ((boxHeight + drawHeight) / 2);
        } else {
          drawHeight = boxHeight;
          drawWidth = boxHeight * imgAspect;
          imgX = boxX + ((boxWidth - drawWidth) / 2);
        }
        
        page.drawImage(embeddedImg, {
          x: imgX,
          y: imgY,
          width: drawWidth,
          height: drawHeight,
        });
      } catch (err) {
        console.warn('Erro ao embutir imagem de assinatura no PDF:', err);
        page.drawText('[Assinado Digitalmente]', {
          x: boxX + 4,
          y: boxTopY - fontSize - 2,
          size: fontSize,
          font: helveticaBold,
          color: textColor,
        });
      }
    } else if (pinVal.text) {
      const isBold = pin.bold || pin.fieldType === 'os_id' || pin.fieldType === 'result_status' || pin.style === 'cross_mark';
      const font = isBold ? helveticaBold : helveticaFont;
      const textToDraw = pinVal.text;

      // Handle Checkmarks and X marks centered in small boxes
      if (pin.style === 'cross_mark' || pin.style === 'check_mark' || pin.style === 'box_checked') {
        const markFontSize = Math.min(boxHeight * 0.85, fontSize * 1.3);
        const textW = font.widthOfTextAtSize(textToDraw, markFontSize);
        const centerX = boxX + (boxWidth - textW) / 2;
        const centerY = boxTopY - (boxHeight / 2) - (markFontSize * 0.35);
        page.drawText(textToDraw, {
          x: Math.max(boxX, centerX),
          y: centerY,
          size: markFontSize,
          font: helveticaBold,
          color: textColor,
        });
      } else {
        // Calculate X based on alignment
        let textX = boxX;
        const align = pin.align || 'left';
        
        if (align === 'center') {
          const textW = font.widthOfTextAtSize(textToDraw, fontSize);
          textX = boxX + Math.max(0, (boxWidth - textW) / 2);
        } else if (align === 'right') {
          const textW = font.widthOfTextAtSize(textToDraw, fontSize);
          textX = boxX + Math.max(0, boxWidth - textW - 2);
        }

        // Center vertically if single line and boxHeight is meaningful
        let textY = boxTopY - fontSize * 0.9;
        if (boxHeight > fontSize * 1.6) {
          textY = boxTopY - (boxHeight / 2) - (fontSize * 0.35);
        }

        page.drawText(textToDraw, {
          x: textX,
          y: textY,
          size: fontSize,
          font: font,
          color: textColor,
          maxWidth: boxWidth > 10 ? boxWidth : undefined,
          lineHeight: fontSize * 1.2
        });
      }
    }
  }

  const pdfBytes = await pdfDoc.save();
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const blobUrl = URL.createObjectURL(blob);

  return { pdfBytes, blobUrl };
}
