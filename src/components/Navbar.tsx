import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Moon, Sun, LogOut, Menu, Type, Lock } from 'lucide-react';
import { signOutHexon } from '../db/firebase';
import { HexonUser, ServiceOrder } from '../types';
import AccessibilityPanel from './AccessibilityPanel';
import ChangePasswordModal from './ChangePasswordModal';

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
  onUpdateUserProfile?: (user: HexonUser) => void;
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
  orders,
  onUpdateUserProfile
}: NavbarProps) {
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);

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
  const displayInitials = getInitials(displayName);

  return (
    <header className="h-20 px-4 sm:px-6 w-full bg-white/95 dark:bg-[#0A101D]/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800/80 flex justify-between items-center sticky top-0 z-40 shadow-xs font-sans transition-colors duration-150 print:hidden">
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
        <h2 className="text-sm xs:text-base sm:text-lg font-extrabold font-sans tracking-tight text-slate-900 dark:text-white truncate pr-1">{tabTitle}</h2>
      </div>

      {/* Actionable Controls matching the attached mockup */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* 1. Integrated Accessibility Pill Button and Flyout dropdown */}
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

        {/* 2. Dynamic Dark Mode Toggle (rounded box with indigo moon/sun icon) */}
        <button 
          onClick={onToggleDarkMode}
          className="h-9 w-9 flex items-center justify-center rounded-2xl sm:rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0A101D] text-indigo-600 dark:text-indigo-400 hover:bg-slate-50 dark:hover:bg-slate-850 hover:border-indigo-300 dark:hover:border-indigo-800 transition-all active:scale-95 cursor-pointer shadow-2xs shrink-0"
          title={darkMode ? 'Mudar para Tema Claro' : 'Mudar para Tema Escuro'}
        >
          {darkMode ? (
            <Sun className="w-4 h-4 text-amber-500" />
          ) : (
            <Moon className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          )}
        </button>

        {/* 3. Divider Line */}
        <div className="h-6 w-[1px] bg-slate-200 dark:bg-slate-800 mx-0.5 shrink-0"></div>

        {/* 4. User Profile (Avatar Circle on Left + Name in Uppercase on Right) */}
        <div className="flex items-center gap-2 min-w-0">
          <div 
            className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-extrabold text-xs flex items-center justify-center shrink-0 border border-indigo-200/60 dark:border-indigo-800/50"
            title={displayName}
          >
            {displayInitials}
          </div>
          <span 
            className="font-bold text-xs text-slate-800 dark:text-white uppercase tracking-tight truncate max-w-[110px] sm:max-w-[160px] lg:max-w-[220px]"
            title={displayName}
          >
            {displayName}
          </span>
        </div>

        {/* 5. Cadeado (Lock) Button - Alterar Senha */}
        <button
          onClick={() => setShowChangePassword(true)}
          className="h-9 w-9 flex items-center justify-center rounded-2xl sm:rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0A101D] text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:border-indigo-300 dark:hover:border-indigo-800 hover:bg-slate-50 dark:hover:bg-slate-850 transition-all active:scale-95 cursor-pointer shadow-2xs shrink-0"
          title="Alterar Senha de Acesso"
          aria-label="Alterar Senha"
        >
          <Lock className="w-4 h-4" />
        </button>

        {/* 6. Sair (Logout) Button */}
        <button
          onClick={() => setShowLogoutConfirm(true)}
          className="h-9 w-9 flex items-center justify-center rounded-2xl sm:rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0A101D] text-slate-600 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-400 hover:border-rose-300 dark:hover:border-rose-800 hover:bg-rose-50/50 dark:hover:bg-rose-950/20 transition-all active:scale-95 cursor-pointer shadow-2xs shrink-0"
          title="Sair do Console"
          aria-label="Sair"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>

      {/* Change Password Modal */}
      <ChangePasswordModal
        isOpen={showChangePassword}
        onClose={() => setShowChangePassword(false)}
        userProfile={userProfile}
        onSuccess={(updated) => {
          if (onUpdateUserProfile) {
            onUpdateUserProfile(updated);
          }
        }}
      />

      {/* Elegant Custom Confirmation Modal (Bypasses iFrame native blocks) */}
      {showLogoutConfirm && typeof document !== 'undefined' && createPortal(
        <div 
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowLogoutConfirm(false);
          }}
          className="fixed inset-0 z-[99999] flex items-center justify-center bg-slate-950/70 backdrop-blur-md font-sans p-4 animate-in fade-in duration-200"
        >
          <div className="bg-white dark:bg-[#0A101D] p-6 rounded-2xl max-w-sm w-full border border-slate-200 dark:border-slate-800/80 shadow-2xl text-center animate-in fade-in zoom-in-95 duration-200">
            <div className="w-12 h-12 bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 rounded-full flex items-center justify-center mx-auto mb-4 border border-rose-100 dark:border-rose-900/20">
              <LogOut className="w-5 h-5" />
            </div>
            <h3 className="text-base font-extrabold font-sans tracking-tight text-slate-900 dark:text-white">Confirmar Saída</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">Deseja realmente sair do sistema?</p>
            <div className="mt-6 flex gap-3 justify-center">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
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
                className="flex-1 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
              >
                Sair
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </header>
  );
}
