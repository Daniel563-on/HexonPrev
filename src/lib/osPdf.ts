import { PDFDocument, rgb, StandardFonts } from './pdfHelper';
import { OrderSupplies, OsPdfLayout, OsPdfPin, OsSignatureRole, OsTemplateField, WorkOrder } from '../types';
import {
  OS_SIGN_LABEL,
  dbGetCompanies,
  dbGetOrderSupplies,
  dbGetOsPdfFile,
  dbGetOsPdfLayout,
  dbGetOsSignatureImage,
  orderSuppliesByRequestText,
  orderSuppliesText,
  osAnswerText,
  osFieldVisible,
  osMembers,
  osStatusLabel
} from '../db/firebase';
import { deliverBytes, deliverFile } from './fileDelivery';
import { renderOsSignature } from '../components/os/OsSignaturePad';
import { osRefText } from './osRef';

// PDF DA OS (Fase 5C): campos que podem ir para o PDF mapeado, o valor de cada um e os dois geradores:
// o PDF mapeado (PDF oficial do modelo + caixas) e o PDF padrão (quando o modelo não tem PDF).
// Sem valores em R$ (o PDF pode ir para o cliente).

export interface OsPdfData {
  order: WorkOrder;
  signatures: Partial<Record<OsSignatureRole, string>>; // imagem (data:image/png) de cada assinatura feita
  companyName?: string; // nome da empresa da OS (etapa especial E4)
  supplies?: OrderSupplies | null; // insumos recebidos (Fase 8C-3)
}
export interface OsPdfFieldOption {
  value: string;
  label: string;
  group: string;
}

const ROLES: OsSignatureRole[] = ['tecnico', 'cliente', 'engenheiro', 'gerente'];

const SYS: [string, string][] = [
  ['numero', 'Nº da OS'],
  ['modelo', 'Modelo'],
  ['gerencia', 'Gerência'],
  ['empresa', 'Empresa'],
  ['status', 'Situação'],
  ['intervencao', 'Intervenção'],
  ['glpi', 'GLPI'],
  ['abertura', 'Data de abertura'],
  ['aberturaHora', 'Data e hora de abertura'],
  ['abertoPor', 'Aberta por'],
  ['prazo', 'Prazo limite'],
  ['conclusao', 'Data de conclusão'],
  ['tecnico', 'Técnico'],
  ['tecnicoMatricula', 'Matrícula do técnico'],
  ['localRequerente', 'Local do requerente'],
  ['ativo', 'Ativo'],
  ['equipe', 'Equipe (nomes)'],
  ['equipeCompleta', 'Equipe (nome, cargo e matrícula)'],
  ['materiais', 'Materiais usados'],
  ['horaExtra', 'Hora extra (dias e horas)'],
  ['pernoite', 'Pernoite (diárias)'],
  ['contestacoes', 'Contestações e respostas']
];

