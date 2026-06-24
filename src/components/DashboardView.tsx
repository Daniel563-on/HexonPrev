// DashboardView.tsx - Hexon OS Unified Dashboard & Auditing Ledger (Consolidated MPMG Operations Console)
import { useState, useEffect, useRef, useMemo, Fragment, useCallback } from 'react';
import {
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Hourglass,
  Activity,
  ChevronRight,
  Wrench,
  Clock,
  Flag,
  User,
  Building2,
  Calendar,
  AlertCircle,
  Database,
  Layers,
  MapPin,
  TrendingDown,
  CheckCircle,
  Sliders,
  CalendarDays,
  FileSpreadsheet,
  Printer,
  Filter,
  RotateCcw,
  Users,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  Search,
  HelpCircle,
  Briefcase,
  Camera,
  FileText
} from 'lucide-react';
import { ServiceOrder, Asset, formatDateBR, HexonUser, isSectorInGerencia, Management } from '../types';
import { dbGetAssets, dbGetManagements } from '../db/firebase';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar
} from 'recharts';
import * as XLSX from 'xlsx';

// Sizing hook to prevent Recharts layout loops using callback refs to handle dynamic mounting/loading states safely
function useContainerSize(defaultHeight: number) {
  const [size, setSize] = useState({ width: 0, height: defaultHeight });
  const [node, setNode] = useState<HTMLDivElement | null>(null);

  const containerRef = useCallback((newNode: HTMLDivElement | null) => {
    setNode(newNode);
  }, []);

  useEffect(() => {
    if (!node) return;

    // Measure initial width if the element is already rendered
    const initialWidth = node.getBoundingClientRect().width;
    if (initialWidth > 0) {
      setSize({ width: initialWidth, height: defaultHeight });
    }

    const observer = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width } = entries[0].contentRect;
      setSize({ width: Math.max(width, 100), height: defaultHeight });
    });

    observer.observe(node);
    return () => {
      observer.unobserve(node);
    };
  }, [node, defaultHeight]);

  return { containerRef, ...size };
}

interface DashboardViewProps {
  orders: ServiceOrder[];
  onNavigateToOS: (osId?: string) => void;
  onNavigateToAssets: () => void;
  onNovaOS: () => void;
  onNavigateToSolicitations?: () => void;
  userProfile?: HexonUser | null;
}

