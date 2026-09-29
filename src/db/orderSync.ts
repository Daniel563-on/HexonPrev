import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  Unsubscribe,
  where
} from 'firebase/firestore';
import { ServiceOrder } from '../types';
import { idbGet, idbSet } from '../utils/idbCache';
import { firebaseActive, dbInstance, authInstance, checkQuotaException } from './core';
import { isMockOrLegacyId } from './templates';
import { hydrateOrders, onChecklistVersionLoaded } from './checklistVersions';
import { OrderStart, subscribeUnitStarts } from './orderStarts';
import { compareOrdersNewestFirst, computeDeadlineStatus, localMonthKey, localTodayStr, OPEN_STATUSES } from './serviceOrders';

// CÓPIA LOCAL DAS OS (tela de gestão) COM SINCRONIZAÇÃO INCREMENTAL — uma cópia por gerência
// - 1ª vez no aparelho: baixa as OS abertas + as fechadas do mês atual e do anterior da gerência
//   e guarda no IndexedDB (separado por usuário e por gerência).
// - Depois: escuta só as OS com syncAt (horário do servidor) maior que a última sincronização,
//   e as exclusões registradas em orderDeletions.
// - Fechadas de meses mais antigos: buscadas sob demanda (não ficam guardadas).
// - Receber é só leitura: nada aqui grava no Firestore.

interface StoredOrders {
  version: 1;
  orders: ServiceOrder[];
  lastSyncMs: number;
}

interface UnitSync {
  unit: string;
  store: Map<string, ServiceOrder>;
  lastSyncMs: number;
  ready: Promise<void>;
  unsub: Unsubscribe | null;
  persistTimer: ReturnType<typeof setTimeout> | null;
  starts: Map<string, OrderStart>;       // OS em execução agora (registro à parte, Etapa 6.1)
  unsubStarts: Unsubscribe | null;
}

const OPEN = new Set<string>(OPEN_STATUSES);
const units = new Map<string, UnitSync>();
const subscribers = new Set<() => void>();
const olderMonths = new Map<string, Promise<ServiceOrder[]>>(); // "unidade|AAAA-MM" -> fechadas daquele mês
let activeUid: string | null = null;
let lastDeletionMs = 0;
let unsubDeletions: Unsubscribe | null = null;
let hiddenAt = 0;
let visibilityHooked = false;

const storageKey = (uid: string, unit: string) => `hexon_orders_sync_v1_${uid}_${unit}`;
const deletionKey = (uid: string) => `hexon_orders_deletions_v1_${uid}`;
const toMs = (v: any): number => (v && typeof v.toMillis === 'function' ? v.toMillis() : 0);
const prevMonthKey = () => {
  const d = new Date();
  return localMonthKey(new Date(d.getFullYear(), d.getMonth() - 1, 1));
};

function toOrder(id: string, data: any): ServiceOrder {
  const clean = { ...data };
  delete clean.syncAt;
  return { ...clean, id } as ServiceOrder;
}

// Fechada de mês anterior ao passado: sai da cópia local (consulta sob demanda)
function isStale(o: ServiceOrder, oldestKept: string): boolean {
  return !OPEN.has(o.status) && (o.closedMonth || '') < oldestKept;
}

function notifyAll(): void {
  subscribers.forEach((cb) => cb());
}

function schedulePersist(u: UnitSync): void {
  if (!activeUid) return;
  const uid = activeUid;
  if (u.persistTimer) clearTimeout(u.persistTimer);
  u.persistTimer = setTimeout(() => {
    const oldestKept = prevMonthKey();
    const orders = Array.from(u.store.values()).filter((o) => !isStale(o, oldestKept));
    const data: StoredOrders = { version: 1, orders, lastSyncMs: u.lastSyncMs };
    idbSet(storageKey(uid, u.unit), data).catch(() => {});
  }, 1000);
}

// 1ª vez no aparelho: abertas + fechadas do mês atual e do anterior
async function fullDownload(u: UnitSync): Promise<void> {
  const db = dbInstance!;
  const ref = collection(db, 'serviceOrders');
  const [openSnap, closedSnap] = await Promise.all([
    getDocs(query(ref, where('unit', '==', u.unit), where('status', 'in', OPEN_STATUSES))),
    getDocs(query(ref, where('unit', '==', u.unit), where('closedMonth', 'in', [localMonthKey(), prevMonthKey()])))
  ]);
  u.store.clear();
  let maxSync = 0;
  [openSnap, closedSnap].forEach((snap) =>
    snap.forEach((d) => {
      if (isMockOrLegacyId(d.id)) return;
      const data = d.data();
      maxSync = Math.max(maxSync, toMs(data.syncAt));
      u.store.set(d.id, toOrder(d.id, data));
    })
  );
  u.lastSyncMs = maxSync;
}

