import { runBulk } from './guard';
import { collection, doc, getDocs, onSnapshot, orderBy, query, serverTimestamp, setDoc, Timestamp, where } from './guard';
import { onAuthStateChanged } from 'firebase/auth';
import { idbGet, idbSet } from '../utils/idbCache';
import { firebaseActive, dbInstance, authInstance, checkQuotaException } from './core';
import { nowMs, recordLoad } from '../utils/loadTimes';

// CÓPIA LOCAL EM TEMPO REAL (economia de leituras): materiais, efetivo, usuários da gerência, modelos de preventiva e endereços.
// - 1ª vez no aparelho (para cada lista): baixa a lista inteira uma vez e guarda no aparelho (IndexedDB, separado por usuário).
// - Depois: a tela usa a cópia guardada e o app abre uma ESCUTA no banco que traz só o que mudou desde a última vez
//   (campo syncAt = horário do servidor, gravado em toda alteração) e as exclusões/mudanças de gerência ("syncDeletions").
//   A escuta fica aberta enquanto o app estiver aberto: cada cadastro, alteração ou exclusão chega na hora, é gravado
//   no aparelho e as telas abertas se atualizam (onSyncChange). Sem mudança no banco, a escuta parada não lê nada.
// - Sem internet: usa a cópia guardada (a escuta continua e recebe as mudanças quando a internet volta).
// Toda gravação dessas coleções precisa levar syncAt: serverTimestamp() (e, ao excluir ou trocar de gerência, syncTombstone).

export type SyncedCollection = 'materials' | 'workforce' | 'users' | 'templates' | 'addresses';

// Coleções que nunca são excluídas (só inativadas): não precisam conferir o registro de exclusões
const NO_DELETIONS: SyncedCollection[] = ['addresses'];

interface Stored {
  v: 1;
  items: Record<string, any>;
  lastSyncMs: number;
  lastDelMs: number;
  stamps?: Record<string, number>; // syncAt de cada item (uma exclusão mais antiga que o item não o apaga)
}

interface Live {
  stop: () => void;
  ready: Promise<void>;
  dead: boolean;
}

const mem = new Map<string, Stored>();
const inflight = new Map<string, Promise<Stored | null>>();
const checked = new Set<string>(); // listas já conferidas nesta sessão (só quando a escuta não está aberta)
const live = new Map<string, Live>(); // escutas abertas
const retryAt = new Map<string, number>(); // escuta que falhou: espera 1 minuto antes de tentar de novo
const errors = new Map<string, { code: string; message: string }>();
const changeSubs = new Map<SyncedCollection, Set<() => void>>();
const notifyTimers = new Map<SyncedCollection, ReturnType<typeof setTimeout>>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

const toMs = (v: any): number => (v && typeof v.toMillis === 'function' ? v.toMillis() : 0);

// Usuários: o aparelho guarda só o necessário para montar a equipe (sem e-mail, sessão etc. — LGPD)
const PICK: Partial<Record<SyncedCollection, string[]>> = {
  users: ['matricula', 'name', 'cargo', 'status', 'companies', 'gerencia', 'perfil']
};

