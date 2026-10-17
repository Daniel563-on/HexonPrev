// Exibição curta do número da OS.
// O número completo continua sendo o identificador no banco (busca, vínculos e links usam ele);
// esta função só encurta o texto mostrado na tela.
//
//   "AS_GMMR_9693_XHQC-MEN-20260901" -> "GMMR_9693_XHQC · MEN 09/26"
//   "AS_GMMR_9693_XHQC-SEM-20260907" -> "GMMR_9693_XHQC · SEM 07/09"
//   números antigos ("28941") e manuais ("OS-260924-7K2Q9F") são exibidos como estão.
const SHORT_PERIOD_CODES = new Set(['SEM', 'QUI', 'DIA']);

export function formatOrderNumber(id: string | null | undefined): string {
  const value = String(id ?? '');
  const match = /^(.+)-([A-Z]{2,4})-(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (!match) return value;

  const [, key, periodCode, year, month, day] = match;
  const shortKey = key.replace(/^AS_/, '');
  const periodLabel = SHORT_PERIOD_CODES.has(periodCode) ? `${day}/${month}` : `${month}/${year.slice(2)}`;
  return `${shortKey} · ${periodCode} ${periodLabel}`;
}

// U12: rótulo da preventiva na escolha da OS dos pedidos de material e de insumos (celular): a periodicidade,
// o patrimônio e o período, sem o nome do equipamento. Vistoria de endereço (sem patrimônio) mostra o local.
//   "Preventiva Mensal · Patrimônio 004512 · 10/26"   |   "Vistoria Mensal · Fórum de Maricá · 10/26"
export function preventiveRequestLabel(o: { id: string; periodicity?: string; assetCode?: string; isSurvey?: boolean; title?: string }): string {
  const period = (formatOrderNumber(o.id).split(' · ')[1] || '').replace(/^[A-Z]{2,4} /, '');
  const kind = o.isSurvey || !o.assetCode || o.assetCode === 'PE-VISTORIA' ? 'Vistoria' : 'Preventiva';
  const what = kind === 'Vistoria' ? (o.title || '').split(' - ').slice(1).join(' - ') : `Patrimônio ${o.assetCode}`;
  return [`${kind}${o.periodicity ? ` ${o.periodicity}` : ''}`, what, period].filter(Boolean).join(' · ');
}
