import { runBulk } from './guard';
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
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  writeBatch
} from './guard';
import { MaintenanceLog, ServiceOrder, resolveOrderUnit, localDateTimeStr, isCorrectiveRequested } from '../types';
import { dbGetManagements } from './organization';
import { dbGetAssets } from './assets';
import { getAssetComarca, getAssetCraai } from './preventiveEngine';
import {
  firebaseActive,
  dbInstance,
  cleanUndefined,
  withoutEmptyTechnician,
  isCacheValid,
  updateCacheTimestamp,
  checkQuotaException,
  ensureFirebaseAuthReady,
  awaitWrite
} from './core';
import { isMockOrLegacyId } from './templates';
import { withOrderControl, orderControlUpdate } from './orderControl';
import { ensureChecklistVersions, hydrateOrders, onChecklistVersionLoaded, toStoredOrder } from './checklistVersions';

// Busca de uma vez: baixa as versões de modelo que faltarem e monta o checklist (formato enxuto)
async function withChecklists(list: ServiceOrder[]): Promise<ServiceOrder[]> {
  await ensureChecklistVersions(list).catch(() => {});
  return hydrateOrders(list);
}
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
export function compareOrdersNewestFirst(a: ServiceOrder, d: ServiceOrder): number {
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
  if (status === 'Cancelada') {
    return o.closedMonth || localMonthKey();
  }
  return undefined;
}

// Situação da solicitação de corretiva, gravada na OS (permite buscar direto as pendentes, sem varrer as ordens).
// Decisão por item (Etapa 8): "Pendente" enquanto algum item estiver sem decisão; depois "Resolvido" se algum item
// teve corretiva aberta, ou "Cancelado" se todos foram "Não abrir".
function computeSolicitationStatus(o: ServiceOrder): ServiceOrder['solicitationStatus'] {
  const requested = (o.checklist || []).filter(isCorrectiveRequested);
  if (requested.length === 0) return undefined;
  if (requested.some((item) => !item.autoCorrectiveStatus || item.autoCorrectiveStatus === 'Pendente')) return 'Pendente';
  return requested.some((item) => item.autoCorrectiveStatus === 'Resolvido') ? 'Resolvido' : 'Cancelado';
}