export function osPdfFieldOptions(fields: OsTemplateField[]): OsPdfFieldOption[] {
  const out: OsPdfFieldOption[] = [];
  // Locais: cada parte do "Local" (CRAAI › Comarca › Endereço) separada, para mapear em caixas diferentes
  const LOC = 'Locais (CRAAI, comarca e endereço)';
  out.push({ value: 'sys:craai', label: 'Execução — CRAAI', group: LOC });
  out.push({ value: 'sys:comarca', label: 'Execução — Comarca', group: LOC });
  out.push({ value: 'sys:endereco', label: 'Execução — Endereço', group: LOC });
  fields
    .filter((f) => f.type === 'location')
    .forEach((f) => {
      out.push({ value: `q:${f.id}:craai`, label: `${f.label} — CRAAI`, group: LOC });
      out.push({ value: `q:${f.id}:comarca`, label: `${f.label} — Comarca`, group: LOC });
      if (f.locationDepth !== 'comarca') out.push({ value: `q:${f.id}:endereco`, label: `${f.label} — Endereço`, group: LOC });
    });
  SYS.forEach(([k, l]) => out.push({ value: `sys:${k}`, label: l, group: 'Dados da OS' }));
  // Insumos recebidos (Fase 8C-3): somados ou pedido a pedido; sem código e sem R$
  out.push({ value: 'sys:insumos', label: 'Insumos (descrição e quantidade)', group: 'Insumos' });
  out.push({ value: 'sys:insumosPedidos', label: 'Insumos por pedido (nº e GLPI)', group: 'Insumos' });
  fields.filter((f) => f.stage === 'criacao').forEach((f) => out.push({ value: `q:${f.id}`, label: f.label, group: 'Perguntas da criação' }));
  fields.filter((f) => f.stage === 'execucao').forEach((f) => out.push({ value: `q:${f.id}`, label: f.label, group: 'Perguntas da execução' }));
  ROLES.forEach((r) => {
    const g = `Assinatura — ${OS_SIGN_LABEL[r]}`;
    out.push({ value: `sig:${r}`, label: `Assinatura (imagem) — ${OS_SIGN_LABEL[r]}`, group: g });
    out.push({ value: `signame:${r}`, label: `Nome — ${OS_SIGN_LABEL[r]}`, group: g });
    out.push({ value: `sigmat:${r}`, label: `Matrícula — ${OS_SIGN_LABEL[r]}`, group: g });
    out.push({ value: `sigat:${r}`, label: `Data e hora — ${OS_SIGN_LABEL[r]}`, group: g });
    if (r === 'cliente') out.push({ value: 'sigrating:cliente', label: 'Avaliação (estrelas) — Cliente', group: g });
  });
  out.push({ value: 'fixed', label: 'Texto fixo', group: 'Outros' });
  return out;
}

// O PDF mapeado tem caixa de insumos? (só então lê os insumos da OS)
export const osPdfUsesSupplies = (pins: OsPdfPin[]) => pins.some((p) => p.field.startsWith('sys:insumos'));

export function osPdfFieldLabel(value: string, fields: OsTemplateField[]): string {
  return osPdfFieldOptions(fields).find((o) => o.value === value)?.label || (value.startsWith('q:') ? 'Pergunta removida do modelo' : value);
}

