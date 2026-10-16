import { WorkOrder } from '../types';

// U4: em todo o sistema a GLPI vem em destaque; o Nº da OS fica em segundo plano.
type OsRefSource = { glpi?: string; number: string };

// Texto curto para títulos, avisos e e-mails: "GLPI 123456 · OS-2026000001" (sem GLPI, só o número)
export function osRefText(o: OsRefSource): string {
  return o.glpi ? `GLPI ${o.glpi} · ${o.number}` : o.number;
}

// Categoria escolhida na emissão (pergunta "Categoria" da etapa Criação do modelo)
export function osCategory(o: Pick<WorkOrder, 'templateFields' | 'answers'>): string {
  const f = (o.templateFields || []).find((x) => x.stage === 'criacao' && /categoria/i.test(x.label || ''));
  const v = f ? o.answers?.[f.id] : undefined;
  if (v === undefined || v === null || v === '') return '';
  return Array.isArray(v) ? v.join(', ') : String(v);
}
