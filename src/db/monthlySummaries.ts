import { doc, getDoc } from 'firebase/firestore';
import { firebaseActive, dbInstance, checkQuotaException } from './core';

// RESUMOS MENSAIS CONGELADOS (gravados pela função monthlyClosing no dia 1º)
// Documento monthlySummaries/{AAAA-MM}__{GERENCIA}; cada linha agrupa OS com o mesmo
// resultado: p = periodicidade, t = técnico, c = CRAAI, m = comarca, r = resultado, n = quantidade.
// Resultado: P = no prazo (dia agendado), A = em atraso (dentro do período), N = não realizada,
//            L = ainda em aberto (só no mês atual, calculado ao vivo).
export interface StatRow {
  month: string;
  sector: string;
  p: string;
  t: string;
  c: string;
  m: string;
  r: 'P' | 'A' | 'N' | 'L';
  n: number;
}

// Mesma regra de nome de documento da função monthlyClosing
export function summarySectorToken(value: string): string {
  return (
    String(value || 'SEM_GERENCIA')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase() || 'SEM_GERENCIA'
  );
}

// Lê os resumos dos meses e gerências informados (1 leitura por mês e gerência)
export async function dbGetMonthlySummaries(months: string[], sectors: string[]): Promise<StatRow[]> {
  if (!firebaseActive || !dbInstance || months.length === 0 || sectors.length === 0) return [];
  const reads: Promise<StatRow[]>[] = [];
  for (const month of months) {
    for (const sector of sectors) {
      reads.push(
        getDoc(doc(dbInstance, 'monthlySummaries', `${month}__${summarySectorToken(sector)}`))
          .then((snap) => {
            if (!snap.exists()) return [];
            const data = snap.data() as { sector?: string; rows?: Omit<StatRow, 'month' | 'sector'>[] };
            return (data.rows || []).map((row) => ({ ...row, month, sector: data.sector || sector }));
          })
          .catch((err) => {
            console.warn('Firestore fetch monthly summary failed:', err);
            checkQuotaException(err);
            return [];
          })
      );
    }
  }
  return (await Promise.all(reads)).flat();
}
