import React from 'react';
import {
  Trash2,
  Flag,
  CheckCircle2,
  Calendar,
  Clock,
  Wrench,
  User,
  RotateCcw,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { ServiceOrder, formatDateBR, HexonUser } from '../../types';

export interface OrdersCardGridProps {
  paginatedOrders: ServiceOrder[];
  totalFilteredOrders: number;
  totalAllOrders: number;
  selectedOrderIds: string[];
  isAllSelected: boolean;
  onToggleSelectAll: () => void;
  onToggleSelectOrder: (id: string) => void;
  onClearSelection: () => void;
  onOpenBulkDeleteModal: () => void;
  onViewOrder: (os: ServiceOrder) => void;
  onDeleteOrder: (osId: string) => void;
  onRevertOrder: (os: ServiceOrder) => void;
  canRevertUnexecutedOrder: (os: ServiceOrder, targetMonthDate?: Date) => boolean;
  currentCalendarDate: Date;
  userProfile?: HexonUser | null;
  getOrderComarca: (os: ServiceOrder) => string;
  getOrderCRAAI: (os: ServiceOrder) => string;
  currentPage: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
  onPageChange: (newPage: number) => void;
}

export default function OrdersCardGrid({
  paginatedOrders,
  totalFilteredOrders,
  totalAllOrders,
  selectedOrderIds,
  isAllSelected,
  onToggleSelectAll,
  onToggleSelectOrder,
  onClearSelection,
  onOpenBulkDeleteModal,
  onViewOrder,
  onDeleteOrder,
  onRevertOrder,
  canRevertUnexecutedOrder,
  currentCalendarDate,
  userProfile,
  getOrderComarca,
  getOrderCRAAI,
  currentPage,
  totalPages,
  startIndex,
  endIndex,
  onPageChange
}: OrdersCardGridProps) {
  const sanitizedPage = Math.min(Math.max(1, currentPage), totalPages);

  return (
    <section className="bg-transparent flex flex-col gap-4">
      {paginatedOrders.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="select-all-page"
              checked={isAllSelected}
              onChange={onToggleSelectAll}
              className="w-4.5 h-4.5 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 cursor-pointer"
            />
            <label htmlFor="select-all-page" className="text-xs font-black text-slate-705 cursor-pointer select-none">
              Selecionar Todas desta Página ({paginatedOrders.length} {paginatedOrders.length === 1 ? 'preventiva' : 'preventivas'})
            </label>
            {selectedOrderIds.length > 0 && (
              <span className="bg-indigo-50 text-indigo-750 text-[10px] font-black px-2.5 py-0.5 rounded-full border border-indigo-150">
                {selectedOrderIds.length} selecionada{selectedOrderIds.length > 1 ? 's' : ''}
              </span>
            )}
          </div>

          {selectedOrderIds.length > 0 && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClearSelection}
                className="text-[10px] font-black text-slate-500 hover:text-slate-800 uppercase tracking-widest px-2.5 py-1.5 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Limpar Seleção
              </button>
              {userProfile?.perfil !== 'Profissional' && (
                <button
                  type="button"
                  onClick={onOpenBulkDeleteModal}
                  className="bg-rose-50 border border-rose-250 text-rose-600 hover:bg-rose-100 hover:text-rose-700 px-3.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 cursor-pointer shadow-3xs transition-all active:scale-[0.98]"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Excluir Selecionadas ({selectedOrderIds.length})
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {paginatedOrders.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 text-center py-16 text-gray-400 font-bold italic">
          Nenhuma ordem de serviço preventiva localizada para os filtros definidos.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {paginatedOrders.map((os) => {
            const isCompleted = os.status === 'Concluída';
            const isDelayed = os.status === 'Atrasada';
            const isInProgress = os.status === 'Em Execução';
            const isNotExecuted = os.status === 'Não Executada';
            const notExecuted = !isCompleted;
            const isSelected = selectedOrderIds.includes(os.id);

            return (
              <div
                key={os.id}
                onClick={() => onViewOrder(os)}
                className={`group bg-white rounded-xl border p-4 shadow-xs relative flex flex-col justify-between cursor-pointer transition-all duration-200 hover:shadow-md hover:scale-[1.01] overflow-hidden ${
                  isSelected
                    ? 'border-indigo-400 ring-2 ring-indigo-500/20 bg-indigo-50/10 border-l-[6px] border-l-indigo-600'
                    : notExecuted
                    ? 'border-l-[6px] border-l-rose-500 border-gray-200 bg-rose-50/5 hover:border-l-rose-600 hover:border-indigo-300'
                    : 'border-l-[6px] border-l-emerald-500 border-gray-200 hover:border-indigo-300'
                }`}
              >
                {/* PULSING RED FLAG CONVERSIONS FOR NOT EXECUTED ONES */}
                {notExecuted && (
                  <div className="absolute top-0 right-0 z-10">
                    <div className="bg-rose-600 text-white text-[9px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-bl-lg flex items-center gap-1 shadow-sm animate-pulse">
                      <Flag className="w-2.5 h-2.5 fill-white text-white" />
                      <span>Pendente</span>
                    </div>
                  </div>
                )}

                {isCompleted && (
                  <div className="absolute top-0 right-0 z-10">
                    <div className="bg-emerald-600 text-white text-[9px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-bl-lg flex items-center gap-1 shadow-xs">
                      <CheckCircle2 className="w-2.5 h-2.5 text-white" />
                      <span>Concluído</span>
                    </div>
                  </div>
                )}

                <div>
                  {/* Top Row: ID & Category */}
                  <div className="flex items-center gap-2 mb-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => {
                        e.stopPropagation();
                        onToggleSelectOrder(os.id);
                      }}
                      className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 cursor-pointer"
                    />
                    <span className="font-mono text-[#3525cd] font-black text-xs">
                      #{os.id}
                    </span>
                    <span className="text-[8.5px] font-black uppercase tracking-wider text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                      Preventiva
                    </span>
                  </div>

                  {/* Service Description Title - standardized height limits content overlap */}
                  <h3 className="font-extrabold text-slate-800 group-hover:text-[#3525cd] transition-colors text-[12px] leading-snug break-words pr-16 line-clamp-2 mb-2 min-h-[32px] flex items-center">
                    {os.title}
                  </h3>

                  {/* Periodicity / date parameters */}
                  <div className="mb-3 space-y-1.5">
                    {os.startDate && os.endDate && (
                      <div className="flex items-center gap-1 text-[9px] font-black text-slate-500 bg-slate-50/80 border border-slate-200 px-2 py-1 rounded-lg w-full whitespace-normal leading-tight">
                        <Calendar className="w-3 h-3 text-slate-400 shrink-0" />
                        <span>Janela: {formatDateBR(os.startDate)} até {formatDateBR(os.endDate)}</span>
                      </div>
                    )}

                    {os.scheduledDate ? (
                      <div className="flex items-center gap-1.5 text-[10px] font-black text-indigo-850 bg-indigo-50 border border-indigo-200 px-2.5 py-1.5 rounded-lg w-full whitespace-normal leading-tight shadow-3xs">
                        <Clock className="w-3.5 h-3.5 text-[#3525cd] shrink-0 animate-pulse" />
                        {os.scheduledEndDate ? (
                          <span>PERÍODO DE EXECUÇÃO: <strong className="text-[#3525cd] text-[10.5px]">{formatDateBR(os.scheduledDate)} até {formatDateBR(os.scheduledEndDate)}</strong></span>
                        ) : (
                          <span>DIA DE EXECUÇÃO DETERMINADO: <strong className="text-[#3525cd] text-[10.5px]">{formatDateBR(os.scheduledDate)}</strong></span>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-[9px] font-black text-slate-605 bg-slate-50 border border-slate-150 px-2 py-1 rounded-lg w-full whitespace-normal leading-tight">
                        <Clock className="w-3 h-3 text-slate-500 shrink-0" />
                        <span>Não agendado</span>
                      </div>
                    )}
                  </div>

                  {/* Equipment/Asset Info Box (Patrimônio & Técnico Responsável) */}
                  <div className="bg-slate-50 border border-slate-100 rounded-lg p-2.5 mb-3 space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Wrench className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                      <div className="min-w-0 flex-1 flex items-center justify-between">
                        <span className="text-[7.5px] font-black text-slate-400 uppercase tracking-widest leading-none">Patrimônio</span>
                        <span className="text-[9px] text-[#3525cd] font-black bg-indigo-50 border border-indigo-100 font-mono px-1.5 py-0.5 rounded inline-block">
                          {os.assetCode}
                        </span>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-200/50 flex items-start gap-1.5">
                      <User className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[7.5px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Técnico Responsável</p>
                        <p className="font-extrabold text-slate-700 text-[10.5px] leading-snug break-words whitespace-normal">
                          {os.assignedTechnician || 'Não designado'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Location Specs Row with strict dimension boundaries */}
                  <div className="grid grid-cols-2 gap-2 mb-3.5 text-[9px] font-extrabold text-slate-700">
                    <div className="bg-white p-2 rounded-lg border border-slate-150 flex flex-col min-w-0 shadow-3xs">
                      <span className="text-[7.5px] text-slate-450 font-bold uppercase tracking-wider mb-0.5">CRAAI</span>
                      <span className="text-slate-800 truncate uppercase mt-0.5 text-[9px]" title={getOrderCRAAI(os)}>
                        {getOrderCRAAI(os)}
                      </span>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-slate-150 flex flex-col min-w-0 shadow-3xs">
                      <span className="text-[7.5px] text-slate-450 font-bold uppercase tracking-wider mb-0.5">Comarca</span>
                      <span className="text-slate-800 truncate uppercase mt-0.5 text-[9px]" title={getOrderComarca(os)}>
                        {getOrderComarca(os)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Actions & Status Row */}
                <div className="flex items-center justify-between pt-3 border-t border-gray-150/70" onClick={(e) => e.stopPropagation()}>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[8.5px] font-black uppercase tracking-wider whitespace-nowrap border ${
                    isCompleted
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : isDelayed
                      ? 'bg-rose-50 text-rose-700 border-rose-200 animate-pulse'
                      : isNotExecuted
                      ? 'bg-slate-100 text-slate-500 border-slate-300 line-through'
                      : isInProgress
                      ? 'bg-amber-50 text-amber-700 border-amber-200 animate-pulse'
                      : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                  }`}>
                    <span className={`w-1 h-1 rounded-full ${
                      isCompleted ? 'bg-emerald-500' : isDelayed ? 'bg-rose-500' : isNotExecuted ? 'bg-slate-400' : isInProgress ? 'bg-amber-500' : 'bg-indigo-500'
                    }`} />
                    {os.status}
                  </span>

                  <div className="flex justify-end items-center gap-1.5">
                    {isNotExecuted && userProfile?.perfil !== 'Profissional' && (() => {
                      const canRevertThis = canRevertUnexecutedOrder(os, currentCalendarDate);
                      if (!canRevertThis) {
                        return (
                          <span
                            className="text-[8.5px] font-black uppercase text-slate-400 bg-slate-100 px-2 py-0.5 rounded border border-slate-200"
                            title="O prazo da criação em lote expirou ou não corresponde a este período. Reagendamento bloqueado."
                          >
                            Prazo Expirado
                          </span>
                        );
                      }

                      return (
                        <button
                          type="button"
                          onClick={() => onRevertOrder(os)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-800 text-[9px] font-black uppercase tracking-wider transition-all duration-155 active:scale-95 cursor-pointer shadow-3xs"
                          title="Reverter para Novo (Permitir reagendamento)"
                        >
                          <RotateCcw className="w-3 h-3 text-amber-600" />
                          Reverter para Novo
                        </button>
                      );
                    })()}
                    {userProfile?.perfil !== 'Profissional' && (
                      <button
                        onClick={() => onDeleteOrder(os.id)}
                        className="inline-flex items-center justify-center p-1.5 rounded-md border border-rose-100 bg-rose-50 hover:bg-rose-150 hover:border-rose-300 text-rose-600 transition-all duration-155 active:scale-95 cursor-pointer shadow-3xs"
                        title="Excluir Preventiva"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Dynamic Pagination Footer */}
      <div className="bg-white rounded-xl border border-gray-200 px-5 py-3.5 flex flex-col sm:flex-row justify-between items-center text-xs font-bold text-gray-500 gap-3 mt-4 shadow-sm shrink-0">
        <div>
          Exibindo {totalFilteredOrders > 0 ? startIndex + 1 : 0} até {endIndex} de {totalFilteredOrders} preventivas localizadas (total de {totalAllOrders})
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={sanitizedPage === 1}
            className={`p-1.5 rounded-lg border border-gray-200 bg-white shadow-xs transition-colors cursor-pointer flex items-center justify-center ${
              sanitizedPage === 1 ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-50 text-slate-850'
            }`}
            title="Página Anterior"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-slate-600 font-extrabold px-1.5">
            Página {sanitizedPage} de {totalPages}
          </span>
          <button
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={sanitizedPage === totalPages}
            className={`p-1.5 rounded-lg border border-gray-200 bg-white shadow-xs transition-colors cursor-pointer flex items-center justify-center ${
              sanitizedPage === totalPages ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-50 text-slate-850'
            }`}
            title="Próxima Página"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </section>
  );
}
