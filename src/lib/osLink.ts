import { WorkOrder } from '../types';
import { osValidationLink } from '../db/firebase';
import { osRefText } from './osRef';

// LINK DE VALIDAÇÃO DO CLIENTE (U16): e-mail pronto e quanto falta para vencer (ficha da OS e cartão "Link enviado")

export const osValidationMailto = (o: WorkOrder): string => {
  if (!o.validationToken) return '';
  const link = osValidationLink(o.validationToken);
  return `mailto:?subject=${encodeURIComponent(`Validação do atendimento — ${osRefText(o)}`)}&body=${encodeURIComponent(
    `Olá,\n\nPor favor, confira o atendimento ${o.glpi ? `do chamado GLPI ${o.glpi} (${o.number})` : `da ${o.number}`} e valide ou conteste pelo link:\n${link}\n\nObrigado.`
  )}`;
};

const DAY = 86400000;
export const dateTimeBR = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

// Por dia do calendário: "faltam 5 dias" / "vence amanhã" / "vence hoje" (amarelo) / "venceu hoje" / "vencido há 2 dias" (vermelho)
const dayNum = (t: number) => {
  const d = new Date(t);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
};
export function linkDue(o: WorkOrder, now = Date.now()): { text: string; tone: 'ok' | 'soon' | 'late' } | null {
  const exp = o.linkExp ? Date.parse(o.linkExp) : NaN;
  if (!Number.isFinite(exp)) return null;
  if (exp < now) {
    const d = dayNum(now) - dayNum(exp);
    return { text: d < 1 ? 'venceu hoje' : `vencido há ${d} dia${d > 1 ? 's' : ''}`, tone: 'late' };
  }
  const d = dayNum(exp) - dayNum(now);
  if (d < 1) return { text: 'vence hoje', tone: 'soon' };
  if (d === 1) return { text: 'vence amanhã', tone: 'soon' };
  return { text: `faltam ${d} dias`, tone: 'ok' };
}
