import React, { useState } from 'react';
import { HexonUser, ServiceOrder } from '../../types';
import TeamsView from './TeamsView';
import WeekView from './WeekView';

// PROGRAMAÇÃO (Fase 7, etapa de junção: planilha semanal da gerência + programação do Hexon principal + planejamento das
// preventivas e chamados GLPI). 7A = Equipes; 7B = Semana (ver e organizar); 7C-1 = blocos de preventivas.

interface Props {
  user: HexonUser;
  unitOptions: string[];
  visibleCompanies: string[] | null;
  canEdit: boolean; // "Programar"
  canPublish?: boolean; // Fase 7D: "Programar" + "Publicar avisos"
  orders: ServiceOrder[]; // preventivas da cópia local (a Semana mostra as já programadas)
  activeUnit?: string;
  onActiveUnitChange?: (unit: string) => void;
  onViewedMonthChange?: (month: string) => void;
  onNavigate: (tab: string) => void;
}

type Tab = 'semana' | 'equipes';

export default function ProgramacaoView({ user, unitOptions, visibleCompanies, canEdit, canPublish, orders, activeUnit, onActiveUnitChange, onViewedMonthChange, onNavigate }: Props) {
  const [tab, setTab] = useState<Tab>('semana');
  const btn = (t: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(t)}
      className={`px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-wide cursor-pointer ${tab === t ? 'bg-[#3525cd] text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
    >
      {label}
    </button>
  );
  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex gap-1 bg-white dark:bg-[#0b1220] border border-slate-200 dark:border-slate-800 rounded-xl p-1 w-fit">
        {btn('semana', 'Semana')}
        {btn('equipes', 'Equipes')}
      </div>
      {unitOptions.length === 0 ? (
        <p className="text-xs text-slate-500">Seu perfil não tem gerência para ver a Programação.</p>
      ) : tab === 'equipes' ? (
        <TeamsView user={user} unitOptions={unitOptions} visibleCompanies={visibleCompanies} canEdit={canEdit} />
      ) : (
        <WeekView
          user={user}
          unitOptions={unitOptions}
          visibleCompanies={visibleCompanies}
          canEdit={canEdit}
          canPublish={canPublish}
          orders={orders}
          activeUnit={activeUnit}
          onActiveUnitChange={onActiveUnitChange}
          onViewedMonthChange={onViewedMonthChange}
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
}
