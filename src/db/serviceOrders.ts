import {
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDocs,
  limit,
  query,
  setDoc,
  where,
  writeBatch
} from 'firebase/firestore';
import { MaintenanceLog, ServiceOrder } from '../types';
import {
  firebaseActive,
  dbInstance,
  cleanUndefined,
  isCacheValid,
  updateCacheTimestamp,
  checkQuotaException,
  ensureFirebaseAuthReady
} from './core';
import { isMockOrLegacyId } from './templates';

export interface PlanningDeadline {
  id: string; // management ID (e.g., "GMMR", "GMEE", "GMC")
  expiresAt: string; // ISO string representation of deadline
}

// In-Memory Caches
let cacheServiceOrders: ServiceOrder[] | null = null;
let cacheServiceOrdersFromFirebase = false;
let pendingOrdersPromise: Promise<ServiceOrder[]> | null = null;

let cacheAllHistories: MaintenanceLog[] | null = null;
let cacheAllHistoriesFromFirebase = false;
let pendingHistoriesPromise: Promise<MaintenanceLog[]> | null = null;

let cachePlanningDeadlines: PlanningDeadline[] | null = null;
let cachePlanningDeadlinesFromFirebase = false;
let pendingPlanningDeadlinesPromise: Promise<PlanningDeadline[]> | null = null;

export function clearServiceOrdersCache(): void {
  cacheServiceOrders = null;
  cacheServiceOrdersFromFirebase = false;
  pendingOrdersPromise = null;
}

export function clearHistoriesCache(): void {
  cacheAllHistories = null;
  cacheAllHistoriesFromFirebase = false;
  pendingHistoriesPromise = null;
}

export function clearPlanningDeadlinesCache(): void {
  cachePlanningDeadlines = null;
  cachePlanningDeadlinesFromFirebase = false;
  pendingPlanningDeadlinesPromise = null;
}

// Newest first. Sorts by creation date because OS numbers are no longer purely numeric
// (e.g. "AS_GMMR_2702-MEN-20260901"), so numeric comparison would break the order.
function compareOrdersNewestFirst(a: ServiceOrder, d: ServiceOrder): number {
  const byCreatedAt = (d.createdAt || '').localeCompare(a.createdAt || '');
  if (byCreatedAt !== 0) return byCreatedAt;
  return String(d.id).localeCompare(String(a.id));
}