// Escuta só o que mudou depois da última sincronização. Resolve na 1ª resposta do servidor.
function startUnitListener(u: UnitSync): Promise<void> {
  u.unsub?.();
  const db = dbInstance!;
  return new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };
    setTimeout(done, 10000); // sem conexão: segue com a cópia local
    u.unsub = onSnapshot(
      query(
        collection(db, 'serviceOrders'),
        where('unit', '==', u.unit),
        where('syncAt', '>', Timestamp.fromMillis(u.lastSyncMs)),
        orderBy('syncAt')
      ),
      (snap) => {
        let changed = false;
        snap.docChanges().forEach((ch) => {
          if (ch.type === 'removed' || isMockOrLegacyId(ch.doc.id)) return;
          const data = ch.doc.data();
          u.lastSyncMs = Math.max(u.lastSyncMs, toMs(data.syncAt));
          u.store.set(ch.doc.id, toOrder(ch.doc.id, data));
          changed = true;
        });
        if (changed) {
          schedulePersist(u);
          notifyAll();
        }
        done();
      },
      (err) => {
        console.warn(`Escuta de OS (${u.unit}) interrompida:`, err);
        checkQuotaException(err);
        done();
      }
    );
  });
}

// Exclusões (poucas): tira a OS de qualquer cópia local
async function startDeletionListener(uid: string): Promise<void> {
  if (unsubDeletions) return;
  const db = dbInstance!;
  const saved = await idbGet<number>(deletionKey(uid));
  if (typeof saved === 'number') {
    lastDeletionMs = saved;
  } else {
    // 1ª vez no aparelho: só a exclusão mais recente (1 leitura); as anteriores já não estão nas OS baixadas
    try {
      const last = await getDocs(query(collection(db, 'orderDeletions'), orderBy('syncAt', 'desc'), limit(1)));
      lastDeletionMs = last.empty ? 0 : toMs(last.docs[0].data().syncAt);
    } catch {
      lastDeletionMs = 0;
    }
  }
  if (activeUid !== uid) return;
  unsubDeletions = onSnapshot(
    query(collection(db, 'orderDeletions'), where('syncAt', '>', Timestamp.fromMillis(lastDeletionMs)), orderBy('syncAt')),
    (snap) => {
      let changed = false;
      snap.docChanges().forEach((ch) => {
        if (ch.type === 'removed') return;
        const data = ch.doc.data();
        lastDeletionMs = Math.max(lastDeletionMs, toMs(data.syncAt));
        const id = String(data.orderId || ch.doc.id);
        units.forEach((u) => {
          if (u.store.delete(id)) {
            changed = true;
            schedulePersist(u);
          }
        });
      });
      idbSet(deletionKey(uid), lastDeletionMs).catch(() => {});
      if (changed) notifyAll();
    },
    (err) => console.warn('Escuta de exclusões de OS interrompida:', err)
  );
}

// Aba escondida por muito tempo: reinicia as escutas a partir da última sincronização
// (evita reler tudo o que mudou desde a abertura quando a conexão é refeita)
function hookVisibility(): void {
  if (visibilityHooked || typeof document === 'undefined') return;
  visibilityHooked = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
    } else if (hiddenAt && Date.now() - hiddenAt > 25 * 60 * 1000 && activeUid) {
      hiddenAt = 0;
      units.forEach((u) => {
        if (u.unsub) startUnitListener(u);
      });
    }
  });
}

function stopUnit(u: UnitSync): void {
  u.unsub?.();
  u.unsub = null;
  u.unsubStarts?.();
  u.unsubStarts = null;
  if (u.persistTimer) clearTimeout(u.persistTimer);
  u.persistTimer = null;
}

export function stopOrderSync(): void {
  units.forEach(stopUnit);
  units.clear();
  olderMonths.clear();
  unsubDeletions?.();
  unsubDeletions = null;
  activeUid = null;
  lastDeletionMs = 0;
}

export function canUseOrderSync(): boolean {
  const user = authInstance?.currentUser;
  return !!(firebaseActive && dbInstance && user && !user.isAnonymous);
}

