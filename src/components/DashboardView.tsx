import { useState, useEffect, useRef } from 'react';
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
import { ServiceOrder, Asset, formatDateBR, HexonUser } from '../types';
import { dbGetAssets, getAssetCycles } from '../db/firebase';
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
  const [loadingAssets, setLoadingAssets] = useState<boolean>(true);
  const [selectedGerencia, setSelectedGerencia] = useState<string>(() => {
    if (userProfile && userProfile.perfil === 'Administrador' && userProfile.gerencia && userProfile.gerencia !== 'Todas') {
      return userProfile.gerencia;
    }
    return 'all';
  });
  const [renderCharts, setRenderCharts] = useState<boolean>(false);

  const [chart1Ref, chart1Size] = useContainerSize(280);
  const [chart2Ref, chart2Size] = useContainerSize(200);

  useEffect(() => {
    setRenderCharts(false);
    const timer = setTimeout(() => {
      setRenderCharts(true);
    }, 200);
    return () => clearTimeout(timer);
  }, [selectedGerencia]);

  useEffect(() => {
    let active = true;
    dbGetAssets().then((data) => {
      if (active) {
        setAssets(data || []);
        setLoadingAssets(false);
      }
    }).catch(err => {
      console.error("Erro ao carregar ativos para dashboard:", err);
      if (active) setLoadingAssets(false);
    });
    return () => {
      active = false;
    };
  }, []);

  // Map operational sector to exact Hexon management profiles (GMMR, GMEE, GMC)
  const getOrderGerencia = (os: ServiceOrder) => {
    const sec = (os.sector || '').toUpperCase();
    if (sec.includes('HVAC') || sec.includes('MEC') || sec.includes('REFR') || sec.includes('AR')) {
      return 'GMMR'; // Mecânica / Refrigeração
    }
    if (sec.includes('ELET') || sec.includes('SUBST') || sec.includes('FORÇA')) {
      return 'GMEE'; // Elétrica / Eletrônica
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

  // Filter orders according to user selection
  const filteredOrders = orders.filter(os => {
    if (selectedGerencia !== 'all') {
      return getOrderGerencia(os) === selectedGerencia;
    }
    return true;
  });

  // Calculate stats metrics
  const totalCount = filteredOrders.length;
  const completedCount = filteredOrders.filter(o => o.status === 'Concluída').length;
  const expiredCount = filteredOrders.filter(o => o.status === 'Não Executada').length;
  const backlogCount = filteredOrders.filter(o => o.status === 'Novo' || o.status === 'Planejada' || o.status === 'Em Execução').length;

  // 1. Eficiência (Executadas ÷ Previstas)
  // Let's count "Previstas" as total service orders in the system that were scheduled
  const efficiencyRate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 100;

  // 2. Eficácia (Executadas dentro do prazo ÷ Executadas)
  // Inside deadline means signedAt (or completed date) <= scheduledDate or endDate. Let's assume on-time if not overdue.
  const completedOnTime = filteredOrders.filter(o => {
    if (o.status !== 'Concluída') return false;
    // Fallback: If no signedAt, we assume on-time as it concluded successfully, or compare timestamps
    if (o.signedAt && o.endDate) {
      return o.signedAt.slice(0, 10) <= o.endDate;
    }
    return true; // default on time
  }).length;

  const efficacyRate = completedCount > 0 ? Math.round((completedOnTime / completedCount) * 100) : 100;

  // 3. Índice por Gerência (GMMR, GMEE, GMC)
  const gerenciaStats = ['GMMR', 'GMEE', 'GMC'].map(g => {
    const ordersG = orders.filter(o => getOrderGerencia(o) === g);
    const totalG = ordersG.length;
    const completedG = ordersG.filter(o => o.status === 'Concluída').length;
    const rateG = totalG > 0 ? Math.round((completedG / totalG) * 100) : 100;
    return { name: g, total: totalG, completed: completedG, rate: rateG };
  });

  // 4. Índice por Periodicidade (Mensal, Semestral, Anual, Semanal)
  const periodicityStats = ['Semanal', 'Mensal', 'Semestral', 'Anual'].map(p => {
    const ordersP = filteredOrders.filter(o => o.periodicity === p || o.title.includes(p));
    const totalP = ordersP.length;
    const completedP = ordersP.filter(o => o.status === 'Concluída').length;
    const rateP = totalP > 0 ? Math.round((completedP / totalP) * 100) : 100;
    return { name: p, total: totalP, completed: completedP, rate: rateP };
  });

  // 5. Evolution over recent months (Simulating real latest 12 months)
  const getMonthlyEvolutionData = () => {
    // Generate dates dynamically representing the last 12 months
    const monthsData: { [key: string]: { total: number; completed: number; expired: number } } = {};
    const monthsList: string[] = [];
    
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const label = d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '');
      monthsData[label] = { total: 0, completed: 0, expired: 0 };
      monthsList.push(label);
    }

    filteredOrders.forEach(o => {
      const date = new Date(o.scheduledDate + 'T12:00:00');
      const label = date.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '');
      if (monthsData[label]) {
        monthsData[label].total++;
        if (o.status === 'Concluída') {
          monthsData[label].completed++;
        } else if (o.status === 'Não Executada') {
          monthsData[label].expired++;
        }
      }
    });

    return monthsList.map(m => ({
      month: m.toUpperCase(),
      Previstas: monthsData[m].total,
      Concluídas: monthsData[m].completed,
      Atrasadas: monthsData[m].expired
    }));
  };

  const evolutionData = getMonthlyEvolutionData();

  // 6. Index by comarca
  const comarcaList = Object.entries(
    filteredOrders.reduce((acc, o) => {
      const c = getOrderComarca(o);
      if (!acc[c]) acc[c] = { total: 0, completed: 0 };
      acc[c].total++;
      if (o.status === 'Concluída') acc[c].completed++;
      return acc;
    }, {} as Record<string, { total: number; completed: number }>)
  ).map(([name, stat]) => ({
    name,
    total: stat.total,
    completed: stat.completed,
    rate: stat.total > 0 ? Math.round((stat.completed / stat.total) * 100) : 100
  })).sort((a, b) => b.total - a.total).slice(0, 10);

  // 7. Index by Technician
  const techList = Object.entries(
    filteredOrders.reduce((acc, o) => {
      const t = o.assignedTechnician || 'Pendente de Atribuição';
      if (!acc[t]) acc[t] = { total: 0, completed: 0 };
      acc[t].total++;
      if (o.status === 'Concluída') acc[t].completed++;
      return acc;
    }, {} as Record<string, { total: number; completed: number }>)
  ).map(([name, stat]) => ({
    name,
    total: stat.total,
    completed: stat.completed,
    rate: stat.total > 0 ? Math.round((stat.completed / stat.total) * 100) : 100
  })).sort((a, b) => b.total - a.total).slice(0, 8);

  // 8. Index by Asset Type
  const assetTypeList = Object.entries(
    filteredOrders.reduce((acc, o) => {
      const type = getAssetType(o);
      if (!acc[type]) acc[type] = { total: 0, completed: 0 };
      acc[type].total++;
      if (o.status === 'Concluída') acc[type].completed++;
      return acc;
    }, {} as Record<string, { total: number; completed: number }>)
  ).map(([name, stat]) => ({
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
      
      const dayOrders = filteredOrders.filter(o => o.scheduledDate === dateStr);
      const count = dayOrders.length;
      const completed = dayOrders.filter(o => o.status === 'Concluída').length;
      
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
            Indicadores gerenciais de eficiência, eficácia e backlog para vistorias e contratos preventivos dos ativos de engenharia.
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
          <div className="relative z-10 mt-4 md:mt-0 bg-white/10 backdrop-blur-md p-1 px-2 rounded-xl border border-white/20 flex items-center gap-2 text-xs">
            <span className="font-extrabold text-slate-200">Filtrar por Gerência:</span>
            <select 
              value={selectedGerencia} 
              onChange={(e) => setSelectedGerencia(e.target.value)}
              className="bg-[#122844] font-black border-none text-white rounded px-2.5 py-1 focus:ring-1 focus:ring-blue-400 text-xs"
            >
              <option value="all">Todas Gerências (Total)</option>
              <option value="GMMR">GMMR (Mecânica e Refrigeração)</option>
              <option value="GMEE">GMEE (Eletricidade e Substações)</option>
              <option value="GMC">GMC (Predial / Civil)</option>
            </select>
          </div>
        )}

        {/* Diagonal Visual Light Accent */}
        <div className="absolute top-0 right-1/4 w-32 h-64 bg-white/5 skew-x-12 pointer-events-none"></div>
      </div>

      {/* THE BENTO METRIC GRID */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            
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
                    <span className="text-[10px] font-extrabold text-slate-500">concluídas</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100">
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Calculado por <strong className="text-slate-700">Concluídas ({completedCount})</strong> sobre o total de <strong className="text-slate-700">Previstas ({totalCount})</strong>.
                </p>
                <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mt-2">
                  <div className="bg-blue-600 h-full rounded-full" style={{ width: `${efficiencyRate}%` }}></div>
                </div>
              </div>
            </div>

            {/* Card 2: EFICÁCIA (No Prazo) */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs relative overflow-hidden group hover:border-emerald-500/40 transition-all flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600">
                    <TrendingUp className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                    SLA Prazo
                  </span>
                </div>
                <div>
                  <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Eficácia</h3>
                  <div className="flex items-baseline gap-1.5 mt-1">
                    <span className="text-3xl font-black text-emerald-600 tracking-tight">{efficacyRate}%</span>
                    <span className="text-[10px] font-extrabold text-slate-500">no prazo</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100">
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Quantidade de intervenções finalizadas <strong className="text-emerald-600 font-extrabold">antes do término do período previsto</strong>.
                </p>
                <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mt-2">
                  <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${efficacyRate}%` }}></div>
                </div>
              </div>
            </div>

            {/* Card 3: BACKLOG */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs relative overflow-hidden group hover:border-amber-500/40 transition-all flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <div className="p-2.5 rounded-xl bg-amber-50 text-amber-600">
                    <Hourglass className="w-5 h-5 animate-spin" style={{ animationDuration: '6s' }} />
                  </div>
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                    backlogCount > 40 ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {backlogCount > 40 ? 'Sobrecarga' : 'Backlog Sob Controle'}
                  </span>
                </div>
                <div>
                  <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Backlog Ativo</h3>
                  <div className="flex items-baseline gap-1.5 mt-1">
                    <span className="text-3xl font-black text-slate-800 tracking-tight">{backlogCount}</span>
                    <span className="text-[10px] font-extrabold text-slate-500">ordens em aberto</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100">
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Preventivas e vistorias pendentes aguardando ou em fase de execução técnica por profissionais.
                </p>
                <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mt-2">
                  <div className="bg-amber-500 h-full rounded-full" style={{ width: `${totalCount > 0 ? (backlogCount/totalCount)*100 : 0}%` }}></div>
                </div>
              </div>
            </div>

            {/* Card 4: NÃO EXECUTADAS */}
            <div className={`rounded-2xl p-5 shadow-xs relative overflow-hidden transition-all flex flex-col justify-between ${
              expiredCount > 0
                ? 'bg-rose-50 border border-rose-200 text-rose-900 group hover:border-rose-400'
                : 'bg-white border border-slate-200 text-slate-400 hover:border-slate-300'
            }`}>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <div className={`p-2.5 rounded-xl ${expiredCount > 0 ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-500'}`}>
                    <AlertCircle className="w-5 h-5" />
                  </div>
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                    expiredCount > 0 ? 'bg-rose-200 text-rose-800' : 'bg-slate-100 text-slate-500'
                  }`}>
                    Ciclo Fechado
                  </span>
                </div>
                <div>
                  <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Não Executadas</h3>
                  <div className="flex items-baseline gap-1.5 mt-1">
                    <span className={`text-3xl font-black tracking-tight ${expiredCount > 0 ? 'text-rose-600' : 'text-slate-800'}`}>{expiredCount}</span>
                    <span className="text-[10px] font-extrabold text-slate-500">ciclos falhados</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100">
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Ciclos que viraram de mês/período e foram travados no banco automático como <strong className="text-rose-600">Não Executada</strong>.
                </p>
                <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mt-2">
                  <div className="bg-rose-500 h-full rounded-full" style={{ width: `${totalCount > 0 ? (expiredCount/totalCount)*100 : 0}%` }}></div>
                </div>
              </div>
            </div>

          </section>

          {/* VISUAL CHARTS ROW - MASTER CONTAINER */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Chart 1: Evolução Mensal dos Últimos 12 Meses (Recharts Area/Line) */}
            <div className="lg:col-span-8 bg-white border border-slate-200 p-5 rounded-2xl shadow-xs flex flex-col justify-between min-w-0">
              <div>
                <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-blue-600" />
                  Evolução Mensal (Últimos 12 Meses)
                </h3>
                <p className="text-[11px] text-slate-450">Histórico real de preventivas Geradas, Finalizadas e Não Executadas.</p>
              </div>

              <div ref={chart1Ref} className="h-[280px] w-full mt-6 min-w-0 min-h-0 relative">
                {chart1Size.width > 0 ? (
                  <AreaChart width={chart1Size.width} height={chart1Size.height} data={evolutionData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorPrevistas" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3525cd" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#3525cd" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorConcluidas" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="month" tick={{ fontSize: 9, fontWeight: 700 }} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 9, fontWeight: 700 }} stroke="#94a3b8" />
                    <Tooltip contentStyle={{ fontSize: 11, fontWeight: 700, borderRadius: '8px', border: '1px solid #e2e8f0' }} />
                    <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700, paddingTop: 10 }} />
                    <Area type="monotone" dataKey="Previstas" stroke="#3525cd" strokeWidth={2.5} fillOpacity={1} fill="url(#colorPrevistas)" />
                    <Area type="monotone" dataKey="Concluídas" stroke="#10b981" strokeWidth={2.5} fillOpacity={1} fill="url(#colorConcluidas)" />
                    <Area type="monotone" dataKey="Atrasadas" stroke="#f43f5e" strokeWidth={1.5} dot />
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
            <div className="lg:col-span-4 bg-white border border-slate-200 p-5 rounded-2xl shadow-xs flex flex-col justify-between min-w-0">
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
