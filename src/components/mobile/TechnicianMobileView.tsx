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
  AlertTriangle
} from 'lucide-react';
import { ServiceOrder, Asset, HexonUser } from '../../types';
import { dbSaveServiceOrder } from '../../db/firebase';
import ChangePasswordModal from '../ChangePasswordModal';
import OrderDetailsDrawer from '../orders/OrderDetailsDrawer';
import CameraQrScanner from '../CameraQrScanner';
import QuickCorrectiveModal from './QuickCorrectiveModal';
import { parseScannedQrCode } from '../../utils/qrUtils';

export interface TechnicianMobileViewProps {
  orders: ServiceOrder[];
  assets: Asset[];
  templates: any[];
  userProfile: HexonUser;
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
}

type MobileTab = 'orders' | 'scanner' | 'profile';
type FilterStatus = 'pending' | 'in_progress' | 'completed' | 'all';

export default function TechnicianMobileView({
  orders,
  assets,
  templates,
  userProfile,
  onReloadOrders,
  darkMode,
  onToggleDarkMode,
  fontScale,
  setFontScale,
  highContrast,
  setHighContrast,
  onLogout,
  onUpdateUserProfile,
  canRevertUnexecutedOrder = () => false
}: TechnicianMobileViewProps) {
  const [activeTab, setActiveTab] = useState<MobileTab>('orders');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<ServiceOrder | null>(null);
  const [isOrderDrawerOpen, setIsOrderDrawerOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [scannedAsset, setScannedAsset] = useState<Asset | null>(null);
  const [scannedMatchingOrder, setScannedMatchingOrder] = useState<ServiceOrder | null>(null);
  const [isCorrectiveModalOpen, setIsCorrectiveModalOpen] = useState(false);
  const [scannerNotification, setScannerNotification] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  // Filter orders strictly assigned to or relevant for this technician
  const myOrders = useMemo(() => {
    const userName = (userProfile.name || '').trim().toLowerCase();
    const userMatricula = (userProfile.matricula || '').trim().toLowerCase();

    return orders.filter(o => {
      // 1. Direct match by technician name or matricula
      const tech = (o.assignedTechnician || '').trim().toLowerCase();
      if (tech && (tech === userName || tech.includes(userName) || (userMatricula && tech.includes(userMatricula)))) {
        return true;
      }
      // 2. Fallback: if no specific technician assigned, show orders in tech's sector/gerência
      if (!o.assignedTechnician || o.assignedTechnician === 'Não Atribuído' || o.assignedTechnician === 'Equipe Técnica') {
        if (userProfile.gerencia && userProfile.gerencia !== 'Todas') {
          return o.sector === userProfile.gerencia;
        }
        return true;
      }
      return false;
    });
  }, [orders, userProfile]);

  // Helper to determine if an order is being executed
  const isOrderInProgress = (o: ServiceOrder): boolean => {
    if (o.status === 'Concluída' || o.status === 'Não Executada') return false;

    // 1. Direct status match (normalized)
    const norm = (o.status || '').trim().toLowerCase();
    if (norm === 'em execução' || norm === 'em execucao' || norm === 'em andamento') {
      return true;
    }

    // 2. Any checklist item has been checked, answered, or has progress
    if (o.checklist && Array.isArray(o.checklist) && o.checklist.length > 0) {
      const hasProgress = o.checklist.some(
        c => Boolean(c.checked) || 
             Boolean(c.checkedAt) || 
             (c.statusCheck !== undefined && c.statusCheck !== null) || 
             (c.autoCorrectiveAnswer !== undefined && c.autoCorrectiveAnswer !== null) ||
             (typeof c.observations === 'string' && c.observations.trim().length > 0)
      );
      if (hasProgress) return true;
    }

    return false;
  };

  // Count pending/active orders
  const pendingCount = useMemo(() => {
    return myOrders.filter(o => o.status !== 'Concluída' && o.status !== 'Não Executada').length;
  }, [myOrders]);

  const inProgressCount = useMemo(() => {
    return myOrders.filter(isOrderInProgress).length;
  }, [myOrders]);

  const completedCount = useMemo(() => {
    return myOrders.filter(o => o.status === 'Concluída').length;
  }, [myOrders]);

  // Apply search and status tab filters
  const displayedOrders = useMemo(() => {
    return myOrders.filter(o => {
      // Status filter
      if (filterStatus === 'pending') {
        if (o.status === 'Concluída' || o.status === 'Não Executada') return false;
      } else if (filterStatus === 'in_progress') {
        if (!isOrderInProgress(o)) return false;
      } else if (filterStatus === 'completed') {
        if (o.status !== 'Concluída') return false;
      }

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesTitle = (o.title || '').toLowerCase().includes(q);
        const matchesAsset = (o.assetName || '').toLowerCase().includes(q);
        const matchesCode = (o.assetCode || '').toLowerCase().includes(q);
        const matchesId = (o.id || '').toLowerCase().includes(q);
        const matchesSector = (o.sector || '').toLowerCase().includes(q);
        return matchesTitle || matchesAsset || matchesCode || matchesId || matchesSector;
      }

      return true;
    });
  }, [myOrders, filterStatus, searchQuery]);

  // Pagination State for technician mobile view
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(15);

  // Reset to first page when filter tab, search query, or page size changes
  useEffect(() => {
    setCurrentPage(1);
  }, [filterStatus, searchQuery, pageSize]);

  const totalOrdersCount = displayedOrders.length;
  const totalPages = Math.max(1, Math.ceil(totalOrdersCount / pageSize));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

  const paginatedOrders = useMemo(() => {
    const startIndex = (safeCurrentPage - 1) * pageSize;
    return displayedOrders.slice(startIndex, startIndex + pageSize);
  }, [displayedOrders, safeCurrentPage, pageSize]);

  const handlePageChange = (newPage: number) => {
    const clamped = Math.min(Math.max(1, newPage), totalPages);
    setCurrentPage(clamped);
    window.scrollTo({ top: 130, behavior: 'smooth' });
  };

  // Handle QR Code Scanned
  const handleQrScanSuccess = (decodedText: string) => {
    const raw = decodedText.trim();
    const clean = parseScannedQrCode(raw);

    // Look for matching asset
    const asset = assets.find(
      a =>
        a.id.toLowerCase() === clean.toLowerCase() ||
        a.code.toLowerCase() === clean.toLowerCase() ||
        a.id.toLowerCase() === raw.toLowerCase() ||
        a.code.toLowerCase() === raw.toLowerCase()
    );

    if (!asset) {
      setScannerNotification({
        type: 'error',
        message: `Equipamento não localizado no sistema para o código: "${clean}". Verifique o QR Code.`
      });
      return;
    }

    // Find active order for this asset
    const matchingOrder = myOrders.find(
      o => (o.assetId === asset.id || o.assetCode === asset.code) && o.status !== 'Concluída'
    ) || orders.find(
      o => (o.assetId === asset.id || o.assetCode === asset.code) && o.status !== 'Concluída'
    );

    setScannedAsset(asset);
    setScannedMatchingOrder(matchingOrder || null);

    if (matchingOrder) {
      setScannerNotification({
        type: 'success',
        message: `Ativo "${asset.name}" (${asset.code}) identificado! Preventiva #${matchingOrder.id} disponível para execução imediata.`
      });
    } else {
      setScannerNotification({
        type: 'info',
        message: `Ativo identificado: ${asset.name} (${asset.code}). Não há O.S. pendente no momento para este equipamento.`
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
      darkMode ? 'bg-[#0A101D] text-slate-100 sm:border-slate-800' : 'bg-slate-50 text-slate-900 sm:border-slate-200'
    }`}>
      
      {/* ================= TOP MOBILE APP BAR ================= */}
      <header className={`sticky top-0 z-30 px-4 py-3 border-b flex items-center justify-between backdrop-blur-md transition-colors ${
        darkMode ? 'bg-[#0A101D]/90 border-slate-800' : 'bg-white/90 border-slate-200'
      }`}>
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-500 flex items-center justify-center text-white shadow-sm shadow-indigo-500/20 font-black text-sm">
            H
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-sm font-extrabold tracking-tight">HEXON CAMPO</h1>
              <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-indigo-500/10 text-indigo-500 uppercase tracking-wider">
                Técnico
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium truncate max-w-[190px]">
              {userProfile.name || 'Profissional de Campo'}
            </p>
          </div>
        </div>

        {/* Quick action: Dark mode toggle */}
        <button
          onClick={onToggleDarkMode}
          title={darkMode ? 'Mudar para Tema Claro' : 'Mudar para Tema Escuro'}
          className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors flex items-center justify-center cursor-pointer"
        >
          {darkMode ? (
            <Sun className="w-4.5 h-4.5 text-amber-400" />
          ) : (
            <Moon className="w-4.5 h-4.5 text-indigo-600" />
          )}
        </button>
      </header>

      {/* ================= TAB 1: MINHAS PREVENTIVAS ================= */}
      {activeTab === 'orders' && (
        <main className="flex-1 px-4 pt-4 space-y-4">
          
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

          {/* Status Tabs - Never clips or cuts off on mobile screens */}
          <div className="grid grid-cols-4 gap-1.5 w-full">
            <button
              type="button"
              onClick={() => setFilterStatus('pending')}
              className={`min-h-[44px] py-1.5 px-1 rounded-xl text-center transition-all flex flex-col items-center justify-center cursor-pointer ${
                filterStatus === 'pending'
                  ? 'bg-indigo-600 text-white shadow-xs font-black'
                  : darkMode
                  ? 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800 font-bold'
                  : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200 shadow-2xs font-bold'
              }`}
            >
              <span className="text-[11px] leading-tight truncate max-w-full">Pendentes</span>
              <span className={`text-[10px] font-mono leading-none mt-0.5 ${
                filterStatus === 'pending' ? 'text-indigo-100 font-bold' : 'text-slate-400 font-medium'
              }`}>
                ({pendingCount})
              </span>
            </button>

            <button
              type="button"
              onClick={() => setFilterStatus('in_progress')}
              className={`min-h-[44px] py-1.5 px-1 rounded-xl text-center transition-all flex flex-col items-center justify-center cursor-pointer ${
                filterStatus === 'in_progress'
                  ? 'bg-indigo-600 text-white shadow-xs font-black'
                  : darkMode
                  ? 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800 font-bold'
                  : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200 shadow-2xs font-bold'
              }`}
            >
              <span className="text-[11px] leading-tight truncate max-w-full">Execução</span>
              <span className={`text-[10px] font-mono leading-none mt-0.5 ${
                filterStatus === 'in_progress' ? 'text-indigo-100 font-bold' : 'text-slate-400 font-medium'
              }`}>
                ({inProgressCount})
              </span>
            </button>

            <button
              type="button"
              onClick={() => setFilterStatus('completed')}
              className={`min-h-[44px] py-1.5 px-1 rounded-xl text-center transition-all flex flex-col items-center justify-center cursor-pointer ${
                filterStatus === 'completed'
                  ? 'bg-indigo-600 text-white shadow-xs font-black'
                  : darkMode
                  ? 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800 font-bold'
                  : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200 shadow-2xs font-bold'
              }`}
            >
              <span className="text-[11px] leading-tight truncate max-w-full">Concluídas</span>
              <span className={`text-[10px] font-mono leading-none mt-0.5 ${
                filterStatus === 'completed' ? 'text-indigo-100 font-bold' : 'text-slate-400 font-medium'
              }`}>
                ({completedCount})
              </span>
            </button>

            <button
              type="button"
              onClick={() => setFilterStatus('all')}
              className={`min-h-[44px] py-1.5 px-1 rounded-xl text-center transition-all flex flex-col items-center justify-center cursor-pointer ${
                filterStatus === 'all'
                  ? 'bg-indigo-600 text-white shadow-xs font-black'
                  : darkMode
                  ? 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800 font-bold'
                  : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200 shadow-2xs font-bold'
              }`}
            >
              <span className="text-[11px] leading-tight truncate max-w-full">Todas</span>
              <span className={`text-[10px] font-mono leading-none mt-0.5 ${
                filterStatus === 'all' ? 'text-indigo-100 font-bold' : 'text-slate-400 font-medium'
              }`}>
                ({myOrders.length})
              </span>
            </button>
          </div>

          {/* Pagination & Filter Summary Info */}
          {displayedOrders.length > 0 && (
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 px-1 pt-1">
              <span>
                Mostrando <strong className="text-slate-800 dark:text-slate-200">{(safeCurrentPage - 1) * pageSize + 1}–{Math.min(safeCurrentPage * pageSize, totalOrdersCount)}</strong> de <strong className="text-slate-800 dark:text-slate-200">{totalOrdersCount}</strong>
              </span>

              {/* Page size selector */}
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-slate-400 mr-0.5">Por pág:</span>
                {[10, 15, 25, 50].map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => setPageSize(size)}
                    className={`px-2 py-0.5 rounded text-[11px] font-bold transition-all cursor-pointer ${
                      pageSize === size
                        ? 'bg-indigo-600 text-white font-black shadow-2xs'
                        : darkMode
                        ? 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Orders Cards List */}
          {displayedOrders.length === 0 ? (
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

                return (
                  <div
                    key={order.id}
                    onClick={() => {
                      if (order.status !== 'Concluída' && order.status !== 'Não Executada' && order.status !== 'Em Execução') {
                        const updated = { ...order, status: 'Em Execução' as const };
                        dbSaveServiceOrder(updated).catch(console.error);
                        setSelectedOrder(updated);
                      } else {
                        setSelectedOrder(order);
                      }
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
                          #{order.id}
                        </span>
                        {order.periodicity && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                            {order.periodicity}
                          </span>
                        )}
                      </div>
                      {getStatusBadge(order.status)}
                    </div>

                    {/* Title */}
                    <h3 className="text-sm font-bold leading-tight mb-1 text-slate-900 dark:text-white">
                      {order.title}
                    </h3>

                    {/* Asset details */}
                    <div className="space-y-1 mb-3">
                      <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 font-medium">
                        <Wrench className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">{order.assetName || 'Equipamento'}</span>
                        {order.assetCode && (
                          <span className="text-[11px] font-mono text-slate-400 font-semibold">
                            ({order.assetCode})
                          </span>
                        )}
                      </div>

                      {order.scheduledDate && (
                        <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                          <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>Previsão: {order.scheduledDate}</span>
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

              {/* Action Box: Either Active Preventive or Open Corrective */}
              {scannedMatchingOrder ? (
                <div className="p-4 rounded-2xl border border-indigo-200 dark:border-indigo-900/60 bg-gradient-to-br from-indigo-50/80 to-blue-50/50 dark:from-indigo-950/40 dark:to-blue-950/20 space-y-3">
                  <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-300 text-xs font-black uppercase tracking-wider">
                    <Clock className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <span>Preventiva Programada Identificada</span>
                  </div>

                  <div>
                    <h4 className="text-sm font-extrabold text-slate-900 dark:text-white leading-tight">
                      OS #{scannedMatchingOrder.id} • {scannedMatchingOrder.title}
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
                    className="w-full min-h-[50px] py-3.5 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 active:scale-98 transition-all cursor-pointer"
                  >
                    <Play className="w-4.5 h-4.5 fill-current" />
                    <span>Iniciar Execução da Preventiva</span>
                  </button>
                </div>
              ) : (
                <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 space-y-3">
                  <div className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                    <p className="leading-relaxed">
                      Este equipamento está em dia. Não há preventiva programada aguardando execução para ele no momento.
                    </p>
                  </div>

                  <button
                    onClick={() => setIsCorrectiveModalOpen(true)}
                    className="w-full min-h-[50px] py-3.5 px-4 rounded-xl bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-700 hover:to-amber-700 text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg shadow-rose-600/20 active:scale-98 transition-all cursor-pointer"
                  >
                    <AlertTriangle className="w-4.5 h-4.5" />
                    <span>Abrir Chamado Corretivo Imediato</span>
                  </button>
                </div>
              )}

              {/* Scan another button */}
              <button
                onClick={() => {
                  setScannedAsset(null);
                  setScannedMatchingOrder(null);
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
                    {userProfile.perfil}
                  </span>
                  {userProfile.gerencia && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 truncate">
                      {userProfile.gerencia}
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

      {/* ================= BOTTOM NAVIGATION BAR ================= */}
      <nav className={`fixed bottom-0 left-0 right-0 max-w-2xl mx-auto z-40 border-t backdrop-blur-md transition-colors ${
        darkMode ? 'bg-[#0A101D]/95 border-slate-800' : 'bg-white/95 border-slate-200'
      }`}>
        <div className="max-w-md mx-auto px-6 h-18 flex items-center justify-between relative">
          
          {/* 1. Minhas O.S. (Esquerda) */}
          <button
            onClick={() => setActiveTab('orders')}
            className={`flex flex-col items-center gap-1 transition-all ${
              activeTab === 'orders'
                ? 'text-indigo-600 dark:text-indigo-400 font-extrabold scale-105'
                : 'text-slate-500 dark:text-slate-400 font-medium hover:text-slate-700'
            }`}
          >
            <div className="relative">
              <ClipboardList className="w-5.5 h-5.5" />
              {pendingCount > 0 && (
                <span className="absolute -top-1 -right-2 px-1.5 py-0.2 rounded-full text-[9px] font-black bg-rose-500 text-white animate-pulse">
                  {pendingCount}
                </span>
              )}
            </div>
            <span className="text-[10px] tracking-tight">Minhas O.S.</span>
          </button>

          {/* 2. Destaque Central: Ler QR Code (Botão Flutuante) */}
          <div className="relative -top-5">
            <button
              onClick={() => setActiveTab('scanner')}
              className={`w-15 h-15 rounded-2xl flex flex-col items-center justify-center text-white shadow-xl shadow-indigo-600/30 transition-all duration-200 active:scale-95 cursor-pointer ${
                activeTab === 'scanner'
                  ? 'bg-gradient-to-tr from-indigo-700 to-indigo-500 ring-4 ring-indigo-500/20'
                  : 'bg-gradient-to-tr from-indigo-600 to-blue-600 hover:brightness-110'
              }`}
            >
              <QrCode className="w-7 h-7" />
            </button>
            <span className="absolute -bottom-4.5 left-1/2 -translate-x-1/2 text-[9px] font-extrabold tracking-tight text-indigo-600 dark:text-indigo-400 whitespace-nowrap">
              Escanear QR
            </span>
          </div>

          {/* 3. Perfil e Ajustes (Direita) */}
          <button
            onClick={() => setActiveTab('profile')}
            className={`flex flex-col items-center gap-1 transition-all ${
              activeTab === 'profile'
                ? 'text-indigo-600 dark:text-indigo-400 font-extrabold scale-105'
                : 'text-slate-500 dark:text-slate-400 font-medium hover:text-slate-700'
            }`}
          >
            <User className="w-5.5 h-5.5" />
            <span className="text-[10px] tracking-tight">Meu Perfil</span>
          </button>

        </div>
      </nav>

      {/* ================= ORDER EXECUTION & CHECKLIST DRAWER ================= */}
      {selectedOrder && (
        <OrderDetailsDrawer
          isOpen={isOrderDrawerOpen}
          order={selectedOrder}
          onClose={() => {
            setIsOrderDrawerOpen(false);
            setSelectedOrder(null);
          }}
          onReload={onReloadOrders}
          assets={assets}
          templates={templates}
          userProfile={userProfile}
          userHasActionPermission={() => true}
          canRevertUnexecutedOrder={canRevertUnexecutedOrder}
          currentCalendarDate={new Date()}
          onOrderUpdated={(updated) => {
            setSelectedOrder(updated);
            onReloadOrders();
          }}
        />
      )}

      {/* ================= MODAL: QUICK CORRECTIVE TICKET ================= */}
      {scannedAsset && (
        <QuickCorrectiveModal
          isOpen={isCorrectiveModalOpen}
          asset={scannedAsset}
          userProfile={userProfile}
          darkMode={darkMode}
          onClose={() => setIsCorrectiveModalOpen(false)}
          onSuccess={(newOrder) => {
            setIsCorrectiveModalOpen(false);
            onReloadOrders();
            setScannerNotification({
              type: 'success',
              message: `Chamado corretivo #${newOrder.id} registrado com sucesso para ${scannedAsset.name}!`
            });
            setSelectedOrder(newOrder);
            setIsOrderDrawerOpen(true);
            setActiveTab('orders');
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
