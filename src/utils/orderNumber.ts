// Exibição curta do número da OS.
// O número completo continua sendo o identificador no banco (busca, vínculos e links usam ele);
// esta função só encurta o texto mostrado na tela.
//
//   "AS_GMMR_9693_XHQC-MEN-20260901" -> "GMMR_9693_XHQC · MEN 09/26"
//   "AS_GMMR_9693_XHQC-SEM-20260907" -> "GMMR_9693_XHQC · SEM 07/09"
//   números antigos ("28941") e manuais ("OS-260924-7K2Q9F") são exibidos como estão.
const SHORT_PERIOD_CODES = new Set(['SEM', 'QUI']);

export function formatOrderNumber(id: string | null | undefined): string {
  const value = String(id ?? '');
  const match = /^(.+)-([A-Z]{2,4})-(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (!match) return value;

  const [, key, periodCode, year, month, day] = match;
  const shortKey = key.replace(/^AS_/, '');
  const periodLabel = SHORT_PERIOD_CODES.has(periodCode) ? `${day}/${month}` : `${month}/${year.slice(2)}`;
  return `${shortKey} · ${periodCode} ${periodLabel}`;
}
