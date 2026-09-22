import React, { useState } from 'react';
import { AlertCircle, Scan } from 'lucide-react';
import CameraQrScanner from '../CameraQrScanner';
import { Asset, Management } from '../../types';

// ==========================================
// 1. SCANNER MODAL (CÂMERA REAL + SIMULADOR MANUAL)
// ==========================================
export interface AssetScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (decodedText: string) => void;
  assets: Asset[];
}

export const AssetScannerModal: React.FC<AssetScannerModalProps> = ({
  isOpen,
  onClose,
  onScanSuccess,
  assets
}) => {
  const [scannerTab, setScannerTab] = useState<'camera' | 'manual'>('camera');
  const [simulatedScanCode, setSimulatedScanCode] = useState('');

  if (!isOpen) return null;

  const handleClose = () => {
    setSimulatedScanCode('');
    onClose();
  };

  const handleManualSubmit = () => {
    if (!simulatedScanCode) return;
    onScanSuccess(simulatedScanCode);
    setSimulatedScanCode('');
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 font-sans text-left">
      <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full border border-gray-200 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center gap-2 mb-4 justify-between border-b pb-3">
          <h3 className="font-extrabold text-[#0b1c30] text-sm flex items-center gap-2">
            <Scan className="w-4 h-4 text-[#3525cd]" />
            Buscar Ativo via QR Code
          </h3>
          <button 
            type="button"
            onClick={handleClose}
            className="text-gray-400 hover:text-rose-600 font-extrabold text-sm cursor-pointer p-1"
          >
            ✕
          </button>
        </div>

        {/* TAB TOGGLES FOR REAL CAMERA OR SIMULATOR */}
        <div className="flex bg-slate-100 p-1 rounded-lg mb-4">
          <button
            type="button"
            onClick={() => setScannerTab('camera')}
            className={`flex-1 text-center py-1.5 text-xs font-black rounded-md transition-all cursor-pointer ${
              scannerTab === 'camera'
                ? 'bg-white text-[#3525cd] shadow-xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Câmera ao Vivo
          </button>
          <button
            type="button"
            onClick={() => setScannerTab('manual')}
            className={`flex-1 text-center py-1.5 text-xs font-black rounded-md transition-all cursor-pointer ${
              scannerTab === 'manual'
                ? 'bg-white text-[#3525cd] shadow-xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Simulador Manual
          </button>
        </div>

        {scannerTab === 'camera' ? (
          <div className="py-2">
            <CameraQrScanner 
              onScanSuccess={onScanSuccess}
              onClose={() => setScannerTab('manual')}
            />
            <p className="text-[10px] text-gray-500 text-center mt-3 font-semibold leading-relaxed">
              Dica: Para ler, aponte a câmera traseira do seu celular para o QR Code impresso no equipamento.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-gray-500 leading-relaxed font-semibold">
              Cada equipamento possui uma plaqueta física com QR Code único. Escolha um dos ativos cadastrados no menu ou digite para simular a leitura do código do bem:
            </p>

            <div>
              <label className="block text-[10px] font-extrabold text-gray-400 uppercase tracking-wider mb-1.5">
                Selecione o Ativo Cadastrado
              </label>
              <select
                value={simulatedScanCode}
                onChange={(e) => setSimulatedScanCode(e.target.value)}
                className="w-full py-2 px-3 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-[#3525cd] font-bold"
              >
                <option value="">Selecione um item cadastrado...</option>
                {assets.map((ast) => (
                  <option key={ast.id} value={ast.code}>
                    [{ast.code}] {ast.name} ({ast.sector})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-extrabold text-gray-400 uppercase tracking-wider mb-1.5">
                Ou digite o Patrimônio / Código manualmente
              </label>
              <input
                type="text"
                placeholder="EX: 168548 ou GMC-01"
                value={simulatedScanCode}
                onChange={(e) => setSimulatedScanCode(e.target.value)}
                className="w-full py-2 px-3 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-[#3525cd] font-bold placeholder-slate-400"
              />
            </div>

            <div className="flex gap-2 justify-end text-xs pt-3">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 font-black uppercase text-[10px] tracking-wider cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleManualSubmit}
                disabled={!simulatedScanCode}
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
};

// ==========================================
// 2. MODAL DE EXCLUSÃO INDIVIDUAL DE ATIVO
// ==========================================
export interface AssetDeleteModalProps {
  asset: Asset | null;
  onClose: () => void;
  onConfirmDelete: (asset: Asset) => Promise<void>;
}

export const AssetDeleteModal: React.FC<AssetDeleteModalProps> = ({
  asset,
  onClose,
  onConfirmDelete
}) => {
  const [isDeleting, setIsDeleting] = useState(false);

  if (!asset) return null;

  const handleConfirm = async () => {
    setIsDeleting(true);
    try {
      await onConfirmDelete(asset);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 font-sans">
      <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full border border-gray-200 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center gap-2 mb-3 justify-between border-b pb-3 border-rose-100">
          <h3 className="font-extrabold text-rose-800 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600" />
            Excluir Ativo
          </h3>
          <button 
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-rose-600 font-extrabold text-sm cursor-pointer p-1"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <p className="text-xs text-slate-600 leading-normal">
            Você tem certeza de que deseja excluir permanentemente o ativo <strong className="text-slate-900 font-extrabold">"{asset.name}" ({asset.code})</strong>?
          </p>

          <div className="bg-rose-50 p-3 rounded-lg border border-rose-100 text-[10px] text-rose-800 leading-normal space-y-1">
            <span className="font-bold uppercase tracking-wider block">Aviso de Segurança:</span>
            <p>Esta ação é irreversível e excluirá permanentemente o ativo e toda a sua ficha técnica dos servidores.</p>
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              disabled={isDeleting}
              onClick={onClose}
              className="px-3.5 py-1.5 border border-gray-200 hover:bg-gray-50 rounded-lg text-xs font-bold text-gray-700 cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={isDeleting}
              onClick={handleConfirm}
              className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1 cursor-pointer shadow-md disabled:opacity-60"
            >
              {isDeleting ? 'Excluindo...' : 'Confirmar Exclusão'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ==========================================
// 3. MODAL DE EXCLUSÃO DE ATIVOS POR SETOR
// ==========================================
export interface AssetSectorDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  managements: Management[];
  onConfirmSectorDelete: (sectorName: string) => Promise<void>;
}

export const AssetSectorDeleteModal: React.FC<AssetSectorDeleteModalProps> = ({
  isOpen,
  onClose,
  managements,
  onConfirmSectorDelete
}) => {
  const defaultSector = React.useMemo(() => {
    const valid = managements.filter(m => m.name !== 'Todas');
    return valid.length > 0 ? valid[0].name : 'Refrigeração';
  }, [managements]);

  const [sectorToDelete, setSectorToDelete] = useState<string>(defaultSector);
  const [sectorDeleteConfirmText, setSectorDeleteConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  React.useEffect(() => {
    if (isOpen) {
      setSectorToDelete(defaultSector);
      setSectorDeleteConfirmText('');
    }
  }, [isOpen, defaultSector]);

  if (!isOpen) return null;

  const handleClose = () => {
    setSectorDeleteConfirmText('');
    onClose();
  };

  const handleConfirm = async () => {
    if (sectorDeleteConfirmText !== 'EXCLUIR SETOR') return;
    setIsDeleting(true);
    try {
      await onConfirmSectorDelete(sectorToDelete);
      setSectorDeleteConfirmText('');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 font-sans">
      <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full border border-gray-200 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center gap-2 mb-3 justify-between border-b pb-3 border-rose-100">
          <h3 className="font-extrabold text-rose-800 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600" />
            Excluir Itens por Setor
          </h3>
          <button 
            type="button"
            onClick={handleClose}
            className="text-gray-400 hover:text-rose-600 font-extrabold text-sm cursor-pointer p-1"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <p className="text-xs text-gray-500 leading-normal">
            Esta operação removerá <strong>todos os equipamentos</strong> cadastrados no setor selecionado, tanto localmente quanto do banco de dados na nuvem.
          </p>

          <div>
            <label className="block text-[10px] font-extrabold text-gray-500 uppercase mb-1">
              Selecione o Setor para Limpar:
            </label>
            <select
              value={sectorToDelete}
              onChange={(e) => setSectorToDelete(e.target.value)}
              className="w-full text-xs py-1.5 px-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-rose-500 font-bold text-slate-800"
            >
              {managements.length > 0 ? (
                managements.filter(m => m.name !== 'Todas').map((m) => (
                  <option key={m.id} value={m.name}>{m.name}</option>
                ))
              ) : (
                <>
                  <option value="Refrigeração">Refrigeração</option>
                  <option value="Elétrica">Elétrica</option>
                  <option value="Civil">Civil</option>
                </>
              )}
            </select>
          </div>

          <div className="bg-rose-50 p-3 rounded-lg border border-rose-100 text-[10px] text-rose-800 space-y-2">
            <span className="font-bold uppercase tracking-wider block">Procedimento de Segurança:</span>
            <p>
              Para confirmar a remoção completa de todos os ativos do setor, digite <strong className="font-extrabold font-mono select-all text-rose-950">EXCLUIR SETOR</strong> abaixo:
            </p>
            <input
              type="text"
              placeholder="EXCLUIR SETOR"
              value={sectorDeleteConfirmText}
              onChange={(e) => setSectorDeleteConfirmText(e.target.value)}
              className="w-full text-xs py-1 px-2.5 bg-white border border-rose-200 rounded focus:outline-none font-bold placeholder:text-rose-300"
            />
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              disabled={isDeleting}
              onClick={handleClose}
              className="px-3.5 py-1.5 border border-gray-200 hover:bg-gray-50 rounded-lg text-xs font-bold text-gray-700 cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={sectorDeleteConfirmText !== 'EXCLUIR SETOR' || isDeleting}
              onClick={handleConfirm}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-1 transition-all ${
                sectorDeleteConfirmText === 'EXCLUIR SETOR' && !isDeleting
                  ? 'bg-rose-600 hover:bg-rose-700 cursor-pointer shadow-md'
                  : 'bg-rose-300 cursor-not-allowed opacity-60'
              }`}
            >
              {isDeleting ? 'Excluindo...' : 'Confirmar Exclusão Geral'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
