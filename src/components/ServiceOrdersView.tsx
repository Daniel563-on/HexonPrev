import React, { useState, useEffect, useMemo } from 'react';
import { 
  ClipboardList, 
  Wrench, 
  Search, 
  Calendar, 
  Clock, 
  AlertTriangle, 
  Check,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { ServiceOrder, Asset, ChecklistItem, formatDateBR, HexonUser, isSectorInGerencia, getSectorGerencia } from '../types';
import { localMonthKey, dbSaveServiceOrder, dbGetAssets, dbGetTemplates, dbDeleteServiceOrder, dbGetUsers, dbGetPlanningDeadlines, dbSavePlanningDeadline, PlanningDeadline } from '../db/firebase';
import OrderDetailsDrawer from './orders/OrderDetailsDrawer';
import OrdersFilterBar from './orders/OrdersFilterBar';
import OrdersCardGrid from './orders/OrdersCardGrid';
import DeleteOrderModal from './orders/DeleteOrderModal';
import BulkRevertModal from './orders/BulkRevertModal';
import PreventiveScanModal from './orders/PreventiveScanModal';
import OrdersCalendarPlanning from './orders/OrdersCalendarPlanning';

interface ServiceOrdersViewProps {
  orders: ServiceOrder[];
  onReload: () => void;
  onViewedMonthChange?: (month: string) => void; // mês (AAAA-MM) cujas OS fechadas devem ser carregadas
  highlightOSId?: string | null;
  userProfile?: HexonUser | null;
  userHasActionPermission?: (actionId: string) => boolean;
}

export default function ServiceOrdersView({ 
  orders, 
  onReload, 
  onViewedMonthChange,
  highlightOSId,
  userProfile,
  userHasActionPermission
}: ServiceOrdersViewProps) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [deadlines, setDeadlines] = useState<PlanningDeadline[]>([]);
  const [customDates, setCustomDates] = useState<Record<string, string>>({});
  const [hasDismissedTemp, setHasDismissedTemp] = useState(false);
  const [showDeadlineWarnPopup, setShowDeadlineWarnPopup] = useState(false);
  const [warnPopupManagement, setWarnPopupManagement] = useState<string>('');
  const [warnPopupTimeText, setWarnPopupTimeText] = useState<string>('');

  function getCountdownText(expiresAt: string): { text: string; hoursLeft: number; isExpired: boolean } {
    if (!expiresAt || expiresAt === 'none' || expiresAt === '') {
      return { text: 'Sem prazo definido', hoursLeft: 9999, isExpired: false };
    }
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) {
      return { text: 'Prazo Expirado (Acesso Bloqueado)', hoursLeft: 0, isExpired: true };
    }
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    let textStr = '';
    if (days > 0) textStr += `${days} ${days === 1 ? 'dia' : 'dias'} `;
    textStr += `${hours}h ${minutes}m`;
    return { text: textStr, hoursLeft: diff / (1000 * 60 * 60), isExpired: false };
  }

  const loadDeadlines = () => {
    dbGetPlanningDeadlines().then((list) => {
      setDeadlines([...list]);
    });
  };

  useEffect(() => {
    loadDeadlines();
  }, [orders]);

  // Handle countdown updates & alerts
  useEffect(() => {
    if (userProfile?.perfil === 'Administrador' && userProfile.gerencia && userProfile.gerencia !== 'Todas') {
      const runCheck = () => {
        dbGetPlanningDeadlines().then((list) => {
          setDeadlines([...list]);
          const deadline = list.find(d => d.id === userProfile.gerencia);
          if (deadline && deadline.expiresAt) {
            const { isExpired, hoursLeft, text } = getCountdownText(deadline.expiresAt);
            if (!isExpired && hoursLeft <= 24) {
              if (!hasDismissedTemp) {
                setWarnPopupManagement(userProfile.gerencia);
                setWarnPopupTimeText(text);
                setShowDeadlineWarnPopup(true);
              }
            } else {
              // If deadline is reset to >24h, we can allow showing again next time it hits limit
              setHasDismissedTemp(false);
              setShowDeadlineWarnPopup(false);
            }
          } else {
            // No custom deadline is defined, hide any warning alerts
            setShowDeadlineWarnPopup(false);
            setHasDismissedTemp(false);
          }
        });
      };
      
      runCheck();
      const interval = setInterval(runCheck, 10000); // Check every 10 seconds
      return () => clearInterval(interval);
    }
  }, [userProfile, hasDismissedTemp]);

  // Regra estrita: Só pode reverter para Novo / alterar Não Executada se:
  // 1. O status for "Não Executada"
  // 2. Pertencer à gerência permitida para o usuário (se Administrador com gerência específica)
  // 3. Respeitar o prazo da criação em lote (ex: startDate 01/09/2026 até endDate 30/09/2026):
  //    - Se foi criado de 01/09/2026 até 30/09/2026, pode fazer a alteração das não executadas enquanto estiver dentro desse prazo da criação em lote!
  const canRevertUnexecutedOrder = (os: ServiceOrder, targetMonthDate: Date = currentCalendarDate): boolean => {
    if (os.status !== 'Não Executada') return false;

    // Gerência permitida para o usuário logado
    if (userProfile?.perfil === 'Administrador' && userProfile.gerencia && userProfile.gerencia !== 'Todas') {
      if (!isSectorInGerencia(os.sector, userProfile.gerencia)) return false;
    }

    // Prazo da criação em lote (startDate até endDate, ex: 01/09/2026 até 30/09/2026)
    let batchStart = os.startDate;
    let batchEnd = os.endDate;

    // Fallback se não tiver startDate/endDate explícitos: deduz o mês a partir da data agendada ou do mês trabalhado
    if (!batchStart || !batchEnd) {
      const baseDate = os.scheduledDate ? new Date(os.scheduledDate) : targetMonthDate;
      if (baseDate && !isNaN(baseDate.getTime())) {
        const y = baseDate.getFullYear();
        const m = baseDate.getMonth();
        const lastD = new Date(y, m + 1, 0);
        if (!batchStart) batchStart = `${y}-${String(m + 1).padStart(2, '0')}-01`;
        if (!batchEnd) batchEnd = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastD.getDate()).padStart(2, '0')}`;
      }
    }

    if (!batchEnd) return false;

    // Data atual do sistema no formato YYYY-MM-DD (ex: 2026-09-14)
    const todayStr = new Date().toISOString().slice(0, 10);

    // Se a data de hoje já ultrapassou o término do prazo da criação em lote (ex: após 30/09/2026),
    // o prazo da criação em lote expirou e não pode mais alterar!
    if (todayStr > batchEnd) {
      return false;
    }

    // Se targetMonthDate estiver definido, garante que a janela da criação em lote sobrepõe o mês sendo visualizado
    if (targetMonthDate) {
      const y = targetMonthDate.getFullYear();
      const m = targetMonthDate.getMonth();
      const mStart = `${y}-${String(m + 1).padStart(2, '0')}-01`;
      const lastDayOfMonth = new Date(y, m + 1, 0);
      const mEnd = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDayOfMonth.getDate()).padStart(2, '0')}`;

      // A janela da criação em lote precisa ter intersecção com o mês em exibição
      if (batchStart && batchStart > mEnd) return false;
      if (batchEnd < mStart) return false;
    }

    return true;
  };

  const [selectedOrder, setSelectedOrder] = useState<ServiceOrder | null>(null);
  const [showDrawer, setShowDrawer] = useState(false);
  const [showBulkConfirmModal, setShowBulkConfirmModal] = useState(false);
  const [initialOpenSignature, setInitialOpenSignature] = useState(false);

  // Smart Filter States
  const [smartSearch, setSmartSearch] = useState('');
  const [selectedExecutionDate, setSelectedExecutionDate] = useState<string>('');
  const [showPreventiveScanSimulator, setShowPreventiveScanSimulator] = useState(false);
  const [selectedComarca, setSelectedComarca] = useState('Todas');
  const [selectedPatrimonio, setSelectedPatrimonio] = useState('Todos');
  const [selectedStatus, setSelectedStatus] = useState('Todos');

  // New subTabs & calendar state
  const [users, setUsers] = useState<HexonUser[]>([]);
  const [subTab, setSubTab] = useState<'realizacao' | 'planejamento'>(userProfile?.perfil === 'Profissional' ? 'realizacao' : 'planejamento');
  const [currentCalendarDate, setCurrentCalendarDate] = useState<Date>(new Date());
  const [selectedCalendarDay, setSelectedCalendarDay] = useState<number | null>(null);
  const [selectedCalendarEndDay, setSelectedCalendarEndDay] = useState<number | null>(null);

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [orderIdToDelete, setOrderIdToDelete] = useState<string | null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState<boolean>(false);
  const [showBulkRevertModal, setShowBulkRevertModal] = useState<boolean>(false);
  const [bulkRevertScope, setBulkRevertScope] = useState<'period' | 'month'>('period');

  // O mês visto no calendário / lista define quais OS fechadas são carregadas do banco
  useEffect(() => {
    onViewedMonthChange?.(localMonthKey(currentCalendarDate));
  }, [currentCalendarDate.getFullYear(), currentCalendarDate.getMonth()]);

  // Ao sair da tela de OS, volta para o mês atual (o Dashboard mostra o mês corrente)
  useEffect(() => {
    return () => onViewedMonthChange?.(localMonthKey());
  }, []);

  // Reset pagination to page 1 whenever search, filters, or orders list changes
  useEffect(() => {
    setCurrentPage(1);
  }, [smartSearch, selectedComarca, selectedPatrimonio, selectedStatus, selectedExecutionDate, orders]);

  // Load registered assets and templates
  useEffect(() => {
    dbGetAssets().then((list) => {
      setAssets(list);
    });
    dbGetTemplates().then((tpls) => {
      setTemplates(tpls);
    });
    dbGetUsers().then((uList) => {
      setUsers(uList);
    });
  }, []);

  // Handle auto-expansion/search for a specific OS highlighted from outside (e.g. from Solicitations)
  useEffect(() => {
    if (highlightOSId) {
      const target = orders.find(os => os.id === highlightOSId);
      if (target) {
        setSmartSearch(`#${highlightOSId}`);
        setSelectedOrder(target);
        setInitialOpenSignature(false);
        setShowDrawer(true);
      }
    }
  }, [highlightOSId, orders]);

  // Helper to determine the comarca of an order
  const getOrderComarca = (os: ServiceOrder) => {
    if (os.isSurvey && os.surveyLocation) {
      return os.surveyLocation;
    }
    if (os.assetId && assets.length > 0) {
      const asset = assets.find(a => a.id === os.assetId);
      if (asset) {
        return asset.specs?.COMARCA || asset.specs?.comarca || (asset.location && asset.location.includes(' - ') ? asset.location.split(' - ')[0] : asset.location) || 'Geral';
      }
    }
    if (os.description && os.description.includes('Comarca:')) {
      const match = os.description.match(/Comarca:\s*([^.]+)/);
      if (match) return match[1].trim();
    }
    return 'Geral';
  };

  // Helper to determine the CRAAI of an order
  const getOrderCRAAI = (os: ServiceOrder) => {
    if (os.assetId && assets.length > 0) {
      const asset = assets.find(a => a.id === os.assetId);
      if (asset) {
        return asset.specs?.CRAAI || asset.specs?.craai || os.sector || 'Geral';
      }
    }
    return os.sector || 'Geral';
  };

  // helper to clean automatic description phrases and save massive space
  const cleanDescriptionText = (desc: string | null | undefined): string => {
    if (!desc) return '';
    let cleaned = desc;
    // Strip "Vistoria de rotina programada."
    cleaned = cleaned.replace(/Vistoria de rotina programada\.?/gi, '');
    // Strip "Procedimento autônomo sem vinculação com ativos de engenharia."
    cleaned = cleaned.replace(/Procedimento aut[ôo]nomo sem vincula[çc][ãa]o com ativos de engenharia\.?/gi, '');
    // Strip generic automatic activity messages
    cleaned = cleaned.replace(/Atividade preventiva autom[áa]t[ai]ca?\.?/gi, '');
    cleaned = cleaned.replace(/Atividade preventiva autom[áa]t?a\.?/gi, '');
    cleaned = cleaned.replace(/Vistoria preventiva autom[áa]t[ai]ca?\.?/gi, '');
    cleaned = cleaned.replace(/Execu[çc][ãa]o de rotina programada\.?/gi, '');
    // Strip "Comarca: [Anything]"
    cleaned = cleaned.replace(/Comarca:\s*[^.]+\.?/gi, '');
    
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    // Clean trailing dots or leftover punctuation
    if (/^[.,:\-\s]*$/.test(cleaned)) {
      return '';
    }
    return cleaned;
  };

  // 3 Action Handlers: Visualizar, Executar, Excluir
  const handleViewPreventive = (os: ServiceOrder) => {
    setSelectedOrder(os);
    setInitialOpenSignature(false);
    setShowDrawer(true);
  };

  const handleExecutePreventive = (os: ServiceOrder) => {
    setSelectedOrder(os);
    setShowDrawer(true);
    
    // Automatically trigger signature pad / checklist if active
    if (os.status !== 'Concluída' && os.status !== 'Não Executada') {
      if (os.status === 'Planejada') {
        const updated = { ...os, status: 'Em Execução' as const };
        dbSaveServiceOrder(updated).then(() => {
          setSelectedOrder(updated);
          setInitialOpenSignature(true);
          onReload();
        });
      } else {
        setInitialOpenSignature(true);
      }
    } else {
      alert(`Esta preventiva #${os.id} já está concluída ou bloqueada (${os.status}).`);
    }
  };

  const handleDeletePreventive = (osId: string) => {
    if (userHasActionPermission && !userHasActionPermission('delete_order')) {
      alert('Acesso Restrito: Seu perfil de usuário não tem autorização para excluir preventivas.');
      return;
    }
    setOrderIdToDelete(osId);
  };

  const handleRevertOrder = async (os: ServiceOrder) => {
    if (!window.confirm(`Deseja reverter a OS #${os.id} para "Novo"? Ela voltará para a lista de preventivas aguardando agendamento.`)) {
      return;
    }
    const updatedOS: ServiceOrder = {
      ...os,
      status: 'Novo',
      scheduledDate: '',
      scheduledEndDate: undefined,
      assignedTechnician: '',
      updatedAt: new Date().toISOString()
    };
    await dbSaveServiceOrder(updatedOS);
    onReload();
  };

  // Generate unique list of comarcas and patrimonios for select dropdowns
  const comarcasList = Array.from(
    new Set(orders.map(os => getOrderComarca(os)).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  const patrimoniosList = Array.from(
    new Set(orders.map(os => os.assetCode).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  // Dynamic filtered orders listings
  const filteredOrders = orders.filter((os) => {
    const osComarca = getOrderComarca(os);
    const osPatrimonio = os.assetCode || '';
    const osId = os.id;

    // 1. Smart search matching
    let matchesSmart = true;
    if (smartSearch.trim() !== '') {
      const q = smartSearch.toLowerCase().trim();
      const cleanQ = q.startsWith('#') ? q.slice(1) : q;
      
      const matchId = osId.toLowerCase().includes(cleanQ);
      const matchPatrimonio = osPatrimonio.toLowerCase().includes(q);
      const matchComarca = osComarca.toLowerCase().includes(q);
      const matchTitle = os.title.toLowerCase().includes(q);
      const matchDesc = os.description.toLowerCase().includes(q);
      const matchTech = os.assignedTechnician.toLowerCase().includes(q);
      
      matchesSmart = matchId || matchPatrimonio || matchComarca || matchTitle || matchDesc || matchTech;
    }

    // 2. Comarca dropdown filter
    const matchesComarca = selectedComarca === 'Todas' || osComarca.toLowerCase().trim() === selectedComarca.toLowerCase().trim();

    // 3. Patrimônio dropdown filter
    const matchesPatrimonio = selectedPatrimonio === 'Todos' || osPatrimonio.toLowerCase().trim() === selectedPatrimonio.toLowerCase().trim();

    // 4. Status filter
    const matchesStatus = selectedStatus === 'Todos' || os.status === selectedStatus;

    // 5. Execution Date filter
    const matchesExecutionDate = !selectedExecutionDate || os.scheduledDate === selectedExecutionDate;

    return matchesSmart && matchesComarca && matchesPatrimonio && matchesStatus && matchesExecutionDate;
  });

  // Pagination calculation variables for 50 items per page
  const itemsPerPage = 50;
  const totalItems = filteredOrders.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
  const sanitizedPage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (sanitizedPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
  const paginatedOrders = filteredOrders.slice(startIndex, endIndex);

  // Bulk Selection and Controls Helpers
  const isAllSelected = paginatedOrders.length > 0 && paginatedOrders.every(os => selectedOrderIds.includes(os.id));
  const toggleSelectOrder = (id: string) => {
    setSelectedOrderIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };
  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedOrderIds(prev => prev.filter(id => !paginatedOrders.some(os => os.id === id)));
    } else {
      const pageIds = paginatedOrders.map(os => os.id);
      setSelectedOrderIds(prev => Array.from(new Set([...prev, ...pageIds])));
    }
  };

  const selectAndOpenOrderDrawer = (os: ServiceOrder) => {
    setSelectedOrder(os);
    setInitialOpenSignature(false);
    setShowDrawer(true);
  };

  // Custom progress stepper value generator
  const getProgressPercentage = (os: ServiceOrder) => {
    if (os.status === 'Concluída') return 100;
    if (os.status === 'Planejada') return 0;
    if (os.checklist.length === 0) return 30;
    const completed = os.checklist.filter(c => c.checked).length;
    return Math.round((completed / os.checklist.length) * 100);
  };

  const monthNames = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];

  const validateTechnicianAssignment = (techName: string, dateStr: string, currentOS: ServiceOrder): { isValid: boolean; warnings: string[]; errors: string[] } => {
    // Limits have been disabled as per user request (no maximum, unlimited daily allocations allowed)
    return {
      isValid: true,
      warnings: [],
      errors: []
    };
  };

  const checkTechAssignment = (techName: string, dateStr: string, os: ServiceOrder): boolean => {
    const checkObj = validateTechnicianAssignment(techName, dateStr, os);
    if (!checkObj.isValid) {
      alert(`⚠️ IMPOSSÍVEL ATRIBUIR TÉCNICO:\n\n${checkObj.errors.join('\n')}`);
      return false;
    }
    if (checkObj.warnings.length > 0) {
      return window.confirm(`⚠️ ADVERTÊNCIA DE ALOCAÇÃO:\n\n${checkObj.warnings.join('\n')}\n\nDeseja ignorar os avisos de sobrecarga/conflito e programar mesmo assim?`);
    }
    return true;
  };

  const activeLinkedAsset = selectedOrder ? assets.find(a => a.id === selectedOrder.assetId) : null;

  return (
    <div className="space-y-6 font-sans">
      {/* Informação / Alerta de Prazo Crítico Central Popup */}
      {showDeadlineWarnPopup && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/65 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xl max-w-md w-full animate-in zoom-in duration-200 text-left">
            <div className="flex items-center gap-3 text-amber-600 mb-4">
              <div className="bg-amber-105 p-3 rounded-full">
                <AlertTriangle className="w-7 h-7" />
              </div>
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">⚠️ ALERTA DE PRAZO CRÍTICO</h3>
                <span className="text-[10px] bg-amber-100 text-amber-900 px-2 py-0.5 rounded-md font-extrabold uppercase mt-1 inline-block">Gerência {warnPopupManagement}</span>
              </div>
            </div>
            
            <p className="text-xs text-slate-600 leading-relaxed font-semibold">
              Prezado Administrador, o prazo restrito para agendamento e alocação do atual lote de preventivas se encerrará em menos de 24 horas!
            </p>
            
            <div className="my-5 p-3.5 bg-amber-50 rounded-xl border border-amber-200 flex items-center justify-between font-mono">
              <span className="text-[11px] font-black uppercase text-slate-655">Tempo Restante:</span>
              <span className="text-xs font-black uppercase text-amber-850 animate-pulse">{warnPopupTimeText}</span>
            </div>
            
            <p className="text-[10px] text-slate-400 italic leading-relaxed">
              *Nota: Após o encerramento do prazo, todas as preventivas/vistorias com status "Novo" que não forem agendadas serão automaticamente cadastradas como "Não Executada", e o acesso a este calendário será bloqueado.
            </p>
            
            <div className="pt-6 border-t border-slate-150 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setHasDismissedTemp(true);
                  setShowDeadlineWarnPopup(false);
                }}
                className="w-full sm:w-auto px-6 py-2.5 bg-[#3525cd] hover:bg-[#281bbb] text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-md transition-all active:scale-95 cursor-pointer h-[40px] flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4 text-white" />
                Estou Ciente do Prazo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dynamic Countdowns / Status Bar for Administrator */}
      {userProfile?.perfil === 'Administrador' && userProfile.gerencia && userProfile.gerencia !== 'Todas' && (() => {
        const deadline = deadlines.find(d => d.id === userProfile.gerencia);
        if (!deadline || !deadline.expiresAt) return null;
        const { isExpired, text, hoursLeft } = getCountdownText(deadline.expiresAt);
        return (
          <div className={`p-3.5 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all ${
            isExpired 
              ? 'bg-rose-50 border-rose-200 text-rose-900 animate-pulse' 
              : hoursLeft <= 24 
                ? 'bg-amber-50 border-amber-200 text-amber-900 animate-pulse' 
                : 'bg-emerald-50 border-emerald-100 text-emerald-950'
          }`}>
            <div className="flex items-center gap-2.5">
              <div className={`p-2 rounded-lg ${isExpired ? 'bg-rose-105 text-rose-700' : hoursLeft <= 24 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                <Clock className="w-5 h-5 animate-spin" style={{ animationDuration: isExpired ? '0s' : hoursLeft <= 24 ? '3s' : '10s' }} />
              </div>
              <div className="text-left">
                <h4 className="text-[10.5px] font-black uppercase tracking-wider">
                  Tempo Limite para Planejamento de Preventivas ({userProfile.gerencia})
                </h4>
                <p className="text-[11px] opacity-80 mt-0.5 leading-relaxed font-semibold">
                  {isExpired 
                    ? 'Acesso ao planejamento suspenso devido a expiração do prazo de 7 dias.' 
                    : 'A gerência precisa lançar e atribuir todas as preventivas de campo no calendário antes do fim deste prazo.'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 bg-white/60 backdrop-blur-xs px-4 py-2 rounded-lg shadow-3xs border border-white/50 self-end md:self-auto">
              <span className="text-[10px] font-black uppercase tracking-wider opacity-60">Tempo Restante:</span>
              <span className={`text-xs font-mono font-black uppercase ${isExpired ? 'text-rose-600' : hoursLeft <= 24 ? 'text-amber-600' : 'text-[#3525cd]'}`}>
                {text}
              </span>
            </div>
          </div>
        );
      })()}

      {/* Super Admin Deadline Control Center */}
      {userProfile?.perfil === 'Super Administrador' && (
        <div className="bg-slate-50 border border-slate-205 rounded-xl p-5 text-left">
          <div className="flex items-center gap-2 mb-4">
            <ClipboardList className="w-5 h-5 text-indigo-750" />
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">⚙️ Painel de Controle de Prazos das Gerências</h3>
              <p className="text-[10px] text-slate-400 font-bold">Como Super Administrador, você define a data e horário limite para o planejamento das preventivas de cada gerência.</p>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {['GMC', 'GMMR', 'GMEE'].map(mId => {
              const dlObj = deadlines.find(d => d.id === mId);
              const { text, isExpired, hoursLeft } = dlObj ? getCountdownText(dlObj.expiresAt) : { text: 'Nenhum prazo definido', isExpired: false, hoursLeft: 999 };
              const hasValidDeadline = dlObj && dlObj.expiresAt && dlObj.expiresAt !== 'none';
              
              return (
                <div key={mId} className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-3xs flex flex-col justify-between hover:shadow-2xs transition-shadow">
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-black text-slate-800 tracking-wider">Gerência {mId}</span>
                      <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${
                        !hasValidDeadline
                          ? 'bg-slate-100 text-slate-500'
                          : isExpired 
                            ? 'bg-rose-100 text-rose-700' 
                            : hoursLeft <= 24 
                              ? 'bg-amber-100 text-amber-700 animate-pulse' 
                              : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {!hasValidDeadline ? 'Sem Prazo' : isExpired ? 'Expirado' : hoursLeft <= 24 ? 'Crítico (<24h)' : 'Liberado'}
                      </span>
                    </div>
                    
                    <p className="text-[11px] font-mono text-slate-400 mt-1">
                      Limite Atual: <span className="font-extrabold text-slate-700">{hasValidDeadline ? new Date(dlObj.expiresAt).toLocaleString('pt-BR') : 'Sem prazo definido'}</span>
                    </p>
                    <p className="text-[11px] font-bold text-slate-655 mt-1.5 flex items-center gap-1">
                      ⏳ Restam: <strong className="text-[#3525cd] font-black">{hasValidDeadline ? text : 'Sem prazo definido'}</strong>
                    </p>

                    {/* Custom DateTime Selection Input for the Super Admin */}
                    <div className="mt-4 pt-3.5 border-t border-dashed border-slate-150">
                      <label className="block text-[10px] font-black uppercase text-slate-500 mb-1.5">
                        Definir Prazo Limite:
                      </label>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="datetime-local"
                          value={customDates[mId] || ''}
                          onChange={(e) => setCustomDates(prev => ({ ...prev, [mId]: e.target.value }))}
                          className="text-[11px] font-semibold border border-slate-200 rounded-lg px-2.5 py-1 bg-slate-50 focus:bg-white text-slate-800 flex-1 outline-none focus:border-[#3525cd] focus:ring-1 focus:ring-[#3525cd]/20 h-[34px] w-full"
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            const val = customDates[mId];
                            if (!val) {
                              alert('Selecione uma data e hora válidas antes de confirmar.');
                              return;
                            }
                            const isoString = new Date(val).toISOString();
                            // Update React state immediately for snappy UX
                            setDeadlines(prev => {
                              const existing = prev.find(d => d.id === mId);
                              if (existing) {
                                return prev.map(d => d.id === mId ? { ...d, expiresAt: isoString } : d);
                              } else {
                                return [...prev, { id: mId, expiresAt: isoString }];
                              }
                            });
                            await dbSavePlanningDeadline({ id: mId, expiresAt: isoString });
                            alert(`Prazo da gerência ${mId} definido com sucesso para ${new Date(isoString).toLocaleString('pt-BR')}!`);
                            onReload();
                            loadDeadlines();
                          }}
                          className="px-6 bg-[#3525cd] hover:bg-[#281bbb] active:scale-98 text-white text-[10.5px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer flex items-center justify-center shadow-3xs h-[34px] shrink-0 w-full sm:w-auto"
                        >
                          OK
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      
      {/* SECTION: Page Hero Header */}
      <section className="bg-white rounded-xl p-6 md:p-7 border border-slate-200 shadow-sm relative overflow-hidden transition-all duration-200 hover:shadow-md flex items-center justify-between">
        <div className="relative z-10 max-w-4xl border-l-4 border-[#3525cd] pl-4 md:pl-5">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3525cd] animate-pulse"></span>
            <span className="text-[10px] font-black text-[#3525cd] tracking-widest uppercase">
              Cronograma & Execução Técnica
            </span>
          </div>
          <h1 className="text-xl md:text-2xl font-black text-slate-800 tracking-tight leading-snug">
            Ordens de Serviço — <span className="text-[#3525cd]">Preventivas de Campo</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1 max-w-3xl leading-relaxed">
            Consulte os roteiros, checklists operacionais, andamento das execuções e detalhes técnicos por comarca e patrimônio.
          </p>
        </div>

        {/* Backdrop Visual Accent */}
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-[#3525cd]/5 to-transparent pointer-events-none md:block hidden"></div>
      </section>

      {/* SECTION: Sub-Tabs Selector */}
      {userProfile?.perfil !== 'Profissional' && (
        <div className="border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-1">
          <div className="flex bg-slate-100/60 p-1 rounded-xl border border-slate-200/80 gap-1 w-full sm:w-auto md:min-w-[420px]">
            <button
              type="button"
              onClick={() => setSubTab('planejamento')}
              className={`flex-1 py-2 px-3 sm:px-4 rounded-lg text-[11px] md:text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all duration-205 cursor-pointer ${
                subTab === 'planejamento'
                  ? 'bg-[#3525cd] text-white shadow-sm'
                  : 'text-slate-650 hover:bg-slate-200/50 hover:text-slate-800'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Planejamento & Calendário</span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab('realizacao')}
              className={`flex-1 py-2 px-3 sm:px-4 rounded-lg text-[11px] md:text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all duration-205 cursor-pointer ${
                subTab === 'realizacao'
                  ? 'bg-[#3525cd] text-white shadow-sm'
                  : 'text-slate-650 hover:bg-slate-200/50 hover:text-[#0b1c30]'
              }`}
            >
              <Wrench className="w-3.5 h-3.5" />
              <span>Realização & Execução</span>
            </button>
          </div>

          <div className="text-[10px] text-slate-450 font-bold hidden sm:flex items-center gap-1.5 pr-2 uppercase tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
            Interface Administrativa
          </div>
        </div>
      )}

      {subTab === 'planejamento' && userProfile?.perfil !== 'Profissional' ? (
        <OrdersCalendarPlanning
          orders={orders}
          assets={assets}
          templates={templates}
          users={users}
          userProfile={userProfile}
          userHasActionPermission={userHasActionPermission}
          canRevertUnexecutedOrder={canRevertUnexecutedOrder}
          deadlines={deadlines}
          getCountdownText={getCountdownText}
          onReload={onReload}
          onViewOrder={handleViewPreventive}
          checkTechAssignment={checkTechAssignment}
          getOrderComarca={getOrderComarca}
          getOrderCRAAI={getOrderCRAAI}
          currentCalendarDate={currentCalendarDate}
          setCurrentCalendarDate={setCurrentCalendarDate}
          selectedCalendarDay={selectedCalendarDay}
          setSelectedCalendarDay={setSelectedCalendarDay}
          selectedCalendarEndDay={selectedCalendarEndDay}
          setSelectedCalendarEndDay={setSelectedCalendarEndDay}
          onOpenBulkRevertModal={(scope) => {
            setBulkRevertScope(scope);
            setShowBulkRevertModal(true);
          }}
        />
      ) : (
        <>
          {/* MÊS DAS OS FECHADAS: as abertas aparecem sempre; Concluídas e Não Executadas são as deste mês */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-white border border-slate-200 rounded-xl px-4 py-2.5 shadow-xs">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
              Concluídas e não executadas do mês
            </span>
            <div className="flex items-center gap-2 self-end sm:self-auto">
              <button
                type="button"
                onClick={() => setCurrentCalendarDate(new Date(currentCalendarDate.getFullYear(), currentCalendarDate.getMonth() - 1, 1))}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 cursor-pointer"
                title="Mês anterior"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs font-black text-slate-800 min-w-[130px] text-center">
                {monthNames[currentCalendarDate.getMonth()]}/{currentCalendarDate.getFullYear()}
              </span>
              <button
                type="button"
                onClick={() => setCurrentCalendarDate(new Date(currentCalendarDate.getFullYear(), currentCalendarDate.getMonth() + 1, 1))}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 cursor-pointer"
                title="Próximo mês"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* SECTION: Smart Search & Filtros Inteligentes (EXTRACTED IN STAGE 3) */}
          <OrdersFilterBar
            smartSearch={smartSearch}
            setSmartSearch={setSmartSearch}
            selectedComarca={selectedComarca}
            setSelectedComarca={setSelectedComarca}
            comarcasList={comarcasList}
            selectedPatrimonio={selectedPatrimonio}
            setSelectedPatrimonio={setSelectedPatrimonio}
            patrimoniosList={patrimoniosList}
            selectedExecutionDate={selectedExecutionDate}
            setSelectedExecutionDate={setSelectedExecutionDate}
            selectedStatus={selectedStatus}
            setSelectedStatus={setSelectedStatus}
            onOpenScanSimulator={() => setShowPreventiveScanSimulator(true)}
          />

          {/* SECTION: OS List Cards (EXTRACTED IN STAGE 3) */}
          <OrdersCardGrid
            paginatedOrders={paginatedOrders}
            totalFilteredOrders={totalItems}
            totalAllOrders={orders.length}
            selectedOrderIds={selectedOrderIds}
            isAllSelected={isAllSelected}
            onToggleSelectAll={toggleSelectAll}
            onToggleSelectOrder={toggleSelectOrder}
            onClearSelection={() => setSelectedOrderIds([])}
            onOpenBulkDeleteModal={() => setShowBulkDeleteModal(true)}
            onViewOrder={handleViewPreventive}
            onDeleteOrder={handleDeletePreventive}
            onRevertOrder={handleRevertOrder}
            canRevertUnexecutedOrder={canRevertUnexecutedOrder}
            currentCalendarDate={currentCalendarDate}
            userProfile={userProfile}
            getOrderComarca={getOrderComarca}
            getOrderCRAAI={getOrderCRAAI}
            currentPage={currentPage}
            totalPages={totalPages}
            startIndex={startIndex}
            endIndex={endIndex}
            onPageChange={(p) => setCurrentPage(p)}
          />

      {/* SLIDING SIDEBAR DETAIL DRAWER (EXTRACTED IN STAGE 2) */}
      <OrderDetailsDrawer
        isOpen={showDrawer && !!selectedOrder}
        order={selectedOrder}
        onClose={() => {
          setShowDrawer(false);
          setSelectedOrder(null);
          setInitialOpenSignature(false);
        }}
        onOrderUpdated={(updated) => setSelectedOrder(updated)}
        onReload={onReload}
        assets={assets}
        templates={templates}
        userProfile={userProfile}
        userHasActionPermission={userHasActionPermission}
        canRevertUnexecutedOrder={canRevertUnexecutedOrder}
        currentCalendarDate={currentCalendarDate}
        initialOpenSignature={initialOpenSignature}
      />
        </>
      )}

      {/* EXTRACTED MODALS (STAGE 1) */}
      <DeleteOrderModal
        isOpen={!!orderIdToDelete}
        orderIds={orderIdToDelete ? [orderIdToDelete] : []}
        onClose={() => setOrderIdToDelete(null)}
        onSuccess={() => {
          const id = orderIdToDelete;
          if (id) {
            setSelectedOrderIds((prev) => prev.filter((item) => item !== id));
            if (selectedOrder && selectedOrder.id === id) {
              setShowDrawer(false);
              setSelectedOrder(null);
            }
          }
          onReload();
        }}
      />

      <DeleteOrderModal
        isOpen={showBulkDeleteModal}
        orderIds={selectedOrderIds}
        onClose={() => setShowBulkDeleteModal(false)}
        onSuccess={() => {
          setSelectedOrderIds([]);
          onReload();
        }}
      />

      <BulkRevertModal
        isOpen={showBulkRevertModal}
        onClose={() => setShowBulkRevertModal(false)}
        orders={orders}
        currentCalendarDate={currentCalendarDate}
        bulkRevertScope={bulkRevertScope}
        selectedCalendarDay={selectedCalendarDay}
        selectedCalendarEndDay={selectedCalendarEndDay}
        monthNames={monthNames}
        canRevertUnexecutedOrder={canRevertUnexecutedOrder}
        onSuccess={onReload}
      />

      <PreventiveScanModal
        isOpen={showPreventiveScanSimulator}
        onClose={() => setShowPreventiveScanSimulator(false)}
        assets={assets}
        onSelectAssetCode={(code) => setSmartSearch(code)}
      />

    </div>
  );
}
