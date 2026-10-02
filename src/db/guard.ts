import * as fs from 'firebase/firestore';

// DISJUNTOR DO BANCO (proteção contra loops e erros que gastariam leituras/gravações sem parar)
// Os arquivos de src/db importam o Firestore daqui (e não direto de 'firebase/firestore').
// Este módulo repassa tudo igual, mas conta, por aparelho e por minuto:
//   - gravações (cada setDoc/updateDoc/addDoc/deleteDoc ou pacote writeBatch = 1)
//   - buscas (cada getDoc/getDocs = 1)
//   - escutas abertas (cada onSnapshot = 1)
// Se algum passar do limite, o disjuntor desarma: o aparelho para de gravar e buscar,
// aparece o aviso na tela e fica 1 registro na auditoria. Recarregar a página volta ao normal.
// Operações em massa legítimas (disparo, importações, correções) rodam dentro de runBulk() e não contam.

export * from 'firebase/firestore';

type Kind = 'write' | 'read' | 'listen';

const WINDOW_MS = 60 * 1000;
const LIMITS: Record<Kind, number> = { write: 120, read: 120, listen: 40 };
const LABEL: Record<Kind, string> = { write: 'gravações', read: 'buscas', listen: 'escutas abertas' };

export interface GuardTrip {
  kind: Kind;
  label: string;
  count: number;
  at: string;
}

const stamps: Record<Kind, number[]> = { write: [], read: [], listen: [] };
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
function allow(kind: Kind): boolean {
  if (tripped) return false;
  if (bulkDepth > 0) return true;
  const now = Date.now();
  const list = stamps[kind];
  list.push(now);
  while (list.length > 0 && now - list[0] > WINDOW_MS) list.shift();
  if (list.length > LIMITS[kind]) {
    trip(kind, list.length);
    return false;
  }
  return true;
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
  return allow('read') ? fs.getDocs(q) : Promise.reject(new GuardError());
}) as typeof fs.getDocs;

// ===== Escutas =====
// Bloqueada: não abre a escuta (devolve um "parar" vazio para a tela não quebrar)
export const onSnapshot = ((ref: any, ...rest: any[]) => {
  remember(ref);
  return allow('listen') ? (fs.onSnapshot as any)(ref, ...rest) : () => {};
}) as typeof fs.onSnapshot;
