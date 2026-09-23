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
import { Asset } from '../../types';
import { dbSearchAssetsTargeted } from '../../db/firebase';

export interface QrAssetSelectionTabProps {
  allAssets: Asset[];
  loading: boolean;
  selectedAssetIds: Set<string>;
  setSelectedAssetIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  darkMode: boolean;
  onUpdateAssets?: (newAssets: Asset[]) => void;
}

const ITEMS_PER_TABLE_PAGE = 35;

export default function QrAssetSelectionTab({
  allAssets,
  loading,
  selectedAssetIds,
  setSelectedAssetIds,
  darkMode,
  onUpdateAssets
}: QrAssetSelectionTabProps) {
  // Local filter states
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedComarca, setSelectedComarca] = useState<string>('Todas');
  const [selectedSector, setSelectedSector] = useState<string>('Todos');
  const [selectedStatus, setSelectedStatus] = useState<string>('Todos');
  const [isSearchingServer, setIsSearchingServer] = useState<boolean>(false);

  // Trigger targeted server query without downloading full database
  const handleServerSearch = async () => {
    if (!onUpdateAssets) return;
    setIsSearchingServer(true);
    try {
      const results = await dbSearchAssetsTargeted({
        codeOrPatrimonio: searchTerm.trim() || undefined,
        sector: selectedSector !== 'Todos' ? selectedSector : undefined,
        unitOrComarca: selectedComarca !== 'Todas' ? selectedComarca : undefined,
        limitResults: 100
      });
      onUpdateAssets(results);
    } catch (e) {
      console.warn('Erro ao pesquisar ativos direcionados:', e);
    } finally {
      setIsSearchingServer(false);
    }
  };

  // Table pagination state
  const [tablePage, setTablePage] = useState<number>(1);

  // Extract unique comarcas and sectors
  const uniqueComarcas = useMemo(() => {
    const set = new Set<string>();
    allAssets.forEach(a => {
      const c = a.specs?.COMARCA || a.specs?.comarca || (a.location ? a.location.split(' - ')[0] : '');
      if (c && c.trim()) set.add(c.trim());
    });
    return Array.from(set).sort();
  }, [allAssets]);

  const uniqueSectors = useMemo(() => {
    const set = new Set<string>();
    allAssets.forEach(a => {
      if (a.sector) set.add(a.sector);
    });
    return Array.from(set).sort();
  }, [allAssets]);

  // Filtered assets
  const filteredAssets = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return allAssets.filter(asset => {
      if (q) {
        const matchCode = (asset.code || '').toLowerCase().includes(q);
        const matchName = (asset.name || '').toLowerCase().includes(q);
        const matchLoc = (asset.location || '').toLowerCase().includes(q);
        const matchSerial = (asset.specs?.serialNumber || asset.specs?.['Nº DE SÉRIE'] || '').toLowerCase().includes(q);
        const matchModel = (asset.specs?.model || asset.specs?.MODELO || '').toLowerCase().includes(q);
        if (!matchCode && !matchName && !matchLoc && !matchSerial && !matchModel) {
          return false;
        }
      }
      if (selectedComarca !== 'Todas') {
        const c = asset.specs?.COMARCA || asset.specs?.comarca || (asset.location ? asset.location.split(' - ')[0] : '');
        if (c !== selectedComarca) return false;
      }
      if (selectedSector !== 'Todos') {
        if (asset.sector !== selectedSector) return false;
      }
      if (selectedStatus !== 'Todos') {
        if (asset.status !== selectedStatus) return false;
      }
      return true;
    });
  }, [allAssets, searchTerm, selectedComarca, selectedSector, selectedStatus]);

  // Reset pagination on filter changes
  useEffect(() => {
    setTablePage(1);
  }, [searchTerm, selectedComarca, selectedSector, selectedStatus]);

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

  const handleSelectAllFiltered = () => {
    const next = new Set(selectedAssetIds);
    filteredAssets.forEach(a => next.add(a.id));
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
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por código, nome, local..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={`w-full pl-9 pr-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-medium ${
                darkMode ? 'bg-slate-800/80 border-slate-700 text-white' : 'bg-slate-50 border-slate-200 text-slate-800'
              }`}
            />
          </div>

          <div>
            <select
              value={selectedComarca}
              onChange={(e) => setSelectedComarca(e.target.value)}
              className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-semibold ${
                darkMode ? 'bg-slate-800/80 border-slate-700 text-white' : 'bg-slate-50 border-slate-200 text-slate-800'
              }`}
            >
              <option value="Todas">Comarca: Todas ({uniqueComarcas.length})</option>
              {uniqueComarcas.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div>
            <select
              value={selectedSector}
              onChange={(e) => setSelectedSector(e.target.value)}
              className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-semibold ${
                darkMode ? 'bg-slate-800/80 border-slate-700 text-white' : 'bg-slate-50 border-slate-200 text-slate-800'
              }`}
            >
              <option value="Todos">Setor: Todos ({uniqueSectors.length})</option>
              {uniqueSectors.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-semibold ${
                darkMode ? 'bg-slate-800/80 border-slate-700 text-white' : 'bg-slate-50 border-slate-200 text-slate-800'
              }`}
            >
              <option value="Todos">Status: Todos</option>
              <option value="Operando">Operando</option>
              <option value="Em Manutenção">Em Manutenção</option>
              <option value="Parado">Parado</option>
            </select>
          </div>
        </div>

        {/* Action button to execute targeted search */}
        {onUpdateAssets && (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={handleServerSearch}
              disabled={isSearchingServer}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer"
            >
              {isSearchingServer ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Consultando servidor...</span>
                </>
              ) : (
                <>
                  <Search className="w-3.5 h-3.5" />
                  <span>Buscar Ativos Filtrados</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* Mass Selection Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-3 border-t border-slate-200/60 dark:border-slate-800">
          <div className="flex items-center flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSelectAllFiltered}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              Selecionar Todos Filtrados ({filteredAssets.length})
            </button>

            <button
              type="button"
              onClick={handleDeselectAllFiltered}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <Square className="w-3.5 h-3.5" />
              Desmarcar Filtrados
            </button>

            <button
              type="button"
              onClick={handleClearAll}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/50 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Limpar Seleção
            </button>
          </div>

          <div className="text-xs font-bold text-slate-500 font-mono">
            Filtrados: <span className="text-slate-900 dark:text-white font-black">{filteredAssets.length}</span> &bull; Marcados para Imprimir: <span className="text-indigo-600 dark:text-indigo-400 font-black">{selectedAssetIds.size}</span>
          </div>
        </div>
      </div>

      {/* ASSET TABLE WITH INSTANT PAGINATION */}
      <div className={`rounded-2xl border overflow-hidden ${darkMode ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200 shadow-xs'}`}>
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
