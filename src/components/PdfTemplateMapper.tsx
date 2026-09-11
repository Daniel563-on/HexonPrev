import React, { useState, useEffect, useRef } from 'react';
import {
  FileText,
  Upload,
  Crosshair,
  Trash2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Eye,
  Settings2,
  Layers,
  Sparkles,
  Download,
  AlertCircle,
  HelpCircle,
  Move,
  X,
  Plus,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Bold,
  Copy,
  MousePointer,
  Square
} from 'lucide-react';
import { pdfjsLib } from '../lib/pdfHelper';
import { generateFilledPdf, getPinValue } from '../lib/pdfGenerator';
import { MaintenanceTemplate, PdfMappingPin, PdfTemplateConfig, ChecklistTemplateItem, PdfPinFieldType } from '../types';

interface PdfTemplateMapperProps {
  template: MaintenanceTemplate;
  onSaveConfig: (newConfig: PdfTemplateConfig) => Promise<void>;
  onClose: () => void;
}

interface DraftBox {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export default function PdfTemplateMapper({
  template,
  onSaveConfig,
  onClose
}: PdfTemplateMapperProps) {
  const [pdfConfig, setPdfConfig] = useState<PdfTemplateConfig>(() => {
    return template.pdfTemplate || {
      pdfBase64: undefined,
      pdfName: undefined,
      pdfSize: 0,
      pageCount: 1,
      pins: []
    };
  });

  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [zoomScale, setZoomScale] = useState(1.2);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [showHelperInfo, setShowHelperInfo] = useState(false);

  // Drawing & Resizing state
  const [draftBox, setDraftBox] = useState<DraftBox | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [resizingPin, setResizingPin] = useState<{ id: string; handle: string; startX: number; startY: number; origPin: PdfMappingPin } | null>(null);
  const [movingPin, setMovingPin] = useState<{ id: string; startX: number; startY: number; origPin: PdfMappingPin } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pdfDocRef = useRef<any>(null);

  // Load PDF when base64 is set
  useEffect(() => {
    if (!pdfConfig.pdfBase64) return;

    let isMounted = true;
    setIsRendering(true);

    const loadPdfDoc = async () => {
      try {
        const base64Data = pdfConfig.pdfBase64!.includes(',')
          ? pdfConfig.pdfBase64!.split(',')[1]
          : pdfConfig.pdfBase64!;
        
        const rawBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
        const loadingTask = pdfjsLib.getDocument({ data: rawBytes });
        const doc = await loadingTask.promise;
        
        if (!isMounted) return;
        pdfDocRef.current = doc;
        setTotalPages(doc.numPages);
        renderPage(currentPage, doc, zoomScale);
      } catch (err) {
        console.error('Erro ao carregar documento PDF:', err);
      } finally {
        if (isMounted) setIsRendering(false);
      }
    };

    loadPdfDoc();

    return () => {
      isMounted = false;
    };
  }, [pdfConfig.pdfBase64]);

  // Re-render current page when page or zoom changes
  const renderPage = async (pageNum: number, doc = pdfDocRef.current, scale = zoomScale) => {
    if (!doc || !canvasRef.current) return;
    try {
      setIsRendering(true);
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');

      if (!context) return;

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const renderContext = {
        canvasContext: context,
        viewport: viewport
      };

      await page.render(renderContext).promise;
    } catch (err) {
      console.error('Erro na renderização da página do PDF:', err);
    } finally {
      setIsRendering(false);
    }
  };

  useEffect(() => {
    if (pdfDocRef.current) {
      renderPage(currentPage, pdfDocRef.current, zoomScale);
    }
  }, [currentPage, zoomScale]);

  // Handle PDF file upload
  const handleFileUpload = (file: File) => {
    if (!file || file.type !== 'application/pdf') {
      alert('Por favor selecione um arquivo válido no formato PDF (.pdf).');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const resultBase64 = e.target?.result as string;
      if (resultBase64) {
        setPdfConfig(prev => ({
          ...prev,
          pdfBase64: resultBase64,
          pdfName: file.name,
          pdfSize: file.size,
          pins: prev.pins || []
        }));
        setCurrentPage(1);
      }
    };
    reader.readAsDataURL(file);
  };

  // Convert mouse event coordinates to percentages (0-100%)
  const getRelativeCoords = (e: React.MouseEvent | MouseEvent) => {
    if (!overlayRef.current) return { x: 0, y: 0 };
    const rect = overlayRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const xPct = Math.max(0, Math.min(100, (clickX / rect.width) * 100));
    const yPct = Math.max(0, Math.min(100, (clickY / rect.height) * 100));
    return {
      x: Number(xPct.toFixed(2)),
      y: Number(yPct.toFixed(2))
    };
  };

  // MOUSE DOWN ON OVERLAY (START DRAWING BOX)
  const handleOverlayMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isPreviewMode || resizingPin || movingPin) return;
    if (e.target !== overlayRef.current && (e.target as HTMLElement).getAttribute('data-overlay') !== 'true') {
      return;
    }

    const coords = getRelativeCoords(e);
    const startX = coords.x;
    const startY = coords.y;

    setIsDrawing(true);
    setDraftBox({
      startX,
      startY,
      currentX: startX,
      currentY: startY
    });

