import React, { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { HexonUser } from '../../types';
import TeamsView from './TeamsView';

// PROGRAMAÇÃO (Fase 7, etapa de junção: planilha semanal da gerência + programação do Hexon principal + planejamento das
// preventivas e chamados GLPI). 7A = Equipes; a grade da semana chega na 7B.

interface Props {
  user: HexonUser;
  unitOptions: string[];
  visibleCompanies: string[] | null;
  canEdit: boolean; // "Programar"
}

type Tab = 'semana' | 'equipes';

export default function ProgramacaoView({ user, unitOptions, visibleCompanies, canEdit }: Props) {
  const [tab, setTab] = useState<Tab>('equipes');
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
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-10 text-center space-y-2">
          <CalendarDays className="w-8 h-8 mx-auto text-indigo-500" />
          <p className="text-sm font-black text-slate-800 dark:text-slate-200">A grade da semana chega na próxima etapa.</p>
          <p className="text-xs text-slate-500">Por enquanto, monte as equipes na aba Equipes: elas viram as linhas da Programação.</p>
        </div>
      )}
    </div>
  );
}