// Prepara (uma vez por gerência) a cópia local e a escuta
function ensureUnit(uid: string, unit: string): UnitSync {
  const existing = units.get(unit);
  if (existing) {
    if (!existing.unsub) existing.ready = existing.ready.then(() => startUnitListener(existing));
    return existing;
  }
  const u: UnitSync = {
    unit, store: new Map(), lastSyncMs: 0, ready: Promise.resolve(), unsub: null, persistTimer: null, starts: new Map(), unsubStarts: null
  };
  units.set(unit, u);
  u.ready = (async () => {
    const saved = await idbGet<StoredOrders>(storageKey(uid, unit));
    if (saved && saved.version === 1 && Array.isArray(saved.orders)) {
      const oldestKept = prevMonthKey();
      saved.orders.forEach((o) => {
        if (!isStale(o, oldestKept)) u.store.set(o.id, o);
      });
      u.lastSyncMs = saved.lastSyncMs || 0;
    } else {
      await fullDownload(u);
      schedulePersist(u);
    }
    if (activeUid !== uid || units.get(unit) !== u) return;
    await startUnitListener(u);
  })();
  u.ready.catch((err) => {
    console.warn(`Falha ao preparar a cópia local das OS (${unit}):`, err);
    checkQuotaException(err);
    if (units.get(unit) === u) units.delete(unit);
  });
  return u;
}

// Fechadas de um mês fora da cópia local (mais antigo que o mês passado): busca uma vez por sessão
function olderMonthOrders(unit: string, month: string): Promise<ServiceOrder[]> {
  const key = `${unit}|${month}`;
  let p = olderMonths.get(key);
  if (!p) {
    p = getDocs(query(collection(dbInstance!, 'serviceOrders'), where('unit', '==', unit), where('closedMonth', '==', month)))
      .then((snap) => snap.docs.filter((d) => !isMockOrLegacyId(d.id)).map((d) => toOrder(d.id, d.data())))
      .catch((err) => {
        console.warn('Falha ao buscar as OS fechadas do mês:', err);
        checkQuotaException(err);
        olderMonths.delete(key);
        return [];
      });
    olderMonths.set(key, p);
  }
  return p;
}

// Lista para a tela de gestão: abertas das gerências + fechadas do mês visto (status recalculado pelos prazos).
// Mesmo resultado que a escuta antiga, lendo do banco só o que mudou.
export function subscribeUnitOrders(unitList: string[], month: string, onChange: (orders: ServiceOrder[]) => void): () => void {
  if (!canUseOrderSync() || unitList.length === 0) {
    onChange([]);
    return () => {};
  }
  const uid = authInstance!.currentUser!.uid as string;
  if (activeUid !== uid) {
    stopOrderSync();
    activeUid = uid;
  }
  hookVisibility();
  startDeletionListener(uid).catch(() => {});

  const wanted = new Set(unitList);
  // Gerência que ninguém está mais olhando (ex.: Super Admin trocou de gerência): para de escutar
  units.forEach((u) => {
    if (!wanted.has(u.unit)) stopUnit(u);
  });
  const syncs = unitList.map((unit) => ensureUnit(uid, unit));
  // OS em execução agora (poucos registros por gerência, em tempo real)
  syncs.forEach((u) => {
    if (!u.unsubStarts) {
      u.unsubStarts = subscribeUnitStarts(u.unit, (starts) => {
        u.starts = starts;
        notifyAll();
      });
    }
  });
  const inLocalCopy = month >= prevMonthKey();
  let older: ServiceOrder[] = [];
  let active = true;

  const emit = () => {
    if (!active) return;
    const byId = new Map<string, ServiceOrder>();
    older.forEach((o) => byId.set(o.id, o));
    syncs.forEach((u) =>
      u.store.forEach((o) => {
        if (OPEN.has(o.status) || o.closedMonth === month) byId.set(o.id, o);
      })
    );
    const todayStr = localTodayStr();
    const startOf = (id: string) => {
      for (const u of syncs) {
        const s = u.starts.get(id);
        if (s) return s;
      }
      return undefined;
    };
    const list = Array.from(byId.values())
      .map((o) => {
        const status = computeDeadlineStatus(o, todayStr);
        const s = startOf(o.id);
        // Iniciada agora e ainda aberta: aparece "Em Execução" (a OS em si não é regravada ao iniciar)
        if (s && status !== 'Concluída' && status !== 'Não Executada' && status !== 'Cancelada') {
          return { ...o, status: 'Em Execução' as const, inExecution: { matricula: s.matricula, name: s.name, deviceStartedAt: s.deviceStartedAt } };
        }
        return status === o.status ? o : { ...o, status };
      })
      .sort(compareOrdersNewestFirst);
    onChange(hydrateOrders(list)); // checklist enxuto montado a partir da versão do modelo
  };

  subscribers.add(emit);
  const stopVersions = onChecklistVersionLoaded(emit);
  Promise.all(syncs.map((u) => u.ready.catch(() => {})))
    .then(async () => {
      if (!inLocalCopy) {
        const parts = await Promise.all(unitList.map((unit) => olderMonthOrders(unit, month)));
        older = parts.flat();
      }
      emit();
    })
    .catch(() => emit());

  return () => {
    active = false;
    subscribers.delete(emit);
    stopVersions();
  };
}
