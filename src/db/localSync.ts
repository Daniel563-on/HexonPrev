import { runBulk } from './guard';
import { collection, doc, getDocs, orderBy, query, serverTimestamp, setDoc, Timestamp, where } from './guard';
import { idbGet, idbSet } from '../utils/idbCache';
import { firebaseActive, dbInstance, authInstance, checkQuotaException } from './core';

// CÓPIA LOCAL SINCRONIZADA (economia de leituras): materiais, efetivo e usuários da gerência.
// - 1ª vez no aparelho (para cada lista): baixa a lista inteira uma vez e guarda no aparelho (IndexedDB, separado por usuário).
// - Depois: 1 vez por sessão (ou quando a tela pede "atualizar"), busca só o que mudou desde a última vez
//   (campo syncAt = horário do servidor, gravado em toda alteração) e as exclusões/mudanças de gerência
//   registradas em "syncDeletions". Sem mudança, custa só a consulta (cerca de 1 leitura por lista).
// - Sem internet: usa a cópia guardada.
// Toda gravação dessas coleções precisa levar syncAt: serverTimestamp() (e, ao excluir ou trocar de gerência, syncTombstone).

export type SyncedCollection = 'materials' | 'workforce' | 'users';

interface Stored {
  v: 1;
  items: Record<string, any>;
  lastSyncMs: number;
  lastDelMs: number;
}

const mem = new Map<string, Stored>();
const inflight = new Map<string, Promise<Stored | null>>();
const checked = new Set<string>(); // listas já conferidas nesta sessão

const toMs = (v: any): number => (v && typeof v.toMillis === 'function' ? v.toMillis() : 0);

// Usuários: o aparelho guarda só o necessário para montar a equipe (sem e-mail, sessão etc. — LGPD)
const PICK: Partial<Record<SyncedCollection, string[]>> = {
  users: ['matricula', 'name', 'cargo', 'status', 'companies', 'gerencia', 'perfil']
};

function clean(coll: SyncedCollection, data: any): any {
  const keep = PICK[coll];
  if (keep) {
    const c: any = {};
    keep.forEach((k) => {
      if (data[k] !== undefined) c[k] = data[k];
    });
    return c;
  }
  const c = { ...data };
  delete c.syncAt;
  return c;
}

function keyOf(coll: SyncedCollection, filters: [string, string][]): string {
  const uid = authInstance?.currentUser?.uid || 'anon';
  return `hexon_sync_v1|${uid}|${coll}|${filters.map(([f, v]) => `${f}=${v}`).join('&')}`;
}

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

// 1ª carga completa: operação em massa (liberada do disjuntor)
async function fullDownload(coll: SyncedCollection, filters: [string, string][]): Promise<Stored> {
  const db = dbInstance!;
  const snap = await runBulk(() => getDocs(query(collection(db, coll), ...filters.map(([f, v]) => where(f, '==', v)))));
  const items: Record<string, any> = {};
  let maxSync = 0;
  snap.forEach((d) => {
    const data = d.data();
    maxSync = Math.max(maxSync, toMs(data.syncAt));
    items[d.id] = { ...clean(coll, data), id: d.id };
  });
  // Exclusões anteriores à carga já não estão na lista baixada: confere só as posteriores
  return { v: 1, items, lastSyncMs: maxSync, lastDelMs: maxSync };
}

// Só o que mudou (e as exclusões/saídas da gerência) desde a última vez
async function incremental(coll: SyncedCollection, unit: string, filters: [string, string][], s: Stored): Promise<Stored> {
  const db = dbInstance!;
  const [changed, removed] = await Promise.all([
    getDocs(
      query(
        collection(db, coll),
        ...filters.map(([f, v]) => where(f, '==', v)),
        where('syncAt', '>', Timestamp.fromMillis(s.lastSyncMs)),
        orderBy('syncAt')
      )
    ),
    getDocs(
      query(
        collection(db, 'syncDeletions'),
        where('coll', '==', coll),
        where('unit', '==', unit),
        where('syncAt', '>', Timestamp.fromMillis(s.lastDelMs)),
        orderBy('syncAt')
      )
    )
  ]);
  const items = { ...s.items };
  let lastSyncMs = s.lastSyncMs;
  let lastDelMs = s.lastDelMs;
  // Exclusões primeiro: se o mesmo item voltou depois (ex.: voltou para a gerência), a versão nova prevalece
  removed.forEach((d) => {
    const data = d.data();
    lastDelMs = Math.max(lastDelMs, toMs(data.syncAt));
    if (data.docId) delete items[String(data.docId)];
  });
  changed.forEach((d) => {
    const data = d.data();
    lastSyncMs = Math.max(lastSyncMs, toMs(data.syncAt));
    items[d.id] = { ...clean(coll, data), id: d.id };
  });
  return { v: 1, items, lastSyncMs, lastDelMs };
}

/**
 * Lista sincronizada de uma coleção, filtrada por igualdade (ex.: [['unit','DOM'],['company','mprj']]).
 * "unit" = gerência usada nas exclusões (syncDeletions). refresh = confere o que mudou mesmo se já conferiu nesta sessão.
 */
export async function syncedList<T>(coll: SyncedCollection, unit: string, filters: [string, string][], refresh = false): Promise<T[]> {
  if (!firebaseActive || !dbInstance || !unit) return [];
  const key = keyOf(coll, filters);
  const run = async (): Promise<Stored | null> => {
    let s = mem.get(key) || null;
    if (!s) {
      const saved = await idbGet<Stored>(key).catch(() => null);
      if (saved && saved.v === 1 && saved.items) s = saved;
    }
    const needCheck = refresh || !checked.has(key);
    if (offline()) return s;
    try {
      if (!s) s = await fullDownload(coll, filters);
      else if (needCheck) s = await incremental(coll, unit, filters, s);
      checked.add(key);
      mem.set(key, s);
      idbSet(key, s).catch(() => {});
      return s;
    } catch (err: any) {
      console.warn(`Não foi possível sincronizar ${coll}:`, err);
      checkQuotaException(err);
      if (s) mem.set(key, s);
      return s; // segue com a cópia guardada (se houver)
    }
  };
  let p = inflight.get(key);
  if (!p) {
    p = run().finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  const s = await p;
  return s ? (Object.values(s.items) as T[]) : [];
}

// Registro de exclusão (ou saída da gerência) para os aparelhos apagarem a cópia local
export async function syncTombstone(coll: SyncedCollection, unit: string, docId: string): Promise<void> {
  if (!firebaseActive || !dbInstance || !unit || !docId) return;
  const id = `${coll}__${docId}__${Date.now()}`.replace(/[^A-Za-z0-9_-]/g, '_');
  await setDoc(doc(dbInstance, 'syncDeletions', id), { coll, unit, docId, syncAt: serverTimestamp() });
}

// Depois de uma gravação feita neste aparelho: a próxima leitura confere o que mudou
export function markSyncStale(coll: SyncedCollection): void {
  Array.from(checked).forEach((k) => {
    if (k.includes(`|${coll}|`)) checked.delete(k);
  });
}
