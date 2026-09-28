import { HexonUser, ServiceOrder } from '../../../types';

// Utilitários do planejamento (só dias úteis; datas no formato "AAAA-MM-DD")

export const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export const WEEKDAY_SHORT = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'];

const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const dayBR = (s: string) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '');
export const isWeekend = (s: string) => {
  const d = parseYmd(s).getDay();
  return d === 0 || d === 6;
};

// Semanas do mês, só de segunda a sexta (dias de outros meses entram para completar a semana)
export function monthWeeks(year: number, month: number): string[][] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const start = new Date(first);
  const dow = start.getDay() === 0 ? 7 : start.getDay();
  start.setDate(start.getDate() - (dow - 1)); // segunda-feira da 1ª semana
  const weeks: string[][] = [];
  for (let d = new Date(start); d <= last; d.setDate(d.getDate() + 7)) {
    const week: string[] = [];
    for (let i = 0; i < 5; i++) {
      const day = new Date(d);
      day.setDate(d.getDate() + i);
      week.push(ymd(day));
    }
    if (week.some((w) => parseYmd(w).getMonth() === month)) weeks.push(week);
  }
  return weeks;
}

// Dias úteis entre duas datas (inclusive)
export function weekdaysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = parseYmd(start); ymd(d) <= end; d.setDate(d.getDate() + 1)) {
    const s = ymd(d);
    if (!isWeekend(s)) out.push(s);
    if (out.length > 400) break;
  }
  return out;
}

export const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart <= bEnd && aEnd >= bStart;

// Período agendado da OS (início e fim da execução)
export const scheduledRange = (os: ServiceOrder): [string, string] | null =>
  os.scheduledDate ? [os.scheduledDate.slice(0, 10), (os.scheduledEndDate || os.scheduledDate).slice(0, 10)] : null;

// A OS é deste técnico? (pela matrícula; OS antigas, pelo nome)
export const isOrderOfTechnician = (os: ServiceOrder, u: Pick<HexonUser, 'name' | 'matricula'>) =>
  (!!os.assignedTechnicianMatricula && os.assignedTechnicianMatricula === u.matricula) ||
  (!os.assignedTechnicianMatricula && !!os.assignedTechnician && os.assignedTechnician === u.name);

export const STATUS_STYLE: Record<string, { dot: string; chip: string; label: string }> = {
  Novo: { dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-800 border-sky-200', label: 'Aguardando' },
  Planejada: { dot: 'bg-indigo-500', chip: 'bg-indigo-50 text-indigo-800 border-indigo-200', label: 'Planejadas' },
  'Em Execução': { dot: 'bg-blue-600', chip: 'bg-blue-50 text-blue-800 border-blue-200', label: 'Em execução' },
  Atrasada: { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-800 border-amber-200', label: 'Atrasadas' },
  Concluída: { dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-800 border-emerald-200', label: 'Concluídas' },
  'Não Executada': { dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-800 border-rose-200', label: 'Não executadas' }
};
export const STATUS_ORDER = ['Novo', 'Planejada', 'Em Execução', 'Atrasada', 'Concluída', 'Não Executada'];
