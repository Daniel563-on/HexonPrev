import React, { useState, useMemo, useEffect } from 'react';
import {
  ClipboardList,
  QrCode,
  User,
  Search,
  CheckCircle2,
  Clock,
  AlertCircle,
  Moon,
  Sun,
  Lock,
  LogOut,
  Eye,
  Camera,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Shield,
  Layers,
  Wrench,
  Sparkles,
  Calendar,
  MapPin,
  Check,
  RotateCcw,
  Play,
  AlertTriangle,
  BellRing
} from 'lucide-react';
import { ServiceOrder, Asset, HexonUser, WorkOrder, formatDateBR } from '../../types';
import { formatOrderNumber } from '../../utils/orderNumber';
import {
  OrderStart, subscribeMyActiveStart,
  dbGetMaterials, dbGetUnitPeople, dbGetUsualTeam, localTodayStr, SUSPICIOUS_MIN, fmtMinutes,
  subscribeTechnicianSolicitations, requestedItems, dbGetMyWorkOrders, dbGetCompanies, companyNames
} from '../../db/firebase';
import CorrectiveDecisionNote from '../orders/execution/CorrectiveDecisionNote';
import UsualTeamEditor from '../orders/execution/UsualTeamEditor';
import { dbGetSingleAssetPublic } from '../../db/assets';
import ChangePasswordModal from '../ChangePasswordModal';
import OrderDetailsDrawer from '../orders/OrderDetailsDrawer';
import CameraQrScanner from '../CameraQrScanner';
import TechnicianOsTab from './TechnicianOsTab';
import OsExecutionForm from '../os/OsExecutionForm';
import { parseScannedQrCode } from '../../utils/qrUtils';
import BrandLogo from '../BrandLogo';

export interface TechnicianMobileViewProps {
  orders: ServiceOrder[];
  assets: Asset[];
  templates: any[];
  userProfile: HexonUser;
  visibleUnits?: string[] | null; // unidades do técnico (null = todas)
  onReloadOrders: () => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  fontScale: number;
  setFontScale: (scale: number | ((prev: number) => number)) => void;
  highContrast: boolean;
  setHighContrast: (val: boolean) => void;
  onLogout: () => void;
  onUpdateUserProfile: (updated: HexonUser) => void;
  canRevertUnexecutedOrder?: (os: ServiceOrder, targetMonthDate?: Date) => boolean;
  canClientLink?: boolean; // "Enviar link de validação ao cliente" (OS)
}

type MobileTab = 'orders' | 'os' | 'solicitations' | 'scanner' | 'profile';
type FilterStatus = 'pending' | 'in_progress' | 'completed' | 'solicitations';

