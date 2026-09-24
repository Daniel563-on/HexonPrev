import React, { useState } from 'react';
import {
  Calendar,
  Clock,
  AlertTriangle,
  Eye,
  X,
  PlusCircle,
  Check,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Camera,
  MapPin,
  Zap,
  RotateCcw,
  SlidersHorizontal,
  User,
  Search,
  CheckCircle2,
  FileSignature
} from 'lucide-react';
import { ServiceOrder, Asset, formatDateBR, HexonUser, isSectorInGerencia, getSectorGerencia } from '../../types';
import { formatOrderNumber } from '../../utils/orderNumber';
import { dbSaveServiceOrder, PlanningDeadline } from '../../db/firebase';

export interface OrdersCalendarPlanningProps {
  orders: ServiceOrder[];
  assets: Asset[];
  templates: any[];
  users: HexonUser[];
  userProfile?: HexonUser | null;
  userHasActionPermission?: (action: any) => boolean;
  canRevertUnexecutedOrder: (os: ServiceOrder, targetMonthDate?: Date) => boolean;
  deadlines: PlanningDeadline[];
  getCountdownText: (expiresAt: string) => { isExpired: boolean; text: string; hoursLeft: number };
  onReload: () => void;
  onViewOrder: (os: ServiceOrder) => void;
  checkTechAssignment: (techName: string, dateStr: string, os: ServiceOrder) => boolean;
  getOrderComarca: (os: ServiceOrder) => string;
  getOrderCRAAI: (os: ServiceOrder) => string;
  currentCalendarDate: Date;
  setCurrentCalendarDate: React.Dispatch<React.SetStateAction<Date>>;
  selectedCalendarDay: number | null;
  setSelectedCalendarDay: React.Dispatch<React.SetStateAction<number | null>>;
  selectedCalendarEndDay: number | null;
  setSelectedCalendarEndDay: React.Dispatch<React.SetStateAction<number | null>>;
  onOpenBulkRevertModal: (scope: 'period' | 'month') => void;
}

const monthNames = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

