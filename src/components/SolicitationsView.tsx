import { useState, useEffect } from 'react';
import {
  Wrench,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Search,
  Filter,
  Calendar,
  User,
  Building2,
  ArrowRight,
  ClipboardList,
  ChevronRight,
  ShieldAlert,
  SlidersHorizontal,
  Plus,
  Check,
  XCircle,
  RefreshCw,
  FileText
} from 'lucide-react';
import { ServiceOrder, Asset, HexonUser, formatDateBR } from '../types';
import { dbSaveServiceOrder, dbGetAssets } from '../db/firebase';

export interface Solicitation {
  id: string; // original preventive ID
  preventiveOS: ServiceOrder;
  failedItems: { id: string; task: string; observations: string | null; autoCorrectiveStatus?: 'Pendente' | 'Resolvido' | 'Cancelado' }[];
  spawnedOS?: ServiceOrder;
  status: 'Pendente' | 'Em Andamento' | 'Resolvido' | 'Cancelado';
}

interface SolicitationsViewProps {
  orders: ServiceOrder[];
  onNavigateToOS: (osId?: string) => void;
  onReload?: () => void;
  userProfile?: HexonUser | null;
  userHasActionPermission?: (actionId: string) => boolean;
}

export function getSolicitations(orders: ServiceOrder[]): Solicitation[] {
  const solicitations: Solicitation[] = [];
  
  orders.forEach(os => {
    // Find checklist items that explicitly requested corrective action with 'Sim'
    const failedItems = os.checklist.filter(item => {
      return item.autoCreateCorrective === true && item.autoCorrectiveAnswer === 'Sim';
    });

    if (failedItems.length > 0) {
      // Find corrective service order spawned for this preventive ID
      const spawnedOS = orders.find(other => 
        other.id !== os.id && 
        (other.description.includes(`#${os.id}`) || other.notes.includes(`#${os.id}`))
      );

      let status: 'Pendente' | 'Em Andamento' | 'Resolvido' | 'Cancelado' = 'Pendente';
      
      // Determine overall status based on checklist item status first, then by spawnedOS status
      const firstItemWithStatus = failedItems.find(item => item.autoCorrectiveStatus);
      if (firstItemWithStatus?.autoCorrectiveStatus) {
        status = firstItemWithStatus.autoCorrectiveStatus;
      } else if (spawnedOS) {
        if (spawnedOS.status === 'Concluída') {
          status = 'Resolvido';
        } else if (spawnedOS.status === 'Em Execução' || spawnedOS.status === 'Atrasada') {
          status = 'Em Andamento';
        } else {
          status = 'Pendente';
        }
      }

      solicitations.push({
        id: os.id,
        preventiveOS: os,
        failedItems: failedItems.map(item => ({
          id: item.id,
          task: item.task,
          observations: item.observations || 'Nenhuma observação registrada.',
          autoCorrectiveStatus: item.autoCorrectiveStatus
        })),
        spawnedOS,
        status
      });
    }
  });

  return solicitations;
}

