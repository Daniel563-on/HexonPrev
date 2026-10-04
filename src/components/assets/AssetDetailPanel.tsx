import React, { useState, useEffect } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Trash2,
  MapPin,
  Scan,
  Download,
  Printer,
  Info,
  Edit
} from 'lucide-react';
import { Asset, MaintenanceLog, ServiceOrder, formatDateBR } from '../../types';
import { AssetQrCode } from '../AssetQrCode';
import { downloadAssetQrCode, printAssetTag } from '../../utils/qrUtils';
import AssetHistorySection from './AssetHistorySection';

export interface AssetDetailPanelProps {
  asset: Asset;
  history?: MaintenanceLog[];
  onBackToList: () => void;
  onBackToMobileList?: () => void;
  onDeleteAsset: (asset: Asset) => void;
  onQuickScan: (asset: Asset) => void;
  onEditAsset?: (asset: Asset) => void;
  onViewOrder?: (orderId: string) => void; // abre a OS completa (checklist, observações, assinatura e PDF)
  canViewCosts?: boolean; // "Ver valores em R$": valor de cada linha do histórico e total gasto com materiais
  visibleUnits?: string[] | null; // unidades do perfil (null = todas)
  localOrders?: ServiceOrder[]; // OS já carregadas no aparelho
}