function processExpiredOrders(orders: ServiceOrder[]): ServiceOrder[] {
  const todayStr = new Date().toISOString().slice(0, 10);
  const processed = orders.map((o) => {
    if (o.status !== 'Concluída' && o.status !== 'Não Executada') {
      // Check 1: Super Admin month limit SLA (endDate) has passed
      const hasSlaExpired = !!(o.endDate && todayStr > o.endDate);
      // Check 2: Scheduled execution window has passed without execution
      const executionDeadline = o.scheduledEndDate || o.scheduledDate;
      const hasExecutionWindowExpired = !!(executionDeadline && todayStr > executionDeadline);

      if (hasSlaExpired || hasExecutionWindowExpired) {
        return {
          ...o,
          status: 'Não Executada' as const,
          updatedAt: new Date().toISOString()
        };
      }
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
    return processExpiredOrders([...cacheServiceOrders]).sort(compareOrdersNewestFirst);
  }
  if (isCacheValid('serviceOrders') && localData && localData.length > 0) {
    cacheServiceOrders = localData;
    cacheServiceOrdersFromFirebase = true;
    return processExpiredOrders([...cacheServiceOrders]).sort(compareOrdersNewestFirst);
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
        return [...cacheServiceOrders].sort(compareOrdersNewestFirst);
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
    return processExpiredOrders([...cacheServiceOrders]).sort(compareOrdersNewestFirst);
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

    // Build clean observations sections (without polluting with desdobramento/ações corretivas)
    let correctiveActionsText = '';
    const sections: string[] = [];

    // Items with technician observations
    const itemsWithObs = order.checklist.filter(c => c.observations && c.observations.trim());

    if (itemsWithObs.length > 0) {
      const details = itemsWithObs.map(i => {
        const statusLabel = i.statusCheck ? ` [Status: ${i.statusCheck}]` : (!i.checked ? ' [Não Conforme]' : '');
        return `• ${i.task}${statusLabel}:\n   ↳ Relato Técnico: "${i.observations!.trim()}"`;
      }).join('\n');
      sections.push(`📋 Observações e Apontamentos do Checklist:\n${details}`);
    }

    // Assemble final clean text
    if (sections.length > 0) {
      correctiveActionsText = sections.join('\n\n');
    } else {
      correctiveActionsText = 'Equipamento operando em conformidade técnica.';
    }

    const historyEntry: MaintenanceLog = {
      id: `hist_${order.id}`,
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

    // Build clean observations sections (without polluting with desdobramento/ações corretivas)
    let correctiveActionsText = '';
    const sections: string[] = [];

    // Items with observations
    const itemsWithObs = matchingOrder.checklist.filter(c => c.observations && c.observations.trim());

    if (itemsWithObs.length > 0) {
      const details = itemsWithObs.map(i => {
        const statusLabel = i.statusCheck ? ` [Status: ${i.statusCheck}]` : (!i.checked ? ' [Não Conforme]' : '');
        return `• ${i.task}${statusLabel}:\n   ↳ Relato Técnico: "${i.observations!.trim()}"`;
      }).join('\n');
      sections.push(`📋 Observações e Apontamentos do Checklist:\n${details}`);
    }

    if (sections.length > 0) {
      correctiveActionsText = sections.join('\n\n');
    } else {
      correctiveActionsText = 'Equipamento operando em conformidade técnica.';
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

  // Helper function to deduplicate maintenance logs by OS ID (preferring the most recent entry)
  const deduplicateLogs = (items: MaintenanceLog[]): MaintenanceLog[] => {
    const map = new Map<string, MaintenanceLog>();
    for (const item of items) {
      const key = item.osId ? `os_${item.osId}` : item.id;
      if (!map.has(key)) {
        map.set(key, item);
      }
    }
    return Array.from(map.values());
  };

  if (cacheAllHistories !== null && (!hasUser || cacheAllHistoriesFromFirebase)) {
    const filtered = cacheAllHistories
      .filter((h) => h.assetId === assetId)
      .sort((a, d) => d.date.localeCompare(a.date));
    return enrichHistoryList(deduplicateLogs(filtered), orders);
  }
  if (isCacheValid('histories') && localData && localData.length > 0) {
    cacheAllHistories = localData;
    cacheAllHistoriesFromFirebase = true;
    const filtered = cacheAllHistories
      .filter((h) => h.assetId === assetId)
      .sort((a, d) => d.date.localeCompare(a.date));
    return enrichHistoryList(deduplicateLogs(filtered), orders);
  }
  if (pendingHistoriesPromise !== null) {
    const list = await pendingHistoriesPromise;
    const filtered = list
      .filter((h) => h.assetId === assetId)
      .sort((a, d) => d.date.localeCompare(a.date));
    const loadedOrders = await dbGetServiceOrders();
    return enrichHistoryList(deduplicateLogs(filtered), loadedOrders);
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
  return enrichHistoryList(deduplicateLogs(filtered), loadedOrders);
}

// Adds an entry to the history log
export async function dbAddHistoryLog(log: MaintenanceLog): Promise<void> {
  if (cacheAllHistories === null) {
    cacheAllHistories = [];
  }

  // Prevent duplicate entries for the same finished service order session, update if exists
  const existingIndex = cacheAllHistories!.findIndex(h => h.id === log.id || (Boolean(h.osId && log.osId) && h.osId === log.osId));
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
    try {
      await setDoc(doc(dbInstance, 'histories', log.id), cleanUndefined(log));
    } catch (err: any) {
      console.warn('Firestore write history failed:', err);
      checkQuotaException(err);
    }
  }
}

export function appendServiceOrdersCache(newOrders: ServiceOrder[]): void {
  if (cacheServiceOrders === null) {
    cacheServiceOrders = [...newOrders];
  } else {
    for (const ord of newOrders) {
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
}

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

let lastExpireCheck = 0;

export async function dbCheckAndExpirePlanningOrders(): Promise<void> {
  // Throttle to at most once every 15 minutes to prevent hammering Firestore write limits
  const nowMs = Date.now();
  if (nowMs - lastExpireCheck < 15 * 60 * 1000) {
    return;
  }
  lastExpireCheck = nowMs;

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
      const isSlaPassed = !!(os.endDate && os.endDate < currentDateStr);
      const executionDeadline = os.scheduledEndDate || os.scheduledDate;
      const isExecutionWindowPassed = !!(executionDeadline && executionDeadline < currentDateStr);
      const isExpired = isSlaPassed || isExecutionWindowPassed;

      if (os.status === 'Não Executada') {
        if (!isExpired) {
          // SELF-HEAL: Neither SLA nor execution window has passed! Revert status back to its correct state
          const restoredStatus = os.scheduledDate ? 'Planejada' : 'Novo';
          updatedOrders.push({
            ...os,
            status: restoredStatus,
            updatedAt: new Date().toISOString()
          });
          continue;
        }
      } else if (os.status !== 'Concluída') {
        if (isExpired) {
          // EXPIRE: Transition when the SLA range or the scheduled window passes without completion
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

export interface TechnicianOrdersFilterOptions {
  technicianName: string;
  matricula?: string;
  filterStatus: 'pending' | 'in_progress' | 'completed' | 'all';
  page: number;
  pageSize: number;
  searchQuery?: string;
  isAdmin?: boolean;
}

export interface TechnicianOrdersResult {
  orders: ServiceOrder[];
  totalCount: number;
  pendingCount: number;
  inProgressCount: number;
  completedCount: number;
  totalPages: number;
  currentPage: number;
}

/**
 * Fast, Server-Side Filtered & Paginated loader for Field Technicians.
 * Strictly limits download to the technician's assigned orders and only the current page (e.g. 20 items).
 * Does NOT download the entire database, preventing mobile memory overload and network latency.
 */
export async function dbGetTechnicianOrdersPaginated(
  options: TechnicianOrdersFilterOptions
): Promise<TechnicianOrdersResult> {
  const { technicianName, matricula, filterStatus, page, pageSize, searchQuery, isAdmin } = options;

  const rawName = (technicianName || '').trim();
  const rawMatricula = (matricula || '').trim();

  const candidates = Array.from(new Set([
    rawName,
    rawName.toLowerCase(),
    rawName.toUpperCase(),
    rawMatricula,
    rawMatricula.toLowerCase()
  ])).filter(Boolean) as string[];

  // If not admin and no technician candidates identified, return empty
  if (!isAdmin && candidates.length === 0) {
    return {
      orders: [],
      totalCount: 0,
      pendingCount: 0,
      inProgressCount: 0,
      completedCount: 0,
      totalPages: 1,
      currentPage: 1
    };
  }

  if (firebaseActive && dbInstance) {
    try {
      // 1. Fetch exact server-side counts using Firestore's fast getCountFromServer
      let pendingCount = 0;
      let inProgressCount = 0;
      let completedCount = 0;
      let allCount = 0;

      try {
        if (isAdmin) {
          const [cPending, cExec, cDone, cAll] = await Promise.all([
            getCountFromServer(query(collection(dbInstance, 'serviceOrders'), where('status', 'in', ['Novo', 'Planejada', 'Atrasada']))),
            getCountFromServer(query(collection(dbInstance, 'serviceOrders'), where('status', '==', 'Em Execução'))),
            getCountFromServer(query(collection(dbInstance, 'serviceOrders'), where('status', '==', 'Concluída'))),
            getCountFromServer(collection(dbInstance, 'serviceOrders'))
          ]);
          pendingCount = cPending.data().count;
          inProgressCount = cExec.data().count;
          completedCount = cDone.data().count;
          allCount = cAll.data().count;
        } else {
          const [cPending, cExec, cDone, cAll] = await Promise.all([
            getCountFromServer(query(collection(dbInstance, 'serviceOrders'), where('assignedTechnician', 'in', candidates), where('status', 'in', ['Novo', 'Planejada', 'Atrasada']))),
            getCountFromServer(query(collection(dbInstance, 'serviceOrders'), where('assignedTechnician', 'in', candidates), where('status', '==', 'Em Execução'))),
            getCountFromServer(query(collection(dbInstance, 'serviceOrders'), where('assignedTechnician', 'in', candidates), where('status', '==', 'Concluída'))),
            getCountFromServer(query(collection(dbInstance, 'serviceOrders'), where('assignedTechnician', 'in', candidates)))
          ]);
          pendingCount = cPending.data().count;
          inProgressCount = cExec.data().count;
          completedCount = cDone.data().count;
          allCount = cAll.data().count;
        }
      } catch (errCount) {
        console.warn('getCountFromServer fallback for technician:', errCount);
      }

      const hasSearch = typeof searchQuery === 'string' && searchQuery.trim().length > 0;

      // 2. If user is searching by text, retrieve filtered set and search client-side
      if (hasSearch) {
        let baseQ;
        if (isAdmin) {
          if (filterStatus === 'pending') {
            baseQ = query(collection(dbInstance, 'serviceOrders'), where('status', 'in', ['Novo', 'Planejada', 'Atrasada']));
          } else if (filterStatus === 'in_progress') {
            baseQ = query(collection(dbInstance, 'serviceOrders'), where('status', '==', 'Em Execução'));
          } else if (filterStatus === 'completed') {
            baseQ = query(collection(dbInstance, 'serviceOrders'), where('status', '==', 'Concluída'));
          } else {
            baseQ = collection(dbInstance, 'serviceOrders');
          }
        } else {
          if (filterStatus === 'pending') {
            baseQ = query(collection(dbInstance, 'serviceOrders'), where('assignedTechnician', 'in', candidates), where('status', 'in', ['Novo', 'Planejada', 'Atrasada']));
          } else if (filterStatus === 'in_progress') {
            baseQ = query(collection(dbInstance, 'serviceOrders'), where('assignedTechnician', 'in', candidates), where('status', '==', 'Em Execução'));
          } else if (filterStatus === 'completed') {
            baseQ = query(collection(dbInstance, 'serviceOrders'), where('assignedTechnician', 'in', candidates), where('status', '==', 'Concluída'));
          } else {
            baseQ = query(collection(dbInstance, 'serviceOrders'), where('assignedTechnician', 'in', candidates));
          }
        }

        const snap = await getDocs(baseQ);
        const allList: ServiceOrder[] = [];
        snap.forEach(d => {
          if (!isMockOrLegacyId(d.id)) {
            allList.push({ id: d.id, ...(d.data() as any) } as ServiceOrder);
          }
        });

        const qLower = searchQuery.toLowerCase().trim();
        const filtered = allList.filter(o => {
          const mTitle = (o.title || '').toLowerCase().includes(qLower);
          const mAsset = (o.assetName || '').toLowerCase().includes(qLower);
          const mCode = (o.assetCode || '').toLowerCase().includes(qLower);
          const mId = (o.id || '').toLowerCase().includes(qLower);
          const mSector = (o.sector || '').toLowerCase().includes(qLower);
          const mDesc = (o.description || '').toLowerCase().includes(qLower);
          return mTitle || mAsset || mCode || mId || mSector || mDesc;
        });

        const totalCount = filtered.length;
        const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
        const safePage = Math.min(Math.max(1, page), totalPages);
        const startIndex = (safePage - 1) * pageSize;
        const paginated = filtered.slice(startIndex, startIndex + pageSize);

        return {
          orders: paginated,
          totalCount,
          pendingCount,
          inProgressCount,
          completedCount,
          totalPages,
          currentPage: safePage
        };
      }

      // 3. Normal view: Fetch strictly the required page documents (pageSize items)
      const fetchLimit = Math.max(pageSize, page * pageSize);
      let pageQ;

      if (isAdmin) {
        if (filterStatus === 'pending') {
          pageQ = query(collection(dbInstance, 'serviceOrders'), where('status', 'in', ['Novo', 'Planejada', 'Atrasada']), limit(fetchLimit));
        } else if (filterStatus === 'in_progress') {
          pageQ = query(collection(dbInstance, 'serviceOrders'), where('status', '==', 'Em Execução'), limit(fetchLimit));
        } else if (filterStatus === 'completed') {
          pageQ = query(collection(dbInstance, 'serviceOrders'), where('status', '==', 'Concluída'), limit(fetchLimit));
        } else {
          pageQ = query(collection(dbInstance, 'serviceOrders'), limit(fetchLimit));
        }
      } else {
        if (filterStatus === 'pending') {
          pageQ = query(collection(dbInstance, 'serviceOrders'), where('assignedTechnician', 'in', candidates), where('status', 'in', ['Novo', 'Planejada', 'Atrasada']), limit(fetchLimit));
        } else if (filterStatus === 'in_progress') {
          pageQ = query(collection(dbInstance, 'serviceOrders'), where('assignedTechnician', 'in', candidates), where('status', '==', 'Em Execução'), limit(fetchLimit));
        } else if (filterStatus === 'completed') {
          pageQ = query(collection(dbInstance, 'serviceOrders'), where('assignedTechnician', 'in', candidates), where('status', '==', 'Concluída'), limit(fetchLimit));
        } else {
          pageQ = query(collection(dbInstance, 'serviceOrders'), where('assignedTechnician', 'in', candidates), limit(fetchLimit));
        }
      }

      const snap = await getDocs(pageQ);
      const docsList: ServiceOrder[] = [];
      snap.forEach(d => {
        if (!isMockOrLegacyId(d.id)) {
          docsList.push({ id: d.id, ...(d.data() as any) } as ServiceOrder);
        }
      });

      const activeTotal = filterStatus === 'pending' ? pendingCount
        : filterStatus === 'in_progress' ? inProgressCount
        : filterStatus === 'completed' ? completedCount
        : allCount;

      const totalPages = Math.max(1, Math.ceil(activeTotal / pageSize));
      const safePage = Math.min(Math.max(1, page), totalPages);
      const startIndex = (safePage - 1) * pageSize;
      const paginated = docsList.slice(startIndex, startIndex + pageSize);

      return {
        orders: paginated,
        totalCount: activeTotal,
        pendingCount,
        inProgressCount,
        completedCount,
        totalPages,
        currentPage: safePage
      };
    } catch (e: any) {
      console.warn('Firestore technician paginated query failed, falling back to local data:', e);
      checkQuotaException(e);
    }
  }

  // 4. Offline / LocalStorage Fallback (strictly scoped to technician)
  let localData: ServiceOrder[] = [];
  try {
    const saved = localStorage.getItem('hexon_service_orders');
    if (saved) {
      localData = JSON.parse(saved);
    }
  } catch {}

  const techOrders = isAdmin 
    ? localData 
    : localData.filter(o => {
        const tech = (o.assignedTechnician || '').trim().toLowerCase();
        return candidates.some(c => c.toLowerCase() === tech);
      });

  const pendingCount = techOrders.filter(o => o.status !== 'Concluída' && o.status !== 'Não Executada' && o.status !== 'Em Execução').length;
  const inProgressCount = techOrders.filter(o => o.status === 'Em Execução').length;
  const completedCount = techOrders.filter(o => o.status === 'Concluída').length;
  const allCount = techOrders.length;

  let filtered = techOrders;
  if (filterStatus === 'pending') {
    filtered = filtered.filter(o => o.status !== 'Concluída' && o.status !== 'Não Executada' && o.status !== 'Em Execução');
  } else if (filterStatus === 'in_progress') {
    filtered = filtered.filter(o => o.status === 'Em Execução');
  } else if (filterStatus === 'completed') {
    filtered = filtered.filter(o => o.status === 'Concluída');
  }

  if (searchQuery && searchQuery.trim()) {
    const qLower = searchQuery.toLowerCase().trim();
    filtered = filtered.filter(o => {
      const mTitle = (o.title || '').toLowerCase().includes(qLower);
      const mAsset = (o.assetName || '').toLowerCase().includes(qLower);
      const mCode = (o.assetCode || '').toLowerCase().includes(qLower);
      const mId = (o.id || '').toLowerCase().includes(qLower);
      return mTitle || mAsset || mCode || mId;
    });
  }

  const totalCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const paginated = filtered.slice(startIndex, startIndex + pageSize);

  return {
    orders: paginated,
    totalCount,
    pendingCount,
    inProgressCount,
    completedCount,
    totalPages,
    currentPage: safePage
  };
}

/**
 * Optimized Server-Side query for Field Technicians.
 * Strictly queries orders where assignedTechnician matches the technician's name or matricula.
 * Does NOT download all 10,000+ orders, saving massive bandwidth and database reads.
 */
export async function dbGetOrdersForTechnician(
  technicianName: string,
  matricula?: string
): Promise<ServiceOrder[]> {
  const rawName = (technicianName || '').trim();
  const rawMatricula = (matricula || '').trim();

  const candidates = Array.from(new Set([
    rawName,
    rawName.toLowerCase(),
    rawName.toUpperCase(),
    rawMatricula,
    rawMatricula.toLowerCase()
  ])).filter(Boolean) as string[];

  if (candidates.length === 0) {
    return [];
  }

  if (firebaseActive && dbInstance) {
    try {
      // Query orders assigned to any of the candidate variations (limit 30 in array)
      const q = query(
        collection(dbInstance, 'serviceOrders'),
        where('assignedTechnician', 'in', candidates.slice(0, 30))
      );
      const snap = await getDocs(q);
      const list: ServiceOrder[] = [];
      snap.forEach((d) => {
        if (!isMockOrLegacyId(d.id)) {
          list.push({ id: d.id, ...d.data() } as ServiceOrder);
        }
      });

      // Update local storage cache for offline protection
      try {
        localStorage.setItem('hexon_service_orders', JSON.stringify(list));
      } catch (e) {
        console.warn('LocalStorage limit caching technician orders:', e);
      }

      return processExpiredOrders(list).sort(compareOrdersNewestFirst);
    } catch (err: any) {
      console.warn('Firestore dbGetOrdersForTechnician failed, falling back to local storage:', err);
      checkQuotaException(err);
    }
  }

  // Offline fallback
  try {
    const saved = localStorage.getItem('hexon_service_orders');
    if (saved) {
      const parsed: ServiceOrder[] = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return parsed.filter(o => {
          const tech = (o.assignedTechnician || '').trim().toLowerCase();
          return candidates.some(c => c.toLowerCase() === tech);
        });
      }
    }
  } catch (e) {
    console.warn('LocalStorage fallback error in dbGetOrdersForTechnician:', e);
  }

  return [];
}

// SECURE PUBLIC ASSET ORDERS (Fetches only active/recent orders belonging strictly to this single asset)
export async function dbGetAssetOrdersPublic(assetId: string, assetCode?: string): Promise<ServiceOrder[]> {
  if (!assetId && !assetCode) return [];

  const candidateIds = Array.from(new Set([
    assetId,
    assetCode,
    assetCode?.toUpperCase(),
    assetCode?.toLowerCase()
  ])).filter(Boolean) as string[];

  if (firebaseActive && dbInstance) {
    try {
      await ensureFirebaseAuthReady(1500);
      const q = query(
        collection(dbInstance, 'serviceOrders'),
        where('assetId', 'in', candidateIds.slice(0, 10))
      );
      const snap = await getDocs(q);
      const list: ServiceOrder[] = [];
      snap.forEach((d) => {
        if (!isMockOrLegacyId(d.id)) {
          list.push({ id: d.id, ...d.data() } as ServiceOrder);
        }
      });
      return processExpiredOrders(list);
    } catch (err: any) {
      console.warn('dbGetAssetOrdersPublic error querying Firestore:', err);
      checkQuotaException(err);
    }
  }

  // Offline fallback
  try {
    const saved = localStorage.getItem('hexon_service_orders');
    if (saved) {
      const parsed: ServiceOrder[] = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return parsed.filter(o => 
          candidateIds.some(c => c.toLowerCase() === (o.assetId || '').toLowerCase())
        );
      }
    }
  } catch (e) {}

  return [];
}

