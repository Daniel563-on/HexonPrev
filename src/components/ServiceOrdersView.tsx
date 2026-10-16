import React, { useState, useEffect } from 'react';
import { FileSearch } from 'lucide-react';
import { ServiceOrder, Asset, HexonUser } from '../types';
import { localMonthKey, localTodayStr, dbGetAssets, dbGetTemplates, isSectorVisible } from '../db/firebase';
import OrderDetailsDrawer from './orders/OrderDetailsDrawer';
import DeleteOrderModal from './orders/DeleteOrderModal';
import PreventiveScanModal from './orders/PreventiveScanModal';
import OrdersSearchPanel from './orders/OrdersSearchPanel';
import PreventivesBoard from './orders/preventives/PreventivesBoard';
import { clearHomeLink, peekHomeLink } from '../lib/homeLinks';

interface ServiceOrdersViewProps {
  orders: ServiceOrder[];
  onReload: () => void;
  onViewedMonthChange?: (month: string) => void; // mês (AAAA-MM) cujas OS fechadas devem ser carregadas
  highlightOSId?: string | null;
  userProfile?: HexonUser | null;
  visibleUnits?: string[] | null; // unidades do perfil (null = todas)
  visibleCompanies?: string[] | null; // empresas que vê (null = todas as das gerências que vê)
  userHasActionPermission?: (actionId: string) => boolean;
  activeUnit?: string; // quem vê todas as gerências: a gerência escolhida (uma por vez)
  unitOptions?: string[];
  onActiveUnitChange?: (unit: string) => void;
  onNavigate?: (tab: string) => void;
  // Hexon 2.0: 'execucao' = Ordens de Serviço › Preventivas (acompanhar e programar pela lista, Fase 7E-1);
  // 'pmoc' = PMOC › Preventivas (só a Consulta de OS: o Planejamento & Calendário saiu na Fase 7E-1)
  section: 'execucao' | 'pmoc';
}

