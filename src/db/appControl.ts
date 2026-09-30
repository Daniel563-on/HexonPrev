import { doc, onSnapshot, setDoc, waitForPendingWrites } from 'firebase/firestore';
import { firebaseActive, dbInstance, checkQuotaException } from './core';

// CONTROLE DO SISTEMA (Super Administrador): forçar atualização e modo manutenção.
// Um registro só ("appControl/status") que todos os aparelhos abertos escutam: 1 leitura ao abrir o app
// e 1 por aparelho a cada vez que o Super Administrador aperta um botão.
// A conferência automática de versão NÃO usa o banco: baixa o arquivo "version.json" do próprio site.

declare const __APP_VERSION__: string;
export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
export const PAGE_LOADED_AT = Date.now();

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

export function subscribeAppControl(cb: (c: AppControl | null) => void): () => void {
  listeners.add(cb);
  cb(current);
  if (!unsub && firebaseActive && dbInstance) {
    unsub = onSnapshot(
      doc(dbInstance, 'appControl', 'status'),
      (snap) => {
        current = snap.exists() ? (snap.data() as AppControl) : {};
        listeners.forEach((l) => l(current));
      },
      (err) => {
        console.warn('Escuta do controle do sistema interrompida:', err);
        checkQuotaException(err);
      }
    );
  }
  return () => {
    listeners.delete(cb);
  };
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
