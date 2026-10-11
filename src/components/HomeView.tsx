import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BellRing, CalendarClock, FilePlus2, Inbox, MessageSquareWarning, Package, PackageOpen, PenTool, Warehouse } from 'lucide-react';
import { Company, HexonUser, ServiceOrder } from '../types';
import { dbGetCompanies, isCompanyVisible, subscribeWorkOrderChanges } from '../db/firebase';
import { HomeOsCounts, dbCountSignQueue, dbGetHomeOsCounts } from '../db/homeCounts';
import { HomeOsLink, setHomeLink } from '../lib/homeLinks';
import HomeNeeds, { HomeNeed } from './home/HomeNeeds';
import HomeOsNow from './home/HomeOsNow';
import HomePreventives from './home/HomePreventives';

// INÍCIO (Hexon 2.0): resumo de acordo com o perfil — cada bloco só para quem tem acesso à tela, e cada número
// leva à tela já filtrada. 1 Topo · 2 Precisa de você · 3 Chamados GLPI agora · 4 Preventivas e vistorias.
// Preventivas, corretivas e pedidos: o que o app já carrega (0 leitura a mais). Chamados: contagens como as da
// lista de OS, refeitas quando alguma OS da gerência muda (escuta só o que mudar depois de abrir).

export interface HomePerms {
  emit: boolean; // Emitir OS (GLPI)
  seeOs: boolean; // Chamados GLPI
  assign: boolean; // atribuir técnico (novas e atrasadas)
  contest: boolean; // responder contestação
  seePreventives: boolean;
  plan: boolean; // planejar preventivas
  decideSolicitations: boolean; // corretivas da preventiva
  decideMaterial: boolean;
  confirmSupply: boolean;
  supplyStore: boolean; // almoxarifado
}

interface HomeViewProps {
  userProfile: HexonUser;
  profileName: string;
  orders: ServiceOrder[];
  units: string[]; // gerências do resumo (quem vê todas: a escolhida no topo)
  visibleCompanies: string[] | null;
  perms: HomePerms;
  mySignRole: 'engenheiro' | 'gerente' | 'all' | null;
  pending: { solicitations: number; material: number; supplyConfirm: number; supplyStore: number };
  onNavigate: (tab: string) => void;
  onViewedMonthChange: (month: string) => void;
}

const saveLocal = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignora */
  }
};
const pl = (n: number, one: string, many: string) => (n === 1 ? one : many);
const TONE = {
  violet: 'bg-violet-500/10 text-violet-600 dark:text-violet-300',
  rose: 'bg-rose-500/10 text-rose-600 dark:text-rose-300',
  sky: 'bg-sky-500/10 text-sky-600 dark:text-sky-300',
  indigo: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300',
  orange: 'bg-orange-500/10 text-orange-600 dark:text-orange-300',
  teal: 'bg-teal-500/10 text-teal-600 dark:text-teal-300',
  amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-300',
  slate: 'bg-slate-500/10 text-slate-600 dark:text-slate-300'
};
const ico = 'w-4 h-4';

