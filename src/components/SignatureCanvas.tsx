import React, { useRef, useState, useEffect } from 'react';
import { RotateCcw, PenTool, CheckCircle } from 'lucide-react';

interface SignatureCanvasProps {
  onSave: (signatureBase64: string, signeeName: string) => void;
  onCancel: () => void;
}

export default function SignatureCanvas({ onSave, onCancel }: SignatureCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [signeeName, setSigneeName] = useState('Daniel Torres');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Adapt to styling resolution
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1e1b4b'; // Deep dark indigo for neat ink
  }, []);

  const getCoordinates = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    // Mathematically scale client coordinates relative to physical container versus internal pixel resolution width/height
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;

    return { x, y };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Capture pointer
    canvas.setPointerCapture(e.pointerId);

    const { x, y } = getCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
    setHasDrawn(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const { x, y } = getCoordinates(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.releasePointerCapture(e.pointerId);
    }
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const saveSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) {
      alert('Por favor, assine no painel antes de validar.');
      return;
    }

    if (!signeeName.trim()) {
      alert('Por favor, insira o nome do assinante técnico.');
      return;
    }

    // Capture as PNG Base64 string
    const dataUrl = canvas.toDataURL('image/png');
    onSave(dataUrl, signeeName);
  };

  return (
    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-xl max-w-md w-full mx-auto font-sans">
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-bold text-gray-900 flex items-center gap-2">
          <PenTool className="w-4 h-4 text-indigo-600" />
          Assinatura Digital de Validação
        </h4>
        <button
          onClick={clearCanvas}
          className="text-xs font-semibold text-gray-500 hover:text-rose-600 flex items-center gap-1 transition-colors"
          title="Limpar quadro"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Limpar
        </button>
      </div>

      <p className="text-xs text-gray-400 mb-3 leading-relaxed">
        Desenhe manualmente com o cursor do mouse ou tela sensível ao toque no retângulo abaixo. Esta assinatura digital selará os históricos conformes.
      </p>

      {/* Signature Area */}
      <div className="bg-[#fbfafe] border border-dashed border-indigo-200 rounded-lg overflow-hidden h-40 relative touch-none cursor-crosshair">
        <canvas
          ref={canvasRef}
          width={400}
          height={160}
          className="w-full h-full absolute inset-0"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
        {!hasDrawn && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-40 select-none">
            <span className="text-xs text-indigo-900 font-medium">Assine Aqui</span>
          </div>
        )}
      </div>

      {/* Input Name field */}
      <div className="mt-4">
        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
          Nome do Responsável Técnico
        </label>
        <input
          type="text"
          value={signeeName}
          onChange={(e) => setSigneeName(e.target.value)}
          placeholder="Nome completo do técnico"
          className="w-full py-2 px-3 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none focus:border-indigo-500 text-gray-800 font-medium"
        />
      </div>

      {/* Action buttons */}
      <div className="mt-5 flex gap-2 justify-end text-sm">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 font-medium transition-colors cursor-pointer"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={saveSignature}
          disabled={!hasDrawn}
          className={`px-4 py-2 rounded-lg text-white font-bold shadow flex items-center gap-1.5 transition-all cursor-pointer ${
            hasDrawn
              ? 'bg-[#3525cd] hover:bg-indigo-700 shadow-md active:scale-95'
              : 'bg-gray-300 shadow-none cursor-not-allowed'
          }`}
        >
          <CheckCircle className="w-4 h-4" />
          Selar & Concluir
        </button>
      </div>
    </div>
  );
}
