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
  statusCounts: Record<string, number>; // quantidade de OS em cada status (com os outros filtros aplicados)
  totalCount: number;
  onOpenScanSimulator: () => void;
  // Empresa (etapa especial E3): aparece quando há empresas para escolher
  selectedCompany?: string;
  setSelectedCompany?: (val: string) => void;
  companyOptions?: { id: string; name: string }[];
}

// Status na ordem do andamento da OS, com a cor de cada um
const STATUS_CHIPS: { status: string; dot: string }[] = [
  { status: 'Novo', dot: 'bg-sky-500' },
  { status: 'Planejada', dot: 'bg-indigo-500' },
  { status: 'Em Execução', dot: 'bg-blue-600' },
  { status: 'Atrasada', dot: 'bg-amber-500' },
  { status: 'Concluída', dot: 'bg-emerald-500' },
  { status: 'Não Executada', dot: 'bg-rose-500' },
  { status: 'Cancelada', dot: 'bg-slate-400' }
];

const labelClass = 'block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5';
const fieldClass =
  'w-full h-10 text-xs px-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold text-slate-800';

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
  statusCounts,
  totalCount,
  onOpenScanSimulator,
  selectedCompany = 'Todas',
  setSelectedCompany,
  companyOptions = []
}: OrdersFilterBarProps) {
  const showCompany = !!setSelectedCompany && companyOptions.length > 0;
  const getTodayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const todayStr = getTodayStr();

  const hasActiveFilters =
    smartSearch ||
    selectedComarca !== 'Todas' ||
    selectedCompany !== 'Todas' ||
    selectedPatrimonio !== 'Todos' ||
    selectedStatus !== 'Todos' ||
    selectedExecutionDate !== '';

  const handleClearFilters = () => {
    setSmartSearch('');
    setSelectedComarca('Todas');
    setSelectedCompany?.('Todas');
    setSelectedPatrimonio('Todos');
    setSelectedStatus('Todos');
    setSelectedExecutionDate('');
  };

  // Mostra os status que têm OS (e o escolhido, mesmo sem OS)
  const chips = STATUS_CHIPS.filter((c) => (statusCounts[c.status] || 0) > 0 || selectedStatus === c.status);

  return (
    <section className="bg-white rounded-xl p-5 shadow-sm border border-gray-200 space-y-4">
      {/* Título */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-start gap-2">
          <SlidersHorizontal className="w-4 h-4 text-indigo-600 mt-0.5" />
          <div>
            <h2 className="text-xs font-black text-slate-800 uppercase tracking-wider">Filtros</h2>
            <p className="text-[11px] font-semibold text-slate-500 mt-0.5">
              OS abertas e as concluídas/não executadas deste mês. Meses anteriores: aba Consulta de OS.
            </p>
          </div>
        </div>
        {hasActiveFilters && (
          <button
            onClick={handleClearFilters}
            className="self-start sm:self-auto text-[10px] font-black text-rose-600 hover:text-rose-800 uppercase tracking-wider flex items-center gap-1 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            Limpar filtros
          </button>
        )}
      </div>

      {/* Busca */}
      <div>
        <label className={labelClass}>Buscar (nº da OS, título, técnico, patrimônio)</label>
        <div className="flex gap-2">
          <div className="relative flex-grow">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
            <input
              type="text"
              value={smartSearch}
              onChange={(e) => setSmartSearch(e.target.value)}
              placeholder="Digite para buscar..."
              className={`${fieldClass} pl-9 pr-9`}
            />
            {smartSearch && (
              <button
                onClick={() => setSmartSearch('')}
                className="absolute right-2.5 top-2.5 p-0.5 text-gray-400 hover:text-rose-600 rounded cursor-pointer"
                title="Limpar busca"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onOpenScanSimulator}
            className="h-10 px-4 bg-indigo-50 border border-indigo-200 text-[#3525cd] hover:bg-indigo-100 rounded-lg text-xs font-black flex items-center gap-1.5 cursor-pointer shrink-0 transition-colors"
            title="Escanear o QR do ativo para localizar a preventiva"
          >
            <QrCode className="w-4 h-4" />
            <span className="hidden sm:inline">Escanear ativo</span>
          </button>
        </div>
      </div>

      {/* Empresa, comarca, patrimônio e dia */}
      <div className={`grid grid-cols-1 gap-4 ${showCompany ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
        {showCompany && (
          <div>
            <label className={labelClass}>Empresa</label>
            <select value={selectedCompany} onChange={(e) => setSelectedCompany!(e.target.value)} className={fieldClass} aria-label="Filtrar por empresa">
              <option value="Todas">Todas as empresas</option>
              {companyOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className={labelClass}>Comarca</label>
          <select value={selectedComarca} onChange={(e) => setSelectedComarca(e.target.value)} className={fieldClass}>
            <option value="Todas">Todas as comarcas</option>
            {comarcasList.map((comarca) => (
              <option key={comarca} value={comarca}>
                {comarca}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>Patrimônio (ativo)</label>
          <select value={selectedPatrimonio} onChange={(e) => setSelectedPatrimonio(e.target.value)} className={fieldClass}>
            <option value="Todos">Todos os patrimônios</option>
            {patrimoniosList.map((pat) => (
              <option key={pat} value={pat}>
                {pat}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>Dia programado</label>
          <div className="flex gap-2">
            <input
              type="date"
              value={selectedExecutionDate}
              onChange={(e) => setSelectedExecutionDate(e.target.value)}
              className={fieldClass}
            />
            <button
              type="button"
              onClick={() => setSelectedExecutionDate(selectedExecutionDate === todayStr ? '' : todayStr)}
              className={`h-10 px-3 rounded-lg border text-[11px] font-black shrink-0 cursor-pointer transition-colors ${
                selectedExecutionDate === todayStr
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : 'bg-white border-gray-200 text-slate-600 hover:bg-gray-50'
              }`}
              title={selectedExecutionDate === todayStr ? 'Mostrar todos os dias' : 'Só as programadas para hoje'}
            >
              Hoje
            </button>
          </div>
        </div>
      </div>

      {/* Status */}
      <div className="pt-4 border-t border-gray-100">
        <span className={labelClass}>Status da OS</span>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedStatus('Todos')}
            className={`h-8 px-3 text-[11px] font-black rounded-lg border flex items-center gap-1.5 cursor-pointer transition-all ${
              selectedStatus === 'Todos'
                ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                : 'bg-white border-gray-200 text-slate-600 hover:bg-gray-50'
            }`}
          >
            Todos
            <span className={`px-1.5 rounded-md text-[10px] ${selectedStatus === 'Todos' ? 'bg-white/20' : 'bg-gray-100 text-slate-500'}`}>
              {totalCount}
            </span>
          </button>
          {chips.map(({ status, dot }) => {
            const isActive = selectedStatus === status;
            return (
              <button
                key={status}
                onClick={() => setSelectedStatus(isActive ? 'Todos' : status)}
                className={`h-8 px-3 text-[11px] font-black rounded-lg border flex items-center gap-1.5 cursor-pointer transition-all ${
                  isActive
                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                    : 'bg-white border-gray-200 text-slate-600 hover:bg-gray-50'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-white' : dot}`} />
                {status}
                <span className={`px-1.5 rounded-md text-[10px] ${isActive ? 'bg-white/20' : 'bg-gray-100 text-slate-500'}`}>
                  {statusCounts[status] || 0}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