export default function ServiceOrdersView({
  orders,
  onReload,
  onViewedMonthChange,
  highlightOSId,
  userProfile,
  visibleUnits = null,
  visibleCompanies = null,
  userHasActionPermission,
  activeUnit,
  unitOptions,
  onActiveUnitChange,
  onNavigate,
  section
}: ServiceOrdersViewProps) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const has = (id: string) => !userHasActionPermission || userHasActionPermission(id);
  // Programar, trocar técnico, remarcar e voltar para "Novo": permissão "Programar" (Fase 7E-1; antes "Planejar preventivas")
  const canProgram = has('prog_edit');

  // Atrasada volta para "Novo" enquanto o prazo da própria preventiva (do disparo) não acabou. "Não Executada" (prazo
  // acabado) fica bloqueada. (O mês em exibição não conta mais: não existe o calendário do PMOC.)
  const canRevertUnexecutedOrder = (os: ServiceOrder): boolean => {
    if (!canProgram) return false;
    if (os.status !== 'Atrasada') return false;
    if (!isSectorVisible(os.sector, visibleUnits)) return false;
    if (os.endDate && localTodayStr() > os.endDate) return false;
    return true;
  };

  const [selectedOrder, setSelectedOrder] = useState<ServiceOrder | null>(null);
  const [showDrawer, setShowDrawer] = useState(false);
  const [initialOpenSignature, setInitialOpenSignature] = useState(false);
  // Atalho do Início (Equipe agora): abre a lista já buscando pelo técnico
  const [smartSearch, setSmartSearch] = useState(() => (section === 'execucao' ? peekHomeLink<string>('preventives-search') || '' : ''));
  useEffect(() => {
    if (section === 'execucao') clearHomeLink('preventives-search');
  }, []);
  const [showPreventiveScanSimulator, setShowPreventiveScanSimulator] = useState(false);
  const [deleteIds, setDeleteIds] = useState<string[]>([]);

  // Fechadas: só as do mês atual (as antigas ficam na Consulta de OS)
  useEffect(() => {
    onViewedMonthChange?.(localMonthKey());
    return () => onViewedMonthChange?.(localMonthKey());
  }, []);

  useEffect(() => {
    dbGetAssets().then(setAssets);
    dbGetTemplates().then(setTemplates);
  }, []);

  // OS destacada vinda de outra tela (ex.: Solicitações): abre a ficha
  useEffect(() => {
    if (highlightOSId) {
      const target = orders.find((os) => os.id === highlightOSId);
      if (target) {
        setSmartSearch(`#${highlightOSId}`);
        setSelectedOrder(target);
        setInitialOpenSignature(false);
        setShowDrawer(true);
      }
    }
  }, [highlightOSId, orders]);

  const openOrder = (os: ServiceOrder) => {
    setSelectedOrder(os);
    setInitialOpenSignature(false);
    setShowDrawer(true);
  };

  return (
    <div className="space-y-6 font-sans">
      {section === 'pmoc' ? (
        <>
          <section className="bg-white rounded-xl p-6 md:p-7 border border-slate-200 shadow-sm relative overflow-hidden flex items-center justify-between">
            <div className="relative z-10 max-w-4xl border-l-4 border-[#3525cd] pl-4 md:pl-5">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#3525cd]"></span>
                <span className="text-[10px] font-black text-[#3525cd] tracking-widest uppercase">Consulta</span>
              </div>
              <h1 className="text-xl md:text-2xl font-black text-slate-800 tracking-tight leading-snug">
                Preventivas — <span className="text-[#3525cd]">Consulta</span>
              </h1>
              <p className="text-xs text-slate-500 mt-1 max-w-3xl leading-relaxed">
                Consulta das preventivas. Programar é na <b>Programação</b> (a semana das equipes) ou em <b>Ordens de Serviço › Preventivas</b> (pela lista).
              </p>
            </div>
          </section>
          <div className="flex bg-slate-100/60 p-1 rounded-xl border border-slate-200/80 w-fit">
            <span className="py-2 px-4 rounded-lg text-[11px] md:text-xs font-black uppercase tracking-wider flex items-center gap-1.5 bg-[#3525cd] text-white shadow-sm">
              <FileSearch className="w-3.5 h-3.5" />
              Consulta de OS
            </span>
          </div>
          <OrdersSearchPanel userProfile={userProfile} visibleUnits={visibleUnits} assets={assets} templates={templates} userHasActionPermission={userHasActionPermission} />
        </>
      ) : userProfile ? (
        <PreventivesBoard
          user={userProfile}
          orders={orders}
          visibleUnits={visibleUnits}
          visibleCompanies={visibleCompanies}
          activeUnit={activeUnit}
          unitOptions={unitOptions}
          onActiveUnitChange={onActiveUnitChange}
          canProgram={canProgram}
          canDelete={userProfile.perfil === 'Super Administrador' && has('delete_order')}
          canOpenProgramacao={has('prog_view') || has('prog_edit')}
          onOpen={openOrder}
          onDelete={setDeleteIds}
          onReload={onReload}
          onOpenScan={() => setShowPreventiveScanSimulator(true)}
          onNavigate={onNavigate}
          search={smartSearch}
          setSearch={setSmartSearch}
        />
      ) : null}

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
        currentCalendarDate={new Date()}
        initialOpenSignature={initialOpenSignature}
      />

      <DeleteOrderModal
        isOpen={deleteIds.length > 0}
        orderIds={deleteIds.filter((id) => orders.find((o) => o.id === id)?.status === 'Novo')}
        onClose={() => setDeleteIds([])}
        onSuccess={() => {
          if (selectedOrder && deleteIds.includes(selectedOrder.id)) {
            setShowDrawer(false);
            setSelectedOrder(null);
          }
          setDeleteIds([]);
          onReload();
        }}
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
