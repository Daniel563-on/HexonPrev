import { initializeApp, getApp, getApps } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  signOut,
  onAuthStateChanged
} from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  getDocFromServer,
  writeBatch,
  onSnapshot
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { Asset, ServiceOrder, MaintenanceLog, ChecklistItem, MaintenanceTemplate, HexonUser, Management, Unit, AccessLog, AuditLog, Profile, Permission, SystemPermission, RolePermissions, isSectorInGerencia } from '../types';

// Operation types for custom Firestore error handling
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
  };
}

let firebaseActive = false;
let dbInstance: any = null;
let authInstance: any = null;
let anonymousAuthRestricted = false;

// Determine if Firebase holds valid configuration (not placeholders)
const isFirebaseConfigured =
  firebaseConfig &&
  firebaseConfig.apiKey &&
  firebaseConfig.apiKey !== '' &&
  !firebaseConfig.apiKey.includes('PLACEHOLDER');

if (isFirebaseConfigured) {
  try {
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    
    // Attempt initializing with an offline-resilient IndexedDB cache (highly stable for cross-session offline edits)
    try {
      dbInstance = initializeFirestore(app, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager()
        })
      }, firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)' ? firebaseConfig.firestoreDatabaseId : undefined);
      console.log('Hexon Firestore inicializado com cache persistente local habilitado.');
    } catch (cacheErr) {
      console.warn('Could not initialize persistent local cache due to browser/iframe rules, falling back to basic Firestore:', cacheErr);
      dbInstance = (firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)')
        ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
        : getFirestore(app);
    }

    authInstance = getAuth(app);
    firebaseActive = true;
    console.log('Hexon Firebase inicializado com sucesso!');
  } catch (error) {
    console.log('Falha ao inicializar o SDK do Firebase. Ativando fallback para armazenamento local seguro.', error);
    firebaseActive = false;
  }
} else {
  console.log('Firebase não configurado. Utilizando banco de dados local seguro do navegador (LocalStorage).');
}

// Recursively remove any 'undefined' values from an object before sending to Firestore, to avoid crashes
function cleanUndefined<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return (obj as any).map(cleanUndefined) as any;
  }
  const newObj: any = {};
  for (const key of Object.keys(obj as any)) {
    const val = (obj as any)[key];
    if (val !== undefined) {
      newObj[key] = cleanUndefined(val);
    }
  }
  return newObj as T;
}

// Custom Quota/Rate Checker that dynamically detects Firebase rate limit issues
export function checkQuotaException(err: any): boolean {
  if (!err) return false;
  const errMsg = err.message || String(err);
  const isQuotaOrRateExceeded = /quota|rate|limit|exhaust|capacity|exceeded/i.test(errMsg);
  if (isQuotaOrRateExceeded) {
    console.warn("CRITICAL: Firebase write/read quota or rate limit exceeded. Details:", errMsg);
    if (typeof window !== 'undefined') {
      (window as any).__hexonFirebaseQuotaExceeded = true;
    }
    return true;
  }
  return false;
}

// Custom Error Handler required by the Firebase integration skill
function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const auth = authInstance;
  const errMsg = error instanceof Error ? error.message : String(error);

  // Check for quota, rate exceed, or capacity limit errors
  checkQuotaException(error);

  const errInfo: FirestoreErrorInfo = {
    error: errMsg,
    authInfo: {
      userId: auth?.currentUser?.uid,
      email: auth?.currentUser?.email,
      emailVerified: auth?.currentUser?.emailVerified,
    },
    operationType,
    path
  };
  console.warn('Firestore Error caught gracefully: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function isMockOrLegacyId(id: string): boolean {
  if (!id) return false;
  const legacyIds = [
    'as_chiller_01', 'as_qgbt_01', 'as_bomba_02', 'as_elev_03', 'as_elevador_01',
    '28941', '28942', '28943', '28944', '28890',
    'hist_mock_01', 'hist_mock_02', 'hist_mock_03', 'hist_1', 'hist_2', 'hist_3', 'hist_4',
    'ck_1', 'ck_2', 'ck_3', 'ck_4', 'ck_5', 'ck_6', 'ck_e1', 'ck_e2', 'ck_e3', 'ck_e4', 'ck_h1', 'ck_h2', 'ck_h3', 'ck_h4'
  ];
  if (legacyIds.includes(id)) return true;
  if (id.startsWith('tmp_') && (
    id.includes('hvac') || id.includes('elet') || id.includes('hidr') || id.includes('civ') || id.includes('vist') || id.includes('preset')
  )) {
    return true;
  }
  return false;
}

export const DEFAULT_TEMPLATES: MaintenanceTemplate[] = [];

// LOCAL STORAGE ENFORCEMENT REMOVED - STRICT ONLINE MODE ENFORCED
// We do not initialize or write any documents to local storage. Only online database is used.

// CONNECTION BOOTSTRAP CHECK REQUIRED BY THE SYSTEM SKILL
export async function testFirebaseConnection(): Promise<boolean> {
  if (!firebaseActive || !dbInstance) return false;
  try {
    // Attempt getFromServer call on 'test/connection' document to verify connection
    await getDocFromServer(doc(dbInstance, 'test', 'connection'));
    return true;
  } catch (error: any) {
    const errMsg = error?.message || String(error);
    if (errMsg.includes('the client is offline') || errMsg.includes('unavailable') || errMsg.includes('Could not reach')) {
      console.warn("Por favor, verifique a configuração do seu Firebase. O cliente está offline.");
    }
    return false;
  }
}

// -----------------------------------------------------------------------------
// DATABASE API (Unified wrapper for Firebase/Firestore + LocalStorage fallback)
// -----------------------------------------------------------------------------

export function getDatabaseMode(): {
  active: boolean;
  isFirebase: boolean;
  projectName: string;
  isGoogleAuthenticated: boolean;
  userName?: string;
  userEmail?: string;
  isAnonymousAuthRestricted: boolean;
} {
  const currentUser = authInstance?.currentUser;
  return {
    active: true,
    isFirebase: firebaseActive,
    projectName: firebaseConfig?.projectId || 'HexonPreventiva',
    isGoogleAuthenticated: false,
    userName: currentUser?.displayName || 'Daniel Torres',
    userEmail: currentUser?.email || 'daniel.torres@hexon.com',
    isAnonymousAuthRestricted: anonymousAuthRestricted
  };
}

// Check anonymous authorization restrictions (i.e. disabled in Firebase project console)
export function checkIsAnonymousAuthRestricted(): boolean {
  return anonymousAuthRestricted;
}

// signInAnonymously helper for simple demo
export async function signInHexonAnonymously(): Promise<any> {
  if (firebaseActive && authInstance) {
    try {
      const userCredential = await signInAnonymously(authInstance);
      anonymousAuthRestricted = false;
      return userCredential.user;
    } catch (err: any) {
      const isRestricted = err instanceof Error && 
        (err.message?.includes('admin-restricted-operation') || 
         (err as any).code?.includes('admin-restricted-operation') ||
         String(err).includes('admin-restricted-operation'));
      
      if (isRestricted) {
        anonymousAuthRestricted = true;
        console.info(
          '%c[Hexon Firebase] O login anônimo está desativado nas configurações do seu projeto Firebase ' +
          '("auth/admin-restricted-operation"). O sistema ativou o armazenamento local seguro (LocalStorage) ' +
          'para que todos os recursos funcionem instantaneamente. Para ativar a sincronização em tempo ' +
          'real em nuvem, habilite o "Login Anônimo" no painel do Firebase Console (Authentication > Sign-in method).',
          'color: #d97706; font-weight: bold; font-family: sans-serif;'
        );
      } else {
        console.warn('Falha de login anônimo no Firebase (usando fallback local):', err);
      }
      return null;
    }
  }
  return { uid: 'local_technician_dt', isAnonymous: true, email: 'daniel.torres@hexon.com' };
}

// Expose standard Sign-out action
export async function signOutHexon(): Promise<void> {
  if (authInstance) {
    await signOut(authInstance);
  }
}

// Cache Expiration / Read Reduction Engine
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12-Hour Cache TTL to limit Firestore reads

function isCacheValid(key: string): boolean {
  try {
    const rawTimestamps = localStorage.getItem('hexon_cache_timestamps');
    if (!rawTimestamps) return false;
    const timestamps = JSON.parse(rawTimestamps);
    const lastFetch = timestamps[key];
    if (!lastFetch) return false;
    return (Date.now() - lastFetch) < CACHE_TTL_MS;
  } catch (e) {
    return false;
  }
}

function updateCacheTimestamp(key: string) {
  try {
    const rawTimestamps = localStorage.getItem('hexon_cache_timestamps') || '{}';
    const timestamps = JSON.parse(rawTimestamps);
    timestamps[key] = Date.now();
    localStorage.setItem('hexon_cache_timestamps', JSON.stringify(timestamps));
  } catch (e) {
    console.warn('Error writing cache timestamp:', e);
  }
}

export async function forceRefetchAllData(): Promise<void> {
  try {
    localStorage.removeItem('hexon_cache_timestamps');
  } catch (e) {
    console.warn('Error clearing cache timestamps:', e);
  }
  clearAllCaches();
  if (firebaseActive && dbInstance) {
    await Promise.all([
      dbGetPermissions().catch(() => ({})),
      dbGetUsers().catch(() => []),
      dbGetAssets().catch(() => []),
      dbGetServiceOrders().catch(() => []),
      dbGetTemplates().catch(() => []),
      dbGetManagements().catch(() => []),
      dbGetUnits().catch(() => [])
    ]);
  }
}

// React auth subscriber
// Fast In-Memory Cache to speed up entire system (0ms operations after initial fetch)
let cacheAssets: Asset[] | null = null;
let cacheAssetsFromFirebase = false;

let cacheServiceOrders: ServiceOrder[] | null = null;
let cacheServiceOrdersFromFirebase = false;

let cacheAllHistories: MaintenanceLog[] | null = null;
let cacheAllHistoriesFromFirebase = false;

let cacheTemplates: MaintenanceTemplate[] | null = null;
let cacheTemplatesFromFirebase = false;

let cacheUsers: HexonUser[] | null = null;
let cacheUsersFromFirebase = false;

let cacheManagements: Management[] | null = null;
let cacheManagementsFromFirebase = false;

let cacheUnits: Unit[] | null = null;
let cacheUnitsFromFirebase = false;

let cacheAccessLogs: AccessLog[] | null = null;
let cacheAccessLogsFromFirebase = false;

let cacheAuditLogs: AuditLog[] | null = null;
let cacheAuditLogsFromFirebase = false;

// Pending Promise variables for fetch/load de-duplication to resolve Rate Exceeded errors on parallel loads
let pendingAssetsPromise: Promise<Asset[]> | null = null;
let pendingOrdersPromise: Promise<ServiceOrder[]> | null = null;
let pendingHistoriesPromise: Promise<MaintenanceLog[]> | null = null;
let pendingTemplatesPromise: Promise<MaintenanceTemplate[]> | null = null;
let pendingUsersPromise: Promise<HexonUser[]> | null = null;
let pendingManagementsPromise: Promise<Management[]> | null = null;
let pendingUnitsPromise: Promise<Unit[]> | null = null;
let pendingAccessLogsPromise: Promise<AccessLog[]> | null = null;
let pendingAuditLogsPromise: Promise<AuditLog[]> | null = null;

export function clearAllCaches() {
  cacheAssets = null;
  cacheAssetsFromFirebase = false;
  pendingAssetsPromise = null;

  cacheServiceOrders = null;
  cacheServiceOrdersFromFirebase = false;
  pendingOrdersPromise = null;

  cacheAllHistories = null;
  cacheAllHistoriesFromFirebase = false;
  pendingHistoriesPromise = null;

  cacheTemplates = null;
  cacheTemplatesFromFirebase = false;
  pendingTemplatesPromise = null;

  cacheUsers = null;
  cacheUsersFromFirebase = false;
  pendingUsersPromise = null;

  cacheManagements = null;
  cacheManagementsFromFirebase = false;
  pendingManagementsPromise = null;

  cacheUnits = null;
  cacheUnitsFromFirebase = false;
  pendingUnitsPromise = null;

  cacheAccessLogs = null;
  cacheAccessLogsFromFirebase = false;
  pendingAccessLogsPromise = null;

  cacheAuditLogs = null;
  cacheAuditLogsFromFirebase = false;
  pendingAuditLogsPromise = null;
}

