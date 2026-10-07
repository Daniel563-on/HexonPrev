import React, { useState } from 'react';
import { HexonUser } from '../../types';
import WorkOrdersList from './WorkOrdersList';

// ORDENS DE SERVIÇO — 2 botões: OS (corretiva, layout e acompanhamento) e Preventivas (execução).
interface Props {
  userProfile: HexonUser;
  unitOptions: string[];
  canSeeOs: boolean;
  canSeePreventives: boolean;
  canAssign: boolean;
  canEdit: boolean;
  visibleCompanies: string[] | null;
  canCancel: boolean;
  canReplyContest: boolean;
  canClientLink: boolean;
  canExport: boolean;
  canViewCosts: boolean;
  mySignRole: 'engenheiro' | 'gerente' | 'all' | null;
  preventives: React.ReactNode; // a tela de execução das preventivas (Realização)
}

type Section = 'os' | 'preventivas';

export default function OrdersHubView({ userProfile, unitOptions, canSeeOs, canSeePreventives, canAssign, canEdit, visibleCompanies, canCancel, canReplyContest, canClientLink, canExport, canViewCosts, mySignRole, preventives }: Props) {
  const [section, setSection] = useState<Section>(() => {
    try {
      const saved = localStorage.getItem('hexon_orders_section') as Section | null;
      if (saved === 'os' && canSeeOs) return 'os';
      if (saved === 'preventivas' && canSeePreventives) return 'preventivas';
    } catch {
      /* ignora */
    }
    return canSeeOs ? 'os' : 'preventivas';
  });
  const choose = (s: Section) => {
    setSection(s);
    try {
      localStorage.setItem('hexon_orders_section', s);
    } catch {
      /* ignora */
    }
  };
  const btn = (s: Section, label: string) => (
    <button
      type="button"
      onClick={() => choose(s)}
      className={`px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-wide cursor-pointer ${section === s ? 'bg-[#3525cd] text-white' : 'text-slate-500 hover:bg-slate-100'}`}
    >
      {label}
    </button>
  );
  return (
    <div className="space-y-4">
      {canSeeOs && canSeePreventives && (
        <div className="flex gap-1 bg-white border border-slate-200 rounded-xl p-1 w-fit">
          {btn('os', 'Chamados GLPI')}
          {btn('preventivas', 'Preventivas')}
        </div>
      )}
      {section === 'os' && canSeeOs && (
        <div className="space-y-4">
          <div className="border-b pb-3 border-slate-200">
            <h2 className="text-xl font-black tracking-tight text-slate-900">Ordens de Serviço</h2>
            <p className="text-xs text-slate-500 mt-1">Corretiva, layout e acompanhamento. Clique num contador para filtrar e na OS para abrir a ficha.</p>
          </div>
          {unitOptions.length > 0 ? (
            <WorkOrdersList userProfile={userProfile} unitOptions={unitOptions} canAssign={canAssign} canEdit={canEdit} visibleCompanies={visibleCompanies} canCancel={canCancel} canReplyContest={canReplyContest} canClientLink={canClientLink} canExport={canExport} canViewCosts={canViewCosts} mySignRole={mySignRole} />
          ) : (
            <p className="text-xs text-slate-500">Seu perfil não tem gerência para ver OS.</p>
          )}
        </div>
      )}
      {section === 'preventivas' && canSeePreventives && preventives}
    </div>
  );
}