const day = (s?: string) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '');
const dateTime = (s?: string) => (s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const qty = (n: number) => String(n).replace('.', ',');
const hm = (min: number) => `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`;

// Valor de um campo na OS (texto ou imagem)
export function osPdfValue(field: string, pin: Pick<OsPdfPin, 'fixedText'> | null, d: OsPdfData): { text?: string; image?: string; stars?: number } {
  const o = d.order;
  const exec = o.exec;
  if (field === 'fixed') return { text: pin?.fixedText || '' };
  const [kind, key, part] = field.split(':');
  if (kind === 'q') {
    const f = (o.templateFields || []).find((x) => x.id === key);
    if (!f) return { text: '' };
    const answers = f.stage === 'criacao' ? o.answers || {} : exec?.answers || {};
    if (!osFieldVisible(f, o.templateFields || [], answers)) return { text: '' };
    const v = answers[f.id];
    // Parte de um Local (CRAAI, comarca ou endereço)
    if (part && f.type === 'location') return { text: String((part === 'endereco' ? v?.address : v?.[part]) || '') };
    if (f.type === 'signature') return typeof v === 'string' && v.startsWith('data:image') ? { image: v } : { text: '' };
    return { text: osAnswerText(f, v) };
  }
  if (kind === 'sig') return d.signatures[key as OsSignatureRole] ? { image: d.signatures[key as OsSignatureRole] } : { text: '' };
  const meta = o.signatures?.[key as OsSignatureRole];
  if (kind === 'signame') return { text: meta?.name || '' };
  if (kind === 'sigmat') return { text: meta?.matricula || '' };
  if (kind === 'sigat') return { text: dateTime(meta?.at) };
  // U18: as estrelas são desenhadas (a letra padrão do PDF não tem o símbolo de estrela)
  if (kind === 'sigrating') return meta?.rating ? { stars: Math.max(1, Math.min(5, Math.round(meta.rating))) } : { text: '' };
  switch (key) {
    case 'numero':
      return { text: o.number };
    case 'modelo':
      return { text: o.templateName };
    case 'gerencia':
      return { text: o.unit };
    case 'empresa':
      return { text: d.companyName || '' };
    case 'status':
      return { text: osStatusLabel(o) };
    case 'intervencao':
      return { text: o.intervencao || '' };
    case 'glpi':
      return { text: o.glpi || '' };
    case 'abertura':
      return { text: day(o.createdAt) };
    case 'aberturaHora':
      return { text: dateTime(o.createdAt) };
    case 'abertoPor':
      return { text: o.createdByName || '' };
    case 'prazo':
      return { text: day(o.deadline) };
    case 'conclusao':
      return { text: day(o.closedAt) };
    case 'tecnico':
      return { text: o.assignedTechnicianName || '' };
    case 'tecnicoMatricula':
      return { text: o.assignedTechnicianMatricula || '' };
    case 'endereco':
      return { text: o.execAddressText || '' };
    case 'craai':
      return { text: o.craai || '' };
    case 'comarca':
      return { text: o.comarca || '' };
    case 'localRequerente':
      return { text: o.reqAddressText || '' };
    case 'ativo':
      return { text: [o.assetCode, o.assetName].filter(Boolean).join(' — ') };
    case 'equipe':
      return { text: exec ? osMembers(o).map((p) => p.name).join(', ') : '' };
    case 'equipeCompleta':
      return { text: exec ? osMembers(o).map((p) => `${p.name}${p.cargo ? ` (${p.cargo})` : ''} — Mat. ${p.matricula}`).join('\n') : '' };
    case 'materiais':
      return { text: (exec?.materials || []).map((m) => `${m.description} — ${qty(m.qty)} ${m.measureUnit}`).join('\n') };
    case 'insumos':
      return { text: orderSuppliesText(d.supplies || null) };
    case 'insumosPedidos':
      return { text: orderSuppliesByRequestText(d.supplies || null) };
    case 'horaExtra':
      return { text: (exec?.overtime || []).map((x) => `${day(x.date)}: ${hm(x.minutes)}${x.holiday ? ' (feriado)' : ''}`).join('\n') };
    case 'pernoite':
      return { text: exec?.overnightNights ? `${exec.overnightNights} diária(s)` : '' };
    case 'contestacoes':
      return {
        text: (o.contests || [])
          .map((c, i) => `${i + 1}ª contestação (${dateTime(c.at)}, ${c.clientName}): ${c.reason}${c.resolvedAt ? `\nResposta (${dateTime(c.resolvedAt)}, ${c.resolvedBy}): ${c.resolution}` : ''}`)
          .join('\n')
      };
  }
  return { text: '' };
}

// ===== Ferramentas de desenho =====
type Font = Awaited<ReturnType<PDFDocument['embedFont']>>;

// A fonte padrão do PDF não tem todos os símbolos: troca os que não existem (usado também no PDF da preventiva)
export function safe(text: string, font: Font): string {
  const map: Record<string, string> = { '★': '*', '☆': '-', '→': '->', '\t': '    ' };
  let out = '';
  for (const ch of text.replace(/\r/g, '')) {
    if (ch === '\n') {
      out += ch;
      continue;
    }
    const c = map[ch] ?? ch;
    try {
      font.encodeText(c);
      out += c;
    } catch {
      out += '?';
    }
  }
  return out;
}

export function wrap(text: string, font: Font, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  text.split('\n').forEach((para) => {
    let line = '';
    para.split(' ').forEach((word) => {
      const tryLine = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(tryLine, size) <= maxWidth || !line) {
        // palavra maior que a caixa: quebra no meio
        if (!line && font.widthOfTextAtSize(word, size) > maxWidth) {
          let part = '';
          for (const ch of word) {
            if (font.widthOfTextAtSize(part + ch, size) > maxWidth && part) {
              lines.push(part);
              part = '';
            }
            part += ch;
          }
          line = part;
        } else line = tryLine;
      } else {
        lines.push(line);
        line = word;
      }
    });
    lines.push(line);
  });
  return lines;
}