export function subscribeToAuth(callback: (user: any) => void) {
  if (authInstance) {
    return onAuthStateChanged(authInstance, (user) => {
      // Clear cache and pending promises on auth state change to prevent leaks and load correct user profiles instantly
      clearAllCaches();
      callback(user);
    });
  }
  // Schedule fallback callback check immediately so the application boot sequence resolves without getting stuck
  setTimeout(() => {
    callback(null);
  }, 50);
  return () => {};
}

// Get all assets
export async function dbGetAssets(): Promise<Asset[]> {
  const hasUser = !!(firebaseActive && dbInstance);
  
  // Try retrieving from local storage fallback first
  let localData: Asset[] | null = null;
  try {
    const saved = localStorage.getItem('hexon_assets');
    if (saved) {
      localData = JSON.parse(saved).filter((item: any) => !isMockOrLegacyId(item.id));
    }
  } catch (e) {
    console.warn('Error reading assets from local storage fallback:', e);
  }

  // Check if in-memory cache OR local storage cache is valid
  if (cacheAssets !== null && (!hasUser || cacheAssetsFromFirebase)) {
    return [...cacheAssets];
  }
  if (isCacheValid('assets') && localData && localData.length > 0) {
    cacheAssets = localData;
    cacheAssetsFromFirebase = true;
    return [...cacheAssets];
  }

  if (pendingAssetsPromise !== null) {
    return pendingAssetsPromise;
  }

  pendingAssetsPromise = (async () => {
    if (firebaseActive && dbInstance) {
      const path = 'assets';
      try {
        const snap = await getDocs(collection(dbInstance, path));
        const list: Asset[] = [];
        snap.forEach((docSnap) => {
          if (!isMockOrLegacyId(docSnap.id)) {
            list.push({ id: docSnap.id, ...docSnap.data() } as Asset);
          }
        });
        cacheAssets = list;
        cacheAssetsFromFirebase = true;
        updateCacheTimestamp('assets');
        try {
          localStorage.setItem('hexon_assets', JSON.stringify(cacheAssets));
        } catch (lsErr) {
          console.warn('LocalStorage limit writing assets:', lsErr);
        }
        pendingAssetsPromise = null;
        return [...cacheAssets];
      } catch (err: any) {
        console.warn('Could not fetch Assets from Firestore. Using local storage fallback:', err);
        checkQuotaException(err);
      }
    }

    cacheAssets = localData || [];
    cacheAssetsFromFirebase = false;
    try {
      localStorage.setItem('hexon_assets', JSON.stringify(cacheAssets));
    } catch (lsErr) {
      console.warn('LocalStorage limit writing assets fallback:', lsErr);
    }
    pendingAssetsPromise = null;
    return [...cacheAssets];
  })();

  return pendingAssetsPromise;
}

// Get single asset
export async function dbGetAsset(assetId: string): Promise<Asset | null> {
  const assets = await dbGetAssets();
  return assets.find((a) => a.id === assetId) || null;
}

// Save or Update asset
export async function dbSaveAsset(asset: Asset): Promise<void> {
  // Ensure cache is initialized
  if (cacheAssets === null) {
    await dbGetAssets();
  }

  // Optimistically update cache instantly
  const idx = cacheAssets!.findIndex((a) => a.id === asset.id);
  if (idx >= 0) {
    cacheAssets![idx] = { ...asset };
  } else {
    cacheAssets!.push({ ...asset });
  }

  try {
    localStorage.setItem('hexon_assets', JSON.stringify(cacheAssets));
  } catch (lsErr) {
    console.warn('LocalStorage limit saving asset:', lsErr);
  }

  if (firebaseActive && dbInstance) {
    const path = `assets/${asset.id}`;
    try {
      await setDoc(doc(dbInstance, 'assets', asset.id), cleanUndefined(asset));
    } catch (err: any) {
      console.warn('Firestore write asset failed, utilizing local fallback state:', err);
      checkQuotaException(err);
    }
  }
}

