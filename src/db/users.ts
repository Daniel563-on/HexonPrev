import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore';
import { HexonUser } from '../types';
import {
  firebaseActive,
  dbInstance,
  cleanUndefined,
  isCacheValid,
  updateCacheTimestamp,
  checkQuotaException,
  authenticateWithFirebaseAuth
} from './core';
import { dbAddAccessLog } from './audit';
import { SEED_MANAGEMENTS, SEED_UNITS } from './organization';

// SANITIZE USER: Guarantees password hashes are NEVER exposed to client-side state, UI, or local inspection
export function sanitizeUserForClient(user: HexonUser): HexonUser {
  const safe = { ...user };
  delete safe.senha;
  return safe;
}

// SESSION INTEGRITY & ANTI-F12 VERIFICATION RESULT
export interface SessionVerificationResult {
  isValid: boolean;
  verifiedUser?: HexonUser;
  reason?: string;
}

// ANTI-F12 TAMPERING DEFENSE: Validates the user's role and matricula directly against the server-side document
export async function dbVerifySessionAuthenticity(user: HexonUser): Promise<SessionVerificationResult> {
  if (!user || !user.id || !user.matricula) {
    return { isValid: false, reason: 'Dados de sessão incompletos ou ausentes.' };
  }

  if (firebaseActive && dbInstance) {
    try {
      const userRef = doc(dbInstance, 'users', user.id);
      const snap = await getDoc(userRef);

      if (!snap.exists()) {
        return { isValid: false, reason: 'Conta de usuário não encontrada no servidor central.' };
      }

      const serverData = snap.data() as HexonUser;

      if (serverData.status === 'Inativo') {
        return { isValid: false, reason: 'Sua conta de acesso foi inativada pela administração.' };
      }

      // Detect if user modified 'perfil' or 'matricula' in localStorage via browser DevTools (F12)
      if (
        serverData.perfil !== user.perfil ||
        serverData.matricula.trim().toLowerCase() !== user.matricula.trim().toLowerCase()
      ) {
        console.warn(`[Segurança] Tentativa de alteração de privilégios detectada! Servidor: ${serverData.perfil} | Navegador: ${user.perfil}`);
        return {
          isValid: false,
          reason: 'Divergência de privilégios detectada. Sua sessão foi encerrada por segurança.'
        };
      }

      return {
        isValid: true,
        verifiedUser: sanitizeUserForClient({ id: snap.id, ...serverData })
      };
    } catch (err: any) {
      console.warn('Verificação de integridade de sessão (modo tolerante a falhas de rede):', err);
      // Em falhas transitórias de conexão, mantém a sessão pré-existente
      return { isValid: true, verifiedUser: user };
    }
  }

  return { isValid: true, verifiedUser: user };
}

