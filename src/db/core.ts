import { initializeApp, getApp, getApps } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  getAuth,
  initializeAuth,
  inMemoryPersistence,
  signInAnonymously,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  signOut,
  onAuthStateChanged
} from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  getDocFromServer,
  collection,
  getDocs,
  limit,
  query
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Operation types for custom Firestore error handling
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
  };
}

export let firebaseActive = false;
export let dbInstance: any = null;
export let authInstance: any = null;
export let anonymousAuthRestricted = false;

// Determine if Firebase holds valid configuration (not placeholders)
export const isFirebaseConfigured =
  firebaseConfig &&
  firebaseConfig.apiKey &&
  firebaseConfig.apiKey !== '' &&
  !firebaseConfig.apiKey.includes('PLACEHOLDER');

if (isFirebaseConfigured) {
  try {
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    
    // Attempt initializing with an offline-resilient IndexedDB cache
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
export function cleanUndefined<T>(obj: T): T {
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

export function clearQuotaException(): void {
  if (typeof window !== 'undefined') {
    (window as any).__hexonFirebaseQuotaExceeded = false;
  }
}

// Custom Error Handler required by the Firebase integration skill
export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const auth = authInstance;
  const errMsg = error instanceof Error ? error.message : String(error);

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

// Cache Expiration / Read Reduction Engine
export const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12-Hour Cache TTL to limit Firestore reads

export function isCacheValid(key: string): boolean {
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

export function updateCacheTimestamp(key: string) {
  try {
    const rawTimestamps = localStorage.getItem('hexon_cache_timestamps') || '{}';
    const timestamps = JSON.parse(rawTimestamps);
    timestamps[key] = Date.now();
    localStorage.setItem('hexon_cache_timestamps', JSON.stringify(timestamps));
  } catch (e) {
    console.warn('Error writing cache timestamp:', e);
  }
}

// Get connection status for Header / UI indicators
export function dbGetConnectionStatus(): {
  active: boolean;
  isFirebase: boolean;
  projectName: string;
  isGoogleAuthenticated: boolean;
  userName: string;
  userEmail: string;
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

// Troca a senha do próprio usuário logado, conferindo a senha atual no Firebase Auth
export async function changeOwnFirebasePassword(email: string, currentPassword: string, newPassword: string): Promise<'ok' | 'wrong-password' | 'weak-password' | 'error'> {
  if (!firebaseActive || !authInstance) return 'error';
  const u = authInstance.currentUser;
  if (!u || u.isAnonymous || u.email !== email) return 'error';
  try {
    await reauthenticateWithCredential(u, EmailAuthProvider.credential(email, currentPassword));
  } catch (e: any) {
    const c = e?.code || '';
    return (c === 'auth/wrong-password' || c === 'auth/invalid-credential') ? 'wrong-password' : 'error';
  }
  try {
    await updatePassword(u, newPassword);
    return 'ok';
  } catch (e: any) {
    return e?.code === 'auth/weak-password' ? 'weak-password' : 'error';
  }
}

// Cria contas do Firebase Auth para OUTROS usuários sem derrubar a sessão do administrador
let secondaryAuthInstance: any = null;
function getSecondaryAuth() {
  if (secondaryAuthInstance) return secondaryAuthInstance;
  const name = 'hexon-admin-secondary';
  const existing = getApps().find(a => a.name === name);
  const secondaryApp = existing || initializeApp(firebaseConfig, name);
  secondaryAuthInstance = existing ? getAuth(secondaryApp) : initializeAuth(secondaryApp, { persistence: inMemoryPersistence });
  return secondaryAuthInstance;
}

export async function createAuthAccountForUser(email: string, password: string): Promise<{ uid?: string; error?: string }> {
  if (!firebaseActive) return { error: 'firebase-inativo' };
  const secAuth = getSecondaryAuth();
  try {
    const cred = await createUserWithEmailAndPassword(secAuth, email, password);
    const uid = cred.user.uid;
    await signOut(secAuth);
    return { uid };
  } catch (e: any) {
    return { error: e?.code || String(e) };
  }
}

export async function firebaseSignInWithPassword(email: string, password: string): Promise<{ user?: any; error?: string }> {
  if (!firebaseActive || !authInstance) return { error: 'firebase-inativo' };
  try {
    const cred = await signInWithEmailAndPassword(authInstance, email, password);
    return { user: cred.user };
  } catch (e: any) {
    return { error: e?.code || String(e) };
  }
}

// Redefine a senha de outro usuário para 123456 via Cloud Function (somente Super Administrador)
export async function adminResetUserPassword(userId: string): Promise<{ ok: boolean; error?: string }> {
  if (!firebaseActive) return { ok: false, error: 'firebase-inativo' };
  try {
    const fns = getFunctions(getApp(), 'us-central1');
    const call = httpsCallable(fns, 'resetUserPassword');
    await call({ userId });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.code || e?.message || String(e) };
  }
}

// Ensures Firebase Auth has completed initialization before attempting unauthenticated public reads
export async function ensureFirebaseAuthReady(timeoutMs = 2500): Promise<void> {
  if (!firebaseActive || !authInstance) return;
  if (authInstance.currentUser) return;

  try {
    const authPromise = new Promise<void>((resolve) => {
      const unsubscribe = onAuthStateChanged(authInstance, (user) => {
        if (user) {
          unsubscribe();
          resolve();
        }
      });
      // Also attempt anonymous sign in in parallel if none exists
      signInHexonAnonymously().catch(() => {}).finally(() => {
        unsubscribe();
        resolve();
      });
    });

    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    });

    await Promise.race([authPromise, timeoutPromise]);
  } catch (e) {
    console.warn('ensureFirebaseAuthReady finished with notice:', e);
  }
}

// Expose standard Sign-out action
export async function signOutHexon(): Promise<void> {
  if (authInstance) {
    await signOut(authInstance);
  }
}

// CONNECTION BOOTSTRAP CHECK REQUIRED BY THE SYSTEM SKILL
export async function testFirebaseConnection(): Promise<boolean> {
  if (!firebaseActive || !dbInstance) return false;
  try {
    const q = query(collection(dbInstance, 'config'), limit(1));
    await getDocs(q);
    clearQuotaException();
    return true;
  } catch (error: any) {
    checkQuotaException(error);
    const errMsg = error?.message || String(error);
    if (errMsg.includes('the client is offline') || errMsg.includes('unavailable') || errMsg.includes('Could not reach')) {
      console.warn("Por favor, verifique a configuração do seu Firebase. O cliente está offline.");
    }
    return false;
  }
}

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


