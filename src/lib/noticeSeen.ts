// QUADRO DE AVISOS: o que esta pessoa já viu neste aparelho (para o número de "novos"), os urgentes que ela já
// confirmou e os urgentes que já abriram sozinhos no celular. Só no aparelho; sem isso, tudo volta a contar como novo.

type Kind = 'seen' | 'confirmed' | 'shown';
const KEEP = 300;
const key = (matricula: string) => `hexon_notices_${matricula}`;

function load(matricula: string): Record<Kind, string[]> {
  try {
    const v = JSON.parse(localStorage.getItem(key(matricula)) || '{}');
    return {
      seen: v.seen || [],
      confirmed: v.confirmed || [],
      shown: v.shown || []
    };
  } catch {
    return { seen: [], confirmed: [], shown: [] };
  }
}

export function noticeIds(matricula: string, kind: Kind): Set<string> {
  return new Set(load(matricula)[kind]);
}

export function markNotices(matricula: string, kind: Kind, ids: string[]): void {
  if (!matricula || ids.length === 0) return;
  const v = load(matricula);
  const merged = Array.from(new Set([...v[kind], ...ids]));
  v[kind] = merged.slice(-KEEP);
  try {
    localStorage.setItem(key(matricula), JSON.stringify(v));
  } catch {
    /* aparelho sem espaço: só deixa de lembrar */
  }
  window.dispatchEvent(new Event('hexon-notices-seen'));
}