export default function SolicitationsView({ 
  orders, 
  onNavigateToOS, 
  onReload,
  userProfile,
  userHasActionPermission
}: SolicitationsViewProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedSolicitation, setSelectedSolicitation] = useState<Solicitation | null>(null);
  const [isCreatingOS, setIsCreatingOS] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);

  const hasManagePermission = (): boolean => {
    if (!userProfile) return true; // Fail-open fallback
    if (userProfile.perfil === 'Super Administrador') return true;
    if (userHasActionPermission) {
      return userHasActionPermission('manage_solicitations');
    }
    return userProfile.perfil === 'Administrador';
  };

  useEffect(() => {
    let active = true;
    dbGetAssets().then((data) => {
      if (active) {
        setAssets(data || []);
      }
    }).catch(err => {
      console.error("Erro ao carregar ativos para solicitações:", err);
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
    return os.surveyLocation || 'Geral';
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

  // Compute solicitations dynamically from current orders list
  const solicitations = getSolicitations(orders);

  const handleCreateSpawnedCorrective = async (sol: Solicitation) => {
    if (isCreatingOS) return;
    setIsCreatingOS(true);
    try {
      const prev = sol.preventiveOS;
      const correctiveId = (30000 + Math.floor(Math.random() * 10000)).toString();
      const correctiveTitle = `Manutenção Corretiva Assistida - ${prev.assetName || 'Ativo'}`;
      
      const failedTexts = sol.failedItems.map(item => `${item.task} (Justificativa: ${item.observations})`).join('; ');
      
      const correctiveOS: ServiceOrder = {
        id: correctiveId,
        assetId: prev.assetId,
        assetName: prev.assetName,
        assetCode: prev.assetCode,
        sector: prev.sector,
        title: correctiveTitle,
        description: `Ordem de serviço corretiva gerada de forma assistida a partir das não-conformidades detectadas na preventiva #${prev.id}. Detalhes dos apontamentos com recomendação de corretiva urgente: ${failedTexts}.`,
        priority: 'Alta',
        status: 'Planejada',
        scheduledDate: new Date().toISOString().split('T')[0],
        assignedTechnician: prev.assignedTechnician || 'Técnico de Plantão',
        checklist: sol.failedItems.map((item, index) => ({
          id: `ck_sp_corr_${Date.now()}_${index}`,
          task: `Corrigir: ${item.task}`,
          checked: false,
          checkedAt: null,
          observations: `Detectado na preventiva #${prev.id}. Observação: ${item.observations}`
        })),
        notes: `Gerada assistida pela aba de solicitações. Preventiva vinculada: #${prev.id}.`,
        signature: null,
        signedBy: null,
        signedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        photoEvidence: null
      };

      await dbSaveServiceOrder(correctiveOS);
      alert(`✅ ORDEM DE SERVIÇO CORRETIVA #${correctiveId} CRIADA COM SUCESSO!\n\nA ordem de serviço foi registrada com prioridade Alta e vinculada ao ativo.`);
      
      if (onReload) {
        onReload();
      }
      setSelectedSolicitation(null);
    } catch (e) {
      console.error(e);
      alert('Erro inesperado ao criar Ordem de Serviço Corretiva.');
    } finally {
      setIsCreatingOS(false);
    }
  };

  // Filter based on search and status
  const filteredSolicitations = solicitations.filter(sol => {
    const matchesSearch = 
      sol.preventiveOS.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sol.preventiveOS.assetName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sol.id.includes(searchTerm) ||
      sol.preventiveOS.assignedTechnician.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (sol.spawnedOS && sol.spawnedOS.id.includes(searchTerm));
      
    const matchesStatus = statusFilter === 'all' || sol.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  // Calculate Statistics
  const countTotal = solicitations.length;
  const countPendente = solicitations.filter(s => s.status === 'Pendente').length;
  const countResolvido = solicitations.filter(s => s.status === 'Resolvido').length;
  const countCancelado = solicitations.filter(s => s.status === 'Cancelado').length;

  const handleUpdateStatus = async (sol: Solicitation, newStatus: 'Pendente' | 'Resolvido' | 'Cancelado') => {
    try {
      const prev = sol.preventiveOS;
      
      // Update all check items in the checklist that requested auto creation
      const updatedChecklist = prev.checklist.map(item => {
        if (item.autoCreateCorrective && item.autoCorrectiveAnswer === 'Sim') {
          return {
            ...item,
            autoCorrectiveStatus: newStatus
          };
        }
        return item;
      });

      const updatedOrder: ServiceOrder = {
        ...prev,
        checklist: updatedChecklist,
        updatedAt: new Date().toISOString()
      };

      await dbSaveServiceOrder(updatedOrder);
      
      if (onReload) {
        onReload();
      }
    } catch (e) {
      console.error('Error updating status:', e);
      alert('Erro inesperado ao atualizar chamado.');
    }
  };

  return (
    <div className="space-y-6 font-sans">
      
      {/* Page Header */}
      <section className="bg-white rounded-xl p-6 md:p-7 border border-slate-200 shadow-sm relative overflow-hidden transition-all duration-200 hover:shadow-md flex items-center justify-between">
        <div className="relative z-10 max-w-4xl border-l-4 border-rose-500 pl-4 md:pl-5">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>
            <span className="text-[10px] font-black text-rose-600 tracking-widest uppercase">
              Gerenciamento de Avarias e Chamados
            </span>
          </div>
          <h1 className="text-xl md:text-2xl font-black text-slate-800 tracking-tight leading-snug">
            Solicitações — <span className="text-rose-600">Aberturas de Corretivas</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1 max-w-3xl leading-relaxed">
            Painel consolidado das preventivas concluídas com apontamentos de falhas técnicas graves, aguardando confirmação ou descarte de chamados corretivos de campo.
          </p>
        </div>

        {/* Backdrop Visual Accent */}
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-rose-500/5 to-transparent pointer-events-none md:block hidden"></div>
      </section>

      {/* Metrics Section */}
      <section className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-3xs hover:shadow-2xs transition-all flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Solicitado</p>
              <h3 className="text-2xl font-black text-slate-800">{countTotal}</h3>
            </div>
            <div className="w-8 h-8 rounded-lg bg-slate-50 text-slate-600 flex items-center justify-center shrink-0">
              <ClipboardList className="w-4.5 h-4.5" />
            </div>
          </div>
          <p className="text-[9px] text-slate-500 mt-3 pt-2 border-t border-slate-100 font-bold font-mono">Total de avarias sinalizadas</p>
        </div>

        <div className="bg-white rounded-xl p-4 border border-amber-200 shadow-3xs hover:shadow-2xs transition-all flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[8px] font-black text-amber-600 uppercase tracking-widest mb-1">Chamados Pendentes</p>
              <h3 className="text-2xl font-black text-amber-600">{countPendente}</h3>
            </div>
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
              <Clock className="w-4.5 h-4.5" />
            </div>
          </div>
          <p className="text-[9px] text-amber-650 mt-3 pt-2 border-t border-amber-100 font-bold font-mono">Aguardando decisão operacional</p>
        </div>

        <div className="bg-white rounded-xl p-4 border border-emerald-200 shadow-3xs hover:shadow-2xs transition-all flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[8px] font-black text-emerald-600 uppercase tracking-widest mb-1">Chamados Confirmados</p>
              <h3 className="text-2xl font-black text-emerald-600">{countResolvido}</h3>
            </div>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-4.5 h-4.5" />
            </div>
          </div>
          <p className="text-[9px] text-emerald-650 mt-3 pt-2 border-t border-emerald-100 font-bold font-mono">Registrados na aba de solicitações</p>
        </div>

        <div className="bg-white rounded-xl p-4 border border-slate-350 shadow-3xs hover:shadow-2xs transition-all flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Chamados Cancelados</p>
              <h3 className="text-2xl font-black text-slate-500">{countCancelado}</h3>
            </div>
            <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
              <XCircle className="w-4.5 h-4.5" />
            </div>
          </div>
          <p className="text-[9px] text-slate-500 mt-3 pt-2 border-t border-slate-200 font-bold font-mono">Desconsiderados/Mapeamento externo</p>
        </div>
      </section>

      {/* Filter and Search controls */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-3xs flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 w-4.5 h-4.5 text-slate-400" />
          <input
            type="text"
            placeholder="Pesquise por ID da preventiva, comarca, ativo, técnico..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full text-xs pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-350 focus:bg-white transition-colors text-slate-800 font-bold"
          />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <SlidersHorizontal className="w-4 h-4 text-slate-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-xs font-bold border border-slate-200 bg-slate-50 hover:bg-white rounded-lg px-3 py-2.5 cursor-pointer text-slate-700 transition-colors focus:outline-none focus:ring-1 focus:ring-slate-300"
          >
            <option value="all">Ver Todos os Status</option>
            <option value="Pendente">Apenas Pendentes</option>
            <option value="Resolvido">Apenas Confirmados</option>
            <option value="Cancelado">Apenas Cancelados</option>
          </select>
        </div>
      </div>

      {/* Main Grid: Full width responsive bento grid list of cards */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 pb-8">
        {filteredSolicitations.length === 0 ? (
          <div className="xl:col-span-2 bg-white border rounded-xl p-16 text-center text-slate-400 italic text-xs font-bold shadow-3xs flex flex-col items-center justify-center space-y-3">
            <ClipboardList className="w-8 h-8 text-slate-300" />
            <p>Nenhuma solicitação de corretiva encontrada para os filtros aplicados.</p>
          </div>
        ) : (
          filteredSolicitations.map((sol) => {
            const hasCorrective = sol.status === 'Resolvido';
            const isCancelled = sol.status === 'Cancelado';
            
            let cardBgClass = 'bg-white border-slate-200';
            let statusBadge = (
              <span className="px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border bg-amber-50 text-amber-800 border-amber-150 animate-pulse">
                Aguardando Ação
              </span>
            );

            if (hasCorrective) {
              cardBgClass = 'bg-emerald-50/15 border-emerald-300 ring-1 ring-emerald-100/50';
              statusBadge = (
                <span className="px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border bg-emerald-100 text-emerald-800 border-emerald-250 flex items-center gap-1">
                  <Check className="w-3 h-3 text-emerald-600 font-extrabold" />
                  Confirmado / Concluído
                </span>
              );
            } else if (isCancelled) {
              cardBgClass = 'bg-slate-50/50 border-slate-300 opacity-80';
              statusBadge = (
                <span className="px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border bg-slate-100 text-slate-600 border-slate-200">
                  Desconsiderado
                </span>
              );
            }

            return (
              <div 
                key={sol.id} 
                className={`rounded-xl border p-4 sm:p-5 transition-all shadow-4xs hover:shadow-2xs flex flex-col justify-between relative overflow-hidden ${cardBgClass}`}
              >
                <div>
                  {/* Card Header row */}
                  <div className="flex flex-wrap justify-between items-start gap-2 mb-2.5 pb-2.5 border-b border-gray-150/80">
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono text-[9.5px] font-black text-rose-600 uppercase bg-rose-50 px-2 py-0.5 rounded border border-rose-100">
                          OS Preventiva #{sol.id}
                        </span>
                        <span className="text-[9.5px] text-slate-400 font-bold font-mono">
                          {formatDateBR(sol.preventiveOS.scheduledDate)}
                        </span>
                      </div>
                      <h3 className="text-xs sm:text-sm font-black text-slate-800 tracking-tight mt-1.5 leading-snug">
                        {sol.preventiveOS.title}
                      </h3>
                    </div>

                    {statusBadge}
                  </div>

                  {/* DADOS DA PREVENTIVA EXECUTADA */}
                  <div className="bg-slate-50 border border-slate-150/70 p-3 sm:p-4 rounded-xl space-y-3 mb-3 shadow-3xs">
                    <div className="flex items-center gap-1.5 border-b border-slate-200/60 pb-1.5">
                      <FileText className="w-3.5 h-3.5 text-[#3525cd]" />
                      <span className="font-extrabold text-slate-800 uppercase text-[9px] tracking-wider">
                        Laudo Técnico & Localização
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-[10.5px]">
                      <div>
                        <span className="text-slate-400 font-bold block text-[8px] uppercase tracking-wider mb-0.5">Comarca</span>
                        <span className="font-black text-slate-800 truncate block text-[11px]" title={getOrderComarca(sol.preventiveOS)}>
                          {getOrderComarca(sol.preventiveOS)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 font-bold block text-[8px] uppercase tracking-wider mb-0.5">CRAAI</span>
                        <span className="font-mono font-bold text-[#3525cd] bg-indigo-50/60 px-1.5 py-0.5 rounded border border-indigo-100 inline-block uppercase text-[9.5px] leading-tight">
                          {getOrderCRAAI(sol.preventiveOS)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 font-bold block text-[8px] uppercase tracking-wider mb-0.5">Equipamento / Ativo</span>
                        <span className="font-black text-slate-800 leading-tight block truncate text-[11px]" title={sol.preventiveOS.assetName}>
                          {sol.preventiveOS.assetName || 'S/V - Vistoria'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 font-bold block text-[8px] uppercase tracking-wider mb-0.5">Código / Setor</span>
                        <span className="font-mono text-slate-705 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 text-[9px] inline-block font-bold">
                          {sol.preventiveOS.assetCode || 'N/A'} • {sol.preventiveOS.sector || 'Geral'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 font-bold block text-[8px] uppercase tracking-wider mb-0.5">Técnico Responsável</span>
                        <span className="font-extrabold text-indigo-700 truncate block text-[11px]">
                          {sol.preventiveOS.assignedTechnician}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 font-bold block text-[8px] uppercase tracking-wider mb-0.5">Data de Execução</span>
                        <span className="font-mono text-slate-700 truncate block text-[10.5px] font-bold">
                          {formatDateBR(sol.preventiveOS.signedAt || sol.preventiveOS.scheduledDate)}
                        </span>
                      </div>
                      {sol.preventiveOS.signedBy && (
                        <div className="col-span-2 md:col-span-3 pt-0.5">
                          <span className="font-bold text-emerald-805 bg-emerald-50/50 border border-emerald-100 px-2 py-0.5 rounded text-[9.5px] inline-block font-mono">
                            ✓ Assinado por: {sol.preventiveOS.signedBy}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Defect checklist items that caused this solicitation */}
                    <div className="pt-2.5 border-t border-slate-200/50">
                      <span className="block text-[8.5px] font-black text-rose-600 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                        <ShieldAlert className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                        Irregularidades Identificadas ({sol.failedItems.length})
                      </span>
                      <div className="space-y-1.5">
                        {sol.failedItems.map((item, idx) => (
                          <div key={idx} className="bg-white p-2 rounded-lg border border-slate-150 shadow-4xs text-[10px]">
                            <span className="font-extrabold text-slate-800 block leading-tight">• {item.task}</span>
                            <p className="text-[9.5px] text-rose-700 font-semibold italic bg-rose-50/25 p-1 rounded border border-rose-100/50 mt-1 leading-snug">
                              Relato: "{item.observations}"
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* General observations added inside preventive */}
                    {sol.preventiveOS.notes && sol.preventiveOS.notes.trim() !== '' && (
                      <div className="pt-2">
                        <span className="text-slate-400 font-bold block text-[8px] uppercase tracking-wider mb-0.5">Notas de Inspeção</span>
                        <p className="text-[10px] text-slate-650 italic leading-snug">
                          "{sol.preventiveOS.notes}"
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Interaction & Decisions Footer row */}
                <div className="mt-2.5 pt-2.5 border-t border-gray-150">
                  {sol.status === 'Pendente' && (
                    hasManagePermission() ? (
                      <div className="space-y-2">
                        <p className="text-[9.5px] text-slate-455 font-bold uppercase tracking-wider text-center">
                          Deseja registrar o chamado corretivo para as falhas acima?
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleUpdateStatus(sol, 'Resolvido')}
                            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[10.5px] py-1.5 px-3 rounded-lg shadow-3xs cursor-pointer hover:shadow-2xs transition-all active:scale-98 text-center flex items-center justify-center gap-1 uppercase tracking-wider"
                          >
                            <Check className="w-3.5 h-3.5 font-black shrink-0" />
                            Abrir Chamado
                          </button>
                          <button
                            onClick={() => handleUpdateStatus(sol, 'Cancelado')}
                            className="flex-1 bg-slate-100 hover:bg-rose-50 text-slate-650 hover:text-rose-700 border border-slate-250 hover:border-rose-200 font-black text-[10.5px] py-1.5 px-3 rounded-lg cursor-pointer transition-all active:scale-98 text-center flex items-center justify-center gap-1 uppercase tracking-wider"
                          >
                            <XCircle className="w-3.5 h-3.5 shrink-0" />
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2 py-2 bg-slate-50/50 border border-slate-200/55 rounded-lg px-3">
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider text-center flex items-center justify-center gap-2">
                          <Clock className="w-3.5 h-3.5 text-amber-500" />
                          Aguardando decisão técnica da gerência
                        </p>
                        <p className="text-[9px] text-slate-400 font-bold text-center leading-relaxed">
                          Técnicos profissionais podem acompanhar o status em tempo real. A abertura ou encerramento deste fluxo é facultada unicamente à gerência e administradores.
                        </p>
                      </div>
                    )
                  )}

                  {sol.status === 'Resolvido' && (
                    <div className="bg-emerald-50 border border-emerald-250 p-2.5 rounded-lg flex flex-col sm:flex-row justify-between items-center gap-2">
                      <p className="text-[10.5px] font-extrabold text-emerald-800 flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 font-black shrink-0" />
                        Chamado registrado com sucesso na fila de solicitações!
                      </p>
                      {hasManagePermission() && (
                        <button
                          onClick={() => handleUpdateStatus(sol, 'Pendente')}
                          className="text-[9px] font-black text-slate-500 hover:text-slate-800 uppercase tracking-wider cursor-pointer hover:underline flex items-center gap-1 shrink-0"
                        >
                          <RefreshCw className="w-3 h-3" /> Reabrir Chamado
                        </button>
                      )}
                    </div>
                  )}

                  {sol.status === 'Cancelado' && (
                    <div className="bg-slate-100/60 border border-slate-250 p-2.5 rounded-lg flex flex-col sm:flex-row justify-between items-center gap-2">
                      <p className="text-[10.5px] font-extrabold text-slate-600 flex items-center gap-1.5">
                        <XCircle className="w-4 h-4 text-slate-500 shrink-0" />
                        Esta solicitação/chamado foi cancelado ou desconsiderado.
                      </p>
                      {hasManagePermission() && (
                        <button
                          onClick={() => handleUpdateStatus(sol, 'Pendente')}
                          className="text-[9px] font-black text-indigo-600 hover:text-[#3525cd] uppercase tracking-wider cursor-pointer hover:underline flex items-center gap-1 shrink-0"
                        >
                          <RefreshCw className="w-3 h-3" /> Reabrir Chamado
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Bottom Footer Attribution */}
      <footer className="pt-4 border-t border-slate-200/60 flex flex-col sm:flex-row justify-between items-center text-[10px] font-bold text-slate-400 uppercase tracking-wider">
        <p>Hexon Preventivas • Módulo de Solicitações e Corretivas</p>
        <p className="mt-1 sm:mt-0">© 2026 MPMG • Detecção automática integrada via checklist de engenharia</p>
      </footer>
    </div>
  );
}
