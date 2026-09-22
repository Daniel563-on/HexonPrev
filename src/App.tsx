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
import QrCodeBatchView from './components/QrCodeBatchView';
import AccessibilityPanel from './components/AccessibilityPanel';
import PublicAssetView from './components/PublicAssetView';
import TechnicianMobileView from './components/mobile/TechnicianMobileView';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { ServiceOrder, Asset, HexonUser, SystemPermission, isSectorInGerencia } from './types';
import { 
  dbGetServiceOrders, 
  dbGetAssets,
  dbGetTemplates,
  signInHexonAnonymously, 
  testFirebaseConnection,
  subscribeToAuth,
  checkIsAnonymousAuthRestricted,
  getDatabaseMode,
  dbAutoGeneratePreventiveActivities,
  dbGetUserByEmail,
  dbGetUsers,
  dbAddAccessLog,
  dbGetPermissions,
  subscribeToUserProfile,
  dbSaveUser,
  dbUpdateUserSessionId,
  dbGetPlanningDeadlines,
  dbSavePlanningDeadline,
  dbCheckAndExpirePlanningOrders,
  PlanningDeadline
} from './db/firebase';

export default function App() {
  // Public Asset View URL query detection (for external QR code scans)
  const [publicAssetParam, setPublicAssetParam] = useState<string | null>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('public_asset') || params.get('asset_id') || params.get('patrimonio') || null;
    } catch {
      return null;
    }
  });

  const [currentTab, setCurrentTab] = useState<string>(() => {
    try {
      return localStorage.getItem('hexon_current_tab') || 'qr-codes';
    } catch {
      return 'qr-codes';
    }
  });

  useEffect(() => {
    if (currentTab) {
      try {
        localStorage.setItem('hexon_current_tab', currentTab);
      } catch (e) {
        // ignore
      }
    }
  }, [currentTab]);
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [scannedAssetId, setScannedAssetId] = useState<string | null>(null);
  const [openCreateModalDirectly, setOpenCreateModalDirectly] = useState(false);
  const [highlightedOSId, setHighlightedOSId] = useState<string | null>(null);

  // Mobile device screen detection
  const [isMobileScreen, setIsMobileScreen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => {
      setIsMobileScreen(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  // 1. Same-Browser Duplicate Tab Protection states
  const [isDuplicate, setIsDuplicate] = useState(false);
  const [tabId] = useState(() => 'tab_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9));
  
  // 2. Visible Tab Auto-Sync & Hibernation states
  const [lastSyncTime, setLastSyncTime] = useState<number>(Date.now());

  // 3. Sessão Única states
  const [sessionDisplaced, setSessionDisplaced] = useState<boolean>(false);
  
  // Custom User Profile State - strictly null unless active authenticated session exists on this browser
  const [userProfile, setUserProfile] = useState<HexonUser | null>(() => {
    try {
      // If URL is a public QR code scan, never preload any user profile
      const search = window.location.search;
      if (search.includes('public_asset=') || search.includes('asset_id=') || search.includes('patrimonio=')) {
        return null;
      }
      const cached = localStorage.getItem('hexon_cached_user');
      const sessionId = localStorage.getItem('hexon_current_session_id');
      if (cached && sessionId) {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.matricula) return parsed;
      }
    } catch {}
    return null;
  });
  const [permissionsMatrix, setPermissionsMatrix] = useState<{ [key: string]: SystemPermission } | null>(null);
  const [sessionChecking, setSessionChecking] = useState<boolean>(false);
  
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
    localStorage.setItem('hexon_font-scale', fontScale.toString());
  }, [fontScale]);

  // =============== SECURITY & OPTIMIZATION ENGINES ===============
  
  // 1. Same-Browser Duplicate Tab Protection
  useEffect(() => {
    if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return;

    const channel = new BroadcastChannel('hexon_tabs_channel');

    const handleMessage = (event: MessageEvent) => {
      const { type, senderTabId } = event.data || {};
      if (senderTabId === tabId) return;

      if (type === 'HELO') {
        // Another tab is saying hello, respond that we are active
        channel.postMessage({ type: 'ALIVE', senderTabId: tabId });
      } else if (type === 'ALIVE') {
        // Someone responded! It means there was already an active tab before us.
        setIsDuplicate(true);
      } else if (type === 'HIJACK') {
        // Another tab has taken over (hijacked) the active role!
        setIsDuplicate(true);
      }
    };

    channel.addEventListener('message', handleMessage);

    // Broadcast our arrival
    channel.postMessage({ type: 'HELO', senderTabId: tabId });

    return () => {
      channel.removeEventListener('message', handleMessage);
      channel.close();
    };
  }, [tabId]);

  const handleHijackedClaim = () => {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      const channel = new BroadcastChannel('hexon_tabs_channel');
      channel.postMessage({ type: 'HIJACK', senderTabId: tabId });
      channel.close();
    }
    setIsDuplicate(false);
  };

  // 2. Visible Tab Auto-Sync & Hibernation (Visibility API)
  useEffect(() => {
    if (!userProfile) return;

    let intervalId: any = null;

    const runSync = async () => {
      console.log('Sincronização periódica em primeiro plano ativa...');
      await loadServiceOrders();
      await loadPermissions();
      setLastSyncTime(Date.now());
    };

    const startTimer = () => {
      if (intervalId) clearInterval(intervalId);
      // Run auto-refresh every 5 minutes (300000ms)
      intervalId = setInterval(runSync, 300000);
    };

    const stopTimer = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        console.log('Aba do Hexon em segundo plano. Hibernando temporizadores de sincronia...');
        stopTimer();
      } else {
        console.log('Aba do Hexon restaurada ao primeiro plano. Retomando temporizadores.');
        startTimer();
        
        // If more than 5 minutes have passed since the last sync, trigger an immediate foreground sync
        const elapsed = Date.now() - lastSyncTime;
        if (elapsed >= 300000) {
          runSync();
        }
      }
    };

    // Initialize timer on active profile
    if (!document.hidden) {
      startTimer();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [userProfile, lastSyncTime]);

  // 3. Real-time Single Session per Account Sync
  useEffect(() => {
    if (!userProfile?.id) return;

    const { isFirebase } = getDatabaseMode();
    if (!isFirebase) return;

    const localSessionId = localStorage.getItem('hexon_current_session_id');
    if (!localSessionId) return;

    let isInitialSnapshot = true;

    // Listen to changes in the active user's document
    const unsubscribe = subscribeToUserProfile(userProfile.id, (dbUser) => {
      if (!dbUser) return;
      
      // If user status became inactive, terminate session
      if (dbUser.status === 'Inativo') {
        handleLogoutState();
        alert('Seu perfil de usuário foi inativado pela administração.');
        return;
      }

      const activeLocalSession = localStorage.getItem('hexon_current_session_id');

      // Initial snapshot safeguard: If remote hasn't received local ID yet due to network transit,
      // synchronize it now and do NOT trigger false displacement.
      if (isInitialSnapshot) {
        isInitialSnapshot = false;
        if (activeLocalSession && dbUser.currentSessionId !== activeLocalSession) {
          dbUpdateUserSessionId(userProfile.id, activeLocalSession).catch(() => {});
          return;
        }
      }

      // If a modern currentSessionId is specified, and it doesn't match our local ID, trigger displacement:
      if (dbUser.currentSessionId && activeLocalSession && dbUser.currentSessionId !== activeLocalSession) {
        console.warn(`Sessão deslocada! ID Remoto: ${dbUser.currentSessionId}, ID Local: ${activeLocalSession}`);
        handleLogoutState();
        setSessionDisplaced(true);
      }
    });

    return () => unsubscribe();
  }, [userProfile?.id]);

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
      await dbCheckAndExpirePlanningOrders();
      const [list, assetsList, templatesList] = await Promise.all([
        dbGetServiceOrders(),
        dbGetAssets().catch(() => []),
        dbGetTemplates().catch(() => [])
      ]);
      setOrders(list);
      if (assetsList && assetsList.length > 0) {
        setAssets(assetsList);
      }
      if (templatesList && templatesList.length > 0) {
        setTemplates(templatesList);
      }
    } catch (err) {
      console.error('Failed loading service orders and assets:', err);
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
        
        // Try restoring sessions locally ONLY if the user previously logged in on THIS browser
        try {
          const search = window.location.search;
          const isPublicScan = search.includes('public_asset=') || search.includes('asset_id=') || search.includes('patrimonio=');

          if (!isPublicScan) {
            const savedCached = localStorage.getItem('hexon_cached_user');
            const savedSessionId = localStorage.getItem('hexon_current_session_id');

            if (savedCached && savedSessionId) {
              let parsedUser: HexonUser | null = null;
              try {
                parsedUser = JSON.parse(savedCached);
              } catch {}

              if (parsedUser && (parsedUser.id || parsedUser.matricula)) {
                // Fetch fresh users from database to confirm active status
                const users = await dbGetUsers(true);
                const foundUser = users.find(u => 
                  (u.id === parsedUser!.id || u.matricula.trim().toLowerCase() === (parsedUser!.matricula || '').trim().toLowerCase()) && 
                  u.status === 'Ativo'
                );

                if (foundUser) {
                  // Only restore if this device's sessionId still matches the active session in Firestore
                  if (!foundUser.currentSessionId || foundUser.currentSessionId === savedSessionId) {
                    if (!foundUser.currentSessionId) {
                      dbUpdateUserSessionId(foundUser.id, savedSessionId).catch(() => {});
                    }
                    const synchronizedUser = { ...foundUser, currentSessionId: savedSessionId };
                    // Ensure local cache has the most recent user document
                    localStorage.setItem('hexon_cached_user', JSON.stringify(synchronizedUser));
                    setUserProfile(synchronizedUser);

                    // Automatically send field technicians (Profissional) to "Preventivas" (service-orders)
                    if (foundUser.perfil === 'Profissional') {
                      setCurrentTab('service-orders');
                    } else {
                      const savedTab = localStorage.getItem('hexon_current_tab') || 'dashboard';
                      if (savedTab && (savedTab !== 'user-control' || foundUser.perfil === 'Super Administrador')) {
                        setCurrentTab(savedTab);
                      }
                    }
                  } else {
                    // Session was replaced by a newer login elsewhere
                    console.warn('Sessão remota não coincide com o ID local, efetuando logout.');
                    handleLogoutState();
                  }
                } else {
                  console.warn('Usuário não localizado ou inativado no banco de dados.');
                  handleLogoutState();
                }
              }
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
    localStorage.removeItem('hexon_cached_user');
    localStorage.removeItem('hexon_current_session_id');
    setUserProfile(null);
    setCurrentUser(null);
  };

  const handleLoginSuccess = async (profile: HexonUser) => {
    const sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    localStorage.setItem('hexon_current_session_id', sessionId);
    const updatedUser = { ...profile, currentSessionId: sessionId };
    
    // CRITICAL: Persist user profile to localStorage so page refreshes (F5) maintain the session
    localStorage.setItem('hexon_cached_user', JSON.stringify(updatedUser));
    
    // 1. Register session in Firestore BEFORE activating userProfile state so real-time listeners don't see stale data
    try {
      await dbUpdateUserSessionId(profile.id, sessionId);
    } catch (e) {
      console.warn('Erro ao atualizar sessionId do usuário no Firestore:', e);
    }

    // 2. Clear any displacement modal and mount authenticated view
    setSessionDisplaced(false);
    setUserProfile(updatedUser);
    
    // Automatically send field technicians (Profissional) to "Preventivas" (service-orders)
    if (updatedUser.perfil === 'Profissional') {
      setCurrentTab('service-orders');
    } else {
      const savedTab = localStorage.getItem('hexon_current_tab');
      if (savedTab && (savedTab !== 'user-control' || updatedUser.perfil === 'Super Administrador')) {
        setCurrentTab(savedTab);
      } else {
        setCurrentTab('dashboard');
      }
    }

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
        return 'Dashboard e Auditoria';
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
      case 'qr-codes':
        return 'Central de Etiquetas & QR-Codes';
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

  // 1. Same-Browser Duplicate Tab Blocker Overlay
  if (isDuplicate) {
    return (
      <div className={`min-h-screen w-screen flex flex-col justify-center items-center p-6 ${darkMode ? 'dark bg-[#0A101D] text-slate-100' : 'bg-slate-50 text-slate-900'} font-sans`}>
        <div className="max-w-md w-full bg-[#0A101D] border border-slate-800/80 rounded-2xl p-8 shadow-2xl text-center space-y-6">
          <div className="w-16 h-16 bg-amber-500/15 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-2 animate-bounce">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          
          <div className="space-y-2">
            <h2 className="text-xl font-extrabold text-white tracking-tight uppercase">Abas Duplicadas Detectadas</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Detectamos que o <strong className="text-indigo-400">Hexon</strong> já está operando em outra aba aberta neste mesmo navegador.
            </p>
          </div>

          <div className="p-4 bg-slate-900/70 rounded-xl text-[11px] text-slate-300 text-left space-y-1.5 font-medium leading-relaxed border border-slate-800">
            <p><strong className="text-amber-400">Proteção de Recursos:</strong> O Hexon suspende execuções redundantes para sincronizar dados sem leituras excessivas ou conflitos de formulário no mesmo navegador.</p>
            <p>Escolha como deseja prosseguir com segurança:</p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              onClick={handleHijackedClaim}
              className="flex-1 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold tracking-wider uppercase transition-all active:scale-95 cursor-pointer shadow-xs"
            >
              Usar nesta aba
            </button>
            <button
              onClick={() => {
                window.close();
                // Fallback if window.close() is blocked by browser rules
                alert("Você já possui outra aba ativa. Pode simplesmente mudar de aba ou fechá-la manualmente.");
              }}
              className="flex-1 px-4 py-3 border border-slate-700 hover:bg-slate-900 text-slate-300 rounded-xl text-xs font-bold tracking-wider uppercase transition-all active:scale-95 cursor-pointer"
            >
              Fechar esta aba
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. Different-Device Displaced Session Overlay
  if (sessionDisplaced) {
    return (
      <div className={`min-h-screen w-screen flex flex-col justify-center items-center p-6 ${darkMode ? 'dark bg-[#0A101D] text-slate-100' : 'bg-slate-50 text-slate-900'} font-sans`}>
        <div className="max-w-md w-full bg-[#0A101D] border border-slate-800/80 rounded-2xl p-8 shadow-2xl text-center space-y-6">
          <div className="w-16 h-16 bg-rose-500/15 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-2 animate-pulse">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          
          <div className="space-y-2">
            <h2 className="text-xl font-extrabold text-white tracking-tight uppercase">Sessão Expirada</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Seu perfil de acesso no Hexon foi conectado recentemente de outro navegador ou dispositivo.
            </p>
          </div>

          <div className="p-4 bg-[#111c35] rounded-xl text-[11px] text-slate-350 text-left space-y-1.5 font-medium leading-relaxed border border-slate-800">
            <p><strong className="text-rose-400">Segurança Corporativa:</strong> Para conformidade de auditoria e rastreabilidade nas assinaturas de preventivas, apenas uma conexão ativa por usuário é permitida ao mesmo tempo.</p>
          </div>

          <div className="pt-2">
            <button
              onClick={() => {
                setSessionDisplaced(false);
              }}
              className="w-full px-5 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold tracking-wider uppercase transition-all active:scale-95 cursor-pointer shadow-xs"
            >
              Entrar Novamente
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Rendering Session Initializing loader (Sleek minimalist panel)
  if (sessionChecking) {
    return (
      <div className="h-screen w-screen bg-[#0A101D] flex flex-col items-center justify-center font-sans text-white">
        <div className="bg-[#0A101D] p-8 rounded-2xl border border-slate-800/80 shadow-2xl flex flex-col items-center max-w-sm text-center">
          <div className="relative h-14 w-14 mb-5 flex items-center justify-center shrink-0">
            <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full text-indigo-500 animate-pulse" fill="none">
              <path d="M50 5L90 28V72L50 95L10 72V28L50 5Z" fill="#1e1b4b" fillOpacity="0.4" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M50 25L72 38V62L50 75L28 62V38L50 25Z" fill="currentColor" stroke="none" fillOpacity="0.8" />
            </svg>
            <span className="relative z-10 text-xs font-black text-white">H</span>
          </div>
          <h2 className="text-base font-black tracking-widest uppercase text-white font-sans">HEXON PREVENTIVA</h2>
          <p className="text-xs text-slate-400 mt-2">Carregando credenciais e restabelecendo persistência no Firestore...</p>
          <div className="mt-6 flex gap-1 items-center justify-center">
            <span className="w-2 h-2 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-2 h-2 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-2 h-2 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      </div>
    );
  }

  // PUBLIC ASSET VIEW (External QR Code Scanning)
  if (publicAssetParam) {
    return (
      <PublicAssetView 
        assetIdentifier={publicAssetParam}
        onGoToLogin={() => {
          setPublicAssetParam(null);
          handleLogoutState();
          window.history.replaceState({}, document.title, window.location.pathname);
        }}
      />
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

  // DEDICATED FIELD TECHNICIAN EXPERIENCE
  // Exclusively for 'Profissional' profile - only this operational view exists for technicians
  if (userProfile.perfil === 'Profissional') {
    return (
      <TechnicianMobileView
        orders={orders}
        assets={assets}
        templates={templates}
        userProfile={userProfile}
        onReloadOrders={loadServiceOrders}
        darkMode={darkMode}
        onToggleDarkMode={handleToggleDarkMode}
        fontScale={fontScale}
        setFontScale={setFontScale}
        highContrast={highContrast}
        setHighContrast={setHighContrast}
        onLogout={handleLogoutState}
        onUpdateUserProfile={(updated) => setUserProfile(updated)}
      />
    );
  }

  return (
    <div className={`h-screen w-screen flex overflow-hidden select-none font-sans transition-colors duration-150 print:h-auto print:w-auto print:overflow-visible print:block print:bg-white print:text-black ${darkMode ? 'bg-[#0A101D] text-slate-100' : 'bg-slate-50 text-slate-900'}`}>
      
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
      <main className="flex-grow flex flex-col min-w-0 relative h-full print:h-auto print:overflow-visible print:block print:bg-white">
        
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
          onUpdateUserProfile={(updated) => setUserProfile(updated)}
        />

        {/* COMPARTIMENTALIZED SCROLLABLE SUBVIEW PANEL */}
        <div className={`flex-1 overflow-y-auto p-6 transition-colors duration-150 print:overflow-visible print:h-auto print:p-0 print:bg-white ${darkMode ? 'bg-[#0A101D]' : 'bg-slate-50'}`}>
          
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

          {currentTab === 'qr-codes' && (
            <QrCodeBatchView 
              userProfile={userProfile}
              darkMode={darkMode}
            />
          )}

        </div>
        
      </main>

      {/* Floating Non-Blocking Toast Containers (Replaces Intrusive Pop-up Notifications) */}
      <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-4 sm:px-0 print:hidden">
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
