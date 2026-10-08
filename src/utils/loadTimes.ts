// TEMPO DE CARREGAMENTO (diagnóstico): quanto cada carga demorou neste aparelho, nesta sessão.
// Fica só na memória (some ao recarregar); aparece em Meu Perfil do celular do técnico.

export interface LoadTime {
  label: string;
  ms: number;
  at: number;
  detail?: string;
  error?: string;
}

const times = new Map<string, LoadTime>();
const subs = new Set<() => void>();

export function recordLoad(label: string, ms: number, detail?: string, error?: string): void {
  times.set(label, { label, ms: Math.max(0, Math.round(ms)), at: Date.now(), detail, error });
  subs.forEach((cb) => {
    try {
      cb();
    } catch {
      /* ignora */
    }
  });
}

export function getLoadTimes(): LoadTime[] {
  return Array.from(times.values()).sort((a, b) => b.at - a.at);
}

export function onLoadTimes(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

export const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
