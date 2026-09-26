import React, { useState, useMemo, useEffect } from 'react';
import {
  Search,
  CheckSquare,
  Square,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  QrCode,
  Loader2
} from 'lucide-react';
import { Asset, Address } from '../../types';
import { useAssetFilters } from '../../hooks/useAssetFilters';
import { AssetFilterBar } from '../assets/AssetFilterBar';

export interface QrAssetSelectionTabProps {
  allAssets: Asset[];
  loading: boolean;
  selectedAssetIds: Set<string>;
  setSelectedAssetIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  darkMode: boolean;
  addresses: Address[]; // listas de CRAAI e Comarca
  managementNames: string[];
}

const ITEMS_PER_TABLE_PAGE = 35;

export default function QrAssetSelectionTab({
  allAssets,
  loading,
  selectedAssetIds,
  setSelectedAssetIds,
  darkMode,
  addresses,
  managementNames
}: QrAssetSelectionTabProps) {
  // Mesmos filtros da tela de Ativos, sobre a cópia local (ativos + endereços), sem leitura no banco
  const filters = useAssetFilters(allAssets, addresses, managementNames);
  const filteredAssets = filters.results;

  // Table pagination state
  const [tablePage, setTablePage] = useState<number>(1);

  // Reset pagination on filter changes
  useEffect(() => {
    setTablePage(1);
  }, [filters.filtersKey]);

  const totalTablePages = Math.max(1, Math.ceil(filteredAssets.length / ITEMS_PER_TABLE_PAGE));
  const paginatedAssets = useMemo(() => {
    const start = (tablePage - 1) * ITEMS_PER_TABLE_PAGE;
    return filteredAssets.slice(start, start + ITEMS_PER_TABLE_PAGE);
  }, [filteredAssets, tablePage]);

  // Selection handlers
  const handleToggleSelectAsset = (id: string) => {
    const next = new Set(selectedAssetIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedAssetIds(next);
  };

  // Baixados só entram quando o filtro de Status for "Baixado" (não imprime etiqueta de ativo que saiu)
  const selectableFiltered = filters.status === 'Baixado' ? filteredAssets : filteredAssets.filter((a) => a.status !== 'Baixado');
  const handleSelectAllFiltered = () => {
    const next = new Set(selectedAssetIds);
    selectableFiltered.forEach(a => next.add(a.id));
    setSelectedAssetIds(next);
  };

  const handleDeselectAllFiltered = () => {
    const next = new Set(selectedAssetIds);
    filteredAssets.forEach(a => next.delete(a.id));
    setSelectedAssetIds(next);
  };

  const handleClearAll = () => {
    setSelectedAssetIds(new Set());
  };

  return (
    <div className="space-y-4">
      {/* FILTER BAR */}
      <div className={`p-4 rounded-2xl border ${darkMode ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200'}`}>
        <AssetFilterBar f={filters} />
      </div>

      {/* ASSET TABLE WITH INSTANT PAGINATION */}
      <div className={`rounded-2xl border overflow-hidden ${darkMode ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200 shadow-xs'}`}>
        {/* Barra de seleção: contagem à esquerda, ações à direita */}
        <div className={`px-4 py-3 border-b flex flex-wrap items-center justify-between gap-3 ${darkMode ? 'bg-slate-800/40 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            <strong className="text-slate-800 dark:text-white">{filteredAssets.length.toLocaleString('pt-BR')}</strong> filtrado(s) ·{' '}
            <strong className="text-indigo-600 dark:text-indigo-400">{selectedAssetIds.size.toLocaleString('pt-BR')}</strong> marcado(s) para imprimir
          </p>
          <div className="flex items-center flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSelectAllFiltered}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              Selecionar filtrados ({selectableFiltered.length.toLocaleString('pt-BR')})
            </button>
            <button
              type="button"
              onClick={handleDeselectAllFiltered}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <Square className="w-3.5 h-3.5" />
              Desmarcar filtrados
            </button>
            {selectedAssetIds.size > 0 && (
              <button
                type="button"
                onClick={handleClearAll}
                className="px-2 py-1.5 text-xs font-bold text-rose-600 hover:text-rose-700 dark:text-rose-400 flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Limpar seleção
              </button>
            )}
          </div>
        </div>
        {loading ? (
          <div className="p-12 text-center text-slate-400 space-y-3">
            <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs font-bold uppercase tracking-wider font-mono">Carregando base de ativos...</p>
          </div>
        ) : filteredAssets.length === 0 ? (
          <div className="p-12 text-center text-slate-400 space-y-2">
            <Search className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600" />
            <p className="text-sm font-bold">Nenhum ativo encontrado com os filtros selecionados.</p>
            <p className="text-xs">Tente alterar os termos de busca ou comarca.</p>
          </div>
        ) : (
          <div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className={`text-[10px] font-black uppercase tracking-wider font-mono border-b ${
                  darkMode ? 'bg-slate-900 border-slate-800 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-500'
                }`}>
                  <tr>
                    <th className="py-3 px-4 w-12 text-center">
                      <input
                        type="checkbox"
                        checked={paginatedAssets.length > 0 && paginatedAssets.every(a => selectedAssetIds.has(a.id))}
                        onChange={(e) => {
                          const next = new Set(selectedAssetIds);
                          if (e.target.checked) {
                            paginatedAssets.forEach(a => next.add(a.id));
                          } else {
                            paginatedAssets.forEach(a => next.delete(a.id));
                          }
                          setSelectedAssetIds(next);
                        }}
                        className="rounded text-indigo-600 cursor-pointer"
                        title="Selecionar todos os itens desta página"
                      />
                    </th>
                    <th className="py-3 px-3 w-12 text-center">Tipo</th>
                    <th className="py-3 px-4">Código</th>
                    <th className="py-3 px-4">Nome do Ativo</th>
                    <th className="py-3 px-4">Comarca / Localização</th>
                    <th className="py-3 px-4">Setor</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                  {paginatedAssets.map(asset => {
                    const isSelected = selectedAssetIds.has(asset.id);
                    const comarcaStr = asset.specs?.COMARCA || asset.specs?.comarca || (asset.location ? asset.location.split(' - ')[0] : '-');

                    return (
                      <tr
                        key={asset.id}
                        onClick={() => handleToggleSelectAsset(asset.id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? darkMode ? 'bg-indigo-950/30 hover:bg-indigo-950/50' : 'bg-indigo-50/70 hover:bg-indigo-50'
                            : darkMode ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50/80'
                        }`}
                      >
                        <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleSelectAsset(asset.id)}
                            className="rounded text-indigo-600 cursor-pointer"
                          />
                        </td>
                        <td className="py-2 px-3 text-center">
                          <div className="w-7 h-7 mx-auto bg-indigo-50 dark:bg-indigo-950/50 rounded-lg flex items-center justify-center text-indigo-600 dark:text-indigo-400 border border-indigo-200/50 dark:border-indigo-800/50">
                            <QrCode className="w-3.5 h-3.5" />
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                          {asset.code}
                        </td>
                        <td className="py-3 px-4 text-slate-800 dark:text-slate-100 font-bold">
                          {asset.name}
                        </td>
                        <td className="py-3 px-4 text-slate-500 dark:text-slate-400">
                          <span className="font-semibold text-slate-700 dark:text-slate-300">{comarcaStr}</span>
                          <span className="block text-[10px] text-slate-400 truncate max-w-xs">{asset.location}</span>
                        </td>
                        <td className="py-3 px-4 text-slate-600 dark:text-slate-300 font-semibold">
                          {asset.sector}
                        </td>
                        <td className="py-3 px-4">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            asset.status === 'Operando'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : asset.status === 'Em Manutenção'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                              : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                          }`}>
                            {asset.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* TABLE PAGINATION BAR */}
            <div className={`p-3 border-t flex flex-wrap items-center justify-between gap-3 text-xs ${
              darkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="text-slate-500 font-mono">
                Mostrando itens {(tablePage - 1) * ITEMS_PER_TABLE_PAGE + 1} a {Math.min(tablePage * ITEMS_PER_TABLE_PAGE, filteredAssets.length)} de {filteredAssets.length}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTablePage(p => Math.max(1, p - 1))}
                  disabled={tablePage <= 1}
                  className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-30 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer font-bold flex items-center gap-1"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Anterior
                </button>

                <span className="font-mono font-bold px-2">
                  {tablePage} / {totalTablePages}
                </span>

                <button
                  onClick={() => setTablePage(p => Math.min(totalTablePages, p + 1))}
                  disabled={tablePage >= totalTablePages}
                  className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-30 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer font-bold flex items-center gap-1"
                >
                  Próxima <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