const b64ToBytes = (b64: string) => {
  const bin = atob(b64.includes(',') ? b64.split(',')[1] : b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

async function embedImage(pdf: PDFDocument, dataUrl: string) {
  const bytes = b64ToBytes(dataUrl);
  return dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg') ? pdf.embedJpg(bytes) : pdf.embedPng(bytes);
}

// U23: carimbo grande no PDF — a imagem da assinatura (carimbo + desenho) tem margem branca em volta; corta a margem
// (vale para as assinaturas já feitas) e a imagem ocupa a caixa quase toda, com uma borda fina
async function trimSignature(dataUrl: string): Promise<string> {
  try {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (d[i + 3] > 16 && (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235)) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    if (x1 < 0) return dataUrl;
    const pad = 3;
    x0 = Math.max(0, x0 - pad);
    y0 = Math.max(0, y0 - pad);
    x1 = Math.min(c.width - 1, x1 + pad);
    y1 = Math.min(c.height - 1, y1 + pad);
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 1;
    out.height = y1 - y0 + 1;
    out.getContext('2d')!.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  } catch {
    return dataUrl;
  }
}

// U18: estrela de 5 pontas (caixa 100×100, y para baixo) — drawSvgPath põe o canto de cima à esquerda em (x, y)
const STAR_PATH = (() => {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = ((-90 + i * 36) * Math.PI) / 180;
    const r = i % 2 ? 19.1 : 50;
    return `${(50 + r * Math.cos(a)).toFixed(1)} ${(53 + r * Math.sin(a)).toFixed(1)}`;
  });
  return `M ${pts.join(' L ')} Z`;
})();
function drawStars(page: any, n: number, x: number, yTop: number, size: number) {
  for (let i = 0; i < n; i++)
    page.drawSvgPath(STAR_PATH, { x: x + i * size * 1.25, y: yTop, scale: size / 100, color: rgb(0.96, 0.62, 0.04), borderColor: rgb(0.85, 0.47, 0.02), borderWidth: 0.4 });
}