    let hasHandledMouseUp = false;

    const handleGlobalMouseMove = (moveEvent: MouseEvent) => {
      const cur = getRelativeCoords(moveEvent);
      setDraftBox({
        startX,
        startY,
        currentX: cur.x,
        currentY: cur.y
      });
    };

    const handleGlobalMouseUp = (upEvent: MouseEvent) => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);

      if (hasHandledMouseUp) return;
      hasHandledMouseUp = true;

      setIsDrawing(false);
      setDraftBox(null);

      const endCoords = getRelativeCoords(upEvent);
      const xMin = Math.min(startX, endCoords.x);
      const yMin = Math.min(startY, endCoords.y);
      const rawW = Math.abs(endCoords.x - startX);
      const rawH = Math.abs(endCoords.y - startY);

      // If very tiny drag / single click, give a default standard rectangular area
      const finalW = rawW < 1.5 ? 20 : Number(rawW.toFixed(2));
      const finalH = rawH < 1.5 ? 4 : Number(rawH.toFixed(2));

      const firstChecklist = template.checklistItems?.[0];
      const newPin: PdfMappingPin = {
        id: `pin_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        page: currentPage,
        x: Number(xMin.toFixed(2)),
        y: Number(yMin.toFixed(2)),
        width: finalW,
        height: finalH,
        fieldType: firstChecklist ? 'checklist_status' : 'os_id',
        targetItemId: firstChecklist?.id,
        label: firstChecklist ? `Status: ${firstChecklist.task.slice(0, 25)}...` : 'Nº da OS',
        fontSize: 10,
        fontColor: '#0b1c30',
        align: 'left',
        style: 'text'
      };

      setPdfConfig(prev => ({
        ...prev,
        pins: [...prev.pins, newPin]
      }));

      setSelectedPinId(newPin.id);
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
  };

  // MOUSE DOWN ON A BOX (MOVE)
  const handleBoxMouseDown = (e: React.MouseEvent, pin: PdfMappingPin) => {
    e.stopPropagation();
    setSelectedPinId(pin.id);

    const startCoords = getRelativeCoords(e);
    setMovingPin({
      id: pin.id,
      startX: startCoords.x,
      startY: startCoords.y,
      origPin: { ...pin }
    });

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const curCoords = getRelativeCoords(moveEvent);
      const deltaX = curCoords.x - startCoords.x;
      const deltaY = curCoords.y - startCoords.y;

      const newX = Math.max(0, Math.min(100 - (pin.width || 15), pin.x + deltaX));
      const newY = Math.max(0, Math.min(100 - (pin.height || 4), pin.y + deltaY));

      setPdfConfig(prev => ({
        ...prev,
        pins: prev.pins.map(p => p.id === pin.id ? { ...p, x: Number(newX.toFixed(2)), y: Number(newY.toFixed(2)) } : p)
      }));
    };

    const handleMouseUp = () => {
      setMovingPin(null);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // MOUSE DOWN ON A RESIZE HANDLE
  const handleResizeMouseDown = (e: React.MouseEvent, pin: PdfMappingPin, handle: string) => {
    e.stopPropagation();
    setSelectedPinId(pin.id);

    const startCoords = getRelativeCoords(e);
    const origX = pin.x;
    const origY = pin.y;
    const origW = pin.width || 20;
    const origH = pin.height || 4;

    setResizingPin({
      id: pin.id,
      handle,
      startX: startCoords.x,
      startY: startCoords.y,
      origPin: { ...pin }
    });

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const cur = getRelativeCoords(moveEvent);
      const deltaX = cur.x - startCoords.x;
      const deltaY = cur.y - startCoords.y;

      let newX = origX;
      let newY = origY;
      let newW = origW;
      let newH = origH;

      if (handle.includes('e')) {
        newW = Math.max(2, origW + deltaX);
      }
      if (handle.includes('s')) {
        newH = Math.max(1.5, origH + deltaY);
      }
      if (handle.includes('w')) {
        const potentialW = origW - deltaX;
        if (potentialW >= 2) {
          newX = origX + deltaX;
          newW = potentialW;
        }
      }
      if (handle.includes('n')) {
        const potentialH = origH - deltaY;
        if (potentialH >= 1.5) {
          newY = origY + deltaY;
          newH = potentialH;
        }
      }

      setPdfConfig(prev => ({
        ...prev,
        pins: prev.pins.map(p => p.id === pin.id ? {
          ...p,
          x: Number(newX.toFixed(2)),
          y: Number(newY.toFixed(2)),
          width: Number(newW.toFixed(2)),
          height: Number(newH.toFixed(2))
        } : p)
      }));
    };

    const handleMouseUp = () => {
      setResizingPin(null);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Delete a pin
  const handleDeletePin = (pinId: string) => {
    setPdfConfig(prev => ({
      ...prev,
      pins: prev.pins.filter(p => p.id !== pinId)
    }));
    if (selectedPinId === pinId) {
      setSelectedPinId(null);
    }
  };

  // Duplicate a pin
  const handleDuplicatePin = (pin: PdfMappingPin) => {
    const newPin: PdfMappingPin = {
      ...pin,
      id: `pin_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      y: Math.min(95, pin.y + (pin.height || 4) + 1),
    };
    setPdfConfig(prev => ({
      ...prev,
      pins: [...prev.pins, newPin]
    }));
    setSelectedPinId(newPin.id);
  };

  // Update a pin property
  const handleUpdatePin = (pinId: string, changes: Partial<PdfMappingPin>) => {
    setPdfConfig(prev => ({
      ...prev,
      pins: prev.pins.map(p => {
        if (p.id !== pinId) return p;
        const updated = { ...p, ...changes };
        
        // Auto-update friendly label if item or field changed
        if (changes.targetItemId || changes.fieldType) {
          if (updated.fieldType.startsWith('checklist_')) {
            const item = template.checklistItems.find(i => i.id === updated.targetItemId);
            const taskLabel = item ? item.task.slice(0, 30) : 'Item do Checklist';
            if (updated.fieldType === 'checklist_status') updated.label = `Status: ${taskLabel}`;
            else if (updated.fieldType === 'checklist_status_mark') updated.label = `Marcação [X]: ${taskLabel}`;
            else if (updated.fieldType === 'checklist_obs') updated.label = `Observação: ${taskLabel}`;
            else if (updated.fieldType === 'checklist_val') updated.label = `Valor: ${taskLabel}`;
          } else {
            const labelsMap: Record<string, string> = {
              os_id: 'Nº da OS',
              os_title: 'Título da Preventiva',
              asset_name: 'Nome do Ativo',
              asset_code: 'Patrimônio / QR Code',
              asset_sector: 'Setor / Gerência',
              asset_location: 'Comarca / Local',
              asset_specs: 'Especificações Técnicas',
              technician: 'Técnico Responsável',
              scheduled_date: 'Data da OS / Execução',
              signature: 'Assinatura Digital',
              signed_by: 'Nome do Assinante',
              signed_at: 'Data/Hora da Assinatura',
              result_status: 'Status / Laudo Geral',
              notes: 'Observações Gerais',
              fixed_text: 'Texto Fixo Customizado'
            };
            updated.label = labelsMap[updated.fieldType] || updated.fieldType;
          }
        }

        return updated;
      })
    }));
  };

  // Live preview generation
  const handleTogglePreview = async () => {
    if (!isPreviewMode) {
      try {
        setIsRendering(true);
        const { blobUrl } = await generateFilledPdf(pdfConfig, null, null, template);
        setPreviewBlobUrl(blobUrl);
        setIsPreviewMode(true);
      } catch (err: any) {
        alert(`Não foi possível gerar a pré-visualização: ${err?.message || err}`);
      } finally {
        setIsRendering(false);
      }
    } else {
      setIsPreviewMode(false);
    }
  };

  // Download Sample Filled PDF
  const handleDownloadSample = async () => {
    try {
      setIsRendering(true);
      const { blobUrl } = await generateFilledPdf(pdfConfig, null, null, template);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `Amostra_Mapeada_${template.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
      link.click();
    } catch (err: any) {
      alert(`Erro ao baixar amostra: ${err?.message || err}`);
    } finally {
      setIsRendering(false);
    }
  };

  // Save to database
  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSaveConfig(pdfConfig);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      alert(`Erro ao salvar mapeamento do PDF: ${err?.message || err}`);
    } finally {
      setIsSaving(false);
    }
  };

  const selectedPin = pdfConfig.pins.find(p => p.id === selectedPinId);
  const currentPinsOnPage = pdfConfig.pins.filter(p => (p.page || 1) === currentPage);

  // Calculate rubberband draft box style
  const getDraftBoxStyle = () => {
    if (!draftBox) return null;
    const x = Math.min(draftBox.startX, draftBox.currentX);
    const y = Math.min(draftBox.startY, draftBox.currentY);
    const w = Math.abs(draftBox.currentX - draftBox.startX);
    const h = Math.abs(draftBox.currentY - draftBox.startY);
    return {
      left: `${x}%`,
      top: `${y}%`,
      width: `${w}%`,
      height: `${h}%`
    };
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex flex-col text-slate-800 animate-in fade-in duration-150">
      
      {/* HEADER BAR */}
      <header className="h-16 bg-[#0b1c30] text-white border-b border-slate-800 px-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-xl">
            <Square className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-black tracking-tight text-white flex items-center gap-2">
              Mapeador de Áreas PDF • {template.name}
              <span className="text-[9px] bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full font-bold border border-blue-400/20">
                {pdfConfig.pins.length} {pdfConfig.pins.length === 1 ? 'Área Mapeada' : 'Áreas Mapeadas'}
              </span>
            </h2>
            <p className="text-[10px] text-slate-400">
              Clique e puxe o mouse para desenhar a caixa do campo no PDF e defina qual resposta entrará nela.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Helper button */}
          <button
            type="button"
            onClick={() => setShowHelperInfo(!showHelperInfo)}
            className={`p-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              showHelperInfo ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
            title="Como funciona o mapeamento"
          >
            <HelpCircle className="w-4 h-4" />
            <span className="hidden sm:inline">Instruções</span>
          </button>

          {/* Test Preview Button */}
          {pdfConfig.pdfBase64 && (
            <button
              type="button"
              onClick={handleTogglePreview}
              className={`px-3.5 py-2 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer ${
                isPreviewMode 
                  ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-sm' 
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
              }`}
            >
              <Eye className="w-4 h-4" />
              {isPreviewMode ? 'Voltar para Edição' : 'Pré-visualizar Preenchimento'}
            </button>
          )}

          {/* Download Sample */}
          {pdfConfig.pdfBase64 && pdfConfig.pins.length > 0 && (
            <button
              type="button"
              onClick={handleDownloadSample}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
              title="Baixar Amostra Preenchida em PDF"
            >
              <Download className="w-4 h-4" />
              <span className="hidden md:inline">Baixar PDF</span>
            </button>
          )}

          {/* Save Button */}
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className={`px-4 py-2 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer shadow-md ${
              saveSuccess 
                ? 'bg-emerald-600 text-white' 
                : 'bg-blue-600 hover:bg-blue-500 text-white'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            {isSaving ? 'Salvando...' : saveSuccess ? 'Mapeamento Salvo!' : 'Salvar no Modelo'}
          </button>

          {/* Close modal */}
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            title="Fechar Mapeador"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* HELPER INSTRUCTION BANNER */}
      {showHelperInfo && (
        <div className="bg-indigo-950/90 border-b border-indigo-800 px-6 py-3 text-indigo-100 flex items-start justify-between text-xs animate-in slide-in-from-top-2">
          <div className="space-y-1">
            <span className="font-extrabold uppercase text-[10px] text-indigo-300 tracking-wider flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              Como Funciona o Desenho e Mapeamento de Áreas:
            </span>
            <p className="text-[11px] text-indigo-200 leading-relaxed max-w-4xl">
              1. <strong>Clique e puxe o mouse</strong> sobre qualquer linha, célula ou caixa do PDF para demarcar o tamanho exato da área.<br />
              2. <strong>Ao soltar o clique</strong>, a caixa é criada e o painel direito abrirá para você escolher o dado que entrará ali (item do checklist, nome do ativo, data, técnico, rubrica/assinatura, etc).<br />
              3. Você pode <strong>arrastar a caixa inteira</strong> para mover de lugar ou puxar os <strong>pontos nas bordas</strong> para redimensionar a largura e altura.<br />
              4. Clique em <strong>Pré-visualizar Preenchimento</strong> para testar a impressão final com dados simulados!
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowHelperInfo(false)}
            className="text-indigo-400 hover:text-white text-xs font-bold ml-4"
          >
            Fechar
          </button>
        </div>
      )}

      {/* MAIN WORKSPACE AREA */}
      <div className="flex-1 flex overflow-hidden">

        {/* LEFT / CENTER: PDF CANVAS & VIEWPORT */}
        <div className="flex-1 bg-slate-900 overflow-auto flex flex-col relative">

          {/* FLOATING TOP TOOLBAR */}
          <div className="sticky top-0 z-20 bg-slate-950/80 backdrop-blur-md border-b border-slate-800 px-4 py-2.5 flex items-center justify-between text-xs text-slate-300">
            <div className="flex items-center gap-3">
              
              {/* File upload replacement button */}
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileUpload(f);
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-bold border border-slate-700 flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5 text-blue-400" />
                {pdfConfig.pdfBase64 ? 'Trocar PDF' : 'Importar PDF'}
              </button>

              {pdfConfig.pdfName && (
                <span className="text-[11px] text-slate-400 truncate max-w-[200px] font-mono">
                  {pdfConfig.pdfName}
                </span>
              )}

              <div className="h-4 w-px bg-slate-800" />

              {/* Mode indicator badge */}
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-blue-400 bg-blue-950/50 border border-blue-800/40 px-3 py-1 rounded-lg">
                <MousePointer className="w-3.5 h-3.5 animate-pulse" />
                <span>Clique e arraste no PDF para desenhar um campo</span>
              </div>
            </div>

            {/* Pagination & Zoom Controls */}
            {pdfConfig.pdfBase64 && (
              <div className="flex items-center gap-2">
                {/* Page switch */}
                <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 px-2 py-1 rounded-lg">
                  <button
                    type="button"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    className="p-1 text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="font-extrabold text-[11px] px-1 text-slate-200">
                    Pág. {currentPage} de {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    className="p-1 text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                {/* Zoom controls */}
                <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 px-2 py-1 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setZoomScale(z => Math.max(0.6, z - 0.2))}
                    className="p-1 text-slate-400 hover:text-white cursor-pointer"
                    title="Diminuir Zoom"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <span className="font-mono text-[10px] text-slate-300 w-10 text-center font-bold">
                    {Math.round(zoomScale * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => setZoomScale(z => Math.min(2.5, z + 0.2))}
                    className="p-1 text-slate-400 hover:text-white cursor-pointer"
                    title="Aumentar Zoom"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoomScale(1.2)}
                    className="p-1 text-slate-400 hover:text-white cursor-pointer"
                    title="Zoom Padrão"
                  >
                    <Maximize2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* CANVAS & INTERACTIVE DRAWING OVERLAY VIEWPORT */}
          <div className="flex-1 flex items-center justify-center p-6 overflow-auto">
            {!pdfConfig.pdfBase64 ? (
              /* EMPTY UPLOAD HERO */
              <div className="max-w-md w-full bg-slate-950 border-2 border-dashed border-slate-800 rounded-3xl p-10 text-center text-slate-300 space-y-4">
                <div className="w-16 h-16 bg-blue-600/10 text-blue-400 border border-blue-500/20 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
                  <FileText className="w-8 h-8" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-black text-white uppercase tracking-wider">
                    Importar PDF Oficial para Mapeamento
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Faça upload do documento base (folha de inspeção, checklist impresso ou laudo oficial de engenharia) para desenhar as caixas de resposta onde o texto e assinaturas serão inseridos.
                  </p>
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-black text-xs rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 transition-all cursor-pointer active:scale-95"
                  >
                    <Upload className="w-4 h-4" />
                    Selecionar Arquivo PDF (.pdf)
                  </button>
                </div>
                <p className="text-[10px] text-slate-500">Suporta documentos de 1 a múltiplas páginas em alta definição.</p>
              </div>
            ) : isPreviewMode && previewBlobUrl ? (
              /* IFRAME PREVIEW MODE */
              <div className="w-full h-full min-h-[650px] bg-white rounded-2xl overflow-hidden shadow-2xl border border-slate-800 flex flex-col">
                <div className="p-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-xs text-slate-300">
                  <span className="font-extrabold flex items-center gap-2 text-emerald-400">
                    <CheckCircle2 className="w-4 h-4" />
                    Visualização do Laudo PDF Preenchido com Dados Simulados
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsPreviewMode(false)}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded text-[11px] font-bold"
                  >
                    Voltar para Modo de Edição
                  </button>
                </div>
                <iframe
                  src={previewBlobUrl}
                  title="PDF Preenchido"
                  className="w-full flex-1 border-0"
                />
              </div>
            ) : (
              /* REAL PDF CANVAS WITH INTERACTIVE BOXES & RUBBERBAND DRAWING */
              <div
                ref={overlayRef}
                data-overlay="true"
                onMouseDown={handleOverlayMouseDown}
                className="relative shadow-2xl border border-slate-700 rounded-sm select-none cursor-crosshair"
                style={{ display: 'inline-block', lineHeight: 0 }}
              >
                {/* PDF Page Rendered on Canvas */}
                <canvas ref={canvasRef} className="block pointer-events-none" />

                {/* RUBBERBAND DRAWING PREVIEW BOX */}
                {draftBox && getDraftBoxStyle() && (
                  <div
                    className="absolute border-2 border-dashed border-blue-400 bg-blue-500/20 z-40 pointer-events-none rounded-xs flex items-center justify-center shadow-lg"
                    style={getDraftBoxStyle()!}
                  >
                    <span className="text-[10px] font-black text-white bg-blue-700/90 px-2 py-0.5 rounded shadow-sm">
                      Solte para criar campo
                    </span>
                  </div>
                )}

                {/* INTERACTIVE BOXES LAYER OVER CURRENT PAGE */}
                <div className="absolute inset-0 pointer-events-none">
                  {currentPinsOnPage.map((pin, idx) => {
                    const isSelected = selectedPinId === pin.id;
                    const sampleValue = getPinValue(pin, null, null, template);
                    const widthPct = pin.width || 20;
                    const heightPct = pin.height || 4;

                    return (
                      <div
                        key={pin.id}
                        onMouseDown={(e) => handleBoxMouseDown(e, pin)}
                        className={`absolute pointer-events-auto transition-shadow group ${
                          isSelected
                            ? 'z-30 ring-2 ring-blue-400 border-2 border-blue-500 bg-blue-500/15 shadow-xl shadow-blue-900/30'
                            : 'z-20 border border-indigo-400/80 bg-indigo-500/10 hover:bg-indigo-500/20 hover:border-indigo-400'
                        } rounded-xs cursor-move flex flex-col`}
                        style={{
                          left: `${pin.x}%`,
                          top: `${pin.y}%`,
                          width: `${widthPct}%`,
                          height: `${heightPct}%`,
                          minWidth: '20px',
                          minHeight: '16px'
                        }}
                      >
                        {/* BOX TOP HEADER BADGE */}
                        <div
                          className={`flex items-center justify-between gap-1 px-1.5 py-0.5 text-[9px] font-black truncate select-none ${
                            isSelected
                              ? 'bg-blue-600 text-white'
                              : 'bg-[#0b1c30]/90 text-slate-200 group-hover:bg-[#0b1c30]'
                          }`}
                        >
                          <div className="flex items-center gap-1 truncate">
                            <span className="w-3.5 h-3.5 bg-white/20 rounded-full flex items-center justify-center text-[8px] font-extrabold shrink-0">
                              {idx + 1}
                            </span>
                            <span className="truncate leading-none">
                              {pin.label || pin.fieldType}
                            </span>
                          </div>

                          <div className="flex items-center gap-0.5 shrink-0 opacity-80 group-hover:opacity-100">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDuplicatePin(pin);
                              }}
                              className="p-0.5 hover:text-blue-200 cursor-pointer"
                              title="Duplicar caixa"
                            >
                              <Copy className="w-2.5 h-2.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeletePin(pin.id);
                              }}
                              className="p-0.5 hover:text-rose-300 cursor-pointer"
                              title="Excluir caixa"
                            >
                              <Trash2 className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        </div>

                        {/* BOX SAMPLE VALUE PREVIEW INSIDE AREA */}
                        <div
                          className={`flex-1 px-1 py-0.5 flex items-center overflow-hidden text-[9px] font-mono leading-tight ${
                            pin.align === 'center'
                              ? 'justify-center text-center'
                              : pin.align === 'right'
                              ? 'justify-end text-right'
                              : 'justify-start text-left'
                          } ${pin.bold ? 'font-bold' : 'font-normal'} ${
                            isSelected ? 'text-blue-900 bg-white/40' : 'text-slate-800'
                          }`}
                        >
                          <span className="truncate max-w-full">
                            {sampleValue.text || (pin.fieldType === 'signature' ? '[ Rubrica Digital ]' : '...')}
                          </span>
                        </div>

                        {/* 4 CORNER RESIZE HANDLES (VISIBLE WHEN SELECTED) */}
                        {isSelected && (
                          <>
                            {/* NW */}
                            <div
                              onMouseDown={(e) => handleResizeMouseDown(e, pin, 'nw')}
                              className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-blue-600 border-2 border-white rounded-full cursor-nwse-resize z-40 shadow-xs"
                            />
                            {/* NE */}
                            <div
                              onMouseDown={(e) => handleResizeMouseDown(e, pin, 'ne')}
                              className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-blue-600 border-2 border-white rounded-full cursor-nesw-resize z-40 shadow-xs"
                            />
                            {/* SW */}
                            <div
                              onMouseDown={(e) => handleResizeMouseDown(e, pin, 'sw')}
                              className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-blue-600 border-2 border-white rounded-full cursor-nesw-resize z-40 shadow-xs"
                            />
                            {/* SE (MAIN PULL CORNER) */}
                            <div
                              onMouseDown={(e) => handleResizeMouseDown(e, pin, 'se')}
                              className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-blue-600 border-2 border-white rounded-full cursor-nwse-resize z-40 shadow-xs flex items-center justify-center hover:scale-125 transition-transform"
                              title="Puxe para redimensionar largura e altura"
                            />
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>

                {isRendering && (
                  <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center text-white text-xs font-bold">
                    Carregando página do PDF...
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT SIDEBAR: PIN CONFIGURATION & FIELDS LIST */}
        <aside className="w-80 lg:w-96 bg-white border-l border-gray-200 flex flex-col shrink-0 overflow-y-auto">
          
          {/* SIDEBAR HEADER */}
          <div className="p-4 bg-slate-50 border-b border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-slate-600" />
              <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider">
                Configuração da Área
              </h3>
            </div>
            <span className="text-[10px] font-bold text-slate-500 bg-slate-200/70 px-2 py-0.5 rounded-full">
              Pág. {currentPage} ({currentPinsOnPage.length} áreas)
            </span>
          </div>

          {/* SELECTED PIN EDITOR */}
          {selectedPin ? (
            <div className="p-5 space-y-5 border-b border-gray-100 bg-blue-50/20 text-left">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black text-blue-700 uppercase tracking-tight flex items-center gap-1.5">
                  <Square className="w-3.5 h-3.5" />
                  Área #{currentPinsOnPage.findIndex(p => p.id === selectedPin.id) + 1} ({selectedPin.width || 20}% x {selectedPin.height || 4}%)
                </span>
                
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleDuplicatePin(selectedPin)}
                    className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer text-[10px] font-bold flex items-center gap-1"
                    title="Duplicar esta caixa"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Duplicar
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeletePin(selectedPin.id)}
                    className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer text-[10px] font-bold flex items-center gap-1"
                    title="Remover esta área do PDF"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Excluir
                  </button>
                </div>
              </div>

              {/* FIELD CATEGORY / TYPE SELECTION */}
              <div>
                <label className="block text-[10px] font-extrabold text-slate-600 uppercase mb-1">
                  Dado / Resposta a Inserir Nesta Caixa*
                </label>
                <select
                  value={selectedPin.fieldType}
                  onChange={(e) => handleUpdatePin(selectedPin.id, { fieldType: e.target.value as PdfPinFieldType })}
                  className="w-full text-xs py-2 px-3 bg-white border border-gray-300 rounded-lg font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                >
                  <optgroup label="📋 Itens de Checklist deste Modelo">
                    <option value="checklist_status">Status do Item (Atestado / Não Atestado / N.A.)</option>
                    <option value="checklist_status_mark">Marcação em Caixa [X] / [✓]</option>
                    <option value="checklist_obs">Observação Digitada pelo Técnico</option>
                    <option value="checklist_val">Valor Informado (Texto/Número/Data)</option>
                  </optgroup>

                  <optgroup label="⚙️ Equipamento / Ativo">
                    <option value="asset_name">Nome do Equipamento</option>
                    <option value="asset_code">Código de Patrimônio / QR Code</option>
                    <option value="asset_sector">Setor / Gerência do Ativo</option>
                    <option value="asset_location">Comarca / Local de Instalação</option>
                    <option value="asset_specs">Especificações Técnicas (Fab/Mod/S/N)</option>
                  </optgroup>

                  <optgroup label="📝 Ordem de Serviço & Execução">
                    <option value="os_id">Número da OS (ex: #OS-28491)</option>
                    <option value="os_title">Título da Preventiva</option>
                    <option value="scheduled_date">Data Agendada / Execução</option>
                    <option value="technician">Técnico Executor Responsável</option>
                    <option value="result_status">Resultado do Laudo (Aprovado / Não Conforme)</option>
                    <option value="notes">Observações Gerais da Ordem</option>
                  </optgroup>

                  <optgroup label="✍️ Validação & Assinatura">
                    <option value="signature">Rubrica / Assinatura Digital (Imagem)</option>
                    <option value="signed_by">Nome do Assinante / Responsável</option>
                    <option value="signed_at">Data/Hora da Assinatura</option>
                  </optgroup>

                  <optgroup label="📌 Outros">
                    <option value="fixed_text">Texto Fixo Personalizado</option>
                  </optgroup>
                </select>
              </div>

              {/* IF FIELD IS CHECKLIST ITEM, SELECT WHICH QUESTION */}
              {selectedPin.fieldType.startsWith('checklist_') && (
                <div>
                  <label className="block text-[10px] font-extrabold text-blue-700 uppercase mb-1">
                    Pergunta / Tarefa do Modelo*
                  </label>
                  <select
                    value={selectedPin.targetItemId || ''}
                    onChange={(e) => handleUpdatePin(selectedPin.id, { targetItemId: e.target.value })}
                    className="w-full text-xs py-2 px-3 bg-white border border-blue-200 rounded-lg font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                  >
                    {template.checklistItems.map((item, idx) => (
                      <option key={item.id} value={item.id}>
                        #{idx + 1} - {item.task}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* IF FIELD IS FIXED TEXT */}
              {selectedPin.fieldType === 'fixed_text' && (
                <div>
                  <label className="block text-[10px] font-extrabold text-slate-600 uppercase mb-1">
                    Texto Fixo a Imprimir
                  </label>
                  <input
                    type="text"
                    value={selectedPin.fixedText || ''}
                    onChange={(e) => handleUpdatePin(selectedPin.id, { fixedText: e.target.value })}
                    placeholder="Ex: Engenharia de Manutenção Hexon"
                    className="w-full text-xs py-2 px-3 bg-white border border-gray-300 rounded-lg font-semibold text-slate-800"
                  />
                </div>
              )}

              {/* TEXT ALIGNMENT & BOLD FORMATTING */}
              <div>
                <label className="block text-[10px] font-extrabold text-slate-600 uppercase mb-1">
                  Alinhamento & Formatação
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex items-center bg-white border border-gray-300 rounded-lg p-0.5">
                    <button
                      type="button"
                      onClick={() => handleUpdatePin(selectedPin.id, { align: 'left' })}
                      className={`p-1.5 rounded text-xs cursor-pointer ${
                        (selectedPin.align || 'left') === 'left' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                      title="Alinhar à Esquerda"
                    >
                      <AlignLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUpdatePin(selectedPin.id, { align: 'center' })}
                      className={`p-1.5 rounded text-xs cursor-pointer ${
                        selectedPin.align === 'center' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                      title="Centralizar"
                    >
                      <AlignCenter className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUpdatePin(selectedPin.id, { align: 'right' })}
                      className={`p-1.5 rounded text-xs cursor-pointer ${
                        selectedPin.align === 'right' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                      title="Alinhar à Direita"
                    >
                      <AlignRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleUpdatePin(selectedPin.id, { bold: !selectedPin.bold })}
                    className={`p-2 rounded-lg border text-xs font-black flex items-center gap-1 cursor-pointer transition-all ${
                      selectedPin.bold
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white border-gray-300 text-slate-700 hover:bg-slate-50'
                    }`}
                    title="Alternar Negrito"
                  >
                    <Bold className="w-3.5 h-3.5" />
                    <span>Negrito</span>
                  </button>
                </div>
              </div>

              {/* FORMATTING: STYLE, FONT SIZE, COLOR */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-[10px] font-extrabold text-slate-600 uppercase mb-1">
                    Tamanho da Fonte
                  </label>
                  <select
                    value={selectedPin.fontSize || 10}
                    onChange={(e) => handleUpdatePin(selectedPin.id, { fontSize: Number(e.target.value) })}
                    className="w-full text-xs py-1.5 px-2 bg-white border border-gray-300 rounded-lg font-bold text-slate-800"
                  >
                    <option value="7">7 pt (Micro)</option>
                    <option value="8">8 pt (Pequeno)</option>
                    <option value="9">9 pt</option>
                    <option value="10">10 pt (Padrão)</option>
                    <option value="11">11 pt</option>
                    <option value="12">12 pt (Médio)</option>
                    <option value="14">14 pt (Grande)</option>
                    <option value="16">16 pt (Destaque)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold text-slate-600 uppercase mb-1">
                    Cor do Texto
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="color"
                      value={selectedPin.fontColor || '#000000'}
                      onChange={(e) => handleUpdatePin(selectedPin.id, { fontColor: e.target.value })}
                      className="w-8 h-8 rounded border border-gray-300 cursor-pointer p-0.5"
                    />
                    <input
                      type="text"
                      value={selectedPin.fontColor || '#000000'}
                      onChange={(e) => handleUpdatePin(selectedPin.id, { fontColor: e.target.value })}
                      className="flex-1 text-xs py-1 px-2 bg-white border border-gray-300 rounded-lg font-mono uppercase font-bold"
                    />
                  </div>
                </div>
              </div>

              {/* CHECKMARK STYLE SELECTOR */}
              {selectedPin.fieldType === 'checklist_status_mark' && (
                <div>
                  <label className="block text-[10px] font-extrabold text-slate-600 uppercase mb-1">
                    Estilo da Marcação
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => handleUpdatePin(selectedPin.id, { style: 'cross_mark', align: 'center' })}
                      className={`py-1.5 px-2 rounded-lg text-xs font-black border transition-all cursor-pointer ${
                        selectedPin.style === 'cross_mark' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-200 text-slate-700'
                      }`}
                    >
                      "X"
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUpdatePin(selectedPin.id, { style: 'check_mark', align: 'center' })}
                      className={`py-1.5 px-2 rounded-lg text-xs font-black border transition-all cursor-pointer ${
                        selectedPin.style === 'check_mark' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-200 text-slate-700'
                      }`}
                    >
                      "✓"
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUpdatePin(selectedPin.id, { style: 'box_checked', align: 'center' })}
                      className={`py-1.5 px-2 rounded-lg text-xs font-black border transition-all cursor-pointer ${
                        selectedPin.style === 'box_checked' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-200 text-slate-700'
                      }`}
                    >
                      "[X]"
                    </button>
                  </div>
                </div>
              )}

              {/* MANUAL DIMENSION ADJUSTMENTS */}
              <div className="pt-2 border-t border-gray-200/80">
                <span className="block text-[9px] font-black text-slate-400 uppercase mb-2">
                  Dimensões da Caixa (% da Página)
                </span>
                <div className="grid grid-cols-4 gap-2 text-center text-xs">
                  <div>
                    <span className="text-[9px] text-slate-400 block font-bold">X</span>
                    <input
                      type="number"
                      step="0.1"
                      value={selectedPin.x}
                      onChange={(e) => handleUpdatePin(selectedPin.id, { x: Number(e.target.value) })}
                      className="w-full text-center py-1 bg-white border border-gray-200 rounded font-mono font-bold"
                    />
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-400 block font-bold">Y</span>
                    <input
                      type="number"
                      step="0.1"
                      value={selectedPin.y}
                      onChange={(e) => handleUpdatePin(selectedPin.id, { y: Number(e.target.value) })}
                      className="w-full text-center py-1 bg-white border border-gray-200 rounded font-mono font-bold"
                    />
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-400 block font-bold">Largura</span>
                    <input
                      type="number"
                      step="0.1"
                      value={selectedPin.width || 20}
                      onChange={(e) => handleUpdatePin(selectedPin.id, { width: Number(e.target.value) })}
                      className="w-full text-center py-1 bg-white border border-gray-200 rounded font-mono font-bold"
                    />
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-400 block font-bold">Altura</span>
                    <input
                      type="number"
                      step="0.1"
                      value={selectedPin.height || 4}
                      onChange={(e) => handleUpdatePin(selectedPin.id, { height: Number(e.target.value) })}
                      className="w-full text-center py-1 bg-white border border-gray-200 rounded font-mono font-bold"
                    />
                  </div>
                </div>
              </div>

            </div>
          ) : (
            <div className="p-6 text-center text-slate-400 space-y-2 border-b border-gray-100 bg-slate-50/50">
              <Crosshair className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-xs font-bold text-slate-600">Nenhuma Área Selecionada</p>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Clique e arraste sobre o PDF à esquerda para desenhar uma nova área ou clique em uma já existente.
              </p>
            </div>
          )}

          {/* ALL MAPPED PINS LIST */}
          <div className="flex-1 p-4 space-y-3">
            <div className="flex items-center justify-between text-slate-700">
              <span className="text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-slate-500" />
                Áreas na Página {currentPage} ({currentPinsOnPage.length})
              </span>
            </div>

            {currentPinsOnPage.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400 border border-dashed rounded-xl bg-slate-50">
                Nenhuma área desenhada nesta página.
              </div>
            ) : (
              <div className="space-y-2">
                {currentPinsOnPage.map((pin, idx) => {
                  const isSelected = selectedPinId === pin.id;
                  return (
                    <div
                      key={pin.id}
                      onClick={() => setSelectedPinId(pin.id)}
                      className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between text-left ${
                        isSelected
                          ? 'bg-blue-50 border-blue-400 shadow-xs'
                          : 'bg-white border-gray-200 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-black shrink-0 ${
                          isSelected ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'
                        }`}>
                          {idx + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-black text-slate-800 truncate">
                            {pin.label || pin.fieldType}
                          </p>
                          <span className="text-[9px] text-slate-400 font-mono">
                            Dim: {pin.width || 20}% x {pin.height || 4}% (Pos: {pin.x}%, {pin.y}%)
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDuplicatePin(pin);
                          }}
                          className="text-slate-400 hover:text-blue-600 p-1 transition-colors cursor-pointer"
                          title="Duplicar área"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeletePin(pin.id);
                          }}
                          className="text-slate-400 hover:text-rose-600 p-1 transition-colors cursor-pointer"
                          title="Excluir área"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </aside>

      </div>

    </div>
  );
}
