import * as XLSX from 'xlsx';
import { WorkOrder } from '../types';
import { OS_SIGN_LABEL, WorkOrderCost, brl, fmtMinutes, osAnswerText, osFieldVisible, osMembers, osSignOrder } from '../db/firebase';

// FICHA DA OS EM PLANILHA (Fase 5C): uma aba com as seções da OS.
// Valores em R$ só quando "cost" vem preenchido (quem tem "Visualizar Valores").

const day = (s?: string) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '');
const dateTime = (s?: string) => (s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');

export function exportOsXlsx(o: WorkOrder, cost: WorkOrderCost | null): void {
  const rows: (string | number)[][] = [];
  const blank = () => rows.push([]);
  const title = (t: string) => {
    blank();
    rows.push([t.toUpperCase()]);
  };
  const kv = (k: string, v: string | number | undefined | null) => rows.push([k, v === undefined || v === null || v === '' ? '—' : v]);

  rows.push([`FICHA DA ORDEM DE SERVIÇO ${o.number}`]);
  rows.push([`Gerada em ${new Date().toLocaleString('pt-BR')}`]);

  title('1. Dados gerais');
  kv('Nº da OS', o.number);
  kv('Modelo', `${o.templateName} (v${o.templateVersion})`);
  kv('Gerência', o.unit);
  kv('Situação', o.status);
  kv('Intervenção', o.intervencao);
  kv('GLPI', o.glpi);
  kv('Aberta em', dateTime(o.createdAt));
  kv('Aberta por', `${o.createdByName}${o.createdByMatricula ? ` (${o.createdByMatricula})` : ''}`);
  kv('Prazo limite', day(o.deadline));
  kv('Técnico', o.assignedTechnicianName ? `${o.assignedTechnicianName} (${o.assignedTechnicianMatricula})` : 'Em aberto');
  kv('Assinada pelo técnico em', dateTime(o.techSignedAt));
  kv('Concluída em', dateTime(o.closedAt));
  kv('Local da execução', o.execAddressText);
  kv('Comarca', o.comarca);
  kv('CRAAI', o.craai);
  kv('Local do requerente', o.reqAddressText);
  kv('Ativo', [o.assetCode, o.assetName].filter(Boolean).join(' — '));
  if (o.status === 'Cancelada') kv('Cancelada', `${dateTime(o.cancelledAt)} por ${o.cancelledBy}: ${o.cancelReason}`);

  const answers = (stage: 'criacao' | 'execucao', t: string) => {
    title(t);
    const ans = stage === 'criacao' ? o.answers || {} : o.exec?.answers || {};
    const fields = (o.templateFields || []).filter((f) => f.stage === stage && osFieldVisible(f, o.templateFields || [], ans));
    if (!fields.length) return kv('Nenhuma pergunta', '');
    fields.forEach((f) => kv(f.label, osAnswerText(f, ans[f.id])));
  };
  answers('criacao', '2. Respostas da abertura');
  answers('execucao', '3. Respostas da execução');

  title('4. Equipe');
  rows.push(['Nome', 'Cargo', 'Matrícula']);
  osMembers(o).forEach((p) => rows.push([p.name, p.cargo || '—', p.matricula]));

  title('5. Materiais');
  rows.push(['Código', 'Descrição', 'Quantidade', 'Unidade']);
  const mats = o.exec?.materials || [];
  if (!mats.length) rows.push(['—', 'Nenhum material']);
  mats.forEach((m) => rows.push([m.code, m.description, m.qty, m.measureUnit]));

  title('6. Hora extra e pernoite');
  rows.push(['Dia', 'Horas', 'Feriado']);
  const ot = o.exec?.overtime || [];
  if (!ot.length) rows.push(['Não houve hora extra']);
  ot.forEach((d) => rows.push([day(d.date), fmtMinutes(d.minutes), d.holiday ? 'Sim' : 'Não']));
  kv('Pernoite (diárias)', o.exec?.overnightNights ? o.exec.overnightNights : 'Não houve');

  if (cost) {
    title('7. Homem-hora e custos');
    kv('Tempo que contou', fmtMinutes(cost.minutes));
    kv('Horas cobradas por pessoa', cost.billedHours);
    if (cost.partial) kv('Atenção', 'Parcial: conta até agora (fecha na assinatura do técnico)');
    rows.push(['Item', 'Detalhe', 'Valor']);
    const line = (grupo: string, l: { label: string; detail: string; value: number | null }) => rows.push([`${grupo}: ${l.label}`, l.detail, l.value === null ? 'sem valor' : brl(l.value)]);
    cost.labor.forEach((l) => line('Homem-hora', l));
    cost.overtime.forEach((l) => line('Hora extra', l));
    if (cost.overnight) line('Pernoite', cost.overnight);
    cost.materials.forEach((l) => line('Material', l));
    rows.push([cost.partial ? 'TOTAL PARCIAL' : 'TOTAL', '', brl(cost.total)]);
    cost.warnings.forEach((w) => kv('Aviso', w));
  }

  title(`${cost ? 8 : 7}. Assinaturas`);
  rows.push(['Papel', 'Nome', 'Matrícula', 'Cargo', 'Data e hora', 'Por onde', 'Avaliação']);
  osSignOrder(o).forEach((r) => {
    const m = o.signatures?.[r];
    rows.push(
      m
        ? [OS_SIGN_LABEL[r], m.name, m.matricula || '—', m.cargo || '—', dateTime(m.at), m.via === 'link' ? 'Link' : m.via === 'celular' ? 'Celular' : 'Sistema', m.rating ? `${m.rating}/5` : '—']
        : [OS_SIGN_LABEL[r], 'Pendente']
    );
  });

  title(`${cost ? 9 : 8}. Contestações`);
  if (!(o.contests || []).length) rows.push(['Nenhuma contestação']);
  else rows.push(['Data', 'Cliente', 'Motivo', 'Resposta', 'Respondida por', 'Respondida em', 'Acrescentado']);
  (o.contests || []).forEach((c) => rows.push([dateTime(c.at), `${c.clientName}${c.clientMatricula ? ` (${c.clientMatricula})` : ''}`, c.reason, c.resolution || 'Sem resposta', c.resolvedBy || '—', dateTime(c.resolvedAt) || '—', c.added || '—']));

  title(`${cost ? 10 : 9}. Linha do tempo`);
  rows.push(['Data e hora', 'O que aconteceu', 'Detalhe', 'Quem']);
  (o.timeline || []).forEach((e) => rows.push([dateTime(e.at), e.action, e.note || '', e.by]));

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 34 }, { wch: 48 }, { wch: 28 }, { wch: 22 }, { wch: 18 }, { wch: 12 }, { wch: 30 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, o.number.slice(0, 31));
  XLSX.writeFile(wb, `Ficha_${o.number}.xlsx`);
}
