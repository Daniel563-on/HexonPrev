import React, { useState } from 'react';
import SystemControlCard from './users/SystemControlCard';
import AuditLogsTab from './users/AuditLogsTab';
import { HexonUser } from '../types';

// CONFIGURAÇÕES (só Super Administrador): coisas do sistema todo.
// Sistema = forçar atualização e modo manutenção; Auditoria = ações registradas e acessos.
type SettingsTab = 'system' | 'audit';

export default function SettingsView({ userProfile, darkMode }: { userProfile: HexonUser; darkMode: boolean }) {
  const [tab, setTab] = useState<SettingsTab>('system');

  const tabBtn = (key: SettingsTab, icon: string, label: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={`px-5 py-3 text-xs font-bold text-left border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
        tab === key ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
      }`}
    >
      <span className="material-symbols-outlined text-base">{icon}</span>
      {label}
    </button>
  );

  return (
    <div className="space-y-6 font-sans">
      <div className="border-b pb-4 border-slate-200 dark:border-slate-800">
        <span className="px-2.5 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 rounded font-mono text-[10px] font-black uppercase tracking-wider">
          Nível: Super Administrador
        </span>
        <h2 className={`text-2xl font-black tracking-tight ${darkMode ? 'text-white' : 'text-slate-900'} mt-1`}>Configurações</h2>
        <p className="text-xs text-slate-500 mt-1">Ajustes que valem para o sistema todo.</p>
      </div>

      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-1">
        {tabBtn('system', 'settings_suggest', 'Sistema')}
        {tabBtn('audit', 'fact_check', 'Auditoria')}
      </div>

      {tab === 'system' && <SystemControlCard darkMode={darkMode} userName={userProfile.name} />}
      {tab === 'audit' && <AuditLogsTab darkMode={darkMode} />}
    </div>
  );
}