export default function OrdersCalendarPlanning({
  orders,
  assets,
  templates,
  users,
  userProfile,
  userHasActionPermission,
  canRevertUnexecutedOrder,
  deadlines,
  getCountdownText,
  onReload,
  onViewOrder,
  checkTechAssignment,
  getOrderComarca,
  getOrderCRAAI,
  currentCalendarDate,
  setCurrentCalendarDate,
  selectedCalendarDay,
  setSelectedCalendarDay,
  selectedCalendarEndDay,
  setSelectedCalendarEndDay,
  onOpenBulkRevertModal
}: OrdersCalendarPlanningProps) {
  // Encapsulated Planning & Scheduling States
  const [planSearch, setPlanSearch] = useState('');
  const [planComarca, setPlanComarca] = useState('all');
  const [planSearchType, setPlanSearchType] = useState<'all' | 'id' | 'patrimonio' | 'craai' | 'comarca'>('all');
  const [isBulkScheduling, setIsBulkScheduling] = useState(false);
  const [bulkAssignTech, setBulkAssignTech] = useState<string>('');
  const [planSector, setPlanSector] = useState(userProfile?.perfil === 'Administrador' && userProfile.gerencia !== 'Todas' ? userProfile?.gerencia || 'all' : 'all');
  const [planPriority, setPlanPriority] = useState('all');
  const [planOnlyCompatible, setPlanOnlyCompatible] = useState(true);
  const [planAssignedTechs, setPlanAssignedTechs] = useState<{ [key: string]: string }>({});
  const [planActiveTab, setPlanActiveTab] = useState<'novas' | 'agendadas'>('novas');
  const [scheduledSubTab, setScheduledSubTab] = useState<'planejadas' | 'concluidas' | 'nao_executadas'>('planejadas');
  const [deplanConfirmOrderId, setDeplanConfirmOrderId] = useState<string | null>(null);
  const [showBulkConfirmModal, setShowBulkConfirmModal] = useState(false);

  const handlePrevMonth = () => {
    setCurrentCalendarDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
    setSelectedCalendarDay(null);
    setSelectedCalendarEndDay(null);
  };

  const handleNextMonth = () => {
    setCurrentCalendarDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
    setSelectedCalendarDay(null);
    setSelectedCalendarEndDay(null);
  };

  const getMonthDays = () => {
    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();
    
    const firstDayIndex = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevDaysInMonth = new Date(year, month, 0).getDate();
    
    const days: { dayNum: number; isCurrentMonth: boolean; dateString: string }[] = [];
    
    // Previous Month padding
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const pmDay = prevDaysInMonth - i;
      const prevMonthDate = new Date(year, month - 1, pmDay);
      const dateString = String(prevMonthDate.getFullYear()) + '-' + String(prevMonthDate.getMonth() + 1).padStart(2, '0') + '-' + String(pmDay).padStart(2, '0');
      days.push({ dayNum: pmDay, isCurrentMonth: false, dateString });
    }
    
    // Current Month days
    for (let i = 1; i <= daysInMonth; i++) {
      const dateString = String(year) + '-' + String(month + 1).padStart(2, '0') + '-' + String(i).padStart(2, '0');
      days.push({ dayNum: i, isCurrentMonth: true, dateString });
    }
    
    // Next Month padding
    const remainingSlots = 42 - days.length;
    for (let i = 1; i <= remainingSlots; i++) {
      const nextMonthDate = new Date(year, month + 1, i);
      const dateString = String(nextMonthDate.getFullYear()) + '-' + String(nextMonthDate.getMonth() + 1).padStart(2, '0') + '-' + String(i).padStart(2, '0');
      days.push({ dayNum: i, isCurrentMonth: false, dateString });
    }
    
    return days;
  };

  const getOrdersForDay = (dayNum: number, isCurrentMonth: boolean) => {
    if (!isCurrentMonth) return [];
    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateStr = String(year) + '-' + pad(month + 1) + '-' + pad(dayNum);
    return orders.filter(os => {
      if (!os.scheduledDate || os.status === 'Novo') return false;
      const start = os.scheduledDate.slice(0, 10);
      const end = (os.scheduledEndDate || os.scheduledDate).slice(0, 10);
      return dateStr >= start && dateStr <= end;
    });
  };

  const availableProfessionals = users.filter(u => 
    u.perfil === 'Profissional' && 
    (userProfile?.gerencia === 'Todas' || u.gerencia === 'Todas' || u.gerencia === userProfile?.gerencia)
  );

  const normalizeStr = (str: string) => {
    return (str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ç/g, 'c')
      .trim();
  };

  const getAvailableProfessionalsForOS = (os: ServiceOrder) => {
    return users.filter(u => {
      if (u.perfil !== 'Profissional') return false;
      
      const adminGer = normalizeStr(userProfile?.gerencia || '');
      const uGer = normalizeStr(u.gerencia || '');
      const osSec = normalizeStr(os.sector || '');

      if (adminGer && adminGer !== 'todas') {
        if (uGer !== adminGer && uGer !== 'todas') return false;
      }
      
      if (osSec && osSec !== 'all' && osSec !== 'todos') {
        if (osSec !== uGer && uGer !== 'todas') {
          const isMatch = 
            (osSec.includes('refr') && uGer.includes('refr')) ||
            (osSec.includes('elet') && uGer.includes('elet')) ||
            (osSec.includes('civil') && uGer.includes('civil')) ||
            (osSec.includes('hidr') && uGer.includes('hidr')) ||
            (osSec.includes('seg') && uGer.includes('seg'));
          if (!isMatch) return false;
        }
      }
      return true;
    });
  };

        let isPlanningExpired = false;
        if (userProfile?.perfil === 'Administrador' && userProfile.gerencia && userProfile.gerencia !== 'Todas') {
          const dlObj = deadlines.find(d => d.id === userProfile.gerencia);
          if (dlObj && dlObj.expiresAt && dlObj.expiresAt !== 'none') {
            const countdownHelper = getCountdownText(dlObj.expiresAt);
            isPlanningExpired = countdownHelper.isExpired;
          }
        }

        if (isPlanningExpired) {
          return (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-12 text-center max-w-2xl mx-auto my-12 shadow-sm animate-fadeIn">
              <div className="w-16 h-16 bg-rose-50 border border-rose-200 text-rose-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <AlertTriangle className="w-8 h-8" />
              </div>
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-800 mb-2">
                Acesso Bloqueado: Prazo de Programação Expirado
              </h3>
              <p className="text-xs text-slate-500 font-semibold leading-relaxed max-w-lg mx-auto">
                O prazo de 7 dias úteis/corridos concedido à sua gerência (<strong className="text-slate-800">{userProfile?.gerencia}</strong>) para planejamento e alocação das ordens preventivas no calendário expirou.
              </p>
              <div className="bg-rose-50/50 border border-rose-100 rounded-xl p-4 my-6 text-[11px] text-rose-800 font-bold max-w-md mx-auto leading-relaxed">
                Todas as preventivas/vistorias que aguardavam programação foram finalizadas automaticamente como "Não Executada".
              </div>
              <p className="text-[11.5px] text-slate-400 font-semibold">
                Caso necessite de mais tempo para realizar alterações, solicite ao <strong className="text-slate-705">Super Administrador</strong> a extensão do prazo limite e ajuste do cronograma.
              </p>
            </div>
          );
        }

        return (
          <div className="space-y-6 animate-fadeIn">
          {/* Top Informative Banner with dynamic instructions */}
          <div className="bg-[#3525cd]/5 border border-[#3525cd]/15 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="bg-[#3525cd]/10 p-2 rounded-lg text-[#3525cd]">
                <Calendar className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wider text-[#3525cd]">
                  Painel de Alocação e Programação de Preventivas
                </h4>
                <p className="text-[11px] text-slate-500 font-semibold mt-0.5 leading-relaxed">
                  {selectedCalendarDay === null
                    ? 'Selecione um dia ou arraste/clique em duas datas no calendário para definir um período de execução e abrir o painel de programação.'
                    : selectedCalendarEndDay !== null && selectedCalendarEndDay > selectedCalendarDay
                      ? `Período em programação ativa: ${selectedCalendarDay} a ${selectedCalendarEndDay} de ${monthNames[currentCalendarDate.getMonth()]} de ${currentCalendarDate.getFullYear()}.`
                      : `Dia em programação ativa: ${selectedCalendarDay} de ${monthNames[currentCalendarDate.getMonth()]} de ${currentCalendarDate.getFullYear()}.`}
                </p>
              </div>
            </div>
            {selectedCalendarDay !== null && (
              <button
                type="button"
                onClick={() => {
                  setSelectedCalendarDay(null);
                  setSelectedCalendarEndDay(null);
                }}
                className="text-xs font-bold text-[#3525cd] bg-white hover:bg-slate-50 border border-slate-205 px-3.5 py-1.5 rounded-lg shadow-2xs transition-all cursor-pointer flex items-center gap-1.5"
              >
                <X className="w-3.5 h-3.5" />
                Fechar Painel e Ver Calendário Completo
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* COLUMN 1: Calendar Widget */}
            <div className={`${selectedCalendarDay === null ? 'lg:col-span-12 max-w-4xl mx-auto w-full' : 'lg:col-span-5'} bg-white rounded-xl p-5 border border-slate-200 shadow-sm transition-all duration-300`}>
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-xs font-black text-slate-800 uppercase tracking-widest flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-[#3525cd]" />
                  Calendário de Distribuição
                </h2>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handlePrevMonth}
                    className="p-1 px-2 border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer text-slate-600 transition-colors"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-xs font-black text-slate-800 uppercase min-w-[110px] text-center select-none">
                    {monthNames[currentCalendarDate.getMonth()]} {currentCalendarDate.getFullYear()}
                  </span>
                  <button
                    type="button"
                    onClick={handleNextMonth}
                    className="p-1 px-2 border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer text-slate-600 transition-colors"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Day headers */}
              <div className="grid grid-cols-7 gap-1.5 text-center mb-1.5 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                <div>Dom</div>
                <div>Seg</div>
                <div>Ter</div>
                <div>Qua</div>
                <div>Qui</div>
                <div>Sex</div>
                <div>Sáb</div>
              </div>

              {/* Day grid */}
              <div className="grid grid-cols-7 gap-1.5">
                {getMonthDays().map((day, dIdx) => {
                  const isCurrentDay = day.isCurrentMonth && day.dayNum === new Date().getDate() && currentCalendarDate.getMonth() === new Date().getMonth() && currentCalendarDate.getFullYear() === new Date().getFullYear();
                  const isStart = day.isCurrentMonth && selectedCalendarDay === day.dayNum;
                  const isEnd = day.isCurrentMonth && selectedCalendarEndDay === day.dayNum;
                  const isSingle = isStart && (selectedCalendarEndDay === null || selectedCalendarEndDay === selectedCalendarDay);
                  const isInRange = day.isCurrentMonth && 
                    selectedCalendarDay !== null && 
                    selectedCalendarEndDay !== null && 
                    selectedCalendarEndDay > selectedCalendarDay && 
                    day.dayNum >= selectedCalendarDay && 
                    day.dayNum <= selectedCalendarEndDay;
                  
                  const dayOrders = getOrdersForDay(day.dayNum, day.isCurrentMonth);
                  const totalCount = dayOrders.length;
                  const completedCount = dayOrders.filter(o => o.status === 'Concluída').length;
                  const unexecutedCount = dayOrders.filter(o => o.status === 'Não Executada').length;
                  const pendingCount = totalCount - completedCount - unexecutedCount;

                  return (
                    <button
                      key={dIdx}
                      type="button"
                      onClick={() => {
                        if (!day.isCurrentMonth) return;
                        const clickedDay = day.dayNum;
                        
                        if (selectedCalendarDay === null) {
                          // No date selected: set as start date
                          setSelectedCalendarDay(clickedDay);
                          setSelectedCalendarEndDay(null);
                        } else if (selectedCalendarDay === clickedDay && selectedCalendarEndDay === null) {
                          // Double clicked on the same single date: deselect
                          setSelectedCalendarDay(null);
                          setSelectedCalendarEndDay(null);
                        } else if (selectedCalendarDay === clickedDay && selectedCalendarEndDay !== null) {
                          // Clicked start date when range existed: collapse to single date or clear
                          setSelectedCalendarDay(clickedDay);
                          setSelectedCalendarEndDay(null);
                        } else if (selectedCalendarEndDay === clickedDay) {
                          // Clicked end date: collapse range back to start date only
                          setSelectedCalendarEndDay(null);
                        } else if (selectedCalendarEndDay === null) {
                          // Start date already exists, now picking end date
                          if (clickedDay > selectedCalendarDay) {
                            setSelectedCalendarEndDay(clickedDay);
                          } else {
                            // Clicked an earlier day: treat it as new start day or swap range
                            setSelectedCalendarEndDay(selectedCalendarDay);
                            setSelectedCalendarDay(clickedDay);
                          }
                        } else {
                          // A range already existed: start fresh from this clicked date
                          setSelectedCalendarDay(clickedDay);
                          setSelectedCalendarEndDay(null);
                        }
                      }}
                      className={`min-h-[64px] border rounded-xl p-1.5 flex flex-col justify-between transition-all duration-200 relative text-left w-full ${
                        day.isCurrentMonth 
                          ? 'bg-white border-slate-200 hover:border-[#3525cd] hover:shadow-xs cursor-pointer' 
                          : 'bg-slate-50/40 border-slate-100 text-slate-350 cursor-not-allowed pointer-events-none'
                      } ${
                        isSingle 
                          ? 'ring-2 ring-[#3525cd] border-[#3525cd] bg-indigo-50/20 shadow-xs' 
                          : ''
                      } ${
                        isStart && selectedCalendarEndDay && selectedCalendarEndDay > selectedCalendarDay
                          ? 'ring-2 ring-[#3525cd] border-[#3525cd] bg-indigo-100/60 shadow-xs' 
                          : ''
                      } ${
                        isEnd && selectedCalendarDay && selectedCalendarEndDay > selectedCalendarDay
                          ? 'ring-2 ring-[#3525cd] border-[#3525cd] bg-indigo-100/60 shadow-xs' 
                          : ''
                      } ${
                        isInRange && !isStart && !isEnd
                          ? 'border-indigo-300 bg-indigo-50/40 text-indigo-900' 
                          : ''
                      } ${
                        isCurrentDay && !isInRange && !isSingle ? 'border-[#3525cd] bg-slate-50' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className={`text-[11px] font-black ${
                          day.isCurrentMonth 
                            ? (isStart || isEnd 
                                ? 'text-white bg-[#3525cd] px-1.5 py-0.5 rounded-md shadow-3xs' 
                                : isInRange 
                                  ? 'text-indigo-900 font-extrabold'
                                  : isCurrentDay 
                                    ? 'text-[#3525cd] bg-indigo-50/80 px-1.5 py-0.5 rounded-md border border-indigo-100' 
                                    : 'text-slate-800') 
                            : 'text-slate-350'
                        }`}>
                          {day.dayNum}
                        </span>
                        {isCurrentDay && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#3525cd]" title="Hoje" />
                        )}
                        {isStart && selectedCalendarEndDay && selectedCalendarEndDay > selectedCalendarDay && (
                          <span className="text-[7.5px] font-black text-indigo-700 uppercase bg-indigo-100/80 px-1 rounded">Início</span>
                        )}
                        {isEnd && selectedCalendarDay && selectedCalendarEndDay > selectedCalendarDay && (
                          <span className="text-[7.5px] font-black text-indigo-700 uppercase bg-indigo-100/80 px-1 rounded">Fim</span>
                        )}
                      </div>
                      
                      {day.isCurrentMonth && totalCount > 0 ? (
                        <div className="flex flex-col gap-0.5 mt-1.5">
                          <span className="bg-[#3525cd]/10 text-[#3525cd] text-[8.5px] font-black rounded px-1 py-0.2 select-none">
                            {totalCount} OS Pl.
                          </span>
                          {unexecutedCount > 0 && (
                            <span className="bg-rose-100 text-rose-800 text-[7px] font-black rounded px-1 py-0.1 select-none text-center">
                              {unexecutedCount} não exec.
                            </span>
                          )}
                          {pendingCount > 0 ? (
                            <span className="bg-amber-100 text-amber-800 text-[7px] font-black rounded px-1 py-0.1 select-none text-center">
                              {pendingCount} pend
                            </span>
                          ) : unexecutedCount === 0 ? (
                            <span className="bg-emerald-100 text-emerald-800 text-[7px] font-black rounded px-1 py-0.1 select-none flex items-center justify-center text-center">
                              ✓ Concl.
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        day.isCurrentMonth && (
                          <span className="text-[7.5px] text-slate-350 font-black italic mt-1 uppercase select-none">
                            Vazio
                          </span>
                        )
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Range selection helper instruction */}
              <div className="mt-3 py-2 px-3 bg-slate-50 rounded-lg border border-slate-200/80 flex items-center justify-between text-[10px] text-slate-500 font-bold">
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-[#3525cd]" />
                  💡 Dica: Clique em uma data e depois em outra para marcar um período/janela. Clique 2 vezes na mesma data para desmarcar.
                </span>
                {selectedCalendarDay !== null && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCalendarDay(null);
                      setSelectedCalendarEndDay(null);
                    }}
                    className="text-[#3525cd] hover:underline cursor-pointer font-black text-[9px] uppercase tracking-wider shrink-0 ml-2"
                  >
                    Limpar
                  </button>
                )}
              </div>

              {/* Monthly totals summary section inside calendar widget */}
              <div className="mt-6 pt-4 border-t border-slate-100">
                <h3 className="text-[10px] font-black text-slate-450 uppercase tracking-widest mb-3">
                  Estatísticas de Programação ({monthNames[currentCalendarDate.getMonth()]})
                </h3>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-indigo-50/40 rounded-xl p-2.5 border border-indigo-100/50">
                    <p className="text-[9px] font-black text-slate-450 uppercase tracking-wider leading-tight">Preventivas Planejadas</p>
                    <p className="text-base font-bold text-[#3525cd] mt-0.5">
                      {orders.filter(os => {
                        if (!os.scheduledDate || os.status === 'Novo') return false;
                        const d = new Date(os.scheduledDate);
                        return d.getMonth() === currentCalendarDate.getMonth() && d.getFullYear() === currentCalendarDate.getFullYear();
                      }).length}
                    </p>
                  </div>
                  <div className="bg-emerald-50/40 rounded-xl p-2.5 border border-emerald-100/40">
                    <p className="text-[9px] font-black text-emerald-600 uppercase tracking-wider leading-tight">Preventivas Concluídas</p>
                    <p className="text-base font-bold text-emerald-700 mt-0.5">
                      {orders.filter(os => {
                        if (!os.scheduledDate || os.status !== 'Concluída') return false;
                        const d = new Date(os.scheduledDate);
                        return d.getMonth() === currentCalendarDate.getMonth() && d.getFullYear() === currentCalendarDate.getFullYear();
                      }).length}
                    </p>
                  </div>
                  <div className="bg-yellow-50/40 rounded-xl p-2.5 border border-amber-100/30">
                    <p className="text-[9px] font-black text-slate-450 uppercase tracking-wider leading-tight">Aguardando Programação</p>
                    <p className="text-base font-bold text-amber-700 mt-0.5">
                      {orders.filter(os => os.status === 'Novo' && 
                        (userProfile?.perfil !== 'Administrador' || userProfile?.gerencia === 'Todas' || isSectorInGerencia(os.sector, userProfile?.gerencia))
                      ).length}
                    </p>
                  </div>
                </div>

                {/* Banner de Reversão de Não Executadas do Mês para Novo / Reagendamento (Somente dentro do prazo da criação em lote) */}
                {(() => {
                  const unexecutedThisMonth = orders.filter(os => canRevertUnexecutedOrder(os, currentCalendarDate));
                  
                  // Total de não executadas cadastradas com data agendada no mês
                  const totalUnexecutedInMonth = orders.filter(os => {
                    if (os.status !== 'Não Executada') return false;
                    if (userProfile?.perfil === 'Administrador' && userProfile.gerencia && userProfile.gerencia !== 'Todas') {
                      if (!isSectorInGerencia(os.sector, userProfile.gerencia)) return false;
                    }
                    if (!os.scheduledDate) return false;
                    const d = new Date(os.scheduledDate);
                    return !isNaN(d.getTime()) && d.getMonth() === currentCalendarDate.getMonth() && d.getFullYear() === currentCalendarDate.getFullYear();
                  });

                  const expiredCount = totalUnexecutedInMonth.length - unexecutedThisMonth.length;

                  if (unexecutedThisMonth.length === 0 && expiredCount === 0) return null;

                  return (
                    <div className="mt-3 space-y-2">
                      {unexecutedThisMonth.length > 0 && (
                        <div className="p-3 bg-amber-50/90 border border-amber-200/80 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-2.5 animate-fadeIn">
                          <div className="flex items-center gap-2 text-left min-w-0">
                            <div className="p-1.5 bg-amber-100 text-amber-700 rounded-lg shrink-0">
                              <RotateCcw className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-[10px] font-black text-amber-900 uppercase tracking-wide">
                                {unexecutedThisMonth.length} {unexecutedThisMonth.length === 1 ? 'Preventiva Não Executada' : 'Preventivas Não Executadas'} com Prazo Aberto
                              </p>
                              <p className="text-[9px] text-amber-700 font-semibold leading-tight">
                                Dentro do prazo da criação em lote ({monthNames[currentCalendarDate.getMonth()]}). Reverta para "Novo" para permitir o reagendamento.
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => onOpenBulkRevertModal('month')}
                            className="w-full sm:w-auto px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[9.5px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 shrink-0 shadow-3xs cursor-pointer transition-all active:scale-95"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            Reverter para Novo ({unexecutedThisMonth.length})
                          </button>
                        </div>
                      )}

                      {expiredCount > 0 && (
                        <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-2 text-left text-slate-500">
                          <AlertTriangle className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <p className="text-[9.5px] font-medium leading-snug">
                            <strong className="text-slate-700">{expiredCount}</strong> {expiredCount === 1 ? 'preventiva não executada está' : 'preventivas não executadas estão'} com o prazo da criação em lote expirado e permanecerão bloqueadas sem possibilidade de reagendamento.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })()}

              </div>
            </div>

            {/* COLUMN 2: Allocation & Interactive Programming Panel (Shown only when a day is selected) */}
            {selectedCalendarDay !== null && (() => {
              const padNum = (n: number) => String(n).padStart(2, '0');
              const effectiveEndDay = (selectedCalendarEndDay !== null && selectedCalendarEndDay > selectedCalendarDay)
                ? selectedCalendarEndDay
                : selectedCalendarDay;
              const isRange = effectiveEndDay > selectedCalendarDay;
              const rangeDaysCount = effectiveEndDay - selectedCalendarDay + 1;

              const selectedDateStr = `${currentCalendarDate.getFullYear()}-${padNum(currentCalendarDate.getMonth() + 1)}-${padNum(selectedCalendarDay)}`;
              const selectedEndDateStr = `${currentCalendarDate.getFullYear()}-${padNum(currentCalendarDate.getMonth() + 1)}-${padNum(effectiveEndDay)}`;

              // 1. Get already scheduled orders overlapping with this selected day or range
              const dayScheduledOrders = orders.filter(os => {
                if (userProfile?.perfil === 'Administrador' && userProfile.gerencia && userProfile.gerencia !== 'Todas') {
                  if (!isSectorInGerencia(os.sector, userProfile.gerencia)) return false;
                }
                if (!os.scheduledDate || os.status === 'Novo') return false;
                const start = os.scheduledDate.slice(0, 10);
                const end = (os.scheduledEndDate || os.scheduledDate).slice(0, 10);
                // Check if the order's window overlaps with the selected calendar range [selectedDateStr, selectedEndDateStr]
                return start <= selectedEndDateStr && end >= selectedDateStr;
              });

              // Sub-divisão das agendadas no período: Planejadas, Concluídas e Não Executadas
              // Conforme as planejadas vão sendo feitas, aumenta as concluídas e diminui as planejadas
              const dayPlannedOrders = dayScheduledOrders.filter(os => os.status !== 'Não Executada' && os.status !== 'Concluída');
              const dayCompletedOrders = dayScheduledOrders.filter(os => os.status === 'Concluída');
              const dayUnexecutedOrders = dayScheduledOrders.filter(os => os.status === 'Não Executada');
              const revertibleUnexecutedInPeriod = dayUnexecutedOrders.filter(os => canRevertUnexecutedOrder(os, currentCalendarDate));
              const expiredUnexecutedInPeriod = dayUnexecutedOrders.filter(os => !canRevertUnexecutedOrder(os, currentCalendarDate));

              // 2. Get all 'Novo' preventives awaiting scheduling, filtered by criteria
              const rawNewOrders = orders.filter(os => {
                if (os.status !== 'Novo') return false;
                // Sector restrictions for managers
                if (userProfile?.perfil === 'Administrador' && userProfile.gerencia && userProfile.gerencia !== 'Todas') {
                  return isSectorInGerencia(os.sector, userProfile.gerencia);
                }
                return true;
              });

              // Comarca options available in rawNewOrders
              const comarcaCountsMap = rawNewOrders.reduce((acc, os) => {
                const c = getOrderComarca(os) || 'Sem Comarca';
                acc[c] = (acc[c] || 0) + 1;
                return acc;
              }, {} as Record<string, number>);

              const availableComarcas = Object.keys(comarcaCountsMap).sort((a, b) => a.localeCompare(b));

              // Apply planning filters
              const filteredNewOrders = rawNewOrders.filter(os => {
                // Comarca filter
                if (planComarca !== 'all') {
                  const c = getOrderComarca(os) || 'Sem Comarca';
                  if (c !== planComarca) return false;
                }

                // Sector filter (for admins who can see all, e.g. Super Admin)
                if (planSector !== 'all' && os.sector.toLowerCase().trim() !== planSector.toLowerCase().trim()) return false;

                // Date compatibility constraint
                if (planOnlyCompatible) {
                  if (os.startDate && os.endDate) {
                    if (selectedEndDateStr < os.startDate || selectedDateStr > os.endDate) {
                      return false;
                    }
                  }
                }

                // Search term
                if (planSearch.trim()) {
                  const q = planSearch.toLowerCase().trim();
                  const matchTitle = (os.title || '').toLowerCase().includes(q);
                  const matchDesc = (os.description || '').toLowerCase().includes(q);
                  const matchAsset = (os.assetCode || '').toLowerCase().includes(q) || (os.assetName || '').toLowerCase().includes(q);
                  const matchId = os.id.toLowerCase().includes(q);
                  const matchCRAAI = getOrderCRAAI(os).toLowerCase().includes(q);
                  const matchComarca = getOrderComarca(os).toLowerCase().includes(q);
                  if (!matchTitle && !matchDesc && !matchAsset && !matchId && !matchCRAAI && !matchComarca) return false;
                }

                return true;
              });

              return (
                <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col animate-slideIn">
                  {/* Top Header of the Selection Panel */}
                  <div className="bg-slate-50 border-b border-slate-100 p-4 shrink-0 flex items-center justify-between">
                    <div>
                      <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5 mt-0.5">
                        <SlidersHorizontal className="w-4 h-4 text-indigo-600" />
                        {isRange ? (
                          <>
                            Distribuição do Período: <span className="text-[#3525cd]">{selectedCalendarDay} a {effectiveEndDay}/{currentCalendarDate.getMonth() + 1}/{currentCalendarDate.getFullYear()}</span>
                            <span className="text-[9px] font-black bg-indigo-100 text-[#3525cd] px-1.5 py-0.5 rounded ml-1">
                              {rangeDaysCount} dias
                            </span>
                          </>
                        ) : (
                          <>
                            Distribuição do Dia: <span className="text-[#3525cd]">{selectedCalendarDay}/{currentCalendarDate.getMonth() + 1}/{currentCalendarDate.getFullYear()}</span>
                          </>
                        )}
                      </h3>
                      <p className="text-[10px] text-slate-500 font-bold mt-1 uppercase tracking-wide">
                        Gerência: {userProfile?.gerencia || 'Todas'} • {isRange ? 'Período com janela de execução selecionado' : 'Data única selecionada'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCalendarDay(null);
                        setSelectedCalendarEndDay(null);
                      }}
                      className="p-1.5 hover:bg-slate-200 text-slate-500 rounded-lg transition-colors cursor-pointer"
                      title="Fechar"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Selector Tabs: Novas vs Agendadas */}
                  <div className="flex border-b border-slate-150 bg-slate-50/60 p-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setPlanActiveTab('novas')}
                      className={`flex-1 py-2 px-3 text-xs font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer flex items-center justify-center gap-2 ${
                        planActiveTab === 'novas'
                          ? 'bg-white text-[#3525cd] shadow-2xs border border-slate-200'
                          : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/60'
                      }`}
                    >
                      <PlusCircle className="w-4 h-4 text-[#3525cd]" />
                      <span>Aguardando Agendamento</span>
                      <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-indigo-50 text-[#3525cd] border border-indigo-100">
                        {filteredNewOrders.length}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPlanActiveTab('agendadas')}
                      className={`flex-1 py-2 px-3 text-xs font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer flex items-center justify-center gap-2 ${
                        planActiveTab === 'agendadas'
                          ? 'bg-white text-[#3525cd] shadow-2xs border border-slate-200'
                          : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/60'
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>Agendadas no Período</span>
                      <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-150">
                        {dayScheduledOrders.length}
                      </span>
                    </button>
                  </div>

                  {/* Panel Body */}
                  <div className="p-4 space-y-4 max-h-[640px] overflow-y-auto bg-slate-50/20">
                    
                    {/* Render TAB: Novas Preventivas / Awaiting Planning */}
                    {planActiveTab === 'novas' && (
                      <div className="space-y-4">
                        {/* 1. SELETOR DE COMARCA & BUSCA RÁPIDA */}
                        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs space-y-3">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                              <MapPin className="w-3.5 h-3.5 text-[#3525cd]" />
                              Filtrar por Comarca:
                            </label>
                            {planComarca !== 'all' && (
                              <button
                                type="button"
                                onClick={() => setPlanComarca('all')}
                                className="text-[10px] font-bold text-[#3525cd] hover:underline cursor-pointer"
                              >
                                Ver Todas
                              </button>
                            )}
                          </div>

                          {/* Seletor Dropdown de Comarcas */}
                          <div className="relative">
                            <select
                              value={planComarca}
                              onChange={(e) => setPlanComarca(e.target.value)}
                              className="w-full text-xs py-2 px-3 bg-slate-50 hover:bg-slate-100/60 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3525cd]/20 focus:border-[#3525cd] font-extrabold text-slate-850 cursor-pointer shadow-3xs"
                            >
                              <option value="all">📍 Todas as Comarcas ({rawNewOrders.length} preventivas)</option>
                              {availableComarcas.map(comarca => (
                                <option key={comarca} value={comarca}>
                                  🏛️ {comarca} ({comarcaCountsMap[comarca]} {comarcaCountsMap[comarca] === 1 ? 'preventiva' : 'preventivas'})
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Chips rápidos das comarcas com mais preventivas */}
                          {availableComarcas.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pt-1">
                              <button
                                type="button"
                                onClick={() => setPlanComarca('all')}
                                className={`text-[10px] font-bold px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                                  planComarca === 'all'
                                    ? 'bg-[#3525cd] text-white shadow-3xs font-black'
                                    : 'bg-slate-100 text-slate-650 hover:bg-slate-200/80'
                                }`}
                              >
                                Todas ({rawNewOrders.length})
                              </button>
                              {availableComarcas.slice(0, 5).map(comarca => (
                                <button
                                  key={comarca}
                                  type="button"
                                  onClick={() => setPlanComarca(comarca)}
                                  className={`text-[10px] font-bold px-2.5 py-1 rounded-md transition-all cursor-pointer flex items-center gap-1 ${
                                    planComarca === comarca
                                      ? 'bg-[#3525cd] text-white shadow-3xs font-black'
                                      : 'bg-slate-100 text-slate-650 hover:bg-slate-200/80'
                                  }`}
                                >
                                  <span>{comarca}</span>
                                  <span className={`text-[9px] px-1 rounded-full ${
                                    planComarca === comarca ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
                                  }`}>
                                    {comarcaCountsMap[comarca]}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}

                          {/* Campo de Busca Rápida (Opcional) */}
                          <div className="pt-2 border-t border-slate-100 flex items-center gap-2">
                            <div className="relative flex-1">
                              <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400" />
                              <input
                                type="text"
                                placeholder="Buscar por ID, patrimônio, CRAAI, equipamento..."
                                value={planSearch}
                                onChange={(e) => setPlanSearch(e.target.value)}
                                className="w-full text-xs pl-8 pr-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#3525cd] text-slate-800 font-medium"
                              />
                            </div>
                            {planSearch && (
                              <button
                                type="button"
                                onClick={() => setPlanSearch('')}
                                className="text-xs text-slate-400 hover:text-slate-600 p-1.5 cursor-pointer"
                                title="Limpar busca"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>

                          {/* Checkbox de Compatibilidade */}
                          <div className="flex items-center gap-2 pt-1 text-[11px] text-slate-650 font-semibold">
                            <input
                              type="checkbox"
                              id="planOnlyCompatible"
                              checked={planOnlyCompatible}
                              onChange={(e) => setPlanOnlyCompatible(e.target.checked)}
                              className="w-3.5 h-3.5 text-[#3525cd] focus:ring-[#3525cd] border-slate-300 rounded cursor-pointer"
                            />
                            <label htmlFor="planOnlyCompatible" className="cursor-pointer select-none">
                              Exibir apenas preventivas dentro do prazo para {isRange ? `este período (${selectedCalendarDay} a ${effectiveEndDay}/${currentCalendarDate.getMonth() + 1})` : `este dia (${selectedCalendarDay}/${currentCalendarDate.getMonth() + 1})`}
                            </label>
                          </div>
                        </div>

                        {/* 2. AGENDAMENTO EM BLOCO (POR COMARCA OU SELEÇÃO) */}
                        {filteredNewOrders.length > 0 && (
                          <div className="bg-gradient-to-br from-indigo-50/70 via-indigo-50/40 to-white p-3.5 rounded-xl border border-indigo-200/80 shadow-2xs space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <div className="p-1.5 bg-[#3525cd] text-white rounded-lg shadow-3xs">
                                  <Zap className="w-4 h-4" />
                                </div>
                                <div>
                                  <h4 className="text-xs font-black text-slate-850 uppercase tracking-wider">
                                    {planComarca !== 'all' 
                                      ? `Agendar Comarca: ${planComarca}` 
                                      : 'Agendamento Rápido em Lote'}
                                  </h4>
                                  <p className="text-[11px] text-slate-500 font-medium">
                                    Programar as <strong>{filteredNewOrders.length}</strong> preventivas listadas abaixo para o período selecionado:
                                  </p>
                                </div>
                              </div>
                            </div>

                            {/* Barra de ação com Técnico e Botão */}
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 bg-white p-2 rounded-lg border border-indigo-150">
                              <div className="flex-1 flex items-center gap-1.5">
                                <User className="w-4 h-4 text-slate-400 shrink-0 ml-1" />
                                <select
                                  value={bulkAssignTech}
                                  onChange={(e) => setBulkAssignTech(e.target.value)}
                                  className="w-full text-xs py-1.5 px-2 bg-transparent border-none focus:outline-none font-bold text-slate-800"
                                >
                                  <option value="">👤 Escolha o Técnico Responsável...</option>
                                  {availableProfessionals.map(u => (
                                    <option key={u.id} value={u.name}>
                                      {u.name} ({u.gerencia || 'Profissional'})
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <button
                                type="button"
                                disabled={isBulkScheduling}
                                onClick={() => setShowBulkConfirmModal(true)}
                                className={`px-4 py-2 bg-[#3525cd] hover:bg-[#281bbb] text-white font-black text-xs uppercase tracking-wider rounded-md transition-all shadow-2xs flex items-center justify-center gap-1.5 shrink-0 cursor-pointer ${
                                  isBulkScheduling ? 'opacity-70 cursor-not-allowed' : ''
                                }`}
                              >
                                {isBulkScheduling ? (
                                  <>
                                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                                    Agendando...
                                  </>
                                ) : (
                                  <>
                                    <CheckSquare className="w-4 h-4" />
                                    <span>Agendar Todas ({filteredNewOrders.length})</span>
                                  </>
                                )}
                              </button>
                            </div>

                            {/* Modal de Confirmação em Lote */}
                            {showBulkConfirmModal && (
                              <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs font-sans text-left">
                                <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xl max-w-md w-full animate-in zoom-in duration-150">
                                  <div className="flex items-center gap-3 text-[#3525cd] mb-4 pb-3 border-b border-slate-100">
                                    <div className="bg-indigo-50 p-2 rounded-full border border-indigo-100">
                                      <CheckSquare className="w-6 h-6 text-[#3525cd]" />
                                    </div>
                                    <div>
                                      <h2 className="text-xs font-black uppercase tracking-wider text-slate-850">Confirmar Agendamento</h2>
                                      <p className="text-[10px] text-[#3525cd] font-bold uppercase tracking-wide">
                                        {planComarca !== 'all' ? `Comarca: ${planComarca}` : 'Preventivas Selecionadas'}
                                      </p>
                                    </div>
                                  </div>

                                  <div className="space-y-3 mb-6 text-xs text-slate-650 font-semibold leading-relaxed">
                                    <p>
                                      Deseja agendar as <strong className="text-[#3525cd]">{filteredNewOrders.length}</strong> preventivas listadas para o seguinte período e responsável?
                                    </p>
                                    
                                    <div className="bg-indigo-50/60 p-3 rounded-xl border border-indigo-150 text-[11px] space-y-1.5">
                                      <div className="flex items-center justify-between">
                                        <span className="text-[9px] font-black text-indigo-700 uppercase tracking-wider">Período Alocado:</span>
                                        <span className="font-black text-indigo-950">
                                          {isRange 
                                            ? `${selectedCalendarDay} a ${effectiveEndDay}/${currentCalendarDate.getMonth() + 1} (${rangeDaysCount} dias)`
                                            : `Dia ${selectedCalendarDay}/${currentCalendarDate.getMonth() + 1}`}
                                        </span>
                                      </div>
                                      <div className="flex items-center justify-between">
                                        <span className="text-[9px] font-black text-indigo-700 uppercase tracking-wider">Técnico Designado:</span>
                                        <span className="font-black text-indigo-950">
                                          {bulkAssignTech ? `👤 ${bulkAssignTech}` : 'Automático / Individual'}
                                        </span>
                                      </div>
                                      {planComarca !== 'all' && (
                                        <div className="flex items-center justify-between">
                                          <span className="text-[9px] font-black text-indigo-700 uppercase tracking-wider">Comarca:</span>
                                          <span className="font-black text-indigo-950">📍 {planComarca}</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-3">
                                    <button
                                      type="button"
                                      disabled={isBulkScheduling}
                                      onClick={async () => {
                                        setIsBulkScheduling(true);
                                        try {
                                          for (const os of filteredNewOrders) {
                                            const matchedTechs = getAvailableProfessionalsForOS(os);
                                            const defaultTech = bulkAssignTech || planAssignedTechs[os.id] || matchedTechs[0]?.name || users.find(u => u.perfil === 'Profissional')?.name || 'Daniel Torres';
                                            
                                            const updatedOS = {
                                              ...os,
                                              status: 'Planejada' as const,
                                              scheduledDate: selectedDateStr,
                                              scheduledEndDate: effectiveEndDay > selectedCalendarDay ? selectedEndDateStr : undefined,
                                              assignedTechnician: defaultTech,
                                              updatedAt: new Date().toISOString()
                                            };
                                            await dbSaveServiceOrder(updatedOS);
                                          }
                                          setShowBulkConfirmModal(false);
                                          onReload();
                                        } catch (error) {
                                          alert(`Erro ao agendar em lote: ${error}`);
                                        } finally {
                                          setIsBulkScheduling(false);
                                        }
                                      }}
                                      className="flex-1 py-2.5 px-4 bg-[#3525cd] hover:bg-[#281bbb] text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-md cursor-pointer flex items-center justify-center gap-2"
                                    >
                                      {isBulkScheduling ? 'Agendando...' : 'Confirmar e Agendar'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setShowBulkConfirmModal(false)}
                                      className="py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer"
                                    >
                                      Cancelar
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* 3. LISTA INDIVIDUAL DE PREVENTIVAS */}
                        {filteredNewOrders.length === 0 ? (
                          <div className="text-center py-10 bg-white border border-slate-200 rounded-xl">
                            <AlertTriangle className="w-7 h-7 text-amber-500 mx-auto mb-2" />
                            <p className="text-xs font-bold text-slate-700">Nenhuma preventiva encontrada para este filtro</p>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              {planComarca !== 'all' 
                                ? `Não há preventivas pendentes em ${planComarca} ou dentro do prazo do período.`
                                : 'Tente flexibilizar a busca ou o filtro de data.'}
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 px-1">
                              <span>Ou agende individualmente cada preventiva:</span>
                              <span className="text-slate-700 font-black">{filteredNewOrders.length} {filteredNewOrders.length === 1 ? 'disponível' : 'disponíveis'}</span>
                            </div>

                            {filteredNewOrders.map((os) => {
                              // Verify compatibility with selected date
                              let isCompatible = true;
                              if (os.startDate && os.endDate) {
                                isCompatible = (selectedDateStr >= os.startDate && selectedDateStr <= os.endDate);
                              }
                              
                              const assignedTechName = planAssignedTechs[os.id] || '';
                              const osComarca = getOrderComarca(os) || 'Sem comarca definida';
                              const osCRAAI = getOrderCRAAI(os) || 'CRAAI';

                              return (
                                <div 
                                  key={os.id} 
                                  className={`border transition-all rounded-xl p-3.5 bg-white shadow-2xs space-y-2.5 ${
                                    isCompatible 
                                      ? 'border-slate-200 hover:border-slate-300 hover:shadow-xs' 
                                      : 'border-slate-200 bg-slate-50/40 opacity-70'
                                  }`}
                                >
                                  {/* Header do Card com Comarca em Destaque */}
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5 truncate">
                                      <span className="text-[9.5px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-indigo-50 text-[#3525cd] border border-indigo-150 truncate">
                                        📍 {osComarca}
                                      </span>
                                      <span className="text-[9px] font-bold text-slate-500 uppercase truncate">
                                        {osCRAAI}
                                      </span>
                                    </div>
                                    <span className="font-mono text-[10px] font-black text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded shrink-0">
                                      #{formatOrderNumber(os.id)}
                                    </span>
                                  </div>

                                  {/* Equipamento / Título */}
                                  <div>
                                    <h4 className="text-xs font-bold text-slate-850 leading-snug">
                                      {os.title}
                                    </h4>
                                    {os.assetCode && (
                                      <p className="text-[10px] font-semibold text-slate-500 mt-0.5">
                                        Patrimônio: <strong className="text-slate-700">{os.assetCode}</strong> {os.assetName ? `• ${os.assetName}` : ''}
                                      </p>
                                    )}
                                  </div>

                                  {/* SLA e Prazos */}
                                  <div className="flex items-center justify-between text-[9.5px] bg-slate-50 p-2 rounded-lg border border-slate-150">
                                    <span className="text-slate-500 font-bold">
                                      Prazo SLA: <strong className="text-slate-800">{os.startDate ? formatDateBR(os.startDate) : 'S/I'}</strong> a <strong className="text-slate-800">{os.endDate ? formatDateBR(os.endDate) : 'S/I'}</strong>
                                    </span>
                                    {isCompatible ? (
                                      <span className="text-emerald-700 font-black flex items-center gap-0.5">
                                        <Check className="w-3 h-3" /> No prazo
                                      </span>
                                    ) : (
                                      <span className="text-rose-600 font-black flex items-center gap-0.5">
                                        <AlertTriangle className="w-3 h-3" /> Fora do prazo
                                      </span>
                                    )}
                                  </div>

                                  {/* Atribuição de Técnico & Botão de Agendamento Individual */}
                                  <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                                    <select
                                      value={assignedTechName}
                                      onChange={(e) => {
                                        setPlanAssignedTechs(prev => ({ ...prev, [os.id]: e.target.value }));
                                      }}
                                      className="flex-1 text-xs py-1.5 px-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#3525cd] font-bold text-slate-800"
                                    >
                                      <option value="">👤 Atribuir Técnico...</option>
                                      {getAvailableProfessionalsForOS(os).map((t) => (
                                        <option key={t.id} value={t.name}>
                                          {t.name} ({t.cargo || 'Profissional'})
                                        </option>
                                      ))}
                                    </select>

                                    <button
                                      type="button"
                                      disabled={!isCompatible}
                                      onClick={async () => {
                                        if (!isCompatible) return;
                                        const proceed = checkTechAssignment(assignedTechName, selectedDateStr, os);
                                        if (!proceed) return;

                                        const updatedOS = { 
                                          ...os, 
                                          status: 'Planejada' as const,
                                          scheduledDate: selectedDateStr,
                                          scheduledEndDate: effectiveEndDay > selectedCalendarDay ? selectedEndDateStr : undefined,
                                          assignedTechnician: assignedTechName,
                                          updatedAt: new Date().toISOString()
                                        };

                                        try {
                                          await dbSaveServiceOrder(updatedOS);
                                          onReload();
                                        } catch (error) {
                                          alert(`Erro ao salvar Ordem de Serviço: ${error}`);
                                        }
                                      }}
                                      className={`px-3 py-1.5 text-xs font-black uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-3xs shrink-0 ${
                                        isCompatible 
                                          ? 'bg-[#3525cd] hover:bg-[#281bbb] text-white' 
                                          : 'bg-slate-100 border border-slate-200 text-slate-400 cursor-not-allowed'
                                      }`}
                                    >
                                      <Calendar className="w-3.5 h-3.5" />
                                      <span>Agendar</span>
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Render TAB: Already programadas / Scheduled for this Day */}
                    {planActiveTab === 'agendadas' && (
                      <div className="space-y-4">
                        {/* Sub-Tabs: Planejadas, Concluídas e Não Executadas */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2 border-b border-slate-200">
                          <div className="flex items-center gap-1.5 p-1 bg-slate-100/90 rounded-xl border border-slate-200 w-full sm:w-auto overflow-x-auto">
                            {/* 1. Planejadas */}
                            <button
                              type="button"
                              onClick={() => setScheduledSubTab('planejadas')}
                              className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer transition-all duration-150 whitespace-nowrap ${
                                scheduledSubTab === 'planejadas'
                                  ? 'bg-[#3525cd] text-white shadow-3xs'
                                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                              }`}
                            >
                              <Clock className="w-3.5 h-3.5" />
                              Planejadas
                              <span className={`px-1.5 py-0.2 rounded-full text-[9px] font-black ${
                                scheduledSubTab === 'planejadas' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
                              }`}>
                                {dayPlannedOrders.length}
                              </span>
                            </button>

                            {/* 2. Concluídas */}
                            <button
                              type="button"
                              onClick={() => setScheduledSubTab('concluidas')}
                              className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer transition-all duration-150 whitespace-nowrap ${
                                scheduledSubTab === 'concluidas'
                                  ? 'bg-emerald-600 text-white shadow-3xs'
                                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                              }`}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Concluídas
                              <span className={`px-1.5 py-0.2 rounded-full text-[9px] font-black ${
                                scheduledSubTab === 'concluidas' ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-800'
                              }`}>
                                {dayCompletedOrders.length}
                              </span>
                            </button>

                            {/* 3. Não Executadas */}
                            <button
                              type="button"
                              onClick={() => setScheduledSubTab('nao_executadas')}
                              className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer transition-all duration-150 whitespace-nowrap ${
                                scheduledSubTab === 'nao_executadas'
                                  ? 'bg-rose-600 text-white shadow-3xs'
                                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                              }`}
                            >
                              <AlertTriangle className="w-3.5 h-3.5" />
                              Não Executadas
                              <span className={`px-1.5 py-0.2 rounded-full text-[9px] font-black ${
                                scheduledSubTab === 'nao_executadas' ? 'bg-white/20 text-white' : 'bg-rose-100 text-rose-700'
                              }`}>
                                {dayUnexecutedOrders.length}
                              </span>
                            </button>
                          </div>

                          {/* Seletor rápido de revertíveis do mês / botão complementar se houver não executadas no mês */}
                          {(() => {
                            const unexecutedInMonth = orders.filter(os => canRevertUnexecutedOrder(os, currentCalendarDate));
                            if (unexecutedInMonth.length === 0) return null;
                            return (
                              <button
                                type="button"
                                onClick={() => {
                                  onOpenBulkRevertModal('month');
                                }}
                                className="text-[9.5px] font-black text-amber-700 hover:text-amber-800 uppercase tracking-wider flex items-center justify-center sm:justify-end gap-1 cursor-pointer transition-colors py-1 px-2 rounded-lg hover:bg-amber-50"
                                title="Reverter todas as não executadas do mês dentro do SLA"
                              >
                                <RotateCcw className="w-3 h-3" />
                                Mês: {unexecutedInMonth.length} não executadas elegíveis
                              </button>
                            );
                          })()}
                        </div>

                        {/* SUB-VIEW 1: Planejadas */}
                        {scheduledSubTab === 'planejadas' && (
                          <div className="space-y-3">
                            <div className="bg-indigo-50 text-indigo-900 p-2.5 rounded-xl border border-indigo-150 text-[10px] font-bold uppercase tracking-wide leading-relaxed flex items-center justify-between">
                              <span>Preventivas planejadas alocadas para {selectedCalendarDay ? `o dia ${selectedCalendarDay}${selectedCalendarEndDay && selectedCalendarEndDay !== selectedCalendarDay ? ` a ${selectedCalendarEndDay}` : ''}/${currentCalendarDate.getMonth() + 1}` : 'o período'}.</span>
                              <span className="font-mono font-black text-indigo-700">{dayPlannedOrders.length} aguardando execução</span>
                            </div>

                            {dayPlannedOrders.length === 0 ? (
                              <div className="text-center py-12 text-slate-400 text-xs italic bg-white border border-dashed border-slate-200 rounded-xl font-medium">
                                Nenhuma preventiva planejada pendente para este dia/período. Conforme as ordens forem sendo concluídas, elas passam para a aba de Concluídas.
                              </div>
                            ) : (
                              <div className="space-y-3">
                                {dayPlannedOrders.map((os) => {
                                  const isCompleted = os.status === 'Concluída';
                                  return (
                                    <div key={os.id} className="border border-slate-200 rounded-xl p-4 bg-white shadow-2xs space-y-3">
                                      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                        <div className="flex items-center gap-2">
                                          <span className="font-mono text-xs font-black text-[#3525cd]">#{formatOrderNumber(os.id)}</span>
                                          <span className="bg-slate-100 text-slate-705 text-[8.5px] font-black uppercase px-2 py-0.5 rounded">
                                            {os.sector}
                                          </span>
                                        </div>
                                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide ${
                                          isCompleted 
                                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                                            : 'bg-[#3525cd]/5 text-[#3525cd] border border-[#3525cd]/15'
                                        }`}>
                                          {os.status}
                                        </span>
                                      </div>

                                      <div>
                                        <h4 className="text-xs font-black text-slate-800">{os.title}</h4>
                                        <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{os.description}</p>
                                      </div>

                                      {/* CRAAI / COMARCA Metadata */}
                                      <div className="grid grid-cols-2 gap-2 bg-slate-55 bg-indigo-50/15 p-2 rounded-lg border border-indigo-100/50 text-[10px]">
                                        <div>
                                          <span className="text-slate-450 font-black uppercase text-[8px] tracking-wider block">CRAAI</span>
                                          <span className="text-slate-800 font-bold uppercase tracking-wide text-[9.5px]" title={getOrderCRAAI(os)}>
                                            {getOrderCRAAI(os)}
                                          </span>
                                        </div>
                                        <div>
                                          <span className="text-slate-450 font-black uppercase text-[8px] tracking-wider block">Comarca</span>
                                          <span className="text-slate-800 font-bold uppercase tracking-wide text-[9.5px] truncate block" title={getOrderComarca(os)}>
                                            {getOrderComarca(os)}
                                          </span>
                                        </div>
                                      </div>

                                      {/* Scheduled Date limits information */}
                                      <div className="text-[9.5px] font-black text-slate-500 uppercase tracking-wider flex flex-wrap items-center justify-between gap-1 bg-slate-50 p-2 rounded">
                                        <span>
                                          {os.scheduledEndDate ? (
                                            <>Período: <span className="text-[#3525cd] font-black">{formatDateBR(os.scheduledDate)} até {formatDateBR(os.scheduledEndDate)}</span></>
                                          ) : (
                                            <>Data Alocada: <span className="text-[#3525cd] font-black">{formatDateBR(os.scheduledDate)}</span></>
                                          )}
                                        </span>
                                        {os.startDate && os.endDate && (
                                          <span>
                                            SLA: {formatDateBR(os.startDate)} a {formatDateBR(os.endDate)}
                                          </span>
                                        )}
                                      </div>

                                      {/* Technician Reassignment */}
                                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 p-2.5 rounded-lg border border-slate-200/60 mt-2">
                                        <div className="flex items-center gap-2">
                                          <User className="w-3.5 h-3.5 text-[#3525cd]" />
                                          <span className="text-[10px] font-black text-slate-650 uppercase tracking-wider">Técnico Designado:</span>
                                        </div>
                                        
                                        <select
                                          value={os.assignedTechnician || ''}
                                          onChange={async (e) => {
                                            const newTech = e.target.value;
                                            if (newTech) {
                                              const proceed = checkTechAssignment(newTech, os.scheduledDate || '', os);
                                              if (!proceed) return;
                                            }
                                            const updatedOS = { ...os, assignedTechnician: newTech, updatedAt: new Date().toISOString() };
                                            await dbSaveServiceOrder(updatedOS);
                                            onReload();
                                          }}
                                          className="text-xs py-1 px-2.5 bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 font-bold text-slate-800 min-w-[200px] cursor-pointer"
                                        >
                                          <option value="">Sem Técnico Responsável</option>
                                          {getAvailableProfessionalsForOS(os).map((t) => (
                                            <option key={t.id} value={t.name}>
                                              {t.name} ({t.cargo || 'Profissional'})
                                            </option>
                                          ))}
                                        </select>
                                      </div>

                                      {/* Remake Scheduling Option (Returns OS to status === 'Novo' so it can be scheduled elsewhere) */}
                                      <div>
                                        {deplanConfirmOrderId === os.id ? (
                                          <div className="flex flex-col gap-2 p-2 bg-rose-50 rounded-lg border border-rose-100 animate-fadeIn">
                                            <p className="text-[10px] font-bold text-rose-700 uppercase tracking-wide text-center">
                                              Tem certeza que deseja remover da agenda?
                                            </p>
                                            <div className="flex items-center gap-2">
                                              <button
                                                type="button"
                                                onClick={async () => {
                                                  const updatedOS = {
                                                    ...os,
                                                    status: 'Novo' as const,
                                                    scheduledDate: '',
                                                    assignedTechnician: '',
                                                    updatedAt: new Date().toISOString()
                                                  };
                                                  await dbSaveServiceOrder(updatedOS);
                                                  setDeplanConfirmOrderId(null);
                                                  onReload();
                                                }}
                                                className="flex-1 py-1.5 text-center bg-rose-600 hover:bg-rose-700 text-white rounded-md text-[9px] font-black uppercase tracking-widest cursor-pointer transition-colors shadow-2xs"
                                              >
                                                Sim, Reverter
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => setDeplanConfirmOrderId(null)}
                                                className="flex-1 py-1.5 text-center bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-md text-[9px] font-black uppercase tracking-widest cursor-pointer transition-colors"
                                              >
                                                Cancelar
                                              </button>
                                            </div>
                                          </div>
                                        ) : (
                                          <button
                                            type="button"
                                            onClick={() => setDeplanConfirmOrderId(os.id)}
                                            className="w-full py-1.5 text-center border border-dashed border-rose-225 hover:bg-[#fff5f5] text-rose-600 rounded-lg text-[9px] font-black uppercase transition-colors tracking-widest cursor-pointer flex items-center justify-center gap-1"
                                          >
                                            <X className="w-3 h-3 text-rose-500" />
                                            Remover da Agenda (Reverter para Novo)
                                          </button>
                                        )}
                                      </div>

                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}

                        {/* SUB-VIEW 2: Concluídas */}
                        {scheduledSubTab === 'concluidas' && (
                          <div className="space-y-3">
                            <div className="bg-emerald-50 text-emerald-900 p-2.5 rounded-xl border border-emerald-200 text-[10px] font-bold uppercase tracking-wide leading-relaxed flex items-center justify-between">
                              <span className="flex items-center gap-1.5">
                                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                                Preventivas finalizadas e executadas com sucesso no período.
                              </span>
                              <span className="font-mono font-black text-emerald-700">{dayCompletedOrders.length} concluída{dayCompletedOrders.length > 1 ? 's' : ''}</span>
                            </div>

                            {dayCompletedOrders.length === 0 ? (
                              <div className="text-center py-12 text-slate-400 text-xs italic bg-white border border-dashed border-slate-200 rounded-xl font-medium">
                                Nenhuma preventiva com status "Concluída" neste período selecionado. Conforme os técnicos forem executando as ordens planejadas, elas passarão para esta aba.
                              </div>
                            ) : (
                              <div className="space-y-3">
                                {dayCompletedOrders.map((os) => {
                                  const completedChecklistCount = (os.checklist || []).filter(item => item.checked).length;
                                  const totalChecklistCount = (os.checklist || []).length;
                                  const hasPhoto = !!os.photoEvidence;

                                  return (
                                    <div key={os.id} className="border border-emerald-200/80 rounded-xl p-4 bg-white shadow-2xs space-y-3">
                                      <div className="flex items-center justify-between border-b border-emerald-100 pb-2">
                                        <div className="flex items-center gap-2">
                                          <span className="font-mono text-xs font-black text-emerald-700">#{formatOrderNumber(os.id)}</span>
                                          <span className="bg-slate-100 text-slate-705 text-[8.5px] font-black uppercase px-2 py-0.5 rounded">
                                            {os.sector}
                                          </span>
                                        </div>
                                        <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                                          <Check className="w-3 h-3 text-emerald-600" />
                                          Concluída
                                        </span>
                                      </div>

                                      <div>
                                        <h4 className="text-xs font-black text-slate-800">{os.title}</h4>
                                        <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{os.description}</p>
                                      </div>

                                      {/* CRAAI / COMARCA Metadata */}
                                      <div className="grid grid-cols-2 gap-2 bg-slate-55 bg-indigo-50/15 p-2 rounded-lg border border-indigo-100/50 text-[10px]">
                                        <div>
                                          <span className="text-slate-450 font-black uppercase text-[8px] tracking-wider block">CRAAI</span>
                                          <span className="text-slate-800 font-bold uppercase tracking-wide text-[9.5px]" title={getOrderCRAAI(os)}>
                                            {getOrderCRAAI(os)}
                                          </span>
                                        </div>
                                        <div>
                                          <span className="text-slate-450 font-black uppercase text-[8px] tracking-wider block">Comarca</span>
                                          <span className="text-slate-800 font-bold uppercase tracking-wide text-[9.5px] truncate block" title={getOrderComarca(os)}>
                                            {getOrderComarca(os)}
                                          </span>
                                        </div>
                                      </div>

                                      {/* Data de Execução e SLA */}
                                      <div className="text-[9.5px] font-black text-slate-500 uppercase tracking-wider flex flex-wrap items-center justify-between gap-1 bg-emerald-50/40 p-2 rounded border border-emerald-100/60">
                                        <span>
                                          Data Executada: <span className="text-emerald-700 font-black">{formatDateBR(os.signedAt ? os.signedAt.slice(0, 10) : (os.updatedAt ? os.updatedAt.slice(0, 10) : os.scheduledDate))}</span>
                                        </span>
                                        {os.startDate && os.endDate && (
                                          <span>
                                            SLA: {formatDateBR(os.startDate)} a {formatDateBR(os.endDate)}
                                          </span>
                                        )}
                                      </div>

                                      {/* Indicadores de Execução: Checklist e Fotos */}
                                      {(totalChecklistCount > 0 || hasPhoto) && (
                                        <div className="flex flex-wrap items-center gap-2 text-[9.5px] font-bold">
                                          {totalChecklistCount > 0 && (
                                            <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md flex items-center gap-1 border border-slate-200">
                                              <CheckSquare className="w-3 h-3 text-emerald-600" />
                                              Checklist: {completedChecklistCount}/{totalChecklistCount} itens
                                            </span>
                                          )}
                                          {hasPhoto && (
                                            <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md flex items-center gap-1 border border-slate-200">
                                              <Camera className="w-3 h-3 text-indigo-600" />
                                              Com Foto Evidência
                                            </span>
                                          )}
                                        </div>
                                      )}

                                      {/* Técnico Responsável e Assinatura */}
                                      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200/60">
                                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-600">
                                          <User className="w-3.5 h-3.5 text-emerald-600" />
                                          <span>Técnico Executor: <strong className="text-slate-800">{os.assignedTechnician || 'Não especificado'}</strong></span>
                                        </div>
                                        {os.signature ? (
                                          <span className="text-[9px] font-black uppercase text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-full flex items-center gap-1 border border-emerald-200">
                                            <FileSignature className="w-3 h-3 text-emerald-700" />
                                            Assinada
                                          </span>
                                        ) : (
                                          <span className="text-[9px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                                            Sem Assinatura
                                          </span>
                                        )}
                                      </div>

                                      {/* Ação: Ver Detalhes */}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          onViewOrder(os);
                                        }}
                                        className="w-full py-2 text-center bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-lg text-[9.5px] font-black uppercase transition-colors tracking-wider cursor-pointer flex items-center justify-center gap-1.5"
                                      >
                                        <Eye className="w-3.5 h-3.5 text-emerald-700" />
                                        Ver Detalhes da Execução e Laudo
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}

                        {/* SUB-VIEW 3: Não Executadas (com botão Reverter Todas para Novo) */}
                        {scheduledSubTab === 'nao_executadas' && (
                          <div className="space-y-3">
                            {/* Barra de Ação de Reversão em Massa das Não Executadas */}
                            {dayUnexecutedOrders.length > 0 && (
                              <div className="bg-amber-50 p-3.5 rounded-xl border border-amber-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-2xs">
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                                    <span className="text-xs font-black text-amber-950 uppercase tracking-tight">
                                      {dayUnexecutedOrders.length} preventiva{dayUnexecutedOrders.length > 1 ? 's' : ''} não executada{dayUnexecutedOrders.length > 1 ? 's' : ''} neste período
                                    </span>
                                  </div>
                                  <p className="text-[10.5px] text-amber-800 font-medium">
                                    {revertibleUnexecutedInPeriod.length > 0 ? (
                                      <span>
                                        <strong className="font-black text-emerald-800">{revertibleUnexecutedInPeriod.length}</strong> apta{revertibleUnexecutedInPeriod.length > 1 ? 's' : ''} para reversão (dentro do prazo da criação em lote).
                                        {expiredUnexecutedInPeriod.length > 0 && (
                                          <span className="text-rose-700 font-bold ml-1">
                                            ({expiredUnexecutedInPeriod.length} com prazo da criação em lote expirado).
                                          </span>
                                        )}
                                      </span>
                                    ) : (
                                      <span className="text-rose-700 font-bold">
                                        Prazo da criação em lote expirado. Não é mais permitido alterar ou reagendar estas preventivas.
                                      </span>
                                    )}
                                  </p>
                                </div>

                                {revertibleUnexecutedInPeriod.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onOpenBulkRevertModal('period');
                                    }}
                                    className="w-full md:w-auto px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer transition-all active:scale-95 shadow-sm shrink-0 border border-amber-700"
                                  >
                                    <RotateCcw className="w-3.5 h-3.5" />
                                    Reverter todas as não executadas para Nova ({revertibleUnexecutedInPeriod.length})
                                  </button>
                                )}
                              </div>
                            )}

                            {dayUnexecutedOrders.length === 0 ? (
                              <div className="text-center py-12 text-slate-400 text-xs italic bg-white border border-dashed border-slate-200 rounded-xl font-medium">
                                Nenhuma preventiva com status "Não Executada" neste período selecionado.
                              </div>
                            ) : (
                              <div className="space-y-3">
                                {dayUnexecutedOrders.map((os) => {
                                  const canRevertThis = canRevertUnexecutedOrder(os, currentCalendarDate);
                                  return (
                                    <div key={os.id} className="border border-rose-200/80 rounded-xl p-4 bg-white shadow-2xs space-y-3">
                                      <div className="flex items-center justify-between border-b border-rose-100 pb-2">
                                        <div className="flex items-center gap-2">
                                          <span className="font-mono text-xs font-black text-rose-700">#{formatOrderNumber(os.id)}</span>
                                          <span className="bg-slate-100 text-slate-705 text-[8.5px] font-black uppercase px-2 py-0.5 rounded">
                                            {os.sector}
                                          </span>
                                        </div>
                                        <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide bg-rose-50 text-rose-700 border border-rose-200">
                                          Não Executada
                                        </span>
                                      </div>

                                      <div>
                                        <h4 className="text-xs font-black text-slate-800">{os.title}</h4>
                                        <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{os.description}</p>
                                      </div>

                                      {/* CRAAI / COMARCA Metadata */}
                                      <div className="grid grid-cols-2 gap-2 bg-slate-55 bg-indigo-50/15 p-2 rounded-lg border border-indigo-100/50 text-[10px]">
                                        <div>
                                          <span className="text-slate-450 font-black uppercase text-[8px] tracking-wider block">CRAAI</span>
                                          <span className="text-slate-800 font-bold uppercase tracking-wide text-[9.5px]" title={getOrderCRAAI(os)}>
                                            {getOrderCRAAI(os)}
                                          </span>
                                        </div>
                                        <div>
                                          <span className="text-slate-450 font-black uppercase text-[8px] tracking-wider block">Comarca</span>
                                          <span className="text-slate-800 font-bold uppercase tracking-wide text-[9.5px] truncate block" title={getOrderComarca(os)}>
                                            {getOrderComarca(os)}
                                          </span>
                                        </div>
                                      </div>

                                      {/* Data Original e SLA */}
                                      <div className="text-[9.5px] font-black text-slate-500 uppercase tracking-wider flex flex-wrap items-center justify-between gap-1 bg-rose-50/40 p-2 rounded border border-rose-100/60">
                                        <span>
                                          {os.scheduledEndDate ? (
                                            <>Data Não Executada: <span className="text-rose-700 font-black">{formatDateBR(os.scheduledDate)} até {formatDateBR(os.scheduledEndDate)}</span></>
                                          ) : (
                                            <>Data Não Executada: <span className="text-rose-700 font-black">{formatDateBR(os.scheduledDate)}</span></>
                                          )}
                                        </span>
                                        {os.startDate && os.endDate && (
                                          <span>
                                            SLA da OS: {formatDateBR(os.startDate)} a {formatDateBR(os.endDate)}
                                          </span>
                                        )}
                                      </div>

                                      {/* Técnico que estava responsável */}
                                      {os.assignedTechnician && (
                                        <div className="text-[10px] font-bold text-slate-600 flex items-center gap-1.5 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200/50">
                                          <User className="w-3.5 h-3.5 text-slate-500" />
                                          <span>Técnico alocado na época: <strong className="text-slate-800">{os.assignedTechnician}</strong></span>
                                        </div>
                                      )}

                                      {/* Botão Individual de Reversão para Novo */}
                                      <div>
                                        {canRevertThis ? (
                                          deplanConfirmOrderId === os.id ? (
                                            <div className="flex flex-col gap-2 p-2 bg-amber-50 rounded-lg border border-amber-200 animate-fadeIn">
                                              <p className="text-[10px] font-bold text-amber-900 uppercase tracking-wide text-center">
                                                Reverter esta preventiva não executada para "Novo" para reprogramar?
                                              </p>
                                              <div className="flex items-center gap-2">
                                                <button
                                                  type="button"
                                                  onClick={async () => {
                                                    const updatedOS: ServiceOrder = {
                                                      ...os,
                                                      status: 'Novo',
                                                      scheduledDate: '',
                                                      scheduledEndDate: undefined,
                                                      assignedTechnician: '',
                                                      updatedAt: new Date().toISOString()
                                                    };
                                                    await dbSaveServiceOrder(updatedOS);
                                                    setDeplanConfirmOrderId(null);
                                                    onReload();
                                                  }}
                                                  className="flex-1 py-1.5 text-center bg-amber-600 hover:bg-amber-700 text-white rounded-md text-[9px] font-black uppercase tracking-widest cursor-pointer transition-colors shadow-2xs"
                                                >
                                                  Sim, Reverter para Novo
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => setDeplanConfirmOrderId(null)}
                                                  className="flex-1 py-1.5 text-center bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-md text-[9px] font-black uppercase tracking-widest cursor-pointer transition-colors"
                                                >
                                                  Cancelar
                                                </button>
                                              </div>
                                            </div>
                                          ) : (
                                            <button
                                              type="button"
                                              onClick={() => setDeplanConfirmOrderId(os.id)}
                                              className="w-full py-2 text-center bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded-lg text-[9.5px] font-black uppercase transition-colors tracking-wider cursor-pointer flex items-center justify-center gap-1.5"
                                            >
                                              <RotateCcw className="w-3.5 h-3.5 text-amber-700" />
                                              Reverter para Novo (Reprogramar Data & Técnico)
                                            </button>
                                          )
                                        ) : (
                                          <div className="text-center py-2 px-3 bg-slate-100 text-slate-500 rounded-lg text-[9.5px] font-bold uppercase tracking-wider border border-slate-200">
                                            Bloqueado: Prazo da criação em lote expirou para esta preventiva
                                          </div>
                                        )}
                                      </div>

                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      );
}