// Default Precomputed Seed Data for instant professional system preview
export const SEED_USERS: HexonUser[] = [
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

// SECURE PASSWORD HASHING (SHA-256 with enterprise salt)
export async function hashPassword(password: string): Promise<string> {
  if (!password) return '';

  try {
    const encoder = new TextEncoder();
    // Salted with application-specific pepper to prevent rainbow table attacks
    const data = encoder.encode(`hexon_pepper_salt_2026_${password}`);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return `hexon_sha256:${hashHex}`;
  } catch (e) {
    // Robust fallback if subtle crypto is unavailable in rare environments
    return `hexon_sha256:${btoa(encodeURIComponent(`hexon_fallback_${password}`))}`;
  }
}

// VERIFY PASSWORD (Hardened against Pass-The-Hash attacks while supporting legacy plain-text migration)
export async function verifyPassword(passwordInserted: string, storedPassword?: string): Promise<boolean> {
  if (!storedPassword || !passwordInserted) return false;

  // 1. If stored password is a modern secure SHA-256 hash:
  // Strictly hash the raw user input and compare. NEVER allow plain equality with stored hash!
  if (storedPassword.startsWith('hexon_sha256:')) {
    const hashedInput = await hashPassword(passwordInserted);
    return storedPassword === hashedInput;
  }

  // 2. Strict backward compatibility: ONLY applies if stored password is NOT hashed yet
  return storedPassword === passwordInserted;
}

export async function dbVerifyCurrentPassword(userId: string, senhaDigitada: string): Promise<boolean> {
  if (!userId || !senhaDigitada) return false;
  if (!firebaseActive || !dbInstance) return false;
  try {
    const snap = await getDoc(doc(dbInstance, 'users', userId));
    if (!snap.exists()) return false;
    const stored = (snap.data() as HexonUser).senha;
    return verifyPassword(senhaDigitada, stored);
  } catch (e) {
    console.warn('Falha ao verificar senha atual:', e);
    return false;
  }
}

// Helper to check and bootstrap initial tables/collections asynchronously
async function bootstrapRBACCollectionsIfEmpty() {
  if (!firebaseActive || !dbInstance) return;

  try {
    // 1. Seed users if empty
    const usersSnap = await getDocs(collection(dbInstance, 'users'));
    if (usersSnap.empty) {
      console.log('Seeding default users into Firestore...');
      for (const u of SEED_USERS) {
        const secureUser = { ...u, senha: await hashPassword(u.senha || 'admin') };
        await setDoc(doc(dbInstance, 'users', secureUser.id), cleanUndefined(secureUser));
      }
    } else {
      // Ensure specific Super Admin user with Daniel Fabre exists/is up to date
      const dDoc = await getDoc(doc(dbInstance, 'users', 'daniel_fab93'));
      if (!dDoc.exists()) {
        const u = SEED_USERS[0];
        const secureUser = { ...u, senha: await hashPassword(u.senha || 'admin') };
        await setDoc(doc(dbInstance, 'users', secureUser.id), cleanUndefined(secureUser));
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

// IN-MEMORY USER CACHE
let cacheUsers: HexonUser[] | null = null;
let cacheUsersFromFirebase = false;
let pendingUsersPromise: Promise<HexonUser[]> | null = null;

export function clearUsersCache(): void {
  cacheUsers = null;
  cacheUsersFromFirebase = false;
  pendingUsersPromise = null;
}

// GET USERS
export async function dbGetUsers(forceFresh: boolean = false): Promise<HexonUser[]> {
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

  if (!forceFresh) {
    // Check if in-memory cache OR local storage cache is valid
    if (cacheUsers !== null && (!hasUser || cacheUsersFromFirebase)) {
      return [...cacheUsers];
    }
    if (isCacheValid('users') && localData && localData.length > 0) {
      cacheUsers = localData;
      cacheUsersFromFirebase = true;
      return [...cacheUsers];
    }
  }

  if (pendingUsersPromise !== null && !forceFresh) {
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
          list.push(sanitizeUserForClient({ id: docSnap.id, ...docSnap.data() } as HexonUser));
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

    cacheUsers = (localData || [...SEED_USERS]).map(sanitizeUserForClient);
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
  // Always fetch fresh users to check for duplicate matriculas
  const users = await dbGetUsers(true);

  const sanitizedMatricula = (user.matricula || '').trim();
  if (!sanitizedMatricula) {
    throw new Error('A matrícula do colaborador é obrigatória.');
  }

  // Trava de Matrícula Única: impedir que outro usuário tenha a mesma matrícula
  const duplicate = users.find(
    u => u.matricula.trim().toLowerCase() === sanitizedMatricula.toLowerCase() && u.id !== user.id
  );
  if (duplicate) {
    throw new Error(`A matrícula "${sanitizedMatricula}" já pertence ao colaborador "${duplicate.name}". Por favor, defina uma matrícula única.`);
  }

  // Ensure password is safely encrypted with SHA-256 before persisting
  const safeUser: HexonUser = { ...user, matricula: sanitizedMatricula };
  if (safeUser.senha && !safeUser.senha.startsWith('hexon_sha256:')) {
    safeUser.senha = await hashPassword(safeUser.senha);
  } else if (!safeUser.senha && firebaseActive && dbInstance) {
    // If updating a user and password was not typed, retain existing hashed password from Firestore
    try {
      const existingSnap = await getDoc(doc(dbInstance, 'users', safeUser.id));
      if (existingSnap.exists()) {
        const existingData = existingSnap.data() as HexonUser;
        if (existingData?.senha) {
          safeUser.senha = existingData.senha;
        }
      }
    } catch (e) {
      console.warn('Could not retain previous user password hash:', e);
    }
  }

  // Maintain client-side cache clean without passwords
  const clientUser = sanitizeUserForClient(safeUser);
  const index = users.findIndex(u => u.id === safeUser.id);

  if (index >= 0) {
    users[index] = { ...users[index], ...clientUser };
  } else {
    users.push(clientUser);
  }

  cacheUsers = users;
  cacheUsersFromFirebase = true;
  updateCacheTimestamp('users');

  try {
    localStorage.setItem('hexon_users', JSON.stringify(cacheUsers));
  } catch (lsErr) {
    console.warn('LocalStorage limit saving user:', lsErr);
  }

  if (firebaseActive && dbInstance) {
    try {
      await setDoc(doc(dbInstance, 'users', safeUser.id), cleanUndefined(safeUser), { merge: true });
    } catch (err: any) {
      console.error('Firestore write user failed:', err);
      checkQuotaException(err);
      throw err;
    }
  }
}

// UPDATE USER SESSION ID (Fast targeted write for single-session enforcement)
export async function dbUpdateUserSessionId(userId: string, sessionId: string): Promise<void> {
  // Update in-memory and local caches immediately
  if (cacheUsers) {
    const idx = cacheUsers.findIndex(u => u.id === userId);
    if (idx >= 0) {
      cacheUsers[idx].currentSessionId = sessionId;
      try {
        localStorage.setItem('hexon_users', JSON.stringify(cacheUsers));
      } catch {}
    }
  }

  // Update in Firestore directly using updateDoc (or merge fallback)
  if (firebaseActive && dbInstance) {
    try {
      const userRef = doc(dbInstance, 'users', userId);
      await updateDoc(userRef, { currentSessionId: sessionId });
    } catch (err: any) {
      console.warn('Firestore update session id failed, using setDoc fallback:', err);
      try {
        await setDoc(doc(dbInstance, 'users', userId), { currentSessionId: sessionId }, { merge: true });
      } catch (mergeErr) {
        console.error('Failed to set session id merge:', mergeErr);
      }
    }
  }
}

// DELETE USER
export async function dbDeleteUser(userId: string): Promise<void> {
  const users = await dbGetUsers(true);
  cacheUsers = users.filter(u => u.id !== userId && u.matricula !== userId);
  cacheUsersFromFirebase = true;
  updateCacheTimestamp('users');

  try {
    localStorage.setItem('hexon_users', JSON.stringify(cacheUsers));
  } catch (lsErr) {
    console.warn('LocalStorage limit deleting user:', lsErr);
  }

  if (firebaseActive && dbInstance) {
    try {
      await deleteDoc(doc(dbInstance, 'users', userId));
    } catch (err: any) {
      console.error('Firestore delete user failed:', err);
      checkQuotaException(err);
      throw err;
    }
  }
}

export function matriculaToAuthEmail(matricula: string): string {
  const local = matricula.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_');
  return `${local}@hexon.corp`;
}

export async function dbLinkAuthUid(userId: string, authUid: string): Promise<void> {
  if (!firebaseActive || !dbInstance || !userId || !authUid) return;
  try {
    await updateDoc(doc(dbInstance, 'users', userId), { authUid });
    await setDoc(doc(dbInstance, 'authIndex', authUid), { userId });
  } catch (e) {
    console.warn('Falha ao vincular authUid:', e);
  }
}

// RBAC MATRÍCULA LOGIN PROXY
export async function dbLoginByMatricula(matricula: string, senhaInserida: string): Promise<HexonUser | null> {
  const sanitized = matricula.trim();
  if (!sanitized) return null;

  let foundUser: HexonUser | null = null;

  if (firebaseActive && dbInstance) {
    try {
      // Direct 1-doc targeted query by matricula directly from Firestore
      const q = query(collection(dbInstance, 'users'), where('matricula', '==', sanitized), limit(1));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const docSnap = snap.docs[0];
        foundUser = { id: docSnap.id, ...docSnap.data() } as HexonUser;
      }
    } catch (err: any) {
      console.warn('Direct Firestore login query failed:', err);
      checkQuotaException(err);
    }
  }

  // Fallback to local default / cached users if offline
  if (!foundUser) {
    const localUsers = cacheUsers || [...SEED_USERS];
    foundUser = localUsers.find(u => u.matricula.trim().toLowerCase() === sanitized.toLowerCase()) || null;
  }

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

  // Robust verification (matches SHA-256 hash or legacy plain-text)
  const isPasswordValid = await verifyPassword(senhaInserida, foundUser.senha);

  if (!isPasswordValid) {
    await dbAddAccessLog({
      userId: foundUser.id,
      userName: foundUser.name,
      userMatricula: foundUser.matricula,
      event: `Falha de login (Senha incorreta)`,
      timestamp: new Date().toISOString()
    });
    return null;
  }

  // Transparent auto-upgrade: if stored password is still legacy plain text, hash it and save in background!
  if (foundUser.senha && !foundUser.senha.startsWith('hexon_sha256:')) {
    (async () => {
      try {
        const hashed = await hashPassword(senhaInserida);
        await dbSaveUser({ ...foundUser!, senha: hashed });
      } catch (e) {
        console.warn('Background auto-upgrade to password hash failed:', e);
      }
    })();
  }

  // Vincula a sessão ao Firebase Authentication (sem bloquear o login em caso de falha)
  try {
    const authUser = await authenticateWithFirebaseAuth(
      matriculaToAuthEmail(foundUser.matricula),
      senhaInserida
    );
    if (authUser) {
      await dbLinkAuthUid(foundUser.id, authUser.uid);
      foundUser.authUid = authUser.uid;
    }
  } catch (e) {
    console.info('Vínculo com Firebase Auth não concluído (login legado mantido):', e);
  }

  // Access Granted!
  await dbAddAccessLog({
    userId: foundUser.id,
    userName: foundUser.name,
    userMatricula: foundUser.matricula,
    event: `Login realizado com sucesso via matrícula`,
    timestamp: new Date().toISOString()
  });

  // RETURN SANITIZED USER (Never pass password hash into UI / state)
  return sanitizeUserForClient(foundUser);
}

// RBAC GOOGLE ACCOUNT ATTACHMENT PROXY
export async function dbGetUserByEmail(email: string): Promise<HexonUser | null> {
  const users = await dbGetUsers();
  const matched = users.find(u => u.email.toLowerCase().trim() === email.toLowerCase().trim());

  if (matched) {
    return sanitizeUserForClient(matched);
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
    return sanitizeUserForClient(newUser);
  }

  return null;
}

// SUBSCRIBE TO USER PROFILE
export function subscribeToUserProfile(userId: string, callback: (user: HexonUser | null) => void): () => void {
  if (firebaseActive && dbInstance) {
    try {
      const docRef = doc(dbInstance, 'users', userId);
      return onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
          callback(sanitizeUserForClient({ id: docSnap.id, ...docSnap.data() } as HexonUser));
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
