import React, { useState, useEffect } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Loader2, AlertCircle } from 'lucide-react';

interface CameraQrScannerProps {
  onScanSuccess: (decodedText: string) => void;
  onClose: () => void;
}

export default function CameraQrScanner({ onScanSuccess, onClose }: CameraQrScannerProps) {
  const [isScanning, setIsScanning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let html5QrCode: Html5Qrcode | null = null;
    const elementId = "html5-qr-video-reader";

    const startScanner = async () => {
      try {
        html5QrCode = new Html5Qrcode(elementId);
        setIsScanning(true);
        setErrorMessage(null);

        // Start scanning with environment/back-facing camera preferentially
        await html5QrCode.start(
          { facingMode: "environment" },
          {
            fps: 12,
            qrbox: (width, height) => {
              const minSize = Math.min(width, height);
              const size = Math.floor(minSize * 0.75);
              return { width: size, height: size };
            }
          },
          (decodedText) => {
            if (html5QrCode && html5QrCode.isScanning) {
              html5QrCode.stop().then(() => {
                onScanSuccess(decodedText);
              }).catch(err => {
                console.error("Erro ao parar camera QR:", err);
                onScanSuccess(decodedText);
              });
            } else {
              onScanSuccess(decodedText);
            }
          },
          () => {
            // Normal scan noise, safe to ignore
          }
        );
      } catch (err: any) {
        console.error("Erro ao iniciar leitor da câmera QR:", err);
        const msg = err?.message || String(err);
        if (msg.includes("NotAllowedError") || msg.includes("Permission denied")) {
          setErrorMessage("Permissão de câmera negada! Habilite o acesso nas configurações do seu navegador para continuar.");
        } else if (msg.includes("Requested device not found") || msg.includes("no video input devices")) {
          setErrorMessage("Nenhuma câmera encontrada no seu dispositivo.");
        } else {
          setErrorMessage("Não foi possível conectar com a câmera. Verifique se ela já está sendo usada por outro app ou aba.");
        }
        setIsScanning(false);
      }
    };

    // Slight delay to allow mounting container fully in DOM
    const timer = setTimeout(() => {
      startScanner();
    }, 400);

    return () => {
      clearTimeout(timer);
      if (html5QrCode && html5QrCode.isScanning) {
        html5QrCode.stop().catch(e => {
          console.warn("Aviso ao liberar recursos de câmera:", e);
        });
      }
    };
  }, [onScanSuccess]);

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-xl bg-slate-950 border border-slate-800 flex flex-col items-center justify-center min-h-[220px] aspect-square max-w-[320px] mx-auto shadow-inner">
        {/* Video feed element targeted by camera scanner */}
        <div id="html5-qr-video-reader" className="w-full h-full object-cover" />

        {/* Loading placeholder spinner */}
        {!isScanning && !errorMessage && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-slate-900 text-white p-4 text-center">
            <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
            <span className="text-xs font-black tracking-widest text-indigo-200">INICIALIZANDO INSTÂNCIA...</span>
            <span className="text-[10px] text-slate-400 font-medium">Requisitando acesso do dispositivo</span>
          </div>
        )}

        {/* Clean visual error handling */}
        {errorMessage && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950 text-white p-5 text-center">
            <AlertCircle className="w-9 h-9 text-rose-500 animate-pulse" />
            <span className="text-[11px] font-black text-rose-500 uppercase tracking-wider">Falha de Conexão</span>
            <p className="text-[10px] text-slate-300 leading-relaxed font-semibold max-w-[240px]">{errorMessage}</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 text-[9px] font-extrabold uppercase bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700 py-1.5 px-3 rounded-lg text-indigo-300 tracking-wider transition-colors"
            >
              Usar Simulador Manual
            </button>
          </div>
        )}

        {/* Reticle targeting HUD over live video */}
        {isScanning && !errorMessage && (
          <div className="absolute inset-0 pointer-events-none border-[12px] border-slate-950/40 flex items-center justify-center">
            <div className="w-[180px] h-[180px] border border-white/20 rounded-lg relative">
              {/* Target brackets */}
              <div className="absolute top-0 left-0 w-5 h-5 border-t-4 border-l-4 border-indigo-500 -mt-1 -ml-1 rounded-tl-sm" />
              <div className="absolute top-0 right-0 w-5 h-5 border-t-4 border-r-4 border-indigo-500 -mt-1 -mr-1 rounded-tr-sm" />
              <div className="absolute bottom-0 left-0 w-5 h-5 border-b-4 border-l-4 border-indigo-500 -mb-1 -ml-1 rounded-bl-sm" />
              <div className="absolute bottom-0 right-0 w-5 h-5 border-b-4 border-r-4 border-indigo-500 -mb-1 -mr-1 rounded-br-sm" />

              {/* Red laser animation scan line */}
              <div className="absolute inset-x-2 top-1/2 -translate-y-1/2 h-0.5 bg-rose-500 shadow-lg shadow-rose-500/50 animate-bounce" />
            </div>

            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-slate-950/90 text-[9px] font-black text-indigo-300 py-1 px-2.5 rounded-full uppercase tracking-wider flex items-center gap-1 shadow-md border border-slate-800">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping" />
              Leitor Ativo
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
