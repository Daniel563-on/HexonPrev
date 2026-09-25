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
import { Asset } from '../types';
import { idbGet, idbSet } from '../utils/idbCache';
import { firebaseActive, dbInstance, authInstance } from './core';
import { isMockOrLegacyId } from './templates';

// CÓPIA LOCAL DOS ATIVOS COM SINCRONIZAÇÃO INCREMENTAL
// - 1ª vez no aparelho: baixa todos os ativos e guarda no IndexedDB (separado por usuário).
// - Depois: escuta só os ativos com syncAt (horário do servidor) maior que a última sincronização,
//   e as exclusões registradas em assetDeletions.
// - Receber é só leitura: nada aqui grava no Firestore (evita o ciclo "recebe -> grava -> recebe").

interface StoredAssets {
  version: 1;
  assets: Asset[];
  lastSyncMs: number;
  lastDeletionMs: number;
}

const store = new Map<string, Asset>();
const subscribers = new Set<(list: Asset[]) => void>();
let lastSyncMs = 0;
let lastDeletionMs = 0;
let activeUid: string | null = null;
let readyPromise: Promise<void> | null = null;
let unsubAssets: Unsubscribe | null = null;
let unsubDeletions: Unsubscribe | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let hiddenAt = 0;
let visibilityHooked = false;

const storageKey = (uid: string) => `hexon_assets_sync_v1_${uid}`;

function toMs(v: any): number {
  return v && typeof v.toMillis === 'function' ? v.toMillis() : 0;
}

function toAsset(id: string, data: any): Asset {
  const clean = { ...data };
  delete clean.qrCode;
  delete clean.syncAt;
  return { id, ...clean } as Asset;
}

function currentList(): Asset[] {
  return Array.from(store.values());
}

function schedulePersist(): void {
  if (!activeUid) return;
  const uid = activeUid;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const data: StoredAssets = { version: 1, assets: currentList(), lastSyncMs, lastDeletionMs };
    idbSet(storageKey(uid), data).catch(() => {});
  }, 1000);
}

function notify(): void {
  const list = currentList();
  subscribers.forEach((cb) => cb(list));
  schedulePersist();
}

// Baixa a coleção inteira (1ª vez no aparelho ou "Sincronizar tudo")
async function fullDownload(): Promise<void> {
  const snap = await getDocs(collection(dbInstance!, 'assets'));
  store.clear();
  let maxSync = 0;
  snap.forEach((d) => {
    if (isMockOrLegacyId(d.id)) return;
    const data = d.data();
    maxSync = Math.max(maxSync, toMs(data.syncAt));
    store.set(d.id, toAsset(d.id, data));
  });
  lastSyncMs = maxSync;

  // Só a exclusão mais recente (1 leitura): as anteriores já não estão na coleção baixada
  const lastDel = await getDocs(query(collection(dbInstance!, 'assetDeletions'), orderBy('syncAt', 'desc'), limit(1)));
  lastDeletionMs = lastDel.empty ? 0 : toMs(lastDel.docs[0].data().syncAt);
}

function stopListeners(): void {
  unsubAssets?.();
  unsubDeletions?.();
  unsubAssets = null;
  unsubDeletions = null;
}

// Escuta só o que mudou depois da última sincronização. Resolve na 1ª resposta do servidor.
function startListeners(): Promise<void> {
  stopListeners();
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

    unsubAssets = onSnapshot(
      query(collection(db, 'assets'), where('syncAt', '>', Timestamp.fromMillis(lastSyncMs)), orderBy('syncAt')),
      (snap) => {
        let changed = false;
        snap.docChanges().forEach((ch) => {
          if (ch.type === 'removed' || isMockOrLegacyId(ch.doc.id)) return;
          const data = ch.doc.data();
          lastSyncMs = Math.max(lastSyncMs, toMs(data.syncAt));
          store.set(ch.doc.id, toAsset(ch.doc.id, data));
          changed = true;
        });
        if (changed) notify();
        done();
      },
      (err) => {
        console.warn('Escuta de ativos interrompida:', err);
        done();
      }
    );

    unsubDeletions = onSnapshot(
      query(collection(db, 'assetDeletions'), where('syncAt', '>', Timestamp.fromMillis(lastDeletionMs)), orderBy('syncAt')),
      (snap) => {
        let changed = false;
        snap.docChanges().forEach((ch) => {
          if (ch.type === 'removed') return;
          const data = ch.doc.data();
          lastDeletionMs = Math.max(lastDeletionMs, toMs(data.syncAt));
          if (store.delete(String(data.assetId || ch.doc.id))) changed = true;
        });
        if (changed) notify();
        else schedulePersist();
      },
      (err) => console.warn('Escuta de exclusões de ativos interrompida:', err)
    );
  });
}

