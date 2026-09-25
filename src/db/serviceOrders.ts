import {
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
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
import { dbRemoveFromDispatchIndex } from './dispatchIndex';

export interface PlanningDeadline {
  id: string; // management ID (e.g., "GMMR", "GMEE", "GMC")
  expiresAt: string; // ISO string representation of deadline
}

// In-Memory Caches
let cacheServiceOrders: ServiceOrder[] | null = null;
let cacheServiceOrdersFromFirebase = false;
let pendingOrdersPromise: Promise<ServiceOrder[]> | null = null;

// Históricos gravados nesta sessão (usados só como reserva quando o banco está indisponível)
let cacheAllHistories: MaintenanceLog[] | null = null;

// Assinaturas já baixadas nesta sessão (a imagem fica em "orderSignatures", fora da OS)
const signatureCache = new Map<string, string>();

let cachePlanningDeadlines: PlanningDeadline[] | null = null;
let cachePlanningDeadlinesFromFirebase = false;
let pendingPlanningDeadlinesPromise: Promise<PlanningDeadline[]> | null = null;

export function clearServiceOrdersCache(): void {
  cacheServiceOrders = null;
  cacheServiceOrdersFromFirebase = false;
  pendingOrdersPromise = null;
  signatureCache.clear();
}

export function clearHistoriesCache(): void {
  cacheAllHistories = null;
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

// Local date (yyyy-mm-dd). toISOString() would use UTC and flip to "tomorrow" at 21h in Brazil.
export function localTodayStr(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Mês local no formato AAAA-MM (ex.: "2026-09"). Usado para buscar as OS fechadas de um mês.
export function localMonthKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// Mês de encerramento gravado na OS (campo closedMonth):
// - Concluída: mês da conclusão (mantém o que já estava gravado)
// - Não Executada: mês em que terminou o período do Super Admin (uma OS de setembro conta em setembro)
// - Aberta: nenhum (o campo é removido, ex.: OS reaberta)
function computeClosedMonth(o: ServiceOrder, status: ServiceOrder['status']): string | undefined {
  if (status === 'Concluída') {
    return o.status === 'Concluída' && o.closedMonth ? o.closedMonth : localMonthKey();
  }
  if (status === 'Não Executada') {
    return (o.endDate || '').slice(0, 7) || o.closedMonth || localMonthKey();
  }
  return undefined;
}

// Situação da solicitação de corretiva (itens do checklist respondidos "Sim"), gravada na OS:
// permite buscar direto as solicitações pendentes, sem varrer as ordens.
function computeSolicitationStatus(o: ServiceOrder): ServiceOrder['solicitationStatus'] {
  const requested = (o.checklist || []).filter((item) => item.autoCreateCorrective === true && item.autoCorrectiveAnswer === 'Sim');
  if (requested.length === 0) return undefined;
  const withStatus = requested.find((item) => item.autoCorrectiveStatus);
  return withStatus?.autoCorrectiveStatus || 'Pendente';
}

// REGRA DE PRAZOS DA OS
// - Período do Super Admin (endDate) venceu sem conclusão  -> "Não Executada" (OS encerrada)
// - Janela do técnico (scheduledEndDate/scheduledDate) venceu -> "Atrasada" (encarregado pode remarcar)
// - OS "Atrasada" remarcada para uma janela futura           -> volta a "Planejada"
// - OS "Não Executada" cujo período do Super Admin foi prorrogado -> reaberta
// "Em Execução" não vira "Atrasada": o técnico já iniciou e pode concluir até o fim do período.
export function computeDeadlineStatus(o: ServiceOrder, todayStr: string = localTodayStr()): ServiceOrder['status'] {
  if (o.status === 'Concluída') return o.status;

  const slaExpired = !!(o.endDate && todayStr > o.endDate);
  if (slaExpired) return 'Não Executada';

  const executionDeadline = o.scheduledEndDate || o.scheduledDate;
  const windowExpired = !!(executionDeadline && todayStr > executionDeadline);

  if (o.status === 'Não Executada') {
    if (windowExpired) return 'Atrasada';
    return o.scheduledDate ? 'Planejada' : 'Novo';
  }
  if (o.status === 'Planejada' && windowExpired) return 'Atrasada';
  if (o.status === 'Atrasada' && !windowExpired) return executionDeadline ? 'Planejada' : 'Novo';
  return o.status;
}

function processExpiredOrders(orders: ServiceOrder[]): ServiceOrder[] {
  const todayStr = localTodayStr();
  const processed = orders.map((o) => {
    const status = computeDeadlineStatus(o, todayStr);
    return status === o.status ? o : { ...o, status };
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

// ORDENS EM TEMPO REAL (lista e calendário da gestão)
// Carrega só o necessário: TODAS as OS abertas da gerência + as fechadas do mês visto.
// Depois da primeira carga, o banco envia apenas as OS que mudarem (ex.: técnico concluiu).
const OPEN_STATUSES: ServiceOrder['status'][] = ['Novo', 'Planejada', 'Em Execução', 'Atrasada'];

export interface ServiceOrdersScope {
  sector: string | null; // gerência (campo "sector" da OS); null = todas as gerências
  technicianNames?: string[]; // técnico: só as OS atribuídas a ele (variações do nome/matrícula)
}

// Variações do nome/matrícula com que a OS pode ter sido atribuída ao técnico (máx. 5)
export function technicianCandidates(technicianName: string, matricula?: string): string[] {
  const rawName = (technicianName || '').trim();
  const rawMatricula = (matricula || '').trim();
  return Array.from(new Set([
    rawName,
    rawName.toLowerCase(),
    rawName.toUpperCase(),
    rawMatricula,
    rawMatricula.toLowerCase()
  ])).filter(Boolean) as string[];
}

export function subscribeServiceOrders(
  scope: ServiceOrdersScope,
  month: string,
  onChange: (orders: ServiceOrder[]) => void
): () => void {
  if (!firebaseActive || !dbInstance) {
    // Sem banco: usa os dados guardados neste navegador
    dbGetServiceOrders().then(onChange).catch(() => onChange([]));
    return () => {};
  }

  const ordersRef = collection(dbInstance, 'serviceOrders');
  const sectorFilter = scope.technicianNames
    ? [where('assignedTechnician', 'in', scope.technicianNames.slice(0, 5))]
    : scope.sector
    ? [where('sector', '==', scope.sector)]
    : [];
  let openOrders: ServiceOrder[] | null = null;
  let closedOrders: ServiceOrder[] | null = null;

  const toList = (snap: { forEach: (cb: (d: any) => void) => void }): ServiceOrder[] => {
    const list: ServiceOrder[] = [];
    snap.forEach((d) => {
      if (!isMockOrLegacyId(d.id)) {
        list.push({ id: d.id, ...d.data() } as ServiceOrder);
      }
    });
    return list;
  };

  // Junta as duas buscas (a aberta prevalece) e mostra o status recalculado pelos prazos
  const emit = () => {
    if (openOrders === null || closedOrders === null) return;
    const byId = new Map<string, ServiceOrder>();
    for (const o of closedOrders) byId.set(o.id, o);
    for (const o of openOrders) byId.set(o.id, o);
    const todayStr = localTodayStr();
    const list = Array.from(byId.values())
      .map((o) => {
        const status = computeDeadlineStatus(o, todayStr);
        return status === o.status ? o : { ...o, status };
      })
      .sort(compareOrdersNewestFirst);
    onChange(list);
  };

  const unsubscribeOpen = onSnapshot(
    query(ordersRef, ...sectorFilter, where('status', 'in', OPEN_STATUSES)),
    (snap) => {
      openOrders = toList(snap);
      emit();
    },
    (err) => {
      console.warn('Firestore listen open service orders failed:', err);
      checkQuotaException(err);
      openOrders = openOrders || [];
      emit();
    }
  );

  const unsubscribeClosed = onSnapshot(
    query(ordersRef, ...sectorFilter, where('closedMonth', '==', month)),
    (snap) => {
      closedOrders = toList(snap);
      emit();
    },
    (err) => {
      console.warn('Firestore listen closed service orders failed:', err);
      checkQuotaException(err);
      closedOrders = closedOrders || [];
      emit();
    }
  );

  return () => {
    unsubscribeOpen();
    unsubscribeClosed();
  };
}

// SOLICITAÇÕES DE CORRETIVA
// Pendentes: carregadas em tempo real (são poucas; somem da lista assim que recebem uma ação).
export function subscribePendingSolicitations(
  scope: ServiceOrdersScope,
  onChange: (orders: ServiceOrder[]) => void
): () => void {
  if (!firebaseActive || !dbInstance) {
    onChange([]);
    return () => {};
  }
  const sectorFilter = scope.sector ? [where('sector', '==', scope.sector)] : [];
  return onSnapshot(
    query(collection(dbInstance, 'serviceOrders'), ...sectorFilter, where('solicitationStatus', '==', 'Pendente')),
    (snap) => {
      const list: ServiceOrder[] = [];
      snap.forEach((d) => {
        if (!isMockOrLegacyId(d.id)) list.push({ id: d.id, ...d.data() } as ServiceOrder);
      });
      onChange(list.sort(compareOrdersNewestFirst));
    },
    (err) => {
      console.warn('Firestore listen pending solicitations failed:', err);
      checkQuotaException(err);
      onChange([]);
    }
  );
}

// Com ação (confirmadas / canceladas): só quando o usuário filtra, em páginas, das mais recentes para as mais antigas.
export interface SolicitationsPage {
  orders: ServiceOrder[];
  cursor: unknown; // passe de volta em "after" para buscar a próxima página
  hasMore: boolean;
}

export async function dbGetHandledSolicitationsPage(
  scope: ServiceOrdersScope,
  statuses: Array<'Resolvido' | 'Cancelado'>,
  pageSize: number,
  after?: unknown
): Promise<SolicitationsPage> {
  if (!firebaseActive || !dbInstance || statuses.length === 0) {
    return { orders: [], cursor: null, hasMore: false };
  }
  const sectorFilter = scope.sector ? [where('sector', '==', scope.sector)] : [];
  const constraints: any[] = [
    ...sectorFilter,
    where('solicitationStatus', 'in', statuses),
    orderBy('updatedAt', 'desc'),
    limit(pageSize)
  ];
  if (after) constraints.push(startAfter(after));

  try {
    const snap = await getDocs(query(collection(dbInstance, 'serviceOrders'), ...constraints));
    const list: ServiceOrder[] = [];
    snap.forEach((d) => {
      if (!isMockOrLegacyId(d.id)) list.push({ id: d.id, ...d.data() } as ServiceOrder);
    });
    return {
      orders: list,
      cursor: snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : after || null,
      hasMore: snap.docs.length === pageSize
    };
  } catch (err: any) {
    console.warn('Firestore fetch handled solicitations failed:', err);
    checkQuotaException(err);
    return { orders: [], cursor: after || null, hasMore: false };
  }
}

// Totais por situação (consulta de contagem: não baixa as ordens)
export async function dbCountSolicitations(
  scope: ServiceOrdersScope
): Promise<{ pendente: number; resolvido: number; cancelado: number }> {
  const empty = { pendente: 0, resolvido: 0, cancelado: 0 };
  if (!firebaseActive || !dbInstance) return empty;
  const sectorFilter = scope.sector ? [where('sector', '==', scope.sector)] : [];
  const countOf = async (status: 'Pendente' | 'Resolvido' | 'Cancelado') => {
    const snap = await getCountFromServer(
      query(collection(dbInstance!, 'serviceOrders'), ...sectorFilter, where('solicitationStatus', '==', status))
    );
    return snap.data().count;
  };
  try {
    const [pendente, resolvido, cancelado] = await Promise.all([countOf('Pendente'), countOf('Resolvido'), countOf('Cancelado')]);
    return { pendente, resolvido, cancelado };
  } catch (err: any) {
    console.warn('Firestore count solicitations failed:', err);
    checkQuotaException(err);
    return empty;
  }
}

// CONSULTA DE OS (ordens encerradas de um mês)
// O banco filtra por mês + gerência + UM filtro principal (CRAAI, comarca ou técnico);
// status e texto são refinados na tela. Sem filtro principal, o resultado é limitado.
export type OrdersSearchField = 'craai' | 'comarca' | 'assignedTechnician';

export interface OrdersSearchParams {
  month: string;              // "AAAA-MM" (obrigatório)
  sector: string | null;      // gerência; null = todas
  field: OrdersSearchField | null;
  value: string;
}

export const ORDERS_SEARCH_LIMIT = 500;

export async function dbSearchClosedOrders(
  params: OrdersSearchParams
): Promise<{ orders: ServiceOrder[]; limited: boolean }> {
  if (!params.month || !firebaseActive || !dbInstance) return { orders: [], limited: false };
  const constraints: any[] = [];
  if (params.sector) constraints.push(where('sector', '==', params.sector));
  constraints.push(where('closedMonth', '==', params.month));
  if (params.field && params.value) constraints.push(where(params.field, '==', params.value));
  constraints.push(limit(ORDERS_SEARCH_LIMIT));

  const snap = await getDocs(query(collection(dbInstance, 'serviceOrders'), ...constraints));
  const list: ServiceOrder[] = [];
  snap.forEach((d) => {
    if (!isMockOrLegacyId(d.id)) list.push({ id: d.id, ...d.data() } as ServiceOrder);
  });
  return { orders: list.sort(compareOrdersNewestFirst), limited: snap.docs.length >= ORDERS_SEARCH_LIMIT };
}

// Get a single service order by its number (1 leitura). Usado para abrir OS antigas pelo histórico do ativo.
export async function dbGetServiceOrderById(orderId: string): Promise<ServiceOrder | null> {
  if (!orderId) return null;

  if (firebaseActive && dbInstance) {
    try {
      const snap = await getDoc(doc(dbInstance, 'serviceOrders', orderId));
      if (!snap.exists()) return null;
      const order = { id: snap.id, ...snap.data() } as ServiceOrder;
      return { ...order, status: computeDeadlineStatus(order) };
    } catch (err: any) {
      console.warn('Firestore fetch single service order failed:', err);
      checkQuotaException(err);
    }
  }

  return (cacheServiceOrders || []).find((o) => o.id === orderId) || null;
}

// ASSINATURA DA OS
// A imagem da assinatura fica em "orderSignatures/{id}" e não dentro da OS:
// as listas de OS ficam leves e a imagem só é baixada ao abrir a OS ou gerar o PDF.
export async function dbGetOrderSignature(orderId: string): Promise<string | null> {
  if (!orderId) return null;
  const cached = signatureCache.get(orderId);
  if (cached) return cached;

  if (firebaseActive && dbInstance) {
    try {
      const snap = await getDoc(doc(dbInstance, 'orderSignatures', orderId));
      const signature = snap.exists() ? (snap.data().signature as string) || null : null;
      if (signature) signatureCache.set(orderId, signature);
      return signature;
    } catch (err: any) {
      console.warn('Firestore fetch order signature failed:', err);
      checkQuotaException(err);
    }
  }
  return null;
}

// Grava a assinatura em "orderSignatures". Retorna false se não conseguiu (a OS então mantém a imagem consigo).
async function saveOrderSignature(orderId: string, signature: string): Promise<boolean> {
  if (!firebaseActive || !dbInstance) return false;
  try {
    await setDoc(doc(dbInstance, 'orderSignatures', orderId), {
      orderId,
      signature,
      savedAt: new Date().toISOString()
    });
    signatureCache.set(orderId, signature);
    return true;
  } catch (err: any) {
    console.warn('Firestore write order signature failed, keeping it inside the order:', err);
    checkQuotaException(err);
    return false;
  }
}

// Save or Update service order
export async function dbSaveServiceOrder(order: ServiceOrder): Promise<void> {
  // Assinatura nova: vai para "orderSignatures" e sai do documento da OS
  let signatureFields: Pick<ServiceOrder, 'signature' | 'hasSignature'> = {
    signature: order.signature,
    hasSignature: order.hasSignature
  };
  if (order.signature && (await saveOrderSignature(order.id, order.signature))) {
    signatureFields = { signature: null, hasSignature: true };
  }

  // Grava sempre o status coerente com os prazos (ex.: remarcar uma OS "Atrasada" volta para "Planejada")
  const status = computeDeadlineStatus(order);
  const orderWithUpdate: ServiceOrder = {
    ...order,
    ...signatureFields,
    status,
    closedMonth: computeClosedMonth(order, status),
    solicitationStatus: computeSolicitationStatus(order),
    updatedAt: new Date().toISOString()
  };

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

  // Atualiza a lista em memória, se ela já foi carregada (não baixa todas as ordens só para salvar uma)
  if (cacheServiceOrders !== null) {
    const idx = cacheServiceOrders.findIndex((o) => o.id === order.id);
    if (idx >= 0) {
      cacheServiceOrders[idx] = orderWithUpdate;
    } else {
      cacheServiceOrders.push(orderWithUpdate);
    }

    try {
      localStorage.setItem('hexon_service_orders', JSON.stringify(cacheServiceOrders));
    } catch (lsErr) {
      console.warn('LocalStorage limit saving service order:', lsErr);
    }
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
  // Remove da lista em memória, se ela já foi carregada (não baixa todas as ordens só para excluir uma)
  if (cacheServiceOrders !== null) {
    cacheServiceOrders = cacheServiceOrders.filter((o) => o.id !== orderId);

    try {
      localStorage.setItem('hexon_service_orders', JSON.stringify(cacheServiceOrders));
    } catch (lsErr) {
      console.warn('LocalStorage limit deleting service order:', lsErr);
    }
  }
  signatureCache.delete(orderId);

  // Delete from Firestore if signed-in
  if (firebaseActive && dbInstance) {
    try {
      await deleteDoc(doc(dbInstance, 'serviceOrders', orderId));
    } catch (err: any) {
      console.warn('Firestore delete service order failed:', err);
      checkQuotaException(err);
      return;
    }
    try {
      // Apaga também a assinatura, se existir (apagar documento inexistente não gera erro)
      await deleteDoc(doc(dbInstance, 'orderSignatures', orderId));
    } catch (err) {
      console.warn('Firestore delete signature failed:', err);
    }
    // Tira a OS do registro do disparo, para que o período possa ser disparado de novo
    await dbRemoveFromDispatchIndex(orderId);
  }
}

// Get maintenance logs for a specific asset
// Busca no banco SÓ o histórico deste ativo (antes baixava o histórico de todos os ativos).
export async function dbGetAssetHistory(assetId: string): Promise<MaintenanceLog[]> {
  if (!assetId) return [];

  // Uma entrada por OS (a mais recente), da mais nova para a mais antiga
  const sortAndDeduplicate = (items: MaintenanceLog[]): MaintenanceLog[] => {
    const sorted = [...items].sort((a, d) => (d.date || '').localeCompare(a.date || ''));
    const map = new Map<string, MaintenanceLog>();
    for (const item of sorted) {
      const key = item.osId ? `os_${item.osId}` : item.id;
      if (!map.has(key)) {
        map.set(key, item);
      }
    }
    return Array.from(map.values());
  };

  if (firebaseActive && dbInstance) {
    try {
      const snap = await getDocs(query(collection(dbInstance, 'histories'), where('assetId', '==', assetId)));
      const list: MaintenanceLog[] = [];
      snap.forEach((docSnap) => {
        if (!isMockOrLegacyId(docSnap.id)) {
          list.push({ id: docSnap.id, ...docSnap.data() } as MaintenanceLog);
        }
      });
      return sortAndDeduplicate(list);
    } catch (err: any) {
      console.warn('Firestore fetch asset history failed, utilizing offline fallback:', err);
      checkQuotaException(err);
    }
  }

  // Reserva offline: históricos gravados neste navegador
  let localData: MaintenanceLog[] = cacheAllHistories || [];
  if (localData.length === 0) {
    try {
      const saved = localStorage.getItem('hexon_histories');
      if (saved) localData = JSON.parse(saved);
    } catch (e) {
      console.warn('Error reading maintenance logs:', e);
    }
  }
  return sortAndDeduplicate(localData.filter((h) => h.assetId === assetId));
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

  if (!firebaseActive || !dbInstance) return;

  try {
    // Lê do banco SOMENTE as OS em aberto, com o status realmente gravado.
    // (A lista em memória já vem com o status recalculado para exibição, então
    //  comparar com ela nunca detectava mudança e nada era gravado.)
    const snap = await getDocs(query(
      collection(dbInstance, 'serviceOrders'),
      where('status', 'in', ['Novo', 'Planejada', 'Em Execução', 'Atrasada'])
    ));

    const todayStr = localTodayStr();
    const changes: { id: string; status: ServiceOrder['status']; closedMonth?: string }[] = [];
    snap.forEach((d) => {
      if (isMockOrLegacyId(d.id)) return;
      const stored = { id: d.id, ...d.data() } as ServiceOrder;
      const status = computeDeadlineStatus(stored, todayStr);
      if (status !== stored.status) changes.push({ id: d.id, status, closedMonth: computeClosedMonth(stored, status) });
    });

    if (changes.length > 0) {
      console.log(`[Prazos] Atualizando o status de ${changes.length} ordens de serviço.`);
      const updatedAt = new Date().toISOString();
      const batchSize = 100;
      for (let i = 0; i < changes.length; i += batchSize) {
        const chunk = changes.slice(i, i + batchSize);
        const batch = writeBatch(dbInstance);
        for (const c of chunk) {
          // Atualiza só o status, sem sobrescrever a OS inteira (evita apagar edições simultâneas).
          // Ao virar "Não Executada", grava também o mês de encerramento (closedMonth).
          const fields: { status: ServiceOrder['status']; updatedAt: string; closedMonth?: string } = { status: c.status, updatedAt };
          if (c.closedMonth) fields.closedMonth = c.closedMonth;
          batch.update(doc(dbInstance, 'serviceOrders', c.id), fields);
        }
        await batch.commit();
      }

      // Mantém o cache local coerente com o que foi gravado
      if (cacheServiceOrders) {
        const byId = new Map(changes.map((c) => [c.id, c.status]));
        cacheServiceOrders = cacheServiceOrders.map((o) =>
          byId.has(o.id) ? { ...o, status: byId.get(o.id)!, updatedAt } : o
        );
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
  const candidates = technicianCandidates(technicianName, matricula);

  if (candidates.length === 0) {
    return [];
  }

  if (firebaseActive && dbInstance) {
    try {
      // Só as OS abertas do técnico + as que ele fechou no mês atual (não baixa o histórico inteiro)
      const byTechnician = where('assignedTechnician', 'in', candidates);
      const [openSnap, closedSnap] = await Promise.all([
        getDocs(query(collection(dbInstance, 'serviceOrders'), byTechnician, where('status', 'in', OPEN_STATUSES))),
        getDocs(query(collection(dbInstance, 'serviceOrders'), byTechnician, where('closedMonth', '==', localMonthKey())))
      ]);
      const byId = new Map<string, ServiceOrder>();
      closedSnap.forEach((d) => {
        if (!isMockOrLegacyId(d.id)) byId.set(d.id, { id: d.id, ...d.data() } as ServiceOrder);
      });
      openSnap.forEach((d) => {
        if (!isMockOrLegacyId(d.id)) byId.set(d.id, { id: d.id, ...d.data() } as ServiceOrder);
      });
      const list = Array.from(byId.values());

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