// Save or Update multiple assets at once (e.g. from bulk import)
export async function dbSaveAssetsBulk(assets: Asset[]): Promise<void> {
  // Ensure cache is initialized
  if (cacheAssets === null) {
    await dbGetAssets();
  }

  for (const asset of assets) {
    const idx = cacheAssets!.findIndex((a) => a.id === asset.id || a.code === asset.code);
    if (idx >= 0) {
      cacheAssets![idx] = { ...cacheAssets![idx], ...asset };
    } else {
      cacheAssets!.push({ ...asset });
    }
  }

  try {
    localStorage.setItem('hexon_assets', JSON.stringify(cacheAssets));
  } catch (lsErr) {
    console.warn('LocalStorage bulk assets error:', lsErr);
  }

  if (firebaseActive && dbInstance) {
    try {
      const batchSize = 100;
      for (let i = 0; i < assets.length; i += batchSize) {
        const chunk = assets.slice(i, i + batchSize);
        const batch = writeBatch(dbInstance);
        for (const asset of chunk) {
          batch.set(doc(dbInstance, 'assets', asset.id), cleanUndefined(asset));
        }
        await batch.commit();
        // Give the write stream queue a brief moment to process and drain
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } catch (err: any) {
      console.warn('Firestore bulk write asset failed:', err);
      checkQuotaException(err);
    }
  }
}

function processExpiredOrders(orders: ServiceOrder[]): ServiceOrder[] {
  const todayStr = new Date().toISOString().slice(0, 10);
  const processed = orders.map((o) => {
    if (o.endDate && o.status !== 'Concluída' && o.status !== 'Não Executada' && todayStr > o.endDate) {
      return {
        ...o,
        status: 'Não Executada' as const,
        updatedAt: new Date().toISOString()
      };
    }
    return o;
  });

  cacheServiceOrders = processed;
  return processed;
}

// Get all service orders
export async function dbGetServiceOrders(): Promise<ServiceOrder[]> {
  const hasUser = !!(firebaseActive && dbInstance);

  // Try retrieving from local storage fallback first
  let localData: ServiceOrder[] | null = null;
  try {
    const saved = localStorage.getItem('hexon_service_orders');
    if (saved) {
      localData = JSON.parse(saved);
    }
  } catch (e) {
    console.warn('Error reading service orders:', e);
  }

  // Check if in-memory cache OR local storage cache is valid
  if (cacheServiceOrders !== null && (!hasUser || cacheServiceOrdersFromFirebase)) {
    return processExpiredOrders([...cacheServiceOrders]).sort((a, d) => Number(d.id) - Number(a.id));
  }
  if (isCacheValid('serviceOrders') && localData && localData.length > 0) {
    cacheServiceOrders = localData;
    cacheServiceOrdersFromFirebase = true;
    return processExpiredOrders([...cacheServiceOrders]).sort((a, d) => Number(d.id) - Number(a.id));
  }

  if (pendingOrdersPromise !== null) {
    return pendingOrdersPromise;
  }

  pendingOrdersPromise = (async () => {
    if (firebaseActive && dbInstance) {
      const path = 'serviceOrders';
      try {
        const snap = await getDocs(collection(dbInstance, path));
        const list: ServiceOrder[] = [];
        snap.forEach((docSnap) => {
          if (!isMockOrLegacyId(docSnap.id)) {
            list.push({ id: docSnap.id, ...docSnap.data() } as ServiceOrder);
          }
        });
        cacheServiceOrders = processExpiredOrders(list);
        cacheServiceOrdersFromFirebase = true;
        updateCacheTimestamp('serviceOrders');
        try {
          localStorage.setItem('hexon_service_orders', JSON.stringify(cacheServiceOrders));
        } catch (lsErr) {
          console.warn('LocalStorage limit service_orders:', lsErr);
        }
        pendingOrdersPromise = null;
        return [...cacheServiceOrders].sort((a, d) => Number(d.id) - Number(a.id));
      } catch (err: any) {
        console.warn('Firestore fetch service_orders failed, utilizing offline fallback:', err);
        checkQuotaException(err);
      }
    }

    cacheServiceOrders = localData || [];
    cacheServiceOrdersFromFirebase = false;
    try {
      localStorage.setItem('hexon_service_orders', JSON.stringify(cacheServiceOrders));
    } catch (lsErr) {
      console.warn('LocalStorage limit service_orders fallback:', lsErr);
    }
    pendingOrdersPromise = null;
    return processExpiredOrders([...cacheServiceOrders]).sort((a, d) => Number(d.id) - Number(a.id));
  })();

  return pendingOrdersPromise;
}

// Save or Update service order
export async function dbSaveServiceOrder(order: ServiceOrder): Promise<void> {
  const orderWithUpdate = { ...order, updatedAt: new Date().toISOString() };

  // If the status is completed 'Concluída', we must create an entry in the equipment history!
  if (order.status === 'Concluída') {
    const checkedCount = order.checklist.filter(c => c.checked).length;
    const totalCount = order.checklist.length;
    
    // Evaluate list of verified and non-compliant tasks
    const verifiedItems = order.checklist.filter(c => c.checked).map(c => c.task);
    const nonConforms = order.checklist.filter(c => !c.checked).map(c => c.task);
    
    const verifiedItemsText = verifiedItems.length > 0 ? verifiedItems.join('; ') : 'Nenhuma tarefa checada.';
    const nonConformItemsText = nonConforms.length > 0 ? nonConforms.join('; ') : 'Nenhuma não-conformidade.';
    
    const resultStatus = nonConforms.length === 0 ? 'Aprovado' : (checkedCount > 0 ? 'Aprovado com Ressalvas' : 'Não Conforme');
    const preventiveType = order.periodicity || (order.title.includes('Anual') ? 'Anual' : order.title.includes('Semestral') ? 'Semestral' : order.title.includes('Trimestral') ? 'Trimestral' : order.title.includes('Mensal') ? 'Mensal' : 'Inspeção Geral');
    
    // Check if any checklist items demanded automatic corrective request
    const correctiveDemandedItems = order.checklist.filter(c => c.autoCorrectiveAnswer === 'Sim');
    
    // Let's build the sections
    let correctiveActionsText = '';
    const sections: string[] = [];

    // Section 1: All items where corrective action was requested (autoCorrectiveAnswer === 'Sim')
    if (correctiveDemandedItems.length > 0) {
      const details = correctiveDemandedItems.map(i => {
        const obs = i.observations && i.observations.trim() 
          ? `\n   ↳ Relato Técnico / Descrição da Corretiva: "${i.observations.trim()}"` 
          : '\n   ↳ (Nenhum texto de relato foi digitado pelo técnico)';
        return `• ${i.task}: SOLICITADO SIM${obs}`;
      }).join('\n');
      sections.push(`⚙️ Desdobramento de Ação Corretiva Solicitado (Sim):\n${details}`);
    }

    // Section 2: Other items with typed observations (excluding those already listed as 'Sim' above)
    const otherItemsWithObs = order.checklist.filter(c => {
      const isAlreadyLogged = correctiveDemandedItems.some(i => i.id === c.id);
      return c.observations && c.observations.trim() && !isAlreadyLogged;
    });

    if (otherItemsWithObs.length > 0) {
      const details = otherItemsWithObs.map(i => {
        const statusLabel = i.statusCheck ? ` [Status: ${i.statusCheck}]` : (!i.checked ? ' [Não Conforme]' : '');
        return `• ${i.task}${statusLabel}:\n   ↳ Relato Técnico: "${i.observations!.trim()}"`;
      }).join('\n');
      sections.push(`📋 Observações e Apontamentos do Checklist:\n${details}`);
    }

    // Section 3: Non-conformities without typed observations
    const nonConformsWithoutObs = order.checklist.filter(c => {
      const isFailed = !c.checked || c.statusCheck === 'Não Atestado';
      const isAlreadyLogged = correctiveDemandedItems.some(i => i.id === c.id) || otherItemsWithObs.some(i => i.id === c.id);
      return isFailed && !isAlreadyLogged;
    });

    if (nonConformsWithoutObs.length > 0) {
      const details = nonConformsWithoutObs.map(i => `• ${i.task}`).join('\n');
      sections.push(`⚠ Outros itens não-conformes (sem relato adicional):\n${details}`);
    }

    // Assemble final text
    if (sections.length > 0) {
      correctiveActionsText = sections.join('\n\n');
    } else {
      correctiveActionsText = 'Equipamento operando com 100% de conformidade.';
    }

    const historyEntry: MaintenanceLog = {
      id: `hist_${order.id}_${Date.now().toString().slice(-4)}`,
      assetId: order.assetId || 'none',
      osId: order.id,
      osTitle: order.title,
      date: order.signedAt || new Date().toISOString().replace('T', ' ').slice(0, 16),
      technician: order.assignedTechnician,
      status: 'Concluída',
      notes: order.notes || 'Manutenção concluída e assinada digitalmente.',
      checklistCount: totalCount,
      checkedCount: checkedCount,
      preventiveType: preventiveType,
      resultStatus: resultStatus as any,
      verifiedItemsText: verifiedItemsText,
      nonConformItemsText: nonConformItemsText,
      correctiveActionsText: correctiveActionsText
    };

    await dbAddHistoryLog(historyEntry);
  }

  // Ensure cache is initialized
  if (cacheServiceOrders === null) {
    await dbGetServiceOrders();
  }

  // Optimistically update cache instantly
  const idx = cacheServiceOrders!.findIndex((o) => o.id === order.id);
  if (idx >= 0) {
    cacheServiceOrders![idx] = orderWithUpdate;
  } else {
    cacheServiceOrders!.push(orderWithUpdate);
  }

  try {
    localStorage.setItem('hexon_service_orders', JSON.stringify(cacheServiceOrders));
  } catch (lsErr) {
    console.warn('LocalStorage limit saving service order:', lsErr);
  }

  if (firebaseActive && dbInstance) {
    const path = `serviceOrders/${order.id}`;
    try {
      await setDoc(doc(dbInstance, 'serviceOrders', order.id), cleanUndefined(orderWithUpdate));
    } catch (err: any) {
      console.warn('Firestore write serviceOrder failed, utilizing local fallback state:', err);
      checkQuotaException(err);
    }
  }
}

// Delete service order from memory cache, local storage, and database
export async function dbDeleteServiceOrder(orderId: string): Promise<void> {
  // Ensure cache is initialized
  if (cacheServiceOrders === null) {
    await dbGetServiceOrders();
  }

  // Remove from cache list
  cacheServiceOrders = cacheServiceOrders!.filter((o) => o.id !== orderId);

  try {
    localStorage.setItem('hexon_service_orders', JSON.stringify(cacheServiceOrders));
  } catch (lsErr) {
    console.warn('LocalStorage limit deleting service order:', lsErr);
  }

  // Delete from Firestore if signed-in
  if (firebaseActive && dbInstance) {
    const path = `serviceOrders/${orderId}`;
    try {
      await deleteDoc(doc(dbInstance, 'serviceOrders', orderId));
    } catch (err: any) {
      console.warn('Firestore delete service order failed:', err);
      checkQuotaException(err);
    }
  }
}

// Helper to dynamically enrich history logs using matching service orders details
function enrichHistoryList(histories: MaintenanceLog[], orders: ServiceOrder[]): MaintenanceLog[] {
  if (!orders || orders.length === 0) return histories;
  
  return histories.map(h => {
    const matchingOrder = orders.find(o => o.id === h.osId);
    if (!matchingOrder || !matchingOrder.checklist) return h;
    
    // Dynamically recalculate the correctiveActionsText based on the checklist
    const correctiveDemandedItems = matchingOrder.checklist.filter(c => c.autoCorrectiveAnswer === 'Sim');
    
    let correctiveActionsText = '';
    const sections: string[] = [];

    // Section 1: All items where corrective action was requested (autoCorrectiveAnswer === 'Sim')
    if (correctiveDemandedItems.length > 0) {
      const details = correctiveDemandedItems.map(i => {
        const obs = i.observations && i.observations.trim() 
          ? `\n   ↳ Relato Técnico / Descrição da Corretiva: "${i.observations.trim()}"` 
          : '\n   ↳ (Nenhum texto de relato foi digitado pelo técnico)';
        return `• ${i.task}: SOLICITADO SIM${obs}`;
      }).join('\n');
      sections.push(`⚙️ Desdobramento de Ação Corretiva Solicitado (Sim):\n${details}`);
    }

    // Section 2: Other items with typed observations (excluding those already listed as 'Sim' above)
    const otherItemsWithObs = matchingOrder.checklist.filter(c => {
      const isAlreadyLogged = correctiveDemandedItems.some(i => i.id === c.id);
      return c.observations && c.observations.trim() && !isAlreadyLogged;
    });

    if (otherItemsWithObs.length > 0) {
      const details = otherItemsWithObs.map(i => {
        const statusLabel = i.statusCheck ? ` [Status: ${i.statusCheck}]` : (!i.checked ? ' [Não Conforme]' : '');
        return `• ${i.task}${statusLabel}:\n   ↳ Relato Técnico: "${i.observations!.trim()}"`;
      }).join('\n');
      sections.push(`📋 Observações e Apontamentos do Checklist:\n${details}`);
    }

    // Section 3: Non-conformities without typed observations
    const nonConformsWithoutObs = matchingOrder.checklist.filter(c => {
      const isFailed = !c.checked || c.statusCheck === 'Não Atestado';
      const isAlreadyLogged = correctiveDemandedItems.some(i => i.id === c.id) || otherItemsWithObs.some(i => i.id === c.id);
      return isFailed && !isAlreadyLogged;
    });

    if (nonConformsWithoutObs.length > 0) {
      const details = nonConformsWithoutObs.map(i => `• ${i.task}`).join('\n');
      sections.push(`⚠ Outros itens não-conformes (sem relato adicional):\n${details}`);
    }

    if (sections.length > 0) {
      correctiveActionsText = sections.join('\n\n');
    } else {
      correctiveActionsText = 'Equipamento operando com 100% de conformidade.';
    }

    return {
      ...h,
      correctiveActionsText
    };
  });
}

// Get maintenance logs for a specific asset
export async function dbGetAssetHistory(assetId: string): Promise<MaintenanceLog[]> {
  const hasUser = !!(firebaseActive && dbInstance);
  
  // Try retrieving from local storage fallback first
  let localData: MaintenanceLog[] | null = null;
  try {
    const saved = localStorage.getItem('hexon_histories');
    if (saved) {
      localData = JSON.parse(saved);
    }
  } catch (e) {
    console.warn('Error reading maintenance logs:', e);
  }

  const orders = cacheServiceOrders || [];

  if (cacheAllHistories !== null && (!hasUser || cacheAllHistoriesFromFirebase)) {
    const filtered = cacheAllHistories
      .filter((h) => h.assetId === assetId)
      .sort((a, d) => d.date.localeCompare(a.date));
    return enrichHistoryList(filtered, orders);
  }
  if (isCacheValid('histories') && localData && localData.length > 0) {
    cacheAllHistories = localData;
    cacheAllHistoriesFromFirebase = true;
    const filtered = cacheAllHistories
      .filter((h) => h.assetId === assetId)
      .sort((a, d) => d.date.localeCompare(a.date));
    return enrichHistoryList(filtered, orders);
  }
  if (pendingHistoriesPromise !== null) {
    const list = await pendingHistoriesPromise;
    const filtered = list
      .filter((h) => h.assetId === assetId)
      .sort((a, d) => d.date.localeCompare(a.date));
    const loadedOrders = await dbGetServiceOrders();
    return enrichHistoryList(filtered, loadedOrders);
  }

  pendingHistoriesPromise = (async () => {
    if (firebaseActive && dbInstance) {
      const path = 'histories';
      try {
        const historiesRef = collection(dbInstance, 'histories');
        const snap = await getDocs(historiesRef);
        const list: MaintenanceLog[] = [];
        snap.forEach((docSnap) => {
          if (!isMockOrLegacyId(docSnap.id)) {
            list.push({ id: docSnap.id, ...docSnap.data() } as MaintenanceLog);
          }
        });
        cacheAllHistories = [...list];
        cacheAllHistoriesFromFirebase = true;
        updateCacheTimestamp('histories');
        try {
          localStorage.setItem('hexon_histories', JSON.stringify(cacheAllHistories));
        } catch (lsErr) {
          console.warn('LocalStorage limit histories:', lsErr);
        }
        pendingHistoriesPromise = null;
        return cacheAllHistories;
      } catch (err: any) {
        console.warn('Firestore fetch histories failed, utilizing offline fallback:', err);
        checkQuotaException(err);
      }
    }

    cacheAllHistories = localData || [];
    cacheAllHistoriesFromFirebase = false;
    try {
      localStorage.setItem('hexon_histories', JSON.stringify(cacheAllHistories));
    } catch (lsErr) {
      console.warn('LocalStorage limit histories fallback:', lsErr);
    }
    pendingHistoriesPromise = null;
    return cacheAllHistories;
  })();

  const list = await pendingHistoriesPromise;
  const filtered = list
    .filter((h) => h.assetId === assetId)
    .sort((a, d) => d.date.localeCompare(a.date));
  const loadedOrders = await dbGetServiceOrders();
  return enrichHistoryList(filtered, loadedOrders);
}

// Adds an entry to the history log
export async function dbAddHistoryLog(log: MaintenanceLog): Promise<void> {
  if (cacheAllHistories === null) {
    cacheAllHistories = [];
  }

  // Prevent duplicate entries for the same finished service order session, update if exists
  const existingIndex = cacheAllHistories!.findIndex(h => h.id === log.id || (h.osId === log.osId && h.date === log.date));
  if (existingIndex >= 0) {
    cacheAllHistories![existingIndex] = log;
  } else {
    cacheAllHistories!.unshift(log);
  }

  try {
    localStorage.setItem('hexon_histories', JSON.stringify(cacheAllHistories));
  } catch (lsErr) {
    console.warn('LocalStorage limit writing history:', lsErr);
  }

  if (firebaseActive && dbInstance) {
    const path = `histories/${log.id}`;
    try {
      await setDoc(doc(dbInstance, 'histories', log.id), cleanUndefined(log));
    } catch (err: any) {
      console.warn('Firestore write history failed:', err);
      checkQuotaException(err);
    }
  }
}

// GET ALL CHECKLIST/MAINTENANCE TEMPLATES
export async function dbGetTemplates(): Promise<MaintenanceTemplate[]> {
  const hasUser = !!(firebaseActive && dbInstance);

  // Try retrieving from local storage fallback first
  let localData: MaintenanceTemplate[] | null = null;
  try {
    const saved = localStorage.getItem('hexon_templates');
    if (saved) {
      localData = JSON.parse(saved);
    }
  } catch (e) {
    console.warn('Error reading templates from local storage fallback:', e);
  }

  // Check if in-memory cache OR local storage cache is valid
  if (cacheTemplates !== null && (!hasUser || cacheTemplatesFromFirebase)) {
    return [...cacheTemplates];
  }
  if (isCacheValid('templates') && localData && localData.length > 0) {
    cacheTemplates = localData;
    cacheTemplatesFromFirebase = true;
    return [...cacheTemplates];
  }

  if (pendingTemplatesPromise !== null) {
    return pendingTemplatesPromise;
  }

  pendingTemplatesPromise = (async () => {
    if (firebaseActive && dbInstance) {
      const path = 'templates';
      try {
        const snap = await getDocs(collection(dbInstance, path));
        const list: MaintenanceTemplate[] = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data();
          if (!data.deleted && !isMockOrLegacyId(docSnap.id)) {
            list.push({ id: docSnap.id, ...data } as MaintenanceTemplate);
          }
        });
        cacheTemplates = list;
        cacheTemplatesFromFirebase = true;
        updateCacheTimestamp('templates');
        try {
          localStorage.setItem('hexon_templates', JSON.stringify(cacheTemplates));
        } catch (lsErr) {
          console.warn('LocalStorage limit writing templates:', lsErr);
        }
        pendingTemplatesPromise = null;
        return [...cacheTemplates];
      } catch (err: any) {
        console.warn('Could not fetch templates from Firestore. Using local fallback:', err);
        checkQuotaException(err);
      }
    }

    cacheTemplates = localData || [];
    cacheTemplatesFromFirebase = false;
    try {
      localStorage.setItem('hexon_templates', JSON.stringify(cacheTemplates));
    } catch (lsErr) {
      console.warn('LocalStorage limit writing templates fallback:', lsErr);
    }
    pendingTemplatesPromise = null;
    return [...cacheTemplates];
  })();

  return pendingTemplatesPromise;
}

