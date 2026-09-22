import { collection, doc, getDocs, setDoc, query, orderBy, limit } from 'firebase/firestore';
import { AccessLog, AuditLog } from '../types';
import {
  firebaseActive,
  dbInstance,
  cleanUndefined,
  checkQuotaException
} from './core';

// Memory cache of recent access logs to prevent rapid repeated identical automatic entries within 10 seconds
const recentLogsMap = new Map<string, number>();

let cacheAccessLogs: AccessLog[] | null = null;
let cacheAccessLogsFromFirebase = false;
let pendingAccessLogsPromise: Promise<AccessLog[]> | null = null;

let cacheAuditLogs: AuditLog[] | null = null;
let cacheAuditLogsFromFirebase = false;
let pendingAuditLogsPromise: Promise<AuditLog[]> | null = null;

export function clearAuditCache(): void {
  cacheAccessLogs = null;
  cacheAccessLogsFromFirebase = false;
  pendingAccessLogsPromise = null;

  cacheAuditLogs = null;
  cacheAuditLogsFromFirebase = false;
  pendingAuditLogsPromise = null;
}

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
