import { doc, onSnapshot, setDoc, waitForPendingWrites } from 'firebase/firestore';
import { firebaseActive, dbInstance, checkQuotaException } from './core';

// CONTROLE DO SISTEMA (Super Administrador): forçar atualização e modo manutenção.
// Um registro só ("appControl/status") que todos os aparelhos abertos escutam: 1 leitura ao abrir o app
// e 1 por aparelho a cada vez que o Super Administrador aperta um botão.
// A conferência automática de versão NÃO usa o banco: baixa o arquivo "version.json" do próprio site.

declare const __APP_VERSION__: string;
export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

export interface AppControl {
  forceReloadAt?: number;       // "Forçar atualização": aparelhos abertos antes disso recarregam
  maintenance?: boolean;        // "Modo manutenção": só o Super Administrador usa o sistema
  maintenanceMessage?: string;
  updatedAt?: string;
  updatedBy?: string;
}

// Uma escuta só para o app inteiro (a faixa de atualização e a tela de manutenção usam a mesma)
let current: AppControl | null = null;
let unsub: (() => void) | null = null;
const listeners = new Set<(c: AppControl | null) => void>();
// "Forçar atualização" vigente quando este aparelho abriu (lido do servidor). Só um valor DIFERENTE deste,
// que chegue depois, pede para recarregar — não depende do relógio de cada aparelho.
let baselineForceAt: number | null | undefined = undefined;

function startListening(): void {
  if (unsub || !firebaseActive || !dbInstance) return;
  unsub = onSnapshot(
    doc(dbInstance, 'appControl', 'status'),
    { includeMetadataChanges: true },
    (snap) => {
      const data = snap.exists() ? (snap.data() as AppControl) : {};
      // A primeira resposta do servidor (não a cópia do aparelho) define o ponto de partida
      if (baselineForceAt === undefined) {
        if (snap.metadata.fromCache) return;
        baselineForceAt = data.forceReloadAt ?? null;
      }
      current = data;
      listeners.forEach((l) => l(current));
    },
    (err) => {
      // Ex.: sem permissão (regras ainda não publicadas) — tenta de novo em 30 s
      console.warn('Escuta do controle do sistema interrompida:', err);
      checkQuotaException(err);
      unsub = null;
      setTimeout(() => listeners.size > 0 && startListening(), 30000);
    }
  );
}

export function subscribeAppControl(cb: (c: AppControl | null) => void): () => void {
  listeners.add(cb);
  cb(current);
  startListening();
  return () => {
    listeners.delete(cb);
  };
}

// Pedido de atualização novo (apertado depois que este aparelho abriu), ou null
export function newForceReloadAt(c: AppControl | null): number | null {
  const at = c?.forceReloadAt;
  if (!at || baselineForceAt === undefined || at === baselineForceAt || forceReloadHandled(at)) return null;
  return at;
}

// Aviso "Sistema atualizado" depois da recarga
const JUST_UPDATED_KEY = 'hexon_just_updated';
export function takeJustUpdated(): boolean {
  try {
    const v = sessionStorage.getItem(JUST_UPDATED_KEY) === '1';
    sessionStorage.removeItem(JUST_UPDATED_KEY);
    return v;
  } catch {
    return false;
  }
}

const HANDLED_KEY = 'hexon_force_reload_handled';
export function forceReloadHandled(at: number): boolean {
  try {
    return localStorage.getItem(HANDLED_KEY) === String(at);
  } catch {
    return false;
  }
}
function markForceReloadHandled(at: number): void {
  try {
    localStorage.setItem(HANDLED_KEY, String(at));
  } catch {
    /* ignora */
  }
}

// "Forçar atualização": todos os aparelhos abertos recarregam (o aparelho de quem apertou não)
export async function dbForceReloadAll(by: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const at = Date.now();
  markForceReloadHandled(at);
  await setDoc(doc(dbInstance, 'appControl', 'status'), { forceReloadAt: at, updatedAt: new Date().toISOString(), updatedBy: by }, { merge: true });
}

// Liga/desliga o modo manutenção
export async function dbSetMaintenance(on: boolean, message: string, by: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  await setDoc(
    doc(dbInstance, 'appControl', 'status'),
    { maintenance: on, maintenanceMessage: message.trim(), updatedAt: new Date().toISOString(), updatedBy: by },
    { merge: true }
  );
}

// Espera as gravações feitas sem internet subirem (antes de recarregar ou sair, para não perder nada)
export async function waitPendingWrites(): Promise<void> {
  if (!firebaseActive || !dbInstance) return;
  try {
    await waitForPendingWrites(dbInstance);
  } catch {
    /* sem fila: segue */
  }
}

// Recarrega o app com segurança (o rascunho da OS em execução fica salvo no aparelho)
export async function reloadSafely(forceAt?: number): Promise<void> {
  if (forceAt) markForceReloadHandled(forceAt);
  await waitPendingWrites();
  try {
    sessionStorage.setItem(JUST_UPDATED_KEY, '1');
  } catch {
    /* ignora */
  }
  window.location.reload();
}

// Versão publicada no site (arquivo pequeno gerado no build; não usa o banco). null = não deu para saber.
export async function fetchDeployedVersion(): Promise<string | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.version === 'string' ? data.version : null;
  } catch {
    return null;
  }
}