export const AssetDetailPanel: React.FC<AssetDetailPanelProps> = ({
  asset,
  history: propHistory,
  onBackToList,
  onBackToMobileList,
  onDeleteAsset,
  onQuickScan,
  onEditAsset,
  onViewOrder,
  canViewCosts = false,
  visibleUnits = null,
  localOrders = []
}) => {
  if (!asset) return null;

  return (
    <div className="space-y-6">
      {/* Back to Results Table Button */}
      <div className="flex items-center justify-between gap-4 p-3 bg-slate-100 rounded-xl border border-slate-200">
        <button 
          type="button"
          onClick={onBackToList}
          className="py-2 px-4 bg-white border border-gray-300 text-[#0b1c30] text-xs font-black rounded-lg flex items-center gap-2 transition-all cursor-pointer shadow-2xs hover:bg-gray-50 active:scale-95"
        >
          <ChevronLeft className="w-4 h-4 text-gray-700" />
          VOLTAR PARA LISTA DE RESULTADOS
        </button>
        <div className="text-right">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Prontuário Técnico</span>
          <span className="text-xs font-black text-[#0b1c30]">[{asset.code}] - {asset.name}</span>
        </div>
      </div>

      {/* Back button for mobile display */}
      {onBackToMobileList && (
        <div className="lg:hidden flex items-center justify-start">
          <button 
            type="button"
            onClick={onBackToMobileList}
            className="py-2.5 px-4 bg-white border border-gray-200 text-[#0b1c30] text-xs font-black rounded-xl flex items-center gap-2 transition-all cursor-pointer shadow-sm hover:bg-gray-50 active:scale-95"
          >
            <ChevronRight className="w-4 h-4 rotate-180 text-gray-600" />
            VOLTAR AO CATÁLOGO
          </button>
        </div>
      )}

      {/* TOP BLOCK: Main Details & QR Scan container */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 relative">
        <div className="flex flex-col md:flex-row justify-between items-start gap-6">
          
          {/* Visual Technical Asset Identity */}
          <div className="flex-1 space-y-4">
            <div>
              <div className="flex items-center justify-between gap-4 flex-wrap mb-1.5 w-full">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded border border-indigo-100">
                    {asset.sector}
                  </span>
                  <span className="text-xs font-mono font-bold text-gray-400 uppercase tracking-widest">
                    REF ATIVO: {asset.code}
                  </span>
                </div>
                
                {/* EDIT & DELETE INDIVIDUAL ACTIONS */}
                <div className="flex items-center gap-1.5">
                  {onEditAsset && (
                    <button
                      type="button"
                      onClick={() => onEditAsset(asset)}
                      className="py-1 px-2.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-[9px] font-black text-indigo-700 rounded-lg flex items-center gap-1 transition-all cursor-pointer"
                      title="Editar especificações do ativo"
                    >
                      <Edit className="w-2.5 h-2.5 text-indigo-600" />
                      EDITAR
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onDeleteAsset(asset)}
                    className="py-1 px-2 bg-rose-50 hover:bg-rose-100 border border-rose-200 hover:border-rose-400 text-[9px] font-black text-rose-700 rounded-lg flex items-center gap-1 transition-all cursor-pointer"
                    title="Excluir este ativo definitivamente"
                  >
                    <Trash2 className="w-2.5 h-2.5 text-rose-600" />
                    EXCLUIR
                  </button>
                </div>
              </div>
              <h2 className="text-2xl font-black text-[#0b1c30] tracking-tight">{asset.name}</h2>
              <p className="text-xs text-gray-400 flex items-center gap-1.5 mt-1">
                <MapPin className="w-3.5 h-3.5 text-slate-400" />
                {asset.location}
              </p>
              
              {/* CRAAI / COMARCA visual block at the top */}
              <div className="flex flex-wrap gap-2 mt-2 pt-1">
                <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow-2xs">
                  <span className="font-extrabold uppercase">CRAAI:</span> {asset.specs?.CRAAI || asset.specs?.craai || 'Não informado'}
                </span>
                <span className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-100 px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow-2xs">
                  <span className="font-extrabold uppercase">Comarca:</span> {asset.specs?.COMARCA || asset.specs?.comarca || 'Não informado'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2">
              <div className="p-3 bg-gray-50 rounded-lg">
                <span className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Fabricante</span>
                <span className="text-xs font-bold text-[#0b1c30]">{asset.specs?.manufacturer || 'Não informado'}</span>
              </div>

              <div className="p-3 bg-gray-50 rounded-lg">
                <span className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Modelo / Tipo</span>
                <span className="text-xs font-bold text-[#0b1c30]">{asset.specs?.model || 'Não informado'}</span>
              </div>
            </div>
          </div>

          {/* QR Code Identification Block */}
          <div className="w-full md:w-auto p-4 border border-indigo-100 bg-indigo-50/20 rounded-xl flex flex-col items-center justify-center shrink-0 text-center gap-2">
            <div 
              className="bg-white p-2.5 rounded-lg shadow-sm border border-indigo-100 relative group cursor-pointer" 
              title="Clique para simular leitura QR rápido" 
              onClick={() => onQuickScan(asset)}
            >
              <AssetQrCode
                assetId={asset.id}
                size={112}
                className="w-28 h-28 mix-blend-multiply"
              />
              <div className="absolute inset-0 bg-[#3525cd]/80 hover:opacity-100 opacity-0 flex flex-col items-center justify-center text-white text-[10px] font-bold rounded-lg transition-all gap-1 text-center">
                <Scan className="w-5 h-5 text-white animate-pulse" />
                LER QR CODE
              </div>
            </div>
            
            <div>
              <span className="text-[10px] font-mono font-black text-[#3525cd] block">
                {asset.code}
              </span>
              <span className="text-[9px] text-gray-400 font-bold uppercase tracking-wider block">
                Identificação Individual
              </span>
            </div>

            {/* Actions to download or print tag */}
            <div className="flex gap-1.5 mt-1.5 w-full">
              <button
                type="button"
                onClick={() => downloadAssetQrCode(asset.code, asset.id)}
                className="flex-1 py-1 px-1.5 bg-white hover:bg-slate-50 border border-gray-200 rounded-lg text-[9px] font-black tracking-tight text-gray-700 flex items-center justify-center gap-1 transition-colors cursor-pointer text-center"
                title="Download da Imagem do QR Code em Alta Resolução"
              >
                <Download className="w-3 h-3 text-gray-500" />
                BAIXAR
              </button>
              
              <button
                type="button"
                onClick={() => printAssetTag(asset)}
                className="py-1 px-1.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg text-[9px] font-black tracking-tight text-[#3525cd] flex items-center justify-center gap-1 transition-colors cursor-pointer"
                title="Imprimir Plaqueta de Ativo"
              >
                <Printer className="w-3 h-3 text-[#3525cd]" />
                ETIQUETA
              </button>
            </div>
          </div>

        </div>

        {/* TECHNICAL SHEET SPEC ATTR GRID */}
        <div className="mt-6 pt-6 border-t border-gray-100">
          <h4 className="font-bold text-[#0b1c30] text-xs uppercase tracking-wider flex items-center gap-1.5 mb-4">
            <Info className="w-4 h-4 text-[#3525cd]" />
            Ficha Técnica Completa
          </h4>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <span className="text-[10px] text-gray-400 block mb-0.5 font-bold uppercase">Nº de Série</span>
              <span className="font-bold text-slate-800 font-mono">
                {asset.specs?.serialNumber || asset.specs?.['Nº DE SÉRIE'] || 'N/A'}
              </span>
            </div>

            {asset.specs?.power && (
              <div>
                <span className="text-[10px] text-gray-400 block mb-0.5 font-bold uppercase">Potência</span>
                <span className="font-bold text-slate-800">{asset.specs.power}</span>
              </div>
            )}

            {asset.specs?.capacity && (
              <div>
                <span className="text-[10px] text-gray-400 block mb-0.5 font-bold uppercase">Capacidade</span>
                <span className="font-bold text-slate-800">{asset.specs.capacity}</span>
              </div>
            )}

            {/* Dynamic custom fields from spreadsheet mapping */}
            {asset.specs && Object.keys(asset.specs).map((key) => {
              const excludedKeys = [
                'manufacturer', 
                'model', 
                'serialNumber', 
                'installationDate', 
                'power', 
                'capacity', 
                'voltage', 
                'warrantyUntil',
                'STATUS',
                'status',
                'Nº DE SÉRIE',
                'Nº de Série',
                'Nº de série',
                'N\u00ba DE S\u00c9RIE',
                'N\u00ba de S\u00e9rie',
                'N\u00ba de s\u00e9rie',
                'N° DE SÉRIE',
                'N° de Série',
                'N° de série',
                'Instalação',
                'instalacao',
                'Data de Instalação',
                'Tensão Elétrica',
                'tensao eletrica',
                'Tensão',
                'Garantia Vigor',
                'garantia vigor',
                'Garantia em Vigor',
                'Número de Série',
                'numero de serie',
                'Série',
                'CRAAI',
                'COMARCA',
                'craai',
                'comarca'
              ];
              
              // Case insensitive and accents sanitized equality check to prevent duplicates or leaked fields
              const isExcluded = excludedKeys.some(
                (excluded) => 
                  key.toLowerCase() === excluded.toLowerCase() ||
                  key.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() === 
                  excluded.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
              );
              if (isExcluded) return null;

              const val = asset.specs[key];
              if (val === undefined || val === null || String(val).trim() === '') return null;

              // Detect and format Date and Currency values to be highly legible
              let formattedVal = String(val);
              const normKey = key.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

              const isDate = normKey.includes('data') || 
                             normKey.includes('date') || 
                             normKey.includes('vencimento') || 
                             normKey.includes('periodo') || 
                             normKey.includes('garantia') || 
                             normKey.includes('vigor') || 
                             normKey.includes('instalac');

              const isCurrency = normKey.includes('valor') || 
                                 normKey.includes('liquido') || 
                                 normKey.includes('custo') || 
                                 normKey.includes('preco') || 
                                 normKey.includes('price') || 
                                 normKey.includes('valores') ||
                                 normKey.includes('bens');

              if (isDate) {
                const strVal = String(val).trim();
                if (/^\d{2}\/\d{2}\/\d{4}$/.test(strVal)) {
                  formattedVal = strVal;
                } else {
                  const numVal = Number(strVal);
                  if (!isNaN(numVal) && numVal > 10000 && numVal < 100000) {
                    const dateObj = new Date((numVal - 25569) * 86400 * 1000);
                    if (!isNaN(dateObj.getTime())) {
                      const day = String(dateObj.getUTCDate()).padStart(2, '0');
                      const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
                      const year = dateObj.getUTCFullYear();
                      formattedVal = `${day}/${month}/${year}`;
                    }
                  } else {
                    const isoMatch = strVal.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
                    if (isoMatch) {
                      const dDay = isoMatch[3].padStart(2, '0');
                      const dMonth = isoMatch[2].padStart(2, '0');
                      formattedVal = `${dDay}/${dMonth}/${isoMatch[1]}`;
                    } else {
                      try {
                        const d = new Date(strVal);
                        if (!isNaN(d.getTime())) {
                          const day = String(d.getUTCDate()).padStart(2, '0');
                          const month = String(d.getUTCMonth() + 1).padStart(2, '0');
                          const year = d.getUTCFullYear();
                          if (year > 1900 && year < 2100) {
                            formattedVal = `${day}/${month}/${year}`;
                          }
                        }
                      } catch (e) {}
                    }
                  }
                }
              } else if (isCurrency) {
                const strVal = String(val).trim();
                if (!strVal.startsWith('R$')) {
                  let sanitized = strVal;
                  if (sanitized.includes(',') && !sanitized.includes('.')) {
                    sanitized = sanitized.replace(',', '.');
                  } else if (sanitized.includes(',') && sanitized.includes('.')) {
                    sanitized = sanitized.replace(/\./g, '').replace(',', '.');
                  }
                  const cleanNum = parseFloat(sanitized.replace(/[^\d.-]/g, ''));
                  if (!isNaN(cleanNum)) {
                    formattedVal = new Intl.NumberFormat('pt-BR', {
                      style: 'currency',
                      currency: 'BRL'
                    }).format(cleanNum);
                  }
                }
              }

              return (
                <div key={key} className="border-l-2 border-indigo-100 pl-2">
                  <span className="text-[10px] text-gray-400 block mb-0.5 font-bold uppercase truncate-2-lines">{key}</span>
                  <span className="font-bold text-slate-800 break-words">{formattedVal}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* HISTÓRICO: abas Preventivas e Corretivas, setinha por linha, valores para quem pode ver */}
      <AssetHistorySection
        asset={asset}
        history={propHistory}
        canViewCosts={canViewCosts}
        visibleUnits={visibleUnits}
        localOrders={localOrders}
        onViewOrder={onViewOrder}
      />
    </div>
  );
};
