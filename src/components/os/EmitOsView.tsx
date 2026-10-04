import React, { useState } from 'react';
import { HexonUser } from '../../types';
import OsEmitForm from './OsEmitForm';
import OsTemplatesEditor from './OsTemplatesEditor';

// EMITIR OS (GLPI) — botão logo abaixo de Início. Abas: Emitir OS e Modelos de OS.
interface Props {
  userProfile: HexonUser;
  userProfileId?: string;
  unitOptions: string[];
  canEmit: boolean;
  canAssign: boolean;
  canEditTemplates: boolean;
}

export default function EmitOsView({ userProfile, userProfileId, unitOptions, canEmit, canAssign, canEditTemplates }: Props) {
  const [tab, setTab] = useState<'emitir' | 'modelos'>(canEmit ? 'emitir' : 'modelos');
  const tabBtn = (key: 'emitir' | 'modelos', label: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={`px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-wide cursor-pointer ${tab === key ? 'bg-[#3525cd] text-white' : 'text-slate-500 hover:bg-slate-100'}`}
    >
      {label}
    </button>
  );
  return (
    <div className="space-y-5 font-sans">
      <div className="border-b pb-4 border-slate-200">
        <h2 className="text-2xl font-black tracking-tight text-slate-900">Emitir OS (GLPI)</h2>
        <p className="text-xs text-slate-500 mt-1">Corretiva, layout e acompanhamento. A OS nasce em aberto; o Encarregado atribui o técnico.</p>
      </div>
      {canEmit && canEditTemplates && (
        <div className="flex gap-1 bg-white border border-slate-200 rounded-xl p-1 w-fit">
          {tabBtn('emitir', 'Emitir OS')}
          {tabBtn('modelos', 'Modelos de OS')}
        </div>
      )}
      {tab === 'emitir' && canEmit && (
        <OsEmitForm userProfile={userProfile} userProfileId={userProfileId} unitOptions={unitOptions} canAssign={canAssign} />
      )}
      {tab === 'modelos' && canEditTemplates && <OsTemplatesEditor userProfile={userProfile} />}
    </div>
  );
}
