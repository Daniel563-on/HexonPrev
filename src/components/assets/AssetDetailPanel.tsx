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
  History,
  AlertCircle,
  Edit
} from 'lucide-react';
import { Asset, MaintenanceLog, formatDateBR } from '../../types';
import { AssetQrCode } from '../AssetQrCode';
import { downloadAssetQrCode, printAssetTag } from '../../utils/qrUtils';
import { dbGetAssetHistory } from '../../db/firebase';

export interface AssetDetailPanelProps {
  asset: Asset;
  history?: MaintenanceLog[];
  onBackToList: () => void;
  onBackToMobileList?: () => void;
  onDeleteAsset: (asset: Asset) => void;
  onQuickScan: (asset: Asset) => void;
  onEditAsset?: (asset: Asset) => void;
}

export const AssetDetailPanel: React.FC<AssetDetailPanelProps> = ({
  asset,
  history: propHistory,
  onBackToList,
  onBackToMobileList,
  onDeleteAsset,
  onQuickScan,
  onEditAsset
}) => {
  const [internalHistory, setInternalHistory] = useState<MaintenanceLog[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Load history if not supplied via props
  useEffect(() => {
    if (propHistory !== undefined) {
      setInternalHistory(propHistory);
    } else if (asset) {
      setLoadingHistory(true);
      dbGetAssetHistory(asset.id)
        .then((hist) => {
          setInternalHistory(hist);
        })
        .catch((err) => {
          console.error('Erro ao carregar histórico do ativo:', err);
        })
        .finally(() => {
          setLoadingHistory(false);
        });
    }
  }, [asset?.id, propHistory]);

  const history = propHistory !== undefined ? propHistory : internalHistory;

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

      {/* LOWER BLOCK: MAINTENANCE HISTORY */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <div className="flex justify-between items-center mb-4 pb-3 border-b border-gray-100">
          <h4 className="font-bold text-[#0b1c30] text-xs uppercase tracking-wider flex items-center gap-2">
            <History className="w-4 h-4 text-[#3525cd]" />
            Histórico Operacional de Manutenções
          </h4>
          <span className="text-[10px] font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
            {loadingHistory ? 'Carregando...' : `${history.length} Eventos Registrados`}
          </span>
        </div>

        {history.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-xs text-gray-400 font-bold italic">Nenhuma ordem de serviço findada ou preventiva realizada neste ativo.</p>
            <p className="text-[10px] text-gray-400 mt-1">Sua primeira preventiva concluída alimentará automaticamente este histórico.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {history.map((log) => {
              const hasEnrichedDetails = !!(log.preventiveType || log.resultStatus || log.verifiedItemsText || log.nonConformItemsText || log.correctiveActionsText);
              const listVerified = log.verifiedItemsText ? log.verifiedItemsText.split(';').map(s => s.trim()).filter(Boolean) : [];
              const listFailed = log.nonConformItemsText ? log.nonConformItemsText.split(';').map(s => s.trim()).filter(Boolean) : [];
              
              return (
                <div key={log.id} className="p-4 bg-white rounded-xl border border-gray-200 hover:border-indigo-200 relative text-xs shadow-xs space-y-3 transition-all">
                  {/* Connection track indicator */}
                  <div className="absolute left-0 top-4 bottom-4 w-1 bg-indigo-600 rounded-r"></div>

                  {/* Top info row */}
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-gray-100 pb-2 pl-2">
                    <div>
                      <span className="font-extrabold text-[#0b1c30] text-sm block sm:inline">{log.osTitle}</span>
                      <span className="font-mono text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded text-[10px] font-bold ml-0 sm:ml-2">
                        #OS-{log.osId}
                      </span>
                    </div>
                    <span className="font-mono text-gray-400 text-[10px] font-bold">{formatDateBR(log.date)}</span>
                  </div>

                  {/* Diagnostics grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pl-2 text-slate-600">
                    <div>
                      <span className="text-[9px] text-gray-400 block font-bold uppercase">Técnico Executor</span>
                      <span className="font-black text-slate-800 text-xs flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full"></span>
                        {log.technician}
                      </span>
                    </div>

                    <div>
                      <span className="text-[9px] text-gray-400 block font-bold uppercase">Tipo de Intervenção</span>
                      <span className="font-black text-slate-800 text-xs">
                        {log.preventiveType || 'Visita Corretiva'}
                      </span>
                    </div>

                    <div>
                      <span className="text-[9px] text-gray-400 block font-bold uppercase">Conformidade Procedimento</span>
                      <span className="font-black text-emerald-600 text-xs">
                        {log.checkedCount} de {log.checklistCount} concluintes
                      </span>
                    </div>

                    <div>
                      <span className="text-[9px] text-gray-400 block font-bold uppercase">Resultado do Laudo</span>
                      <span className={`inline-block text-[9px] px-2 py-0.5 font-black rounded-full ${
                        log.resultStatus === 'Aprovado' ? 'bg-emerald-100 text-emerald-800' :
                        log.resultStatus === 'Aprovado com Ressalvas' ? 'bg-amber-100 text-amber-800' :
                        log.resultStatus === 'Não Conforme' ? 'bg-rose-100 text-rose-800' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                        {log.resultStatus || 'Concluído'}
                      </span>
                    </div>
                  </div>

                  {/* Custom fields and lists for items checked/failed */}
                  {hasEnrichedDetails && (
                    <div className="pl-2 space-y-3 pt-1 border-t border-slate-50 text-[11px]">
                      
                      {/* Verified items checklist */}
                      {listVerified.length > 0 && (
                        <div>
                          <span className="font-black text-slate-700 block mb-1">✓ Itens Verificados e Conformados ({listVerified.length}):</span>
                          <div className="flex flex-wrap gap-1">
                            {listVerified.map((v, i) => (
                              <span key={i} className="bg-slate-50 border border-slate-100 px-2 py-0.5 rounded text-[10px] text-slate-600">
                                {v}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Non-conforming items list */}
                      {listFailed.length > 0 && (
                        <div className="bg-rose-50/50 p-2.5 rounded-lg border border-rose-100">
                          <span className="font-black text-rose-700 flex items-center gap-1 mb-1">
                            <AlertCircle className="w-3.5 h-3.5" />
                            ✗ Itens Não Conformes Reportados ({listFailed.length}):
                          </span>
                          <ul className="list-disc list-inside space-y-0.5 text-[10px] text-rose-900 font-semibold">
                            {listFailed.map((f, i) => (
                              <li key={i}>{f}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Spawned Corrective action notes */}
                      {log.correctiveActionsText && (
                        <div className="bg-blue-50/55 p-2.5 rounded-lg border border-blue-100 font-medium text-[10px] text-blue-900 whitespace-pre-line">
                          <span className="font-black text-blue-800 block mb-0.5">⚙️ Desdobramento e Ações Corretivas:</span>
                          {log.correctiveActionsText}
                        </div>
                      )}

                    </div>
                  )}

                  {/* Technician observations */}
                  {log.notes && (
                    <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg text-slate-500 italic pl-3 relative mt-2 text-xs leading-relaxed">
                      <span className="font-bold not-italic text-slate-700 block text-[10px] uppercase mb-0.5">Observações Adicionais:</span>
                      "{log.notes}"
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