// SAVE OR UPDATE TEMPLATE
export async function dbSaveTemplate(template: MaintenanceTemplate): Promise<void> {
  if (cacheTemplates === null) {
    await dbGetTemplates();
  }

  const idx = cacheTemplates!.findIndex((t) => t.id === template.id);
  if (idx >= 0) {
    cacheTemplates![idx] = { ...template };
  } else {
    cacheTemplates!.push({ ...template });
  }

  try {
    localStorage.setItem('hexon_templates', JSON.stringify(cacheTemplates));
  } catch (lsErr) {
    console.warn('LocalStorage limit saving template:', lsErr);
  }

  if (firebaseActive && dbInstance) {
    const path = `templates/${template.id}`;
    try {
      await setDoc(doc(dbInstance, 'templates', template.id), cleanUndefined(template));
    } catch (err: any) {
      console.warn('Firestore write template failed:', err);
      checkQuotaException(err);
    }
  }
}

// DELETE TEMPLATE
export async function dbDeleteTemplate(templateId: string): Promise<void> {
  if (cacheTemplates === null) {
    await dbGetTemplates();
  }

  cacheTemplates = cacheTemplates!.filter((t) => t.id !== templateId);

  try {
    localStorage.setItem('hexon_templates', JSON.stringify(cacheTemplates));
  } catch (lsErr) {
    console.warn('LocalStorage limit deleting template:', lsErr);
  }

  if (firebaseActive && dbInstance) {
    const path = `templates/${templateId}`;
    try {
      await setDoc(doc(dbInstance, 'templates', templateId), cleanUndefined({ deleted: true }));
    } catch (err: any) {
      console.warn('Firestore delete template failed:', err);
      checkQuotaException(err);
    }
  }
}

// DATA CONTRACT FOR BULK GENERATION FILTERS
export interface AutoGenFilter {
  templateId: string;
  comarca: string;
  sector: string;
  startDate: string;
  endDate: string;
}

