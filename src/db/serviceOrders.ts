import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  setDoc,
  writeBatch
} from 'firebase/firestore';
import { MaintenanceLog, ServiceOrder } from '../types';
import {
  firebaseActive,
  dbInstance,
  cleanUndefined,
  isCacheValid,
  updateCacheTimestamp,
  checkQuotaException
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
