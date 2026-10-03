import * as fs from 'firebase/firestore';

// DISJUNTOR DO BANCO (proteção contra loops e erros que gastariam leituras/gravações sem parar)
// Os arquivos de src/db importam o Firestore daqui (e não direto de 'firebase/firestore').
// Este módulo repassa tudo igual, mas conta, por aparelho e por minuto:
//   - gravações (cada setDoc/updateDoc/addDoc/deleteDoc ou pacote writeBatch = 1)
//   - buscas (cada getDoc/getDocs = 1)
//   - escutas abertas (cada onSnapshot = 1)
//   - documentos lidos do servidor (soma do que cada busca devolve + a 1ª carga de cada escuta)
// Se algum passar do limite, o disjuntor desarma: o aparelho para de gravar e buscar,
// aparece o aviso na tela e fica 1 registro na auditoria. Recarregar a página volta ao normal.
// Operações em massa legítimas (disparo, importações, correções) rodam dentro de runBulk() e não contam.

export * from 'firebase/firestore';

type Kind = 'write' | 'read' | 'listen' | 'docs';

const WINDOW_MS = 60 * 1000;
const LIMITS: Record<Kind, number> = { write: 120, read: 120, listen: 40, docs: 30000 };
const LABEL: Record<Kind, string> = { write: 'gravações', read: 'buscas', listen: 'escutas abertas', docs: 'documentos lidos' };

export interface GuardTrip {
  kind: Kind;
  label: string;
  count: number;
  at: string;
}

// Cada registro: [horário, quantidade]
const stamps: Record<Kind, [number, number][]> = { write: [], read: [], listen: [], docs: [] };
let tripped: GuardTrip | null = null;
let bulkDepth = 0;
let lastDb: fs.Firestore | null = null;
const tripListeners = new Set<(t: GuardTrip) => void>();

export function guardTripped(): GuardTrip | null {
  return tripped;
}

export function onGuardTrip(cb: (t: GuardTrip) => void): () => void {
  tripListeners.add(cb);
  if (tripped) cb(tripped);
  return () => {
    tripListeners.delete(cb);
  };
}

// Operação em massa legítima: não conta para o disjuntor enquanto roda
export async function runBulk<T>(fn: () => Promise<T>): Promise<T> {
  bulkDepth++;
  try {
    return await fn();
  } finally {
    bulkDepth--;
  }
}

export class GuardError extends Error {
  constructor() {
    super('Proteção do sistema ativada: uso anormal do banco detectado. Recarregue a página.');
    this.name = 'GuardError';
  }
}

function remember(target: any): void {
  const db = target?.firestore;
  if (db && !lastDb) lastDb = db;
}

function trip(kind: Kind, count: number): void {
  tripped = { kind, label: LABEL[kind], count, at: new Date().toISOString() };
  console.error(`[Proteção] Disjuntor desarmado: ${count} ${LABEL[kind]} em 1 minuto.`);
  tripListeners.forEach((cb) => {
    try {
      cb(tripped!);
    } catch {
      /* ignora */
    }
  });
  // 1 registro na auditoria (gravação direta, fora do contador)
  if (lastDb) {
    let user: any = null;
    try {
      user = JSON.parse(localStorage.getItem('hexon_cached_user') || 'null');
    } catch {
      /* ignora */
    }
    const id = `aud_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    fs.setDoc(fs.doc(lastDb, 'auditLogs', id), {
      id,
      userId: user?.id || '',
      userName: user?.name || '',
      userMatricula: user?.matricula || '',
      action: 'Proteção do sistema',
      target: 'disjuntor',
      details: `Uso anormal: ${count} ${LABEL[kind]} em 1 minuto neste aparelho. Gravações e buscas foram bloqueadas até recarregar a página.`,
      timestamp: tripped.at
    }).catch(() => {});
  }
}

// true = pode seguir; false = bloqueado
function allow(kind: Kind, amount = 1): boolean {
  if (tripped) return false;
  if (bulkDepth > 0) return true;
  const now = Date.now();
  const list = stamps[kind];
  list.push([now, amount]);
  while (list.length > 0 && now - list[0][0] > WINDOW_MS) list.shift();
  const total = list.reduce((sum, [, n]) => sum + n, 0);
  if (total > LIMITS[kind]) {
    trip(kind, total);
    return false;
  }
  return true;
}

// Documentos que vieram do servidor (os da cópia do aparelho não são cobrados e não contam)
function countDocs(snap: any): void {
  if (!snap || snap.metadata?.fromCache || typeof snap.size !== 'number' || snap.size === 0) return;
  allow('docs', snap.size);
}

// Escuta: conta só a 1ª carga vinda do servidor (as mudanças seguintes são dados novos de verdade)
function countFirstLoad(handler: (snap: any) => unknown): (snap: any) => unknown {
  let counted = false;
  return (snap: any) => {
    if (!counted && snap?.metadata && !snap.metadata.fromCache) {
      counted = true;
      countDocs(snap);
    }
    return handler(snap);
  };
}

// ===== Gravações =====
export const setDoc = ((ref: any, ...rest: any[]) => {
  remember(ref);
  return allow('write') ? (fs.setDoc as any)(ref, ...rest) : Promise.reject(new GuardError());
}) as typeof fs.setDoc;

export const updateDoc = ((ref: any, ...rest: any[]) => {
  remember(ref);
  return allow('write') ? (fs.updateDoc as any)(ref, ...rest) : Promise.reject(new GuardError());
}) as typeof fs.updateDoc;

export const addDoc = ((ref: any, ...rest: any[]) => {
  remember(ref);
  return allow('write') ? (fs.addDoc as any)(ref, ...rest) : Promise.reject(new GuardError());
}) as typeof fs.addDoc;

export const deleteDoc = ((ref: any) => {
  remember(ref);
  return allow('write') ? fs.deleteDoc(ref) : Promise.reject(new GuardError());
}) as typeof fs.deleteDoc;

// Pacote de gravações: conta 1 no commit
export const writeBatch = ((db: fs.Firestore) => {
  if (!lastDb) lastDb = db;
  const batch = fs.writeBatch(db);
  const commit = batch.commit.bind(batch);
  batch.commit = () => (allow('write') ? commit() : Promise.reject(new GuardError()));
  return batch;
}) as typeof fs.writeBatch;

// ===== Buscas =====
export const getDoc = ((ref: any) => {
  remember(ref);
  return allow('read') ? fs.getDoc(ref) : Promise.reject(new GuardError());
}) as typeof fs.getDoc;

export const getDocs = ((q: any) => {
  remember(q);
  if (!allow('read')) return Promise.reject(new GuardError());
  return fs.getDocs(q).then((snap) => {
    countDocs(snap);
    return snap;
  });
}) as typeof fs.getDocs;

// ===== Escutas =====
// Bloqueada: não abre a escuta (devolve um "parar" vazio para a tela não quebrar)
export const onSnapshot = ((ref: any, ...rest: any[]) => {
  remember(ref);
  if (!allow('listen')) return () => {};
  const args = [...rest];
  const i = args.findIndex((a) => typeof a === 'function' || (a && typeof a.next === 'function'));
  if (i >= 0) {
    const h = args[i];
    args[i] = typeof h === 'function' ? countFirstLoad(h) : { ...h, next: countFirstLoad(h.next.bind(h)) };
  }
  return (fs.onSnapshot as any)(ref, ...args);
}) as typeof fs.onSnapshot;
