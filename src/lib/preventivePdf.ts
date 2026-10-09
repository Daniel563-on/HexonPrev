import { PDFDocument, rgb, StandardFonts } from './pdfHelper';
import { ChecklistItem, OrderSupplies, ServiceOrder, formatDateBR, isCorrectiveRequested } from '../types';
import { fmtMinutes, orderSuppliesText } from '../db/firebase';
import { formatOrderNumber } from '../utils/orderNumber';
import { safe, wrap } from './osPdf';

// PDF PADRÃO DA PREVENTIVA (ajustes da etapa 8): quando o modelo não tem PDF mapeado.
// Mesmo visual do PDF padrão das OS: cabeçalho, seções com faixa, checklist em tabela (resposta colorida),
// execução (tempo, equipe, materiais, insumos), observações e assinatura. Sem valores em R$.

export interface PreventivePdfData {
  order: ServiceOrder;          // com o checklist já montado (texto das perguntas)
  templateName?: string;
  companyName?: string;
  signature?: string | null;    // imagem da assinatura (data:image/png)
  supplies?: OrderSupplies | null;
}

type Font = Awaited<ReturnType<PDFDocument['embedFont']>>;
type Color = ReturnType<typeof rgb>;

const INK = rgb(0.06, 0.09, 0.16);
const SOFT = rgb(0.4, 0.45, 0.52);
const LINE = rgb(0.85, 0.87, 0.9);
const BAND = rgb(0.93, 0.94, 0.98);
const BRAND = rgb(0.21, 0.15, 0.8);
const GREEN = rgb(0.02, 0.5, 0.3);
const RED = rgb(0.75, 0.1, 0.15);

const qty = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');
const isoDay = /^\d{4}-\d{2}-\d{2}$/;

// Resposta de um item do checklist (texto e cor) e o que vai na coluna "Observação"
function answerOf(item: ChecklistItem, concluded: boolean): { text: string; color: Color; note: string } {
  const type = item.responseType || 'three_states';
  const obs = (item.observations || '').trim();
  const notes: string[] = [];
  // Pergunta antiga "Sim/Não" que pede corretiva
  if (item.autoCreateCorrective && item.autoCorrectiveAnswer) {
    const sim = item.autoCorrectiveAnswer === 'Sim';
    if (obs) notes.push(obs);
    if (isCorrectiveRequested(item)) notes.push(correctiveText(item));
    return { text: sim ? 'Sim (pede corretiva)' : 'Não', color: sim ? RED : SOFT, note: notes.join('\n') };
  }
  if (type === 'three_states') {
    const s = item.statusCheck || (concluded ? (item.checked ? 'Atestado' : 'Não Atestado') : undefined);
    if (obs) notes.push(obs);
    if (isCorrectiveRequested(item)) notes.push(correctiveText(item));
    if (s === 'Atestado') return { text: 'Atestado', color: GREEN, note: notes.join('\n') };
    if (s === 'Não Atestado') return { text: 'Não atestado', color: RED, note: notes.join('\n') };
    if (s === 'Não se Aplica') return { text: 'Não se aplica', color: SOFT, note: notes.join('\n') };
    return { text: '—', color: SOFT, note: notes.join('\n') };
  }
  // Texto, número, data ou sim/não: o valor fica na resposta
  if (!obs) return { text: '—', color: SOFT, note: '' };
  return { text: type === 'date' && isoDay.test(obs) ? obs.split('-').reverse().join('/') : obs, color: INK, note: '' };
}
function correctiveText(item: ChecklistItem): string {
  if (item.autoCorrectiveStatus === 'Resolvido') return `Corretiva aberta · GLPI nº ${item.correctiveTicket || '—'}`;
  if (item.autoCorrectiveStatus === 'Cancelado') return `Corretiva: não abrir · ${item.correctiveReason || '—'}`;
  return 'Solicitação de corretiva: aguardando decisão';
}

