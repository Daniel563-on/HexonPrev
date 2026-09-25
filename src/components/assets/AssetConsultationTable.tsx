import React from 'react';
import {
  Filter,
  Download,
  Search,
  Eye,
  Tag,
  Edit,
  Trash2
} from 'lucide-react';
import { Asset } from '../../types';
import { printAssetTag } from '../../utils/qrUtils';

export interface AssetConsultationTableProps {
  results: Asset[];
  onSelectAsset: (asset: Asset) => void;
  onPrintAssetTag?: (asset: Asset) => void;
  onEditAsset?: (asset: Asset) => void;
  onDeleteAsset?: (asset: Asset) => void;
  onNewSearch: () => void;
  userHasActionPermission?: (action: string) => boolean;
  userProfile?: { perfil?: string } | null;
  // Paginação no banco: 50 por página, a próxima só é lida ao avançar
  totalFound: number;
  pageIndex: number;
  totalPages: number;
  isLoadingPage: boolean;
  isExporting: boolean;
  pageFilter: string;
  onPageFilterChange: (value: string) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onExportExcel: () => void;
}

export const AssetConsultationTable: React.FC<AssetConsultationTableProps> = ({
  results,
  onSelectAsset,
  onPrintAssetTag,
  onEditAsset,
  onDeleteAsset,
  onNewSearch,
  userHasActionPermission,
  userProfile,
  totalFound,
  pageIndex,
  totalPages,
  isLoadingPage,
  isExporting,
  pageFilter,
  onPageFilterChange,
  onPrevPage,
  onNextPage,
  onExportExcel
}) => {
  if (totalFound === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400 font-sans shadow-sm">
        <Filter className="w-12 h-12 text-indigo-300 mx-auto mb-3" />
        <p className="text-sm font-bold text-[#0b1c30]">Nenhum Ativo Consultado</p>
        <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
          Preencha os campos na aba <strong>Consulta</strong> e clique em <strong>Consultar Ativos</strong> para visualizar os resultados com total rapidez.
        </p>
        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={onNewSearch}
            className="py-2 px-4 bg-[#3525cd] text-white text-xs font-bold rounded-xl cursor-pointer hover:bg-[#2a1da6] transition-all shadow-xs"
          >
            Ir Para Consulta
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden font-sans">
      {/* Results Header */}
      <div className="p-4 bg-slate-50 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <span className="text-xs font-bold text-[#0b1c30]">
            Resultado da Consulta:
          </span>{' '}
          <span className="text-xs font-extrabold text-indigo-700">
            {totalFound} bem(ns) encontrado(s)
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-2" />
            <input
              type="text"
              value={pageFilter}
              onChange={(e) => onPageFilterChange(e.target.value)}
              placeholder="Procurar nesta página (sala, fabricante, modelo...)"
              className="w-64 text-xs py-1.5 pl-8 pr-2 bg-white border border-gray-300 rounded-lg text-slate-800 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={onExportExcel}
            disabled={isExporting}
            className="py-1.5 px-3 bg-white border border-gray-300 text-slate-700 hover:bg-slate-100 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-2xs transition-colors disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5 text-emerald-600" />
            <span>{isExporting ? 'Exportando...' : `Baixar Excel (${totalFound})`}</span>
          </button>
          <button
            type="button"
            onClick={onNewSearch}
            className="py-1.5 px-3 bg-white border border-gray-300 text-slate-700 hover:bg-slate-100 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-2xs transition-colors"
          >
            <Search className="w-3.5 h-3.5 text-indigo-600" />
            <span>Nova Consulta</span>
          </button>
        </div>
      </div>

      {/* Results Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-100 border-b border-gray-200 text-slate-700 font-extrabold uppercase text-[10px] tracking-wider">
              <th className="py-3 px-4">Nº Patrimonial</th>
              <th className="py-3 px-4">Equipamento</th>
              <th className="py-3 px-4">Gerência</th>
              <th className="py-3 px-4">Comarca / Unidade</th>
              <th className="py-3 px-4">Fabricante & Modelo</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-center">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {results.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-xs text-slate-400 italic">Nenhum ativo desta página corresponde à busca.</td>
              </tr>
            )}
            {results.map((asset) => {
              const status = asset.specs?.STATUS || asset.specs?.status || asset.status || 'Ativo';
              return (
                <tr key={asset.id} className="hover:bg-slate-50 transition-colors">
                  <td className="py-3 px-4 font-mono font-bold text-indigo-700 whitespace-nowrap">
                    {asset.code}
                  </td>
                  <td className="py-3 px-4">
                    <span className="font-bold text-[#0b1c30] block">{asset.name}</span>
                    <span className="text-[11px] text-slate-500 block truncate max-w-xs">{asset.location}</span>
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                      {asset.sector}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                    {asset.specs?.COMARCA || asset.specs?.comarca || asset.location.split(' - ')[0] || '-'}
                  </td>
                  <td className="py-3 px-4 text-slate-600">
                    {asset.specs?.manufacturer || asset.specs?.model ? (
                      <span>{asset.specs?.manufacturer || ''} {asset.specs?.model || ''}</span>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      status.toLowerCase().includes('ativo') || status.toLowerCase().includes('operando')
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : status.toLowerCase().includes('manuten')
                        ? 'bg-amber-50 text-amber-700 border border-amber-200'
                        : 'bg-rose-50 text-rose-700 border border-rose-200'
                    }`}>
                      {status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center whitespace-nowrap">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onSelectAsset(asset)}
                        title="Visualizar Ficha Técnica"
                        className="p-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg transition-colors cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onPrintAssetTag ? onPrintAssetTag(asset) : printAssetTag(asset)}
                        title="Imprimir Etiqueta QR"
                        className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors cursor-pointer"
                      >
                        <Tag className="w-3.5 h-3.5" />
                      </button>
                      {(!userHasActionPermission || userHasActionPermission('create_asset')) && onEditAsset && (
                        <button
                          type="button"
                          onClick={() => onEditAsset(asset)}
                          title="Editar Ativo"
                          className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors cursor-pointer"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {userProfile?.perfil === 'Super Administrador' && onDeleteAsset && (
                        <button
                          type="button"
                          onClick={() => onDeleteAsset(asset)}
                          title="Excluir Ativo"
                          className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination Bar */}
      <div className="p-4 bg-slate-50 border-t border-gray-200 flex items-center justify-between">
        <span className="text-xs text-slate-500 font-medium">
          Página {pageIndex + 1} de {totalPages} ({totalFound} bens)
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={pageIndex === 0 || isLoadingPage}
            onClick={onPrevPage}
            className="py-1 px-3 bg-white border border-gray-300 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none cursor-pointer shadow-2xs"
          >
            Anterior
          </button>
          <button
            type="button"
            disabled={pageIndex + 1 >= totalPages || isLoadingPage}
            onClick={onNextPage}
            className="py-1 px-3 bg-white border border-gray-300 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none cursor-pointer shadow-2xs"
          >
            {isLoadingPage ? 'Carregando...' : 'Próxima'}
          </button>
        </div>
      </div>
    </div>
  );
};