const NAMES: Record<SyncedCollection, string> = {
  materials: 'Materiais',
  workforce: 'Efetivo',
  users: 'Usuários da gerência',
  templates: 'Modelos de preventiva',
  addresses: 'Endereços'
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

const labelOf = (coll: SyncedCollection, filters: [string, string][]) =>
  filters.length ? `${NAMES[coll]} (${filters.map(([, v]) => v).join(' · ')})` : NAMES[coll];

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Troca de usuário (sair/entrar): fecha as escutas e esquece as listas da memória
let currentUid: string | null | undefined;
if (authInstance) {
  onAuthStateChanged(authInstance, (u) => {
    const uid = u?.uid || null;
    if (currentUid !== undefined && uid !== currentUid) {
      live.forEach((l) => l.stop());
      live.clear();
      mem.clear();
      checked.clear();
      retryAt.clear();
      errors.clear();
    }
    currentUid = uid;
  });
}

// Telas abertas: avisadas quando uma lista muda (a nova lista vem da memória, sem ler o banco)
export function onSyncChange(coll: SyncedCollection, cb: () => void): () => void {
  let set = changeSubs.get(coll);
  if (!set) changeSubs.set(coll, (set = new Set()));
  set.add(cb);
  return () => {
    set!.delete(cb);
  };
}

function notify(coll: SyncedCollection): void {
  if (notifyTimers.has(coll)) return;
  notifyTimers.set(
    coll,
    setTimeout(() => {
      notifyTimers.delete(coll);
      changeSubs.get(coll)?.forEach((cb) => {
        try {
          cb();
        } catch {
          /* ignora */
        }
      });
    }, 250)
  );
}

function saveSoon(key: string): void {
  if (saveTimers.has(key)) return;
  saveTimers.set(
    key,
    setTimeout(() => {
      saveTimers.delete(key);
      const s = mem.get(key);
      if (s) idbSet(key, s).catch(() => {});
    }, 500)
  );
}

// Situação da lista (para a tela explicar quando vem vazia)
export function syncStatus(coll: SyncedCollection, filters: [string, string][]): { total: number; live: boolean; error?: string; code?: string } | null {
  const key = keyOf(coll, filters);
  const s = mem.get(key);
  const err = errors.get(key);
  if (!s && !err) return null;
  const l = live.get(key);
  return { total: s ? Object.keys(s.items).length : 0, live: !!l && !l.dead, error: err?.message, code: err?.code };
}

// 1ª carga completa: operação em massa (liberada do disjuntor)
async function fullDownload(coll: SyncedCollection, filters: [string, string][]): Promise<Stored> {
  const db = dbInstance!;
  const snap = await runBulk(() => getDocs(query(collection(db, coll), ...filters.map(([f, v]) => where(f, '==', v)))));
  const items: Record<string, any> = {};
  const stamps: Record<string, number> = {};
  let maxSync = 0;
  snap.forEach((d) => {
    const data = d.data();
    const ms = toMs(data.syncAt);
    maxSync = Math.max(maxSync, ms);
    items[d.id] = { ...clean(coll, data), id: d.id };
    stamps[d.id] = ms;
  });
  // Exclusões anteriores à carga já não estão na lista baixada: confere só as posteriores
  return { v: 1, items, lastSyncMs: maxSync, lastDelMs: maxSync, stamps };
}

// Mudanças recebidas (da escuta ou de uma busca): grava na memória e no aparelho e avisa as telas
function applyChanges(coll: SyncedCollection, key: string, docs: { id: string; data: any; removed?: boolean }[], dels: { docId: string; ms: number }[]): void {
  const cur = mem.get(key);
  if (!cur) return;
  const items = { ...cur.items };
  const stamps = { ...(cur.stamps || {}) };
  let { lastSyncMs, lastDelMs } = cur;
  let changed = false;
  dels.forEach(({ docId, ms }) => {
    lastDelMs = Math.max(lastDelMs, ms);
    // Item gravado depois da exclusão (ex.: voltou para a gerência) continua
    if (items[docId] && (stamps[docId] || 0) <= ms) {
      delete items[docId];
      delete stamps[docId];
      changed = true;
    }
  });
  docs.forEach(({ id, data, removed }) => {
    if (removed) {
      // Saiu da lista (excluído ou mudou de gerência/empresa)
      if (items[id]) {
        delete items[id];
        delete stamps[id];
        changed = true;
      }
      return;
    }
    const ms = toMs(data.syncAt);
    lastSyncMs = Math.max(lastSyncMs, ms);
    if (ms) stamps[id] = ms;
    items[id] = { ...clean(coll, data), id };
    changed = true;
  });
  if (!changed && lastSyncMs === cur.lastSyncMs && lastDelMs === cur.lastDelMs) return;
  mem.set(key, { v: 1, items, lastSyncMs, lastDelMs, stamps });
  saveSoon(key);
  if (changed) notify(coll);
}

// Escuta em tempo real: o que mudou desde a última vez e, daí em diante, cada mudança na hora
function startLive(coll: SyncedCollection, unit: string, filters: [string, string][], key: string): Live {
  const db = dbInstance!;
  const base = mem.get(key)!;
  const noDel = NO_DELETIONS.includes(coll);
  let gotChanges = false;
  let gotDels = noDel;
  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((r) => (resolveReady = r));
  const unsubs: (() => void)[] = [];
  const entry: Live = { stop: () => unsubs.forEach((u) => u()), ready, dead: false };
  const fail = (err: any) => {
    if (entry.dead) return;
    console.warn(`Não foi possível acompanhar ${coll} em tempo real:`, err);
    entry.dead = true;
    entry.stop();
    retryAt.set(key, Date.now() + 60000);
    errors.set(key, { code: String(err?.code || ''), message: String(err?.message || err) });
    checkQuotaException(err);
    resolveReady();
  };
  const settle = () => {
    if (gotChanges && gotDels) {
      errors.delete(key);
      resolveReady();
    }
  };
  // Escutas abertas uma vez por lista na sessão: fora do contador do disjuntor
  runBulk(async () => {
    unsubs.push(
      onSnapshot(
        query(
          collection(db, coll),
          ...filters.map(([f, v]) => where(f, '==', v)),
          where('syncAt', '>', Timestamp.fromMillis(base.lastSyncMs)),
          orderBy('syncAt')
        ),
        // includeMetadataChanges: avisa também quando o banco só confirma que nada mudou (senão a 1ª espera iria até o limite)
        { includeMetadataChanges: true },
        (snap) => {
          applyChanges(
            coll,
            key,
            snap.docChanges().map((ch) => ({ id: ch.doc.id, data: ch.doc.data(), removed: ch.type === 'removed' })),
            []
          );
          if (!snap.metadata.fromCache) {
            gotChanges = true;
            settle();
          }
        },
        fail
      )
    );
    if (!noDel)
      unsubs.push(
        onSnapshot(
          query(
            collection(db, 'syncDeletions'),
            where('coll', '==', coll),
            where('unit', '==', unit),
            where('syncAt', '>', Timestamp.fromMillis(base.lastDelMs)),
            orderBy('syncAt')
          ),
          { includeMetadataChanges: true },
          (snap) => {
            const dels: { docId: string; ms: number }[] = [];
            snap.docChanges().forEach((ch) => {
              if (ch.type === 'removed') return;
              const data = ch.doc.data();
              if (data.docId) dels.push({ docId: String(data.docId), ms: toMs(data.syncAt) });
            });
            applyChanges(coll, key, [], dels);
            if (!snap.metadata.fromCache) {
              gotDels = true;
              settle();
            }
          },
          fail
        )
      );
  }).catch(fail);
  return entry;
}

// Busca única do que mudou (quando a escuta não pode ficar aberta, ou a tela pede "atualizar agora")
async function incremental(coll: SyncedCollection, unit: string, filters: [string, string][], key: string): Promise<void> {
  const db = dbInstance!;
  const s = mem.get(key)!;
  const noDel = NO_DELETIONS.includes(coll);
  const [changed, removed] = await Promise.all([
    getDocs(
      query(
        collection(db, coll),
        ...filters.map(([f, v]) => where(f, '==', v)),
        where('syncAt', '>', Timestamp.fromMillis(s.lastSyncMs)),
        orderBy('syncAt')
      )
    ),
    noDel
      ? Promise.resolve(null)
      : getDocs(
          query(
            collection(db, 'syncDeletions'),
            where('coll', '==', coll),
            where('unit', '==', unit),
            where('syncAt', '>', Timestamp.fromMillis(s.lastDelMs)),
            orderBy('syncAt')
          )
        )
  ]);
  const dels: { docId: string; ms: number }[] = [];
  removed?.forEach((d) => {
    const data = d.data();
    if (data.docId) dels.push({ docId: String(data.docId), ms: toMs(data.syncAt) });
  });
  applyChanges(
    coll,
    key,
    changed.docs.map((d) => ({ id: d.id, data: d.data() })),
    dels
  );
}

async function load(coll: SyncedCollection, unit: string, filters: [string, string][], key: string, refresh: boolean): Promise<Stored | null> {
  const t0 = nowMs();
  let s = mem.get(key) || null;
  let l = live.get(key);
  if (l && l.dead) {
    live.delete(key);
    l = undefined;
  }
  // Escuta aberta: a memória já está em dia. "Atualizar agora" (depois de uma gravação neste aparelho) busca o que mudou.
  if (s && l) {
    if (refresh && !offline()) await incremental(coll, unit, filters, key).catch(() => {});
    return mem.get(key) || s;
  }
  let mode = 'memória';
  if (!s) {
    const saved = await idbGet<Stored>(key).catch(() => null);
    if (saved && saved.v === 1 && saved.items) {
      s = saved;
      mode = 'cópia do aparelho';
    }
  }
  try {
    if (!s) {
      if (offline()) return null;
      s = await fullDownload(coll, filters);
      mode = 'baixou a lista (1ª vez)';
      mem.set(key, s);
      idbSet(key, s).catch(() => {});
    } else mem.set(key, s);
    if (Date.now() >= (retryAt.get(key) || 0)) {
      const entry = startLive(coll, unit, filters, key);
      live.set(key, entry);
      // Espera a 1ª resposta do banco (só o que mudou) por até 8 s; depois as mudanças chegam sozinhas
      if (!offline()) await Promise.race([entry.ready, sleep(8000)]);
      mode += entry.dead ? ' · sem tempo real' : ' · tempo real';
    } else if ((refresh || !checked.has(key)) && !offline()) {
      await incremental(coll, unit, filters, key);
      checked.add(key);
      errors.delete(key);
      mode += ' · conferiu mudanças';
    }
    const total = Object.keys((mem.get(key) || s).items).length;
    const err = errors.get(key);
    recordLoad(labelOf(coll, filters), nowMs() - t0, `${mode} · ${total} ${total === 1 ? 'item' : 'itens'}`, err?.message);
    return mem.get(key) || s;
  } catch (err: any) {
    console.warn(`Não foi possível sincronizar ${coll}:`, err);
    checkQuotaException(err);
    errors.set(key, { code: String(err?.code || ''), message: String(err?.message || err) });
    recordLoad(labelOf(coll, filters), nowMs() - t0, mode, String(err?.message || err));
    if (s) mem.set(key, s);
    return s; // segue com a cópia guardada (se houver)
  }
}

/**
 * Lista sincronizada de uma coleção, filtrada por igualdade (ex.: [['unit','DOM'],['company','mprj']]).
 * "unit" = gerência usada nas exclusões (syncDeletions); '*' = lista sem gerência (modelos, endereços: baixa todos).
 * refresh = busca o que mudou agora (ex.: logo depois de gravar neste aparelho).
 */
export async function syncedList<T>(coll: SyncedCollection, unit: string, filters: [string, string][], refresh = false): Promise<T[]> {
  if (!firebaseActive || !dbInstance || !unit) return [];
  const key = keyOf(coll, filters);
  let p = inflight.get(key);
  if (!p) {
    p = load(coll, unit, filters, key, refresh).finally(() => inflight.delete(key));
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
// (com a escuta aberta a mudança já chega sozinha; isto vale para quando ela não pôde abrir)
export function markSyncStale(coll: SyncedCollection): void {
  Array.from(checked).forEach((k) => {
    if (k.includes(`|${coll}|`)) checked.delete(k);
  });
}
