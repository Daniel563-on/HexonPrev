import React, { useState } from 'react';
import { Construction } from 'lucide-react';
import { HexonUser, MaterialRequest, ServiceOrder, SupplyRequest } from '../../types';
import SolicitationsView from '../SolicitationsView';
import MaterialRequestsTab from './MaterialRequestsTab';
import SupplyRequestsBoard from '../supplies/SupplyRequestsBoard';

// TELA SOLICITAÇÕES (Fase 8): abas "De corretiva" (itens das preventivas), "Material" (pedidos de material do MP, 8B)
// e "Insumos" (pedidos de insumos, 8C-2). Material: quem tem "Ver pedidos de material" ou "Aprovar / reprovar pedidos de material".
// Insumos: quem tem "Ver pedidos de insumos" ou "Confirmar pedidos de insumos".
// "Hora extra" e "Pernoite" (Fase 8D): só as abas, em construção (pedido do usuário); aparecem para todos.
export default function SolicitationsHub(props: {
  pendingOrders: ServiceOrder[];
  pendingMaterialRequests: MaterialRequest[];
  pendingSupplyRequests: SupplyRequest[]; // aguardando confirmação (tempo real)
  scopeUnits: string[] | null;
  visibleCompanies?: string[] | null;
  onNavigateToOS: (osId?: string) => void;
  onReload?: () => void;
  userProfile: HexonUser;
  userHasActionPermission: (actionId: string) => boolean;
}) {
  const { userProfile, userHasActionPermission } = props;
  const canDecide = userHasActionPermission('material_requests_decide');
  const canSeeMaterial = canDecide || userHasActionPermission('material_requests_view');
  const canConfirmSupplies = userHasActionPermission('supply_requests_confirm');
  const canSeeSupplies = canConfirmSupplies || userHasActionPermission('supply_requests_view');
  type Tab = 'corretiva' | 'material' | 'insumos' | 'horaExtra' | 'pernoite';
  const [tab, setTab] = useState<Tab>('corretiva');

  const tabBtn = (key: Tab, label: string, n: number) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={`px-5 py-3 text-xs font-bold border-b-2 transition-all cursor-pointer ${
        tab === key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-400 hover:text-slate-600'
      }`}
    >
      {label}
      {n > 0 && <span className="ml-2 px-1.5 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-black">{n}</span>}
    </button>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap border-b border-slate-200 gap-1">
        {tabBtn('corretiva', 'De corretiva', props.pendingOrders.length)}
        {canSeeMaterial && tabBtn('material', 'Material', props.pendingMaterialRequests.length)}
        {canSeeSupplies && tabBtn('insumos', 'Insumos', props.pendingSupplyRequests.length)}
        {tabBtn('horaExtra', 'Hora extra', 0)}
        {tabBtn('pernoite', 'Pernoite', 0)}
      </div>
      {tab === 'horaExtra' || tab === 'pernoite' ? (
        <div className="p-8 rounded-2xl border border-dashed border-amber-300 bg-amber-50 text-center space-y-2">
          <Construction className="w-8 h-8 mx-auto text-amber-600" />
          <p className="text-sm font-black text-amber-800">{tab === 'horaExtra' ? 'Hora extra' : 'Pernoite'} — em construção</p>
          <p className="text-xs text-amber-700">As solicitações de {tab === 'horaExtra' ? 'hora extra' : 'pernoite'} ainda vão ser feitas.</p>
        </div>
      ) : tab === 'insumos' && canSeeSupplies ? (
        <SupplyRequestsBoard
          mode="confirm"
          live={props.pendingSupplyRequests}
          scopeUnits={props.scopeUnits}
          visibleCompanies={props.visibleCompanies}
          userProfile={userProfile}
          canAct={canConfirmSupplies}
        />
      ) : tab === 'material' && canSeeMaterial ? (
        <MaterialRequestsTab
          pending={props.pendingMaterialRequests}
          scopeUnits={props.scopeUnits}
          visibleCompanies={props.visibleCompanies}
          userProfile={userProfile}
          canDecide={canDecide}
        />
      ) : (
        <SolicitationsView
          pendingOrders={props.pendingOrders}
          scopeUnits={props.scopeUnits}
          visibleCompanies={props.visibleCompanies}
          onNavigateToOS={props.onNavigateToOS}
          onReload={props.onReload}
          userProfile={userProfile}
          userHasActionPermission={userHasActionPermission}
        />
      )}
    </div>
  );
}