// ===== PDF mapeado =====
export async function generateOsMappedPdf(pdfBase64: string, pins: OsPdfPin[], d: OsPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(b64ToBytes(pdfBase64));
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages = pdf.getPages();
  for (const pin of pins) {
    const page = pages[pin.page - 1];
    if (!page) continue;
    const { width: W, height: H } = page.getSize();
    const bx = (pin.x / 100) * W;
    const bw = (pin.w / 100) * W;
    const bh = (pin.h / 100) * H;
    const top = H - (pin.y / 100) * H;
    const v = osPdfValue(pin.field, pin, d);
    if (v.image) {
      // U23: assinatura sem a margem branca, com uma borda fina dentro da caixa
      const sig = pin.field.startsWith('sig:');
      const img = await embedImage(pdf, sig ? await trimSignature(v.image) : v.image);
      const m = sig ? Math.min(2.5, Math.min(bw, bh) * 0.05) : 0;
      const scale = Math.min((bw - 2 * m) / img.width, (bh - 2 * m) / img.height);
      const iw = img.width * scale;
      const ih = img.height * scale;
      const ix = pin.align === 'left' ? bx + m : pin.align === 'right' ? bx + bw - m - iw : bx + (bw - iw) / 2;
      // Imagem: sem escolha vertical fica ao meio (como antes)
      const iy = pin.valign === 'top' ? top - m - ih : pin.valign === 'bottom' ? top - bh + m : top - bh + (bh - ih) / 2;
      page.drawImage(img, { x: ix, y: iy, width: iw, height: ih });
      continue;
    }
    if (v.stars) {
      // U18: N estrelas do tamanho da letra da caixa (diminui se não couber)
      const s = Math.min((pin.fontSize || 10) * 1.2, bh, bw / (v.stars * 1.25));
      const total = v.stars * s + (v.stars - 1) * s * 0.25;
      const sx = pin.align === 'center' ? bx + (bw - total) / 2 : pin.align === 'right' ? bx + bw - total : bx;
      const sy = pin.valign === 'middle' ? top - (bh - s) / 2 : pin.valign === 'bottom' ? top - bh + s : top;
      drawStars(page, v.stars, sx, sy, s);
      continue;
    }
    if (!v.text) continue;
    const font = pin.bold ? bold : regular;
    const text = safe(v.text, font);
    // Diminui a letra até caber na caixa (mínimo 5 pt)
    let size = pin.fontSize || 10;
    let lines = wrap(text, font, size, bw);
    while (size > 5 && lines.length * size * 1.15 > bh) {
      size -= 0.5;
      lines = wrap(text, font, size, bw);
    }
    const lh = size * 1.15;
    // Vertical: em cima (padrão), ao meio ou embaixo da caixa
    const blockH = Math.min(lines.length * lh, bh);
    const offset = pin.valign === 'middle' ? (bh - blockH) / 2 : pin.valign === 'bottom' ? bh - blockH : 0;
    lines.forEach((ln, i) => {
      const y = top - offset - size - i * lh + size * 0.15;
      if (y < top - bh - size * 0.5) return;
      const tw = font.widthOfTextAtSize(ln, size);
      const x = pin.align === 'center' ? bx + (bw - tw) / 2 : pin.align === 'right' ? bx + bw - tw : bx;
      page.drawText(ln, { x, y, size, font, color: rgb(0, 0, 0) });
    });
  }
  return pdf.save();
}

