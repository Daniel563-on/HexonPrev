import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Navbar from './components/Navbar';
import DashboardView from './components/DashboardView';
import AssetsView from './components/AssetsView';
import ServiceOrdersView from './components/ServiceOrdersView';
import TemplatesView from './components/TemplatesView';
import SolicitationsView from './components/SolicitationsView';
import LoginView from './components/LoginView';
import UserControlView from './components/UserControlView';
import AccessibilityPanel from './components/AccessibilityPanel';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { ServiceOrder, HexonUser, SystemPermission, isSectorInGerencia } from './types';
import { 
  dbGetServiceOrders, 
  signInHexonAnonymously, 
  testFirebaseConnection,
  subscribeToAuth,
  checkIsAnonymousAuthRestricted,
  getDatabaseMode,
  dbAutoGeneratePreventiveActivities,
  dbGetUserByEmail,
  dbGetUsers,
  dbAddAccessLog,
  dbGetPermissions
} from './db/firebase';

export default function App() {
  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [scannedAssetId, setScannedAssetId] = useState<string | null>(null);
  const [openCreateModalDirectly, setOpenCreateModalDirectly] = useState(false);
  const [highlightedOSId, setHighlightedOSId] = useState<string | null>(null);
  
  // Custom User Profile State
  const [userProfile, setUserProfile] = useState<HexonUser | null>(null);
  const [permissionsMatrix, setPermissionsMatrix] = useState<{ [key: string]: SystemPermission } | null>(null);
  const [sessionChecking, setSessionChecking] = useState<boolean>(true);
  
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [authRestricted, setAuthRestricted] = useState<boolean>(false);
  const [dismissedWarning, setDismissedWarning] = useState<boolean>(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  
  const [dismissedQuotaWarning, setDismissedQuotaWarning] = useState<boolean>(false);

  // Custom Toast Notifications State
  interface Toast {
    id: string;
    message: string;
    type: 'success' | 'warning' | 'info';
  }
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const handleAlert = (msg: string) => {
      const id = 'toast_' + Math.random().toString(36).substring(2, 9);
      let type: 'success' | 'warning' | 'info' = 'info';

      const lower = msg.toLowerCase();
      if (lower.includes('✅') || lower.includes('sucesso') || lower.includes('concluída') || lower.includes('salvas com sucesso')) {
        type = 'success';
      } else if (
        lower.includes('⚠️') || 
        lower.includes('erro') || 
        lower.includes('restrito') || 
        lower.includes('🚫') || 
        lower.includes('impossível') || 
        lower.includes('falta') ||
        lower.includes('erro')
      ) {
        type = 'warning';
      }

      setToasts(prev => [...prev, { id, message: msg, type }]);

      // Auto dismiss after 4.5 seconds
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 4500);
    };

    if (typeof window !== 'undefined') {
      (window as any).__onCustomAlert = handleAlert;
    }

    return () => {
      if (typeof window !== 'undefined') {
        (window as any).__onCustomAlert = (msg: string) => {
          console.info('Silenced pop-up alert:', msg);
        };
      }
    };
  }, []);

  // Live Accessibility Engines (Dark Theme & Font Sizing)
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('hexon-dark-mode') === 'true';
  });
  const [fontScale, setFontScale] = useState<number>(() => {
    return parseFloat(localStorage.getItem('hexon-font-scale') || '1');
  });
  const [highContrast, setHighContrast] = useState<boolean>(() => {
    return localStorage.getItem('hexon-high-contrast') === 'true';
  });
  const [daltonism, setDaltonism] = useState<string>(() => {
    return localStorage.getItem('hexon-daltonism') || 'none';
  });

  // Track and apply Theme updates
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('hexon-dark-mode', 'true');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('hexon-dark-mode', 'false');
    }
  }, [darkMode]);

  // Track and apply High Contrast updates
  useEffect(() => {
    if (highContrast) {
      document.documentElement.classList.add('high-contrast');
      localStorage.setItem('hexon-high-contrast', 'true');
    } else {
      document.documentElement.classList.remove('high-contrast');
      localStorage.setItem('hexon-high-contrast', 'false');
    }
  }, [highContrast]);

  // Track and apply Daltonism updates
  useEffect(() => {
    document.documentElement.classList.remove('daltonism-protanopia', 'daltonism-deuteranopia', 'daltonism-tritanopia');
    if (daltonism && daltonism !== 'none') {
      document.documentElement.classList.add(`daltonism-${daltonism}`);
    }
    localStorage.setItem('hexon-daltonism', daltonism);
  }, [daltonism]);

  // Track and apply Font Size scale
  useEffect(() => {
    document.documentElement.style.fontSize = `${fontScale * 14}px`;
    localStorage.setItem('hexon-font-scale', fontScale.toString());
  }, [fontScale]);

  const handleToggleDarkMode = () => {
    setDarkMode(!darkMode);
  };

  const handleToggleFontScale = () => {
    setFontScale(prev => {
      if (prev === 1) return 1.15; // Cycle: Normal -> +15%
      if (prev === 1.15) return 1.30; // Cycle: +15% -> +30%
      return 1; // Cycle: +30% -> Normal
    });
  };

  // Load and refresh lists from DB
  const loadServiceOrders = async () => {
    try {
      const list = await dbGetServiceOrders();
      setOrders(list);
    } catch (err) {
      console.error('Failed loading service orders:', err);
    }
  };

  const loadPermissions = async () => {
    try {
      const matrix = await dbGetPermissions();
      setPermissionsMatrix(matrix);
    } catch (e) {
      console.warn('Failed loading permissions matrix in App:', e);
    }
  };

  const userHasTabPermission = (tab: string): boolean => {
    if (!userProfile) return false;
    if (userProfile.perfil === 'Super Administrador') return true;
    if (tab === 'user-control') return false; // Strictly restricted to Super Administrador

    let permId = '';
    if (tab === 'dashboard') permId = 'view_dashboard';
    else if (tab === 'service-orders') permId = 'view_service_orders';
    else if (tab === 'assets') permId = 'view_assets';
    else if (tab === 'templates') permId = 'view_templates';
    else if (tab === 'solicitations') permId = 'view_solicitations';

    if (!permId) return true;

    // Fallback safe defaults if permissions not loaded yet
    if (!permissionsMatrix) {
      if (tab === 'templates') return userProfile.perfil !== 'Profissional';
      return true;
    }

    const permission = permissionsMatrix[permId];
    if (!permission) return true;

    return !!permission.roles[userProfile.perfil];
  };

  const userHasActionPermission = (actionId: string): boolean => {
    if (!userProfile) return false;
    if (userProfile.perfil === 'Super Administrador') return true;

    // Fallback safe defaults if permissions not loaded yet
    if (!permissionsMatrix) {
      if (actionId === 'delete_asset' || actionId === 'delete_order') {
        return false; // strictly Super Admin
      }
      if (actionId === 'create_asset' || actionId === 'import_assets' || actionId === 'create_order' || actionId === 'manage_templates') {
        return userProfile.perfil === 'Administrador';
      }
      return true; // Tech field professional permissions
    }

    const permission = permissionsMatrix[actionId];
    if (!permission) return true;

    return !!permission.roles[userProfile.perfil];
  };

  // Check state bypasses manually (Security Guard)
  useEffect(() => {
    if (!userProfile) return;

    // 1. Strict Security Guard: only Super Administrador can access 'user-control'
    if (currentTab === 'user-control' && userProfile.perfil !== 'Super Administrador') {
      setCurrentTab('dashboard');
      alert('Acesso Restrito: Somente o Super Administrador corporativo conta com privilégios para acessar a central de controle de acessos.');
      return;
    }

    // 2. Dynamic permission matrix check for other tabs
    if (currentTab !== 'dashboard' && !userHasTabPermission(currentTab)) {
      setCurrentTab('dashboard');
      alert('Acesso Restrito: Seu perfil de acesso atual não possui as permissões necessárias para visualizar este módulo.');
    }
  }, [currentTab, userProfile, permissionsMatrix]);

  // Bootstrapping default sequence on Application load
  useEffect(() => {
    let initialAuthChecked = false;

    // Subscribe to Firebase Authentication states
    const unsubscribe = subscribeToAuth(async (user) => {
      setCurrentUser(user);
      
      if (!user) {
        signInHexonAnonymously().then(() => {
          setAuthRestricted(checkIsAnonymousAuthRestricted());
        }).catch(err => console.warn('Background anonymous login skipped:', err));
      } else {
        setAuthRestricted(checkIsAnonymousAuthRestricted());
      }

      if (!initialAuthChecked) {
        initialAuthChecked = true;
        
        // Try restoring sessions locally before giving up
        try {
          const savedMatricula = localStorage.getItem('hexon_remembered_matricula');
          if (savedMatricula) {
            const users = await dbGetUsers();
            const foundUser = users.find(u => u.matricula === savedMatricula && u.status === 'Ativo');
            if (foundUser) {
              setUserProfile(foundUser);
              await dbAddAccessLog({
                userMatricula: foundUser.matricula,
                userName: foundUser.name,
                event: "Autenticação Automática via Credencial Lembrada",
                timestamp: new Date().toISOString()
              });
            }
          }
        } catch (e) {
          console.warn("Restore local connection error:", e);
        }

        // Fire-and-forget background connection check to avoid blocking the UI boot entirely
        testFirebaseConnection().catch(err => console.warn('Background connectivity check skipped:', err));
        
        setSessionChecking(false);
      }

      await loadPermissions();
      await loadServiceOrders();
    });

    return () => unsubscribe();
  }, []);

  const handleLogoutState = () => {
    localStorage.removeItem('hexon_remembered_matricula');
    setUserProfile(null);
    setCurrentUser(null);
  };

  const handleLoginSuccess = async (profile: HexonUser) => {
    setUserProfile(profile);
    await loadPermissions();
    await loadServiceOrders();
  };

  // Set action triggers from other tabs
  const handleNovaOSClick = () => {
    if (!userHasActionPermission('create_order')) {
      alert('Acesso Restrito: Seu perfil de atuação atual não possui permissões necessárias para registrar ou agendar preventivas.');
      return;
    }
    setCurrentTab('service-orders');
    setOpenCreateModalDirectly(true);
  };

  const handleSelectScannedAsset = (assetId: string) => {
    setScannedAssetId(assetId);
    setCurrentTab('assets');
  };

  const clearScannedAsset = () => {
    setScannedAssetId(null);
  };

  const handleNavigateToOS = (osId?: string) => {
    setHighlightedOSId(osId || null);
    setCurrentTab('service-orders');
  };

  // Human descriptive title mapping
  const getTabTitle = () => {
    switch (currentTab) {
      case 'dashboard':
        return 'Dashboard de Controle';
      case 'service-orders':
        return 'Ordens de Serviço';
      case 'assets':
        return 'Gerenciamento de Ativos';
      case 'templates':
        return 'Modelos e Protocolos';
      case 'solicitations':
        return 'Solicitações';
      case 'user-control':
        return 'Painel de Controle e Auditoria';
      default:
        return 'Console Hexon';
    }
  };

  // RESTRICT ORDER DATA SOURCE BASED ON LOGGED USER COMPLIANCE LEVEL
  const getFilteredOrders = () => {
    if (!userProfile) return [];
    
    let filtered = [...orders];
    
    // 1. Professional can only see orders assigned to her/his name AND belonging to her/his specific gerência
    if (userProfile.perfil === 'Profissional') {
      filtered = filtered.filter(o => 
        o.assignedTechnician === userProfile.name && 
        isSectorInGerencia(o.sector, userProfile.gerencia)
      );
    } 
    // 2. Administrator can only see orders from her/his specific gerência (sector)
    else if (userProfile.perfil === 'Administrador' && userProfile.gerencia && userProfile.gerencia !== 'Todas') {
      filtered = filtered.filter(o => {
        return isSectorInGerencia(o.sector, userProfile.gerencia);
      });
    }
    
    return filtered;
  };

  const filteredOrders = getFilteredOrders();

  // Rendering Session Initializing loader (Sleek minimalist panel)
  if (sessionChecking) {
    return (
      <div className="h-screen w-screen bg-[#07111e] flex flex-col items-center justify-center font-sans text-white">
        <div className="bg-[#0b1c30] p-8 rounded-2xl border border-slate-800 shadow-2xl flex flex-col items-center max-w-sm text-center">
          <div className="relative w-16 h-16 mb-6 flex items-center justify-center shrink-0">
            <svg viewBox="0 0 100 100" className="w-full h-full animate-pulse">
              <polygon points="50,5 91,28 91,77 50,95 9,77 9,28" className="fill-[#1F1CCF] stroke-[#3525CD] stroke-2" />
              <text x="50" y="58" textAnchor="middle" dominantBaseline="middle" className="fill-white font-sans font-black text-3xl">H</text>
            </svg>
          </div>
          <h2 className="text-lg font-black tracking-wider uppercase text-blue-400">Verificando Sessão</h2>
          <p className="text-xs text-slate-450 mt-2">Carregando credenciais criptografadas e restabelecendo persistência no Firestore...</p>
          <div className="mt-6 flex gap-1 items-center justify-center">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      </div>
    );
  }

  // FORCE LOGIN IF NO VALID ACTIVE USER IS LOGGED IN
  if (!userProfile) {
    return (
      <LoginView 
        onLoginSuccess={handleLoginSuccess}
        darkMode={darkMode}
      />
    );
  }

  return (
    <div className={`h-screen w-screen flex overflow-hidden select-none font-sans transition-colors duration-150 ${darkMode ? 'bg-[#060d17] text-slate-100' : 'bg-[#f8f9ff] text-[#0b1c30]'}`}>
      
      {/* LEFT SIDEBAR: Responsive drawer on mobile, persistent on desktop */}
      <Sidebar 
        currentTab={currentTab} 
        onChangeTab={setCurrentTab} 
        isOpen={isSidebarOpen} 
        onClose={() => setIsSidebarOpen(false)} 
        onNovaOS={handleNovaOSClick}
        orders={orders}
        userProfile={userProfile}
        userHasTabPermission={userHasTabPermission}
      />

      {/* RIGHT DISPLAY TERMINAL */}
      <main className="flex-grow flex flex-col min-w-0 relative h-full">
        
        {/* TOP COMPLIANCE NAVBAR */}
        <Navbar 
          tabTitle={getTabTitle()} 
          userProfile={userProfile} 
          onLogout={handleLogoutState} 
          onMenuToggle={() => setIsSidebarOpen(true)} 
          darkMode={darkMode}
          onToggleDarkMode={handleToggleDarkMode}
          fontScale={fontScale}
          setFontScale={setFontScale}
          highContrast={highContrast}
          setHighContrast={setHighContrast}
          daltonism={daltonism}
          setDaltonism={setDaltonism}
          currentTab={currentTab}
          orders={orders}
        />

        {/* COMPARTIMENTALIZED SCROLLABLE SUBVIEW PANEL */}
        <div className={`flex-1 overflow-y-auto p-6 transition-colors duration-150 ${darkMode ? 'bg-[#060d17]' : 'bg-[#f8f9ff]'}`}>
          
          {typeof window !== 'undefined' && (window as any).__hexonFirebaseQuotaExceeded && !dismissedQuotaWarning && (
            <div className="mb-6 bg-red-50 dark:bg-red-950/20 border border-red-300 dark:border-red-900/50 rounded-xl p-5 shadow-sm text-red-900 dark:text-red-200 font-sans relative">
              {/* Close Button */}
              <button 
                onClick={() => setDismissedQuotaWarning(true)}
                className="absolute top-3 right-3 text-red-700 hover:text-red-900 dark:text-red-400 dark:hover:text-red-200 p-1 rounded-full cursor-pointer transition-colors"
                title="Ignorar aviso"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <div className="flex items-start gap-3 pr-6 animate-fade-in">
                <span className="material-symbols-outlined text-red-600 dark:text-red-400 text-2xl shrink-0 mt-0.5">cloud_off</span>
                <div>
                  <h4 className="font-bold text-sm text-red-950 dark:text-red-100">Alerta de Cota do Firebase Ativo</h4>
                  <p className="text-xs text-red-800 dark:text-red-300 mt-1 leading-relaxed">
                    A cota de uso ou limite de taxa (Rate Limit) do Firestore no plano de testes gratuito foi atingida.
                    O sistema continua configurado para ler e salvar dados **exclusivamente e diretamente no banco de dados do Firebase**.
                    Recomendamos verificar o plano atrelado ou as regras de requisições no console do Firebase para normalização integral do tráfego em tempo real.
                  </p>
                </div>
              </div>
            </div>
          )}

          {currentTab === 'dashboard' && (
            <DashboardView 
              orders={filteredOrders} 
              onNavigateToOS={handleNavigateToOS}
              onNavigateToAssets={() => setCurrentTab('assets')}
              onNovaOS={handleNovaOSClick}
              onNavigateToSolicitations={() => setCurrentTab('solicitations')}
              userProfile={userProfile}
            />
          )}

          {currentTab === 'service-orders' && (
            <ServiceOrdersView 
              orders={filteredOrders}
              onReload={loadServiceOrders}
              openCreateModalDirectly={openCreateModalDirectly}
              onCloseDirectCreateModal={() => setOpenCreateModalDirectly(false)}
              highlightOSId={highlightedOSId}
              userProfile={userProfile}
              userHasActionPermission={userHasActionPermission}
            />
          )}

          {currentTab === 'assets' && (
            <AssetsView 
              onSelectScannedAsset={handleSelectScannedAsset}
              scannedAssetId={scannedAssetId}
              clearScannedAsset={clearScannedAsset}
              userProfile={userProfile}
              orders={orders}
              userHasActionPermission={userHasActionPermission}
            />
          )}

          {currentTab === 'templates' && (
            <TemplatesView 
              onTemplatesUpdated={loadServiceOrders}
            />
          )}

          {currentTab === 'solicitations' && (
            <SolicitationsView 
              orders={filteredOrders}
              onNavigateToOS={handleNavigateToOS}
              onReload={loadServiceOrders}
              userProfile={userProfile}
              userHasActionPermission={userHasActionPermission}
            />
          )}

          {currentTab === 'user-control' && (
            <UserControlView 
              currentUserProfile={userProfile}
              darkMode={darkMode}
            />
          )}

        </div>
        
      </main>

      {/* Floating Non-Blocking Toast Containers (Replaces Intrusive Pop-up Notifications) */}
      <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-4 sm:px-0">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl border shadow-lg transition-all duration-300 animate-in slide-in-from-right-5 ${
              toast.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/90 border-emerald-200 dark:border-emerald-800 text-emerald-950 dark:text-emerald-100'
                : toast.type === 'warning'
                ? 'bg-amber-50 dark:bg-amber-950/90 border-amber-200 dark:border-amber-800 text-amber-950 dark:text-amber-100'
                : 'bg-indigo-50 dark:bg-indigo-950/90 border-indigo-200 dark:border-indigo-800 text-indigo-950 dark:text-indigo-100'
            }`}
          >
            {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />}
            {toast.type === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />}
            {toast.type === 'info' && <Info className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />}

            <div className="flex-1 text-xs font-bold leading-relaxed whitespace-pre-line">
              {toast.message}
            </div>

            <button
              onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
              className="p-1 -mr-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors rounded-lg hover:bg-black/5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
