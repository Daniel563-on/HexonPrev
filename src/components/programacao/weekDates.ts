import { parseYmd, ymd } from '../orders/planning/planningUtils';

// PROGRAMAÇÃO › SEMANA (Fase 7B): datas da semana (segunda a domingo, "AAAA-MM-DD")

export const DAY_LABEL = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
export const DAY_LONG = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];

export function mondayOf(d: Date): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = x.getDay() === 0 ? 7 : x.getDay();
  x.setDate(x.getDate() - (dow - 1));
  return ymd(x);
}

export function addDays(day: string, n: number): string {
  const d = parseYmd(day);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export const weekDays = (monday: string) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));

// Número da semana no ano (ISO: a semana é do ano da sua quinta-feira)
export function isoWeek(monday: string): number {
  const thu = parseYmd(addDays(monday, 3));
  const jan4 = new Date(thu.getFullYear(), 0, 4);
  return 1 + Math.round(((thu.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
}

export const brFull = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