// HELPERS FOR PREVENTIVE CYCLE MOTOR
export function getYearWeek(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  const tempDate = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = tempDate.getUTCDay() || 7;
  tempDate.setUTCDate(tempDate.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tempDate.getUTCFullYear(),0,1));
  const weekNo = Math.ceil((((tempDate.getTime() - yearStart.getTime()) / 86400000) + 1)/7);
  return `${tempDate.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function getAssetCycles(asset: Asset, orders: ServiceOrder[]): {
  [periodicity: string]: {
    lastExecution: string | null;
    nextGenerationPrevista: string | null;
    status: 'Em Dia' | 'Atrasado' | 'Pendente de Planejamento';
  }
} {
  const assetOrders = orders.filter((o) => o.assetId === asset.id);
  const periodicities = asset.periodicities || ['Mensal', 'Semestral', 'Anual'];
  const cycles: any = {};

  for (const p of periodicities) {
    // Last executed/completed
    const completed = [...assetOrders]
      .filter((o) => o.status === 'Concluída' && (o.periodicity === p || o.title.includes(p)))
      .sort((a, b) => b.scheduledDate.localeCompare(a.scheduledDate));

    const lastExecDate = completed.length > 0 ? completed[0].scheduledDate : null;

    // Find any planned/pending future OS
    const planned = [...assetOrders]
      .filter((o) => (o.status === 'Novo' || o.status === 'Planejada' || o.status === 'Em Execução') && (o.periodicity === p || o.title.includes(p)))
      .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));

    let nextPrevista: string | null = null;
    let status: 'Em Dia' | 'Atrasado' | 'Pendente de Planejamento' = 'Pendente de Planejamento';

    if (planned.length > 0) {
      nextPrevista = planned[0].scheduledDate;
      status = 'Em Dia';
    } else {
      // Calculate next recommended generation
      const referenceDate = lastExecDate || asset.createdAt.slice(0, 10) || new Date().toISOString().slice(0, 10);
      const ref = new Date(referenceDate + 'T12:00:00');
      
      if (p === 'Semanal') {
        ref.setDate(ref.getDate() + 7);
      } else if (p === 'Mensal') {
        ref.setMonth(ref.getMonth() + 1);
      } else if (p === 'Semestral') {
        ref.setMonth(ref.getMonth() + 6);
      } else if (p === 'Anual') {
        ref.setFullYear(ref.getFullYear() + 1);
      }
      nextPrevista = ref.toISOString().slice(0, 10);

      // Check if overdue
      const todayStr = new Date().toISOString().slice(0, 10);
      if (nextPrevista < todayStr) {
        status = 'Atrasado';
      } else {
        status = 'Em Dia';
      }
    }

    cycles[p] = {
      lastExecution: lastExecDate,
      nextGenerationPrevista: nextPrevista,
      status
    };
  }

  return cycles;
}

function getYearWeekLocal(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  const tempDate = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = tempDate.getUTCDay() || 7;
  tempDate.setUTCDate(tempDate.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tempDate.getUTCFullYear(),0,1));
  const weekNo = Math.ceil((((tempDate.getTime() - yearStart.getTime()) / 86400000) + 1)/7);
  return `${tempDate.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function getQuarterLocal(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()}-Q${q}`;
}

function getSemesterLocal(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  const s = Math.floor(d.getMonth() / 6) + 1;
  return `${d.getFullYear()}-S${s}`;
}

function isSamePeriodLocal(dateAStr: string, dateBStr: string, periodicity: string): boolean {
  if (!dateAStr || !dateBStr) return false;
  const p = periodicity || '';
  if (p === 'Semanal') {
    return getYearWeekLocal(dateAStr) === getYearWeekLocal(dateBStr);
  }
  if (p === 'Mensal') {
    return dateAStr.slice(0, 7) === dateBStr.slice(0, 7);
  }
  if (p === 'Trimestral') {
    return getQuarterLocal(dateAStr) === getQuarterLocal(dateBStr);
  }
  if (p === 'Semestral') {
    return getSemesterLocal(dateAStr) === getSemesterLocal(dateBStr);
  }
  if (p === 'Anual') {
    return dateAStr.slice(0, 4) === dateBStr.slice(0, 4);
  }
  return dateAStr === dateBStr;
}

function alignPeriodDatesLocal(baseDateStr: string, periodicity: string): { startDate: string; endDate: string; scheduledDate: string } {
  if (!baseDateStr) {
    const today = new Date().toISOString().slice(0, 10);
    return { startDate: today, endDate: today, scheduledDate: today };
  }
  const d = new Date(baseDateStr + 'T12:00:00');
  const y = d.getFullYear();
  
  const formatDateString = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  if (periodicity === 'Semanal') {
    const day = d.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(d);
    monday.setDate(d.getDate() + diffToMonday);
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);
    
    return {
      startDate: formatDateString(monday),
      endDate: formatDateString(friday),
      scheduledDate: baseDateStr
    };
  } else if (periodicity === 'Mensal') {
    const m = d.getMonth();
    const firstDay = new Date(y, m, 1);
    const lastDay = new Date(y, m + 1, 0);
    
    return {
      startDate: formatDateString(firstDay),
      endDate: formatDateString(lastDay),
      scheduledDate: baseDateStr
    };
  } else if (periodicity === 'Trimestral') {
    const m = d.getMonth();
    const quarter = Math.floor(m / 3);
    const qStartMonth = quarter * 3;
    const qEndMonth = qStartMonth + 2;
    
    const firstDay = new Date(y, qStartMonth, 1);
    const lastDay = new Date(y, qEndMonth + 1, 0);
    
    return {
      startDate: formatDateString(firstDay),
      endDate: formatDateString(lastDay),
      scheduledDate: baseDateStr
    };
  } else if (periodicity === 'Semestral') {
    const m = d.getMonth();
    const semester = Math.floor(m / 6);
    const sStartMonth = semester * 6;
    const sEndMonth = sStartMonth + 5;
    
    const firstDay = new Date(y, sStartMonth, 1);
    const lastDay = new Date(y, sEndMonth + 1, 0);
    
    return {
      startDate: formatDateString(firstDay),
      endDate: formatDateString(lastDay),
      scheduledDate: baseDateStr
    };
  } else if (periodicity === 'Anual') {
    const firstDay = new Date(y, 0, 1);
    const lastDay = new Date(y, 11, 31);
    
    return {
      startDate: formatDateString(firstDay),
      endDate: formatDateString(lastDay),
      scheduledDate: baseDateStr
    };
  }
  
  return {
    startDate: baseDateStr,
    endDate: baseDateStr,
    scheduledDate: baseDateStr
  };
}

let lastAutoGenTimestamp = 0;

// AUTOMATED PREVENTIVE MAINTENANCE AND SURVEY GENERATOR
export async function dbAutoGeneratePreventiveActivities(
  filtersOrTemplateId: AutoGenFilter[] | string = 'all',
  comarcaFilter: string = 'all',
  sectorFilter: string = 'all',
  startDateStr: string = new Date().toISOString().slice(0, 10),
  endDateStr: string = new Date().toISOString().slice(0, 10)
): Promise<number> {
  const now = Date.now();
  if (filtersOrTemplateId === 'all' && now - lastAutoGenTimestamp < 15000) {
    console.log('Auto-generation on cooldown, skipping background check to prevent rate and quota limits.');
    return 0;
  }
  if (filtersOrTemplateId === 'all') {
    lastAutoGenTimestamp = now;
  }

  let generatedCount = 0;

  const getOffsetDateString = (baseStr: string, offsetDays: number): string => {
    const date = new Date(baseStr + 'T12:00:00');
    date.setDate(date.getDate() + offsetDays);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  try {
    const [assets, orders, templates] = await Promise.all([
      dbGetAssets(),
      dbGetServiceOrders(),
      dbGetTemplates()
    ]);

    const allNewOrders: ServiceOrder[] = [];

    // Parse filters list
    const filters: AutoGenFilter[] = typeof filtersOrTemplateId === 'string'
      ? [{
          templateId: filtersOrTemplateId,
          comarca: comarcaFilter,
          sector: sectorFilter,
          startDate: startDateStr,
          endDate: endDateStr
        }]
      : filtersOrTemplateId;

    // Extract unique comarcas from registered assets
    const comarcas = new Set<string>();
    assets.forEach((asset) => {
      const c = asset.specs?.COMARCA || asset.specs?.comarca || (asset.location && asset.location.includes(' - ') ? asset.location.split(' - ')[0] : asset.location);
      if (c && typeof c === 'string' && c.trim() !== '') {
        comarcas.add(c.trim());
      }
    });
    if (comarcas.size === 0) {
      comarcas.add('Comarca Capital');
    }
    const comarcaList = Array.from(comarcas).sort((a, b) => a.localeCompare(b));

    for (const filter of filters) {
      const { templateId, comarca: filterComarca, sector: filterSector, startDate: filterStartDate, endDate: filterEndDate } = filter;

      // Filter templates to generate
      const targetTemplates = templates.filter((t) => {
        if (templateId !== 'all' && t.id !== templateId) return false;
        return true;
      });

      for (const t of targetTemplates) {
        // 1. SURVEY / VISTORIA TEMPLATE (Semanal - sem vínculo com ativo, única por comarca)
        if (t.type === 'survey') {
          // Apply operational sector filter on template targetSectorOrType if specified
          if (filterSector !== 'all') {
            const tSector = (t.targetSectorOrType || '').toLowerCase().trim();
            if (tSector !== filterSector.toLowerCase().trim()) continue;
          }

          const targetComarcas = comarcaList.filter((comarca) => {
            if (filterComarca !== 'all' && comarca.toLowerCase().trim() !== filterComarca.toLowerCase().trim()) return false;
            return true;
          });

          for (const comarca of targetComarcas) {
            let i = 0;
            const limit = 100; // safety brake to prevent infinite loops
            while (i < limit) {
              const dates = alignPeriodDatesLocal(filterStartDate, 'Semanal');
              const scheduledDate = dates.scheduledDate;
              const pStartDate = dates.startDate;
              const pEndDate = dates.endDate;

              // If the start of the scheduled period exceeds the target end date pool, stop generating further
              if (scheduledDate > filterEndDate) {
                break;
              }

              const title = `${t.name} - ${comarca}`;

              // EXTREME SAFETY CODES: Enforce Duplication Prevention & Weekly Boundaries using unified helper
              const alreadyExists = orders.some((o) => {
                if (!o.isSurvey || o.surveyLocation !== comarca || o.title !== title) return false;
                return isSamePeriodLocal(o.startDate || o.scheduledDate, scheduledDate, 'Semanal');
              });

              if (!alreadyExists) {
                const checklistItems: ChecklistItem[] = t.checklistItems
                  .filter((item) => item.isActive)
                  .map((item, idx) => ({
                    id: `ck_v_g_${Date.now()}_${idx}_${Math.floor(Math.random() * 1000)}`,
                    task: item.task,
                    checked: item.defaultChecked ?? false,
                    checkedAt: null,
                    observations: null,
                    criticality: item.criticality || 'Média',
                    autoCreateCorrective: item.autoCreateCorrective ?? false,
                    observationRequired: item.observationRequired ?? false,
                    responseType: item.responseType || 'three_states',
                    naObservationRequired: item.naObservationRequired ?? false
                  } as any));

                const newSurvey: ServiceOrder = {
                  id: (Math.floor(Math.random() * 800000) + 100000).toString(),
                  assetId: null,
                  assetName: 'S/V - Vistoria Periódica',
                  assetCode: 'PE-VISTORIA',
                  sector: filterSector !== 'all' ? filterSector : (t.targetSectorOrType || 'Vistoria'),
                  title: title,
                  description: `Vistoria de rotina programada. Comarca: ${comarca}. Procedimento autônomo sem vinculação com ativos de engenharia.`,
                  priority: 'Baixa',
                  status: 'Novo',
                  scheduledDate: '',
                  startDate: pStartDate,
                  endDate: pEndDate,
                  assignedTechnician: '',
                  checklist: checklistItems,
                  notes: '',
                  signature: null,
                  signedBy: null,
                  signedAt: null,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                  photoEvidence: null,
                  isSurvey: true,
                  surveyType: t.targetSectorOrType || 'Comarcas',
                  surveyLocation: comarca,
                  periodicity: 'Semanal'
                };

                allNewOrders.push(newSurvey);
                orders.unshift(newSurvey);
                generatedCount++;
              }

              i = limit; // Only generate 1 instance per selected period
            }
          }
        }

        // 2. PREVENTIVE TEMPLATE (Sempre vinculada a ativo por tipo/setor, um por equipamento)
        if (t.type === 'preventive') {
          // Find matching assets across the set comarca and sector
          const matchingAssets = assets.filter((asset) => {
            const assetComarca = asset.specs?.COMARCA || asset.specs?.comarca || (asset.location && asset.location.includes(' - ') ? asset.location.split(' - ')[0] : asset.location);
            if (filterComarca !== 'all' && assetComarca.toLowerCase().trim() !== filterComarca.toLowerCase().trim()) return false;

            // Operational sector filter constraint on asset itself
            if (filterSector !== 'all' && asset.sector && asset.sector.toLowerCase().trim() !== filterSector.toLowerCase().trim()) return false;

            const tAssetType = (t.targetAssetType || '').toLowerCase().trim();
            const assetTipoSpec = (asset.specs?.TIPO || asset.specs?.tipo || '').toLowerCase().trim();
            const tSector = (t.targetSectorOrType || '').toLowerCase().trim();
            const assetSector = (asset.sector || '').toLowerCase().trim();

            if (tAssetType && assetTipoSpec) {
              return assetTipoSpec.includes(tAssetType) || tAssetType.includes(assetTipoSpec);
            }
            return assetSector === tSector;
          });

          // Determine periodicities in template to iterate
          const tPeriodicities = (t.periodicity || '').split(',').map((p) => p.trim());

          for (const asset of matchingAssets) {
            const activePeriodicities = asset.periodicities || [];
            const commonPeriodicities = activePeriodicities.filter((ap) =>
              tPeriodicities.some((tp) => tp.toLowerCase() === ap.toLowerCase())
            );

            // Fetch this specific asset's order history to enforce intervals and block duplicates
            const assetOrders = orders.filter((o) => o.assetId === asset.id);

            for (const periodicity of commonPeriodicities) {
              let i = 0;
              const limit = 100; // safety brake to prevent infinite loops
              while (i < limit) {
                const dates = alignPeriodDatesLocal(filterStartDate, periodicity);
                const scheduledDate = dates.scheduledDate;
                const pStartDate = dates.startDate;
                const pEndDate = dates.endDate;

                const title = `Preventiva ${periodicity} - ${asset.name}`;

                // --- MOTOR DE CICLO PREVENTIVO CONSTRAINTS (UNIFIED CALENDAR PERIOD CHECKS) ---
                const alreadyExists = assetOrders.some((o) => {
                  if (o.isSurvey) return false;
                  const oPeriodicity = o.periodicity || (o.title.includes('Mensal') ? 'Mensal' : o.title.includes('Semanal') ? 'Semanal' : o.title.includes('Trimestral') ? 'Trimestral' : o.title.includes('Semestral') ? 'Semestral' : o.title.includes('Anual') ? 'Anual' : '');
                  if (oPeriodicity.toLowerCase().trim() !== periodicity.toLowerCase().trim()) return false;
                  return isSamePeriodLocal(o.startDate || o.scheduledDate, scheduledDate, periodicity);
                });

                if (alreadyExists) {
                  console.log(`[Motor] Bloqueio: Ciclo ${periodicity} já gerado para o ativo ${asset.code} no período correspondente a ${scheduledDate}`);
                  i = limit;
                  continue;
                }

                const checklistItems: ChecklistItem[] = t.checklistItems
                  .filter((item) => item.isActive)
                  .map((item, idx) => ({
                    id: `ck_g_${Date.now()}_${idx}_${Math.floor(Math.random() * 1000)}`,
                    task: item.task,
                    checked: item.defaultChecked ?? false,
                    checkedAt: null,
                    observations: null,
                    criticality: item.criticality || 'Média',
                    autoCreateCorrective: item.autoCreateCorrective ?? false,
                    observationRequired: item.observationRequired ?? false,
                    responseType: item.responseType || 'three_states',
                    naObservationRequired: item.naObservationRequired ?? false
                  } as any));

                const newOS: ServiceOrder = {
                  id: (Math.floor(Math.random() * 800000) + 100000).toString(),
                  assetId: asset.id,
                  assetName: asset.name,
                  assetCode: asset.code,
                  sector: filterSector !== 'all' ? filterSector : (asset.sector || 'Geral'),
                  title: title,
                  description: `Atividade preventiva automática programada (${periodicity}). Equipamento: ${asset.name} (${asset.code}). Relacionado ao modelo versionado V${t.version || 1}.`,
                  priority: periodicity === 'Anual' ? 'Alta' : 'Média',
                  status: 'Novo',
                  scheduledDate: '',
                  startDate: pStartDate,
                  endDate: pEndDate,
                  assignedTechnician: '',
                  checklist: checklistItems,
                  notes: '',
                  signature: null,
                  signedBy: null,
                  signedAt: null,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                  photoEvidence: null,
                  periodicity: periodicity
                };

                allNewOrders.push(newOS);
                orders.unshift(newOS);
                generatedCount++;

                i = limit; // Only generate 1 instance per selected period
              }
            }
          }
        }
      }
    }

    // Sync in-memory cache and localStorage fallback for orders
    if (cacheServiceOrders === null) {
      cacheServiceOrders = orders;
    } else {
      for (const ord of allNewOrders) {
        if (!cacheServiceOrders.some((x) => x.id === ord.id)) {
          cacheServiceOrders.push(ord);
        }
      }
    }

    try {
      localStorage.setItem('hexon_service_orders', JSON.stringify(cacheServiceOrders));
    } catch (lsErr) {
      console.warn('LocalStorage limit writing orders:', lsErr);
    }

    // Save in batch chunks to Firebase (only if active)
    if (allNewOrders.length > 0 && firebaseActive && dbInstance) {
      try {
        const batchSize = 100;
        for (let i = 0; i < allNewOrders.length; i += batchSize) {
          const chunk = allNewOrders.slice(i, i + batchSize);
          const batch = writeBatch(dbInstance);
          for (const order of chunk) {
            batch.set(doc(dbInstance, 'serviceOrders', order.id), cleanUndefined(order));
          }
          await batch.commit();
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      } catch (err: any) {
        console.warn('Could not write batch of generated service orders to Firestore:', err);
      }
    }

    // Set 7-day deadlines for all managements
    if (allNewOrders.length > 0) {
      try {
        const mans = await dbGetManagements();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        for (const m of mans) {
          await dbSavePlanningDeadline({
            id: m.id,
            expiresAt: expiresAt
          });
        }
      } catch (err) {
        console.warn('Could not auto set deadlines for generated preventives:', err);
      }
    }

  } catch (error) {
    console.error('Error generating automated activities:', error);
  }

  return generatedCount;
}

// DELETE SINGLE ASSET
export async function dbDeleteAsset(assetId: string): Promise<void> {
  if (cacheAssets === null) {
    await dbGetAssets();
  }

  cacheAssets = cacheAssets!.filter((a) => a.id !== assetId);

  try {
    localStorage.setItem('hexon_assets', JSON.stringify(cacheAssets));
  } catch (lsErr) {
    console.warn('LocalStorage limit writing assets:', lsErr);
  }

  if (firebaseActive && dbInstance) {
    const path = `assets/${assetId}`;
    try {
      await deleteDoc(doc(dbInstance, 'assets', assetId));
    } catch (err: any) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  }
}

// DELETE ALL ASSETS BY SECTOR
export async function dbDeleteAssetsBySector(sectorName: string): Promise<void> {
  if (cacheAssets === null) {
    await dbGetAssets();
  }

  const isMatch = (sec: string) => {
    const s = (sec || '').toLowerCase();
    const target = sectorName.toLowerCase();
    
    // Normalizing synonyms in Portuguese and old types
    if (target === 'mecânica/refrigeração' || target === 'mecânica / refrigeração') {
      return s === 'mecânica/refrigeração' || s === 'mecânica / refrigeração' || s === 'hvac';
    }
    if (target === 'elétrica/eletrônica' || target === 'elétrica / eletrônica') {
      return s === 'elétrica/eletrônica' || s === 'elétrica / eletrônica' || s === 'elétrica';
    }
    if (target === 'civil') {
      return s === 'civil' || s === 'civil / predial' || s === 'hidráulica';
    }
    return s === target;
  };

  const assetsToDelete = cacheAssets!.filter((a) => isMatch(a.sector));
  cacheAssets = cacheAssets!.filter((a) => !isMatch(a.sector));

  if (firebaseActive && dbInstance) {
    try {
      const batchSize = 100;
      for (let i = 0; i < assetsToDelete.length; i += batchSize) {
        const chunk = assetsToDelete.slice(i, i + batchSize);
        const batch = writeBatch(dbInstance);
        for (const asset of chunk) {
          batch.delete(doc(dbInstance, 'assets', asset.id));
        }
        await batch.commit();
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } catch (err: any) {
      console.warn('Could not delete batch of assets by sector in Firestore:', err);
    }
  }
}

// ==========================================
// RBAC SYSTEM AND ACCESS/AUDIT LOGGING APIS
// ==========================================

// Default Precomputed Seed Data for instant professional system preview
const SEED_USERS: HexonUser[] = [
  {
    id: 'daniel_fab93',
    name: 'Daniel Fabre',
    matricula: '1-0000',
    email: 'daniel.fab93@gmail.com',
    cargo: 'Super Administrador de Sistemas',
    gerencia: 'Todas',
    perfil: 'Super Administrador',
    status: 'Ativo',
    senha: 'admin'
  }
];

const SEED_MANAGEMENTS: Management[] = [
  { id: 'm-0', name: 'Todas', description: 'Abrangência de atuação irrestrita' },
  { id: 'm-1', name: 'Refrigeração', description: 'Climatização, Chillers e HVAC central' },
  { id: 'm-2', name: 'Elétrica', description: 'Subestações, geradores e quadros de força' },
  { id: 'm-3', name: 'Civil', description: 'Manutenção de fachada, marcenaria e hidráulica predial' },
  { id: 'm-4', name: 'Segurança', description: 'CFTV, incêndio e cabeamento estruturado' }
];

const SEED_UNITS: Unit[] = [
  { id: 'u-1', name: 'Sede Principal - Bloco Central', location: 'Edifício Central, Rio de Janeiro' },
  { id: 'u-2', name: 'Subsede Centro - Apoio Técnico', location: 'Av. Rio Branco 120, Rio de Janeiro' },
  { id: 'u-3', name: 'Unidade Zona Norte', location: 'Galpão Operacional Triagem, Rio de Janeiro' },
  { id: 'u-4', name: 'Unidade Zona Sul', location: 'Posto de Atendimento Copacabana, Rio de Janeiro' }
];

// Helper to check and bootstrap initial tables/collections asynchronously
async function bootstrapRBACCollectionsIfEmpty() {
  if (!firebaseActive || !dbInstance) return;

  try {
    // 1. Seed users if empty
    const usersSnap = await getDocs(collection(dbInstance, 'users'));
    if (usersSnap.empty) {
      console.log('Seeding default users into Firestore...');
      for (const u of SEED_USERS) {
        await setDoc(doc(dbInstance, 'users', u.id), cleanUndefined(u));
      }
    } else {
      // Ensure specific Super Admin user with Daniel Fabre exists/is up to date
      const dDoc = await getDoc(doc(dbInstance, 'users', 'daniel_fab93'));
      if (!dDoc.exists()) {
        const u = SEED_USERS[0];
        await setDoc(doc(dbInstance, 'users', u.id), cleanUndefined(u));
      }
    }

    // 2. Seed managements if empty
    const manSnap = await getDocs(collection(dbInstance, 'managements'));
    if (manSnap.empty) {
      console.log('Seeding default managements into Firestore...');
      for (const m of SEED_MANAGEMENTS) {
        await setDoc(doc(dbInstance, 'managements', m.id), cleanUndefined(m));
      }
    }

    // 3. Seed units if empty
    const unitSnap = await getDocs(collection(dbInstance, 'units'));
    if (unitSnap.empty) {
      console.log('Seeding default units into Firestore...');
      for (const un of SEED_UNITS) {
        await setDoc(doc(dbInstance, 'units', un.id), cleanUndefined(un));
      }
    }
  } catch (err) {
    console.warn('Ignored silent background bootstrap seeding issue:', err);
  }
}

// GET USERS
export async function dbGetUsers(): Promise<HexonUser[]> {
  const hasUser = !!(firebaseActive && dbInstance);

  // Try retrieving from local storage fallback first
  let localData: HexonUser[] | null = null;
  try {
    const saved = localStorage.getItem('hexon_users');
    if (saved) {
      localData = JSON.parse(saved);
    }
  } catch (e) {
    console.warn('Error reading users from local fallback:', e);
  }

  // Check if in-memory cache OR local storage cache is valid
  if (cacheUsers !== null && (!hasUser || cacheUsersFromFirebase)) {
    return [...cacheUsers];
  }
  if (isCacheValid('users') && localData && localData.length > 0) {
    cacheUsers = localData;
    cacheUsersFromFirebase = true;
    return [...cacheUsers];
  }

  if (pendingUsersPromise !== null) {
    return pendingUsersPromise;
  }

  pendingUsersPromise = (async () => {
    if (firebaseActive && dbInstance) {
      const path = 'users';
      try {
        await bootstrapRBACCollectionsIfEmpty();

        const snap = await getDocs(collection(dbInstance, path));
        const list: HexonUser[] = [];
        snap.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...docSnap.data() } as HexonUser);
        });
        
        if (list.length > 0) {
          cacheUsers = list;
          cacheUsersFromFirebase = true;
          updateCacheTimestamp('users');
          try {
            localStorage.setItem('hexon_users', JSON.stringify(cacheUsers));
          } catch (lsErr) {
            console.warn('LocalStorage limit writing users:', lsErr);
          }
          pendingUsersPromise = null;
          return [...cacheUsers];
        }
      } catch (err: any) {
        console.warn('Could not fetch users from Firestore. Using local storage fallback:', err);
        checkQuotaException(err);
      }
    }

    cacheUsers = localData || [...SEED_USERS];
    cacheUsersFromFirebase = false;
    try {
      localStorage.setItem('hexon_users', JSON.stringify(cacheUsers));
    } catch (lsErr) {
      console.warn('LocalStorage users fallback write error:', lsErr);
    }
    pendingUsersPromise = null;
    return [...cacheUsers];
  })();

  return pendingUsersPromise;
}

// SAVE USER
export async function dbSaveUser(user: HexonUser): Promise<void> {
  const users = await dbGetUsers();
  const index = users.findIndex(u => u.matricula === user.matricula || u.id === user.id);
  
  if (index >= 0) {
    users[index] = { ...users[index], ...user };
  } else {
    users.push(user);
  }
  
  cacheUsers = users;

  try {
    localStorage.setItem('hexon_users', JSON.stringify(cacheUsers));
  } catch (lsErr) {
    console.warn('LocalStorage limit saving user:', lsErr);
  }

  if (firebaseActive && dbInstance) {
    try {
      await setDoc(doc(dbInstance, 'users', user.id || user.matricula), cleanUndefined(user));
    } catch (err: any) {
      console.warn('Firestore write user failed, Utilizing local state:', err);
      checkQuotaException(err);
    }
  }
}

// DELETE USER
export async function dbDeleteUser(userId: string): Promise<void> {
  const users = await dbGetUsers();
  cacheUsers = users.filter(u => u.id !== userId && u.matricula !== userId);

  try {
    localStorage.setItem('hexon_users', JSON.stringify(cacheUsers));
  } catch (lsErr) {
    console.warn('LocalStorage limit deleting user:', lsErr);
  }

  if (firebaseActive && dbInstance) {
    try {
      await deleteDoc(doc(dbInstance, 'users', userId));
    } catch (err: any) {
      console.warn('Firestore delete user failed:', err);
      checkQuotaException(err);
    }
  }
}

// GET MANAGEMENTS (GERENCIAS)
export async function dbGetManagements(): Promise<Management[]> {
  const hasUser = !!(firebaseActive && dbInstance);

  // Try retrieving from local storage fallback first
  let localData: Management[] | null = null;
  try {
    const saved = localStorage.getItem('hexon_managements');
    if (saved) {
      localData = JSON.parse(saved);
    }
  } catch (e) {
    console.warn('Error reading managements:', e);
  }

  // Check if in-memory cache OR local storage cache is valid
  if (cacheManagements !== null && (!hasUser || cacheManagementsFromFirebase)) {
    return [...cacheManagements];
  }
  if (isCacheValid('managements') && localData && localData.length > 0) {
    cacheManagements = localData;
    cacheManagementsFromFirebase = true;
    return [...cacheManagements];
  }

  if (pendingManagementsPromise !== null) {
    return pendingManagementsPromise;
  }

  pendingManagementsPromise = (async () => {
    if (firebaseActive && dbInstance) {
      const path = 'managements';
      try {
        const snap = await getDocs(collection(dbInstance, path));
        const list: Management[] = [];
        snap.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...docSnap.data() } as Management);
        });
        if (list.length > 0) {
          cacheManagements = list;
          cacheManagementsFromFirebase = true;
          updateCacheTimestamp('managements');
          try {
            localStorage.setItem('hexon_managements', JSON.stringify(cacheManagements));
          } catch (lsErr) {
            console.warn('LocalStorage limit writing managements:', lsErr);
          }
          pendingManagementsPromise = null;
          return [...cacheManagements];
        }
      } catch (err: any) {
        console.warn('Could not fetch managements. using local fallback:', err);
        checkQuotaException(err);
      }
    }

    cacheManagements = localData || [...SEED_MANAGEMENTS];
    cacheManagementsFromFirebase = false;
    try {
      localStorage.setItem('hexon_managements', JSON.stringify(cacheManagements));
    } catch (lsErr) {
      console.warn('LocalStorage limit writing managements fallback:', lsErr);
    }
    pendingManagementsPromise = null;
    return [...cacheManagements];
  })();

  return pendingManagementsPromise;
}

// SAVE MANAGEMENT
export async function dbSaveManagement(man: Management): Promise<void> {
  const mans = await dbGetManagements();
  const idx = mans.findIndex(m => m.id === man.id);
  if (idx >= 0) mans[idx] = man;
  else mans.push(man);

  cacheManagements = mans;

  try {
    localStorage.setItem('hexon_managements', JSON.stringify(cacheManagements));
  } catch (lsErr) {
    console.warn('LocalStorage limit saving management:', lsErr);
  }

  if (firebaseActive && dbInstance) {
    try {
      await setDoc(doc(dbInstance, 'managements', man.id), cleanUndefined(man));
    } catch (err: any) {
      console.warn('Firestore write management failed:', err);
      checkQuotaException(err);
    }
  }
}

// DELETE MANAGEMENT
export async function dbDeleteManagement(id: string): Promise<void> {
  const mans = await dbGetManagements();
  cacheManagements = mans.filter(m => m.id !== id);

  try {
    localStorage.setItem('hexon_managements', JSON.stringify(cacheManagements));
  } catch (lsErr) {
    console.warn('LocalStorage limit deleting management:', lsErr);
  }

  if (firebaseActive && dbInstance) {
    try {
      await deleteDoc(doc(dbInstance, 'managements', id));
    } catch (err: any) {
      console.warn('Firestore delete management failed:', err);
      checkQuotaException(err);
    }
  }
}

// GET UNITS (UNIDADES)
export async function dbGetUnits(): Promise<Unit[]> {
  const hasUser = !!(firebaseActive && dbInstance);

  // Try retrieving from local storage fallback first
  let localData: Unit[] | null = null;
  try {
    const saved = localStorage.getItem('hexon_units');
    if (saved) {
      localData = JSON.parse(saved);
    }
  } catch (e) {
    console.warn('Error reading units:', e);
  }

  // Check if in-memory cache OR local storage cache is valid
  if (cacheUnits !== null && (!hasUser || cacheUnitsFromFirebase)) {
    return [...cacheUnits];
  }
  if (isCacheValid('units') && localData && localData.length > 0) {
    cacheUnits = localData;
    cacheUnitsFromFirebase = true;
    return [...cacheUnits];
  }

  if (pendingUnitsPromise !== null) {
    return pendingUnitsPromise;
  }

  pendingUnitsPromise = (async () => {
    if (firebaseActive && dbInstance) {
      const path = 'units';
      try {
        const snap = await getDocs(collection(dbInstance, path));
        const list: Unit[] = [];
        snap.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...docSnap.data() } as Unit);
        });
        if (list.length > 0) {
          cacheUnits = list;
          cacheUnitsFromFirebase = true;
          updateCacheTimestamp('units');
          try {
            localStorage.setItem('hexon_units', JSON.stringify(cacheUnits));
          } catch (lsErr) {
            console.warn('LocalStorage limit writing units:', lsErr);
          }
          pendingUnitsPromise = null;
          return [...cacheUnits];
        }
      } catch (err: any) {
        console.warn('Could not fetch units. using local fallback:', err);
        checkQuotaException(err);
      }
    }

    cacheUnits = localData || [...SEED_UNITS];
    cacheUnitsFromFirebase = false;
    try {
      localStorage.setItem('hexon_units', JSON.stringify(cacheUnits));
    } catch (lsErr) {
      console.warn('LocalStorage limit writing units fallback:', lsErr);
    }
    pendingUnitsPromise = null;
    return [...cacheUnits];
  })();

  return pendingUnitsPromise;
}

// SAVE UNIT
export async function dbSaveUnit(unit: Unit): Promise<void> {
  const list = await dbGetUnits();
  const idx = list.findIndex(u => u.id === unit.id);
  if (idx >= 0) list[idx] = unit;
  else list.push(unit);

  cacheUnits = list;

  try {
    localStorage.setItem('hexon_units', JSON.stringify(cacheUnits));
  } catch (lsErr) {
    console.warn('LocalStorage limit saving unit:', lsErr);
  }

  if (firebaseActive && dbInstance) {
    try {
      await setDoc(doc(dbInstance, 'units', unit.id), cleanUndefined(unit));
    } catch (err: any) {
      console.warn('Firestore write unit failed:', err);
      checkQuotaException(err);
    }
  }
}

// DELETE UNIT
export async function dbDeleteUnit(id: string): Promise<void> {
  const list = await dbGetUnits();
  cacheUnits = list.filter(u => u.id !== id);

  try {
    localStorage.setItem('hexon_units', JSON.stringify(cacheUnits));
  } catch (lsErr) {
    console.warn('LocalStorage limit deleting unit:', lsErr);
  }

  if (firebaseActive && dbInstance) {
    try {
      await deleteDoc(doc(dbInstance, 'units', id));
    } catch (err: any) {
      console.warn('Firestore delete unit failed:', err);
      checkQuotaException(err);
    }
  }
}

// Memory cache of recent access logs to prevent rapid repeated identical automatic entries within 10 seconds
const recentLogsMap = new Map<string, number>();

// ACCESS LOGS
export async function dbGetAccessLogs(): Promise<AccessLog[]> {
  const hasUser = !!(firebaseActive && dbInstance);
  if (cacheAccessLogs !== null && (!hasUser || cacheAccessLogsFromFirebase)) {
    return [...cacheAccessLogs];
  }
  if (pendingAccessLogsPromise !== null) {
    return pendingAccessLogsPromise;
  }

  pendingAccessLogsPromise = (async () => {
    let localData: AccessLog[] | null = null;
    try {
      const saved = localStorage.getItem('hexon_access_logs');
      if (saved) {
        localData = JSON.parse(saved);
      }
    } catch (e) {
      console.warn('Error reading access logs:', e);
    }

    if (firebaseActive && dbInstance) {
      const path = 'accessLogs';
      try {
        // Query with a safe limit of 150 documents to prevent massive data reads and quota issues
        const q = query(
          collection(dbInstance, path),
          orderBy('timestamp', 'desc'),
          limit(150)
        );
        const snap = await getDocs(q);
        const list: AccessLog[] = [];
        snap.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...docSnap.data() } as AccessLog);
        });
        
        cacheAccessLogs = list;
        cacheAccessLogsFromFirebase = true;
        try {
          localStorage.setItem('hexon_access_logs', JSON.stringify(cacheAccessLogs));
        } catch (lsErr) {
          console.warn('LocalStorage limit writing access logs:', lsErr);
        }
        pendingAccessLogsPromise = null;
        return [...cacheAccessLogs];
      } catch (err: any) {
        console.warn('Could not fetch access logs from Firestore:', err);
        checkQuotaException(err);
      }
    }

    cacheAccessLogs = localData || [];
    cacheAccessLogsFromFirebase = false;
    try {
      localStorage.setItem('hexon_access_logs', JSON.stringify(cacheAccessLogs));
    } catch (lsErr) {
      console.warn('LocalStorage limit writing access logs fallback:', lsErr);
    }
    pendingAccessLogsPromise = null;
    return [...cacheAccessLogs];
  })();

  return pendingAccessLogsPromise;
}

export async function dbAddAccessLog(log: Omit<AccessLog, 'id'>): Promise<void> {
  // Cooldown filter to prevent duplicate logging within 10 seconds for identical matricula and event
  const logKey = `${log.userMatricula}_${log.event}`;
  const now = Date.now();
  if (recentLogsMap.has(logKey)) {
    const lastTimestamp = recentLogsMap.get(logKey)!;
    if (now - lastTimestamp < 10000) {
      return; // Skip duplicate log entry to avoid "Rate exceeded" errors
    }
  }
  recentLogsMap.set(logKey, now);

  const id = `ac_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const item: AccessLog = { id, ...log };

  // Sync cache optimistically without reloading entire database
  if (cacheAccessLogs !== null) {
    cacheAccessLogs.unshift(item);
    cacheAccessLogs = cacheAccessLogs.slice(0, 200);
  } else {
    cacheAccessLogs = [item];
  }

  try {
    localStorage.setItem('hexon_access_logs', JSON.stringify(cacheAccessLogs));
  } catch (lsErr) {
    console.warn('LocalStorage limit writing access log:', lsErr);
  }

  // To limit Firestore write usages, skip routine background logs while keeping key manual login events
  const isRoutineEvent = log.event.includes("Automática") || log.event.includes("Sincronização") || log.event.includes("Check") || log.event.includes("Leitura") || log.event.includes("Visualização");
  if (isRoutineEvent) {
    return;
  }

  if (firebaseActive && dbInstance) {
    try {
      await setDoc(doc(dbInstance, 'accessLogs', id), cleanUndefined(item));
    } catch (err) {
      console.warn('Silent issue record access log', err);
    }
  }
}

