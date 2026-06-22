import { useState, useEffect, useRef, useMemo } from 'react';
import {
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Hourglass,
  Activity,
  History,
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
  CalendarDays
} from 'lucide-react';
import { ServiceOrder, Asset, formatDateBR, HexonUser, isSectorInGerencia, Management } from '../types';
import { dbGetAssets, getAssetCycles, dbGetManagements } from '../db/firebase';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area
} from 'recharts';

function useContainerSize(defaultHeight: number) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: defaultHeight });

  useEffect(() => {
    if (!containerRef.current) return;
    const element = containerRef.current;

    const updateSize = () => {
      if (element.offsetWidth > 0) {
        setSize({
          width: element.offsetWidth,
          height: element.offsetHeight || defaultHeight,
        });
      }
    };

    updateSize();

    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const rect = entries[0].contentRect;
      const w = rect.width || element.offsetWidth;
      const h = rect.height || element.offsetHeight || defaultHeight;
      if (w > 0) {
        setSize({ width: w, height: h });
      }
    });

    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, [defaultHeight]);

  return [containerRef, size] as const;
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
  const [loadingAssets, setLoadingAssets] = useState<boolean>(true);
  const [selectedGerencia, setSelectedGerencia] = useState<string>(() => {
    if (userProfile && (userProfile.perfil === 'Administrador' || userProfile.perfil === 'Profissional') && userProfile.gerencia && userProfile.gerencia !== 'Todas') {
      return userProfile.gerencia;
    }
    return 'all';
  });
  const [renderCharts, setRenderCharts] = useState<boolean>(false);
  const [selectedMonth, setSelectedMonth] = useState<string>('all');

  // Double-security filtered base array for all calculations inside the dashboard
  const secureOrders = useMemo(() => {
    if (!userProfile) return [];
    let base = [...orders];
    if (userProfile.perfil === 'Profissional') {
      base = base.filter(o => 
        o.assignedTechnician === userProfile.name && 
        isSectorInGerencia(o.sector, userProfile.gerencia)
      );
    } else if (userProfile.perfil === 'Administrador' && userProfile.gerencia && userProfile.gerencia !== 'Todas') {
      base = base.filter(o => isSectorInGerencia(o.sector, userProfile.gerencia));
    }
    return base;
  }, [orders, userProfile]);

  const [chart1Ref, chart1Size] = useContainerSize(320);
  const [chart2Ref, chart2Size] = useContainerSize(200);
  const [chart3Ref, chart3Size] = useContainerSize(240);
  const [chart4Ref, chart4Size] = useContainerSize(240);
  const [chart5Ref, chart5Size] = useContainerSize(200);

  useEffect(() => {
    setRenderCharts(false);
    const timer = setTimeout(() => {
      setRenderCharts(true);
    }, 200);
    return () => clearTimeout(timer);
  }, [selectedGerencia, selectedMonth]);

  useEffect(() => {
    let active = true;
    Promise.all([dbGetAssets(), dbGetManagements()]).then(([assetsData, managementsData]) => {
      if (active) {
        setAssets(assetsData || []);
        setManagements(managementsData || []);
        setLoadingAssets(false);
      }
    }).catch(err => {
      console.error("Erro ao carregar dados do dashboard:", err);
      if (active) setLoadingAssets(false);
    });
    return () => {
      active = false;
    };
  }, []);

  // Helper to match gerências robustly by names or codes
  const isGerenciaMatch = (a: string, b: string) => {
    if (!a || !b) return false;
    const clean = (str: string) => str.trim().toUpperCase().replace(/[ÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇ]/g, (char) => {
      const map: { [key: string]: string } = {
        'Á': 'A', 'À': 'A', 'Â': 'A', 'Ã': 'A',
        'É': 'E', 'È': 'E', 'Ê': 'E',
        'Í': 'I', 'Ì': 'I', 'Î': 'I',
        'Ó': 'O', 'Ò': 'O', 'Ô': 'O', 'Õ': 'O',
        'Ú': 'U', 'Ù': 'U', 'Û': 'U',
        'Ç': 'C'
      };
      return map[char] || char;
    });

    const ca = clean(a);
    const cb = clean(b);

    if (ca === cb) return true;

    // Standard pre-defined mappings
    const map: { [key: string]: string[] } = {
      GMMR: ['GMMR', 'REFRIGERACAO', 'MECANICA', 'HVAC'],
      GMEE: ['GMEE', 'ELETRICA', 'SUBESTACOES', 'FORCA', 'ELETRONICA'],
      GMC: ['GMC', 'CIVIL', 'PREDIAL', 'HIDRAULICA', 'GERAL']
    };

    // Check pre-defined lists
    for (const [key, aliases] of Object.entries(map)) {
      const isAInGroup = ca === key || aliases.some(alias => ca.includes(alias) || alias.includes(ca));
      const isBInGroup = cb === key || aliases.some(alias => cb.includes(alias) || alias.includes(cb));
      if (isAInGroup && isBInGroup) {
        return true;
      }
    }

    return ca.includes(cb) || cb.includes(ca);
  };

  // Get localized label from the managements database
  const getGerenciaLabel = (key: 'GMMR' | 'GMEE' | 'GMC') => {
    const list = managements.filter(m => m.name !== 'Todas');
    if (key === 'GMMR') {
      const found = list.find(m => isGerenciaMatch('GMMR', m.name));
      return found ? found.name : 'Refrigeração';
    }
    if (key === 'GMEE') {
      const found = list.find(m => isGerenciaMatch('GMEE', m.name));
      return found ? found.name : 'Elétrica';
    }
    if (key === 'GMC') {
      const found = list.find(m => isGerenciaMatch('GMC', m.name));
      return found ? found.name : 'Civil';
    }
    return key;
  };

  // Map operational sector to exact Hexon management profiles (GMMR, GMEE, GMC)
  const getOrderGerencia = (os: ServiceOrder) => {
    const sec = os.sector || '';
    if (isGerenciaMatch('GMMR', sec)) return 'GMMR';
    if (isGerenciaMatch('GMEE', sec)) return 'GMEE';
    if (isGerenciaMatch('GMC', sec)) return 'GMC';
    
    // In case no matches, double-check string contents to be safe
    const upperSec = sec.toUpperCase();
    if (upperSec.includes('HVAC') || upperSec.includes('MEC') || upperSec.includes('REFR') || upperSec.includes('AR')) {
      return 'GMMR';
    }
    if (upperSec.includes('ELET') || upperSec.includes('SUBST') || upperSec.includes('FOR') || upperSec.includes('ELETR')) {
      return 'GMEE';
    }
    return 'GMC'; // Civil / Hidráulica / Predial / Geral
  };

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
    return 'Geral';
  };

  const getAssetType = (os: ServiceOrder) => {
    if (os.isSurvey) return 'Vistoria Predial';
    if (os.assetId && assets.length > 0) {
      const asset = assets.find(a => a.id === os.assetId);
      if (asset) {
        return asset.specs?.TIPO || asset.specs?.tipo || asset.sector || 'Equipamento';
      }
    }
    return os.sector || 'Geral';
  };

  // Generate options for the month select filter
  const getMonthOptions = () => {
    const list: { value: string; label: string }[] = [];
    const monthNames = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];
    
    // 1. Add latest 12 months dynamically to cover current period
    for (let i = 0; i < 12; i++) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const val = d.toISOString().slice(0, 7); // "YYYY-MM"
      const label = `${monthNames[d.getMonth()]} de ${d.getFullYear()}`;
      if (!list.some(item => item.value === val)) {
        list.push({ value: val, label });
      }
    }

    // 2. Add extra months existing in the orders array
    secureOrders.forEach(o => {
      if (o.scheduledDate && o.scheduledDate.length >= 7) {
        const val = o.scheduledDate.slice(0, 7); // "YYYY-MM"
        if (!list.some(item => item.value === val)) {
          const [yr, mnStr] = val.split('-');
          const mnIdx = parseInt(mnStr, 10) - 1;
          const label = `${monthNames[mnIdx] || mnStr} de ${yr}`;
          list.push({ value: val, label });
        }
      }
    });

    // 3. Sort descending (newest months first)
    return list.sort((a, b) => b.value.localeCompare(a.value));
  };

  const monthsOptions = getMonthOptions();

  // Filter orders according to user selection
  const filteredOrders = secureOrders.filter(os => {
    if (selectedGerencia !== 'all' && selectedGerencia !== 'Todas') {
      return isGerenciaMatch(getOrderGerencia(os), selectedGerencia);
    }
    return true;
  });

  // Filter orders by month selection (unfiltered if 'all')
  const filteredByMonthOrders = filteredOrders.filter(os => {
    if (selectedMonth !== 'all') {
      return os.scheduledDate.startsWith(selectedMonth);
    }
    return true;
  });

  // Calculate stats metrics on filteredByMonthOrders
  // Audit engine for service orders in line with Super Admin and Manager dates
  const getOrderAuditMetrics = (o: ServiceOrder) => {
    if (o.status !== 'Concluída') {
      return { realizado: false, eficiente: false, eficaz: false };
    }
    
    // Format is YYYY-MM-DD
    const execDate = o.signedAt ? o.signedAt.slice(0, 10) : '';
    if (!execDate) {
      return { realizado: false, eficiente: false, eficaz: false };
    }

    const start = o.startDate || '';
    const end = o.endDate || '';

    // "se foi feito dentro do prazo do super administrador"
    const metSuperAdminRange = start && end ? (execDate >= start && execDate <= end) : true;

    if (!metSuperAdminRange) {
      // "se não foi realizado no tempo fica como não realizado, automaticamente não foi eficiente e nem eficaz"
      return { realizado: false, eficiente: false, eficaz: false };
    }

    // It is within Super Admin range
    const realizado = true;
    const eficiente = true;

    // "se foi executado dentro do range do super administrado e dentro do dia estipulado pelo administrador da gerência, ele foi realizado, eficiente e eficaz"
    const metAdminScheduledDay = o.scheduledDate ? (execDate === o.scheduledDate) : true;
    const eficaz = metAdminScheduledDay;

    return { realizado, eficiente, eficaz };
  };

  const getEnquadramentoStatus = (o: ServiceOrder) => {
    const currentDateStr = '2026-06-19';
    if (o.status === 'Concluída') {
      const execDate = o.signedAt ? o.signedAt.slice(0, 10) : '';
      if (!execDate) return 'Não Realizada';
      
      const start = o.startDate || '';
      const end = o.endDate || '';
      const metSuperAdminRange = start && end ? (execDate >= start && execDate <= end) : true;
      if (!metSuperAdminRange) return 'Não Realizada';

      const metAdminScheduledDay = o.scheduledDate ? (execDate === o.scheduledDate) : true;
      if (metAdminScheduledDay) return 'Concluída no Prazo';
      return 'Concluídas em Atraso';
    }
    
    if (o.status === 'Não Executada') return 'Não Realizada';
    
    const end = o.endDate || '';
    if (end && end < currentDateStr) return 'Não Realizada';
    
    if (o.status === 'Planejada' || o.status === 'Em Execução') return 'Planejada';
    return 'Nova';
  };

  const totalCount = filteredByMonthOrders.length;
  
  const classifiedList = filteredByMonthOrders.map(o => ({
    o,
    statusEnquadramento: getEnquadramentoStatus(o)
  }));

  const novaCount = classifiedList.filter(item => item.statusEnquadramento === 'Nova').length;
  const planejadaCount = classifiedList.filter(item => item.statusEnquadramento === 'Planejada').length;
  const concluidaNoPrazoCount = classifiedList.filter(item => item.statusEnquadramento === 'Concluída no Prazo').length;
  const concluidaEmAtrasoCount = classifiedList.filter(item => item.statusEnquadramento === 'Concluídas em Atraso').length;
  const naoRealizadaCount = classifiedList.filter(item => item.statusEnquadramento === 'Não Realizada').length;

  const realizadoCount = concluidaNoPrazoCount + concluidaEmAtrasoCount;
  const eficazCount = concluidaNoPrazoCount;

  // 1. Eficiência Rate (Realizadas/Eficientes ÷ Previstas)
  const efficiencyRate = totalCount > 0 ? Math.round((realizadoCount / totalCount) * 100) : 100;

  // 2. Eficácia Rate (Eficazes ÷ Realizadas)
  const efficacyRate = realizadoCount > 0 ? Math.round((eficazCount / realizadoCount) * 100) : 100;

  // 3. Índice por Gerência (Filtrado pelo mês selecionado, mantendo visível a comparação)
  const isSecurityRestricted = userProfile?.perfil === 'Administrador' || userProfile?.perfil === 'Profissional';
  const myGerencia = userProfile?.gerencia;

  const allowedGerencias = ['GMMR', 'GMEE', 'GMC'].filter(g => {
    // 1. Security profile restriction filter
    if (isSecurityRestricted && myGerencia && myGerencia !== 'Todas') {
      if (!isGerenciaMatch(g, myGerencia)) return false;
    }
    // 2. Interactive dropdown filter (Centro de Controle Gerencial)
    if (selectedGerencia !== 'all' && selectedGerencia !== 'Todas') {
      if (!isGerenciaMatch(g, selectedGerencia)) return false;
    }
    return true;
  });

  const gerenciaStats = allowedGerencias.map(g => {
    const ordersG = secureOrders.filter(o => {
      const matchesGerencia = isGerenciaMatch(getOrderGerencia(o), g);
      const matchesMonth = selectedMonth === 'all' || o.scheduledDate.startsWith(selectedMonth);
      return matchesGerencia && matchesMonth;
    });
    const totalG = ordersG.length;
    // Count realized based on new rules
    const realizedG = ordersG.filter(o => getOrderAuditMetrics(o).realizado).length;
    const rateG = totalG > 0 ? Math.round((realizedG / totalG) * 100) : 100;
    return { name: getGerenciaLabel(g as 'GMMR' | 'GMEE' | 'GMC'), total: totalG, completed: realizedG, rate: rateG };
  });

  const gerenciaEficaciaStats = allowedGerencias.map(g => {
    const ordersG = secureOrders.filter(o => {
      const matchesGerencia = isGerenciaMatch(getOrderGerencia(o), g);
      const matchesMonth = selectedMonth === 'all' || o.scheduledDate.startsWith(selectedMonth);
      return matchesGerencia && matchesMonth;
    });
    const auditedG = ordersG.map(o => getOrderAuditMetrics(o));
    const realizedG = auditedG.filter(m => m.realizado).length;
    const eficazG = auditedG.filter(m => m.eficaz).length;
    const rateG = realizedG > 0 ? Math.round((eficazG / realizedG) * 100) : 100;
    return { name: getGerenciaLabel(g as 'GMMR' | 'GMEE' | 'GMC'), total: realizedG, completed: eficazG, rate: rateG };
  });

  // 4. Índice por Periodicidade (Mensal, Semestral, Anual, Semanal)
  const periodicityStats = ['Semanal', 'Mensal', 'Semestral', 'Anual'].map(p => {
    const ordersP = filteredByMonthOrders.filter(o => o.periodicity === p || o.title.includes(p));
    const totalP = ordersP.length;
    const realizedP = ordersP.filter(o => getOrderAuditMetrics(o).realizado).length;
    const rateP = totalP > 0 ? Math.round((realizedP / totalP) * 100) : 100;
    return { name: p, total: totalP, completed: realizedP, rate: rateP };
  });

  // 5. Evolution over recent months (Unfiltered by selected month to maintain "evolução mensal", but shifted according to chosen month)
  const getMonthlyEvolutionData = () => {
    const monthsData: { [key: string]: { total: number; completedOnTime: number; completedLate: number; uncompleted: number } } = {};
    const monthsList: string[] = [];
    
    let referenceDate = new Date();
    if (selectedMonth !== 'all') {
      const parts = selectedMonth.split('-');
      if (parts.length === 2) {
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        referenceDate = new Date(year, month, 15);
      }
    } else {
      // If 'all', dynamically find the latest date in filteredOrders to expand the sliding window
      let maxDate = new Date();
      filteredOrders.forEach(o => {
        const dateStr = o.scheduledDate || o.startDate || o.createdAt || '';
        if (dateStr && dateStr.includes('-')) {
          const d = new Date(dateStr.slice(0, 10) + 'T12:00:00');
          if (!isNaN(d.getTime()) && d > maxDate) {
            maxDate = d;
          }
        }
      });
      referenceDate = maxDate;
    }

    for (let i = 11; i >= 0; i--) {
      const d = new Date(referenceDate);
      d.setMonth(referenceDate.getMonth() - i);
      const label = d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '');
      monthsData[label] = { total: 0, completedOnTime: 0, completedLate: 0, uncompleted: 0 };
      monthsList.push(label);
    }

    filteredOrders.forEach(o => {
      // Try scheduledDate, fallback to startDate, fallback to createdAt
      const dateStr = o.scheduledDate || o.startDate || o.createdAt || '';
      if (!dateStr || !dateStr.includes('-')) return;

      const date = new Date(dateStr.slice(0, 10) + 'T12:00:00');
      if (isNaN(date.getTime())) return;

      const label = date.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '');
      
      // Look for a match in the keys
      let matchedLabel = monthsList.find(m => m.toLowerCase().trim() === label.toLowerCase().trim());
      
      if (!matchedLabel && monthsList.length > 0) {
        // Clamp outliers gracefully to the boundary of the 12-month sliding window so they are counted
        const firstMonthDate = new Date(referenceDate);
        firstMonthDate.setMonth(referenceDate.getMonth() - 11);
        
        if (date < firstMonthDate) {
          matchedLabel = monthsList[0];
        } else {
          matchedLabel = monthsList[monthsList.length - 1];
        }
      }

      if (matchedLabel && monthsData[matchedLabel]) {
        monthsData[matchedLabel].total++;
        const statusEq = getEnquadramentoStatus(o);
        if (statusEq === 'Concluída no Prazo') {
          monthsData[matchedLabel].completedOnTime++;
        } else if (statusEq === 'Concluídas em Atraso') {
          monthsData[matchedLabel].completedLate++;
        } else {
          monthsData[matchedLabel].uncompleted++;
        }
      }
    });

    return monthsList.map(m => {
      const total = monthsData[m].total;
      if (total === 0) {
        return {
          month: m.toUpperCase(),
          'Total': 0,
          'Concluídas no Prazo': 0,
          'Concluídas em Atraso': 0,
          'Não Realizadas': 0
        };
      }

      let p1 = Math.round((monthsData[m].completedOnTime / total) * 100);
      let p2 = Math.round((monthsData[m].completedLate / total) * 100);
      let p3 = Math.round((monthsData[m].uncompleted / total) * 100);

      const sum = p1 + p2 + p3;
      if (sum !== 100) {
        const diff = 100 - sum;
        const values = [
          { key: 'p1', val: p1, count: monthsData[m].completedOnTime },
          { key: 'p2', val: p2, count: monthsData[m].completedLate },
          { key: 'p3', val: p3, count: monthsData[m].uncompleted }
        ];
        const candidates = values.filter(v => v.count > 0);
        if (candidates.length > 0) {
          candidates.sort((a, b) => b.val - a.val);
          const topKey = candidates[0].key;
          if (topKey === 'p1') p1 += diff;
          else if (topKey === 'p2') p2 += diff;
          else if (topKey === 'p3') p3 += diff;
        }
      }

      return {
        month: m.toUpperCase(),
        'Total': total,
        'Concluídas no Prazo': p1,
        'Concluídas em Atraso': p2,
        'Não Realizadas': p3
      };
    });
  };

  const evolutionData = getMonthlyEvolutionData();

  // 5.b. New Month-by-month overall Efficiency Rate Trend (%) with Gerências (adjusted by temporal selection)
  const getMonthlyEfficiencyData = () => {
    const monthsList: string[] = [];
    const rawData: {
      [month: string]: {
        overall: { total: number; completed: number };
        GMMR: { total: number; completed: number };
        GMEE: { total: number; completed: number };
        GMC: { total: number; completed: number };
      }
    } = {};
    
    let referenceDate = new Date();
    if (selectedMonth !== 'all') {
      const parts = selectedMonth.split('-');
      if (parts.length === 2) {
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        referenceDate = new Date(year, month, 15);
      }
    }

    for (let i = 11; i >= 0; i--) {
      const d = new Date(referenceDate);
      d.setMonth(referenceDate.getMonth() - i);
      const label = d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '');
      monthsList.push(label);
      rawData[label] = {
        overall: { total: 0, completed: 0 },
        GMMR: { total: 0, completed: 0 },
        GMEE: { total: 0, completed: 0 },
        GMC: { total: 0, completed: 0 }
      };
    }

    filteredOrders.forEach(o => {
      const dateStr = o.scheduledDate || o.startDate || o.createdAt || '';
      if (!dateStr || !dateStr.includes('-')) return;

      const date = new Date(dateStr.slice(0, 10) + 'T12:00:00');
      if (isNaN(date.getTime())) return;

      const label = date.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '');
      const g = getOrderGerencia(o);

      let matchedLabel = monthsList.find(m => m.toLowerCase().trim() === label.toLowerCase().trim());

      if (!matchedLabel && monthsList.length > 0) {
        const firstMonthDate = new Date(referenceDate);
        firstMonthDate.setMonth(referenceDate.getMonth() - 11);
        
        if (date < firstMonthDate) {
          matchedLabel = monthsList[0];
        } else {
          matchedLabel = monthsList[monthsList.length - 1];
        }
      }

      if (matchedLabel && rawData[matchedLabel]) {
        const audit = getOrderAuditMetrics(o);
        
        rawData[matchedLabel].overall.total++;
        if (audit.realizado) {
          rawData[matchedLabel].overall.completed++;
        }

        if (rawData[matchedLabel][g as 'GMMR' | 'GMEE' | 'GMC']) {
          rawData[matchedLabel][g as 'GMMR' | 'GMEE' | 'GMC'].total++;
          if (audit.realizado) {
            rawData[matchedLabel][g as 'GMMR' | 'GMEE' | 'GMC'].completed++;
          }
        }
      }
    });

    return monthsList.map(m => {
      const overallTotal = rawData[m].overall.total;
      const overallRate = overallTotal > 0 ? Math.round((rawData[m].overall.completed / overallTotal) * 100) : 100;

      const gmmrTotal = rawData[m].GMMR.total;
      const gmmrRate = gmmrTotal > 0 ? Math.round((rawData[m].GMMR.completed / gmmrTotal) * 100) : 100;

      const gmeeTotal = rawData[m].GMEE.total;
      const gmeeRate = gmeeTotal > 0 ? Math.round((rawData[m].GMEE.completed / gmeeTotal) * 100) : 100;

      const gmcTotal = rawData[m].GMC.total;
      const gmcRate = gmcTotal > 0 ? Math.round((rawData[m].GMC.completed / gmcTotal) * 100) : 100;

      return {
        month: m.toUpperCase(),
        Efficiency: overallRate,
        GMMR: gmmrRate,
        GMEE: gmeeRate,
        GMC: gmcRate
      };
    });
  };

  const monthlyEfficiencyData = getMonthlyEfficiencyData();

  // 5.c. New monthly efficacy trend by Gerência month-by-month (Eficácia Mês a Mês, adjusted by selection)
  const getGerenciaMonthlyEfficacyData = () => {
    const monthsList: string[] = [];
    const rawData: { 
      [month: string]: { 
        [gerencia: string]: { realized: number; eficaz: number } 
      } 
    } = {};

    let referenceDate = new Date();
    if (selectedMonth !== 'all') {
      const parts = selectedMonth.split('-');
      if (parts.length === 2) {
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        referenceDate = new Date(year, month, 15);
      }
    }

    for (let i = 11; i >= 0; i--) {
      const d = new Date(referenceDate);
      d.setMonth(referenceDate.getMonth() - i);
      const label = d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '');
      monthsList.push(label);
      rawData[label] = {
        GMMR: { realized: 0, eficaz: 0 },
        GMEE: { realized: 0, eficaz: 0 },
        GMC: { realized: 0, eficaz: 0 }
      };
    }

    filteredOrders.forEach(o => {
      const dateStr = o.scheduledDate || o.startDate || o.createdAt || '';
      if (!dateStr || !dateStr.includes('-')) return;

      const date = new Date(dateStr.slice(0, 10) + 'T12:00:00');
      if (isNaN(date.getTime())) return;

      const label = date.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '');
      const g = getOrderGerencia(o);

      let matchedLabel = monthsList.find(m => m.toLowerCase().trim() === label.toLowerCase().trim());

      if (!matchedLabel && monthsList.length > 0) {
        const firstMonthDate = new Date(referenceDate);
        firstMonthDate.setMonth(referenceDate.getMonth() - 11);
        
        if (date < firstMonthDate) {
          matchedLabel = monthsList[0];
        } else {
          matchedLabel = monthsList[monthsList.length - 1];
        }
      }

      if (matchedLabel && rawData[matchedLabel] && rawData[matchedLabel][g]) {
        const audit = getOrderAuditMetrics(o);
        if (audit.realizado) {
          rawData[matchedLabel][g].realized++;
        }
        if (audit.eficaz) {
          rawData[matchedLabel][g].eficaz++;
        }
      }
    });

    return monthsList.map(m => {
      const gmmrRealized = rawData[m].GMMR.realized;
      const gmmrRate = gmmrRealized > 0 ? Math.round((rawData[m].GMMR.eficaz / gmmrRealized) * 100) : 100;

      const gmeeRealized = rawData[m].GMEE.realized;
      const gmeeRate = gmeeRealized > 0 ? Math.round((rawData[m].GMEE.eficaz / gmeeRealized) * 100) : 100;

      const gmcRealized = rawData[m].GMC.realized;
      const gmcRate = gmcRealized > 0 ? Math.round((rawData[m].GMC.eficaz / gmcRealized) * 100) : 100;

      return {
        month: m.toUpperCase(),
        GMMR: gmmrRate,
        GMEE: gmeeRate,
        GMC: gmcRate
      };
    });
  };

  const gerenciaMonthlyEfficacyData = getGerenciaMonthlyEfficacyData();

  // 6. Index by comarca
  const comarcaList = Object.entries(
    filteredByMonthOrders.reduce((acc, o) => {
      const c = getOrderComarca(o);
      if (!acc[c]) acc[c] = { total: 0, completed: 0 };
      acc[c].total++;
      if (getOrderAuditMetrics(o).realizado) acc[c].completed++;
      return acc;
    }, {} as Record<string, { total: number; completed: number }>)
  ).map(([name, stat]: [string, any]) => ({
    name,
    total: stat.total,
    completed: stat.completed,
    rate: stat.total > 0 ? Math.round((stat.completed / stat.total) * 100) : 100
  })).sort((a, b) => b.total - a.total).slice(0, 10);

  // 7. Index by Technician
  const techList = Object.entries(
    filteredByMonthOrders.reduce((acc, o) => {
      const t = o.assignedTechnician || 'Pendente de Atribuição';
      if (!acc[t]) acc[t] = { total: 0, completed: 0 };
      acc[t].total++;
      if (getOrderAuditMetrics(o).realizado) acc[t].completed++;
      return acc;
    }, {} as Record<string, { total: number; completed: number }>)
  ).map(([name, stat]: [string, any]) => ({
    name,
    total: stat.total,
    completed: stat.completed,
    rate: stat.total > 0 ? Math.round((stat.completed / stat.total) * 100) : 100
  })).sort((a, b) => b.total - a.total).slice(0, 8);

  // 8. Index by Asset Type
  const assetTypeList = Object.entries(
    filteredByMonthOrders.reduce((acc, o) => {
      const type = getAssetType(o);
      if (!acc[type]) acc[type] = { total: 0, completed: 0 };
      acc[type].total++;
      if (getOrderAuditMetrics(o).realizado) acc[type].completed++;
      return acc;
    }, {} as Record<string, { total: number; completed: number }>)
  ).map(([name, stat]: [string, any]) => ({
    name,
    total: stat.total,
    completed: stat.completed,
    rate: stat.total > 0 ? Math.round((stat.completed / stat.total) * 100) : 100
  })).sort((a, b) => b.total - a.total).slice(0, 8);

  // Build upcoming 7 days smart calendar representation
  const getNext7DaysCalendar = () => {
    const days: { dateStr: string; label: string; count: number; completed: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric' });
      
      const dayOrders = filteredByMonthOrders.filter(o => o.scheduledDate === dateStr);
      const count = dayOrders.length;
      const completed = dayOrders.filter(o => getOrderAuditMetrics(o).realizado).length;
      
      days.push({ dateStr, label, count, completed });
    }
    return days;
  };

  const next7Days = getNext7DaysCalendar();

  return (
    <div className="space-y-6 font-sans text-slate-800 pb-12">
      
      {/* PROFESSIONAL TITLE BAR */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-gradient-to-r from-[#0d1e32] to-[#1a365d] p-6 rounded-2xl text-white shadow-md relative overflow-hidden">
        <div className="relative z-10 space-y-1">
          <span className="bg-blue-500/30 text-blue-300 font-extrabold text-[9px] uppercase tracking-widest px-2.5 py-1 rounded-full border border-blue-500/20">
            Painel Executivo Real-Time
          </span>
          <h1 className="text-2xl font-black tracking-tight mt-1 flex items-center gap-2">
            <Activity className="w-6 h-6 text-emerald-400 animate-pulse" />
            Hexon Ciclo Completo de Manutenção
          </h1>
          <p className="text-slate-300 text-xs max-w-2xl leading-relaxed">
            Indicadores gerenciais de eficiência, eficácia e enquadramento real de preventivas para vistorias e contratos dos ativos de engenharia.
          </p>
        </div>

        {/* Global Filter or Access Restriction Capsule */}
        {userProfile?.perfil === 'Profissional' ? (
          <div className="relative z-10 mt-4 md:mt-0 bg-blue-500/20 backdrop-blur-md p-2.5 px-3.5 rounded-xl border border-blue-500/30 flex items-center gap-2.5 text-xs">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-400 animate-pulse shrink-0"></span>
            <div>
              <p className="font-extrabold text-[#93c5fd] leading-none uppercase tracking-wider text-[9px]">Dashboard Exclusivo</p>
              <p className="font-black text-white text-xs mt-1">{userProfile.name}</p>
            </div>
          </div>
        ) : userProfile?.perfil === 'Administrador' && userProfile.gerencia && userProfile.gerencia !== 'Todas' ? (
          <div className="relative z-10 mt-4 md:mt-0 bg-emerald-500/20 backdrop-blur-md p-2.5 px-3.5 rounded-xl border border-emerald-500/30 flex items-center gap-2.5 text-xs">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0"></span>
            <div>
              <p className="font-extrabold text-[#6ee7b7] leading-none uppercase tracking-wider text-[9px]">Gerência Exclusiva</p>
              <p className="font-black text-white text-xs mt-1">{userProfile.gerencia}</p>
            </div>
          </div>
        ) : (
          <div className="relative z-10 mt-4 md:mt-0 bg-white/10 backdrop-blur-md p-2.5 px-3.5 rounded-xl border border-white/20 flex items-center gap-2.5 text-xs">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-400 animate-pulse shrink-0"></span>
            <div>
              <p className="font-extrabold text-slate-300 leading-none uppercase tracking-wider text-[9px]">Sistemas Totais</p>
              <p className="font-black text-white text-xs mt-1">Super Admin / Gestor</p>
            </div>
          </div>
        )}

        {/* Diagonal Visual Light Accent */}
        <div className="absolute top-0 right-1/4 w-32 h-64 bg-white/5 skew-x-12 pointer-events-none"></div>
      </div>

      {/* FILTER BAR - CONTROL CENTER */}
      <div className="bg-white border border-slate-200 p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-indigo-50 text-indigo-650 rounded-lg shrink-0">
            <CalendarDays className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xs font-black text-slate-800 uppercase tracking-widest leading-none">Centro de Controle Gerencial</h2>
            <p className="text-[10px] text-slate-500 mt-0.5">Selecione o horizonte temporal e a gerência para auditar dados em tempo real.</p>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-3.5">
          {/* Gerência filter (only shown if not restricted in userProfile) */}
          {!(userProfile?.perfil === 'Profissional' || (userProfile?.perfil === 'Administrador' && userProfile.gerencia && userProfile.gerencia !== 'Todas')) && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="font-bold text-slate-550 uppercase tracking-wider text-[10px]">Gerência:</span>
              <select 
                value={selectedGerencia} 
                onChange={(e) => setSelectedGerencia(e.target.value)}
                className="bg-slate-50 hover:bg-slate-100 font-extrabold border border-slate-250 text-slate-800 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-500 text-xs transition-all cursor-pointer outline-none"
              >
                <option value="all">Todas Gerências (Total)</option>
                {managements.filter(m => m.name !== 'Todas').map(m => (
                  <option key={m.id} value={m.name}>{m.name}</option>
                ))}
                {managements.length === 0 && (
                  <>
                    <option value="Refrigeração">Refrigeração</option>
                    <option value="Elétrica">Elétrica</option>
                    <option value="Civil">Civil</option>
                  </>
                )}
              </select>
            </div>
          )}

          {/* Month filter (available for everyone!) */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="font-bold text-slate-550 uppercase tracking-wider text-[10px]">Mês:</span>
            <select 
              value={selectedMonth} 
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="bg-slate-50 hover:bg-slate-100 font-extrabold border border-slate-250 text-slate-800 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500 text-xs transition-all cursor-pointer outline-none md:min-w-[170px]"
            >
              <option value="all">Todos os Meses (Geral)</option>
              {monthsOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* THE BENTO METRIC GRID */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            
            {/* Card 1: EFICIÊNCIA OPERACIONAL */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs relative overflow-hidden group hover:border-[#3525cd]/40 transition-all flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <div className="p-2.5 rounded-xl bg-blue-50 text-[#3525cd]">
                    <CheckCircle className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                    SLA Meta: 90%
                  </span>
                </div>
                <div>
                  <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Eficiência</h3>
                  <div className="flex items-baseline gap-1.5 mt-1">
                    <span className="text-3xl font-black text-slate-800 tracking-tight">{efficiencyRate}%</span>
                    <span className="text-[10px] font-extrabold text-slate-500">concluídas no prazo</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100">
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Ordens <strong className="text-slate-700">realizadas e eficientes ({realizadoCount})</strong> dentro do range de datas estipulado pelo Super Admin sobre o total de <strong className="text-slate-700">previstas ({totalCount})</strong>.
                </p>
                <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mt-2">
                  <div className="bg-blue-600 h-full rounded-full" style={{ width: `${efficiencyRate}%` }}></div>
                </div>
              </div>
            </div>

            {/* Card 2: EFICÁCIA (Dia Programado) */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs relative overflow-hidden group hover:border-emerald-500/40 transition-all flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600">
                    <TrendingUp className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                    SLA Precisão
                  </span>
                </div>
                <div>
                  <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Eficácia</h3>
                  <div className="flex items-baseline gap-1.5 mt-1">
                    <span className="text-3xl font-black text-emerald-600 tracking-tight">{efficacyRate}%</span>
                    <span className="text-[10px] font-extrabold text-slate-500">no dia programado</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100">
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Ordens eficientes executadas <strong className="text-emerald-600 font-extrabold">no exato dia programado ({eficazCount})</strong> pelo gestor da gerência, dentre as concluídas no prazo.
                </p>
                <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mt-2">
                  <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${efficacyRate}%` }}></div>
                </div>
              </div>
            </div>

            {/* Card 3: PREVENTIVAS NOVAS */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs relative overflow-hidden group hover:border-amber-500/40 transition-all flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <div className="p-2.5 rounded-xl bg-amber-50 text-amber-600">
                    <Hourglass className="w-5 h-5 animate-spin" style={{ animationDuration: '6s' }} />
                  </div>
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                     novaCount > 40 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {novaCount > 40 ? 'Demanda Alta' : 'Sob Controle'}
                  </span>
                </div>
                <div>
                  <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Nova</h3>
                  <div className="flex items-baseline gap-1.5 mt-1">
                    <span className="text-3xl font-black text-slate-800 tracking-tight">{novaCount}</span>
                    <span className="text-[10px] font-extrabold text-slate-500">atividades em aberto</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100">
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Preventivas ativas geradas pelo sistema pendentes de conclusão e ainda dentro da janela de range do Super Admin.
                </p>
                <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mt-2">
                  <div className="bg-amber-500 h-full rounded-full" style={{ width: `${totalCount > 0 ? (novaCount/totalCount)*100 : 0}%` }}></div>
                </div>
              </div>
            </div>

            {/* Card 3.5: PREVENTIVAS PLANEJADAS */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs relative overflow-hidden group hover:border-slate-350 transition-all flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600">
                    <Calendar className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                    No Cronograma
                  </span>
                </div>
                <div>
                  <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Planejada</h3>
                  <div className="flex items-baseline gap-1.5 mt-1">
                    <span className="text-3xl font-black text-slate-800 tracking-tight">{planejadaCount}</span>
                    <span className="text-[10px] font-extrabold text-slate-500">alocadas no calendário</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100">
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Total de preventivas já devidamente planejadas e alocadas a um período do calendário de execução pela gestão.
                </p>
                <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mt-2">
                  <div className="bg-indigo-600 h-full rounded-full" style={{ width: `${totalCount > 0 ? (planejadaCount/totalCount)*100 : 0}%` }}></div>
                </div>
              </div>
            </div>

            {/* Card 3.6: PREVENTIVAS CONCLUÍDAS */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs relative overflow-hidden group hover:border-emerald-500/40 transition-all flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                    Concluídas
                  </span>
                </div>
                <div>
                  <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Concluída</h3>
                  <div className="flex items-baseline gap-1.5 mt-1">
                    <span className="text-3xl font-black text-slate-800 tracking-tight">{realizadoCount}</span>
                    <span className="text-[10px] font-extrabold text-slate-500">atividades realizadas</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100">
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Total de preventivas executadas com sucesso, somando as concluídas no prazo e concluídas com atraso.
                </p>
                <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mt-2">
                  <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${totalCount > 0 ? (realizadoCount/totalCount)*100 : 0}%` }}></div>
                </div>
              </div>
            </div>

            {/* Card 4: NÃO REALIZADAS */}
            <div className={`rounded-2xl p-5 shadow-xs relative overflow-hidden transition-all flex flex-col justify-between ${
              naoRealizadaCount > 0
                ? 'bg-rose-50 border border-rose-200 text-rose-900 group hover:border-rose-400'
                : 'bg-white border border-slate-200 text-slate-400 hover:border-slate-300'
            }`}>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <div className={`p-2.5 rounded-xl ${naoRealizadaCount > 0 ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-500'}`}>
                    <AlertCircle className="w-5 h-5" />
                  </div>
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                    naoRealizadaCount > 0 ? 'bg-rose-250 text-rose-800' : 'bg-slate-110 text-slate-500'
                  }`}>
                    Não Eficiente
                  </span>
                </div>
                <div>
                  <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Não Realizada</h3>
                  <div className="flex items-baseline gap-1.5 mt-1">
                    <span className={`text-3xl font-black tracking-tight ${naoRealizadaCount > 0 ? 'text-rose-600' : 'text-slate-850'}`}>{naoRealizadaCount}</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100">
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Preventivas não finalizadas de forma tempestiva, ultrapassando o prazo limitador das datas definidas pelo Super Admin.
                </p>
                <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mt-2">
                  <div className="bg-rose-500 h-full rounded-full" style={{ width: `${totalCount > 0 ? (naoRealizadaCount/totalCount)*100 : 0}%` }}></div>
                </div>
              </div>
            </div>

          </section>

          {/* VISUAL CHARTS ROW - MASTER CONTAINER */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Chart 1: Evolução Mensal dos Últimos 12 Meses (Recharts Area/Line) */}
            <div className="lg:col-span-6 bg-white border border-slate-200 p-5 rounded-2xl shadow-xs flex flex-col justify-between min-w-0">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3 mb-2">
                <div>
                  <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4 text-[#3525cd]" />
                    Evolução Mensal (Últimos 12 Meses)
                  </h3>
                  <p className="text-[11px] text-slate-450 mt-0.5">Visão percentual de eficiência no período para as preventivas.</p>
                </div>
                <div className="bg-indigo-50 border border-indigo-150 rounded-xl px-3.5 py-1.5 flex flex-col items-center justify-center shrink-0 min-w-[100px] shadow-3xs">
                  <span className="text-[8px] font-black text-[#3525cd] uppercase tracking-widest leading-none">TOTAL CRIADAS</span>
                  <span className="text-lg font-black text-slate-900 mt-1 leading-none">{evolutionData.reduce((acc, curr) => acc + (curr['Total'] || 0), 0)}</span>
                </div>
              </div>

              <div ref={chart1Ref} className="h-[320px] w-full mt-4 min-w-0 min-h-0 relative">
                {chart1Size.width > 0 ? (
                  <AreaChart width={chart1Size.width} height={chart1Size.height} data={evolutionData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorConcluidasNoPrazo" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorConcluidasEmAtraso" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.15}/>
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorNaoRealizadas" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.15}/>
                        <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="month" tick={{ fontSize: 9, fontWeight: 700 }} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 9, fontWeight: 700 }} stroke="#94a3b8" />
                    <Tooltip 
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          return (
                            <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-md text-xs font-black text-slate-800 space-y-1.5 min-w-[200px]">
                              <p className="text-[10px] text-slate-400 uppercase tracking-wider">{data.month}</p>
                              <div className="border-b border-slate-100 pb-1.5 mb-1.5 flex justify-between items-center gap-4">
                                <span className="text-slate-500 font-bold">Total Criadas:</span>
                                <span className="text-[#3525cd] font-black">{data.Total}</span>
                              </div>
                              <div className="flex justify-between items-center gap-4">
                                <span className="text-emerald-600 font-bold">Concluídas no Prazo:</span>
                                <span>{data['Concluídas no Prazo']}%</span>
                              </div>
                              <div className="flex justify-between items-center gap-4">
                                <span className="text-amber-500 font-bold">Concluídas em Atraso:</span>
                                <span>{data['Concluídas em Atraso']}%</span>
                              </div>
                              <div className="flex justify-between items-center gap-4">
                                <span className="text-rose-500 font-bold">Não Realizadas:</span>
                                <span>{data['Não Realizadas']}%</span>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 9, fontWeight: 700, paddingTop: 12 }} iconSize={8} iconType="circle" />
                    <Area type="monotone" dataKey="Concluídas no Prazo" stroke="#10b981" strokeWidth={2.5} fillOpacity={1} fill="url(#colorConcluidasNoPrazo)" />
                    <Area type="monotone" dataKey="Concluídas em Atraso" stroke="#f59e0b" strokeWidth={2} fillOpacity={1} fill="url(#colorConcluidasEmAtraso)" />
                    <Area type="monotone" dataKey="Não Realizadas" stroke="#f43f5e" strokeWidth={2} fillOpacity={1} fill="url(#colorNaoRealizadas)" />
                  </AreaChart>
                ) : (
                  <div className="w-full h-full bg-slate-50 border border-slate-100 rounded-xl flex flex-col items-center justify-center p-6 space-y-3 animate-pulse">
                    <svg className="w-8 h-8 text-slate-350 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 3.055A9.003 9.003 0 1020.945 13H11V3.055z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
                    </svg>
                    <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Carregando Histórico Evolutivo...</span>
                  </div>
                )}
              </div>
            </div>

            {/* Chart 2: Índice por Gerência (BMMR vs. BMEE vs. GMC) */}
            <div className="lg:col-span-3 bg-white border border-slate-200 p-5 rounded-2xl shadow-xs flex flex-col justify-between min-w-0">
              <div>
                <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-blue-600" />
                  Métricas de Gerências Hexon
                </h3>
                <p className="text-[11px] text-slate-450">Visibilidade de performance por diretoria operacional.</p>
              </div>

              <div ref={chart2Ref} className="h-[200px] w-full mt-4 min-w-0 min-h-0 relative">
                {chart2Size.width > 0 ? (
                  <BarChart width={chart2Size.width} height={chart2Size.height} data={gerenciaStats} layout="vertical" margin={{ left: -15, right: 10, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 9, fontWeight: 700 }} stroke="#94a3b8" />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fontWeight: 900 }} stroke="#1e293b" />
                    <Tooltip contentStyle={{ fontSize: 11, fontWeight: 700 }} formatter={(v) => [`${v}%`, 'Eficiência']} />
                    <Bar dataKey="rate" radius={[0, 4, 4, 0]}>
                      {gerenciaStats.map((entry, index) => {
                        const colors = ['#3525cd', '#10b981', '#f59e0b'];
                        return <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />;
                      })}
                    </Bar>
                  </BarChart>
                ) : (
                  <div className="w-full h-full bg-slate-50 border border-slate-100 rounded-xl flex flex-col items-center justify-center p-4 space-y-2 animate-pulse">
                    <svg className="w-7 h-7 text-slate-350 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 002 2h2a2 2 0 002-2z" />
                    </svg>
                    <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Calculando Eficiência...</span>
                  </div>
                )}
              </div>

              <div className="border-t border-slate-100 pt-4 space-y-2 mt-4 text-[11px]">
                {gerenciaStats.map((g) => (
                  <div key={g.name} className="flex justify-between items-center">
                    <span className="font-extrabold text-slate-700">{g.name}</span>
                    <span className="font-mono text-slate-500">{g.completed}/{g.total} OS concluídas ({g.rate}%)</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Chart 5: Métricas de Eficácia de Gerência Hexon (concluídas no dia programado) */}
            <div className="lg:col-span-3 bg-white border border-slate-200 p-5 rounded-2xl shadow-xs flex flex-col justify-between min-w-0">
              <div>
                <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <CheckCircle className="w-4 h-4 text-emerald-600" />
                  Eficácia de Gerências
                </h3>
                <p className="text-[11px] text-slate-450">Visibilidade de eficácia (realização no dia exato) por diretoria.</p>
              </div>

              <div ref={chart5Ref} className="h-[200px] w-full mt-4 min-w-0 min-h-0 relative">
                {chart5Size.width > 0 ? (
                  <BarChart width={chart5Size.width} height={chart5Size.height} data={gerenciaEficaciaStats} layout="vertical" margin={{ left: -15, right: 10, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 9, fontWeight: 700 }} stroke="#94a3b8" />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fontWeight: 900 }} stroke="#1e293b" />
                    <Tooltip contentStyle={{ fontSize: 11, fontWeight: 700 }} formatter={(v) => [`${v}%`, 'Eficácia']} />
                    <Bar dataKey="rate" radius={[0, 4, 4, 0]}>
                      {gerenciaEficaciaStats.map((entry, index) => {
                        const colors = ['#10b981', '#3525cd', '#f59e0b'];
                        return <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />;
                      })}
                    </Bar>
                  </BarChart>
                ) : (
                  <div className="w-full h-full bg-slate-50 border border-slate-100 rounded-xl flex flex-col items-center justify-center p-4 space-y-2 animate-pulse">
                    <svg className="w-7 h-7 text-slate-350 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 002 2h2a2 2 0 002-2z" />
                    </svg>
                    <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Calculando Eficácia...</span>
                  </div>
                )}
              </div>

              <div className="border-t border-slate-100 pt-4 space-y-2 mt-4 text-[11px]">
                {gerenciaEficaciaStats.map((g) => (
                  <div key={g.name} className="flex justify-between items-center">
                    <span className="font-extrabold text-slate-700">{g.name}</span>
                    <span className="font-mono text-slate-500">{g.completed}/{g.total} OS eficazes ({g.rate}%)</span>
                  </div>
                ))}
              </div>
            </div>

          </div>

          {/* NEW ROW: Temporal & Departmental Efficiency Analysis */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Chart 3: Eficiência Mês a Mês (%) */}
            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs flex flex-col justify-between min-w-0">
              <div>
                <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-indigo-650" />
                  Taxa de Eficiência Mês a Mês (%)
                </h3>
                <p className="text-[11px] text-slate-450">Evolução percentual de ordens de serviço preventivas concluídas sobre as programadas.</p>
              </div>

              <div ref={chart3Ref} className="h-[240px] w-full mt-6 min-w-0 min-h-0 relative">
                {renderCharts && chart3Size.width > 0 ? (
                  <LineChart width={chart3Size.width} height={chart3Size.height} data={monthlyEfficiencyData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="month" tick={{ fontSize: 9, fontWeight: 700 }} stroke="#94a3b8" />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 9, fontWeight: 700 }} tickFormatter={(v) => `${v}%`} stroke="#94a3b8" />
                    <Tooltip contentStyle={{ fontSize: 11, fontWeight: 700, borderRadius: '8px', border: '1px solid #e2e8f0' }} formatter={(v, name) => [`${v}%`, name]} />
                    <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700, paddingTop: 10 }} />
                    {allowedGerencias.includes('GMMR') && (
                      <Line type="monotone" dataKey="GMMR" name={getGerenciaLabel('GMMR')} stroke="#3525cd" strokeWidth={2} dot={{ r: 3 }} />
                    )}
                    {allowedGerencias.includes('GMEE') && (
                      <Line type="monotone" dataKey="GMEE" name={getGerenciaLabel('GMEE')} stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                    )}
                    {allowedGerencias.includes('GMC') && (
                      <Line type="monotone" dataKey="GMC" name={getGerenciaLabel('GMC')} stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                    )}
                  </LineChart>
                ) : (
                  <div className="w-full h-full bg-slate-50 border border-slate-100 rounded-xl flex flex-col items-center justify-center p-6 space-y-3 animate-pulse">
                    <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Calculando Eficiência Temporal...</span>
                  </div>
                )}
              </div>
            </div>

            {/* Chart 4: Eficácia Histórica por Gerência (%) */}
            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs flex flex-col justify-between min-w-0">
              <div>
                <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-emerald-600" />
                  Evolução de Eficácia por Gerência (%)
                </h3>
                <p className="text-[11px] text-slate-450">Comparativo do andamento de eficácia (realização no exato dia agendado) ciclo a ciclo.</p>
              </div>

              <div ref={chart4Ref} className="h-[240px] w-full mt-6 min-w-0 min-h-0 relative">
                {renderCharts && chart4Size.width > 0 ? (
                  <LineChart width={chart4Size.width} height={chart4Size.height} data={gerenciaMonthlyEfficacyData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="month" tick={{ fontSize: 9, fontWeight: 700 }} stroke="#94a3b8" />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 9, fontWeight: 700 }} tickFormatter={(v) => `${v}%`} stroke="#94a3b8" />
                    <Tooltip contentStyle={{ fontSize: 11, fontWeight: 700, borderRadius: '8px', border: '1px solid #e2e8f0' }} formatter={(v, name) => [`${v}%`, name]} />
                    <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700, paddingTop: 10 }} />
                    {allowedGerencias.includes('GMMR') && (
                      <Line type="monotone" dataKey="GMMR" name={getGerenciaLabel('GMMR')} stroke="#3525cd" strokeWidth={2} dot={{ r: 3 }} />
                    )}
                    {allowedGerencias.includes('GMEE') && (
                      <Line type="monotone" dataKey="GMEE" name={getGerenciaLabel('GMEE')} stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                    )}
                    {allowedGerencias.includes('GMC') && (
                      <Line type="monotone" dataKey="GMC" name={getGerenciaLabel('GMC')} stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                    )}
                  </LineChart>
                ) : (
                  <div className="w-full h-full bg-slate-50 border border-slate-100 rounded-xl flex flex-col items-center justify-center p-6 space-y-3 animate-pulse">
                    <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Carregando Eficácia por Gerência...</span>
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* BRIGADE DETAILS ROW: COMARCAS, TÉCNICOS, ATIVOS & PERIODICIDADE */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            
            {/* List 1: Comarcas */}
            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs">
              <h4 className="text-xs font-black text-[#0b1c30] uppercase tracking-wider mb-4 border-b border-slate-100 pb-2 flex items-center gap-1.5">
                <Building2 className="w-4 h-4 text-blue-600" />
                Índice por Comarca Top 10
              </h4>
              <div className="space-y-3.5 max-h-[300px] overflow-y-auto pr-1">
                {comarcaList.map((c, idx) => (
                  <div key={idx} className="space-y-1">
                    <div className="flex justify-between items-baseline text-[10.5px] font-bold text-slate-700">
                      <span className="truncate max-w-[120px] uppercase font-mono text-[9px] text-indigo-650 bg-indigo-50 px-1 rounded">{c.name}</span>
                      <span className="font-mono text-slate-500 font-extrabold">{c.completed}/{c.total} OS ({c.rate}%)</span>
                    </div>
                    <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden">
                      <div className="bg-[#3525cd] h-full rounded-full" style={{ width: `${c.rate}%` }}></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* List 2: Técnicos */}
            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs">
              <h4 className="text-xs font-black text-[#0b1c30] uppercase tracking-wider mb-4 border-b border-slate-100 pb-2 flex items-center gap-1.5">
                <User className="w-4 h-4 text-blue-600" />
                Eficiência por Técnico
              </h4>
              <div className="space-y-3.5 max-h-[300px] overflow-y-auto pr-1">
                {techList.map((t, idx) => (
                  <div key={idx} className="space-y-1">
                    <div className="flex justify-between items-baseline text-[10.5px] font-bold text-slate-700">
                      <span className="truncate max-w-[140px]" title={t.name}>{t.name}</span>
                      <span className="font-mono text-slate-500 font-extrabold">{t.completed}/{t.total} ({t.rate}%)</span>
                    </div>
                    <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden">
                      <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${t.rate}%` }}></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* List 3: Tipos de Ativo */}
            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs">
              <h4 className="text-xs font-black text-[#0b1c30] uppercase tracking-wider mb-4 border-b border-slate-100 pb-2 flex items-center gap-1.5">
                <Wrench className="w-4 h-4 text-blue-600" />
                Por Tipo de Ativo
              </h4>
              <div className="space-y-3.5 max-h-[300px] overflow-y-auto pr-1">
                {assetTypeList.map((a, idx) => (
                  <div key={idx} className="space-y-1">
                    <div className="flex justify-between items-baseline text-[10.5px] font-bold text-slate-700">
                      <span className="truncate max-w-[130px] font-mono text-[9.5px] text-slate-600">{a.name}</span>
                      <span className="font-mono text-slate-500 font-extrabold">{a.completed}/{a.total} ({a.rate}%)</span>
                    </div>
                    <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden">
                      <div className="bg-amber-500 h-full rounded-full" style={{ width: `${a.rate}%` }}></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* List 4: Periodicidade Indices */}
            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs flex flex-col justify-between">
              <div>
                <h4 className="text-xs font-black text-[#0b1c30] uppercase tracking-wider mb-4 border-b border-slate-100 pb-2 flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-blue-600" />
                  Por Periodicidade
                </h4>
                <div className="space-y-4">
                  {periodicityStats.map((p, idx) => (
                    <div key={idx} className="space-y-1">
                      <div className="flex justify-between items-baseline text-[10px] font-black text-slate-700">
                        <span>{p.name.toUpperCase()}</span>
                        <span className="font-mono text-slate-500">{p.completed}/{p.total} OS ({p.rate}%)</span>
                      </div>
                      <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div className="bg-indigo-650 h-full rounded-full animate-pulse" style={{ width: `${p.rate}%` }}></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Weekly inspections information banner */}
              <div className="bg-blue-50 border border-blue-100 p-3 rounded-lg text-[10px] mt-4 text-blue-700 leading-relaxed font-bold">
                As vistorias semanais sem ativo são controladas automaticamente de forma que semanas falhas gerem pendências imediatas no histórico de comarcas.
              </div>
            </div>

          </div>

          {/* DYNAMIC WEEKLY PREPARATIVE MATRIX */}
          <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
            <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider mb-4 flex items-center gap-1.5">
              <CalendarDays className="w-5 h-5 text-indigo-600" />
              Cronograma Inteligente e Capacidade Próximos 7 Dias
            </h3>
            
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3.5">
              {next7Days.map((day) => {
                const occupancyPercent = day.count > 0 ? Math.round((day.completed / day.count) * 100) : 0;
                const isOverloaded = day.count >= 8;
                return (
                  <div 
                    key={day.dateStr} 
                    className={`p-3.5 rounded-xl border flex flex-col text-center justify-between min-h-[110px] transition-all hover:bg-slate-50 ${
                      isOverloaded 
                        ? 'bg-rose-50 border-rose-200 text-rose-900 shadow-3xs' 
                        : (day.count > 0 ? 'bg-indigo-50/20 border-indigo-100' : 'bg-white border-slate-150')
                    }`}
                  >
                    <div>
                      <span className="block text-[11px] font-black uppercase text-slate-600">{day.label}</span>
                      <span className="block text-[8.5px] font-mono text-slate-400 mt-0.5">{day.dateStr}</span>
                    </div>

                    <div className="my-2.5">
                      <span className="block text-xl font-black text-slate-800">{day.count}</span>
                      <span className="block text-[9px] font-bold text-slate-400">Atividades</span>
                    </div>

                    <div>
                      {day.count > 0 ? (
                        <div className="space-y-1">
                          <div className="w-full bg-slate-200 h-1 rounded-full overflow-hidden">
                            <div className="bg-blue-600 h-full rounded-full" style={{ width: `${occupancyPercent}%` }}></div>
                          </div>
                          <span className="text-[8.5px] font-extrabold text-slate-500 uppercase">{day.completed}/{day.count} Feitas</span>
                        </div>
                      ) : (
                        <span className="text-[8.5px] font-black text-slate-350 uppercase">Sem Carga</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

      {/* FOOTER BAR WITH INTEGRITY GUARANTEE */}
      <footer className="pt-4 border-t border-slate-200/60 flex flex-col sm:flex-row justify-between items-center text-[10px] font-bold text-slate-450 uppercase tracking-wider">
        <p>Hexon Preventivas • Módulo de Inteligência Operacional</p>
        <p className="mt-1 sm:mt-0">© 2026 MPMG • Todas as informações são reais e integradas ao banco</p>
      </footer>
    </div>
  );
}
