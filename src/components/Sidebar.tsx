// Sidebar.tsx - Hexon OS Sidebar Navigation
import { useState } from 'react';
import { ServiceOrder, HexonUser, isSectorInGerencia } from '../types';
import { getSolicitations } from './SolicitationsView';

interface SidebarProps {
  currentTab: string;
  onChangeTab: (tab: string) => void;
  isOpen?: boolean;
  onClose?: () => void;
  onNovaOS?: () => void;
  orders?: ServiceOrder[];
  userProfile: HexonUser | null;
  userHasTabPermission: (tab: string) => boolean;
}

export default function Sidebar({ 
  currentTab, 
  onChangeTab, 
  isOpen = false, 
  onClose, 
  orders = [],
  userProfile,
  userHasTabPermission
}: SidebarProps) {
  const solicitations = getSolicitations(orders);
  
  // Filter solicitations based on profile gerência or professional ownership
  const getFilteredSolicitationsCount = () => {
    let list = solicitations;
    if (userProfile) {
      if (userProfile.perfil === 'Profissional') {
        list = list.filter(o => o.preventiveOS.assignedTechnician === userProfile.name);
      } else if (userProfile.perfil === 'Administrador' && userProfile.gerencia !== 'Todas') {
        list = list.filter(o => isSectorInGerencia(o.preventiveOS.sector, userProfile.gerencia));
      }
    }
    return list.filter(s => s.status !== 'Resolvido').length;
  };

  const activeSolicitationsCount = getFilteredSolicitationsCount();

  const isSuperAdmin = userProfile?.perfil === 'Super Administrador';
  const isProfessional = userProfile?.perfil === 'Profissional';

  return (
    <>
      {/* Mobile Sidebar Backdrop Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/65 z-40 lg:hidden backdrop-blur-xs transition-opacity duration-300"
          onClick={onClose}
        />
      )}

      <aside 
        className={`fixed lg:static top-0 bottom-0 left-0 h-screen w-[280px] bg-[#0b1c30] flex flex-col py-6 shadow-2xl lg:shadow-xl shrink-0 z-50 text-white font-sans transition-transform duration-300 ease-in-out print:hidden ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Brand Header */}
        <div className="px-6 mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Hexagonal Blue Logo with White H inside (Matches Mockup perfectly) */}
            <div className="relative w-10 h-10 flex items-center justify-center shrink-0">
              <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-md">
                <polygon points="50,5 91,28 91,77 50,95 9,77 9,28" className="fill-[#1F1CCF] stroke-[#3525CD] stroke-2" />
                <polygon points="50,15 83,34 83,71 50,85 17,71 17,34" className="fill-none stroke-white/20 stroke-2" />
                <text x="50" y="58" textAnchor="middle" dominantBaseline="middle" className="fill-white font-sans font-black text-3xl select-none">H</text>
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tighter text-white leading-none">HEXON</h1>
              <p className="text-[10px] tracking-widest font-black text-blue-400 mt-1 uppercase">OPERATIONAL OS</p>
            </div>
          </div>

          {/* Close button for mobile slide-out panel */}
          {onClose && (
            <button 
              onClick={onClose}
              className="lg:hidden p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
              title="Fechar Menu"
            >
              <span className="material-symbols-outlined text-xl">close</span>
            </button>
          )}
        </div>

        {/* Scrollable Navigation Links */}
        <nav className="flex-grow overflow-y-auto px-3 space-y-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
          <div className="px-3 pb-2 pt-1">
            <span className="text-[11px] font-extrabold text-blue-400/60 uppercase tracking-widest block mb-1">Navegação</span>
          </div>
          
          {/* Dashboard Item */}
          {userHasTabPermission('dashboard') && (
            <button
              onClick={() => {
                onChangeTab('dashboard');
                if (onClose) onClose();
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg duration-200 text-left hover:translate-x-1 active:scale-[0.98] transition-all cursor-pointer ${
                currentTab === 'dashboard'
                  ? 'bg-blue-600 text-white font-extrabold shadow-md'
                  : 'text-gray-400 hover:text-white hover:bg-white/5 opacity-85 hover:opacity-100'
              }`}
            >
              <span className={`material-symbols-outlined transition-transform duration-200 ${
                currentTab === 'dashboard' ? 'text-[#c3c0ff] rotate-3' : 'text-gray-400 group-hover:scale-110'
              }`}>
                grid_view
              </span>
              <span className="text-sm font-medium">Dashboard e Auditoria</span>
            </button>
          )}

          {/* Preventivas Button */}
          {userHasTabPermission('service-orders') && (
            <button
              onClick={() => {
                onChangeTab('service-orders');
                if (onClose) onClose();
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg duration-200 text-left hover:translate-x-1 active:scale-[0.98] transition-all cursor-pointer ${
                currentTab === 'service-orders'
                  ? 'bg-blue-600 text-white font-extrabold shadow-md'
                  : 'text-gray-400 hover:text-white hover:bg-white/5 opacity-85 hover:opacity-100'
              }`}
            >
              <span className={`material-symbols-outlined transition-transform duration-200 ${
                currentTab === 'service-orders' ? 'text-[#c3c0ff] scale-110' : 'text-gray-400'
              }`}>
                assignment_turned_in
              </span>
              <span className="text-sm font-medium">Preventivas</span>
            </button>
          )}

          {/* Solicitações Button */}
          {userHasTabPermission('solicitations') && (
            <button
              onClick={() => {
                onChangeTab('solicitations');
                if (onClose) onClose();
              }}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-lg duration-200 text-left hover:translate-x-1 active:scale-[0.98] transition-all cursor-pointer ${
                currentTab === 'solicitations'
                  ? 'bg-blue-600 text-white font-extrabold shadow-md'
                  : 'text-gray-400 hover:text-white hover:bg-white/5 opacity-85 hover:opacity-100'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className={`material-symbols-outlined transition-transform duration-205 ${
                  currentTab === 'solicitations' ? 'text-[#c3c0ff] rotate-12 scale-110 animate-bounce' : 'text-gray-400'
                }`}>
                  notification_important
                </span>
                <span className="text-sm font-medium">Solicitações</span>
              </div>
              
              {activeSolicitationsCount > 0 && (
                <span className="bg-rose-600 text-white text-[9.5px] font-black font-mono px-2 py-0.5 rounded-full ring-2 ring-[#0b1c30] animate-pulse">
                  {activeSolicitationsCount}
                </span>
              )}
            </button>
          )}

          {/* Gestão de Ativos Item */}
          {userHasTabPermission('assets') && (
            <button
              onClick={() => {
                onChangeTab('assets');
                if (onClose) onClose();
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg duration-200 text-left hover:translate-x-1 active:scale-[0.98] transition-all cursor-pointer ${
                currentTab === 'assets'
                  ? 'bg-blue-600 text-white font-extrabold shadow-md'
                  : 'text-gray-400 hover:text-white hover:bg-white/5 opacity-85 hover:opacity-100'
              }`}
            >
              <span className={`material-symbols-outlined transition-transform duration-200 ${
                currentTab === 'assets' ? 'text-[#c3c0ff] rotate-6' : 'text-gray-400'
              }`}>
                widgets
              </span>
              <span className="text-sm font-medium">Gestão de Ativos</span>
            </button>
          )}

          {/* Modelos e Protocolos (Parametrizador) Item */}
          {userHasTabPermission('templates') && (
            <button
              onClick={() => {
                onChangeTab('templates');
                if (onClose) onClose();
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg duration-200 text-left hover:translate-x-1 active:scale-[0.98] transition-all cursor-pointer ${
                currentTab === 'templates'
                  ? 'bg-blue-600 text-white font-extrabold shadow-md'
                  : 'text-gray-400 hover:text-white hover:bg-white/5 opacity-85 hover:opacity-100'
              }`}
            >
              <span className={`material-symbols-outlined transition-transform duration-200 ${
                currentTab === 'templates' ? 'text-[#c3c0ff] scale-110' : 'text-gray-400'
              }`}>
                settings_suggest
              </span>
              <span className="text-sm font-medium">Modelos e Protocolos</span>
            </button>
          )}



          {/* SECURE ADMIN CONTROL: Super Administrador ONLY */}
          {isSuperAdmin && (
            <button
              onClick={() => {
                onChangeTab('user-control');
                if (onClose) onClose();
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg duration-200 text-left hover:translate-x-1 active:scale-[0.98] transition-all cursor-pointer ${
                currentTab === 'user-control'
                  ? 'bg-amber-600 text-white font-extrabold shadow-md border border-amber-500/20'
                  : 'text-gray-400 hover:text-emerald-300 hover:bg-white/5 opacity-85 hover:opacity-100'
              }`}
            >
              <span className={`material-symbols-outlined transition-transform duration-200 ${
                currentTab === 'user-control' ? 'text-amber-100 scale-110' : 'text-amber-500/80'
              }`}>
                key_visualizer
              </span>
              <span className="text-sm font-medium">Controle de Usuários</span>
            </button>
          )}
        </nav>
      </aside>
    </>
  );
}
