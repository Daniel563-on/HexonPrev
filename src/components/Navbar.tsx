import React, { useState } from 'react';
import { Bell, Moon, Sun, LogOut, Menu, Type } from 'lucide-react';
import { signOutHexon, getDatabaseMode } from '../db/firebase';
import { HexonUser, ServiceOrder } from '../types';
import AccessibilityPanel from './AccessibilityPanel';

interface NavbarProps {
  tabTitle: string;
  userProfile: HexonUser | null;
  onLogout: () => void;
  onMenuToggle?: () => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  fontScale: number;
  setFontScale: React.Dispatch<React.SetStateAction<number>>;
  highContrast: boolean;
  setHighContrast: React.Dispatch<React.SetStateAction<boolean>>;
  daltonism: string;
  setDaltonism: (val: string) => void;
  currentTab: string;
  orders: ServiceOrder[];
}

export default function Navbar({ 
  tabTitle, 
  userProfile, 
  onLogout, 
  onMenuToggle,
  darkMode,
  onToggleDarkMode,
  fontScale,
  setFontScale,
  highContrast,
  setHighContrast,
  daltonism,
  setDaltonism,
  currentTab,
  orders
}: NavbarProps) {
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  // Get initials for profile picture
  const getInitials = (name: string) => {
    if (!name) return 'HX';
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  const displayName = userProfile ? userProfile.name : 'Colaborador';
  const displayCargo = userProfile ? userProfile.cargo : 'Carregando...';
  const displayPerfil = userProfile ? userProfile.perfil : 'Acesso Restrito';
  const displayInitials = getInitials(displayName);

  return (
    <header className="h-20 px-4 sm:px-6 w-full bg-white/95 dark:bg-[#0b1c30]/95 backdrop-blur-md border-b border-gray-200 dark:border-slate-850/80 flex justify-between items-center sticky top-0 z-40 shadow-sm font-sans transition-colors duration-150">
      {/* Tab Context and Title */}
      <div className="flex items-center gap-2 sm:gap-4 min-w-0">
        {onMenuToggle && (
          <button
            onClick={onMenuToggle}
            className="lg:hidden p-2 -ml-1 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-950 dark:hover:text-white transition-all focus:outline-none"
            title="Abrir Menu"
          >
            <Menu className="w-5 h-5 animate-pulse" />
          </button>
        )}
        <span className="text-[10px] font-bold text-gray-400 dark:text-slate-400 uppercase tracking-widest hidden lg:block">
          CONSOLE OPERACIONAL
        </span>
        <div className="h-4 w-[1px] bg-gray-200 dark:bg-slate-700 hidden lg:block"></div>
        {(() => {
          const dbMode = getDatabaseMode();
          return (
            <div 
              className={`flex items-center justify-center w-6 h-6 rounded-full animate-fade-in border ${
                dbMode.isFirebase 
                  ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/40'
                  : 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/40'
              }`} 
              title={dbMode.isFirebase ? "Conexão ativa e sincronizada em tempo real com o banco de dados do Firebase em nuvem" : "Operando em modo local temporário com armazenamento local"}
            >
              <span className="relative flex h-2.5 w-2.5">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${dbMode.isFirebase ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
                <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${dbMode.isFirebase ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
              </span>
            </div>
          );
        })()}
        <div className="h-4 w-[1px] bg-gray-200 dark:bg-slate-700 hidden lg:block"></div>
        <h2 className="text-sm xs:text-base sm:text-lg font-black text-[#0b1c30] dark:text-white truncate pr-1">{tabTitle}</h2>
        
        {userProfile && (
          <span className={`px-2 py-0.5 text-[9px] sm:text-[10px] font-black uppercase tracking-wider rounded border hidden sm:inline-block ${
            userProfile.perfil === 'Super Administrador'
              ? 'bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border-amber-250/50'
              : userProfile.perfil === 'Administrador'
              ? 'bg-indigo-50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-400 border-indigo-250/50'
              : 'bg-slate-50 dark:bg-slate-900/40 text-slate-600 dark:text-slate-350 border-slate-200 dark:border-slate-800'
          }`}>
            {displayPerfil}
          </span>
        )}
      </div>

      {/* Actionable Controls */}
      <div className="flex items-center gap-2 sm:gap-6">

        <div className="flex items-center gap-1.5 sm:gap-3">


          {/* Dynamic Dark Mode Toggle */}
          <button 
            onClick={onToggleDarkMode}
            className={`w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-slate-800/60 transition-all border hover:scale-105 active:scale-95 cursor-pointer ${
              darkMode ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' : 'text-gray-600 dark:text-gray-300 border-gray-100 dark:border-slate-800/60'
            }`}
            title={darkMode ? 'Mudar para Tema Claro' : 'Mudar para Tema Escuro'}
          >
            {darkMode ? <Sun className="w-5 h-5 text-amber-500 rotate-45 hover:rotate-90 transition-transform duration-300" /> : <Moon className="w-5 h-5 -rotate-12 hover:rotate-0 transition-transform duration-300" />}
          </button>

          {/* Integrated Accessibility Button and Flyout dropdown */}
          <AccessibilityPanel
            fontScale={fontScale}
            setFontScale={setFontScale}
            highContrast={highContrast}
            setHighContrast={setHighContrast}
            daltonism={daltonism}
            setDaltonism={setDaltonism}
            currentTab={currentTab}
            orders={orders}
          />

          <div className="h-8 w-[1px] bg-gray-200 dark:bg-slate-700 mx-1"></div>

          {/* User Profile Container and Connection Trigger */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 p-1 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800/40 transition-all">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-bold text-gray-900 dark:text-slate-100 leading-tight">{displayName}</p>
                <p className={`text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-400`}>{displayCargo || 'Colaborador'}</p>
              </div>
              
              <div className={`w-10 h-10 rounded-full font-black text-sm flex items-center justify-center border shadow-sm ${
                userProfile?.perfil === 'Super Administrador'
                  ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/40' 
                  : userProfile?.perfil === 'Administrador'
                  ? 'bg-indigo-100 dark:bg-indigo-950/40 text-indigo-705 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800/40'
                  : 'bg-slate-100 dark:bg-slate-850 text-slate-705 dark:text-slate-350 border-slate-205 dark:border-slate-800/40'
              }`}>
                {displayInitials}
              </div>

              <button
                onClick={() => setShowLogoutConfirm(true)}
                className="ml-1 w-8 h-8 flex items-center justify-center rounded-full hover:bg-rose-50 dark:hover:bg-rose-950/20 text-red-650 dark:text-rose-400 hover:text-red-700 dark:hover:text-rose-250 transition-all cursor-pointer"
                title="Sair do Console"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Elegant Custom Confirmation Modal (Bypasses iFrame native blocks) */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs font-sans">
          <div className="bg-white dark:bg-[#0b1c30] p-6 rounded-2xl max-w-sm w-full mx-4 border border-gray-200 dark:border-slate-800 shadow-2xl text-center">
            <div className="w-12 h-12 bg-rose-50 dark:bg-rose-950/30 text-[#ea4335] dark:text-rose-400 rounded-full flex items-center justify-center mx-auto mb-4 border border-rose-100 dark:border-rose-900/10">
              <LogOut className="w-6 h-6" />
            </div>
            <h3 className="text-base font-black text-[#0b1c30] dark:text-white">Confirmar Saída</h3>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-2">Deseja realmente sair do sistema?</p>
            <div className="mt-6 flex gap-3 justify-center">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 px-4 py-2.5 border border-gray-300 dark:border-slate-800 rounded-xl text-xs font-bold text-gray-650 dark:text-slate-350 hover:bg-gray-50 dark:hover:bg-slate-850 transition-all cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  setShowLogoutConfirm(false);
                  try {
                    await signOutHexon();
                  } catch (e) {
                    console.warn(e);
                  }
                  onLogout();
                }}
                className="flex-1 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-md transition-all cursor-pointer"
              >
                Sair
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