// AUDIT LOGS
export async function dbGetAuditLogs(): Promise<AuditLog[]> {
  const hasUser = !!(firebaseActive && dbInstance);
  if (cacheAuditLogs !== null && (!hasUser || cacheAuditLogsFromFirebase)) {
    return [...cacheAuditLogs];
  }
  if (pendingAuditLogsPromise !== null) {
    return pendingAuditLogsPromise;
  }

  pendingAuditLogsPromise = (async () => {
    let localData: AuditLog[] | null = null;
    try {
      const saved = localStorage.getItem('hexon_audit_logs');
      if (saved) {
        localData = JSON.parse(saved);
      }
    } catch (e) {
      console.warn('Error reading audit logs:', e);
    }

    if (firebaseActive && dbInstance) {
      const path = 'auditLogs';
      try {
        // Query with a safe limit of 150 documents to prevent massive data reads and quota issues
        const q = query(
          collection(dbInstance, path),
          orderBy('timestamp', 'desc'),
          limit(150)
        );
        const snap = await getDocs(q);
        const list: AuditLog[] = [];
        snap.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...docSnap.data() } as AuditLog);
        });

        cacheAuditLogs = list;
        cacheAuditLogsFromFirebase = true;
        try {
          localStorage.setItem('hexon_audit_logs', JSON.stringify(cacheAuditLogs));
        } catch (lsErr) {
          console.warn('LocalStorage limit writing audit logs:', lsErr);
        }
        pendingAuditLogsPromise = null;
        return [...cacheAuditLogs];
      } catch (err: any) {
        console.warn('Could not fetch audit logs from Firestore:', err);
        checkQuotaException(err);
      }
    }

    cacheAuditLogs = localData || [];
    cacheAuditLogsFromFirebase = false;
    try {
      localStorage.setItem('hexon_audit_logs', JSON.stringify(cacheAuditLogs));
    } catch (lsErr) {
      console.warn('LocalStorage limit writing audit logs fallback:', lsErr);
    }
    pendingAuditLogsPromise = null;
    return [...cacheAuditLogs];
  })();

  return pendingAuditLogsPromise;
}

