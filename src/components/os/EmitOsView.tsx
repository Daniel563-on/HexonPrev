import React from 'react';
import { HexonUser } from '../../types';
import OsEmitForm from './OsEmitForm';

// EMITIR OS (GLPI) — botão logo abaixo de Início. Os modelos ficam em Configurações › Modelos de OS.
interface Props {
  userProfile: HexonUser;
  unitOptions: string[];
  canAssign: boolean;
  visibleCompanies?: string[] | null;
}

export default function EmitOsView({ userProfile, unitOptions, canAssign, visibleCompanies = null }: Props) {
  return (
    <div className="space-y-5 font-sans">
      <div className="border-b pb-4 border-slate-200">
        <h2 className="text-2xl font-black tracking-tight text-slate-900">Emitir OS (GLPI)</h2>
        <p className="text-xs text-slate-500 mt-1">Corretiva, layout e acompanhamento. A OS nasce em aberto; o Encarregado atribui o técnico.</p>
      </div>
      <OsEmitForm userProfile={userProfile} unitOptions={unitOptions} canAssign={canAssign} visibleCompanies={visibleCompanies} />
    </div>
  );
}