export default function TechnicianMobileView({
  orders,
  assets,
  templates,
  userProfile,
  visibleUnits = null,
  onReloadOrders,
  darkMode,
  onToggleDarkMode,
  fontScale,
  setFontScale,
  highContrast,
  setHighContrast,
  onLogout,
  onUpdateUserProfile,
  canRevertUnexecutedOrder = () => false,
  canClientLink = false
}: TechnicianMobileViewProps) {
  const [activeTab, setActiveTab] = useState<MobileTab>('orders');
  // Empresa do técnico (etapa especial E1): nome para o Meu Perfil
  const [companyLabel, setCompanyLabel] = useState('');
  useEffect(() => {
    if (!(userProfile.companies || []).length) return setCompanyLabel('');
    dbGetCompanies()
      .then((list) => setCompanyLabel(companyNames(userProfile.companies, list)))
      .catch(() => setCompanyLabel(''));
  }, [(userProfile.companies || []).join('|')]);
  const [osCount, setOsCount] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0); // botão Atualizar do cabeçalho (relê as OS do banco)
  const [scannedWorkOrders, setScannedWorkOrders] = useState<WorkOrder[]>([]); // OS (corretiva) do ativo lido no QR
  const [qrWorkOrder, setQrWorkOrder] = useState<WorkOrder | null>(null);
  const navButton = (tab: MobileTab, label: string, icon: React.ReactNode, badge = 0) => (
    <button
      onClick={() => setActiveTab(tab)}
      className={`flex flex-col items-center gap-1 transition-all cursor-pointer ${
        activeTab === tab ? 'text-violet-600 dark:text-cyan-300 font-extrabold scale-105' : 'text-slate-500 dark:text-slate-400 font-medium hover:text-slate-700'
      }`}
    >
      <div className="relative">
        {icon}
        {badge > 0 && (
          <span className="absolute -top-1 -right-2 px-1.5 py-0.2 rounded-full text-[9px] font-black bg-rose-500 text-white">{badge}</span>
        )}
      </div>
      <span className="text-[10px] tracking-tight">{label}</span>
    </button>
  );
  // Quantas OS (corretiva, layout, acompanhamento) estão com o técnico: 1 busca ao abrir o app
  useEffect(() => {
    dbGetMyWorkOrders(userProfile.matricula)
      .then((l) => setOsCount(l.filter((o) => !(o.status === 'Aguardando assinaturas' && o.nextSigner !== 'cliente') && o.status !== 'Concluída').length))
      .catch(() => {});
  }, [userProfile.matricula, refreshKey]);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<ServiceOrder | null>(null);
  const [isOrderDrawerOpen, setIsOrderDrawerOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [scannedAsset, setScannedAsset] = useState<Asset | null>(null);
  const [scannedMatchingOrder, setScannedMatchingOrder] = useState<ServiceOrder | null>(null);
  const [scannerNotification, setScannerNotification] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  const [isRefreshingOrders, setIsRefreshingOrders] = useState(false);
  const [loadedAssets, setLoadedAssets] = useState<Record<string, Asset>>({});

  // Atualizar: preventivas já chegam em tempo real (recarrega os modelos); as OS (corretiva) são relidas do banco
  const handleRefreshTechnicianOrders = async () => {
    setIsRefreshingOrders(true);
    try {
      setRefreshKey((k) => k + 1); // Minhas OS e o contador
      await onReloadOrders();
    } finally {
      setIsRefreshingOrders(false);
    }
  };

  // Merged assets list ensuring on-demand loaded assets from QR or single-fetch are available to drawers/modals
  const effectiveAssets = useMemo(() => {
    const map = new Map<string, Asset>();
    // First fill with any assets passed via props
    if (Array.isArray(assets)) {
      assets.forEach(a => {
        if (a && a.id) map.set(a.id, a);
      });
    }
    // Then overlay individually loaded assets from QR or single lookup
    Object.values(loadedAssets).forEach((a: Asset) => {
      if (a && a.id) map.set(a.id, a);
    });
    return Array.from(map.values());
  }, [assets, loadedAssets]);

  // OS do técnico: sempre a lista em tempo real (o próprio banco guarda a cópia do celular para uso sem internet).
  // A cópia antiga "hexon_service_orders" do navegador ficava desatualizada e, quando a lista esvaziava,
  // mostrava OS velhas (formato antigo, que travavam a tela): não é mais usada e é apagada do aparelho.
  const [sourceOrders, setSourceOrders] = useState<ServiceOrder[]>(() => orders || []);
  useEffect(() => {
    setSourceOrders(orders || []);
  }, [orders]);
  useEffect(() => {
    try {
      localStorage.removeItem('hexon_service_orders');
    } catch {
      /* ignora */
    }
  }, []);

  // Check if an order is strictly assigned to the current user (security & execution check)
  const isOrderAssignedToUser = (o: ServiceOrder | null | undefined): boolean => {
    if (!o) return false;
    // Admins and Super Admins inspecting the mobile view can view all orders
    if (userProfile.perfil === 'Administrador' || userProfile.perfil === 'Super Administrador') {
      return true;
    }
    const userName = (userProfile.name || '').trim().toLowerCase();
    const userMatricula = (userProfile.matricula || '').trim().toLowerCase();
    // OS com matrícula do técnico: vale a matrícula (o nome pode mudar no cadastro); OS antigas: pelo nome
    const techMat = (o.assignedTechnicianMatricula || '').trim().toLowerCase();
    if (techMat) return !!userMatricula && techMat === userMatricula;
    const tech = (o.assignedTechnician || '').trim().toLowerCase();
    return Boolean(
      tech &&
      tech !== 'não atribuído' &&
      tech !== 'nao atribuido' &&
      tech !== 'equipe técnica' &&
      tech !== 'equipe tecnica' &&
      (tech === userName || tech.includes(userName) || userName.includes(tech) || (userMatricula && tech.includes(userMatricula)))
    );
  };

  // OS em execução deste técnico (registro de início à parte; no máximo 1)
  const [myStart, setMyStart] = useState<OrderStart | null>(null);
  useEffect(() => subscribeMyActiveStart((userProfile.matricula || '').trim(), (s) => setMyStart(s)), [userProfile.matricula]);

  // Solicitações de corretiva das preventivas dele (Etapa 8): ficam aqui até todos os itens terem decisão
  const [mySolicitations, setMySolicitations] = useState<ServiceOrder[]>([]);
  useEffect(() => {
    const mat = (userProfile.matricula || '').trim();
    if (!mat) {
      setMySolicitations([]);
      return;
    }
    return subscribeTechnicianSolicitations(mat, setMySolicitations);
  }, [userProfile.matricula]);

  // Alerta de tempo longo (Etapa 7): OS em execução há mais de 10h (calculado no aparelho, sem gravar nada)
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);
  const runningMin = myStart ? (nowMs - Date.parse(myStart.deviceStartedAt)) / 60000 : 0;

  // Sem internet (Etapa 7): uma vez por dia, deixa no aparelho o que a execução usa
  // (materiais da gerência, pessoas da gerência e equipe habitual), para iniciar e concluir mesmo sem sinal
  useEffect(() => {
    const unit = userProfile.gerencia || '';
    const mat = (userProfile.matricula || '').trim();
    if (!unit || unit === 'Todas' || !mat || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    const key = `hexon_offline_prefetch_${mat}`;
    const today = localTodayStr();
    try {
      if (localStorage.getItem(key) === today) return;
    } catch {
      /* sem armazenamento: busca de novo */
    }
    // Materiais: só a lista da gerência + empresa do técnico (etapa especial E2)
    Promise.all([dbGetMaterials([unit], false, userProfile.companies?.[0]), dbGetUnitPeople(unit), dbGetUsualTeam(mat)]).then(() => {
      try {
        localStorage.setItem(key, today);
      } catch {
        /* ignora */
      }
    });
  }, [userProfile.gerencia, userProfile.matricula, userProfile.companies?.[0]]);

  // OS atribuídas a este técnico. Concluídas saem da lista; a iniciada aparece "Em Execução".
  const myOrders = useMemo(() => {
    return sourceOrders
      .filter(o => isOrderAssignedToUser(o) && o.status !== 'Concluída')
      .map(o => (myStart && myStart.orderId === o.id && o.status !== 'Não Executada'
        ? { ...o, status: 'Em Execução' as const, inExecution: { matricula: myStart.matricula, name: myStart.name, deviceStartedAt: myStart.deviceStartedAt } }
        : o));
  }, [sourceOrders, userProfile, myStart]);

  // Em execução = iniciada (registro de início), não mais "tem algum item preenchido"
  const isOrderInProgress = (o: ServiceOrder): boolean => o.status === 'Em Execução';

  // Helper to determine the comarca of an order
  const getOrderComarca = (os: ServiceOrder): string => {
    if ((os as any).comarca) return (os as any).comarca;
    if (os.isSurvey && os.surveyLocation) {
      return os.surveyLocation;
    }
    if ((os.assetId || os.assetCode) && assets.length > 0) {
      const asset = assets.find(a => (os.assetId && a.id === os.assetId) || (os.assetCode && a.code === os.assetCode));
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

  // Helper to determine the execution window (período programado) of an order
  const getOrderExecutionWindow = (os: ServiceOrder): { window: string; scheduledDay: string | null } => {
    let windowStr = '';
    let scheduledDay: string | null = null;

    if (os.startDate && os.endDate) {
      windowStr = os.startDate === os.endDate
        ? formatDateBR(os.startDate)
        : `${formatDateBR(os.startDate)} até ${formatDateBR(os.endDate)}`;
    } else if (os.scheduledDate && os.scheduledEndDate && os.scheduledDate !== os.scheduledEndDate) {
      windowStr = `${formatDateBR(os.scheduledDate)} até ${formatDateBR(os.scheduledEndDate)}`;
    } else if (os.scheduledDate && os.endDate && os.scheduledDate !== os.endDate) {
      windowStr = `${formatDateBR(os.scheduledDate)} até ${formatDateBR(os.endDate)}`;
    } else if (os.startDate && os.scheduledDate && os.startDate !== os.scheduledDate) {
      windowStr = `${formatDateBR(os.startDate)} até ${formatDateBR(os.scheduledDate)}`;
    } else {
      const fallback = os.scheduledDate || os.startDate || os.endDate;
      windowStr = fallback ? formatDateBR(fallback) : 'Período a definir';
    }

    if (os.scheduledDate) {
      const formattedScheduled = formatDateBR(os.scheduledDate);
      if (os.scheduledEndDate && os.scheduledEndDate !== os.scheduledDate) {
        const subPeriod = `${formattedScheduled} até ${formatDateBR(os.scheduledEndDate)}`;
        if (subPeriod !== windowStr) {
          scheduledDay = subPeriod;
        }
      } else if (formattedScheduled !== windowStr) {
        scheduledDay = formattedScheduled;
      }
    }

    return { window: windowStr, scheduledDay };
  };

  // Accurate real-time counts strictly for the technician's assigned orders
  const pendingCount = useMemo(() => {
    return myOrders.filter(o => o.status !== 'Concluída' && o.status !== 'Não Executada' && !isOrderInProgress(o)).length;
  }, [myOrders]);

  const inProgressCount = useMemo(() => {
    return myOrders.filter(isOrderInProgress).length;
  }, [myOrders]);

  const completedCount = useMemo(() => {
    return myOrders.filter(o => o.status === 'Concluída').length;
  }, [myOrders]);

  // Filtered orders for the active filter tab and search
  const displayedOrders = useMemo(() => {
    return myOrders.filter(o => {
      // 1. Status Filter
      if (filterStatus === 'pending') {
        if (o.status === 'Concluída' || o.status === 'Não Executada') return false;
        if (isOrderInProgress(o)) return false;
      } else if (filterStatus === 'in_progress') {
        if (!isOrderInProgress(o)) return false;
      } else if (filterStatus === 'completed') {
        if (o.status !== 'Concluída') return false;
      } else if (filterStatus === 'solicitations') {
        return false; // a aba Solicitações tem lista própria
      }

      // 2. Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesTitle = (o.title || '').toLowerCase().includes(q);
        const matchesAsset = (o.assetName || '').toLowerCase().includes(q);
        const matchesCode = (o.assetCode || '').toLowerCase().includes(q);
        const matchesId = (o.id || '').toLowerCase().includes(q);
        const matchesSector = (o.sector || '').toLowerCase().includes(q);
        const orderComarca = getOrderComarca(o).toLowerCase();
        const matchesComarca = orderComarca.includes(q);
        const execWindow = getOrderExecutionWindow(o);
        const matchesDate = execWindow.window.toLowerCase().includes(q) || (execWindow.scheduledDay && execWindow.scheduledDay.toLowerCase().includes(q));
        return matchesTitle || matchesAsset || matchesCode || matchesId || matchesSector || matchesComarca || matchesDate;
      }

      return true;
    });
  }, [myOrders, filterStatus, searchQuery, assets]);

  // Pagination: 20 orders per page
  const PAGE_SIZE = 20;
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Reset to first page when filter tab or search query changes
  useEffect(() => {
    setCurrentPage(1);
  }, [filterStatus, searchQuery]);

  const totalOrdersCount = displayedOrders.length;
  const totalPages = Math.max(1, Math.ceil(totalOrdersCount / PAGE_SIZE));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

  const paginatedOrders = useMemo(() => {
    const startIndex = (safeCurrentPage - 1) * PAGE_SIZE;
    return displayedOrders.slice(startIndex, startIndex + PAGE_SIZE);
  }, [displayedOrders, safeCurrentPage]);

  const handlePageChange = (newPage: number) => {
    const clamped = Math.min(Math.max(1, newPage), totalPages);
    setCurrentPage(clamped);
    window.scrollTo({ top: 130, behavior: 'smooth' });
  };

  // Handle QR Code Scanned
  const handleQrScanSuccess = async (decodedText: string) => {
    const raw = decodedText.trim();
    const clean = parseScannedQrCode(raw);

    // 1. Look for matching asset in cache or direct single read
    let asset = effectiveAssets.find(
      a =>
        a.id.toLowerCase() === clean.toLowerCase() ||
        a.code.toLowerCase() === clean.toLowerCase() ||
        a.id.toLowerCase() === raw.toLowerCase() ||
        a.code.toLowerCase() === raw.toLowerCase()
    );

    if (!asset) {
      try {
        asset = (await dbGetSingleAssetPublic(clean)) || (await dbGetSingleAssetPublic(raw)) || null;
      } catch (err) {
        console.warn('QR code asset single lookup failed:', err);
      }
    }

    if (!asset) {
      setScannerNotification({
        type: 'error',
        message: `Equipamento não localizado no sistema para o código: "${clean}". Verifique o QR Code.`
      });
      return;
    }

    // 2a. OS (corretiva, layout, acompanhamento) com este ativo vinculado que estão com o técnico
    const myWork = await dbGetMyWorkOrders(userProfile.matricula).catch(() => [] as WorkOrder[]);
    const assetWork = myWork.filter((w) => w.assetId === asset!.id || (!!w.assetCode && w.assetCode.toLowerCase() === asset!.code.toLowerCase()));
    setScannedWorkOrders(assetWork);
    const workNote = assetWork.length ? ` ${assetWork.length} OS corretiva(s) com este ativo atribuída(s) a você.` : '';

    // 2b. Preventiva ativa deste ativo
    const matchingOrder = myOrders.find(
      o => (o.assetId === asset.id || o.assetCode === asset.code) && o.status !== 'Concluída' && o.status !== 'Não Executada'
    ) || null;

    setScannedAsset(asset);
    if (asset) {
      setLoadedAssets(prev => ({
        ...prev,
        [asset.id]: asset,
        [asset.code]: asset
      }));
    }

    if (matchingOrder) {
      // Security check: is the order assigned to this technician?
      const isAssigned = isOrderAssignedToUser(matchingOrder);

      if (!isAssigned) {
        setScannedMatchingOrder(null);
        setScannerNotification({
          type: 'error',
          message: `Ativo "${asset.name}" (${asset.code}) identificado, porém a O.S. #${matchingOrder.id} está atribuída ao técnico "${matchingOrder.assignedTechnician || 'Outro'}". Você só pode executar O.S. atribuídas a você.`
        });
      } else {
        setScannedMatchingOrder(matchingOrder);
        setScannerNotification({
          type: 'success',
          message: `Ativo "${asset.name}" (${asset.code}) identificado! Preventiva #${matchingOrder.id} disponível para execução imediata.${workNote}`
        });
      }
    } else {
      setScannedMatchingOrder(null);
      setScannerNotification({
        type: assetWork.length ? 'success' : 'info',
        message: assetWork.length
          ? `Ativo identificado: ${asset.name} (${asset.code}).${workNote}`
          : `Ativo identificado: ${asset.name} (${asset.code}). Não há preventiva nem OS atribuída a você no momento para este equipamento.`
      });
    }
  };

  const getStatusBadge = (status: ServiceOrder['status']) => {
    switch (status) {
      case 'Concluída':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Concluída
          </span>
        );
      case 'Em Execução':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300 animate-pulse">
            <Clock className="w-3.5 h-3.5" />
            Em Execução
          </span>
        );
      case 'Atrasada':
      case 'Não Executada':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
            <AlertCircle className="w-3.5 h-3.5" />
            {status}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
            <Clock className="w-3.5 h-3.5" />
            Pendente
          </span>
        );
    }
  };

  return (
    <div className={`min-h-screen flex flex-col font-sans select-none pb-24 max-w-2xl mx-auto w-full relative sm:border-x shadow-2xl transition-colors ${
      darkMode ? 'bg-[#08122b] text-slate-100 sm:border-slate-800' : 'bg-slate-50 text-slate-900 sm:border-slate-200'
    }`}>
      
      {/* ================= TOP MOBILE APP BAR ================= */}
      <header className={`sticky top-0 z-30 px-4 py-3 border-b flex items-center justify-between backdrop-blur-md transition-colors ${
        darkMode ? 'bg-[#0e1a3a]/90 border-slate-800' : 'bg-white/90 border-slate-200'
      }`}>
        {/* Linha neon da marca (identidade visual 2.0) */}
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-violet-500/0 via-cyan-400/70 to-violet-500/0 pointer-events-none" />
        <div className="flex items-center gap-2.5">
          <BrandLogo
            className="w-11 h-11 shrink-0"
            fallback={
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-violet-600 to-cyan-400 flex items-center justify-center text-white shadow-sm shadow-cyan-500/30 font-black text-sm">
                H
              </div>
            }
          />
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-xl font-extrabold tracking-[0.15em] font-brand leading-none">HEXON</h1>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gradient-to-r from-violet-600 to-blue-500 text-white uppercase tracking-wider">
                Técnico
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium truncate max-w-[190px]">
              {userProfile.name || 'Profissional de Campo'}
            </p>
          </div>
        </div>

        {/* Atualizar (relê preventivas e OS); o modo escuro fica em Meu Perfil */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleRefreshTechnicianOrders}
            disabled={isRefreshingOrders}
            title="Atualizar: buscar as informações mais novas do banco"
            className={`p-2 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors flex items-center justify-center cursor-pointer ${
              isRefreshingOrders ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            <RotateCcw className={`w-4.5 h-4.5 text-indigo-600 dark:text-indigo-400 ${isRefreshingOrders ? 'animate-spin' : ''}`} />
          </button>

        </div>
      </header>

      {/* ================= TAB 1: MINHAS PREVENTIVAS ================= */}
      {activeTab === 'orders' && (
        <main className="flex-1 px-4 pt-4 space-y-4">
          {myStart && runningMin > SUSPICIOUS_MIN && (
            <div className="p-3 rounded-xl border bg-amber-50 border-amber-300 text-amber-900 text-xs font-bold flex gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                A OS #{formatOrderNumber(myStart.orderId)} está em execução há {fmtMinutes(runningMin)} (mais de 10h). Conclua ou desfaça o início: acima de 10h ela fica marcada como "tempo suspeito".
              </span>
            </div>
          )}

          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por equipamento, código ou OS..."
              className={`w-full pl-10 pr-4 py-2.5 rounded-xl text-sm border focus:outline-hidden focus:ring-2 focus:ring-indigo-500 transition-all ${
                darkMode
                  ? 'bg-slate-900/80 border-slate-800 text-white placeholder-slate-500'
                  : 'bg-white border-slate-200 text-slate-900 placeholder-slate-400'
              }`}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 hover:text-slate-600 p-1"
              >
                ✕
              </button>
            )}
          </div>

          {/* Abas: Pendentes, Execução e Solicitações (concluídas saem do app do técnico) */}
          <div className="grid grid-cols-3 gap-2 w-full">
            <button
              type="button"
              onClick={() => setFilterStatus('pending')}
              className={`min-h-[44px] py-2 px-1 rounded-xl text-center transition-all flex flex-col items-center justify-center cursor-pointer ${
                filterStatus === 'pending'
                  ? 'bg-indigo-600 text-white shadow-xs font-black'
                  : darkMode
                  ? 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800 font-bold'
                  : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200 shadow-2xs font-bold'
              }`}
            >
              <span className="text-xs sm:text-[13px] leading-tight truncate max-w-full">Pendentes</span>
              <span className={`text-[11px] font-mono leading-none mt-1 ${
                filterStatus === 'pending' ? 'text-indigo-100 font-bold' : 'text-slate-400 font-semibold'
              }`}>
                ({pendingCount})
              </span>
            </button>

            <button
              type="button"
              onClick={() => setFilterStatus('in_progress')}
              className={`min-h-[44px] py-2 px-1 rounded-xl text-center transition-all flex flex-col items-center justify-center cursor-pointer ${
                filterStatus === 'in_progress'
                  ? 'bg-indigo-600 text-white shadow-xs font-black'
                  : darkMode
                  ? 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800 font-bold'
                  : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200 shadow-2xs font-bold'
              }`}
            >
              <span className="text-xs sm:text-[13px] leading-tight truncate max-w-full">Execução</span>
              <span className={`text-[11px] font-mono leading-none mt-1 ${
                filterStatus === 'in_progress' ? 'text-indigo-100 font-bold' : 'text-slate-400 font-semibold'
              }`}>
                ({inProgressCount})
              </span>
            </button>

            <button
              type="button"
              onClick={() => setFilterStatus('solicitations')}
              className={`min-h-[44px] py-2 px-1 rounded-xl text-center transition-all flex flex-col items-center justify-center cursor-pointer ${
                filterStatus === 'solicitations'
                  ? 'bg-indigo-600 text-white shadow-xs font-black'
                  : darkMode
                  ? 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800 font-bold'
                  : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200 shadow-2xs font-bold'
              }`}
            >
              <span className="text-xs sm:text-[13px] leading-tight truncate max-w-full">Solicitações</span>
              <span className={`text-[11px] font-mono leading-none mt-1 ${
                filterStatus === 'solicitations' ? 'text-indigo-100 font-bold' : mySolicitations.length > 0 ? 'text-rose-500 font-bold' : 'text-slate-400 font-semibold'
              }`}>
                ({mySolicitations.length})
              </span>
            </button>
          </div>

          {/* Solicitações de corretiva aguardando o planejador (Etapa 8) */}
          {filterStatus === 'solicitations' && (
            <div className="space-y-3">
              {mySolicitations.length === 0 ? (
                <div className={`p-6 rounded-2xl border text-center text-sm font-bold ${darkMode ? 'bg-slate-900/40 border-slate-800 text-slate-400' : 'bg-white border-slate-200 text-slate-500'}`}>
                  Nenhuma solicitação de corretiva aguardando decisão.
                </div>
              ) : (
                mySolicitations.map((o) => (
                  <div key={o.id} className={`p-4 rounded-2xl border space-y-2 ${darkMode ? 'bg-slate-900/90 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-800'}`}>
                    <div className="flex justify-between gap-2">
                      <span className="font-mono text-[11px] font-black text-rose-600">OS #{formatOrderNumber(o.id)}</span>
                      <span className="text-[11px] text-slate-400">Concluída em {formatDateBR(o.signedAt || o.completedAt)}</span>
                    </div>
                    <p className="text-sm font-bold leading-snug">{o.assetName || o.title}</p>
                    {o.checklistPending ? (
                      <p className="text-xs text-slate-400">Carregando...</p>
                    ) : (
                      requestedItems(o).map((item) => (
                        <div key={item.id} className="space-y-1">
                          <p className="text-xs font-semibold">• {item.task}</p>
                          <CorrectiveDecisionNote item={item} />
                        </div>
                      ))
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* Pagination Summary Info */}
          {totalOrdersCount > 0 && (
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 px-1 pt-1">
              <span>
                Mostrando <strong className="text-slate-800 dark:text-slate-200">{(safeCurrentPage - 1) * PAGE_SIZE + 1}–{Math.min(safeCurrentPage * PAGE_SIZE, totalOrdersCount)}</strong> de <strong className="text-slate-800 dark:text-slate-200">{totalOrdersCount}</strong> ordens
              </span>
              <span className="text-[11px] font-medium text-slate-400">
                (20 por página)
              </span>
            </div>
          )}

          {/* Orders Cards List */}
          {filterStatus === 'solicitations' ? null : paginatedOrders.length === 0 ? (
            <div className={`p-8 rounded-2xl border text-center space-y-3 mt-6 ${
              darkMode ? 'bg-slate-900/40 border-slate-800/80 text-slate-400' : 'bg-white border-slate-200 text-slate-500'
            }`}>
              <div className="w-12 h-12 rounded-full bg-indigo-500/10 text-indigo-500 flex items-center justify-center mx-auto">
                <ClipboardList className="w-6 h-6" />
              </div>
              <p className="text-sm font-bold">Nenhuma ordem de serviço encontrada.</p>
              <p className="text-xs max-w-xs mx-auto text-slate-400">
                {filterStatus === 'pending'
                  ? 'Parabéns! Todas as suas preventivas atribuídas estão em dia.'
                  : filterStatus === 'in_progress'
                  ? 'Nenhuma preventiva em execução no momento. Abra uma preventiva pendente para iniciar o checklist.'
                  : 'Tente alterar o filtro de status ou a busca por texto.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {paginatedOrders.map(order => {
                const totalChecklist = order.checklist?.length || 0;
                const checkedCount = order.checklist?.filter(c => c.checked).length || 0;
                const progress = totalChecklist > 0 ? Math.round((checkedCount / totalChecklist) * 100) : 0;

                const asset = effectiveAssets.find(a => (order.assetId && a.id === order.assetId) || (order.assetCode && a.code === order.assetCode));
                const patrimonio = order.assetCode || asset?.code || asset?.specs?.PATRIMONIO || asset?.specs?.patrimonio || 'Não informado';
                const comarca = getOrderComarca(order);
                const execWindow = getOrderExecutionWindow(order);

                return (
                  <div
                    key={order.id}
                    onClick={async () => {
                      if (!isOrderAssignedToUser(order)) {
                        alert('Acesso Restrito: Esta Ordem de Serviço não está atribuída a você. Você só pode visualizar e executar preventivas atribuídas diretamente a você.');
                        return;
                      }

                      // If asset isn't loaded yet, fetch it on-demand (1 single read) so the drawer displays full specs
                      if (!asset && (order.assetId || order.assetCode)) {
                        const targetId = order.assetId || order.assetCode || '';
                        try {
                          const single = await dbGetSingleAssetPublic(targetId);
                          if (single) {
                            setLoadedAssets(prev => ({
                              ...prev,
                              [single.id]: single,
                              [single.code]: single
                            }));
                          }
                        } catch {}
                      }

                      // Abrir é só ver (nada é gravado). A execução começa em "Iniciar Preventiva", dentro da OS.
                      setSelectedOrder(order);
                      setIsOrderDrawerOpen(true);
                    }}
                    className={`p-4 rounded-2xl border transition-all active:scale-[0.99] cursor-pointer shadow-xs ${
                      darkMode
                        ? 'bg-slate-900/90 border-slate-800/90 hover:border-slate-700'
                        : 'bg-white border-slate-200 hover:border-indigo-300'
                    }`}
                  >
                    {/* Header: OS ID + Status badge */}
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-mono font-bold text-indigo-500">
                          #{formatOrderNumber(order.id)}
                        </span>
                      </div>
                      {getStatusBadge(order.status)}
                    </div>

                    {/* Destaque Máximo do Patrimônio */}
                    <div className={`p-3 rounded-xl border-2 flex items-center justify-between gap-2 mb-2.5 ${
                      darkMode
                        ? 'bg-amber-950/40 border-amber-500/60 shadow-inner'
                        : 'bg-amber-50 border-amber-300 shadow-2xs'
                    }`}>
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-amber-500 text-slate-950 font-black flex items-center justify-center shrink-0 shadow-xs">
                          <Shield className="w-4.5 h-4.5" />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-[10px] font-black uppercase tracking-wider text-amber-800 dark:text-amber-400 leading-none">
                            Nº Patrimônio
                          </span>
                          <span className="font-mono text-base font-black text-slate-900 dark:text-white tracking-wider mt-0.5 truncate">
                            {patrimonio}
                          </span>
                        </div>
                      </div>
                      {order.periodicity && (
                        <span className="px-2.5 py-1 rounded-lg text-[10px] font-black bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 shadow-2xs shrink-0">
                          {order.periodicity}
                        </span>
                      )}
                    </div>

                    {/* Title */}
                    <h3 className="text-sm font-bold leading-tight mb-2 text-slate-900 dark:text-white">
                      {order.title}
                    </h3>

                    {/* Comarca & Janela de Execução / Período Programado */}
                    <div className="space-y-1.5 mb-3">
                      <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 font-medium">
                        <MapPin className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                        <span className="text-slate-500 dark:text-slate-400">Comarca:</span>
                        <strong className="text-slate-900 dark:text-white font-bold">{comarca}</strong>
                      </div>

                      <div className="flex items-start gap-1.5 text-xs text-slate-600 dark:text-slate-300 font-medium">
                        <Calendar className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5" />
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                          <span className="text-slate-500 dark:text-slate-400">Janela de Execução:</span>
                          <strong className="text-slate-900 dark:text-white font-bold">{execWindow.window}</strong>
                        </div>
                      </div>

                      {execWindow.scheduledDay && (
                        <div className="flex items-center gap-1.5 text-xs text-indigo-600 dark:text-indigo-400 font-medium pl-5">
                          <Clock className="w-3 h-3 shrink-0" />
                          <span className="text-slate-500 dark:text-slate-400">Dia Agendado:</span>
                          <strong className="font-bold">{execWindow.scheduledDay}</strong>
                        </div>
                      )}
                    </div>

                    {/* Checklist progress bar */}
                    {totalChecklist > 0 && (
                      <div className="space-y-1 pt-1 border-t border-slate-100 dark:border-slate-800/80">
                        <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                          <span>Checklist de Manutenção</span>
                          <span>{checkedCount}/{totalChecklist} ({progress}%)</span>
                        </div>
                        <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              progress === 100
                                ? 'bg-emerald-500'
                                : progress > 0
                                ? 'bg-indigo-500'
                                : 'bg-slate-300 dark:bg-slate-700'
                            }`}
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Touch CTA footer */}
                    <div className="mt-3 pt-2.5 flex items-center justify-between text-xs font-bold text-indigo-600 dark:text-indigo-400">
                      <span>{order.status === 'Concluída' ? 'Ver Relatório e Assinatura' : 'Executar Checklist'}</span>
                      <ChevronRight className="w-4 h-4" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Bottom Pagination Navigation Bar */}
          {totalPages > 1 && (
            <div className={`mt-5 p-3 rounded-2xl border flex flex-col sm:flex-row items-center justify-between gap-3 shadow-2xs ${
              darkMode ? 'bg-slate-900/90 border-slate-800' : 'bg-white border-slate-200'
            }`}>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Página <strong className="text-slate-900 dark:text-white">{safeCurrentPage}</strong> de{' '}
                <strong className="text-slate-900 dark:text-white">{totalPages}</strong>
              </div>

              <div className="flex items-center gap-1.5 w-full sm:w-auto justify-center">
                <button
                  type="button"
                  onClick={() => handlePageChange(1)}
                  disabled={safeCurrentPage === 1}
                  title="Primeira página"
                  className={`min-h-[44px] min-w-[40px] px-2 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                    safeCurrentPage === 1
                      ? 'opacity-30 cursor-not-allowed text-slate-400'
                      : darkMode
                      ? 'bg-slate-800 hover:bg-slate-700 text-white'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  <ChevronsLeft className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => handlePageChange(safeCurrentPage - 1)}
                  disabled={safeCurrentPage === 1}
                  className={`min-h-[44px] px-3 rounded-xl text-xs font-bold flex items-center gap-1 transition-all cursor-pointer ${
                    safeCurrentPage === 1
                      ? 'opacity-30 cursor-not-allowed text-slate-400'
                      : darkMode
                      ? 'bg-slate-800 hover:bg-slate-700 text-white'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Anterior</span>
                </button>

                <span className="px-2 text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400">
                  {safeCurrentPage} / {totalPages}
                </span>

                <button
                  type="button"
                  onClick={() => handlePageChange(safeCurrentPage + 1)}
                  disabled={safeCurrentPage === totalPages}
                  className={`min-h-[44px] px-3 rounded-xl text-xs font-bold flex items-center gap-1 transition-all cursor-pointer ${
                    safeCurrentPage === totalPages
                      ? 'opacity-30 cursor-not-allowed text-slate-400'
                      : darkMode
                      ? 'bg-slate-800 hover:bg-slate-700 text-white'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  <span>Próxima</span>
                  <ChevronRight className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => handlePageChange(totalPages)}
                  disabled={safeCurrentPage === totalPages}
                  title="Última página"
                  className={`min-h-[44px] min-w-[40px] px-2 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                    safeCurrentPage === totalPages
                      ? 'opacity-30 cursor-not-allowed text-slate-400'
                      : darkMode
                      ? 'bg-slate-800 hover:bg-slate-700 text-white'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  <ChevronsRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </main>
      )}

      {/* ================= TAB 2: SCANNER QR CODE ================= */}
      {activeTab === 'scanner' && (
        <main className="flex-1 px-4 pt-4 flex flex-col space-y-4">
          <div className="text-center space-y-1">
            <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
              Leitor de QR Code de Equipamento
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
              Aponte a câmera para a etiqueta do equipamento para carregar a preventiva automaticamente.
            </p>
          </div>

          {/* Scanner Notification Banner */}
          {scannerNotification && (
            <div className={`p-3.5 rounded-xl border text-xs font-bold leading-relaxed animate-in fade-in flex items-start gap-2.5 ${
              scannerNotification.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/80 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100'
                : scannerNotification.type === 'error'
                ? 'bg-rose-50 dark:bg-rose-950/80 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-100'
                : 'bg-indigo-50 dark:bg-indigo-950/80 border-indigo-200 dark:border-indigo-800 text-indigo-900 dark:text-indigo-100'
            }`}>
              {scannerNotification.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />}
              {scannerNotification.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />}
              {scannerNotification.type === 'info' && <Sparkles className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />}
              <span className="flex-1">{scannerNotification.message}</span>
            </div>
          )}

          {/* If an asset was identified, show the Inspection & Action Card */}
          {scannedAsset ? (
            <div className="space-y-4 animate-in fade-in zoom-in-95 duration-200">
              
              {/* Asset Identity Card */}
              <div className={`p-4 rounded-2xl border space-y-3 ${
                darkMode ? 'bg-slate-900/90 border-slate-800' : 'bg-white border-slate-200 shadow-sm'
              }`}>
                <div className="flex items-start justify-between gap-2 border-b pb-3 border-slate-100 dark:border-slate-800">
                  <div className="min-w-0 flex-1">
                    <span className="text-[10px] uppercase font-black px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
                      {scannedAsset.sector}
                    </span>
                    <h3 className="text-base font-extrabold text-slate-900 dark:text-white mt-1 leading-snug">
                      {scannedAsset.name}
                    </h3>
                    <p className="text-xs font-mono font-bold text-slate-500 dark:text-slate-400">
                      Patrimônio / QR: <strong className="text-indigo-600 dark:text-indigo-400">{scannedAsset.code}</strong>
                    </p>
                  </div>

                  <span className={`inline-flex items-center gap-1 text-[10px] font-black uppercase px-2.5 py-1 rounded-full border ${
                    scannedAsset.status === 'Operando'
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-250 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                      : scannedAsset.status === 'Em Manutenção'
                      ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-250 dark:border-amber-800 text-amber-800 dark:text-amber-300'
                      : 'bg-rose-50 dark:bg-rose-950/40 border-rose-250 dark:border-rose-800 text-rose-850 dark:text-rose-300'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      scannedAsset.status === 'Operando' ? 'bg-emerald-500' : scannedAsset.status === 'Em Manutenção' ? 'bg-amber-500' : 'bg-rose-500'
                    }`} />
                    {scannedAsset.status}
                  </span>
                </div>

                {/* Location & Specs */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                    <span className="text-[9px] font-black uppercase text-slate-400 block mb-0.5">Localização</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200 truncate block">
                      {scannedAsset.location || 'Não especificada'}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                    <span className="text-[9px] font-black uppercase text-slate-400 block mb-0.5">Comarca / Prédio</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200 truncate block">
                      {scannedAsset.specs?.COMARCA || scannedAsset.specs?.comarca || 'Comarca Geral'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Box: If assigned preventive exists, show execute button. Otherwise, strictly show informative read-only status (no corrective ticket) */}
              {scannedMatchingOrder ? (
                <div className="p-4 rounded-2xl border border-indigo-200 dark:border-indigo-900/60 bg-gradient-to-br from-indigo-50/80 to-blue-50/50 dark:from-indigo-950/40 dark:to-blue-950/20 space-y-3">
                  <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-300 text-xs font-black uppercase tracking-wider">
                    <Clock className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <span>Preventiva Programada Atribuída a Você</span>
                  </div>

                  <div>
                    <h4 className="text-sm font-extrabold text-slate-900 dark:text-white leading-tight">
                      OS #{formatOrderNumber(scannedMatchingOrder.id)} • {scannedMatchingOrder.title}
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                      Checklist: <strong className="text-indigo-600 dark:text-indigo-400">{scannedMatchingOrder.checklist?.length || 0} itens</strong> para atestar
                    </p>
                  </div>

                  <button
                    onClick={() => {
                      setSelectedOrder(scannedMatchingOrder);
                      setIsOrderDrawerOpen(true);
                    }}
                    className="w-full min-h-[50px] py-3.5 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-blue-500 hover:brightness-110 text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 active:scale-98 transition-all cursor-pointer"
                  >
                    <Play className="w-4.5 h-4.5 fill-current" />
                    <span>Iniciar Execução da Preventiva</span>
                  </button>
                </div>
              ) : (
                <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 space-y-2.5">
                  <div className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300">
                    <CheckCircle2 className="w-4.5 h-4.5 text-indigo-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold text-slate-800 dark:text-slate-200">
                        Ficha Técnica Consultada com Sucesso
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed mt-0.5">
                        Não há preventiva nem OS pendente atribuída à sua matrícula para este equipamento no momento. Modo somente visualização da ficha técnica ativo.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* OS (corretiva) com este ativo, atribuídas ao técnico */}
              {scannedWorkOrders.map((w) => (
                <div key={w.id} className="p-4 rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/20 space-y-3">
                  <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 text-xs font-black uppercase tracking-wider">
                    <Wrench className="w-4 h-4" />
                    <span>OS atribuída a você ({w.status})</span>
                  </div>
                  <div>
                    <h4 className="text-sm font-extrabold text-slate-900 dark:text-white leading-tight">
                      {w.number} • {w.intervencao || 'OS'}{w.glpi ? ` • GLPI ${w.glpi}` : ''}
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">{w.execAddressText}</p>
                  </div>
                  <button
                    onClick={() => setQrWorkOrder(w)}
                    className="w-full min-h-[50px] py-3.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-sm flex items-center justify-center gap-2 active:scale-98 transition-all cursor-pointer"
                  >
                    <Play className="w-4.5 h-4.5 fill-current" />
                    <span>Abrir a OS</span>
                  </button>
                </div>
              ))}

              {/* Scan another button */}
              <button
                onClick={() => {
                  setScannedAsset(null);
                  setScannedMatchingOrder(null);
                  setScannedWorkOrders([]);
                  setScannerNotification(null);
                }}
                className={`w-full min-h-[46px] p-3 rounded-2xl border font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
                  darkMode
                    ? 'border-slate-800 bg-slate-900/60 hover:bg-slate-800 text-slate-300'
                    : 'border-slate-200 bg-white hover:bg-slate-100 text-slate-700'
                }`}
              >
                <RotateCcw className="w-4 h-4 text-indigo-500" />
                <span>Ler Outro QR Code de Equipamento</span>
              </button>

            </div>
          ) : (
            /* Camera Scanner Viewport */
            <div className="flex-1 flex flex-col items-center justify-center p-2">
              <div className="w-full max-w-sm rounded-2xl overflow-hidden shadow-xl border border-slate-200 dark:border-slate-800">
                <CameraQrScanner
                  onScanSuccess={handleQrScanSuccess}
                  onClose={() => setActiveTab('orders')}
                />
              </div>
            </div>
          )}
        </main>
      )}

      {/* ================= TAB 3: PERFIL & AJUSTES ================= */}
      {activeTab === 'profile' && (
        <main className="flex-1 px-4 pt-4 space-y-4">
          {/* User Card */}
          <div className={`p-4 rounded-2xl border ${
            darkMode ? 'bg-slate-900/90 border-slate-800' : 'bg-white border-slate-200'
          }`}>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-black text-lg shadow-sm">
                {(userProfile.name || 'T')[0].toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold truncate text-slate-900 dark:text-white">
                  {userProfile.name}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Matrícula: <strong className="text-indigo-500 font-mono">{userProfile.matricula || 'N/A'}</strong>
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300">
                    {userProfile.cargo || 'Colaborador'}
                  </span>
                  {userProfile.gerencia && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 truncate">
                      {userProfile.gerencia}
                    </span>
                  )}
                  {companyLabel && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 truncate" title="Empresa">
                      {companyLabel}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Section: Segurança & Senha */}
          <div className="space-y-1.5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 px-1">
              Segurança
            </h4>
            <div className={`rounded-2xl border overflow-hidden ${
              darkMode ? 'bg-slate-900/90 border-slate-800' : 'bg-white border-slate-200'
            }`}>
              <button
                onClick={() => setIsPasswordModalOpen(true)}
                className="w-full px-4 py-3.5 flex items-center justify-between text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center">
                    <Lock className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-white">Alterar Minha Senha</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Redefinir credencial de login</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </button>
            </div>
          </div>

          {/* Section: Equipe habitual (Etapa 6.2): entra como participante ao iniciar uma OS */}
          {userProfile.matricula && userProfile.gerencia && userProfile.gerencia !== 'Todas' && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 px-1">
                Equipe
              </h4>
              <div className={`p-4 rounded-2xl border ${
                darkMode ? 'bg-slate-900/90 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-800'
              }`}>
                <UsualTeamEditor
                  matricula={userProfile.matricula}
                  techName={userProfile.name}
                  unit={userProfile.gerencia}
                  editorName={userProfile.name}
                  compact
                />
              </div>
            </div>
          )}

          {/* Section: Visual & Acessibilidade */}
          <div className="space-y-1.5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 px-1">
              Visual e Acessibilidade
            </h4>
            <div className={`rounded-2xl border divide-y overflow-hidden ${
              darkMode ? 'bg-slate-900/90 border-slate-800 divide-slate-800' : 'bg-white border-slate-200 divide-slate-100'
            }`}>
              
              {/* Dark Mode Toggle */}
              <div className="px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center">
                    {darkMode ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-white">Tema Escuro</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {darkMode ? 'Ativado (economiza bateria)' : 'Desativado (modo claro)'}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onToggleDarkMode}
                  className={`w-12 h-6.5 rounded-full p-1 transition-colors ${
                    darkMode ? 'bg-indigo-600' : 'bg-slate-300'
                  }`}
                >
                  <div className={`w-4.5 h-4.5 rounded-full bg-white transition-transform ${
                    darkMode ? 'translate-x-5.5' : 'translate-x-0'
                  }`} />
                </button>
              </div>

              {/* Font Size Scaling */}
              <div className="px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center font-black text-xs">
                    Aa
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-white">Tamanho da Fonte</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {fontScale === 1 ? 'Padrão (100%)' : fontScale === 1.15 ? 'Grande (115%)' : 'Extra Grande (130%)'}
                    </div>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setFontScale(1)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                      fontScale === 1
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    1x
                  </button>
                  <button
                    onClick={() => setFontScale(1.15)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                      fontScale === 1.15
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    1.15x
                  </button>
                  <button
                    onClick={() => setFontScale(1.30)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                      fontScale === 1.30
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    1.3x
                  </button>
                </div>
              </div>

              {/* High Contrast */}
              <div className="px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-500 flex items-center justify-center">
                    <Eye className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-white">Alto Contraste</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Facilita a leitura sob sol forte</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setHighContrast(!highContrast)}
                  className={`w-12 h-6.5 rounded-full p-1 transition-colors ${
                    highContrast ? 'bg-indigo-600' : 'bg-slate-300'
                  }`}
                >
                  <div className={`w-4.5 h-4.5 rounded-full bg-white transition-transform ${
                    highContrast ? 'translate-x-5.5' : 'translate-x-0'
                  }`} />
                </button>
              </div>

            </div>
          </div>

          {/* Section: Logout */}
          <div className="pt-2">
            <button
              onClick={onLogout}
              className="w-full p-3.5 rounded-2xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/20 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-rose-700 dark:text-rose-300 font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              Sair da Conta (Logout)
            </button>
          </div>
        </main>
      )}

      {/* ================= TAB: MINHAS OS (corretiva, layout, acompanhamento) ================= */}
      {activeTab === 'os' && <TechnicianOsTab userProfile={userProfile} darkMode={darkMode} onCount={setOsCount} refreshKey={refreshKey} canClientLink={canClientLink} />}

      {/* ================= TAB: SOLICITAÇÕES (conteúdo em uma próxima fase) ================= */}
      {activeTab === 'solicitations' && (
        <main className="flex-1 px-4 pt-4">
          <div className={`p-6 rounded-2xl border text-center space-y-2 ${darkMode ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200'}`}>
            <BellRing className="w-8 h-8 mx-auto text-indigo-500" />
            <p className={`text-sm font-black ${darkMode ? 'text-white' : 'text-slate-900'}`}>Solicitações</p>
            <p className="text-xs text-slate-500">Em construção: as solicitações do técnico chegam numa próxima fase.</p>
          </div>
        </main>
      )}

      {/* ================= BOTTOM NAVIGATION BAR ================= */}
      {/* Ordem: Solicitações · Minhas OS · [QR em destaque] · Preventivas · Meu Perfil */}
      <nav className={`fixed bottom-0 left-0 right-0 max-w-2xl mx-auto z-40 border-t backdrop-blur-md transition-colors ${
        darkMode ? 'bg-[#0e1a3a]/95 border-slate-800' : 'bg-white/95 border-slate-200'
      }`}>
        {/* Linha neon da marca (identidade visual 2.0) */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-violet-500/0 via-cyan-400/70 to-violet-500/0 pointer-events-none" />
        <div className="max-w-md mx-auto px-2 h-18 grid grid-cols-5 items-center relative">
          {navButton('solicitations', 'Solicitações', <BellRing className="w-5.5 h-5.5" />)}
          {navButton('os', 'Minhas OS', <Wrench className="w-5.5 h-5.5" />, osCount)}

          {/* Destaque central: Ler QR Code */}
          <div className="relative -top-5 flex justify-center">
            <button
              onClick={() => setActiveTab('scanner')}
              className={`w-15 h-15 rounded-2xl flex flex-col items-center justify-center text-white border border-cyan-300/50 shadow-[0_0_22px_rgba(34,211,238,0.45)] transition-all duration-200 active:scale-95 cursor-pointer ${
                activeTab === 'scanner'
                  ? 'bg-gradient-to-tr from-violet-700 via-blue-600 to-cyan-500 ring-4 ring-cyan-400/25'
                  : 'bg-gradient-to-tr from-violet-600 via-blue-500 to-cyan-400 hover:brightness-110'
              }`}
            >
              <QrCode className="w-7 h-7" />
            </button>
            <span className="absolute -bottom-4.5 left-1/2 -translate-x-1/2 text-[9px] font-extrabold tracking-tight text-violet-600 dark:text-cyan-300 whitespace-nowrap">
              Escanear QR
            </span>
          </div>

          {navButton('orders', 'Preventivas', <ClipboardList className="w-5.5 h-5.5" />, pendingCount)}
          {navButton('profile', 'Meu Perfil', <User className="w-5.5 h-5.5" />)}
        </div>
      </nav>

      {/* OS (corretiva) aberta pelo QR Code */}
      {qrWorkOrder && (
        <OsExecutionForm
          order={qrWorkOrder}
          userProfile={userProfile}
          canClientLink={canClientLink}
          onClose={() => {
            setQrWorkOrder(null);
            setRefreshKey((k) => k + 1);
          }}
          onChanged={(u) => setQrWorkOrder(u)}
        />
      )}

      {/* ================= ORDER EXECUTION & CHECKLIST DRAWER ================= */}
      {selectedOrder && (
        <OrderDetailsDrawer
          isOpen={isOrderDrawerOpen}
          order={selectedOrder}
          onClose={() => {
            setIsOrderDrawerOpen(false);
            setSelectedOrder(null);
          }}
          onReload={() => {
            onReloadOrders();
          }}
          assets={effectiveAssets}
          templates={templates}
          userProfile={userProfile}
          userHasActionPermission={() => true}
          canRevertUnexecutedOrder={canRevertUnexecutedOrder}
          currentCalendarDate={new Date()}
          onOrderUpdated={(updated) => {
            setSelectedOrder(updated);
            setSourceOrders(prev => prev.map(o => o.id === updated.id ? updated : o));
            onReloadOrders();
          }}
        />
      )}

      {/* ================= MODAL: CHANGE PASSWORD ================= */}
      <ChangePasswordModal
        isOpen={isPasswordModalOpen}
        onClose={() => setIsPasswordModalOpen(false)}
        userProfile={userProfile}
        onSuccess={(updated) => {
          onUpdateUserProfile(updated);
        }}
      />

    </div>
  );
}
