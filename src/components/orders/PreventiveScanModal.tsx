import React, { useState } from 'react';
import { QrCode } from 'lucide-react';
import { Asset } from '../../types';
import CameraQrScanner from '../CameraQrScanner';
import { parseScannedQrCode } from '../../utils/qrUtils';

export interface PreventiveScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  assets: Asset[];
  onSelectAssetCode: (code: string) => void;
}

export default function PreventiveScanModal({
  isOpen,
  onClose,
  assets,
  onSelectAssetCode
}: PreventiveScanModalProps) {
  const [preventiveScannerTab, setPreventiveScannerTab] = useState<'camera' | 'manual'>('camera');
  const [simulatedPreventiveScanCode, setSimulatedPreventiveScanCode] = useState('');

  if (!isOpen) return null;

  const handleScanSuccess = (decodedText: string) => {
    const normalized = decodedText.trim();
    const cleanValue = parseScannedQrCode(normalized);

    const matchingAsset = assets.find(
      (a) =>
        a.id.toLowerCase() === cleanValue.toLowerCase() ||
        a.code.toLowerCase() === cleanValue.toLowerCase() ||
        a.id.toLowerCase() === normalized.toLowerCase() ||
        a.code.toLowerCase() === normalized.toLowerCase()
    );

    const codeToSet = matchingAsset ? matchingAsset.code : cleanValue;
    onSelectAssetCode(codeToSet);
    onClose();
    setSimulatedPreventiveScanCode('');
    alert(
      `🔍 LEITURA REALIZADA COM SUCESSO!\nIdentificado Ativo: ${
        matchingAsset ? matchingAsset.name : codeToSet
      }\nFiltrando fila de preventivas para o patrimônio.`
    );
  };

  const handleManualSimulate = () => {
    if (!simulatedPreventiveScanCode.trim()) {
      alert('Selecione ou insira um código para escanear.');
      return;
    }

    onSelectAssetCode(simulatedPreventiveScanCode.trim());
    onClose();
    setSimulatedPreventiveScanCode('');
    alert(
      `🔍 LEITURA REALIZADA COM SUCESSO!\nFiltrando preventivas para o Equipamento de Patrimônio: ${simulatedPreventiveScanCode}`
    );
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 font-sans text-left">
      <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full border border-gray-200">
        <div className="flex items-center gap-2 mb-4 justify-between border-b pb-3">
          <h3 className="font-extrabold text-[#0b1c30] text-sm flex items-center gap-2">
            <QrCode className="w-4 h-4 text-[#3525cd]" />
            Encontrar Preventiva via QR Code
          </h3>
          <button
            type="button"
            onClick={() => {
              onClose();
              setSimulatedPreventiveScanCode('');
            }}
            className="text-gray-400 hover:text-rose-600 font-extrabold text-sm cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* TAB TOGGLES */}
        <div className="flex bg-slate-100 p-1 rounded-lg mb-4">
          <button
            type="button"
            onClick={() => setPreventiveScannerTab('camera')}
            className={`flex-1 text-center py-1.5 text-xs font-black rounded-md transition-all cursor-pointer ${
              preventiveScannerTab === 'camera'
                ? 'bg-white text-[#3525cd] shadow-xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Câmera ao Vivo
          </button>
          <button
            type="button"
            onClick={() => setPreventiveScannerTab('manual')}
            className={`flex-1 text-center py-1.5 text-xs font-black rounded-md transition-all cursor-pointer ${
              preventiveScannerTab === 'manual'
                ? 'bg-white text-[#3525cd] shadow-xs'
                : 'text-slate-550 hover:text-slate-800'
            }`}
          >
            Simulador Manual
          </button>
        </div>

        {preventiveScannerTab === 'camera' ? (
          <div className="py-2">
            <CameraQrScanner
              onScanSuccess={handleScanSuccess}
              onClose={() => setPreventiveScannerTab('manual')}
            />
            <p className="text-[10px] text-gray-400 text-center mt-3 font-semibold leading-relaxed">
              Dica: Para ler, use a câmera traseira para escanear a etiqueta QR correspondente no equipamento.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-gray-550 leading-relaxed font-semibold">
              Selecione o equipamento ou digite o patrimônio/código manualmente para simular a leitura do QR Code fixado no bem:
            </p>

            <div>
              <label className="block text-[10px] font-extrabold text-gray-400 uppercase tracking-wider mb-1.5">
                Selecione o Patrimônio do Ativo
              </label>
              <select
                value={simulatedPreventiveScanCode}
                onChange={(e) => setSimulatedPreventiveScanCode(e.target.value)}
                className="w-full py-2 px-3 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-bold"
              >
                <option value="">Selecione para simular...</option>
                {assets.map((ast) => (
                  <option key={ast.id} value={ast.code}>
                    [{ast.code}] {ast.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-extrabold text-gray-400 uppercase tracking-wider mb-1.5">
                Ou digite o Patrimônio manualmente
              </label>
              <input
                type="text"
                placeholder="EX: 168548 ou GMC-01"
                value={simulatedPreventiveScanCode}
                onChange={(e) => setSimulatedPreventiveScanCode(e.target.value)}
                className="w-full py-2 px-3 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-bold placeholder-slate-400"
              />
            </div>

            <div className="flex gap-2 justify-end text-xs pt-3">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  setSimulatedPreventiveScanCode('');
                }}
                className="px-4 py-2 border border-slate-200 rounded-lg text-gray-650 hover:bg-slate-50 font-black uppercase text-[10px] tracking-wider cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleManualSimulate}
                disabled={!simulatedPreventiveScanCode}
                className="px-4 py-2 bg-[#3525cd] text-white rounded-lg font-black hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed cursor-pointer uppercase text-[10px] tracking-wider transition-colors"
              >
                Simular QR Match
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