// ===== PDF padrão (modelo sem PDF mapeado) =====
export async function generateOsStandardPdf(d: OsPdfData): Promise<Uint8Array> {
  const o = d.order;
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28;
  const H = 841.89;
  const M = 40;
  const ink = rgb(0.06, 0.09, 0.16);
  const soft = rgb(0.4, 0.45, 0.52);
  const line = rgb(0.85, 0.87, 0.9);
  let page = pdf.addPage([W, H]);
  let y = H - M;
  const ensure = (need: number) => {
    if (y - need < M + 20) {
      page = pdf.addPage([W, H]);
      y = H - M;
    }
  };
  const text = (t: string, x: number, size: number, f: Font, color = ink, maxW = W - M - x) => {
    const lines = wrap(safe(t, f), f, size, maxW);
    lines.forEach((ln) => {
      ensure(size * 1.3);
      page.drawText(ln, { x, y: y - size, size, font: f, color });
      y -= size * 1.3;
    });
  };
  const section = (title: string) => {
    ensure(40);
    y -= 8;
    page.drawRectangle({ x: M, y: y - 16, width: W - 2 * M, height: 16, color: rgb(0.93, 0.94, 0.98) });
    page.drawText(safe(title.toUpperCase(), bold), { x: M + 6, y: y - 12, size: 9, font: bold, color: rgb(0.21, 0.15, 0.8) });
    y -= 22;
  };
  const kv = (label: string, value: string) => {
    if (!value) return;
    const lw = 150;
    const startY = y;
    const vLines = wrap(safe(value, regular), regular, 9, W - 2 * M - lw - 6);
    ensure(Math.min(vLines.length, 6) * 12);
    page.drawText(safe(label, bold), { x: M, y: y - 9, size: 8, font: bold, color: soft });
    vLines.forEach((ln) => {
      ensure(12);
      page.drawText(ln, { x: M + lw, y: y - 9, size: 9, font: regular, color: ink });
      y -= 12;
    });
    if (y === startY) y -= 12;
    page.drawLine({ start: { x: M, y: y + 2 }, end: { x: W - M, y: y + 2 }, thickness: 0.5, color: line });
    y -= 3;
  };

  // Cabeçalho
  // U4: a GLPI em destaque no título; o Nº da OS vai logo abaixo
  page.drawText(safe(o.glpi ? `ORDEM DE SERVIÇO · GLPI ${o.glpi}` : `ORDEM DE SERVIÇO ${o.number}`, bold), { x: M, y: y - 16, size: 16, font: bold, color: ink });
  y -= 22;
  text(`${o.intervencao || 'OS'} · modelo ${o.templateName} · gerência ${o.unit}${d.companyName ? ` · empresa ${d.companyName}` : ''} · situação: ${osStatusLabel(o)}`, M, 9, regular, soft);
  y -= 4;

  section('Dados da OS');
  const v = (k: string) => osPdfValue(`sys:${k}`, null, d).text || '';
  kv('GLPI', v('glpi'));
  kv('Nº da OS', o.number);
  kv('Aberta em', v('aberturaHora'));
  kv('Aberta por', v('abertoPor'));
  kv('Prazo limite', v('prazo'));
  kv('Concluída em', v('conclusao'));
  kv('Técnico', [v('tecnico'), v('tecnicoMatricula') && `Mat. ${v('tecnicoMatricula')}`].filter(Boolean).join(' — '));
  kv('Local da execução', [v('endereco'), v('comarca') && `Comarca ${v('comarca')}`, v('craai') && `CRAAI ${v('craai')}`].filter(Boolean).join(' · '));
  kv('Local do requerente', v('localRequerente'));
  kv('Ativo', v('ativo'));

  const answers = (stage: 'criacao' | 'execucao', title: string) => {
    const fields = (o.templateFields || []).filter((f) => f.stage === stage && f.type !== 'signature');
    const rows = fields.map((f) => [f.label, osPdfValue(`q:${f.id}`, null, d).text || ''] as [string, string]).filter(([, t]) => t);
    if (!rows.length) return;
    section(title);
    rows.forEach(([l, t]) => kv(l, t));
  };
  answers('criacao', 'Abertura');
  answers('execucao', 'Execução');

  if (o.exec) {
    section('Equipe, materiais e adicionais');
    kv('Equipe', v('equipeCompleta'));
    kv('Materiais', v('materiais') || 'nenhum');
    kv('Insumos', v('insumos') || 'nenhum');
    kv('Hora extra', v('horaExtra') || 'não houve');
    kv('Pernoite', v('pernoite') || 'não houve');
  }
  if (o.contests?.length) {
    section('Contestações do cliente');
    text(v('contestacoes'), M, 9, regular);
  }

  // Assinaturas: 2 por linha
  const roles = (o.templateSignatures?.length ? o.templateSignatures : ROLES).filter((r, i, a) => a.indexOf(r) === i);
  const order: OsSignatureRole[] = ['tecnico', ...roles.filter((r) => r !== 'tecnico')];
  section('Assinaturas');
  const colW = (W - 2 * M - 12) / 2;
  const boxH = 110;
  for (let i = 0; i < order.length; i += 2) {
    ensure(boxH + 10);
    for (let j = 0; j < 2 && i + j < order.length; j++) {
      const r = order[i + j];
      const x = M + j * (colW + 12);
      const meta = o.signatures?.[r];
      page.drawRectangle({ x, y: y - boxH, width: colW, height: boxH, borderColor: line, borderWidth: 1 });
      page.drawText(safe(OS_SIGN_LABEL[r].toUpperCase(), bold), { x: x + 6, y: y - 12, size: 8, font: bold, color: soft });
      const img = d.signatures[r];
      if (img) {
        const em = await embedImage(pdf, await trimSignature(img)); // U23: sem a margem branca
        const s = Math.min((colW - 12) / em.width, 62 / em.height);
        page.drawImage(em, { x: x + (colW - em.width * s) / 2, y: y - 18 - em.height * s, width: em.width * s, height: em.height * s });
      }
      const info = meta
        ? `${meta.name}${meta.matricula ? ` · Mat. ${meta.matricula}` : ''} · ${dateTime(meta.at)}${meta.via === 'link' ? ' · validado pelo link' : ''}`
        : 'Pendente';
      const infoText = safe(info, regular).slice(0, 80);
      page.drawText(infoText, { x: x + 6, y: y - boxH + 8, size: 7.5, font: regular, color: meta ? ink : soft });
      // U18: estrelas desenhadas depois do texto
      if (meta?.rating) drawStars(page, Math.max(1, Math.min(5, Math.round(meta.rating))), x + 6 + regular.widthOfTextAtSize(infoText, 7.5) + 4, y - boxH + 8 + 7, 7);
    }
    y -= boxH + 8;
  }

  // Rodapé com página
  const pages = pdf.getPages();
  pages.forEach((p, i) =>
    p.drawText(safe(`${osRefText(o)} · gerado em ${new Date().toLocaleString('pt-BR')} · página ${i + 1} de ${pages.length}`, regular), { x: M, y: 20, size: 7, font: regular, color: soft })
  );
  return pdf.save();
}

