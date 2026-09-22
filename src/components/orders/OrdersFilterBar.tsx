import React from 'react';
import { SlidersHorizontal, Search, X, QrCode } from 'lucide-react';

export interface OrdersFilterBarProps {
  smartSearch: string;
  setSmartSearch: (val: string) => void;
  selectedComarca: string;
  setSelectedComarca: (val: string) => void;
  comarcasList: string[];
  selectedPatrimonio: string;
  setSelectedPatrimonio: (val: string) => void;
  patrimoniosList: string[];
  selectedExecutionDate: string;
  setSelectedExecutionDate: (val: string) => void;
  selectedStatus: string;
  setSelectedStatus: (val: string) => void;
  onOpenScanSimulator: () => void;
}

export default function OrdersFilterBar({
  smartSearch,
  setSmartSearch,
  selectedComarca,
  setSelectedComarca,
  comarcasList,
  selectedPatrimonio,
  setSelectedPatrimonio,
  patrimoniosList,
  selectedExecutionDate,
  setSelectedExecutionDate,
  selectedStatus,
  setSelectedStatus,
  onOpenScanSimulator
}: OrdersFilterBarProps) {
  const getTodayStr = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const hasActiveFilters =
    smartSearch ||
    selectedComarca !== 'Todas' ||
    selectedPatrimonio !== 'Todos' ||
    selectedStatus !== 'Todos' ||
    selectedExecutionDate !== '';

  const handleClearFilters = () => {
    setSmartSearch('');
    setSelectedComarca('Todas');
    setSelectedPatrimonio('Todos');
    setSelectedStatus('Todos');
    setSelectedExecutionDate('');
  };

  return (
    <section className="bg-white rounded-xl p-5 shadow-sm border border-gray-200">
      <div className="flex items-center gap-2 mb-4">
        <SlidersHorizontal className="w-4 h-4 text-indigo-600" />
        <h2 className="text-xs font-black text-slate-800 uppercase tracking-wider">
          Painel de Filtros & Busca Inteligente
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Smart Search */}
        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
            Busca Inteligente (ID, Título, Técnico)
          </label>
          <div className="flex gap-2">
            <div className="relative flex-grow">
              <input
                type="text"
                value={smartSearch}
                onChange={(e) => setSmartSearch(e.target.value)}
                placeholder="Pesquisar ID, Técnico, Titulo..."
                className="w-full text-xs py-2 pl-8 pr-8 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium text-slate-800"
              />
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-3" />
              {smartSearch && (
                <button
                  onClick={() => setSmartSearch('')}
                  className="absolute right-2 top-2.5 p-0.5 text-gray-400 hover:text-rose-600 rounded cursor-pointer"
                  title="Limpar pesquisa"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={onOpenScanSimulator}
              className="px-3 bg-indigo-50 border border-indigo-200 text-[#3525cd] hover:bg-indigo-100 rounded-lg text-xs font-black flex items-center gap-1 hover:shadow-2xs cursor-pointer shrink-0 transition-colors"
              title="Escanear QR Ativo para Localizar Preventiva"
            >
              <QrCode className="w-4 h-4" />
              <span className="hidden sm:inline">Escanear Ativo</span>
            </button>
          </div>
        </div>

        {/* Comarca selector */}
        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
            Comarca
          </label>
          <select
            value={selectedComarca}
            onChange={(e) => setSelectedComarca(e.target.value)}
            className="w-full text-xs py-2 px-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold text-slate-800"
          >
            <option value="Todas">Todas as Comarcas</option>
            {comarcasList.map((comarca) => (
              <option key={comarca} value={comarca}>
                {comarca}
              </option>
            ))}
          </select>
        </div>

        {/* Patrimônio selector */}
        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
            Patrimônio (Ativo)
          </label>
          <select
            value={selectedPatrimonio}
            onChange={(e) => setSelectedPatrimonio(e.target.value)}
            className="w-full text-xs py-2 px-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold text-slate-800"
          >
            <option value="Todos">Todos os Patrimônios</option>
            {patrimoniosList.map((pat) => (
              <option key={pat} value={pat}>
                {pat}
              </option>
            ))}
          </select>
        </div>

        {/* Filter by Execution Date */}
        <div>
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 flex items-center justify-between">
            <span>Dia Programado</span>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedExecutionDate(getTodayStr())}
                className={`text-[8.5px] px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
                  selectedExecutionDate === getTodayStr()
                    ? 'bg-indigo-650 text-white font-extrabold'
                    : 'bg-gray-150 text-slate-600 hover:bg-gray-200'
                }`}
              >
                Hoje
              </button>
              <button
                type="button"
                onClick={() => setSelectedExecutionDate('')}
                className={`text-[8.5px] px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
                  !selectedExecutionDate
                    ? 'bg-indigo-610 text-white font-extrabold'
                    : 'bg-gray-150 text-slate-600 hover:bg-gray-200'
                }`}
              >
                Ver Todos
              </button>
            </div>
          </label>
          <div className="relative">
            <input
              type="date"
              value={selectedExecutionDate}
              onChange={(e) => setSelectedExecutionDate(e.target.value)}
              className="w-full text-xs py-1.5 px-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold text-slate-800"
            />
            {selectedExecutionDate && (
              <button
                onClick={() => setSelectedExecutionDate('')}
                className="absolute right-7 top-2 text-gray-400 hover:text-rose-600 cursor-pointer"
                title="Listar sem data"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Status filtering row & quick clear */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-3 mt-4 border-t border-gray-100">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Status da OS:</span>
          <div className="flex flex-wrap gap-1.5">
            {['Todos', 'Planejada', 'Em Execução', 'Concluída', 'Não Executada'].map((sts) => {
              const isActive = selectedStatus === sts;
              return (
                <button
                  key={sts}
                  onClick={() => setSelectedStatus(sts)}
                  className={`px-3 py-1 text-[10px] font-extrabold rounded-lg border transition-all duration-150 cursor-pointer ${
                    isActive
                      ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm font-black'
                      : 'bg-white border-gray-200 text-slate-600 hover:bg-gray-55'
                  }`}
                >
                  {sts}
                </button>
              );
            })}
          </div>
        </div>

        {hasActiveFilters && (
          <button
            onClick={handleClearFilters}
            className="text-[10px] font-black text-rose-600 hover:text-rose-800 uppercase tracking-wider flex items-center gap-1 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            Limpar Filtros Ativos
          </button>
        )}
      </div>
    </section>
  );
}
