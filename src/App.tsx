import { useState, useEffect, useMemo } from 'react';
import Sidebar from './components/Sidebar';
import Navbar from './components/Navbar';
import HomeView from './components/HomeView';
import SettingsView from './components/SettingsView';
import EmitOsView from './components/os/EmitOsView';
import OrdersHubView from './components/os/OrdersHubView';
import AssetsView from './components/AssetsView';
import ServiceOrdersView from './components/ServiceOrdersView';
import TemplatesView from './components/TemplatesView';
import SolicitationsHub from './components/solicitations/SolicitationsHub';
import SupplyRequestsBoard from './components/supplies/SupplyRequestsBoard';
import LoginView from './components/LoginView';
import UserControlView from './components/UserControlView';
import AddressesView from './components/AddressesView';
import QrCodeBatchView from './components/QrCodeBatchView';
import MaterialsView from './components/materials/MaterialsView';
import AccessibilityPanel from './components/AccessibilityPanel';
import PublicAssetView from './components/PublicAssetView';
import TechnicianMobileView from './components/mobile/TechnicianMobileView';
import MaintenanceScreen from './components/MaintenanceScreen';
import BrandLogo from './components/BrandLogo';
import BrandBackground from './components/BrandBackground';
import { AppControl, subscribeAppControl, takeDataVersionChange, waitPendingWrites } from './db/appControl';
import { onSyncChange } from './db/localSync';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { ServiceOrder, Asset, HexonUser, SystemPermission, AccessProfile, MaterialRequest, SupplyRequest, isSectorInGerencia } from './types';
import { 
  subscribeTechnicianOrders,
  subscribeUnitOrders,
  stopOrderSync,
  refreshCadastros,
  dbGetManagements,
  subscribePendingSolicitations,
  subscribePendingMaterialRequests,
  subscribeSupplyAwaitingConfirm,
  subscribeSupplyAwaitingStore,
  isCompanyVisible,
  technicianCandidates,
  localMonthKey, 
  dbGetAssets,
  dbGetTemplates,
  signInHexonAnonymously, 
  testFirebaseConnection,
  subscribeToAuth,
  checkIsAnonymousAuthRestricted,
  getDatabaseMode,
  dbAutoGeneratePreventiveActivities,
  dbGetUsers,
  dbAddAccessLog,
  dbGetPermissions,
  dbGetProfiles,
  resolveUserProfile,
  profilePermission,
  userVisibleUnits,
  userVisibleCompanies,
  isSectorVisible,
  subscribeToUserProfile,
  dbSaveUser,
  dbUpdateUserSessionId,
  dbVerifySessionAuthenticity,
  signOutHexon,
  dbGetPlanningDeadlines,
  dbSavePlanningDeadline,
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
      return localStorage.getItem('hexon_current_tab') || 'home';
    } catch {
      return 'home';
    }
  });

  // Hexon 2.0: o Dashboard saiu; quem tinha ele salvo como última tela abre o Início
  useEffect(() => {
    if (currentTab === 'dashboard') setCurrentTab('home');
  }, [currentTab]);

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
  
  // 2. Sessão Única states
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
  // Perfis de acesso (cadastro do Super Administrador): permissões de cada usuário vêm do perfil dele
  const [accessProfiles, setAccessProfiles] = useState<AccessProfile[]>([]);
  const [sessionChecking, setSessionChecking] = useState<boolean>(false);

  // MODO MANUTENÇÃO: só o Super Administrador usa o sistema; os demais saem (depois de enviar o que estiver na fila)
  const [appControl, setAppControl] = useState<AppControl | null>(null);
  const [maintenanceLogin, setMaintenanceLogin] = useState(false);
  const [maintenanceDenied, setMaintenanceDenied] = useState(false);
  // Limpeza: cópias antigas do navegador que não são mais usadas (podiam mostrar dados velhos e ocupar espaço)
  useEffect(() => {
    try {
      ['hexon_histories', 'hexon_service_orders'].forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignora */
    }
  }, []);
  useEffect(() => subscribeAppControl(setAppControl), []);
  // Cadastros mudaram em outro aparelho (aviso do Super Admin): limpa as cópias guardadas e relê permissões/perfis
  useEffect(() => {
    if (!takeDataVersionChange(appControl)) return;
    refreshCadastros();
    if (userProfile) loadPermissions();
  }, [appControl]);
  const inMaintenance = !!appControl?.maintenance && userProfile?.perfil !== 'Super Administrador';
  useEffect(() => {
    if (!appControl?.maintenance) {
      setMaintenanceLogin(false);
      setMaintenanceDenied(false);
    }
    if (!appControl?.maintenance || !userProfile || userProfile.perfil === 'Super Administrador') return;
    // Quem não é Super Administrador (logado ou que tentou entrar pelo link) volta para a tela de manutenção
    if (maintenanceLogin) setMaintenanceDenied(true);
    setMaintenanceLogin(false);
    let alive = true;
    waitPendingWrites().then(() => {
      if (alive) handleLogoutState();
    });
    return () => {
      alive = false;
    };
  }, [appControl?.maintenance, userProfile?.id, userProfile?.perfil]);

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
    // Consulta pública (QR Code) não participa da proteção de abas duplicadas
    if (publicAssetParam) return;

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
  }, [tabId, publicAssetParam]);

  const handleHijackedClaim = () => {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      const channel = new BroadcastChannel('hexon_tabs_channel');
      channel.postMessage({ type: 'HIJACK', senderTabId: tabId });
      channel.close();
    }
    setIsDuplicate(false);
  };

  // 2. Action-Driven Sync: No background periodic polling is executed when idle.
  // Sincronização sob demanda estrita: tela parada consome 0 leituras no Firestore.

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

  // Mês cujas OS fechadas (Concluída / Não Executada) são carregadas; muda quando a tela de OS troca de mês
  const [ordersMonth, setOrdersMonth] = useState<string>(() => localMonthKey());

  // Unidades que o usuário enxerga dentro do sistema (null = todas), conforme o perfil de acesso
  const visibleUnits = useMemo(() => userVisibleUnits(userProfile, accessProfiles), [userProfile, accessProfiles]);
  // Empresas que o usuário enxerga (null = todas as das gerências que vê; etapa especial E2)
  const visibleCompanies = useMemo(() => userVisibleCompanies(userProfile, accessProfiles), [userProfile, accessProfiles]);
  // OS: gerências que o usuário pode escolher (quem vê todas: todas as cadastradas)

  // Quem vê todas as gerências trabalha com uma por vez (escolhida no topo da tela)
  const [managementNames, setManagementNames] = useState<string[]>([]);
  const osUnitOptions = visibleUnits === null ? managementNames : visibleUnits;
  const [adminUnit, setAdminUnit] = useState<string>(() => {
    try {
      return localStorage.getItem('hexon_admin_unit') || '';
    } catch {
      return '';
    }
  });
  useEffect(() => {
    if (!userProfile || userProfile.perfil === 'Profissional' || visibleUnits !== null) return;
    dbGetManagements()
      .then((list) => {
        const names = list.map((m) => m.name).filter((n) => n !== 'Todas');
        setManagementNames(names);
        setAdminUnit((u) => (u && names.includes(u) ? u : names[0] || ''));
      })
      .catch(() => {});
  }, [userProfile?.id, userProfile?.perfil, visibleUnits === null]);
  const changeAdminUnit = (unit: string) => {
    setAdminUnit(unit);
    try {
      localStorage.setItem('hexon_admin_unit', unit);
    } catch {}
  };
  // Gerências cujas OS ficam na cópia local deste aparelho
  const dataUnits = visibleUnits !== null ? visibleUnits : adminUnit ? [adminUnit] : [];

  // Gestão (Planejador / Super Admin): cópia local das OS no aparelho; do banco só chega o que mudou.
  // Todas as abertas + as fechadas do mês visto, das gerências acima.
  const visibleUnitsKey = visibleUnits === null ? '*' : visibleUnits.join('|');
  const dataUnitsKey = dataUnits.join('|');
  // O cadastro abre na hora (guardado no aparelho), mas o login do Firebase volta um instante depois:
  // por isso a escuta também recomeça quando o login fica pronto (senão a 1ª tela ficava sem OS)
  useEffect(() => {
    if (!userProfile || userProfile.perfil === 'Profissional') return;
    return subscribeUnitOrders(dataUnits, ordersMonth, setOrders);
  }, [userProfile?.id, userProfile?.perfil, dataUnitsKey, ordersMonth, currentUser?.uid]);

  // Técnico: OS em tempo real, só as abertas atribuídas à matrícula dele (as concluídas saem do app)
  useEffect(() => {
    if (!userProfile || userProfile.perfil !== 'Profissional') return;
    return subscribeTechnicianOrders(visibleUnits, userProfile.matricula || '', setOrders);
  }, [userProfile?.id, userProfile?.perfil, userProfile?.matricula, visibleUnitsKey]);

  // Solicitações de corretiva pendentes de ação (tempo real): contador do menu e lista da aba Solicitações
  const [pendingSolicitationOrders, setPendingSolicitationOrders] = useState<ServiceOrder[]>([]);
  useEffect(() => {
    if (!userProfile || userProfile.perfil === 'Profissional') return;
    return subscribePendingSolicitations({ units: visibleUnits }, setPendingSolicitationOrders);
  }, [userProfile?.id, userProfile?.perfil, visibleUnitsKey]);

  // Load and refresh lists from DB
  const loadServiceOrders = async (targetUser?: HexonUser | null) => {
    try {
      const activeProfile = targetUser !== undefined ? targetUser : userProfile;
      // Prazos (Atrasada / Não Executada): gravados só pela rotina da nuvem às 00:00; as telas mostram o status recalculado

      // STEP 1 OPTIMIZATION: If user is a field technician ('Profissional'), do NOT download 10,000+ assets or all orders!
      // Strictly download only the technician's assigned orders and checklist templates.
      if (activeProfile && activeProfile.perfil === 'Profissional') {
        // As OS do técnico chegam em tempo real (subscribeServiceOrders); aqui só os modelos.
        const templatesList = await dbGetTemplates().catch(() => []);
        if (templatesList && templatesList.length > 0) {
          setTemplates(templatesList);
        }
        return;
      }

      // Administrators and Super Admins: as OS chegam em tempo real (subscribeServiceOrders); aqui só os modelos.
      // NOTE: 10,000 assets are NOT downloaded here on boot; they are queried strictly on-demand when searched.
      const templatesList = await dbGetTemplates().catch(() => []);
      if (templatesList && templatesList.length > 0) {
        setTemplates(templatesList);
      }
    } catch (err) {
      console.warn('Silent sync error:', err);
    }
  };

  // Modelos de preventiva em tempo real: alteração feita em outro aparelho chega sozinha (lista vem da memória, sem ler o banco)
  useEffect(
    () =>
      onSyncChange('templates', () => {
        dbGetTemplates()
          .then((l) => {
            if (l && l.length > 0) setTemplates(l);
          })
          .catch(() => {});
      }),
    []
  );

  const loadPermissions = async () => {
    try {
      const matrix = await dbGetPermissions();
      setPermissionsMatrix(matrix);
      setAccessProfiles(await dbGetProfiles(true, userProfile?.perfil === 'Super Administrador'));
    } catch (e) {
      console.warn('Failed loading permissions matrix in App:', e);
    }
  };

  const userHasTabPermission = (tab: string): boolean => {
    if (!userProfile) return false;
    if (userProfile.perfil === 'Super Administrador') return true;
    if (tab === 'home') return true;
    // Ordens de Serviço: OS (corretiva, layout, acompanhamento) e/ou execução das preventivas
    if (tab === 'service-orders') return userHasActionPermission('os_view') || userHasActionPermission('view_service_orders');
    // Emitir OS (GLPI): quem emite
    if (tab === 'os-emit') return userHasActionPermission('os_create');
    // Configurações: o Super Administrador vê tudo; quem edita modelos de OS vê só "Modelos de OS"
    if (tab === 'settings') return userHasActionPermission('os_templates');
    // Só Super Administrador
    if (tab === 'user-control' || tab === 'qr-codes' || tab === 'addresses') return false;
    // Almoxarifado (Fase 8C-2): quem fornece insumos
    if (tab === 'almoxarifado') return userHasActionPermission('supply_requests_supply');

    let permId = '';
    const profile = resolveUserProfile(userProfile, accessProfiles);
    if (tab === 'pmoc-preventivas') permId = 'view_pmoc_planning';
    else if (tab === 'assets') permId = 'view_assets';
    else if (tab === 'templates') permId = 'view_templates';
    else if (tab === 'solicitations') permId = 'view_solicitations';
    else if (tab === 'materials') permId = 'view_materials';
    else if (tab === 'supplies') permId = 'view_supplies';

    if (!permId) return true;

    // Permissão definida no perfil do usuário (as novas herdam a antiga de onde nasceram)
    const fromProfile = profile ? profilePermission(profile, permId) : undefined;
    if (fromProfile !== undefined) return fromProfile;

    // Fallback safe defaults if permissions not loaded yet
    if (!permissionsMatrix) {
      if (tab === 'templates') return userProfile.perfil !== 'Profissional';
      if (tab === 'materials' || tab === 'supplies') return false; // padrão: só Super Administrador
      return true;
    }

    const permission = permissionsMatrix[permId];
    if (!permission) return true;

    return !!permission.roles[userProfile.perfil];
  };

  const userHasActionPermission = (actionId: string): boolean => {
    if (!userProfile) return false;
    if (userProfile.perfil === 'Super Administrador') return true;

    // Permissão definida no perfil do usuário (as novas herdam a antiga de onde nasceram)
    const profile = resolveUserProfile(userProfile, accessProfiles);
    const fromProfile = profile ? profilePermission(profile, actionId) : undefined;
    if (fromProfile !== undefined) return fromProfile;
    // Pedidos de material (Fase 8B) e de insumos (Fase 8C-2): só quem tem no perfil
    if (actionId.startsWith('material_requests_') || actionId.startsWith('supply_requests_')) return false;

    // Fallback safe defaults if permissions not loaded yet
    if (!permissionsMatrix) {
      if (actionId === 'manage_materials' || actionId === 'manage_supplies') return false; // padrão: só Super Administrador
      if (actionId === 'delete_asset' || actionId === 'delete_order') {
        return false; // strictly Super Admin
      }
      if (actionId === 'delete_templates' || actionId === 'dispatch_orders' || actionId === 'view_costs') return false; // padrão: só Super Administrador
      if (actionId === 'create_asset' || actionId === 'import_assets' || actionId === 'manage_templates' || actionId === 'plan_orders') {
        return userProfile.perfil === 'Administrador';
      }
      if (actionId.startsWith('os_')) return false; // OS: só pelo perfil
      return true; // Tech field professional permissions
    }

    const permission = permissionsMatrix[actionId];
    if (!permission) return true;

    return !!permission.roles[userProfile.perfil];
  };

  // Pedidos de material pendentes (Fase 8B, tempo real): número do menu e aba Material — só quem vê ou aprova
  const [pendingMaterialRequests, setPendingMaterialRequests] = useState<MaterialRequest[]>([]);
  const canSeeMaterialRequests =
    !!userProfile && userProfile.perfil !== 'Profissional' && (userHasActionPermission('material_requests_view') || userHasActionPermission('material_requests_decide'));
  const materialUnitsKey = (visibleUnits === null ? managementNames : visibleUnits).join('|');
  useEffect(() => {
    if (!canSeeMaterialRequests) {
      setPendingMaterialRequests([]);
      return;
    }
    const units = visibleUnits === null ? managementNames : visibleUnits;
    return subscribePendingMaterialRequests(units, (list) =>
      setPendingMaterialRequests(list.filter((r) => isCompanyVisible(r.company, visibleCompanies)))
    );
  }, [userProfile?.id, canSeeMaterialRequests, materialUnitsKey, (visibleCompanies || ['*']).join('|')]);
  // Pedidos de insumos (Fase 8C-2, tempo real): aguardando confirmação (Solicitações › Insumos) e aguardando o almoxarifado
  // (menu Almoxarifado) — cada um só para quem tem a permissão
  const [pendingSupplyConfirm, setPendingSupplyConfirm] = useState<SupplyRequest[]>([]);
  const [pendingSupplyStore, setPendingSupplyStore] = useState<SupplyRequest[]>([]);
  const canSeeSupplyRequests =
    !!userProfile && userProfile.perfil !== 'Profissional' && (userHasActionPermission('supply_requests_view') || userHasActionPermission('supply_requests_confirm'));
  const canSupplyStore = !!userProfile && userProfile.perfil !== 'Profissional' && userHasActionPermission('supply_requests_supply');
  useEffect(() => {
    if (!canSeeSupplyRequests) {
      setPendingSupplyConfirm([]);
      return;
    }
    const units = visibleUnits === null ? managementNames : visibleUnits;
    return subscribeSupplyAwaitingConfirm(units, (list) => setPendingSupplyConfirm(list.filter((r) => isCompanyVisible(r.company, visibleCompanies))));
  }, [userProfile?.id, canSeeSupplyRequests, materialUnitsKey, (visibleCompanies || ['*']).join('|')]);
  useEffect(() => {
    if (!canSupplyStore) {
      setPendingSupplyStore([]);
      return;
    }
    const units = visibleUnits === null ? managementNames : visibleUnits;
    return subscribeSupplyAwaitingStore(units, (list) => setPendingSupplyStore(list.filter((r) => isCompanyVisible(r.company, visibleCompanies))));
  }, [userProfile?.id, canSupplyStore, materialUnitsKey, (visibleCompanies || ['*']).join('|')]);
  const solicitationsBadge = pendingSolicitationOrders.length + pendingMaterialRequests.length + pendingSupplyConfirm.length;

  // Check state bypasses manually (Security Guard)
  useEffect(() => {
    if (!userProfile) return;

    // Primeira aba que o perfil pode ver (quem não tem o Dashboard cai direto na tela dele)
    const firstAllowedTab = ['home', 'service-orders', 'solicitations', 'assets', 'pmoc-preventivas', 'templates', 'materials', 'supplies', 'almoxarifado'].find((t) =>
      userHasTabPermission(t)
    );

    // Tela sem permissão não aparece (o menu já esconde): vai direto para a primeira permitida, sem aviso
    if (currentTab === 'user-control' && userProfile.perfil !== 'Super Administrador') {
      if (firstAllowedTab) setCurrentTab(firstAllowedTab);
      return;
    }
    if (!userHasTabPermission(currentTab) && firstAllowedTab && firstAllowedTab !== currentTab) {
      setCurrentTab(firstAllowedTab);
    }
  }, [currentTab, userProfile, permissionsMatrix, accessProfiles]);

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
                // Pointed 1-doc verification directly from Firestore instead of downloading entire user collection
                const verification = await dbVerifySessionAuthenticity(parsedUser);
                if (!verification.isValid) {
                  console.warn('Sessão inativa ou inconsistente no banco de dados:', verification.reason);
                  handleLogoutState();
                  return;
                }

                const foundUser = verification.verifiedUser || parsedUser;

                // A sessão local só vale se o Firebase Auth estiver logado com a conta vinculada a este cadastro
                if (!user || user.isAnonymous || !foundUser.authUid || user.uid !== foundUser.authUid) {
                  console.warn('[Segurança] Sessão local sem login válido no Firebase Auth. É necessário entrar novamente.');
                  handleLogoutState();
                  return;
                }

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
                      const savedTab = localStorage.getItem('hexon_current_tab') || 'home';
                      if (savedTab && (savedTab !== 'user-control' || foundUser.perfil === 'Super Administrador')) {
                        setCurrentTab(savedTab);
                      }
                    }
                    await loadPermissions();
                    await loadServiceOrders(synchronizedUser);
                    return;
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
    stopOrderSync();
    signOutHexon().catch(() => {});
  };

  // 3. ANTI-F12 SERVER-SIDE SESSION INTEGRITY DEFENSE
  // Actively verifies stored user profile against the official Firestore document on load
  useEffect(() => {
    if (!userProfile) return;
    let isMounted = true;

    dbVerifySessionAuthenticity(userProfile).then((result) => {
      if (!isMounted) return;
      if (!result.isValid) {
        console.warn('[Segurança] Bloqueio de integridade acionado:', result.reason);
        handleLogoutState();
        alert(
          result.reason ||
          'Alerta de Segurança: A integridade da sua sessão não pôde ser confirmada pelo servidor. Faça login novamente.'
        );
      } else if (result.verifiedUser) {
        // Enforce verified server-side attributes, overriding any tampered localStorage values
        setUserProfile(result.verifiedUser);
        try {
          localStorage.setItem('hexon_cached_user', JSON.stringify(result.verifiedUser));
        } catch {}
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

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
        setCurrentTab('home');
      }
    }

    await loadPermissions();
    await loadServiceOrders(updatedUser);
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
    // Preventiva: abre Ordens de Serviço já na parte das preventivas
    try {
      localStorage.setItem('hexon_orders_section', 'preventivas');
    } catch {
      /* ignora */
    }
    setCurrentTab('service-orders');
  };

  // Human descriptive title mapping
  const getTabTitle = () => {
    switch (currentTab) {
      case 'home':
        return 'Início';
      case 'service-orders':
        return 'Ordens de Serviço';
      case 'os-emit':
        return 'Emitir OS (GLPI)';
      case 'pmoc-preventivas':
        return 'PMOC — Preventivas';
      case 'assets':
        return 'Gerenciamento de Ativos';
      case 'templates':
        return 'PMOC — Modelos e Protocolos';
      case 'solicitations':
        return 'Solicitações';
      case 'materials':
        return 'Gestão de Materiais';
      case 'supplies':
        return 'Gestão de Insumos';
      case 'almoxarifado':
        return 'Almoxarifado';
      case 'user-control':
        return 'Usuários';
      case 'addresses':
        return 'Endereços';
      case 'settings':
        return 'Configurações';
      case 'qr-codes':
        return 'Central de Etiquetas & QR-Codes';
      default:
        return 'Hexon';
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
    // 2. Demais perfis: só as OS das unidades do perfil
    else if (visibleUnits !== null) {
      filtered = filtered.filter(o => isSectorVisible(o.sector, visibleUnits));
    }
    
    return filtered;
  };

  const filteredOrders = getFilteredOrders();

  // 1. Same-Browser Duplicate Tab Blocker Overlay
  if (isDuplicate && !publicAssetParam) {
    return (
      <div className={`min-h-screen w-screen flex flex-col justify-center items-center p-6 ${darkMode ? 'dark bg-[#08122b] text-slate-100' : 'bg-slate-50 text-slate-900'} font-sans`}>
        <div className="max-w-md w-full bg-[#08122b] border border-slate-800/80 rounded-2xl p-8 shadow-2xl text-center space-y-6">
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
      <div className={`min-h-screen w-screen flex flex-col justify-center items-center p-6 ${darkMode ? 'dark bg-[#08122b] text-slate-100' : 'bg-slate-50 text-slate-900'} font-sans`}>
        <div className="max-w-md w-full bg-[#08122b] border border-slate-800/80 rounded-2xl p-8 shadow-2xl text-center space-y-6">
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
      <div className="h-screen w-screen relative overflow-hidden bg-[#050b1f] flex flex-col items-center justify-center font-sans text-white">
        <BrandBackground cacheOnly />
        <div className="relative z-10 bg-[#0c1b44]/60 backdrop-blur-xl p-8 rounded-2xl border border-cyan-300/40 shadow-[0_0_40px_rgba(34,211,238,0.2)] flex flex-col items-center max-w-sm text-center">
          <div className="relative h-24 w-24 mb-5 flex items-center justify-center shrink-0">
            <BrandLogo
              className="h-24 w-24 animate-pulse"
              fallback={
                <>
                  <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full text-indigo-500 animate-pulse" fill="none">
                    <path d="M50 5L90 28V72L50 95L10 72V28L50 5Z" fill="#1e1b4b" fillOpacity="0.4" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M50 25L72 38V62L50 75L28 62V38L50 25Z" fill="currentColor" stroke="none" fillOpacity="0.8" />
                  </svg>
                  <span className="relative z-10 text-xs font-black text-white">H</span>
                </>
              }
            />
          </div>
          <h2 className="text-3xl font-extrabold tracking-[0.18em] uppercase text-white font-brand">HEXON</h2>
          <p className="text-xs text-slate-400 mt-2">Carregando credenciais e restabelecendo persistência no Firestore...</p>
          <div className="mt-6 flex gap-1 items-center justify-center">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-2 h-2 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: '300ms' }} />
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
          window.history.replaceState({}, document.title, window.location.pathname);
          // Recarrega o app sem o parâmetro público: se houver sessão válida, o usuário
          // continua logado; caso contrário, verá a tela de login. NÃO desloga ninguém.
          window.location.reload();
        }}
      />
    );
  }

  // MODO MANUTENÇÃO: tela de manutenção para todos, menos o Super Administrador (que pode entrar pelo link da tela)
  if (inMaintenance && !(maintenanceLogin && !userProfile)) {
    return (
      <MaintenanceScreen
        message={appControl?.maintenanceMessage}
        denied={maintenanceDenied}
        onAdminLogin={() => {
          setMaintenanceDenied(false);
          setMaintenanceLogin(true);
        }}
      />
    );
  }
  // Manutenção: tela de login só para o Super Administrador (com aviso e botão para voltar)
  if (inMaintenance && !userProfile) {
    return (
      <>
        <div className="fixed top-0 left-0 right-0 z-[150] px-4 py-2 bg-amber-400 text-amber-950 text-xs font-bold flex items-center justify-center gap-3 font-sans">
          <span>Sistema em manutenção: somente o Super Administrador pode entrar.</span>
          <button type="button" onClick={() => setMaintenanceLogin(false)} className="underline cursor-pointer">Voltar</button>
        </div>
        <LoginView onLoginSuccess={handleLoginSuccess} darkMode={darkMode} />
      </>
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
        visibleUnits={visibleUnits}
        onReloadOrders={loadServiceOrders}
        darkMode={darkMode}
        onToggleDarkMode={handleToggleDarkMode}
        fontScale={fontScale}
        setFontScale={setFontScale}
        highContrast={highContrast}
        setHighContrast={setHighContrast}
        onLogout={handleLogoutState}
        onUpdateUserProfile={(updated) => setUserProfile(updated)}
        canClientLink={userHasActionPermission('os_client_link')}
        canViewCosts={userHasActionPermission('view_costs')}
        canPreventivePdf={userHasActionPermission('preventive_pdf')}
        canOsPdf={userHasActionPermission('os_pdf')}
      />
    );
  }

  return (
    <div className={`h-screen w-screen flex overflow-hidden select-none font-sans transition-colors duration-150 print:h-auto print:w-auto print:overflow-visible print:block print:bg-white print:text-black ${darkMode ? 'bg-[#08122b] text-slate-100' : 'bg-slate-50 text-slate-900'}`}>
      
      {/* LEFT SIDEBAR: Responsive drawer on mobile, persistent on desktop */}
      <Sidebar 
        currentTab={currentTab} 
        onChangeTab={setCurrentTab} 
        isOpen={isSidebarOpen} 
        onClose={() => setIsSidebarOpen(false)} 
        pendingSolicitationsCount={solicitationsBadge}
        pendingStoreCount={pendingSupplyStore.length}
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
          unitOptions={visibleUnits === null && currentTab === 'home' ? managementNames : undefined}
          activeUnit={adminUnit}
          onActiveUnitChange={changeAdminUnit}
        />

        {/* COMPARTIMENTALIZED SCROLLABLE SUBVIEW PANEL */}
        <div className={`flex-1 overflow-y-auto p-6 transition-colors duration-150 print:overflow-visible print:h-auto print:p-0 print:bg-white ${darkMode ? 'bg-[#08122b]' : 'bg-slate-50'}`}>
          
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

          {currentTab === 'home' && (
            <HomeView
              userProfile={userProfile}
              orders={filteredOrders}
              pendingSolicitationsCount={solicitationsBadge}
              canSeeOrders={userHasActionPermission('view_service_orders')}
              canSeeSolicitations={userHasTabPermission('solicitations')}
              activeUnit={visibleUnits === null ? adminUnit : undefined}
              onNavigate={setCurrentTab}
            />
          )}

          {currentTab === 'service-orders' && (
            <OrdersHubView
              userProfile={userProfile}
              unitOptions={osUnitOptions}
              canSeeOs={userHasActionPermission('os_view')}
              canSeePreventives={userHasActionPermission('view_service_orders')}
              canAssign={userHasActionPermission('os_assign')}
              canEdit={userHasActionPermission('os_edit')}
              visibleCompanies={visibleCompanies}
              canCancel={userHasActionPermission('os_cancel')}
              canReplyContest={userHasActionPermission('os_contest_reply')}
              canClientLink={userHasActionPermission('os_client_link')}
              canExport={userHasActionPermission('os_export')}
              canPdf={userHasActionPermission('os_pdf')}
              canViewCosts={userHasActionPermission('view_costs')}
              mySignRole={
                userProfile.perfil === 'Super Administrador'
                  ? 'all'
                  : (() => {
                      const r = resolveUserProfile(userProfile, accessProfiles)?.osSignAs;
                      return r === 'engenheiro' || r === 'gerente' ? r : null;
                    })()
              }
              preventives={
                <ServiceOrdersView 
                  section="execucao"
                  orders={filteredOrders}
                  onReload={loadServiceOrders}
                  onViewedMonthChange={setOrdersMonth}
                  highlightOSId={highlightedOSId}
                  userProfile={userProfile}
                  visibleUnits={visibleUnits}
                  visibleCompanies={visibleCompanies}
                  userHasActionPermission={userHasActionPermission}
                  activeUnit={visibleUnits === null ? adminUnit : undefined}
                  unitOptions={visibleUnits === null ? managementNames : undefined}
                  onActiveUnitChange={changeAdminUnit}
                />
              }
            />
          )}

          {currentTab === 'os-emit' && (
            <EmitOsView userProfile={userProfile} unitOptions={osUnitOptions} canAssign={userHasActionPermission('os_assign')} visibleCompanies={visibleCompanies} />
          )}

          {/* PMOC › Preventivas (Planejamento e Consulta); fica separado para abrir do zero ao trocar de tela */}
          {currentTab === 'pmoc-preventivas' && (
            <ServiceOrdersView 
              section="pmoc"
              orders={filteredOrders}
              onReload={loadServiceOrders}
              onViewedMonthChange={setOrdersMonth}
              highlightOSId={highlightedOSId}
              userProfile={userProfile}
              visibleUnits={visibleUnits}
              visibleCompanies={visibleCompanies}
              userHasActionPermission={userHasActionPermission}
              activeUnit={visibleUnits === null ? adminUnit : undefined}
              unitOptions={visibleUnits === null ? managementNames : undefined}
              onActiveUnitChange={changeAdminUnit}
            />
          )}

          {currentTab === 'assets' && (
            <AssetsView 
              onSelectScannedAsset={handleSelectScannedAsset}
              scannedAssetId={scannedAssetId}
              clearScannedAsset={clearScannedAsset}
              userProfile={userProfile}
              visibleUnits={visibleUnits}
              visibleCompanies={visibleCompanies}
              orders={orders}
              userHasActionPermission={userHasActionPermission}
            />
          )}

          {currentTab === 'templates' && (
            <TemplatesView 
              onTemplatesUpdated={loadServiceOrders}
              userProfile={userProfile!}
              visibleUnits={visibleUnits}
              canManage={userHasActionPermission('manage_templates')}
              canDelete={userHasActionPermission('delete_templates')}
              canDispatch={userHasActionPermission('dispatch_orders')}
            />
          )}

          {currentTab === 'solicitations' && (
            <SolicitationsHub
              pendingOrders={pendingSolicitationOrders}
              pendingMaterialRequests={pendingMaterialRequests}
              pendingSupplyRequests={pendingSupplyConfirm}
              scopeUnits={visibleUnits}
              visibleCompanies={visibleCompanies}
              onNavigateToOS={handleNavigateToOS}
              onReload={loadServiceOrders}
              userProfile={userProfile}
              userHasActionPermission={userHasActionPermission}
            />
          )}

          {currentTab === 'addresses' && userProfile?.perfil === 'Super Administrador' && (
            <AddressesView userName={userProfile?.name || ''} />
          )}

          {currentTab === 'user-control' && (
            <UserControlView 
              currentUserProfile={userProfile}
              darkMode={darkMode}
            />
          )}

          {currentTab === 'materials' && userProfile && (
            <MaterialsView
              userProfile={userProfile}
              visibleUnits={visibleUnits}
              visibleCompanies={visibleCompanies}
              canManage={userHasActionPermission('manage_materials')}
            />
          )}

          {/* Almoxarifado (Fase 8C-2): fornecer ou recusar os pedidos de insumos confirmados */}
          {currentTab === 'almoxarifado' && userProfile && (
            <SupplyRequestsBoard
              mode="store"
              live={pendingSupplyStore}
              scopeUnits={visibleUnits}
              visibleCompanies={visibleCompanies}
              userProfile={userProfile}
              canAct={userHasActionPermission('supply_requests_supply')}
            />
          )}

          {/* Gestão de Insumos (Fase 8C): mesma tela dos materiais, com a lista de insumos */}
          {currentTab === 'supplies' && userProfile && (
            <MaterialsView
              kind="supplies"
              userProfile={userProfile}
              visibleUnits={visibleUnits}
              visibleCompanies={visibleCompanies}
              canManage={userHasActionPermission('manage_supplies')}
            />
          )}

          {currentTab === 'settings' && userProfile && userHasTabPermission('settings') && (
            <SettingsView userProfile={userProfile} darkMode={darkMode} canEditOsTemplates={userHasActionPermission('os_templates')} />
          )}

          {currentTab === 'qr-codes' && (
            <QrCodeBatchView 
              userProfile={userProfile}
              visibleUnits={visibleUnits}
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