// REGRA DE PRAZOS DA OS
// - Período do Super Admin (endDate) venceu sem conclusão  -> "Não Executada" (OS encerrada)
// - Janela do técnico (scheduledEndDate/scheduledDate) venceu -> "Atrasada" (encarregado pode remarcar)
// - OS "Atrasada" remarcada para uma janela futura           -> volta a "Planejada"
// - OS "Não Executada" cujo período do Super Admin foi prorrogado -> reaberta
// "Em Execução" não vira "Atrasada": o técnico já iniciou e pode concluir até o fim do período.
export function computeDeadlineStatus(o: ServiceOrder, todayStr: string = localTodayStr()): ServiceOrder['status'] {
  if (o.status === 'Concluída' || o.status === 'Cancelada') return o.status;

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
export const OPEN_STATUSES: ServiceOrder['status'][] = ['Novo', 'Planejada', 'Em Execução', 'Atrasada'];

// Histórico das vistorias de um endereço (as mais recentes primeiro, até 100)
export async function dbGetAddressVistorias(addressId: string): Promise<ServiceOrder[]> {
  if (!firebaseActive || !dbInstance || !addressId) return [];
  const snap = await getDocs(
    // Vistorias de endereço são da DOM (as regras do banco exigem o filtro de unidade)
    query(collection(dbInstance, 'serviceOrders'), where('unit', '==', 'DOM'), where('addressId', '==', addressId), orderBy('addrEnd', 'desc'), limit(100))
  );
  return withChecklists(snap.docs.map((d) => ({ id: d.id, ...d.data(), signature: null } as ServiceOrder)));
}

// Cancela as OS abertas dos ativos baixados (busca as OS de 30 ativos por vez).
// Só altera status e datas; a OS continua guardada para consulta.
// Operação em massa: roda liberada do disjuntor (src/db/guard.ts)
export function dbCancelOpenOrdersForAssets(...args: Parameters<typeof dbCancelOpenOrdersForAssetsNow>): ReturnType<typeof dbCancelOpenOrdersForAssetsNow> {
  return runBulk(() => dbCancelOpenOrdersForAssetsNow(...args));
}
async function dbCancelOpenOrdersForAssetsNow(assetIds: string[], reason: string, sector = ''): Promise<number> {
  if (!firebaseActive || !dbInstance || assetIds.length === 0) return 0;
  // Unidade da importação (as regras do banco exigem o filtro de unidade para quem não vê todas)
  const unitNames = (await dbGetManagements().catch(() => [])).map((m) => m.name);
  const unit = sector ? resolveOrderUnit(sector, undefined, unitNames) : '';
  const unitFilter = unit ? [where('unit', '==', unit)] : [];
  const now = new Date().toISOString();
  const month = localMonthKey();
  let cancelled = 0;
  for (let i = 0; i < assetIds.length; i += 30) {
    const snap = await getDocs(query(collection(dbInstance, 'serviceOrders'), ...unitFilter, where('assetId', 'in', assetIds.slice(i, i + 30))));
    const open = snap.docs.filter((d) => OPEN_STATUSES.includes(d.data().status));
    for (let j = 0; j < open.length; j += 400) {
      const batch = writeBatch(dbInstance);
      open.slice(j, j + 400).forEach((d) =>
        batch.update(d.ref, {
          status: 'Cancelada', closedMonth: month, cancelReason: reason, cancelledAt: now, updatedAt: now, syncAt: serverTimestamp(),
          ...orderControlUpdate({ ...(d.data() as any), status: 'Cancelada', updatedAt: now })
        })
      );
      await batch.commit();
    }
    cancelled += open.length;
  }
  return cancelled;
}

export interface ServiceOrdersScope {
  units: string[] | null; // unidades (campo "unit" da OS: GMMR, GMEE...); null = todas
  technicianNames?: string[]; // técnico: só as OS atribuídas a ele (variações do nome/matrícula)
  technicianMatricula?: string; // técnico: também as OS gravadas com a matrícula dele (planejamento novo)
}

// Filtros de cada busca: uma busca por unidade (as regras do banco só liberam a unidade do usuário).
// null = uma busca sem filtro de unidade (Super Administrador / todas as unidades).
// Técnico: uma busca pelo nome (OS antigas) e outra pela matrícula (OS novas); o resultado é juntado.
function scopeFilterSets(scope: ServiceOrdersScope): any[][] {
  const bases: any[][] = [];
  if (scope.technicianNames) bases.push([where('assignedTechnician', 'in', scope.technicianNames.slice(0, 5))]);
  if (scope.technicianMatricula) bases.push([where('assignedTechnicianMatricula', '==', scope.technicianMatricula)]);
  if (bases.length === 0) bases.push([]);
  if (!scope.units) return bases;
  return scope.units.flatMap((u) => bases.map((base) => [...base, where('unit', '==', u)]));
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
  const filterSets = scopeFilterSets(scope);
  if (filterSets.length === 0) {
    onChange([]);
    return () => {};
  }
  // Resultado de cada busca (abertas e fechadas de cada unidade); null = ainda não chegou
  const parts: (ServiceOrder[] | null)[] = filterSets.flatMap(() => [null, null]);

  const toList = (snap: { forEach: (cb: (d: any) => void) => void }): ServiceOrder[] => {
    const list: ServiceOrder[] = [];
    snap.forEach((d) => {
      if (!isMockOrLegacyId(d.id)) {
        list.push({ id: d.id, ...d.data() } as ServiceOrder);
      }
    });
    return list;
  };

  // Junta as buscas (a aberta prevalece) e mostra o status recalculado pelos prazos
  const emit = () => {
    if (parts.some((p) => p === null)) return;
    const byId = new Map<string, ServiceOrder>();
    parts.forEach((p, i) => { if (i % 2 === 1) p!.forEach((o) => byId.set(o.id, o)); });
    parts.forEach((p, i) => { if (i % 2 === 0) p!.forEach((o) => byId.set(o.id, o)); });
    const todayStr = localTodayStr();
    const list = Array.from(byId.values())
      .map((o) => {
        const status = computeDeadlineStatus(o, todayStr);
        return status === o.status ? o : { ...o, status };
      })
      .sort(compareOrdersNewestFirst);
    onChange(hydrateOrders(list));
  };
  // Chegou a versão de modelo que faltava: monta o checklist e reenvia
  const stopVersions = onChecklistVersionLoaded(emit);

  const listen = (idx: number, q: any, label: string) =>
    onSnapshot(
      q,
      (snap: any) => {
        parts[idx] = toList(snap);
        emit();
      },
      (err: any) => {
        console.warn(`Firestore listen ${label} service orders failed:`, err);
        checkQuotaException(err);
        parts[idx] = parts[idx] || [];
        emit();
      }
    );

  const unsubscribers = filterSets.flatMap((filters, i) => [
    listen(i * 2, query(ordersRef, ...filters, where('status', 'in', OPEN_STATUSES)), 'open'),
    listen(i * 2 + 1, query(ordersRef, ...filters, where('closedMonth', '==', month)), 'closed')
  ]);

  return () => {
    stopVersions();
    unsubscribers.forEach((u) => u());
  };
}

// SOLICITAÇÕES DE CORRETIVA
// Pendentes: carregadas em tempo real (são poucas; somem da lista assim que recebem uma ação).
// OS do técnico em tempo real: só as abertas atribuídas à matrícula dele (as concluídas saem do app).
// Uma escuta por gerência do técnico.
export function subscribeTechnicianOrders(
  units: string[] | null,
  matricula: string,
  onChange: (orders: ServiceOrder[]) => void
): () => void {
  const mat = (matricula || '').trim();
  if (!firebaseActive || !dbInstance || !mat) {
    onChange([]);
    return () => {};
  }
  // Campo de controle techOpen: só as OS abertas deste técnico (não precisa filtrar a gerência)
  const filterSets = [[where('techOpen', '==', mat)]];
  const parts: (ServiceOrder[] | null)[] = filterSets.map(() => null);
  const emit = () => {
    if (parts.some((p) => p === null)) return;
    const todayStr = localTodayStr();
    const list = (parts.flat() as ServiceOrder[])
      .map((o) => {
        const status = computeDeadlineStatus(o, todayStr);
        return status === o.status ? o : { ...o, status };
      })
      .sort(compareOrdersNewestFirst);
    onChange(hydrateOrders(list));
  };
  const stopVersions = onChecklistVersionLoaded(emit);
  const unsubscribers = filterSets.map((filters, i) =>
    onSnapshot(
      query(collection(dbInstance!, 'serviceOrders'), ...filters),
      (snap) => {
        const list: ServiceOrder[] = [];
        snap.forEach((d) => {
          if (!isMockOrLegacyId(d.id)) list.push({ id: d.id, ...d.data() } as ServiceOrder);
        });
        parts[i] = list;
        emit();
      },
      (err) => {
        console.warn('Firestore listen technician orders failed:', err);
        checkQuotaException(err);
        parts[i] = parts[i] || [];
        emit();
      }
    )
  );
  return () => {
    stopVersions();
    unsubscribers.forEach((u) => u());
  };
}

// Solicitações pendentes do técnico (campo de controle techSol): aba Solicitações do celular
export function subscribeTechnicianSolicitations(matricula: string, onChange: (orders: ServiceOrder[]) => void): () => void {
  const mat = (matricula || '').trim();
  if (!firebaseActive || !dbInstance || !mat) {
    onChange([]);
    return () => {};
  }
  let last: ServiceOrder[] = [];
  const emit = () => onChange(hydrateOrders([...last].sort(compareOrdersNewestFirst)));
  const unsub = onSnapshot(
    query(collection(dbInstance, 'serviceOrders'), where('techSol', '==', mat)),
    (snap) => {
      last = [];
      snap.forEach((d) => {
        if (!isMockOrLegacyId(d.id)) last.push({ id: d.id, ...d.data() } as ServiceOrder);
      });
      emit();
    },
    (err) => {
      console.warn('Firestore listen technician solicitations failed:', err);
      checkQuotaException(err);
      last = [];
      emit();
    }
  );
  const stopVersions = onChecklistVersionLoaded(emit);
  return () => {
    stopVersions();
    unsub();
  };
}

export function subscribePendingSolicitations(
  scope: ServiceOrdersScope,
  onChange: (orders: ServiceOrder[]) => void
): () => void {
  if (!firebaseActive || !dbInstance) {
    onChange([]);
    return () => {};
  }
  const filterSets = scopeFilterSets(scope);
  const parts: ServiceOrder[][] = filterSets.map(() => []);
  const emit = () => onChange(hydrateOrders(parts.flat().sort(compareOrdersNewestFirst)));
  if (filterSets.length === 0) {
    onChange([]);
    return () => {};
  }
  const unsubscribers = filterSets.map((filters, i) =>
    onSnapshot(
      query(collection(dbInstance!, 'serviceOrders'), ...filters, where('solicitationStatus', '==', 'Pendente')),
      (snap) => {
        const list: ServiceOrder[] = [];
        snap.forEach((d) => {
          if (!isMockOrLegacyId(d.id)) list.push({ id: d.id, ...d.data() } as ServiceOrder);
        });
        parts[i] = list;
        emit();
      },
      (err) => {
        console.warn('Firestore listen pending solicitations failed:', err);
        checkQuotaException(err);
        parts[i] = [];
        emit();
      }
    )
  );
  const stopVersions = onChecklistVersionLoaded(emit);
  return () => {
    stopVersions();
    unsubscribers.forEach((u) => u());
  };
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
  // Uma busca por unidade; o "cursor" guarda a posição de cada uma
  const filterSets = scopeFilterSets(scope);
  if (filterSets.length === 0) return { orders: [], cursor: null, hasMore: false };
  const cursors = (after as any[] | undefined) || [];

  try {
    const snaps = await Promise.all(
      filterSets.map((filters, i) =>
        getDocs(
          query(
            collection(dbInstance!, 'serviceOrders'),
            ...filters,
            where('solicitationStatus', 'in', statuses),
            orderBy('solAt', 'desc'),
            ...(cursors[i] ? [startAfter(cursors[i])] : []),
            limit(pageSize)
          )
        )
      )
    );
    // Junta, ordena pelas mais recentes e pega uma página
    const merged = snaps.flatMap((snap, i) => snap.docs.map((d) => ({ i, d })));
    merged.sort((x, y) => String(y.d.data().solAt || '').localeCompare(String(x.d.data().solAt || '')));
    const taken = merged.slice(0, pageSize);
    const nextCursors = filterSets.map((_, i) => {
      const mine = taken.filter((t) => t.i === i);
      return mine.length > 0 ? mine[mine.length - 1].d : cursors[i] || null;
    });
    const orders: ServiceOrder[] = [];
    taken.forEach(({ d }) => {
      if (!isMockOrLegacyId(d.id)) orders.push({ id: d.id, ...d.data() } as ServiceOrder);
    });
    return {
      orders: await withChecklists(orders),
      cursor: nextCursors,
      hasMore: merged.length > pageSize || snaps.some((snap) => snap.docs.length === pageSize)
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
  const filterSets = scopeFilterSets(scope);
  const countOf = async (status: 'Pendente' | 'Resolvido' | 'Cancelado') => {
    const counts = await Promise.all(
      filterSets.map((filters) =>
        getCountFromServer(query(collection(dbInstance!, 'serviceOrders'), ...filters, where('solicitationStatus', '==', status)))
      )
    );
    return counts.reduce((sum, snap) => sum + snap.data().count, 0);
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

// CONSULTA DE OS (qualquer OS: abertas e fechadas)
// Todos os filtros são opcionais e independentes; o banco aplica os que forem escolhidos.
// Mês = mês do período da OS (fim do período, endDate). Sem mês, traz as mais recentes.
// A gerência usa o campo "unit" (nome exato da gerência). Resultado limitado a ORDERS_SEARCH_LIMIT.
export interface OrdersSearchParams {
  month: string;              // "AAAA-MM" ou "" (todos os meses)
  units: string[] | null;     // unidades pesquisadas; null = todas
  status: ServiceOrder['status'] | '';
  craai: string;
  comarca: string;
  technician: string;         // matrícula do técnico ou ""
}

export const ORDERS_SEARCH_LIMIT = 500;

export async function dbSearchOrders(
  params: OrdersSearchParams
): Promise<{ orders: ServiceOrder[]; limited: boolean }> {
  if (!firebaseActive || !dbInstance) return { orders: [], limited: false };
  if (params.units && params.units.length === 0) return { orders: [], limited: false };
  const constraints: any[] = [];
  if (params.units) {
    constraints.push(params.units.length === 1 ? where('unit', '==', params.units[0]) : where('unit', 'in', params.units.slice(0, 30)));
  }
  if (params.status) constraints.push(where('status', '==', params.status));
  if (params.craai) constraints.push(where('craai', '==', params.craai));
  if (params.comarca) constraints.push(where('comarca', '==', params.comarca));
  if (params.technician) constraints.push(where('assignedTechnicianMatricula', '==', params.technician)); // matrícula
  if (params.month) {
    constraints.push(where('endDate', '>=', `${params.month}-01`));
    constraints.push(where('endDate', '<=', `${params.month}-31`));
  }
  constraints.push(orderBy('endDate', 'desc'));
  constraints.push(limit(ORDERS_SEARCH_LIMIT));

  const snap = await getDocs(query(collection(dbInstance, 'serviceOrders'), ...constraints));
  const todayStr = localTodayStr();
  const list: ServiceOrder[] = [];
  snap.forEach((d) => {
    if (isMockOrLegacyId(d.id)) return;
    const o = { id: d.id, ...d.data() } as ServiceOrder;
    const status = computeDeadlineStatus(o, todayStr);
    list.push(status === o.status ? o : { ...o, status });
  });
  return { orders: await withChecklists(list), limited: snap.docs.length >= ORDERS_SEARCH_LIMIT };
}

// Get a single service order by its number (1 leitura). Usado para abrir OS antigas pelo histórico do ativo.
export async function dbGetServiceOrderById(orderId: string): Promise<ServiceOrder | null> {
  if (!orderId) return null;

  if (firebaseActive && dbInstance) {
    try {
      const snap = await getDoc(doc(dbInstance, 'serviceOrders', orderId));
      if (!snap.exists()) return null;
      const order = { id: snap.id, ...snap.data() } as ServiceOrder;
      return (await withChecklists([{ ...order, status: computeDeadlineStatus(order) }]))[0];
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
    // Sem internet: fica na fila do aparelho e sobe sozinha depois
    await awaitWrite(setDoc(doc(dbInstance, 'orderSignatures', orderId), {
      orderId,
      signature,
      savedAt: new Date().toISOString()
    }));
    signatureCache.set(orderId, signature);
    return true;
  } catch (err: any) {
    console.warn('Firestore write order signature failed, keeping it inside the order:', err);
    checkQuotaException(err);
    return false;
  }
}

// Hora do servidor lida do banco volta ao formato do banco (a cópia local guarda como { seconds, nanoseconds })
function asTimestamp(v: any): unknown {
  if (v && typeof v.toMillis === 'function') return v;
  if (v && typeof v.seconds === 'number') return new Timestamp(v.seconds, v.nanoseconds || 0);
  return v;
}

// Save or Update service order
// Retorna "queued" quando a gravação ficou no aparelho (sem internet) e vai subir sozinha depois
// options.skipHistory: OS já concluída (ex.: decisão de solicitação) não regrava o histórico do ativo
export async function dbSaveServiceOrder(
  order: ServiceOrder,
  serverFields: Record<string, unknown> = {},
  options: { skipHistory?: boolean } = {}
): Promise<'saved' | 'queued'> {
  let result: 'saved' | 'queued' = 'saved';
  // Assinatura nova: vai para "orderSignatures" e sai do documento da OS
  let signatureFields: Pick<ServiceOrder, 'signature' | 'hasSignature'> = {
    signature: order.signature,
    hasSignature: order.hasSignature
  };
  if (order.signature && (await saveOrderSignature(order.id, order.signature))) {
    signatureFields = { signature: null, hasSignature: true };
  }

  // Unidade da OS (usada pelas regras do banco): calculada uma vez, se ainda não tiver
  if (!order.unit) {
    const unitNames = (await dbGetManagements().catch(() => [])).map((m) => m.name);
    const unit = resolveOrderUnit(order.sector, order.addressId, unitNames);
    if (unit) order = { ...order, unit };
  }

  // Checklist enxuto ainda sem a versão do modelo baixada: não dá para concluir (as respostas não estão na tela)
  if (order.checklistPending && order.status === 'Concluída') {
    throw new Error('O checklist desta OS ainda está carregando. Aguarde e tente de novo.');
  }

  // Grava sempre o status coerente com os prazos (ex.: remarcar uma OS "Atrasada" volta para "Planejada")
  const status = computeDeadlineStatus(order);
  const orderWithUpdate: ServiceOrder = {
    ...order,
    ...signatureFields,
    status,
    closedMonth: computeClosedMonth(order, status),
    solicitationStatus: order.checklistPending ? order.solicitationStatus : computeSolicitationStatus(order),
    updatedAt: new Date().toISOString()
  };

  // If the status is completed 'Concluída', we must create an entry in the equipment history!
  if (order.status === 'Concluída' && !options.skipHistory) {
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
      // Vistoria de endereço: grava com o mesmo id do QR do imóvel ("addr:...") para aparecer na página pública
      assetId: order.assetId || (order.addressId ? `addr:${order.addressId}` : 'none'),
      addressId: order.addressId,
      osId: order.id,
      osTitle: order.title,
      date: order.signedAt || localDateTimeStr(),
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
      // OS concluída fica como está (o banco só aceita mudar checklist/solicitação nela)
      // syncAt (horário do servidor): é por ele que os outros aparelhos recebem a alteração
      // Campos de controle (índices esparsos): só os que a OS precisa agora
      const stored: Record<string, unknown> = withOrderControl(cleanUndefined(toStoredOrder(status === 'Concluída' ? orderWithUpdate : withoutEmptyTechnician(orderWithUpdate))) as any);
      // Hora do servidor da conclusão: regrava no mesmo formato (senão o banco recusa mexer na OS concluída)
      if (stored.completedAtServer) stored.completedAtServer = asTimestamp(stored.completedAtServer);
      result = await awaitWrite(setDoc(doc(dbInstance, 'serviceOrders', order.id), {
        ...stored,
        ...serverFields,
        syncAt: serverTimestamp()
      }));
    } catch (err: any) {
      console.warn('Firestore write serviceOrder failed, utilizing local fallback state:', err);
      checkQuotaException(err);
    }
  }
  return result;
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
      // Exclui e registra a exclusão (os outros aparelhos tiram a OS da cópia local)
      const batch = writeBatch(dbInstance);
      batch.delete(doc(dbInstance, 'serviceOrders', orderId));
      batch.set(doc(dbInstance, 'orderDeletions', orderId), { orderId, syncAt: serverTimestamp() });
      await batch.commit();
    } catch (err: any) {
      console.warn('Firestore delete service order failed:', err);
      checkQuotaException(err);
      // Avisa a tela (o banco só permite ao Super Administrador excluir OS "Novo")
      throw new Error('Exclusão não permitida: só o Super Administrador exclui, e só OS com status "Novo".');
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
      await awaitWrite(setDoc(doc(dbInstance, 'histories', log.id), cleanUndefined(log)));
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

// Prazos de planejamento em tempo real (poucos documentos: 1 por gerência).
// Lê ao abrir e depois só quando o Super Administrador muda um prazo; a contagem regressiva é calculada na tela.
export function subscribePlanningDeadlines(onChange: (list: PlanningDeadline[]) => void): () => void {
  if (!firebaseActive || !dbInstance) {
    dbGetPlanningDeadlines().then(onChange);
    return () => {};
  }
  const db = dbInstance;
  let unsub: (() => void) | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const start = () => {
    unsub = onSnapshot(
      collection(db, 'planningDeadlines'),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as PlanningDeadline));
        cachePlanningDeadlines = list;
        cachePlanningDeadlinesFromFirebase = true;
        try {
          localStorage.setItem('hexon_planning_deadlines', JSON.stringify(list));
        } catch {
          /* ignora */
        }
        onChange([...list]);
      },
      (err) => {
        console.warn('Escuta dos prazos de planejamento interrompida:', err);
        checkQuotaException(err);
        if (cachePlanningDeadlines) onChange([...cachePlanningDeadlines]);
        // Tenta de novo em 30 s (ex.: login ainda não estava pronto)
        if (!stopped) retry = setTimeout(start, 30000);
      }
    );
  };
  start();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    unsub?.();
  };
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

// CORREÇÃO DAS OS (Super Administrador, antes das novas regras do banco). Só preenche o que falta; nada é apagado:
// 1) unidade (GMMR, GMEE, GMC, DOM...);
// 2) CRAAI e comarca copiadas do ativo (OS antigas, disparadas antes desses campos existirem);
// 3) mês de encerramento (closedMonth) das Concluídas / Não Executadas / Canceladas que não têm;
// 4) histórico das vistorias ligado ao QR do imóvel ("addr:<id>").
export interface UnitBackfillResult {
  total: number;
  updated: number;
  perUnit: Record<string, number>;
  withoutUnit: number;
  unresolvedSectors: Record<string, number>;
  unitsFilled: number;
  locationFilled: number;
  closedMonthFilled: number;
  perStatus: Record<string, number>;
  historiesFixed: number;
}

// Operação em massa: roda liberada do disjuntor (src/db/guard.ts)
export function dbBackfillOrderUnits(...args: Parameters<typeof dbBackfillOrderUnitsNow>): ReturnType<typeof dbBackfillOrderUnitsNow> {
  return runBulk(() => dbBackfillOrderUnitsNow(...args));
}
async function dbBackfillOrderUnitsNow(): Promise<UnitBackfillResult> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const db = dbInstance;
  const unitNames = (await dbGetManagements()).map((m) => m.name).filter((n) => n && n !== 'Todas');
  const assetsById = new Map((await dbGetAssets()).map((a) => [a.id, a]));

  const result: UnitBackfillResult = {
    total: 0, updated: 0, perUnit: {}, withoutUnit: 0, unresolvedSectors: {},
    unitsFilled: 0, locationFilled: 0, closedMonthFilled: 0, perStatus: {}, historiesFixed: 0
  };
  const updates: { id: string; fields: Record<string, string> }[] = [];
  const addressByOrder = new Map<string, string>();
  const monthOf = (v?: string | null) => (v && /^\d{4}-\d{2}/.test(v) ? v.slice(0, 7) : '');

  const snap = await getDocs(collection(db, 'serviceOrders'));
  snap.forEach((d) => {
    const o = d.data() as ServiceOrder;
    result.total++;
    result.perStatus[o.status || '(sem status)'] = (result.perStatus[o.status || '(sem status)'] || 0) + 1;
    if (o.addressId) addressByOrder.set(d.id, o.addressId);
    const fields: Record<string, string> = {};

    const unit = o.unit && unitNames.includes(o.unit) ? o.unit : resolveOrderUnit(o.sector, o.addressId, unitNames);
    if (!unit) {
      result.withoutUnit++;
      const key = o.sector || '(sem setor)';
      result.unresolvedSectors[key] = (result.unresolvedSectors[key] || 0) + 1;
    } else {
      result.perUnit[unit] = (result.perUnit[unit] || 0) + 1;
      if (o.unit !== unit) {
        fields.unit = unit;
        result.unitsFilled++;
      }
    }

    const asset = o.assetId ? assetsById.get(o.assetId) : undefined;
    if (asset) {
      const craai = getAssetCraai(asset);
      const comarca = getAssetComarca(asset);
      if (!o.craai && craai) fields.craai = craai;
      if (!o.comarca && comarca) fields.comarca = comarca;
      if (fields.craai || fields.comarca) result.locationFilled++;
    }

    if (!o.closedMonth) {
      const closed =
        o.status === 'Concluída' ? monthOf(o.signedAt) || monthOf(o.endDate) :
        o.status === 'Não Executada' ? monthOf(o.endDate) :
        o.status === 'Cancelada' ? monthOf(o.cancelledAt) || monthOf(o.endDate) : '';
      if (closed) {
        fields.closedMonth = closed;
        result.closedMonthFilled++;
      }
    }

    if (Object.keys(fields).length > 0) {
      // OS aberta: campos de controle coerentes com a unidade corrigida
      if (OPEN_STATUSES.includes(o.status)) Object.assign(fields, orderControlUpdate({ ...o, ...fields }));
      updates.push({ id: d.id, fields });
    }
  });

  for (let i = 0; i < updates.length; i += 400) {
    const batch = writeBatch(db);
    updates.slice(i, i + 400).forEach((u) => batch.update(doc(db, 'serviceOrders', u.id), { ...u.fields, syncAt: serverTimestamp() }));
    await batch.commit();
  }
  result.updated = updates.length;

  const histUpdates: { id: string; addressId: string }[] = [];
  const hsnap = await getDocs(collection(db, 'histories'));
  hsnap.forEach((d) => {
    const h = d.data() as MaintenanceLog;
    const addressId = addressByOrder.get(h.osId);
    if (addressId && h.assetId !== `addr:${addressId}`) histUpdates.push({ id: d.id, addressId });
  });
  for (let i = 0; i < histUpdates.length; i += 400) {
    const batch = writeBatch(db);
    histUpdates.slice(i, i + 400).forEach((h) =>
      batch.update(doc(db, 'histories', h.id), { assetId: `addr:${h.addressId}`, addressId: h.addressId })
    );
    await batch.commit();
  }
  result.historiesFixed = histUpdates.length;

  cacheServiceOrders = null;
  return result;
}