const b64ToBytes = (b64: string) => {
  const bin = atob(b64.includes(',') ? b64.split(',')[1] : b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export async function generatePreventiveStandardPdf(d: PreventivePdfData): Promise<Uint8Array> {
  const o = d.order;
  const concluded = o.status === 'Concluída';
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28;
  const H = 841.89;
  const M = 40;
  let page = pdf.addPage([W, H]);
  let y = H - M;
  let onNewPage: (() => void) | null = null; // a tabela do checklist repete o cabeçalho na página nova
  const ensure = (need: number) => {
    if (y - need < M + 20) {
      page = pdf.addPage([W, H]);
      y = H - M;
      onNewPage?.();
    }
  };
  const text = (t: string, x: number, size: number, f: Font, color = INK, maxW = W - M - x) => {
    wrap(safe(t, f), f, size, maxW).forEach((ln) => {
      ensure(size * 1.3);
      page.drawText(ln, { x, y: y - size, size, font: f, color });
      y -= size * 1.3;
    });
  };
  const section = (title: string) => {
    ensure(46);
    y -= 8;
    page.drawRectangle({ x: M, y: y - 16, width: W - 2 * M, height: 16, color: BAND });
    page.drawText(safe(title.toUpperCase(), bold), { x: M + 6, y: y - 12, size: 9, font: bold, color: BRAND });
    y -= 22;
  };
  const kv = (label: string, value: string) => {
    if (!value) return;
    const lw = 150;
    const startY = y;
    const vLines = wrap(safe(value, regular), regular, 9, W - 2 * M - lw - 6);
    ensure(Math.min(vLines.length, 6) * 12);
    page.drawText(safe(label, bold), { x: M, y: y - 9, size: 8, font: bold, color: SOFT });
    vLines.forEach((ln) => {
      ensure(12);
      page.drawText(ln, { x: M + lw, y: y - 9, size: 9, font: regular, color: INK });
      y -= 12;
    });
    if (y === startY) y -= 12;
    page.drawLine({ start: { x: M, y: y + 2 }, end: { x: W - M, y: y + 2 }, thickness: 0.5, color: LINE });
    y -= 3;
  };

  // ===== Cabeçalho
  page.drawRectangle({ x: M, y: y - 4, width: 4, height: 24, color: BRAND });
  page.drawText(safe(`PREVENTIVA #${formatOrderNumber(o.id)}`, bold), { x: M + 10, y: y - 16, size: 16, font: bold, color: INK });
  y -= 24;
  text(
    [d.templateName ? `modelo ${d.templateName}` : '', o.unit ? `gerência ${o.unit}` : '', d.companyName ? `empresa ${d.companyName}` : '', `situação: ${o.status}`]
      .filter(Boolean)
      .join(' · '),
    M + 10,
    9,
    regular,
    SOFT
  );
  y -= 4;

  // ===== Dados
  section('Dados da preventiva');
  kv('Título', o.title || '');
  kv('Ativo', o.isSurvey ? [o.surveyType, o.surveyLocation].filter(Boolean).join(' — ') : [o.assetCode, o.assetName].filter(Boolean).join(' — '));
  kv('Setor / tipo', o.sector || '');
  kv('Local', [o.addressText, o.comarca && `Comarca ${o.comarca}`, o.craai && `CRAAI ${o.craai}`].filter(Boolean).join(' · '));
  const period = o.startDate && o.endDate ? `${formatDateBR(o.startDate)} a ${formatDateBR(o.endDate)}` : formatDateBR(o.scheduledDate);
  kv('Período de execução', period);
  kv('Periodicidade', o.periodicity || '');
  kv('Técnico', [o.assignedTechnician, o.assignedTechnicianMatricula && `Mat. ${o.assignedTechnicianMatricula}`].filter(Boolean).join(' — '));

  // ===== Checklist (tabela)
  const items = o.checklist || [];
  section(`Checklist (${items.length} ${items.length === 1 ? 'item' : 'itens'})`);
  if (items.length) {
    const count = (s: string) => items.filter((it) => answerOf(it, concluded).text === s).length;
    text(`${count('Atestado')} atestado(s) · ${count('Não atestado')} não atestado(s) · ${count('Não se aplica')} não se aplica`, M, 8.5, regular, SOFT);
    y -= 2;
    const cols = [
      { x: M, w: 22, title: 'Nº' },
      { x: M + 22, w: 228, title: 'Pergunta' },
      { x: M + 250, w: 92, title: 'Resposta' },
      { x: M + 342, w: W - 2 * M - 342, title: 'Observação' }
    ];
    const head = () => {
      page.drawRectangle({ x: M, y: y - 14, width: W - 2 * M, height: 14, color: rgb(0.96, 0.97, 0.98) });
      cols.forEach((c) => page.drawText(c.title.toUpperCase(), { x: c.x + 3, y: y - 10, size: 7, font: bold, color: SOFT }));
      y -= 16;
    };
    onNewPage = head;
    ensure(30);
    head();
    items.forEach((it, i) => {
      const a = answerOf(it, concluded);
      const size = 8.5;
      const lh = size * 1.25;
      const q = wrap(safe(it.task || '', regular), regular, size, cols[1].w - 6);
      const r = wrap(safe(a.text, bold), bold, size, cols[2].w - 6);
      const n = a.note ? wrap(safe(a.note, regular), regular, 8, cols[3].w - 6) : [];
      const rowH = Math.max(q.length, r.length, n.length, 1) * lh + 6;
      ensure(rowH);
      const top = y;
      if (i % 2 === 1) page.drawRectangle({ x: M, y: top - rowH, width: W - 2 * M, height: rowH, color: rgb(0.985, 0.987, 0.99) });
      page.drawText(String(i + 1), { x: cols[0].x + 3, y: top - size - 2, size, font: bold, color: SOFT });
      q.forEach((ln, k) => page.drawText(ln, { x: cols[1].x + 3, y: top - size - 2 - k * lh, size, font: regular, color: INK }));
      r.forEach((ln, k) => page.drawText(ln, { x: cols[2].x + 3, y: top - size - 2 - k * lh, size, font: bold, color: a.color }));
      n.forEach((ln, k) => page.drawText(ln, { x: cols[3].x + 3, y: top - 8 - 2 - k * lh, size: 8, font: regular, color: SOFT }));
      y -= rowH;
      page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: LINE });
    });
    onNewPage = null;
    y -= 4;
  } else {
    text('Sem itens no checklist.', M, 9, regular, SOFT);
  }

  // ===== Execução
  section('Execução');
  kv('Início', formatDateBR(o.startedAt));
  kv('Conclusão', formatDateBR(o.completedAt));
  if (typeof o.durationMin === 'number') kv('Tempo', fmtMinutes(o.durationMin));
  if (typeof o.manMinutes === 'number') kv('Homem-hora', fmtMinutes(o.manMinutes));
  kv('Executada por', o.startedBy ? `${o.startedBy.name} — Mat. ${o.startedBy.matricula}` : '');
  kv('Equipe', (o.participants || []).map((p) => `${p.name}${p.cargo ? ` (${p.cargo})` : ''} — Mat. ${p.matricula}`).join('\n') || 'só o técnico');
  kv('Materiais', (o.materialsUsed || []).filter((m) => m.qty > 0).map((m) => `${m.description} — ${qty(m.qty)} ${m.measureUnit}`).join('\n') || 'nenhum');
  kv('Insumos', orderSuppliesText(d.supplies || null) || 'nenhum');

  if (o.notes?.trim()) {
    section('Observações gerais');
    text(o.notes.trim(), M, 9, regular);
  }

  // ===== Assinatura
  section('Assinatura');
  const boxW = 260;
  const boxH = 110;
  ensure(boxH + 10);
  page.drawRectangle({ x: M, y: y - boxH, width: boxW, height: boxH, borderColor: LINE, borderWidth: 1 });
  page.drawText('ASSINATURA', { x: M + 6, y: y - 12, size: 8, font: bold, color: SOFT });
  if (d.signature && d.signature.startsWith('data:image')) {
    try {
      const bytes = b64ToBytes(d.signature);
      const img = d.signature.startsWith('data:image/jpeg') || d.signature.startsWith('data:image/jpg') ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
      const s = Math.min((boxW - 12) / img.width, 62 / img.height);
      page.drawImage(img, { x: M + (boxW - img.width * s) / 2, y: y - 18 - img.height * s, width: img.width * s, height: img.height * s });
    } catch {
      // imagem inválida: fica só o nome e a data
    }
  }
  const info = o.signedBy ? `${o.signedBy}${o.signedAt ? ` · ${formatDateBR(o.signedAt)}` : ''}` : 'Pendente';
  page.drawText(safe(info, regular).slice(0, 70), { x: M + 6, y: y - boxH + 8, size: 7.5, font: regular, color: o.signedBy ? INK : SOFT });
  y -= boxH + 8;

  // Rodapé com página
  const pages = pdf.getPages();
  pages.forEach((p, i) =>
    p.drawText(safe(`Preventiva #${formatOrderNumber(o.id)} · gerado em ${new Date().toLocaleString('pt-BR')} · página ${i + 1} de ${pages.length}`, regular), {
      x: M,
      y: 20,
      size: 7,
      font: regular,
      color: SOFT
    })
  );
  return pdf.save();
}
