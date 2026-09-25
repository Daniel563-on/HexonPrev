// Sidebar.tsx - Hexon OS Sidebar Navigation
import { 
  LayoutGrid, 
  ClipboardCheck, 
  BellRing, 
  Boxes, 
  Sliders, 
  ShieldCheck, 
  QrCode,
  MapPin,
  X 
} from 'lucide-react';
import { HexonUser } from '../types';

interface SidebarProps {
  currentTab: string;
  onChangeTab: (tab: string) => void;
  isOpen?: boolean;
  onClose?: () => void;
  pendingSolicitationsCount?: number; // solicitações de corretiva pendentes de ação (já filtradas pela gerência)
  userProfile: HexonUser | null;
  userHasTabPermission: (tab: string) => boolean;
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
  const activeSolicitationsCount = pendingSolicitationsCount;

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
        className={`fixed lg:static top-0 bottom-0 left-0 h-screen w-[280px] bg-[#0A101D] border-r border-slate-800/80 flex flex-col py-6 shadow-2xl lg:shadow-xl shrink-0 z-50 text-white font-sans transition-transform duration-300 ease-in-out print:hidden ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Brand Header */}
        <div className="px-6 mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative h-9 w-9 flex items-center justify-center shrink-0">
              <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full text-indigo-500" fill="none">
                <path d="M50 5L90 28V72L50 95L10 72V28L50 5Z" fill="#1e1b4b" fillOpacity="0.4" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M50 25L72 38V62L50 75L28 62V38L50 25Z" fill="currentColor" stroke="none" fillOpacity="0.8" />
              </svg>
              <span className="relative z-10 text-[10px] font-black text-white">H</span>
            </div>
            <div>
              <h1 className="text-base font-black text-white tracking-[0.2em] font-sans leading-none">HEXON</h1>
              <span className="text-[10px] text-indigo-400/90 font-bold tracking-widest font-mono uppercase block mt-1.5">
                PREVENTIVA
              </span>
            </div>
          </div>

          {/* Close button for mobile slide-out panel */}
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

        {/* Scrollable Navigation Links */}
        <nav className="flex-grow overflow-y-auto px-3 space-y-1.5 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
          <div className="px-3 pb-2 pt-1">
            <span className="text-[10px] font-bold text-indigo-400/70 uppercase tracking-widest block mb-1 font-mono">Navegação</span>
          </div>
          
          {/* Dashboard Item */}
          {userHasTabPermission('dashboard') && (
            <button
              onClick={() => {
                onChangeTab('dashboard');
                if (onClose) onClose();
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl duration-200 text-left active:scale-[0.98] transition-all cursor-pointer ${
                currentTab === 'dashboard'
                  ? 'bg-indigo-600 text-white font-bold shadow-xs'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <LayoutGrid className={`w-4 h-4 shrink-0 transition-transform duration-200 ${
                currentTab === 'dashboard' ? 'text-white scale-110' : 'text-slate-400'
              }`} />
              <span className="text-sm font-semibold tracking-tight">Dashboard e Auditoria</span>
            </button>
          )}

          {/* Preventivas Button */}
          {userHasTabPermission('service-orders') && (
            <button
              onClick={() => {
                onChangeTab('service-orders');
                if (onClose) onClose();
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl duration-200 text-left active:scale-[0.98] transition-all cursor-pointer ${
                currentTab === 'service-orders'
                  ? 'bg-indigo-600 text-white font-bold shadow-xs'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <ClipboardCheck className={`w-4 h-4 shrink-0 transition-transform duration-200 ${
                currentTab === 'service-orders' ? 'text-white scale-110' : 'text-slate-400'
              }`} />
              <span className="text-sm font-semibold tracking-tight">Preventivas</span>
            </button>
          )}

          {/* Solicitações Button */}
          {userHasTabPermission('solicitations') && (
            <button
              onClick={() => {
                onChangeTab('solicitations');
                if (onClose) onClose();
              }}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl duration-200 text-left active:scale-[0.98] transition-all cursor-pointer ${
                currentTab === 'solicitations'
                  ? 'bg-indigo-600 text-white font-bold shadow-xs'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <div className="flex items-center gap-3">
                <BellRing className={`w-4 h-4 shrink-0 transition-transform duration-200 ${
                  currentTab === 'solicitations' ? 'text-white scale-110' : 'text-slate-400'
                }`} />
                <span className="text-sm font-semibold tracking-tight">Solicitações</span>
              </div>
              
              {activeSolicitationsCount > 0 && (
                <span className="bg-rose-600 text-white text-[9.5px] font-black font-mono px-2 py-0.5 rounded-full ring-2 ring-[#0A101D] animate-pulse">
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
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl duration-200 text-left active:scale-[0.98] transition-all cursor-pointer ${
                currentTab === 'assets'
                  ? 'bg-indigo-600 text-white font-bold shadow-xs'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Boxes className={`w-4 h-4 shrink-0 transition-transform duration-200 ${
                currentTab === 'assets' ? 'text-white scale-110' : 'text-slate-400'
              }`} />
              <span className="text-sm font-semibold tracking-tight">Gestão de Ativos</span>
            </button>
          )}

          {/* Modelos e Protocolos (Parametrizador) Item */}
          {userHasTabPermission('templates') && (
            <button
              onClick={() => {
                onChangeTab('templates');
                if (onClose) onClose();
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl duration-200 text-left active:scale-[0.98] transition-all cursor-pointer ${
                currentTab === 'templates'
                  ? 'bg-indigo-600 text-white font-bold shadow-xs'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Sliders className={`w-4 h-4 shrink-0 transition-transform duration-200 ${
                currentTab === 'templates' ? 'text-white scale-110' : 'text-slate-400'
              }`} />
              <span className="text-sm font-semibold tracking-tight">Modelos e Protocolos</span>
            </button>
          )}

          {/* QR CODES BATCH MANAGEMENT: Super Administrador ONLY */}
          {isSuperAdmin && (
            <button
              id="sidebar-btn-qrcodes"
              onClick={() => {
                onChangeTab('qr-codes');
                if (onClose) onClose();
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl duration-200 text-left active:scale-[0.98] transition-all cursor-pointer ${
                currentTab === 'qr-codes'
                  ? 'bg-indigo-600 text-white font-bold shadow-xs'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <QrCode className={`w-4 h-4 shrink-0 transition-transform duration-200 ${
                currentTab === 'qr-codes' ? 'text-white scale-110' : 'text-indigo-400'
              }`} />
              <span className="text-sm font-semibold tracking-tight">QR-CODES</span>
            </button>
          )}

          {/* CONTROLE DE ENDEREÇOS: Super Administrador ONLY */}
          {isSuperAdmin && (
            <button
              onClick={() => {
                onChangeTab('addresses');
                if (onClose) onClose();
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl duration-200 text-left active:scale-[0.98] transition-all cursor-pointer ${
                currentTab === 'addresses'
                  ? 'bg-indigo-600 text-white font-bold shadow-xs'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <MapPin className={`w-4 h-4 shrink-0 transition-transform duration-200 ${
                currentTab === 'addresses' ? 'text-white scale-110' : 'text-indigo-400'
              }`} />
              <span className="text-sm font-semibold tracking-tight">Endereços</span>
            </button>
          )}

          {/* SECURE ADMIN CONTROL: Super Administrador ONLY */}
          {isSuperAdmin && (
            <button
              onClick={() => {
                onChangeTab('user-control');
                if (onClose) onClose();
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl duration-200 text-left active:scale-[0.98] transition-all cursor-pointer ${
                currentTab === 'user-control'
                  ? 'bg-amber-600 text-white font-bold shadow-xs border border-amber-500/20'
                  : 'text-slate-400 hover:text-amber-300 hover:bg-white/5'
              }`}
            >
              <ShieldCheck className={`w-4 h-4 shrink-0 transition-transform duration-200 ${
                currentTab === 'user-control' ? 'text-white scale-110' : 'text-amber-400'
              }`} />
              <span className="text-sm font-semibold tracking-tight">Controle de Usuários</span>
            </button>
          )}
        </nav>
      </aside>
    </>
  );
}