export default function DashboardView({
  orders,
  onNavigateToOS,
  onNavigateToAssets,
  onNovaOS,
  onNavigateToSolicitations,
  userProfile
}: DashboardViewProps) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [managements, setManagements] = useState<Management[]>([]);
  const [loadingData, setLoadingData] = useState<boolean>(true);

  // Advanced Filters State
  const [datePreset, setDatePreset] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [selectedGerencia, setSelectedGerencia] = useState<string>('Todas');
  const [selectedSector, setSelectedSector] = useState<string>('Todos');
  const [selectedPeriodicity, setSelectedPeriodicity] = useState<string>('Todas');
  const [selectedTechnician, setSelectedTechnician] = useState<string>('Todos');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Table sorting & pagination
  const [sortField, setSortField] = useState<string>('scheduledDate');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 15;

  // Row expansion ledger state
  const [expandedRowIds, setExpandedRowIds] = useState<Set<string>>(new Set());

  // Interactive schedule calendar state
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);

  // Load backend configs from Firebase
  useEffect(() => {
    let active = true;
    Promise.all([dbGetAssets(), dbGetManagements()])
      .then(([assetsData, managementsData]) => {
        if (active) {
          setAssets(assetsData || []);
          setManagements(managementsData || []);
          setLoadingData(false);
        }
      })
      .catch((err) => {
        console.error('Erro ao carregar dados do dashboard consolidado:', err);
        if (active) setLoadingData(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Sync profile defaults
  useEffect(() => {
    if (userProfile?.perfil === 'Administrador' && userProfile.gerencia && userProfile.gerencia !== 'Todas') {
      setSelectedGerencia(userProfile.gerencia);
    }
  }, [userProfile]);

  // Auto-trigger print when opening from a secure tab containing ?print=true
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('print') === 'true') {
        const timer = setTimeout(() => {
          window.focus();
          window.print();
        }, 1500);
        return () => clearTimeout(timer);
      }
    }
  }, []);

  // Set preset dates
  useEffect(() => {
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

    if (datePreset === 'all') {
      setStartDate('');
      setEndDate('');
      setSelectedCalendarDate(null);
    } else if (datePreset === 'this-month') {
      const firstDay = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`;
      setStartDate(firstDay);
      setEndDate(todayStr);
      setSelectedCalendarDate(null);
    } else if (datePreset === 'last-3-months') {
      const past = new Date();
      past.setMonth(today.getMonth() - 3);
      const pastStr = `${past.getFullYear()}-${pad(past.getMonth() + 1)}-01`;
      setStartDate(pastStr);
      setEndDate(todayStr);
      setSelectedCalendarDate(null);
    } else if (datePreset === 'last-6-months') {
      const past = new Date();
      past.setMonth(today.getMonth() - 6);
      const pastStr = `${past.getFullYear()}-${pad(past.getMonth() + 1)}-01`;
      setStartDate(pastStr);
      setEndDate(todayStr);
      setSelectedCalendarDate(null);
    } else if (datePreset === 'this-year') {
      setStartDate(`${today.getFullYear()}-01-01`);
      setEndDate(todayStr);
      setSelectedCalendarDate(null);
    }
    setCurrentPage(1);
  }, [datePreset]);

  // Helper to match gerências robustly by names or codes
  const isGerenciaMatch = (a: string, b: string) => {
    if (!a || !b) return false;
    const clean = (str: string) =>
      str
        .trim()
        .toUpperCase()
        .replace(/[ÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇ]/g, (char) => {
          const map: { [key: string]: string } = {
            Á: 'A',
            À: 'A',
            Â: 'A',
            Ã: 'A',
            É: 'E',
            È: 'E',
            Ê: 'E',
            Í: 'I',
            Ì: 'I',
            Î: 'I',
            Ó: 'O',
            Ò: 'O',
            Ô: 'O',
            Õ: 'O',
            Ú: 'U',
            Ù: 'U',
            Û: 'U',
            Ç: 'C'
          };
          return map[char] || char;
        });

    const ca = clean(a);
    const cb = clean(b);

    if (ca === cb || ca === cb.split(' ')[0] || cb === ca.split(' ')[0]) return true;

    const map: { [key: string]: string[] } = {
      GMMR: ['GMMR', 'REFRIGERACAO', 'MECANICA', 'HVAC'],
      GMEE: ['GMEE', 'ELETRICA', 'SUBESTACOES', 'FORCA', 'ELETRONICA'],
      GMC: ['GMC', 'CIVIL', 'PREDIAL', 'HIDRAULICA', 'GERAL']
    };

    for (const [key, aliases] of Object.entries(map)) {
      const isAInGroup = ca === key || aliases.some((alias) => ca.includes(alias) || alias.includes(ca));
      const isBInGroup = cb === key || aliases.some((alias) => cb.includes(alias) || alias.includes(cb));
      if (isAInGroup && isBInGroup) {
        return true;
      }
    }

    return ca.includes(cb) || cb.includes(ca);
  };

  const getOrderGerencia = (os: ServiceOrder) => {
    const sec = os.sector || '';
    if (isGerenciaMatch('GMMR', sec)) return 'GMMR';
    if (isGerenciaMatch('GMEE', sec)) return 'GMEE';
    if (isGerenciaMatch('GMC', sec)) return 'GMC';

    const upperSec = sec.toUpperCase();
    if (upperSec.includes('HVAC') || upperSec.includes('MEC') || upperSec.includes('REFR') || upperSec.includes('AR')) {
      return 'GMMR';
    }
    if (upperSec.includes('ELET') || upperSec.includes('SUBST') || upperSec.includes('FOR') || upperSec.includes('ELETR')) {
      return 'GMEE';
    }
    return 'GMC';
  };

  const getOrderAuditMetrics = (o: ServiceOrder) => {
    if (o.status !== 'Concluída') {
      return { realizado: false, eficiente: false, eficaz: false };
    }

    const execDate = o.signedAt ? o.signedAt.slice(0, 10) : '';
    if (!execDate) {
      return { realizado: false, eficiente: false, eficaz: false };
    }

    const start = o.startDate || '';
    const end = o.endDate || '';

    const metSuperAdminRange = start && end ? execDate >= start && execDate <= end : true;
    if (!metSuperAdminRange) {
      return { realizado: false, eficiente: false, eficaz: false };
    }

    const realizado = true;
    const eficiente = true;

    const metAdminScheduledDay = o.scheduledDate ? execDate === o.scheduledDate : false;
    const eficaz = metAdminScheduledDay;

    return { realizado, eficiente, eficaz };
  };

  const getEnquadramentoStatus = (o: ServiceOrder) => {
    const end = o.endDate || '';
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const currentDateStr = o.signedAt ? o.signedAt.slice(0, 10) : todayStr;

    if (o.status === 'Concluída') {
      const execDate = o.signedAt ? o.signedAt.slice(0, 10) : '';
      if (!execDate) return 'Não Realizada';

      const start = o.startDate || '';
      const end = o.endDate || '';
      const metSuperAdminRange = start && end ? execDate >= start && execDate <= end : true;

      if (metSuperAdminRange) {
        const metAdminScheduledDay = o.scheduledDate ? execDate === o.scheduledDate : false;
        if (metAdminScheduledDay) {
          return 'Concluída no Prazo';
        } else {
          return 'Concluídas em Atraso';
        }
      } else {
        return 'Não Realizada';
      }
    }

    if (o.status === 'Não Executada') return 'Não Realizada';
    if (end && end < currentDateStr) return 'Não Realizada';
    if (o.status === 'Planejada' || o.status === 'Em Execução') return 'Planejada';
    return 'Nova';
  };

  // Generate dynamic options for Sectors based on current selection
  const sectorOptions = useMemo(() => {
    const sectors = new Set<string>();
    orders.forEach((o) => {
      const matchesGerencia =
        selectedGerencia === 'Todas' || isGerenciaMatch(getOrderGerencia(o), selectedGerencia);
      if (matchesGerencia && o.sector) {
        sectors.add(o.sector);
      }
    });
    return Array.from(sectors).sort();
  }, [orders, selectedGerencia]);

  // Generate unique technician list
  const technicianOptions = useMemo(() => {
    const techs = new Set<string>();
    orders.forEach((o) => {
      if (o.assignedTechnician) techs.add(o.assignedTechnician);
    });
    return Array.from(techs).sort();
  }, [orders]);

  // APPLY FILTERS CONSOLIDATION
  const filteredData = useMemo(() => {
    return orders.filter((o) => {
      // 1. Date range filter
      const itemDate = o.scheduledDate || o.startDate || o.createdAt || '';
      if (startDate && itemDate && itemDate < startDate) return false;
      if (endDate && itemDate && itemDate > endDate) return false;

      // 2. Gerência filter
      if (selectedGerencia !== 'Todas') {
        const itemG = getOrderGerencia(o);
        if (!isGerenciaMatch(itemG, selectedGerencia)) return false;
      }

      // 3. Sector filter
      if (selectedSector !== 'Todos') {
        if (o.sector !== selectedSector) return false;
      }

      // 4. Periodicity filter
      if (selectedPeriodicity !== 'Todas') {
        if (o.periodicity !== selectedPeriodicity) return false;
      }

      // 5. Technician filter
      if (selectedTechnician !== 'Todos') {
        if (o.assignedTechnician !== selectedTechnician) return false;
      }

      // 6. Search query filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesTitle = o.title?.toLowerCase().includes(query);
        const matchesAssetCode = o.assetCode?.toLowerCase().includes(query);
        const matchesAssetName = o.assetName?.toLowerCase().includes(query);
        const matchesTech = o.assignedTechnician?.toLowerCase().includes(query);
        const matchesOSId = o.id?.toLowerCase().includes(query);
        if (!matchesTitle && !matchesAssetCode && !matchesAssetName && !matchesTech && !matchesOSId) {
          return false;
        }
      }

      return true;
    });
  }, [
    orders,
    startDate,
    endDate,
    selectedGerencia,
    selectedSector,
    selectedPeriodicity,
    selectedTechnician,
    searchQuery
  ]);

  // Reset Filters
  const handleResetFilters = () => {
    setDatePreset('all');
    setStartDate('');
    setEndDate('');
    setSelectedGerencia(
      userProfile?.perfil === 'Administrador' && userProfile.gerencia && userProfile.gerencia !== 'Todas'
        ? userProfile.gerencia
        : 'Todas'
    );
    setSelectedSector('Todos');
    setSelectedPeriodicity('Todas');
    setSelectedTechnician('Todos');
    setSearchQuery('');
    setCurrentPage(1);
    setSelectedCalendarDate(null);
  };

  // Stats Breakdown metrics on filteredData
  const metrics = useMemo(() => {
    const total = filteredData.length;
    let completedOnTime = 0;
    let completedLate = 0;
    let uncompleted = 0;
    let planned = 0;
    let totalRealizadas = 0;
    let totalEficazes = 0;

    filteredData.forEach((o) => {
      const enquadramento = getEnquadramentoStatus(o);
      const audit = getOrderAuditMetrics(o);

      if (enquadramento === 'Concluída no Prazo') {
        completedOnTime++;
      } else if (enquadramento === 'Concluídas em Atraso') {
        completedLate++;
      } else if (enquadramento === 'Não Realizada') {
        uncompleted++;
      } else if (enquadramento === 'Planejada' || o.status === 'Em Execução') {
        planned++;
      }

      if (audit.realizado) {
        totalRealizadas++;
      }
      if (audit.eficaz) {
        totalEficazes++;
      }
    });

    const efficiencyRate = total > 0 ? Math.round((totalRealizadas / total) * 100) : 0;
    const efficacyRate = totalRealizadas > 0 ? Math.round((totalEficazes / totalRealizadas) * 100) : 0;

    return {
      total,
      completedOnTime,
      completedLate,
      uncompleted,
      planned,
      totalRealizadas,
      totalEficazes,
      efficiencyRate,
      efficacyRate
    };
  }, [filteredData]);

  // UPCOMING 7 DAYS CALENDAR SLIDER
  const next7Days = useMemo(() => {
    const days: { dateStr: string; label: string; count: number; completed: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const pad = (num: number) => String(num).padStart(2, '0');
      const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const label = d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric' });

      // Count operations on this day from the role-allowed base orders array
      const dayOrders = orders.filter((o) => o.scheduledDate === dateStr);
      const count = dayOrders.length;
      const completed = dayOrders.filter((o) => getOrderAuditMetrics(o).realizado).length;

      days.push({ dateStr, label, count, completed });
    }
    return days;
  }, [orders]);

  // Click handler on upcoming days to filter data directly!
  const handleCalendarDayClick = (dateStr: string) => {
    if (selectedCalendarDate === dateStr) {
      // Toggle off
      setSelectedCalendarDate(null);
      setStartDate('');
      setEndDate('');
    } else {
      // Toggle on
      setSelectedCalendarDate(dateStr);
      setDatePreset('custom');
      setStartDate(dateStr);
      setEndDate(dateStr);
    }
    setCurrentPage(1);
  };

  // PREPARE CHART DATA 1: Monthly Evolution Trend (Efficiency and Efficacy)
  const monthlyTrendData = useMemo(() => {
    const monthsData: {
      [key: string]: { label: string; total: number; realizadas: number; eficazes: number; order: string };
    } = {};
    const monthsKeys: string[] = [];

    // Gather last 12 months in order
    const today = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 15);
      const label = d
        .toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
        .replace('.', '')
        .toUpperCase();
      const sortKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthsData[label] = { label, total: 0, realizadas: 0, eficazes: 0, order: sortKey };
      monthsKeys.push(label);
    }

    filteredData.forEach((o) => {
      const dateStr = o.scheduledDate || o.startDate || o.createdAt || '';
      if (!dateStr || !dateStr.includes('-')) return;

      const date = new Date(dateStr.slice(0, 10) + 'T12:00:00');
      if (isNaN(date.getTime())) return;

      const label = date
        .toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
        .replace('.', '')
        .toUpperCase();

      if (monthsData[label]) {
        monthsData[label].total++;
        const audit = getOrderAuditMetrics(o);
        if (audit.realizado) {
          monthsData[label].realizadas++;
        }
        if (audit.eficaz) {
          monthsData[label].eficazes++;
        }
      }
    });

    return monthsKeys.map((key) => {
      const item = monthsData[key];
      const total = item.total;
      const realizadas = item.realizadas;
      const eficazes = item.eficazes;

      const eficiencia = total > 0 ? Math.round((realizadas / total) * 100) : 0;
      const eficacia = realizadas > 0 ? Math.round((eficazes / realizadas) * 100) : 0;

      return {
        name: item.label,
        'Volume Total': total,
        'Eficiência (%)': eficiencia,
        'Eficácia (%)': eficacia
      };
    });
  }, [filteredData]);

  // PREPARE CHART DATA 2: Status Distribution (Donut Chart)
  const statusDistributionData = useMemo(() => {
    let onTime = 0;
    let late = 0;
    let uncompleted = 0;
    let planned = 0;

    filteredData.forEach((o) => {
      const eq = getEnquadramentoStatus(o);
      if (eq === 'Concluída no Prazo') onTime++;
      else if (eq === 'Concluídas em Atraso') late++;
      else if (eq === 'Não Realizada') uncompleted++;
      else planned++;
    });

    return [
      { name: 'No Prazo', value: onTime, color: '#10b981' },
      { name: 'Em Atraso', value: late, color: '#f59e0b' },
      { name: 'Não Realizadas', value: uncompleted, color: '#f43f5e' },
      { name: 'Planejadas', value: planned, color: '#6366f1' }
    ].filter((item) => item.value > 0);
  }, [filteredData]);

  // PREPARE CHART DATA 3: Management Performance Comparison
  const managementPerformanceData = useMemo(() => {
    const groups = {
      GMMR: { name: 'GMMR (Mecânica)', total: 0, realizadas: 0, eficazes: 0 },
      GMEE: { name: 'GMEE (Elétrica)', total: 0, realizadas: 0, eficazes: 0 },
      GMC: { name: 'GMC (Civil/Geral)', total: 0, realizadas: 0, eficazes: 0 }
    };

    filteredData.forEach((o) => {
      const g = getOrderGerencia(o);
      if (g === 'GMMR' || g === 'GMEE' || g === 'GMC') {
        groups[g].total++;
        const audit = getOrderAuditMetrics(o);
        if (audit.realizado) {
          groups[g].realizadas++;
        }
        if (audit.eficaz) {
          groups[g].eficazes++;
        }
      }
    });

    return Object.values(groups).map((g) => ({
      ...g,
      'Eficiência (%)': g.total > 0 ? Math.round((g.realizadas / g.total) * 100) : 0,
      'Eficácia (%)': g.realizadas > 0 ? Math.round((g.eficazes / g.realizadas) * 100) : 0
    }));
  }, [filteredData]);

  // PREPARE CHART DATA 4: Technical Productivity Performance (Top 8)
  const technicianPerformanceData = useMemo(() => {
    const techMap: { [key: string]: { name: string; total: number; realizadas: number; eficazes: number } } = {};

    filteredData.forEach((o) => {
      const tech = o.assignedTechnician || 'Não Atribuído';
      if (!techMap[tech]) {
        techMap[tech] = { name: tech, total: 0, realizadas: 0, eficazes: 0 };
      }
      techMap[tech].total++;
      const audit = getOrderAuditMetrics(o);
      if (audit.realizado) {
        techMap[tech].realizadas++;
      }
      if (audit.eficaz) {
        techMap[tech].eficazes++;
      }
    });

    return Object.values(techMap)
      .sort((a, b) => b.total - a.total)
      .slice(0, 8)
      .map((t) => ({
        ...t,
        'Eficiência (%)': t.total > 0 ? Math.round((t.realizadas / t.total) * 100) : 0,
        'Eficácia (%)': t.realizadas > 0 ? Math.round((t.eficazes / t.realizadas) * 100) : 0
      }));
  }, [filteredData]);

  // PREPARE CHART DATA 6: Periodicity Performance
  const periodicityPerformanceData = useMemo(() => {
    const periodicityMap: { [key: string]: { name: string; total: number; realizadas: number } } = {};

    filteredData.forEach((o) => {
      const p = o.periodicity || 'Mensal';
      if (!periodicityMap[p]) {
        periodicityMap[p] = { name: p, total: 0, realizadas: 0 };
      }
      periodicityMap[p].total++;
      const audit = getOrderAuditMetrics(o);
      if (audit.realizado) {
        periodicityMap[p].realizadas++;
      }
    });

    return Object.values(periodicityMap)
      .sort((a, b) => b.total - a.total)
      .map((item) => ({
        ...item,
        Volume: item.total,
        'Eficiência (%)': item.total > 0 ? Math.round((item.realizadas / item.total) * 100) : 0
      }));
  }, [filteredData]);

  // PREPARE CHART DATA 7: Sector Workload (Top 6 Sectors)
  const sectorPerformanceData = useMemo(() => {
    const sectorMap: { [key: string]: { name: string; total: number; realizadas: number } } = {};

    filteredData.forEach((o) => {
      const sector = o.sector || 'Geral';
      if (!sectorMap[sector]) {
        sectorMap[sector] = { name: sector, total: 0, realizadas: 0 };
      }
      sectorMap[sector].total++;
      const audit = getOrderAuditMetrics(o);
      if (audit.realizado) {
        sectorMap[sector].realizadas++;
      }
    });

    return Object.values(sectorMap)
      .sort((a, b) => b.total - a.total)
      .slice(0, 6)
      .map((item) => ({
        ...item,
        'Volume OS': item.total,
        'Eficiência (%)': item.total > 0 ? Math.round((item.realizadas / item.total) * 100) : 0
      }));
  }, [filteredData]);

  // NATIVE EXCEL EXPORTER
  const handleExportXLSX = () => {
    if (filteredData.length === 0) {
      alert('Não há dados para exportar com os filtros atuais.');
      return;
    }

    const dataToExport = filteredData.map((o) => {
      const audit = getOrderAuditMetrics(o);
      const enquadramento = getEnquadramentoStatus(o);

      return {
        'Código OS': o.id,
        'Código Ativo': o.assetCode || 'N/A',
        'Nome do Ativo': o.assetName || 'N/A',
        'Setor Operacional': o.sector || 'N/A',
        Gerência: getOrderGerencia(o),
        'Título da Atividade': o.title || 'N/A',
        'Status Atual': o.status,
        Prioridade: o.priority || 'N/A',
        Periodicidade: o.periodicity || 'N/A',
        'Técnico Designado': o.assignedTechnician || 'Não Designado',
        'Início Janela (Super Admin)': o.startDate ? formatDateBR(o.startDate) : 'N/A',
        'Fim Janela (Super Admin)': o.endDate ? formatDateBR(o.endDate) : 'N/A',
        'Dia Agendado (Gerência)': o.scheduledDate ? formatDateBR(o.scheduledDate) : 'N/A',
        'Data Execução / Conclusão': o.signedAt ? formatDateBR(o.signedAt) : 'N/A',
        'Status Enquadramento': enquadramento,
        'Audit - Realizado no Prazo?': audit.realizado ? 'SIM' : 'NÃO',
        'Audit - Eficaz (no dia agendado)?': audit.eficaz ? 'SIM' : 'NÃO',
        'Concluído por': o.signedBy || 'N/A',
        'Total Itens Checklist': o.checklist?.length || 0,
        'Itens Concluídos': o.checklist?.filter((item) => item.checked).length || 0,
        'Notas / Observações': o.notes || ''
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Preventivas Consolidadas');

    // Auto-fit column widths
    const maxColWidths = Object.keys(dataToExport[0] || {}).map((key) => {
      return (
        Math.max(key.length, ...dataToExport.map((row) => String((row as any)[key] || '').length)) + 2
      );
    });
    worksheet['!cols'] = maxColWidths.map((w) => ({ wch: Math.min(Math.max(w, 10), 45) }));

    const timestamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `Relatorio_Consolidado_Hexon_${timestamp}.xlsx`);

    if ((window as any).__onCustomAlert) {
      (window as any).__onCustomAlert('✅ Relatório em Excel exportado com sucesso!');
    }
  };

  // NATIVE WINDOW PRINT / PDF TRICK (High fidelity layouts)
  const handlePrintPDF = () => {
    if (typeof window !== 'undefined') {
      const isIframe = window.self !== window.top;
      if (isIframe) {
        // Build the URL with ?print=true
        const url = new URL(window.location.href);
        url.searchParams.set('print', 'true');
        
        // Show a helpful toast warning before opening the new tab
        if ((window as any).__onCustomAlert) {
          (window as any).__onCustomAlert('⚠️ Abrindo relatório em nova aba para gerar o PDF sem as bordas do editor...');
        }
        
        window.open(url.toString(), '_blank');
      } else {
        window.focus();
        window.print();
      }
    }
  };

  // SORT TABLE COLUMNS
  const requestSort = (field: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortField === field && sortDirection === 'asc') {
      direction = 'desc';
    }
    setSortField(field);
    setSortDirection(direction);
    setCurrentPage(1);
  };

  const sortedData = useMemo(() => {
    const sorted = [...filteredData];
    sorted.sort((a: any, b: any) => {
      let valA = a[sortField];
      let valB = b[sortField];

      // Custom fields overrides
      if (sortField === 'enquadramento') {
        valA = getEnquadramentoStatus(a);
        valB = getEnquadramentoStatus(b);
      } else if (sortField === 'gerencia') {
        valA = getOrderGerencia(a);
        valB = getOrderGerencia(b);
      }

      if (valA === undefined || valA === null) return 1;
      if (valB === undefined || valB === null) return -1;

      if (typeof valA === 'string') {
        return sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      } else {
        return sortDirection === 'asc' ? (valA > valB ? 1 : -1) : (valB > valA ? 1 : -1);
      }
    });
    return sorted;
  }, [filteredData, sortField, sortDirection]);

  // PAGINATION CALCULATIONS
  const totalPages = Math.max(1, Math.ceil(sortedData.length / itemsPerPage));
  const paginatedData = useMemo(() => {
    const startIdx = (currentPage - 1) * itemsPerPage;
    return sortedData.slice(startIdx, startIdx + itemsPerPage);
  }, [sortedData, currentPage]);

  const toggleRowExpansion = (rowId: string) => {
    const next = new Set(expandedRowIds);
    if (next.has(rowId)) {
      next.delete(rowId);
    } else {
      next.add(rowId);
    }
    setExpandedRowIds(next);
  };

  // CHART CONTAINERS HOOKS FOR SIZE STABILIZATION
  const size1 = useContainerSize(260);
  const size2 = useContainerSize(260);
  const size3 = useContainerSize(260);
  const size4 = useContainerSize(260);
  const size6 = useContainerSize(260);
  const size7 = useContainerSize(260);

  if (loadingData) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-slate-500 gap-3">
        <Clock className="w-10 h-10 animate-spin text-blue-500" />
        <span className="text-xs font-black uppercase tracking-wider">Carregando painel consolidado...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 font-sans pb-12">
      {/* 1. TOP TITLE BANNER (Hidden during print) */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-gradient-to-r from-[#0d1e32] to-[#1a365d] p-6 rounded-2xl text-white shadow-md relative overflow-hidden print:hidden">
        <div className="relative z-10 space-y-1">
          <span className="bg-blue-500/30 text-blue-300 font-extrabold text-[9px] uppercase tracking-widest px-2.5 py-1 rounded-full border border-blue-500/20">
            Console Unificado de Controle & Auditoria
          </span>
          <h1 className="text-2xl font-black tracking-tight mt-1 flex items-center gap-2">
            <Activity className="w-6 h-6 text-emerald-400 animate-pulse" />
            Hexon Inteligência & Compliance MPMG
          </h1>
          <p className="text-slate-300 text-xs max-w-2xl leading-relaxed">
            Painel consolidado e integrado de monitoramento em tempo real de preventivas, índices de conformidade operacional, auditorias operacionais e relatórios analíticos para os ativos de engenharia.
          </p>
        </div>

        {/* Global Access Restriction Badge */}
        <div className="relative z-10 mt-4 md:mt-0 bg-white/10 backdrop-blur-md p-2.5 px-3.5 rounded-xl border border-white/20 flex items-center gap-2.5 text-xs">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0"></span>
          <div>
            <p className="font-extrabold text-slate-300 leading-none uppercase tracking-wider text-[9px]">Sistemas Totais</p>
            <p className="font-black text-white text-xs mt-1">
              {userProfile?.perfil || 'Usuário'} • {userProfile?.gerencia || 'Todas as Gerências'}
            </p>
          </div>
        </div>

        <div className="absolute top-0 right-1/4 w-32 h-64 bg-white/5 skew-x-12 pointer-events-none"></div>
      </div>

      {/* 2. PRINT EXCLUSIVE HEADER (ONLY VISIBLE ON PRINT MODES) */}
      <div className="hidden print:flex flex-col gap-3 pb-6 border-b border-slate-300 text-black">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-blue-700 flex items-center justify-center rounded-lg text-white font-black text-xl">H</div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-blue-900 leading-none">HEXON OS</h1>
              <p className="text-[10px] tracking-widest font-bold text-slate-650 mt-1 uppercase">SISTEMA INTEGRADO DE COMPLIANCE OPERACIONAL</p>
            </div>
          </div>
          <div className="text-right text-[11px] text-slate-600">
            <p className="font-bold text-sm">Relatório Consolidado de Preventivas & Auditoria</p>
            <p>Gerado em: {new Date().toLocaleString('pt-BR')}</p>
            <p>Responsável: {userProfile?.name} ({userProfile?.cargo})</p>
          </div>
        </div>
        <div className="bg-slate-100 p-3 rounded-lg border border-slate-300 text-[11px] grid grid-cols-2 md:grid-cols-4 gap-2 leading-tight">
          <p><strong>Filtro de Gerência:</strong> {selectedGerencia}</p>
          <p><strong>Setor:</strong> {selectedSector}</p>
          <p><strong>Período:</strong> {startDate && endDate ? `${formatDateBR(startDate)} a ${formatDateBR(endDate)}` : 'Todas as datas'}</p>
          <p><strong>Volume Amostrado:</strong> {filteredData.length} ordens de serviço</p>
        </div>
      </div>

      {/* 3. DYNAMIC EXCEL & PDF ACTION STRIP (Hidden during print) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-slate-100 dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 print:hidden shadow-xs">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-blue-500" />
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">Ações Rápidas & Exportações</h3>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={onNovaOS}
            className="flex items-center gap-2 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-black uppercase tracking-wider rounded-xl shadow-xs cursor-pointer transition-all active:scale-[0.98]"
            title="Planejar nova preventiva diretamente no banco"
          >
            <Wrench className="w-3.5 h-3.5 shrink-0" />
            <span>Planejar Preventiva</span>
          </button>

          <button
            onClick={onNavigateToAssets}
            className="flex items-center gap-2 px-3.5 py-2 bg-slate-250 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-white text-xs font-black uppercase tracking-wider rounded-xl shadow-xs cursor-pointer transition-all active:scale-[0.98]"
            title="Acessar o módulo de Gestão de Ativos de Engenharia"
          >
            <Database className="w-3.5 h-3.5 shrink-0 text-blue-400" />
            <span>Ver Ativos</span>
          </button>

          <button
            onClick={handleExportXLSX}
            className="flex items-center gap-2 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white text-xs font-black uppercase tracking-wider rounded-xl shadow-xs cursor-pointer transition-all active:scale-[0.98]"
            title="Exportar os dados atuais filtrados em formato Excel (.xlsx)"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
            <span>Planilha Excel</span>
          </button>

          <button
            onClick={handlePrintPDF}
            className="flex items-center gap-2 px-3.5 py-2 bg-slate-700 hover:bg-slate-600 text-white text-xs font-black uppercase tracking-wider rounded-xl shadow-xs cursor-pointer transition-all active:scale-[0.98]"
            title="Imprimir visual moderno ou Salvar como PDF corporativo"
          >
            <Printer className="w-3.5 h-3.5 shrink-0" />
            <span>Imprimir / PDF</span>
          </button>
        </div>
      </div>

      {/* 4. ADVANCED CENTRAL FILTER CONTROL CENTER (Hidden during print) */}
      <div className="bg-white dark:bg-slate-900/30 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs print:hidden space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-800 dark:text-white">
            <Filter className="w-4 h-4 text-blue-500 animate-pulse" />
            <h3 className="text-xs font-black uppercase tracking-wider">Centro de Controle e Filtros Avançados</h3>
          </div>
          <button
            onClick={handleResetFilters}
            className="flex items-center gap-1.5 text-xs font-black text-slate-500 hover:text-slate-800 dark:hover:text-slate-350 transition-colors cursor-pointer uppercase tracking-wider"
            title="Resetar todos os filtros para visualizar a totalidade das ordens"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Limpar Filtros</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Horizon Preset */}
          <div className="space-y-1">
            <label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest block">Período Temporal</label>
            <select
              value={datePreset}
              onChange={(e) => setDatePreset(e.target.value)}
              className="w-full bg-slate-50 dark:bg-[#0b1329] text-slate-800 dark:text-white border border-slate-300 dark:border-slate-800 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none cursor-pointer font-bold"
            >
              <option value="all">Todo o Histórico (Sem data inicial)</option>
              <option value="this-month">Este Mês</option>
              <option value="last-3-months">Últimos 3 Meses</option>
              <option value="last-6-months">Últimos 6 Meses</option>
              <option value="this-year">Ano de Execução Atual (2026)</option>
              <option value="custom">Período Customizado (De / Até)</option>
            </select>
          </div>

          {/* Start Date */}
          <div className="space-y-1">
            <label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest block">Início da Amostragem (De)</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setDatePreset('custom');
                setSelectedCalendarDate(null);
              }}
              className="w-full bg-slate-50 dark:bg-[#0b1329] text-slate-800 dark:text-white border border-slate-300 dark:border-slate-800 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none cursor-pointer"
            />
          </div>

          {/* End Date */}
          <div className="space-y-1">
            <label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest block">Término da Amostragem (Até)</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setDatePreset('custom');
                setSelectedCalendarDate(null);
              }}
              className="w-full bg-slate-50 dark:bg-[#0b1329] text-slate-800 dark:text-white border border-slate-300 dark:border-slate-800 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none cursor-pointer"
            />
          </div>

          {/* Gerência Select Filter */}
          <div className="space-y-1">
            <label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest block">Gerência de Controle</label>
            {userProfile?.perfil === 'Administrador' && userProfile.gerencia && userProfile.gerencia !== 'Todas' ? (
              <div className="w-full bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-xl px-3 py-2 text-xs font-bold leading-normal">
                {userProfile.gerencia} (Fixo)
              </div>
            ) : (
              <select
                value={selectedGerencia}
                onChange={(e) => {
                  setSelectedGerencia(e.target.value);
                  setSelectedSector('Todos');
                }}
                className="w-full bg-slate-50 dark:bg-[#0b1329] text-slate-800 dark:text-white border border-slate-300 dark:border-slate-800 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none cursor-pointer font-bold"
              >
                <option value="Todas">Todas as Gerências</option>
                <option value="GMMR">GMMR - Mecânica/Refrigeração</option>
                <option value="GMEE">GMEE - Elétrica/Eletrônica</option>
                <option value="GMC">GMC - Civil/Predial/Geral</option>
              </select>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
          {/* Sector Select */}
          <div className="space-y-1">
            <label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest block">Setor Operacional</label>
            <select
              value={selectedSector}
              onChange={(e) => setSelectedSector(e.target.value)}
              className="w-full bg-slate-50 dark:bg-[#0b1329] text-slate-800 dark:text-white border border-slate-300 dark:border-slate-800 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none cursor-pointer font-medium"
            >
              <option value="Todos">Todos os Setores ({sectorOptions.length})</option>
              {sectorOptions.map((sec) => (
                <option key={sec} value={sec}>{sec}</option>
              ))}
            </select>
          </div>

          {/* Periodicity Select */}
          <div className="space-y-1">
            <label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest block">Periodicidade</label>
            <select
              value={selectedPeriodicity}
              onChange={(e) => setSelectedPeriodicity(e.target.value)}
              className="w-full bg-slate-50 dark:bg-[#0b1329] text-slate-800 dark:text-white border border-slate-300 dark:border-slate-800 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none cursor-pointer"
            >
              <option value="Todas">Todas Periodicidades</option>
              <option value="Semanal">Semanal</option>
              <option value="Mensal">Mensal</option>
              <option value="Semestral">Semestral</option>
              <option value="Anual">Anual</option>
            </select>
          </div>

          {/* Technician Select */}
          <div className="space-y-1">
            <label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest block">Técnico Atribuído</label>
            <select
              value={selectedTechnician}
              onChange={(e) => setSelectedTechnician(e.target.value)}
              className="w-full bg-slate-50 dark:bg-[#0b1329] text-slate-800 dark:text-white border border-slate-300 dark:border-slate-800 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none cursor-pointer"
            >
              <option value="Todos">Todos os Técnicos ({technicianOptions.length})</option>
              {technicianOptions.map((tech) => (
                <option key={tech} value={tech}>{tech}</option>
              ))}
            </select>
          </div>

          {/* Text Search Field */}
          <div className="space-y-1">
            <label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest block">Busca Textual Geral</label>
            <div className="relative">
              <input
                type="text"
                placeholder="Busque por código, ativo..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-50 dark:bg-[#0b1329] text-slate-800 dark:text-white border border-slate-300 dark:border-slate-800 rounded-xl pl-8 pr-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            </div>
          </div>
        </div>
      </div>

      {/* 5. THE CONSOLIDATED BENTO METRICS GRID */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 print:grid print:grid-cols-3 print:gap-3">
        {/* Metric 1: Total Preventivas */}
        <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm relative overflow-hidden group hover:border-slate-300 dark:hover:border-slate-700 transition-all flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-[#3525cd] dark:text-blue-400">
                <Briefcase className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                OS Filtradas
              </span>
            </div>
            <div>
              <h3 className="text-[11px] font-black text-slate-450 dark:text-slate-400 uppercase tracking-widest">Total Preventivas</h3>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-3xl font-black text-slate-800 dark:text-white tracking-tight">{metrics.total}</span>
                <span className="text-[10px] font-extrabold text-slate-500 dark:text-slate-400">atividades em amostragem</span>
              </div>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/60">
            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
              O volume total de ordens de serviço preventivas sob a jurisdição de comarca e regras aplicadas pelos filtros.
            </p>
          </div>
        </div>

        {/* Metric 2: Taxa de Eficiência */}
        <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm relative overflow-hidden group hover:border-[#3525cd]/40 transition-all flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-[#3525cd] dark:text-blue-400">
                <CheckCircle className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 rounded-full">
                SLA Meta: 90%
              </span>
            </div>
            <div>
              <h3 className="text-[11px] font-black text-slate-450 dark:text-slate-400 uppercase tracking-widest">Taxa de Eficiência</h3>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-3xl font-black text-slate-800 dark:text-white tracking-tight">{metrics.efficiencyRate}%</span>
                <span className="text-[10px] font-extrabold text-slate-500 dark:text-slate-400">concluídas no prazo</span>
              </div>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/60">
            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
              Percentual concluído dentro do range definido pelo Super Admin <strong className="text-blue-500 font-extrabold">({metrics.totalRealizadas})</strong> de preventivas totais.
            </p>
            <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden mt-2">
              <div className="bg-blue-600 h-full rounded-full" style={{ width: `${metrics.efficiencyRate}%` }}></div>
            </div>
          </div>
        </div>

        {/* Metric 3: Taxa de Eficácia */}
        <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm relative overflow-hidden group hover:border-emerald-500/40 transition-all flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
                <TrendingUp className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-black text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 px-2 py-0.5 rounded-full">
                SLA Precisão
              </span>
            </div>
            <div>
              <h3 className="text-[11px] font-black text-slate-450 dark:text-slate-400 uppercase tracking-widest">Taxa de Eficácia</h3>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-3xl font-black text-emerald-600 dark:text-emerald-400 tracking-tight">{metrics.efficacyRate}%</span>
                <span className="text-[10px] font-extrabold text-slate-500 dark:text-slate-400">no dia programado</span>
              </div>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/60">
            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
              Percentual executado no exato dia agendado pela gerência <strong className="text-emerald-500 font-extrabold">({metrics.totalEficazes})</strong> dentre as concluídas dentro do prazo.
            </p>
            <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden mt-2">
              <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${metrics.efficacyRate}%` }}></div>
            </div>
          </div>
        </div>

        {/* Metric 4: Preventivas Pendentes */}
        <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm relative overflow-hidden group hover:border-indigo-500/40 transition-all flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
                <Hourglass className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30 px-2 py-0.5 rounded-full">
                No Cronograma
              </span>
            </div>
            <div>
              <h3 className="text-[11px] font-black text-slate-450 dark:text-slate-400 uppercase tracking-widest">Pendente / Ativa</h3>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-3xl font-black text-slate-800 dark:text-white tracking-tight">{metrics.planned}</span>
                <span className="text-[10px] font-extrabold text-slate-500 dark:text-slate-400">atividades em aberto</span>
              </div>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/60">
            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
              Ordens de serviço planejadas ou ainda novas aguardando a execução pelos técnicos dentro do prazo estimado.
            </p>
            <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden mt-2">
              <div className="bg-indigo-600 h-full rounded-full" style={{ width: `${metrics.total > 0 ? (metrics.planned / metrics.total) * 100 : 0}%` }}></div>
            </div>
          </div>
        </div>

        {/* Metric 5: Concluídas em Atraso */}
        <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm relative overflow-hidden group hover:border-amber-500/40 transition-all flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400">
                <Clock className="w-5 h-5 animate-pulse" />
              </div>
              <span className="text-[10px] font-black text-amber-700 dark:text-amber-450 bg-amber-50 dark:bg-amber-950/30 px-2 py-0.5 rounded-full">
                Concluído Fora
              </span>
            </div>
            <div>
              <h3 className="text-[11px] font-black text-slate-450 dark:text-slate-400 uppercase tracking-widest">Concluídas Fora</h3>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-3xl font-black text-amber-600 dark:text-amber-400 tracking-tight">{metrics.completedLate}</span>
                <span className="text-[10px] font-extrabold text-slate-500 dark:text-slate-400">atividades com atraso</span>
              </div>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/60">
            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
              Serviços preventivos que foram devidamente concluídos, porém após o dia específico estipulado pelo gestor da área.
            </p>
            <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden mt-2">
              <div className="bg-amber-500 h-full rounded-full" style={{ width: `${metrics.total > 0 ? (metrics.completedLate / metrics.total) * 100 : 0}%` }}></div>
            </div>
          </div>
        </div>

        {/* Metric 6: Não Realizadas */}
        <div className={`rounded-2xl p-5 shadow-sm relative overflow-hidden transition-all flex flex-col justify-between ${
          metrics.uncompleted > 0
            ? 'bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900 group hover:border-rose-450 text-rose-950'
            : 'bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 hover:border-slate-350 text-slate-500'
        }`}>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div className={`p-2.5 rounded-xl ${metrics.uncompleted > 0 ? 'bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                <AlertCircle className="w-5 h-5" />
              </div>
              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                metrics.uncompleted > 0 ? 'bg-rose-200 dark:bg-rose-900/60 text-rose-800 dark:text-rose-450' : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
              }`}>
                Não Realizada
              </span>
            </div>
            <div>
              <h3 className="text-[11px] font-black text-slate-450 dark:text-slate-400 uppercase tracking-widest">Não Realizada</h3>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className={`text-3xl font-black tracking-tight ${metrics.uncompleted > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-white'}`}>{metrics.uncompleted}</span>
                <span className="text-[10px] font-extrabold text-slate-500 dark:text-slate-400">atividades sem êxito</span>
              </div>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/60">
            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
              Ordens que ultrapassaram o prazo limitador das datas definidas na janela global do MPMG (Super Admin) sem execução.
            </p>
            <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden mt-2">
              <div className="bg-rose-500 h-full rounded-full" style={{ width: `${metrics.total > 0 ? (metrics.uncompleted / metrics.total) * 100 : 0}%` }}></div>
            </div>
          </div>
        </div>
      </section>

      {/* 6. INTERACTIVE WEEKLY CRONOGRAM SLIDER (Hidden during print) */}
      <section className="bg-white dark:bg-slate-900/30 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm print:hidden">
        <h3 className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
          <CalendarDays className="w-4.5 h-4.5 text-indigo-600" />
          <span>Cronograma e Distribuição de Demanda nos Próximos 7 Dias</span>
        </h3>
        <p className="text-[10.5px] text-slate-500 dark:text-slate-400 mb-4">
          Clique em qualquer dia do calendário para filtrar e auditar as ordens de serviço preventivas especificadas para aquela data.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3.5">
          {next7Days.map((day) => {
            const isSelected = selectedCalendarDate === day.dateStr;
            const occupancyPercent = day.count > 0 ? Math.round((day.completed / day.count) * 100) : 0;
            const isOverloaded = day.count >= 8;

            return (
              <div
                key={day.dateStr}
                onClick={() => handleCalendarDayClick(day.dateStr)}
                className={`p-3.5 rounded-xl border flex flex-col text-center justify-between min-h-[115px] transition-all cursor-pointer hover:scale-[1.02] ${
                  isSelected
                    ? 'ring-2 ring-blue-500 bg-blue-50/50 dark:bg-blue-950/20 border-blue-400 text-blue-950'
                    : isOverloaded
                    ? 'bg-rose-50/70 dark:bg-rose-950/10 border-rose-200 dark:border-rose-900 text-rose-900'
                    : day.count > 0
                    ? 'bg-indigo-50/20 dark:bg-indigo-950/10 border-indigo-100 dark:border-indigo-900'
                    : 'bg-slate-50/50 dark:bg-slate-850/20 border-slate-150 dark:border-slate-800'
                }`}
              >
                <div>
                  <span className="block text-[10.5px] font-black uppercase text-slate-650 dark:text-slate-400">{day.label}</span>
                  <span className="block text-[8.5px] font-mono text-slate-400 mt-0.5">{day.dateStr}</span>
                </div>

                <div className="my-2 flex flex-col items-center">
                  <span className="block text-2xl font-black text-slate-800 dark:text-white leading-none">{day.count}</span>
                  <span className="block text-[8.5px] font-bold text-slate-400 uppercase tracking-wide mt-1">OS Agendada</span>
                </div>

                <div>
                  {day.count > 0 ? (
                    <div className="space-y-1 w-full">
                      <div className="w-full bg-slate-200 dark:bg-slate-700 h-1 rounded-full overflow-hidden">
                        <div className="bg-blue-600 h-full rounded-full" style={{ width: `${occupancyPercent}%` }}></div>
                      </div>
                      <span className="text-[8.5px] font-extrabold text-slate-500 dark:text-slate-450 uppercase block">
                        {day.completed}/{day.count} Feitas
                      </span>
                    </div>
                  ) : (
                    <span className="text-[8.5px] font-black text-slate-350 dark:text-slate-500 uppercase">Livre</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 7. VISUAL ANALYTICS GRID (Charts - Page 1) */}
      <section className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6 print:grid print:grid-cols-3 print:gap-4 print:mb-0">
        {/* Chart 1: Evolução da Eficiência & Eficácia (%) */}
        <div className="bg-white dark:bg-slate-900/40 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col h-[360px] xl:col-span-2 print:col-span-2 print:h-[280px] print:p-4">
          <div className="mb-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-100">Evolução Mensal de Eficiência & Eficácia</h3>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Visão histórica dos últimos 12 meses indicando conformidade no prazo e precisão de dias planejados.</p>
          </div>
          <div ref={size1.containerRef} className="flex-grow w-full min-h-0 print:h-[200px]">
            {monthlyTrendData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-450">Nenhuma informação disponível</div>
            ) : size1.width > 0 ? (
              <ResponsiveContainer width={size1.width} height={size1.height}>
                <AreaChart data={monthlyTrendData} margin={{ top: 5, right: 10, left: -25, bottom: 5 }}>
                  <defs>
                    <linearGradient id="eficienciaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="eficaciaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.12} />
                  <XAxis dataKey="name" stroke="#64748b" fontSize={9.5} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={9.5} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '10px', fontSize: '11px', color: '#fff' }} />
                  <Legend wrapperStyle={{ fontSize: '10px' }} />
                  <Area type="monotone" dataKey="Eficiência (%)" stroke="#3b82f6" strokeWidth={2.5} fillOpacity={1} fill="url(#eficienciaGrad)" />
                  <Area type="monotone" dataKey="Eficácia (%)" stroke="#10b981" strokeWidth={2.5} fillOpacity={1} fill="url(#eficaciaGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-450">Renderizando...</div>
            )}
          </div>
        </div>

        {/* Chart 2: Status Distribution Pie */}
        <div className="bg-white dark:bg-slate-900/40 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col h-[360px] print:col-span-1 print:h-[280px] print:p-4">
          <div className="mb-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-100">Distribuição por Status de Enquadramento</h3>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Visão proporcional das preventivas conforme prazo do Super Admin.</p>
          </div>
          <div ref={size2.containerRef} className="flex-grow w-full min-h-0 relative flex items-center justify-center print:h-[200px]">
            {statusDistributionData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-450">Nenhuma informação disponível</div>
            ) : size2.width > 0 ? (
              <ResponsiveContainer width={size2.width} height={size2.height}>
                <PieChart>
                  <Pie
                    data={statusDistributionData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {statusDistributionData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value: any, name: any) => {
                      const total = statusDistributionData.reduce((sum, item) => sum + item.value, 0);
                      const percentage = total > 0 ? Math.round((Number(value) / total) * 100) : 0;
                      return [`${value} OS (${percentage}%)`, name];
                    }} 
                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '10px', fontSize: '11px', color: '#fff' }} 
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-450">Renderizando...</div>
            )}
          </div>
        </div>
      </section>

      {/* Page break after Page 1 content */}
      <div className="print-page-break" />

      {/* 7.2. VISUAL ANALYTICS GRID (Charts - Page 2) */}
      <section className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6 print:grid print:grid-cols-3 print:gap-4 print:space-y-0">
        {/* Chart 3: Performance por Gerência (%) */}
        <div className="bg-white dark:bg-slate-900/40 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col h-[360px] print:col-span-1 print:h-[280px] print:p-4">
          <div className="mb-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-100">Performance por Gerência</h3>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Comparativo de Eficiência (SLA) e Eficácia (dia agendado) por núcleo.</p>
          </div>
          <div ref={size3.containerRef} className="flex-grow w-full min-h-0 print:h-[200px]">
            {managementPerformanceData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-450">Nenhuma informação disponível</div>
            ) : size3.width > 0 ? (
              <ResponsiveContainer width={size3.width} height={size3.height}>
                <BarChart data={managementPerformanceData} margin={{ top: 5, right: 10, left: -25, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.12} />
                  <XAxis dataKey="name" stroke="#64748b" fontSize={9.5} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={9.5} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '10px', fontSize: '11px', color: '#fff' }} />
                  <Legend wrapperStyle={{ fontSize: '10px' }} />
                  <Bar dataKey="Eficiência (%)" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={20} />
                  <Bar dataKey="Eficácia (%)" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={20} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-450">Renderizando...</div>
            )}
          </div>
        </div>

        {/* Chart 4: Produtividade por Técnico (Top 8) */}
        <div className="bg-white dark:bg-slate-900/40 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col h-[360px] xl:col-span-2 print:col-span-2 print:h-[280px] print:p-4">
          <div className="mb-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-100">Top 8 Técnicos em Produtividade</h3>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Indicador de quantidade de preventivas executadas dentro do prazo e SLA de cada colaborador.</p>
          </div>
          <div ref={size4.containerRef} className="flex-grow w-full min-h-0 print:h-[200px]">
            {technicianPerformanceData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-450">Nenhuma informação disponível</div>
            ) : size4.width > 0 ? (
              <ResponsiveContainer width={size4.width} height={size4.height}>
                <BarChart data={technicianPerformanceData} margin={{ top: 5, right: 10, left: -25, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.12} />
                  <XAxis dataKey="name" stroke="#64748b" fontSize={8} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={9.5} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '10px', fontSize: '11px', color: '#fff' }} />
                  <Legend wrapperStyle={{ fontSize: '10px' }} />
                  <Bar dataKey="total" name="Total Atribuídas" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={15} />
                  <Bar dataKey="realizadas" name="Realizadas no Prazo" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={15} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-450">Renderizando...</div>
            )}
          </div>
        </div>

        {/* Chart 6: Performance por Periodicidade */}
        <div className="bg-white dark:bg-slate-900/40 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col h-[360px] print:col-span-1 print:h-[280px] print:p-4">
          <div className="mb-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-100">Performance por Periodicidade</h3>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Percentual de eficiência em relação à periodicidade das intervenções programadas.</p>
          </div>
          <div ref={size6.containerRef} className="flex-grow w-full min-h-0 print:h-[200px]">
            {periodicityPerformanceData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-450">Nenhuma informação disponível</div>
            ) : size6.width > 0 ? (
              <ResponsiveContainer width={size6.width} height={size6.height}>
                <BarChart data={periodicityPerformanceData} margin={{ top: 5, right: 10, left: -25, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.12} />
                  <XAxis dataKey="name" stroke="#64748b" fontSize={9.5} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={9.5} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '10px', fontSize: '11px', color: '#fff' }} />
                  <Legend wrapperStyle={{ fontSize: '10px' }} />
                  <Bar dataKey="Volume" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={25} />
                  <Bar dataKey="Eficiência (%)" fill="#06b6d4" radius={[4, 4, 0, 0]} maxBarSize={25} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-450">Renderizando...</div>
            )}
          </div>
        </div>

        {/* Chart 7: Top 6 Setores Operacionais em Volume */}
        <div className="bg-white dark:bg-slate-900/40 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col h-[360px] xl:col-span-2 print:col-span-2 print:h-[280px] print:p-4">
          <div className="mb-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-100">Top 6 Setores em Demanda de Preventivas</h3>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Os 6 setores que concentram o maior volume de ordens de serviço preventivas e as suas respectivas taxas de eficiência.</p>
          </div>
          <div ref={size7.containerRef} className="flex-grow w-full min-h-0 print:h-[200px]">
            {sectorPerformanceData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-450">Nenhuma informação disponível</div>
            ) : size7.width > 0 ? (
              <ResponsiveContainer width={size7.width} height={size7.height}>
                <BarChart data={sectorPerformanceData} layout="vertical" margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.12} />
                  <XAxis type="number" stroke="#64748b" fontSize={9.5} tickLine={false} />
                  <YAxis type="category" dataKey="name" stroke="#64748b" fontSize={9} tickLine={false} width={130} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '10px', fontSize: '11px', color: '#fff' }} />
                  <Legend wrapperStyle={{ fontSize: '10px' }} />
                  <Bar dataKey="Volume OS" name="Volume Total" fill="#db2777" radius={[0, 4, 4, 0]} maxBarSize={15} />
                  <Bar dataKey="Eficiência (%)" name="Eficiência (%)" fill="#14b8a6" radius={[0, 4, 4, 0]} maxBarSize={15} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-450">Renderizando...</div>
            )}
          </div>
        </div>
      </section>

      {/* Page break after Page 2 content */}
      <div className="print-page-break" />

      {/* 8. AUDITING RECORDS DATA TABLE (Search ledger with expand details) */}
      <div className="bg-white dark:bg-slate-900/40 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wider text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <Database className="w-4 h-4 text-indigo-500" />
              <span>Livro do Registro de Auditoria & Evidências Operacionais</span>
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              Auditoria de assinaturas digitais, checklists de conformidade e evidências fotográficas do horizonte amostrado ({filteredData.length} registros).
            </p>
          </div>
          <div className="text-[10px] text-slate-450 dark:text-slate-400 font-bold bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg shrink-0">
            Página {currentPage} de {totalPages}
          </div>
        </div>

        <div className="overflow-x-auto border border-slate-150 dark:border-slate-800 rounded-xl">
          <table className="w-full text-left border-collapse min-w-[1000px] text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-850 text-slate-500 dark:text-slate-400 font-extrabold uppercase tracking-widest text-[10px] border-b border-slate-200 dark:border-slate-800">
                <th className="py-3 px-4 w-10"></th>
                <th onClick={() => requestSort('id')} className="py-3 px-4 cursor-pointer hover:bg-slate-150/40 transition-colors">Código OS</th>
                <th onClick={() => requestSort('assetCode')} className="py-3 px-4 cursor-pointer hover:bg-slate-150/40 transition-colors">Ativo</th>
                <th onClick={() => requestSort('gerencia')} className="py-3 px-4 cursor-pointer hover:bg-slate-150/40 transition-colors">Gerência</th>
                <th onClick={() => requestSort('periodicity')} className="py-3 px-4 cursor-pointer hover:bg-slate-150/40 transition-colors">Periodicidade</th>
                <th onClick={() => requestSort('assignedTechnician')} className="py-3 px-4 cursor-pointer hover:bg-slate-150/40 transition-colors">Técnico</th>
                <th onClick={() => requestSort('scheduledDate')} className="py-3 px-4 cursor-pointer hover:bg-slate-150/40 transition-colors">Dia Planejado</th>
                <th onClick={() => requestSort('status')} className="py-3 px-4 cursor-pointer hover:bg-slate-150/40 transition-colors">Status</th>
                <th onClick={() => requestSort('enquadramento')} className="py-3 px-4 cursor-pointer hover:bg-slate-150/40 transition-colors">SLA Auditoria</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paginatedData.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-400 font-bold">
                    Nenhum registro de auditoria encontrado para o horizonte de filtragem atual.
                  </td>
                </tr>
              ) : (
                paginatedData.map((o) => {
                  const isExpanded = expandedRowIds.has(o.id);
                  const audit = getOrderAuditMetrics(o);
                  const enquadramento = getEnquadramentoStatus(o);

                  // Priority pill style
                  let statusBadge = '';
                  if (enquadramento === 'Concluída no Prazo') {
                    statusBadge = 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-450 border-emerald-100 dark:border-emerald-800';
                  } else if (enquadramento === 'Concluídas em Atraso') {
                    statusBadge = 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-450 border-amber-100 dark:border-amber-800';
                  } else if (enquadramento === 'Não Realizada') {
                    statusBadge = 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-450 border-rose-100 dark:border-rose-900';
                  } else {
                    statusBadge = 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-450 border-indigo-100 dark:border-indigo-800';
                  }

                  return (
                    <Fragment key={o.id}>
                      <tr className={`hover:bg-slate-50/55 dark:hover:bg-slate-800/20 transition-all ${isExpanded ? 'bg-blue-50/15 dark:bg-blue-950/10' : ''}`}>
                        <td className="py-3.5 px-4 text-center">
                          <button
                            onClick={() => toggleRowExpansion(o.id)}
                            className="p-1 rounded hover:bg-slate-150 dark:hover:bg-slate-800 text-slate-550 cursor-pointer"
                          >
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>
                        </td>
                        <td className="py-3.5 px-4 font-black text-slate-800 dark:text-slate-100">{o.id}</td>
                        <td className="py-3.5 px-4 font-semibold text-slate-650 dark:text-slate-350">{o.assetCode || 'N/A'}</td>
                        <td className="py-3.5 px-4 font-bold text-blue-600 dark:text-blue-400">{getOrderGerencia(o)}</td>
                        <td className="py-3.5 px-4 font-extrabold text-slate-700 dark:text-slate-300">{o.periodicity || 'N/A'}</td>
                        <td className="py-3.5 px-4 font-medium text-slate-600 dark:text-slate-300">{o.assignedTechnician || 'Sem Designação'}</td>
                        <td className="py-3.5 px-4 text-slate-500 dark:text-slate-400 font-mono">{o.scheduledDate ? formatDateBR(o.scheduledDate) : 'N/A'}</td>
                        <td className="py-3.5 px-4 font-mono font-black text-slate-600 dark:text-slate-350">{o.status}</td>
                        <td className="py-3.5 px-4">
                          <span className={`px-2 py-1 rounded-full text-[10px] font-black border uppercase block text-center ${statusBadge}`}>
                            {enquadramento}
                          </span>
                        </td>
                      </tr>

                      {/* Row Expansion Ledger Details (Images, Checklist, Signature) */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={9} className="py-6 px-8 bg-slate-50/60 dark:bg-[#080d1a]/80 border-l-4 border-blue-500 transition-all">
                            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 text-xs text-slate-700 dark:text-slate-300">
                              
                              {/* Column 1: Identificação & Detalhes Operacionais (5 cols) */}
                              <div className="lg:col-span-5 space-y-4">
                                <div>
                                  <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest block mb-1">Identificação & Escopo da Preventiva</span>
                                  <div className="bg-white dark:bg-slate-900/40 p-3.5 rounded-xl border border-slate-200/60 dark:border-slate-800/80 space-y-2.5">
                                    <div>
                                      <h4 className="font-extrabold text-slate-900 dark:text-white text-xs">{o.title}</h4>
                                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">{o.description || 'Sem descrição cadastrada.'}</p>
                                    </div>
                                    
                                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/60 text-[11px]">
                                      <div>
                                        <span className="text-slate-400 dark:text-slate-500 block text-[9.5px] uppercase font-bold">Ativo</span>
                                        <span className="font-bold text-slate-800 dark:text-slate-200 truncate block" title={o.assetName}>
                                          {o.assetName}
                                        </span>
                                        <span className="font-mono text-slate-500 dark:text-slate-400 block text-[10px]">{o.assetCode || 'N/A'}</span>
                                      </div>
                                      <div>
                                        <span className="text-slate-400 dark:text-slate-500 block text-[9.5px] uppercase font-bold">Periodicidade</span>
                                        <span className="font-bold text-slate-850 dark:text-slate-200 block">
                                          {o.periodicity || 'N/A'}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {o.notes && (
                                  <div>
                                    <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest block mb-1">Observações do Técnico (Campo)</span>
                                    <div className="bg-blue-50/30 dark:bg-slate-900/60 p-3.5 rounded-xl border-l-4 border-indigo-500 text-[11px] leading-relaxed font-medium text-slate-750 dark:text-slate-350 italic">
                                      "{o.notes}"
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Column 2: Protocolo de Verificação / Checklist (4 cols) */}
                              <div className="lg:col-span-4 space-y-2">
                                <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Protocolo de Verificação (Checklist)</span>
                                <div className="bg-white dark:bg-slate-900/40 p-3.5 rounded-xl border border-slate-200/60 dark:border-slate-800/80">
                                  {o.checklist && o.checklist.length > 0 ? (
                                    <div className="space-y-2 max-h-56 overflow-y-auto pr-1 scrollbar-thin">
                                      {o.checklist.map((item, index) => (
                                        <div key={index} className="flex items-start gap-2 text-[11px]">
                                          {item.checked ? (
                                            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                                          ) : (
                                            <HelpCircle className="w-4 h-4 text-slate-300 dark:text-slate-700 shrink-0 mt-0.5" />
                                          )}
                                          <div className="space-y-0.5 animate-fade-in">
                                            <span className={`block font-semibold ${item.checked ? 'text-slate-800 dark:text-slate-200' : 'text-slate-400 line-through decoration-slate-200 dark:decoration-slate-800'}`}>
                                              {item.task}
                                            </span>
                                            {item.observations && (
                                              <span className="block text-[9.5px] font-mono text-indigo-500 dark:text-indigo-400 font-bold">
                                                Aferido: {item.observations}
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="text-slate-400 dark:text-slate-500 font-bold italic py-4 text-center">
                                      Sem protocolo de verificação gerado para este modelo.
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Column 3: Assinatura Digital de Conformidade (3 cols) */}
                              <div className="lg:col-span-3 space-y-4">
                                <div>
                                  <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest block mb-1">Assinatura Digital de Conformidade</span>
                                  {o.signature ? (
                                    <div className="bg-white dark:bg-slate-900/40 p-3 rounded-xl border border-slate-200/60 dark:border-slate-800/80 space-y-2">
                                      <div className="bg-slate-50 dark:bg-slate-850 p-2 rounded-lg border border-slate-150 dark:border-slate-800 flex justify-center">
                                        <img
                                          src={o.signature}
                                          alt="Assinatura Digital de Encerramento"
                                          className="h-14 object-contain max-w-[200px]"
                                          referrerPolicy="no-referrer"
                                        />
                                      </div>
                                      <div className="space-y-0.5 text-[10px]">
                                        <span className="text-slate-550 dark:text-slate-400 block font-semibold">
                                          Confirmada por: <strong className="text-slate-800 dark:text-slate-200">{o.signedBy || 'Responsável técnico'}</strong>
                                        </span>
                                        <span className="text-slate-400 dark:text-slate-500 font-mono block text-[9.5px]">
                                          Carimbo temporal: {o.signedAt ? formatDateBR(o.signedAt) + ' ' + (o.signedAt.includes(' ') ? o.signedAt.split(' ')[1] : o.signedAt.slice(11, 16)) : 'N/A'}
                                        </span>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="border border-dashed border-slate-250 dark:border-slate-800 p-4 rounded-xl text-center bg-slate-100/40 dark:bg-slate-900/10">
                                      <FileText className="w-5 h-5 text-slate-400 mx-auto mb-1 opacity-60" />
                                      <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold block">
                                        Pendente de assinatura digital do técnico de campo.
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </div>

                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Dynamic Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-5 print:hidden">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 border border-slate-300 dark:border-slate-750 text-slate-800 dark:text-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed text-xs font-black uppercase transition-all cursor-pointer"
            >
              Anterior
            </button>
            <div className="flex gap-1">
              {Array.from({ length: totalPages }).map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setCurrentPage(idx + 1)}
                  className={`px-3 py-1.5 text-xs font-black rounded-lg cursor-pointer ${
                    currentPage === idx + 1
                      ? 'bg-blue-600 text-white font-black'
                      : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {idx + 1}
                </button>
              ))}
            </div>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 border border-slate-300 dark:border-slate-750 text-slate-800 dark:text-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed text-xs font-black uppercase transition-all cursor-pointer"
            >
              Próximo
            </button>
          </div>
        )}
      </div>

      {/* 9. MASTER CONSOLIDATED FOOTER WITH SYSTEM CREDITS */}
      <footer className="pt-4 border-t border-slate-200 dark:border-slate-850 flex flex-col sm:flex-row justify-between items-center text-[10px] font-bold text-slate-450 dark:text-slate-500 uppercase tracking-wider print:hidden">
        <p>Hexon Preventivas • Console Único de Auditoria & Inteligência</p>
        <p className="mt-1 sm:mt-0">© 2026 MPMG • Banco de dados em nuvem ativo e integrado em tempo real</p>
      </footer>
    </div>
  );
}