export default function HomeView({ userProfile, profileName, orders, units, visibleCompanies, perms, mySignRole, pending, onNavigate, onViewedMonthChange }: HomeViewProps) {
  const cos = visibleCompanies;
  const cosKey = cos === null ? '*' : cos.join(',');
  const unitsKey = units.join('|');
  const signRoles: ('engenheiro' | 'gerente')[] = mySignRole === 'all' ? ['engenheiro', 'gerente'] : mySignRole ? [mySignRole] : [];
  const month = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();

  // As preventivas encerradas carregadas são as do mês visto na tela de OS: o Início usa sempre o mês atual
  useEffect(() => onViewedMonthChange(month), []);

  const [companies, setCompanies] = useState<Company[]>([]);
  useEffect(() => {
    dbGetCompanies().then(setCompanies).catch(() => {});
  }, []);
  const companyLabel = cos === null ? 'Todas as empresas' : companies.filter((c) => cos.includes(c.id)).map((c) => c.name).join(', ') || 'Minhas empresas';

  // Só as preventivas das empresas que a pessoa vê
  const myOrders = useMemo(() => orders.filter((o) => isCompanyVisible(o.company, cos)), [orders, cosKey]);
  const inScope = (o: ServiceOrder) => (o.startDate || o.scheduledDate || o.endDate || '') <= `${month}-31`;
  const prevLate = myOrders.filter((o) => o.status === 'Atrasada' && inScope(o)).length;
  const prevNew = myOrders.filter((o) => o.status === 'Novo' && inScope(o)).length;

  // Chamados: contagens ao abrir e de novo (juntando 3 s) quando alguma OS da gerência mudar
  const [osCounts, setOsCounts] = useState<HomeOsCounts | null>(null);
  const [signCount, setSignCount] = useState(0);
  const loadOs = useRef<() => void>(() => {});
  const loadSeq = useRef(0); // trocou de gerência: resposta antiga não entra
  loadOs.current = () => {
    const seq = loadSeq.current;
    if (perms.seeOs && units.length) dbGetHomeOsCounts(units, cos).then((c) => seq === loadSeq.current && setOsCounts(c)).catch(() => {});
    if (signRoles.length && units.length) dbCountSignQueue(units, signRoles).then((n) => seq === loadSeq.current && setSignCount(n)).catch(() => {});
  };
  const signKey = signRoles.join(',');
  useEffect(() => {
    loadSeq.current++;
    setOsCounts(null);
    setSignCount(0);
    if (!perms.seeOs && !signKey) return;
    loadOs.current();
    let timer: number | undefined;
    const since = new Date(Date.now() - 10 * 60000).toISOString();
    const stops = units.map((u) =>
      subscribeWorkOrderChanges(u, since, (changed) => {
        if (cos && !changed.some((o) => cos.includes(o.company || ''))) return;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => loadOs.current(), 3000);
      })
    );
    return () => {
      stops.forEach((s) => s());
      window.clearTimeout(timer);
    };
  }, [unitsKey, cosKey, perms.seeOs, signKey]);

  // Atalhos: a próxima tela abre já filtrada
  const openOs = (link: HomeOsLink) => {
    setHomeLink('os-list', link);
    if (units.length === 1) saveLocal('hexon_os_unit', units[0]);
    saveLocal('hexon_orders_section', 'os');
    onNavigate('service-orders');
  };
  const openPreventives = (t: 'plan' | 'exec' | 'consulta') => {
    if (t === 'exec') {
      saveLocal('hexon_orders_section', 'preventivas');
      onNavigate('service-orders');
    } else onNavigate('pmoc-preventivas');
  };
  const openSolicitations = (tab: string) => {
    setHomeLink('solicitations', tab);
    onNavigate('solicitations');
  };

  const osN = (k: 'Nova' | 'Contestada') => osCounts?.byStatus[k] || 0;
  const needs: HomeNeed[] = [];
  if (signRoles.length) {
    needs.push({
      key: 'sign',
      n: signCount,
      text: mySignRole === 'all' ? 'OS aguardando assinatura do engenheiro ou do gerente' : 'OS aguardando a sua assinatura',
      hint: 'Ordens de Serviço › Chamados GLPI › Precisam da minha assinatura',
      icon: <PenTool className={ico} />,
      tone: TONE.violet,
      onOpen: () => openOs({ sign: true })
    });
  }
  if (perms.seeOs && perms.assign) {
    const late = osCounts?.late || 0;
    needs.push({ key: 'late', n: late, text: `${pl(late, 'chamado atrasado', 'chamados atrasados')} (técnico ainda não assinou)`, hint: 'Ordens de Serviço › Chamados GLPI', icon: <AlertTriangle className={ico} />, tone: TONE.rose, onOpen: () => openOs({ late: true }) });
  }
  if (perms.seeOs && perms.contest) {
    needs.push({ key: 'contest', n: osN('Contestada'), text: pl(osN('Contestada'), 'OS contestada pelo cliente', 'OS contestadas pelo cliente'), hint: 'Ordens de Serviço › Chamados GLPI › Contestadas', icon: <MessageSquareWarning className={ico} />, tone: TONE.rose, onOpen: () => openOs({ status: 'Contestada' }) });
  }
  if (perms.seeOs && perms.assign) {
    needs.push({ key: 'new', n: osN('Nova'), text: pl(osN('Nova'), 'chamado novo sem técnico', 'chamados novos sem técnico'), hint: 'Ordens de Serviço › Chamados GLPI › Novas', icon: <Inbox className={ico} />, tone: TONE.sky, onOpen: () => openOs({ status: 'Nova' }) });
  }
  if (perms.seePreventives && perms.plan) {
    needs.push({ key: 'prevLate', n: prevLate, text: pl(prevLate, 'preventiva atrasada', 'preventivas atrasadas'), hint: 'Ordens de Serviço › Preventivas', icon: <AlertTriangle className={ico} />, tone: TONE.rose, onOpen: () => openPreventives('exec') });
    needs.push({ key: 'prevNew', n: prevNew, text: pl(prevNew, 'preventiva aguardando planejamento', 'preventivas aguardando planejamento'), hint: 'PMOC › Preventivas', icon: <CalendarClock className={ico} />, tone: TONE.indigo, onOpen: () => openPreventives('plan') });
  }
  if (perms.decideSolicitations) {
    const n = pending.solicitations;
    needs.push({ key: 'corr', n, text: pl(n, 'preventiva com corretiva para decidir', 'preventivas com corretiva para decidir'), hint: 'Solicitações › De corretiva', icon: <BellRing className={ico} />, tone: TONE.orange, onOpen: () => openSolicitations('corretiva') });
  }
  if (perms.decideMaterial) {
    const n = pending.material;
    needs.push({ key: 'mat', n, text: pl(n, 'pedido de material para analisar', 'pedidos de material para analisar'), hint: 'Solicitações › Material', icon: <Package className={ico} />, tone: TONE.teal, onOpen: () => openSolicitations('material') });
  }
  if (perms.confirmSupply) {
    const n = pending.supplyConfirm;
    needs.push({ key: 'supC', n, text: pl(n, 'pedido de insumo para confirmar', 'pedidos de insumo para confirmar'), hint: 'Solicitações › Insumos', icon: <PackageOpen className={ico} />, tone: TONE.amber, onOpen: () => openSolicitations('insumos') });
  }
  if (perms.supplyStore) {
    const n = pending.supplyStore;
    needs.push({ key: 'supS', n, text: pl(n, 'pedido de insumo para fornecer', 'pedidos de insumo para fornecer'), hint: 'Almoxarifado', icon: <Warehouse className={ico} />, tone: TONE.slate, onOpen: () => onNavigate('almoxarifado') });
  }

  const firstName = (userProfile.name || '').split(' ')[0];
  const today = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const chip = 'px-2 py-0.5 rounded text-[11px] font-bold';

  return (
    <div className="space-y-7 font-sans max-w-6xl">
      {/* 1. TOPO */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b pb-5 border-slate-200 dark:border-slate-800">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">Olá, {firstName}</h2>
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <span className={`${chip} bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300`}>{profileName}</span>
            {units.length > 0 && <span className={`${chip} bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300`}>{units.join(' · ')}</span>}
            <span className={`${chip} bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300`}>{companyLabel}</span>
            <span className="text-xs text-slate-500 ml-1">{today}</span>
          </div>
        </div>
        {perms.emit && (
          <button
            type="button"
            onClick={() => onNavigate('os-emit')}
            className="flex items-center gap-2.5 px-6 py-3.5 rounded-xl text-white font-black text-sm bg-gradient-to-r from-violet-600 via-blue-600 to-cyan-500 shadow-[0_6px_24px_rgba(79,70,229,0.35)] hover:brightness-110 cursor-pointer"
          >
            <FilePlus2 className="w-5 h-5" /> Emitir OS (GLPI)
          </button>
        )}
      </div>

      {/* 2. PRECISA DE VOCÊ */}
      <HomeNeeds items={needs} />

      {/* 3. CHAMADOS GLPI AGORA */}
      {perms.seeOs && <HomeOsNow counts={osCounts} onOpen={(k) => openOs(k === 'late' ? { late: true } : { status: k })} />}
      {/* 4. PREVENTIVAS E VISTORIAS */}
      {perms.seePreventives && <HomePreventives orders={myOrders} units={units} canSeePast={cos === null} onOpen={openPreventives} />}
    </div>
  );
}

