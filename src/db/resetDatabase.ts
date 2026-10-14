import { getApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { doc, onSnapshot } from './guard';
import { dbInstance, firebaseActive } from './core';

// ZERAR O BANCO (ajuste A2; Configurações › Sistema, só Super Administrador).
// Quem apaga é o servidor (Cloud Function "resetDatabase"): as regras protegem o histórico, o servidor não passa
// pelo disjuntor e só ele apaga os logins. A tela conta antes, pede "ZERAR" e acompanha o andamento em appControl/reset.

export type ResetMode = 'movimento' | 'implantacao';

export interface ResetGroupCount {
  key: string;
  label: string;
  count: number;
  keepAdmins?: string[]; // usuários: Super Administradores que ficam
  logins?: number;       // usuários: logins que saem
}
export interface ResetCount {
  groups: ResetGroupCount[];
  total: number;
}
export interface ResetProgress {
  running?: boolean;
  ok?: boolean | null;
  mode?: ResetMode;
  modeLabel?: string;
  by?: string;
  startedAt?: string;
  finishedAt?: string;
  total?: number;
  done?: number;
  step?: string;
  error?: string;
  result?: Record<string, number>;
}

// Até 1 hora (bancos grandes); o andamento chega pela escuta
const callReset = (data: Record<string, unknown>) =>
  httpsCallable(getFunctions(getApp(), 'us-central1'), 'resetDatabase', { timeout: 60 * 60 * 1000 })(data);

const errText = (e: any): string => {
  const code = String(e?.code || '');
  if (code.includes('not-found') || code.includes('unimplemented')) return 'A função "resetDatabase" ainda não foi publicada no servidor.';
  return e?.message || String(e);
};

export async function dbResetCount(mode: ResetMode): Promise<ResetCount> {
  if (!firebaseActive) throw new Error('Banco desligado.');
  try {
    return (await callReset({ action: 'count', mode })).data as ResetCount;
  } catch (e) {
    throw new Error(errText(e));
  }
}

export async function dbResetRun(mode: ResetMode, confirm: string): Promise<{ total: number }> {
  if (!firebaseActive) throw new Error('Banco desligado.');
  try {
    return (await callReset({ action: 'run', mode, confirm })).data as { total: number };
  } catch (e) {
    throw new Error(errText(e));
  }
}

// Andamento e último resultado (1 registro; quem gravou foi o servidor)
export function subscribeResetProgress(cb: (p: ResetProgress | null) => void): () => void {
  if (!firebaseActive || !dbInstance) {
    cb(null);
    return () => {};
  }
  return onSnapshot(
    doc(dbInstance, 'appControl', 'reset'),
    (snap) => cb(snap.exists() ? (snap.data() as ResetProgress) : null),
    () => cb(null)
  );
}