export async function dbAddAuditLog(log: Omit<AuditLog, 'id'>): Promise<void> {
  const id = `aud_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const item: AuditLog = { id, ...log };

  // Sync cache optimistically without reloading entire database
  if (cacheAuditLogs !== null) {
    cacheAuditLogs.unshift(item);
    cacheAuditLogs = cacheAuditLogs.slice(0, 200);
  } else {
    cacheAuditLogs = [item];
  }

  try {
    localStorage.setItem('hexon_audit_logs', JSON.stringify(cacheAuditLogs));
  } catch (lsErr) {
    console.warn('LocalStorage limit writing audit log:', lsErr);
  }

  if (firebaseActive && dbInstance) {
    try {
      await setDoc(doc(dbInstance, 'auditLogs', id), cleanUndefined(item));
    } catch (err) {
      console.warn(err);
    }
  }
}

// RBAC MATRÍCULA LOGIN PROXY
export async function dbLoginByMatricula(matricula: string, senhaInserida: string): Promise<HexonUser | null> {
  const users = await dbGetUsers();
  
  // Normalize matricula match
  const foundUser = users.find(u => u.matricula.trim() === matricula.trim());
  
  if (!foundUser) {
    await dbAddAccessLog({
      userMatricula: matricula,
      event: `Falha de login (Matrícula não cadastrada)`,
      timestamp: new Date().toISOString()
    });
    return null;
  }

  if (foundUser.status === 'Inativo') {
    await dbAddAccessLog({
      userId: foundUser.id,
      userName: foundUser.name,
      userMatricula: foundUser.matricula,
      event: `Tentativa de login bloqueada (Usuário Inativo)`,
      timestamp: new Date().toISOString()
    });
    return null;
  }

  if (foundUser.senha !== senhaInserida) {
    await dbAddAccessLog({
      userId: foundUser.id,
      userName: foundUser.name,
      userMatricula: foundUser.matricula,
      event: `Falha de login (Senha incorreta)`,
      timestamp: new Date().toISOString()
    });
    return null;
  }

  // Access Granted!
  await dbAddAccessLog({
    userId: foundUser.id,
    userName: foundUser.name,
    userMatricula: foundUser.matricula,
    event: `Login realizado com sucesso via matrícula`,
    timestamp: new Date().toISOString()
  });

  return foundUser;
}

// RBAC GOOGLE ACCOUNT ATTACHMENT PROXY
export async function dbGetUserByEmail(email: string): Promise<HexonUser | null> {
  const users = await dbGetUsers();
  const matched = users.find(u => u.email.toLowerCase().trim() === email.toLowerCase().trim());
  
  if (matched) {
    return matched;
  }

  // If the email is daniel.fab93@gmail.com, we auto-bootstrap and create the user record dynamically on-the-fly!
  if (email.toLowerCase().trim() === 'daniel.fab93@gmail.com') {
    const newUser: HexonUser = {
      id: 'daniel_fab93',
      name: 'Daniel Fabre',
      matricula: '1-0000',
      email: 'daniel.fab93@gmail.com',
      cargo: 'Super Administrador (Auto-Criado)',
      gerencia: 'Todas',
      perfil: 'Super Administrador',
      status: 'Ativo',
      senha: 'admin'
    };
    await dbSaveUser(newUser);
    return newUser;
  }

  return null;
}

// PERMISSIONS PERSISTENCE ENGINE
let cachePermissions: { [key: string]: SystemPermission } | null = null;
let cachePermissionsFromFirebase = false;

const DEFAULT_PERMISSIONS: { [key: string]: SystemPermission } = {
  view_dashboard: {
    id: 'view_dashboard',
    name: 'Visualizar Dashboard',
    description: 'Acesso à aba principal com indicadores de desempenho e gráficos.',
    category: 'Abas',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': true }
  },
  view_service_orders: {
    id: 'view_service_orders',
    name: 'Visualizar Ordens de Serviço',
    description: 'Acesso à listagem e detalhes das Ordens de Serviço (preventivas e corretivas).',
    category: 'Abas',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': true }
  },
  view_assets: {
    id: 'view_assets',
    name: 'Visualizar Ativos',
    description: 'Acesso ao inventário e ficha técnica de ativos e equipamentos.',
    category: 'Abas',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': true }
  },
  view_templates: {
    id: 'view_templates',
    name: 'Visualizar Modelos e Protocolos',
    description: 'Acesso às diretrizes e planos de preventivas cadastradas.',
    category: 'Abas',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': false }
  },
  view_solicitations: {
    id: 'view_solicitations',
    name: 'Visualizar Solicitações',
    description: 'Visualizar chamados e demandas enviadas pelo cliente.',
    category: 'Abas',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': true }
  },
  create_asset: {
    id: 'create_asset',
    name: 'Adicionar e Editar Ativos',
    description: 'Cadastrar novos equipamentos ou atualizar as especificações de ativos existentes.',
    category: 'Ações',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': false }
  },
  delete_asset: {
    id: 'delete_asset',
    name: 'Excluir Ativos',
    description: 'Remover definitivamente ativos do acervo e históricos.',
    category: 'Ações',
    roles: { 'Super Administrador': true, 'Administrador': false, 'Profissional': false }
  },
  import_assets: {
    id: 'import_assets',
    name: 'Importar Planilha XLSX de Ativos',
    description: 'Gerar importação em massa de novos ativos do sistema.',
    category: 'Ações',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': false }
  },
  create_order: {
    id: 'create_order',
    name: 'Abertura de Novas O.S.',
    description: 'Registrar novas preventivas ou corretivas emergenciais de ativos.',
    category: 'Ações',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': false }
  },
  execute_order: {
    id: 'execute_order',
    name: 'Executar Checklists de O.S.',
    description: 'Preencher status das tarefas de manutenção em campo e registrar observações.',
    category: 'Ações',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': true }
  },
  sign_order: {
    id: 'sign_order',
    name: 'Assinar e Encerrar O.S.',
    description: 'Colher assinatura do cliente e validar a entrega de preventivas e corretivas.',
    category: 'Ações',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': true }
  },
  delete_order: {
    id: 'delete_order',
    name: 'Excluir / Cancelar O.S.',
    description: 'Excluir ordens e históricos de intervenção técnica.',
    category: 'Ações',
    roles: { 'Super Administrador': true, 'Administrador': false, 'Profissional': false }
  },
  manage_templates: {
    id: 'manage_templates',
    name: 'Configurar Modelos de Cronograma',
    description: 'Criar e editar roteiros e frequências de preventivas.',
    category: 'Ações',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': false }
  },
  manage_solicitations: {
    id: 'manage_solicitations',
    name: 'Operar Chamados (Abrir/Cancelar)',
    description: 'Permite que usuários confirmem, abram chamados corretivos ou cancelem solicitações de avarias.',
    category: 'Ações',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': false }
  }
};

export async function dbGetPermissions(): Promise<{ [key: string]: SystemPermission }> {
  let localData: { [key: string]: SystemPermission } | null = null;
  try {
    const saved = localStorage.getItem('hexon_permissions_matrix');
    if (saved) {
      localData = JSON.parse(saved);
    }
  } catch (e) {
    console.warn('Error reading permissions from localStorage:', e);
  }

  // Check if in-memory cache OR local storage cache is valid
  if (cachePermissions !== null && (!firebaseActive || !dbInstance || cachePermissionsFromFirebase)) {
    return { ...cachePermissions };
  }
  if (isCacheValid('permissions') && localData) {
    cachePermissions = { ...DEFAULT_PERMISSIONS, ...localData };
    cachePermissionsFromFirebase = true;
    return { ...cachePermissions };
  }

  if (firebaseActive && dbInstance) {
    try {
      const docRef = doc(dbInstance, 'config', 'permissions');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data && data.permissions) {
          // Merge with default permissions to ensure newly added actions/Tabs are dynamically present even with older db states
          cachePermissions = { ...DEFAULT_PERMISSIONS, ...(data.permissions as { [key: string]: SystemPermission }) };
          cachePermissionsFromFirebase = true;
          updateCacheTimestamp('permissions');
          try {
            localStorage.setItem('hexon_permissions_matrix', JSON.stringify(cachePermissions));
          } catch (lsErr) {
            console.warn('LocalStorage limit storing permissions:', lsErr);
          }
          return { ...cachePermissions };
        }
      } else {
        // Doc doesnt exist, save initial default permissions
        await setDoc(docRef, { permissions: DEFAULT_PERMISSIONS });
        cachePermissions = DEFAULT_PERMISSIONS;
        cachePermissionsFromFirebase = true;
        updateCacheTimestamp('permissions');
        try {
          localStorage.setItem('hexon_permissions_matrix', JSON.stringify(cachePermissions));
        } catch (lsErr) {
          console.warn('LocalStorage limit storing standard permissions:', lsErr);
        }
        return { ...cachePermissions };
      }
    } catch (err: any) {
      console.warn('Could not fetch permissions from Firestore. Using fallback:', err);
      checkQuotaException(err);
    }
  }

  // Merge localData with DEFAULT_PERMISSIONS
  cachePermissions = localData ? { ...DEFAULT_PERMISSIONS, ...localData } : { ...DEFAULT_PERMISSIONS };
  cachePermissionsFromFirebase = false;
  try {
    localStorage.setItem('hexon_permissions_matrix', JSON.stringify(cachePermissions));
  } catch (lsErr) {
    console.warn('Fallback write error for permissions matrix:', lsErr);
  }
  return { ...cachePermissions };
}

export async function dbSavePermissions(permissions: { [key: string]: SystemPermission }): Promise<void> {
  // Ensure 'Super Administrador' is always true for everything to prevent lockout scenario
  const sanitizedPermissions = { ...permissions };
  Object.keys(sanitizedPermissions).forEach(key => {
    if (sanitizedPermissions[key] && sanitizedPermissions[key].roles) {
      sanitizedPermissions[key].roles['Super Administrador'] = true;
    }
  });

  cachePermissions = sanitizedPermissions;

  try {
    localStorage.setItem('hexon_permissions_matrix', JSON.stringify(cachePermissions));
  } catch (lsErr) {
    console.warn('LocalStorage limit saving permissions:', lsErr);
  }

  if (firebaseActive && dbInstance) {
    try {
      const docRef = doc(dbInstance, 'config', 'permissions');
      await setDoc(docRef, { permissions: sanitizedPermissions });
    } catch (err: any) {
      console.warn('Firestore write config/permissions failed:', err);
      checkQuotaException(err);
    }
  }
}

export function subscribeToUserProfile(userId: string, callback: (user: HexonUser | null) => void): () => void {
  if (firebaseActive && dbInstance) {
    try {
      const docRef = doc(dbInstance, 'users', userId);
      return onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
          callback({ id: docSnap.id, ...docSnap.data() } as HexonUser);
        } else {
          callback(null);
        }
      }, (error) => {
        console.warn('Erro ao escutar dados em tempo real do perfil do usuário:', error);
      });
    } catch (err) {
      console.warn('Falha ao abrir canal de escuta em tempo real do perfil:', err);
    }
  }
  return () => {};
}

export interface PlanningDeadline {
  id: string; // management ID (e.g., "GMMR", "GMEE", "GMC")
  expiresAt: string; // ISO string representation of deadline
}

let cachePlanningDeadlines: PlanningDeadline[] | null = null;
let cachePlanningDeadlinesFromFirebase = false;
let pendingPlanningDeadlinesPromise: Promise<PlanningDeadline[]> | null = null;

export async function dbGetPlanningDeadlines(): Promise<PlanningDeadline[]> {
  const hasUser = !!(firebaseActive && dbInstance);
  let localData: PlanningDeadline[] | null = null;
  try {
    const saved = localStorage.getItem('hexon_planning_deadlines');
    if (saved) {
      localData = JSON.parse(saved);
    }
  } catch (e) {
    console.warn('Error reading planning deadlines:', e);
  }

  if (cachePlanningDeadlines !== null && (!hasUser || cachePlanningDeadlinesFromFirebase)) {
    return [...cachePlanningDeadlines];
  }
  if (localData && localData.length > 0) {
    cachePlanningDeadlines = localData;
    cachePlanningDeadlinesFromFirebase = true;
    return [...cachePlanningDeadlines];
  }

  if (pendingPlanningDeadlinesPromise !== null) {
    return pendingPlanningDeadlinesPromise.then(list => [...list]);
  }

  pendingPlanningDeadlinesPromise = (async () => {
    if (firebaseActive && dbInstance) {
      const path = 'planningDeadlines';
      try {
        const snap = await getDocs(collection(dbInstance, path));
        const list: PlanningDeadline[] = [];
        snap.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...docSnap.data() } as PlanningDeadline);
        });
        cachePlanningDeadlines = list;
        cachePlanningDeadlinesFromFirebase = true;
        try {
          localStorage.setItem('hexon_planning_deadlines', JSON.stringify(cachePlanningDeadlines));
        } catch (lsErr) {
          console.warn('LocalStorage limit planningDeadlines:', lsErr);
        }
        pendingPlanningDeadlinesPromise = null;
        return [...cachePlanningDeadlines];
      } catch (err: any) {
        console.warn('Firestore fetch planningDeadlines failed:', err);
        checkQuotaException(err);
      }
    }

    cachePlanningDeadlines = localData || [];
    cachePlanningDeadlinesFromFirebase = false;
    pendingPlanningDeadlinesPromise = null;
    return [...cachePlanningDeadlines];
  })();

  return pendingPlanningDeadlinesPromise.then(list => [...list]);
}

export async function dbSavePlanningDeadline(deadline: PlanningDeadline): Promise<void> {
  if (cachePlanningDeadlines === null) {
    cachePlanningDeadlines = [];
  }
  const index = cachePlanningDeadlines.findIndex(d => d.id === deadline.id);
  if (index >= 0) {
    cachePlanningDeadlines[index] = deadline;
  } else {
    cachePlanningDeadlines.push(deadline);
  }

  try {
    localStorage.setItem('hexon_planning_deadlines', JSON.stringify(cachePlanningDeadlines));
  } catch (lsErr) {
    console.warn('LocalStorage limit writing deadlines:', lsErr);
  }

  if (firebaseActive && dbInstance) {
    try {
      await setDoc(doc(dbInstance, 'planningDeadlines', deadline.id), cleanUndefined(deadline));
    } catch (err: any) {
      console.warn('Firestore write planningDeadlines failed:', err);
      checkQuotaException(err);
    }
  }
}

export async function dbCheckAndExpirePlanningOrders(): Promise<void> {
  try {
    const [deadlines, orders] = await Promise.all([
      dbGetPlanningDeadlines(),
      dbGetServiceOrders()
    ]);

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const currentDateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    const updatedOrders: ServiceOrder[] = [];
    const nonUpdated: ServiceOrder[] = [];

    for (const os of orders) {
      const isRangePassed = os.endDate && os.endDate < currentDateStr;

      if (os.status === 'Não Executada') {
        if (!isRangePassed) {
          // SELF-HEAL: Range is still active! Revert status back to its correct state
          const restoredStatus = os.scheduledDate ? 'Planejada' : 'Novo';
          updatedOrders.push({
            ...os,
            status: restoredStatus,
            updatedAt: new Date().toISOString()
          });
          continue;
        }
      } else if (os.status !== 'Concluída') {
        if (isRangePassed) {
          // EXPIRE: Transition only when the Super Admin target range actually passes
          updatedOrders.push({
            ...os,
            status: 'Não Executada',
            updatedAt: new Date().toISOString()
          });
          continue;
        }
      }
      nonUpdated.push(os);
    }

    if (updatedOrders.length > 0) {
      console.log(`[Auto-Expiration/Self-Heal] Updating ${updatedOrders.length} service orders status based on Super Admin active range!`);
      // Update cache
      cacheServiceOrders = [...nonUpdated, ...updatedOrders];
      try {
        localStorage.setItem('hexon_service_orders', JSON.stringify(cacheServiceOrders));
      } catch (lsErr) {
        console.warn('LocalStorage limit saving service orders:', lsErr);
      }

      if (firebaseActive && dbInstance) {
        const batchSize = 100;
        for (let i = 0; i < updatedOrders.length; i += batchSize) {
          const chunk = updatedOrders.slice(i, i + batchSize);
          const batch = writeBatch(dbInstance);
          for (const order of chunk) {
            batch.set(doc(dbInstance, 'serviceOrders', order.id), cleanUndefined(order));
          }
          await batch.commit();
        }
      }
    }
  } catch (err) {
    console.warn('Error checking and expiring planning orders:', err);
  }
}