// Aba escondida por muito tempo: reinicia a escuta a partir da última sincronização
// (evita reler tudo o que mudou desde a abertura quando a conexão é refeita)
function hookVisibility(): void {
  if (visibilityHooked || typeof document === 'undefined') return;
  visibilityHooked = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
    } else if (hiddenAt && Date.now() - hiddenAt > 25 * 60 * 1000 && activeUid && unsubAssets) {
      hiddenAt = 0;
      startListeners();
    }
  });
}

export function canUseAssetSync(): boolean {
  const user = authInstance?.currentUser;
  return !!(firebaseActive && dbInstance && user && !user.isAnonymous);
}

// Inicia (uma vez por usuário) e aguarda a cópia local estar pronta
export function ensureAssetSync(): Promise<void> {
  if (!canUseAssetSync()) return Promise.reject(new Error('Sincronização de ativos indisponível'));
  const uid = authInstance!.currentUser!.uid as string;
  if (activeUid === uid && readyPromise) return readyPromise;

  stopAssetSync();
  activeUid = uid;
  hookVisibility();
  readyPromise = (async () => {
    const saved = await idbGet<StoredAssets>(storageKey(uid));
    if (saved && saved.version === 1 && Array.isArray(saved.assets)) {
      store.clear();
      saved.assets.forEach((a) => store.set(a.id, a));
      lastSyncMs = saved.lastSyncMs || 0;
      lastDeletionMs = saved.lastDeletionMs || 0;
    } else {
      await fullDownload();
    }
    if (activeUid !== uid) return;
    await startListeners();
    notify();
  })();
  readyPromise.catch((err) => {
    console.warn('Falha ao preparar a cópia local dos ativos:', err);
    if (activeUid === uid) {
      activeUid = null;
      readyPromise = null;
    }
  });
  return readyPromise;
}

export function stopAssetSync(): void {
  stopListeners();
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
  store.clear();
  activeUid = null;
  readyPromise = null;
  lastSyncMs = 0;
  lastDeletionMs = 0;
}

// Recuperação manual: baixa tudo de novo e reinicia a escuta
export async function forceFullAssetResync(): Promise<void> {
  await ensureAssetSync();
  await fullDownload();
  await startListeners();
  notify();
}

export function getLocalAssets(): Asset[] {
  return currentList();
}

export function getLocalAsset(id: string): Asset | undefined {
  return store.get(id);
}

// Atualização imediata na tela de quem gravou (a escuta confirma depois, sem duplicar)
export function upsertLocalAssets(assets: Asset[]): void {
  if (!activeUid) return;
  assets.forEach((a) => store.set(a.id, toAsset(a.id, a)));
  notify();
}

export function removeLocalAssets(ids: string[]): void {
  if (!activeUid) return;
  let changed = false;
  ids.forEach((id) => {
    if (store.delete(id)) changed = true;
  });
  if (changed) notify();
}

// Telas que mostram a lista e querem receber as mudanças em tempo real
export function subscribeLocalAssets(cb: (list: Asset[]) => void): () => void {
  subscribers.add(cb);
  ensureAssetSync()
    .then(() => {
      if (subscribers.has(cb)) cb(currentList());
    })
    .catch(() => cb([]));
  return () => {
    subscribers.delete(cb);
  };
}

