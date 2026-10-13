import { PlanningLot, ServiceOrder } from '../../types';
import { isWeekend, scheduledRange } from '../orders/planning/planningUtils';

// PROGRAMAÇÃO › SEMANA (Fase 7C-1): o que aparece em cada linha da grade e em que faixa (blocos que se cruzam
// no mesmo dia ficam um embaixo do outro).

export const localKey = (o: Pick<ServiceOrder, 'comarca' | 'addressText'>) => `${o.comarca || ''}|${o.addressText || ''}`;
export const splitKey = (k: string) => {
  const i = k.indexOf('|');
  return { comarca: k.slice(0, i) || 'Sem comarca', address: k.slice(i + 1) };
};
export const localLabel = (l: { comarca: string; address: string }) => `${l.comarca || 'Sem comarca'}${l.address ? ` · ${l.address}` : ''}`;

// A preventiva está programada neste dia? (fim de semana só se o período começa ou termina nele — regra do PMOC)
export const coversDay = (o: ServiceOrder, day: string) => {
  const r = scheduledRange(o);
  return !!r && r[0] <= day && r[1] >= day && (!isWeekend(day) || r[0] === day || r[1] === day);
};

// Cabe no prazo do Super Admin? (vale até o último dia do prazo, inclusive)
export const fitsWindow = (o: ServiceOrder, s: string, e: string) => (!o.startDate || o.startDate.slice(0, 10) <= s) && (!o.endDate || o.endDate.slice(0, 10) >= e);

export type GridItem =
  | { kind: 'block'; id: string; from: number; to: number; lot: PlanningLot; orders: ServiceOrder[]; mine: boolean }
  | { kind: 'loose'; id: string; from: number; to: number; orders: ServiceOrder[]; comarca: string; address: string }
  | { kind: 'visit'; id: string; from: number; to: number; lot: PlanningLot; of: string };
export type Placed = GridItem & { lane: number };

// Dias seguidos: [[0,1],[3,3]]
export function runs(indices: number[]): [number, number][] {
  const out: [number, number][] = [];
  [...indices].sort((a, b) => a - b).forEach((i) => {
    const last = out[out.length - 1];
    if (last && last[1] === i - 1) last[1] = i;
    else out.push([i, i]);
  });
  return out;
}

// Bloco da Programação: os dias do bloco (fim de semana incluído, se escolhido). Lote do PMOC: os dias das preventivas.
export function blockItems(lot: PlanningLot, orders: ServiceOrder[], days: string[]): GridItem[] {
  if (lot.source === 'programacao') {
    const from = days.findIndex((d) => d >= lot.periodStart);
    const to = days.length - 1 - [...days].reverse().findIndex((d) => d <= lot.periodEnd);
    if (from < 0 || to < from) return [];
    return [{ kind: 'block', id: lot.id, from, to, lot, orders, mine: true }];
  }
  const idx = days.map((d, i) => (orders.length ? orders.some((o) => coversDay(o, d)) : d >= lot.periodStart && d <= lot.periodEnd && !isWeekend(d)) ? i : -1).filter((i) => i >= 0);
  return runs(idx).map(([from, to]) => ({ kind: 'block' as const, id: `${lot.id}_${from}`, from, to, lot, orders, mine: false }));
}

// Preventivas programadas sem bloco carregado (pela lista, remarcadas...): por local e dias seguidos
export function looseItems(orders: ServiceOrder[], days: string[]): GridItem[] {
  const m = new Map<string, ServiceOrder[]>();
  orders.forEach((o) => m.set(localKey(o), [...(m.get(localKey(o)) || []), o]));
  const out: GridItem[] = [];
  m.forEach((list, k) => {
    const { comarca, address } = splitKey(k);
    const idx = days.map((d, i) => (list.some((o) => coversDay(o, d)) ? i : -1)).filter((i) => i >= 0);
    runs(idx).forEach(([from, to]) => {
      const inRun = list.filter((o) => days.slice(from, to + 1).some((d) => coversDay(o, d)));
      out.push({ kind: 'loose', id: `${k}_${from}`, from, to, orders: inRun, comarca, address });
    });
  });
  return out;
}

// Faixas: cada item na primeira faixa livre nos seus dias
export function placeLanes(items: GridItem[]): { placed: Placed[]; lanes: number } {
  const sorted = [...items].sort((a, b) => a.from - b.from || b.to - b.from - (a.to - a.from));
  const ends: number[] = [];
  const placed = sorted.map((it) => {
    let lane = ends.findIndex((end) => end < it.from);
    if (lane < 0) {
      lane = ends.length;
      ends.push(it.to);
    } else ends[lane] = it.to;
    return { ...it, lane };
  });
  return { placed, lanes: Math.max(1, ends.length) };
}
