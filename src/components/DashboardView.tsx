import { useState, useEffect } from 'react';
import {
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Hourglass,
  FileSpreadsheet,
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
  Database
} from 'lucide-react';
import { ServiceOrder, Asset, formatDateBR } from '../types';
import { dbGetAssets, getDatabaseMode } from '../db/firebase';

interface DashboardViewProps {
  orders: ServiceOrder[];
  onNavigateToOS: (osId?: string) => void;
  onNavigateToAssets: () => void;
  onNovaOS: () => void;
  onNavigateToSolicitations?: () => void;
}

export default function DashboardView({ 
  orders, 
  onNavigateToOS, 
  onNavigateToAssets, 
  onNovaOS,
  onNavigateToSolicitations 
}: DashboardViewProps) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState<boolean>(true);

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

  // Live Count Metrics
  const totalOrdersCount = orders.length;
  const countPlanejadas = orders.filter(o => o.status === 'Planejada').length;
  const countEmExecucao = orders.filter(o => o.status === 'Em Execução').length;
  const countConcluidas = orders.filter(o => o.status === 'Concluída').length;
  const countNaoExecutadas = orders.filter(o => o.status === 'Não Executada').length;

  // Real compliance efficiency calculation
  const executionRate = totalOrdersCount > 0 
    ? Math.round((countConcluidas / totalOrdersCount) * 100) 
    : 100;

  // Grouping preventives by Comarca dynamically (relevante e verdadeiro)
  const comarcaStats = Object.entries(
    orders.reduce((acc, os) => {
      const c = getOrderComarca(os);
      if (!acc[c]) acc[c] = { total: 0, completed: 0 };
      acc[c].total++;
      if (os.status === 'Concluída') acc[c].completed++;
      return acc;
    }, {} as Record<string, { total: number; completed: number }>)
  ).map(([name, stats]) => ({
    name,
    total: stats.total,
    completed: stats.completed,
    rate: stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0,
  })).sort((a, b) => b.total - a.total);

  // Grouping preventives by CRAAI dynamically
  const craaiStats = Object.entries(
    orders.reduce((acc, os) => {
      const c = getOrderCRAAI(os);
      if (!acc[c]) acc[c] = { total: 0, completed: 0 };
      acc[c].total++;
      if (os.status === 'Concluída') acc[c].completed++;
      return acc;
    }, {} as Record<string, { total: number; completed: number }>)
  ).map(([name, stats]) => ({
    name,
    total: stats.total,
    completed: stats.completed,
    rate: stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0,
  })).sort((a, b) => b.total - a.total);

  // Grouping and listing Technician analytics 
  const techStats = Object.entries(
    orders.reduce((acc, os) => {
      const t = os.assignedTechnician || 'Não designado';
      if (!acc[t]) acc[t] = { total: 0, completed: 0 };
      acc[t].total++;
      if (os.status === 'Concluída') acc[t].completed++;
      return acc;
    }, {} as Record<string, { total: number; completed: number }>)
  ).map(([name, stats]) => ({
    name,
    total: stats.total,
    completed: stats.completed,
    rate: stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0,
  })).sort((a, b) => b.total - a.total);

  // Upcoming preventives (next actions)
  const upcomingPreventives = [...orders]
    .filter(o => o.status === 'Planejada' || o.status === 'Em Execução')
    .sort((a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime())
    .slice(0, 5);

  // Critical alerts: Não Executadas (flagged red)
  const criticalAlerts = orders.filter(o => o.status === 'Não Executada');

  return (
    <div className="space-y-6 font-sans">
      {/* Hero Header Section */}
      <section className="bg-white rounded-xl p-6 md:p-7 border border-slate-200 shadow-sm relative overflow-hidden transition-all duration-200 hover:shadow-md flex items-center justify-between">
        <div className="relative z-10 max-w-4xl border-l-4 border-[#3525cd] pl-4 md:pl-5">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3525cd] animate-pulse"></span>
            <span className="text-[10px] font-black text-[#3525cd] tracking-widest uppercase">
              Métricas Operacionais das Preventivas
            </span>
          </div>
          <h1 className="text-xl md:text-2xl font-black text-slate-800 tracking-tight leading-snug">
            Painel de Controle — <span className="text-[#3525cd]">Indicadores de Campo</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1 max-w-3xl leading-relaxed">
            Consulte o desempenho, cobertura de comarcas, distribuição de carga por CRAAI e o andamento das manutenções programadas em tempo real.
          </p>
        </div>

        <div className="hidden lg:flex items-center gap-2.5 bg-slate-50 border border-slate-100 rounded-lg py-2 px-3.5 mr-6 relative z-10 shrink-0">
          <Activity className="w-4 h-4 text-[#3525cd] animate-pulse" />
          <div className="text-right">
            <span className="block text-[8px] font-black text-slate-400 uppercase tracking-widest">Registros de OS</span>
            <span className="font-mono text-xs font-black text-slate-700">{totalOrdersCount} preventivas</span>
          </div>
        </div>

        {/* Backdrop Visual Accent */}
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-[#3525cd]/5 to-transparent pointer-events-none md:block hidden"></div>
      </section>

      {/* Real-time Metric Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Metric 1: Total planejado */}
        <div className="bg-white rounded-xl p-4 border border-slate-200/80 shadow-3xs hover:shadow-2xs transition-all flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Planejadas</p>
              <h3 className="text-2xl font-black text-slate-800">{countPlanejadas}</h3>
            </div>
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <Calendar className="w-4.5 h-4.5" />
            </div>
          </div>
          <p className="text-[9px] text-slate-500 mt-3 pt-2 border-t border-slate-100 font-bold">Aguardando calendário</p>
        </div>

        {/* Metric 2: Em execução */}
        <div className="bg-white rounded-xl p-4 border border-slate-200/80 shadow-3xs hover:shadow-2xs transition-all flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Em Execução</p>
              <h3 className="text-2xl font-black text-amber-600">{countEmExecucao}</h3>
            </div>
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
              <Clock className="w-4.5 h-4.5" />
            </div>
          </div>
          <p className="text-[9px] text-slate-500 mt-3 pt-2 border-t border-slate-100 font-bold">Equipes ativas no campo</p>
        </div>

        {/* Metric 3: Concluídas */}
        <div className="bg-white rounded-xl p-4 border border-slate-200/80 shadow-3xs hover:shadow-2xs transition-all flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Concluídas</p>
              <h3 className="text-2xl font-black text-emerald-600">{countConcluidas}</h3>
            </div>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-4.5 h-4.5" />
            </div>
          </div>
          <p className="text-[9px] text-emerald-600 mt-3 pt-2 border-t border-slate-100 font-extrabold flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5" />
            SLA de execução OK
          </p>
        </div>

        {/* Metric 4: Não Executadas (Criticas) */}
        <div className={`rounded-xl p-4 border shadow-3xs hover:shadow-2xs transition-all flex flex-col justify-between ${
          countNaoExecutadas > 0 
            ? 'bg-rose-50/50 border-rose-200 text-rose-900' 
            : 'bg-white border-slate-200/80 text-slate-400'
        }`}>
          <div className="flex justify-between items-start">
            <div>
              <p className={`text-[8px] font-black uppercase tracking-widest mb-1 ${countNaoExecutadas > 0 ? 'text-rose-600' : 'text-slate-400'}`}>Não Executadas</p>
              <h3 className={`text-2xl font-black ${countNaoExecutadas > 0 ? 'text-rose-600' : 'text-slate-800'}`}>{countNaoExecutadas}</h3>
            </div>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
              countNaoExecutadas > 0 ? 'bg-rose-100 text-rose-600 animate-pulse' : 'bg-slate-100 text-slate-450'
            }`}>
              <Flag className="w-4.5 h-4.5 fill-current" />
            </div>
          </div>
          <p className={`text-[9.5px] mt-3 pt-2 border-t font-black uppercase tracking-wider ${
            countNaoExecutadas > 0 
              ? 'border-rose-150 text-rose-600' 
              : 'border-slate-100 text-slate-400'
          }`}>
            {countNaoExecutadas > 0 ? '⚠️ Atenção solicitada' : 'Sem pendências expostas'}
          </p>
        </div>

        {/* Metric 5: Eficiência */}
        <div className="bg-white rounded-xl p-4 border border-slate-200/80 shadow-3xs hover:shadow-2xs transition-all flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Aproveitamento</p>
              <h3 className="text-2xl font-black text-slate-800">
                {executionRate}%
              </h3>
            </div>
            <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
              <Activity className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100">
            <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
              <div className="bg-indigo-600 h-full rounded-full transition-all duration-300" style={{ width: `${executionRate}%` }}></div>
            </div>
          </div>
        </div>
      </section>

      {/* Critical Alerts Banner Section if any are "Não Executadas" */}
      {criticalAlerts.length > 0 && (
        <section className="bg-rose-50 border border-rose-150 rounded-xl p-5 shadow-xs">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
            <div>
              <h3 className="text-sm font-black text-rose-800 uppercase tracking-wide">Atenção: Preventivas Pendentes de Execução ({criticalAlerts.length})</h3>
              <p className="text-[11px] text-rose-600">As seguintes preventivas atingiram o tempo limite ou foram registradas como Não Executadas. Reavaliar imediatamente.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {criticalAlerts.map(os => (
              <div key={os.id} onClick={onNavigateToOS} className="bg-white border border-rose-200 rounded-lg p-3 cursor-pointer hover:border-rose-450 transition-colors shadow-3xs flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-start gap-2 mb-1.5">
                    <span className="font-mono text-xs text-rose-600 font-bold">#{os.id}</span>
                    <span className="bg-rose-100 text-rose-700 text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider flex items-center gap-1">
                      <Flag className="w-2 h-2 fill-current" /> Não Executada
                    </span>
                  </div>
                  <h4 className="text-[11.5px] font-extrabold text-slate-800 line-clamp-2 leading-snug mb-2">{os.title}</h4>
                </div>
                <div className="pt-2 border-t border-slate-100 flex justify-between items-center text-[9px] font-bold text-slate-500">
                  <span className="truncate max-w-[120px]" title={os.assignedTechnician}>Téc: {os.assignedTechnician}</span>
                  <span className="bg-slate-50 border border-slate-200 px-1.5 py-0.2 rounded font-mono text-slate-600">{formatDateBR(os.scheduledDate)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Main Grid: Data Distribution and Upcoming List */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Dynamic Regional Distributions (CRAAI e COMARCA) */}
        <div className="bg-white rounded-xl p-5 border border-slate-200/80 shadow-3xs flex flex-col justify-between min-h-[380px]">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Building2 className="w-4.5 h-4.5 text-indigo-600 shrink-0" />
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide">Distribuição por Comarca</h3>
            </div>
            <p className="text-[11px] text-slate-400">Total acumulado e taxa de conformidade real por comarca.</p>

            <div className="mt-4 space-y-4 max-h-[280px] overflow-y-auto pr-1">
              {loadingAssets ? (
                <div className="text-xs text-slate-400 italic py-6">Carregando comarcas...</div>
              ) : comarcaStats.length === 0 ? (
                <div className="text-xs text-slate-450 italic py-6">Sem preventivas regionalizadas.</div>
              ) : (
                comarcaStats.map((item, idx) => (
                  <div key={idx} className="space-y-1">
                    <div className="flex justify-between items-baseline text-[10.5px] font-bold text-slate-700">
                      <span className="truncate max-w-[180px] uppercase font-mono text-[9px] text-[#3525cd] bg-indigo-50/50 px-1 rounded">{item.name}</span>
                      <span className="font-mono text-slate-450">{item.completed}/{item.total} OS ({item.rate}%)</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full ${
                          item.rate >= 90 ? 'bg-emerald-500' : item.rate >= 50 ? 'bg-indigo-600' : 'bg-amber-500'
                        }`} 
                        style={{ width: `${item.rate}%` }}
                      ></div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Dynamic Sector Distribution (CRAAI) */}
        <div className="bg-white rounded-xl p-5 border border-slate-200/80 shadow-3xs flex flex-col justify-between min-h-[380px]">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Wrench className="w-4.5 h-4.5 text-indigo-600 shrink-0" />
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide">Distribuição por CRAAI</h3>
            </div>
            <p className="text-[11px] text-slate-400">Total de preventivas planejadas e porcentagem concluída.</p>

            <div className="mt-4 space-y-4 max-h-[280px] overflow-y-auto pr-1">
              {loadingAssets ? (
                <div className="text-xs text-slate-400 italic py-6">Carregando setores CRAAI...</div>
              ) : craaiStats.length === 0 ? (
                <div className="text-xs text-slate-450 italic py-6">Sem preventivas atribuídas por CRAAI.</div>
              ) : (
                craaiStats.map((item, idx) => (
                  <div key={idx} className="space-y-1">
                    <div className="flex justify-between items-baseline text-[10.5px] font-bold text-slate-700">
                      <span className="truncate max-w-[170px] uppercase">{item.name}</span>
                      <span className="font-mono text-slate-500">{item.completed}/{item.total} OS</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div className="bg-[#3525cd] h-full rounded-full" style={{ width: `${item.total > 0 ? (item.completed/item.total)*100 : 0}%` }}></div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Dynamic Tech Performance List */}
        <div className="bg-white rounded-xl p-5 border border-slate-200/80 shadow-3xs flex flex-col justify-between min-h-[380px]">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <User className="w-4.5 h-4.5 text-indigo-600 shrink-0" />
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide">Equipe e Técnicos</h3>
            </div>
            <p className="text-[11px] text-slate-400">Atividades preventivas concluídas por técnico habilitado.</p>

            <div className="mt-4 space-y-3.5 max-h-[280px] overflow-y-auto pr-1">
              {techStats.length === 0 ? (
                <div className="text-xs text-slate-450 italic py-6">Sem estatísticas de técnicos.</div>
              ) : (
                techStats.map((tech, idx) => {
                  const initials = tech.name.split(' ').map(n => n[0]).join('').slice(0, 2);
                  return (
                    <div key={idx} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-100 text-[#3525cd] font-black text-[10px] flex items-center justify-center shrink-0 uppercase">
                        {initials || '?'}
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex justify-between items-baseline text-[10px] font-extrabold text-slate-700">
                          <span className="truncate pr-1 block">{tech.name}</span>
                          <span className="font-mono text-slate-500 shrink-0">{tech.completed}/{tech.total} conclusos</span>
                        </div>
                        <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                          <div className="bg-emerald-550 h-full rounded-full" style={{ width: `${tech.rate}%` }}></div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

      </div>

      {/* Upcoming Activities and Calendar Timeline */}
      <section className="bg-white rounded-xl border border-slate-200/80 shadow-3xs overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200/60 bg-slate-50/50 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-slate-500" />
            <h4 className="font-black text-slate-800 text-xs uppercase tracking-wider">CRONOGRAMA DE PREVENTIVAS ATIVAS / PLANEJADAS</h4>
          </div>
          <button 
            onClick={onNavigateToOS}
            className="text-[10.5px] font-black text-[#3525cd] hover:underline flex items-center gap-1 cursor-pointer uppercase tracking-wider"
          >
            Ver Todas
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="overflow-x-auto">
          {upcomingPreventives.length === 0 ? (
            <div className="text-center py-12 text-slate-400 font-bold italic text-xs">
              Nenhuma preventiva programada pendente de execução no momento.
            </div>
          ) : (
            <table className="w-full text-left text-[11px] border-collapse">
              <thead className="bg-slate-50 text-slate-450 font-black uppercase tracking-wider border-b border-slate-150">
                <tr>
                  <th className="px-5 py-3.5 w-20">ID</th>
                  <th className="px-5 py-3.5 min-w-[200px]">Serviço / Ativo</th>
                  <th className="px-5 py-3.5">CRAAI / Comarca</th>
                  <th className="px-5 py-3.5">Técnico</th>
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5 w-28">Previsão</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                {upcomingPreventives.map((os) => {
                  const isCompleted = os.status === 'Concluída';
                  const isInProgress = os.status === 'Em Execução';
                  
                  return (
                    <tr key={os.id} onClick={onNavigateToOS} className="hover:bg-indigo-50/10 cursor-pointer transition-colors">
                      <td className="px-5 py-3 font-mono text-[#3525cd] font-extrabold">#{os.id}</td>
                      <td className="px-5 py-3">
                        <div className="font-extrabold text-slate-800 line-clamp-1">{os.title}</div>
                        <div className="text-[10px] text-slate-400 font-medium truncate max-w-sm mt-0.5">
                          {os.assetCode} • {os.assetName}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="text-[9.5px] font-black uppercase text-indigo-650 bg-indigo-55/40 border border-indigo-100 px-1.5 py-0.2 rounded">
                            {getOrderCRAAI(os)}
                          </span>
                          <span className="text-[9.5px] font-extrabold uppercase text-slate-600 bg-slate-50 border border-slate-150 px-1.5 py-0.2 rounded truncate max-w-[124px]">
                            {getOrderComarca(os)}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className="text-slate-800 font-extrabold">{os.assignedTechnician}</span>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border ${
                          isInProgress
                            ? 'bg-amber-50 text-amber-700 border-amber-200 animate-pulse'
                            : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                        }`}>
                          <span className={`w-1 h-1 rounded-full ${isInProgress ? 'bg-amber-500' : 'bg-indigo-500'}`} />
                          {os.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-500 font-mono text-[9.5px]">
                        {formatDateBR(os.scheduledDate)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Bottom Footer Attribution */}
      <footer className="pt-4 border-t border-slate-200/60 flex flex-col sm:flex-row justify-between items-center text-[10px] font-bold text-slate-400 uppercase tracking-wider">
        <p>Hexon Preventivas • Módulo de Inteligência Operacional</p>
        <p className="mt-1 sm:mt-0">© 2026 MPMG • Todas as informações são reais e integradas ao banco</p>
      </footer>
    </div>
  );
}
