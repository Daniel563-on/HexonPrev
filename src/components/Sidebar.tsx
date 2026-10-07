// Sidebar.tsx - menu lateral do Hexon 2.0
// Menu principal e, ao entrar no PMOC, o menu próprio do PMOC (Preventivas e Modelos e Protocolos) com "Voltar ao Hexon".
import React from 'react';
import {
  Home,
  ClipboardCheck,
  BellRing,
  Boxes,
  Sliders,
  ShieldCheck,
  QrCode,
  MapPin,
  Package,
  CalendarRange,
  Settings,
  ArrowLeft,
  FilePlus2,
  X
} from 'lucide-react';
import { HexonUser } from '../types';
import BrandLogo from './BrandLogo';

// Telas que ficam dentro do PMOC
export const PMOC_TABS = ['pmoc-preventivas', 'templates'];

interface SidebarProps {
  currentTab: string;
  onChangeTab: (tab: string) => void;
  isOpen?: boolean;
  onClose?: () => void;
  pendingSolicitationsCount?: number; // solicitações de corretiva pendentes de ação (já filtradas pela gerência)
  userProfile: HexonUser | null;
  userHasTabPermission: (tab: string) => boolean;
}

interface MenuItem {
  tab: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  onClick?: () => void; // quando o item não é uma tela só (ex.: PMOC abre o menu próprio)
  active?: boolean;
}

export default function Sidebar({
  currentTab,
  onChangeTab,
  isOpen = false,
  onClose,
  pendingSolicitationsCount = 0,
  userProfile,
  userHasTabPermission
}: SidebarProps) {
  const isSuperAdmin = userProfile?.perfil === 'Super Administrador';
  const inPmoc = PMOC_TABS.includes(currentTab);
  const pmocTabs = PMOC_TABS.filter((t) => userHasTabPermission(t));

  const go = (tab: string) => {
    onChangeTab(tab);
    if (onClose) onClose();
  };

  const mainItems: MenuItem[] = [
    { tab: 'home', label: 'Início', icon: Home },
    ...(userHasTabPermission('os-emit') ? [{ tab: 'os-emit', label: 'Emitir OS (GLPI)', icon: FilePlus2 }] : []),
    ...(userHasTabPermission('service-orders') ? [{ tab: 'service-orders', label: 'Ordens de Serviço', icon: ClipboardCheck }] : []),
    ...(userHasTabPermission('solicitations') ? [{ tab: 'solicitations', label: 'Solicitações', icon: BellRing, badge: pendingSolicitationsCount }] : []),
    ...(userHasTabPermission('assets') ? [{ tab: 'assets', label: 'Gestão de Ativos', icon: Boxes }] : []),
    ...(pmocTabs.length > 0
      ? [{ tab: 'pmoc', label: 'PMOC', icon: CalendarRange, onClick: () => go(pmocTabs[0]), active: inPmoc }]
      : []),
    ...(userHasTabPermission('materials') ? [{ tab: 'materials', label: 'Gestão de Materiais', icon: Package }] : []),
    ...(isSuperAdmin
      ? [
          { tab: 'user-control', label: 'Usuários', icon: ShieldCheck },
          { tab: 'qr-codes', label: 'QR-Codes', icon: QrCode },
          { tab: 'addresses', label: 'Endereços', icon: MapPin }
        ]
      : []),
    // Configurações: Super Administrador (tudo) ou quem edita modelos de OS (só Modelos de OS)
    ...(userHasTabPermission('settings') ? [{ tab: 'settings', label: 'Configurações', icon: Settings }] : [])
  ];

  const pmocItems: MenuItem[] = [
    ...(userHasTabPermission('pmoc-preventivas') ? [{ tab: 'pmoc-preventivas', label: 'Preventivas', icon: ClipboardCheck }] : []),
    ...(userHasTabPermission('templates') ? [{ tab: 'templates', label: 'Modelos e Protocolos', icon: Sliders }] : [])
  ];

  const renderItem = (item: MenuItem) => {
    const active = item.active ?? currentTab === item.tab;
    const Icon = item.icon;
    return (
      <button
        key={item.tab}
        type="button"
        onClick={item.onClick || (() => go(item.tab))}
        className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl duration-200 text-left active:scale-[0.98] transition-all cursor-pointer ${
          active ? 'bg-indigo-600 text-white font-bold shadow-xs' : 'text-slate-400 hover:text-white hover:bg-white/5'
        }`}
      >
        <span className="flex items-center gap-3">
          <Icon className={`w-4 h-4 shrink-0 transition-transform duration-200 ${active ? 'text-white scale-110' : 'text-slate-400'}`} />
          <span className="text-sm font-semibold tracking-tight">{item.label}</span>
        </span>
        {!!item.badge && item.badge > 0 && (
          <span className="bg-rose-600 text-white text-[9.5px] font-black font-mono px-2 py-0.5 rounded-full ring-2 ring-[#0A101D] animate-pulse">
            {item.badge}
          </span>
        )}
      </button>
    );
  };

  return (
    <>
      {/* Fundo escuro do menu no celular */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/65 z-40 lg:hidden backdrop-blur-xs transition-opacity duration-300"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed lg:static top-0 bottom-0 left-0 h-screen w-[280px] bg-[#0A101D] border-r border-slate-800/80 flex flex-col py-6 shadow-2xl lg:shadow-xl shrink-0 z-50 text-white font-sans transition-transform duration-300 ease-in-out print:hidden ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Marca */}
        <div className="px-6 mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative h-12 w-12 flex items-center justify-center shrink-0">
              <BrandLogo
                className="h-12 w-12"
                fallback={
                  <>
                    <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full text-indigo-500" fill="none">
                      <path d="M50 5L90 28V72L50 95L10 72V28L50 5Z" fill="#1e1b4b" fillOpacity="0.4" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M50 25L72 38V62L50 75L28 62V38L50 25Z" fill="currentColor" stroke="none" fillOpacity="0.8" />
                    </svg>
                    <span className="relative z-10 text-[10px] font-black text-white">H</span>
                  </>
                }
              />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-white tracking-[0.16em] font-brand leading-none">HEXON</h1>
              {inPmoc && (
                <span className="text-[10px] text-indigo-400/90 font-bold tracking-widest font-mono uppercase block mt-1.5">PMOC</span>
              )}
            </div>
          </div>

          {/* Fechar (menu deslizante no celular) */}
          {onClose && (
            <button
              onClick={onClose}
              className="lg:hidden p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
              title="Fechar Menu"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <nav className="flex-grow overflow-y-auto px-3 space-y-1.5 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
          {inPmoc ? (
            <>
              <button
                type="button"
                onClick={() => go('home')}
                className="w-full flex items-center gap-3 px-4 py-2.5 mb-2 rounded-xl text-left text-slate-300 hover:text-white hover:bg-white/5 border border-slate-800 transition-all cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4 shrink-0" />
                <span className="text-sm font-semibold tracking-tight">Voltar ao Hexon</span>
              </button>
              <div className="px-3 pb-2 pt-1">
                <span className="text-[10px] font-bold text-indigo-400/70 uppercase tracking-widest block mb-1 font-mono">PMOC</span>
              </div>
              {pmocItems.map(renderItem)}
            </>
          ) : (
            <>
              <div className="px-3 pb-2 pt-1">
                <span className="text-[10px] font-bold text-indigo-400/70 uppercase tracking-widest block mb-1 font-mono">Navegação</span>
              </div>
              {mainItems.map(renderItem)}
            </>
          )}
        </nav>
      </aside>
    </>
  );
}