// PDF de uma OS (mapeado do modelo, se tiver; senão o padrão), com as imagens das assinaturas feitas.
// U17: a validação pelo link não tem desenho — vai o carimbo com os dados (nome, matrícula, avaliação, data/hora).
// "layouts" guarda o modelo de PDF já lido (exportação de várias OS lê cada modelo uma vez só).
export async function buildOsPdfBytes(o: WorkOrder, layouts?: Map<string, { layout: OsPdfLayout; file: string } | null>): Promise<Uint8Array> {
  const signatures: Partial<Record<OsSignatureRole, string>> = {};
  await Promise.all(
    (Object.keys(o.signatures || {}) as OsSignatureRole[])
      .map(async (r) => {
        const m = o.signatures![r]!;
        if (m.via === 'link') {
          signatures[r] = await renderOsSignature([], { role: r, name: m.name, matricula: m.matricula, cargo: m.cargo, rating: m.rating, at: m.at, via: 'link' }).catch(() => '');
          if (!signatures[r]) delete signatures[r];
          return;
        }
        const img = await dbGetOsSignatureImage(o.id, r);
        if (img) signatures[r] = img;
      })
  );
  let entry = layouts?.get(o.templateId);
  if (entry === undefined) {
    const layout = o.templateId ? await dbGetOsPdfLayout(o.templateId) : null;
    const file = layout ? await dbGetOsPdfFile(layout) : null;
    entry = layout && file ? { layout, file } : null;
    layouts?.set(o.templateId, entry);
  }
  const companyName = o.company ? (await dbGetCompanies().catch(() => [])).find((c) => c.id === o.company)?.name || o.company : '';
  // Insumos (Fase 8C-3): 1 leitura, só quando o PDF mostra insumos (padrão: OS já executada; mapeado: com caixa de insumos)
  const supplies = (entry ? osPdfUsesSupplies(entry.layout.pins) : !!o.exec) ? await dbGetOrderSupplies(o.id, false, true) : null;
  const data = { order: o, signatures, companyName, supplies };
  return entry ? generateOsMappedPdf(entry.file, entry.layout.pins, data) : generateOsStandardPdf(data);
}

// Computador: baixa; celular: aviso "PDF pronto" com o menu de compartilhar (P39, ver fileDelivery.ts)
export function downloadBlob(blob: Blob, fileName: string): void {
  deliverFile(blob, fileName);
}

export function downloadBytes(bytes: Uint8Array, fileName: string, mime = 'application/pdf'): void {
  deliverBytes(bytes, fileName, mime);
}
