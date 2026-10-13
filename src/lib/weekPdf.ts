import { PDFDocument, rgb, StandardFonts } from './pdfHelper';
import { safe, wrap } from './osPdf';

// PROGRAMAÇÃO › PDF DA SEMANA (Fase 7D), no formato da planilha PSS: A4 deitado; faixa com gerência, empresa, semana e
// revisão; contadores; uma linha por equipe (responsável e membros com matrícula e função) × segunda a domingo; cada
// bloco com o texto de cada local e as quantidades (bloco com vários locais: os locais de cada dia); pernoite da viagem;
// ausentes na semana e revisões. Se as equipes não couberem, continua na página seguinte com o cabeçalho repetido.

type Font = Awaited<ReturnType<PDFDocument['embedFont']>>;
type Page = ReturnType<PDFDocument['addPage']>;

export interface WeekPdfPerson {
  name: string;
  matricula: string;
  cargo: string;
}
export interface WeekPdfStop {
  from: number; // índice do dia (0 = segunda)
  to: number;
  text: string;
  qty: string;
}
export interface WeekPdfItem {
  from: number;
  to: number;
  lane: number;
  stops: WeekPdfStop[];
  trip?: string; // "PERNOITE: 2 NOITES × 3"
  note?: string;
  gray?: boolean; // acompanha um bloco de outra equipe
}
export interface WeekPdfTeam {
  name: string;
  type: string;
  resp: WeekPdfPerson;
  members: WeekPdfPerson[]; // sem o responsável
  items: WeekPdfItem[];
  lanes: number;
}
export interface WeekPdfData {
  unit: string;
  company: string;
  week: number;
  days: string[]; // 7 dias "AAAA-MM-DD", de segunda a domingo
  rev: number;
  draft: boolean; // "Ver PDF" sem publicar
  at: string; // ISO
  by: string;
  counters: { efetivo: number; disponivel: number; equipes: number; pernoites: number };
  marks: Record<number, { label: string; text: string }>; // dia marcado (feriado etc.): nome no cabeçalho, texto embaixo da tabela
  teams: WeekPdfTeam[];
  absent: { name: string; cargo: string; team: string; kind: string; from: string; to: string }[];
  pubs: { rev: number; at: string; by: string }[];
}

const PAGE_W = 841.89;
const PAGE_H = 595.28;
const M = 22;
const RED = rgb(0.75, 0.07, 0.11);
const DARK = rgb(0.12, 0.16, 0.23);
const LINE = rgb(0.8, 0.83, 0.87);
const SOFT_RED = rgb(1, 0.92, 0.93);
const WEEKEND = rgb(0.94, 0.95, 0.97);
const MARKED = rgb(1, 0.95, 0.9);
const GRAY = rgb(0.42, 0.45, 0.5);
const SKY = rgb(0.03, 0.4, 0.62);
const WHITE = rgb(1, 1, 1);
const BLACK = rgb(0.06, 0.09, 0.16);
const DAY_NAMES = ['SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO', 'DOMINGO'];
const ROW_H = 11;
const up = (s: string) => (s || '').toLocaleUpperCase('pt-BR');
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const dt = (iso: string) => {
  const x = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(x.getDate())}/${p(x.getMonth() + 1)}/${x.getFullYear()} ${p(x.getHours())}:${p(x.getMinutes())}`;
};

// Texto que cabe na largura (corta com "...")
function fit(text: string, font: Font, size: number, w: number): string {
  let t = text;
  if (font.widthOfTextAtSize(t, size) <= w) return t;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > w) t = t.slice(0, -1);
  return `${t}...`;
}

export async function generateWeekPdf(d: WeekPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Programação Semanal — ${d.unit} · ${d.company} — Semana ${d.week} · Rev. ${d.rev}`);
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const S = (t: string, f: Font) => safe(t, f).replace(/\n/g, ' ');

  // Colunas: equipe, nome, matrícula, função e os 7 dias (sábado e domingo mais estreitos)
  const fixed = [70, 108, 32, 112];
  const tableW = PAGE_W - 2 * M;
  const dayUnit = (tableW - fixed.reduce((a, b) => a + b, 0)) / 6.2;
  const widths = [...fixed, ...[1, 1, 1, 1, 1, 0.6, 0.6].map((k) => k * dayUnit)];
  const xs: number[] = [];
  widths.reduce((x, w) => (xs.push(x), x + w), M);
  const dayX = (i: number) => xs[4 + i];
  const dayW = (i: number) => widths[4 + i];

  const text = (p: Page, t: string, x: number, y: number, size: number, f: Font = reg, color = BLACK) => p.drawText(S(t, f), { x, y, size, font: f, color });
  const center = (p: Page, t: string, x: number, w: number, y: number, size: number, f: Font = reg, color = BLACK) => {
    const s = fit(S(t, f), f, size, w - 4);
    p.drawText(s, { x: x + (w - f.widthOfTextAtSize(s, size)) / 2, y, size, font: f, color });
  };
  const box = (p: Page, x: number, y: number, w: number, h: number, fill?: ReturnType<typeof rgb>, border = LINE) =>
    p.drawRectangle({ x, y, width: w, height: h, color: fill, borderColor: border, borderWidth: 0.5 });

  // Cabeçalho de cada página; devolve o y logo abaixo do cabeçalho da tabela
  const head = (p: Page): number => {
    let y = PAGE_H - M;
    p.drawRectangle({ x: M, y: y - 32, width: tableW, height: 32, color: RED });
    text(p, `${up(d.unit)} · ${up(d.company)}`, M + 8, y - 14, 11, bold, WHITE);
    text(p, d.draft ? `PRÉVIA — NÃO PUBLICADA (gerada em ${dt(d.at)} por ${d.by})` : `Publicada em ${dt(d.at)} por ${d.by}`, M + 8, y - 26, 7, bold, WHITE);
    center(p, 'PROGRAMAÇÃO SEMANAL DE SERVIÇOS', M, tableW, y - 18, 12, bold, WHITE);
    const right = `SEMANA ${d.week} · REV. ${d.rev}`;
    text(p, right, M + tableW - 8 - bold.widthOfTextAtSize(S(right, bold), 11), y - 14, 11, bold, WHITE);
    const per = `PERÍODO: ${dm(d.days[0])} A ${dmy(d.days[6])}`;
    text(p, per, M + tableW - 8 - bold.widthOfTextAtSize(S(per, bold), 7), y - 26, 7, bold, WHITE);
    y -= 32;
    const cw = tableW / 4;
    const cs = [`EFETIVO: ${d.counters.efetivo}`, `DISPONIBILIDADE: ${d.counters.disponivel}`, `EQUIPES: ${d.counters.equipes}`, `PERNOITES (pessoa): ${d.counters.pernoites}`];
    cs.forEach((c, i) => {
      p.drawRectangle({ x: M + i * cw, y: y - 13, width: cw, height: 13, color: i === 3 ? rgb(1, 0.97, 0.88) : SOFT_RED });
      center(p, c, M + i * cw, cw, y - 9.5, 7.5, bold);
    });
    y -= 13;
    const hh = 26;
    p.drawRectangle({ x: M, y: y - hh, width: tableW, height: hh, color: DARK });
    ['EQUIPE', 'NOME / RESPONSÁVEL', 'MATR.', 'FUNÇÃO / TIPO DE SERVIÇO'].forEach((h, i) => center(p, h, xs[i], widths[i], y - 15.5, 6.5, bold, WHITE));
    d.days.forEach((day, i) => {
      if (i >= 5) p.drawRectangle({ x: dayX(i), y: y - hh, width: dayW(i), height: hh, color: rgb(0.28, 0.33, 0.41) });
      const mk = d.marks[i];
      center(p, DAY_NAMES[i], dayX(i), dayW(i), y - (mk ? 8 : 11), 6.3, bold, WHITE);
      center(p, dm(day), dayX(i), dayW(i), y - (mk ? 15.5 : 19), 6.3, bold, WHITE);
      if (mk) center(p, up(mk.label), dayX(i), dayW(i), y - 23, 5.3, bold, rgb(1, 0.8, 0.45));
    });
    return y - hh;
  };

  // Conteúdo de um bloco: os locais em linhas (os do mesmo dia um embaixo do outro), pernoite e observação
  type StopBox = { s: WeekPdfStop; row: number; lines: string[]; qty: string; x: number; w: number };
  const layoutItem = (it: WeekPdfItem) => {
    const rowsEnd: number[] = [];
    const boxes: StopBox[] = [...it.stops]
      .sort((a, b) => a.from - b.from || b.to - b.from - (a.to - a.from))
      .map((s) => {
        const from = Math.max(s.from, it.from);
        const to = Math.min(s.to, it.to);
        let row = rowsEnd.findIndex((end) => end < from);
        if (row < 0) {
          row = rowsEnd.length;
          rowsEnd.push(to);
        } else rowsEnd[row] = to;
        const x = dayX(from);
        const w = dayX(to) + dayW(to) - x;
        const lines = wrap(S(s.text, bold), bold, 6.3, w - 6).slice(0, 4);
        return { s, row, lines, qty: s.qty, x, w };
      });
    const rowH = rowsEnd.map((_, r) => Math.max(...boxes.filter((b) => b.row === r).map((b) => b.lines.length * 7.2 + (b.qty ? 7 : 0)), 8) + 3);
    const extra = (it.trip ? 8 : 0) + (it.note ? 8 : 0);
    return { boxes, rowH, height: rowH.reduce((a, b) => a + b, 0) + extra + 4 };
  };
  const drawItem = (p: Page, it: WeekPdfItem, top: number, h: number) => {
    const x = dayX(it.from);
    const w = dayX(it.to) + dayW(it.to) - x;
    box(p, x + 1, top - h + 1, w - 2, h - 2, WHITE, it.gray ? rgb(0.7, 0.72, 0.76) : rgb(0.55, 0.6, 0.7));
    const L = layoutItem(it);
    let y = top - (h - L.height) / 2 - 2;
    L.rowH.forEach((rh, r) => {
      L.boxes
        .filter((b) => b.row === r)
        .forEach((b) => {
          const content = b.lines.length * 7.2 + (b.qty ? 7 : 0);
          let ly = y - (rh - content) / 2 - 6;
          b.lines.forEach((ln) => {
            center(p, ln, b.x, b.w, ly, 6.3, bold, it.gray ? GRAY : BLACK);
            ly -= 7.2;
          });
          if (b.qty) center(p, b.qty, b.x, b.w, ly + 0.5, 5.6, bold, GRAY);
        });
      y -= rh;
    });
    if (it.trip) {
      center(p, it.trip, x, w, y - 6, 5.6, bold, SKY);
      y -= 8;
    }
    if (it.note) center(p, it.note, x, w, y - 6, 5.6, reg, GRAY);
  };

  const pages: Page[] = [];
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  pages.push(page);
  let y = head(page);
  const bottom = M + 14;
  const newPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    y = head(page);
  };

  for (const t of d.teams) {
    const people = [t.resp, ...t.members];
    const laneH = Array.from({ length: Math.max(1, t.lanes) }, (_, ln) => Math.max(0, ...t.items.filter((it) => it.lane === ln).map((it) => layoutItem(it).height)));
    const rowsH = (people.length + 1) * ROW_H;
    const h = Math.max(rowsH, laneH.reduce((a, b) => a + b, 0));
    if (y - h < bottom) newPage();
    const top = y;
    // fundo dos dias (fim de semana e dia marcado) e as linhas das pessoas
    d.days.forEach((_, i) => box(page, dayX(i), top - h, dayW(i), h, d.marks[i] ? MARKED : i >= 5 ? WEEKEND : WHITE));
    const rowH = h / (people.length + 1);
    // linha do responsável (vermelha) com o tipo de serviço
    page.drawRectangle({ x: M, y: top - rowH, width: xs[4] - M, height: rowH, color: SOFT_RED });
    text(page, fit(up(t.name), bold, 6.3, widths[0] - 4), xs[0] + 2, top - rowH / 2 - 2.2, 6.3, bold, RED);
    text(page, fit(up(t.resp.name), bold, 6.3, widths[1] - 4), xs[1] + 2, top - rowH / 2 - 2.2, 6.3, bold, RED);
    center(page, up(t.type), xs[3], widths[3], top - rowH / 2 - 2.2, 6, bold);
    people.forEach((m, i) => {
      const ry = top - rowH * (i + 2);
      [up(t.name), up(m.name), m.matricula, up(m.cargo)].forEach((v, c) => {
        box(page, xs[c], ry, widths[c], rowH);
        if (c === 2) center(page, v, xs[c], widths[c], ry + rowH / 2 - 2.2, 6, bold);
        else text(page, fit(S(v, bold), bold, 6, widths[c] - 4), xs[c] + 2, ry + rowH / 2 - 2.2, 6, bold);
      });
    });
    [0, 1, 2, 3].forEach((c) => box(page, xs[c], top - rowH, widths[c], rowH, undefined));
    // blocos: cada faixa com a altura que precisa (o que sobra vai para a última)
    const lanes = Math.max(1, t.lanes);
    const extraPerLane = (h - laneH.reduce((a, b) => a + b, 0)) / lanes;
    let ly = top;
    for (let ln = 0; ln < lanes; ln++) {
      const lh = laneH[ln] + extraPerLane;
      t.items.filter((it) => it.lane === ln).forEach((it) => drawItem(page, it, ly, lh));
      ly -= lh;
    }
    y = top - h;
  }

  // Ausentes e revisões
  const section = (title: string, color: ReturnType<typeof rgb>, rows: string[][], cols: number[]) => {
    // a seção inteira na mesma página quando cabe numa página só
    if (y - 20 - Math.max(1, rows.length) * 10 < bottom) newPage();
    y -= 6;
    page.drawRectangle({ x: M, y: y - 12, width: tableW, height: 12, color });
    center(page, title, M, tableW, y - 8.5, 7, bold, WHITE);
    y -= 12;
    const total = cols.reduce((a, b) => a + b, 0);
    rows.forEach((r) => {
      if (y - 10 < bottom) newPage();
      let x = M;
      r.forEach((v, i) => {
        const w = (cols[i] / total) * tableW;
        box(page, x, y - 10, w, 10);
        text(page, fit(S(v, bold), bold, 6, w - 4), x + 2, y - 7, 6, bold);
        x += w;
      });
      y -= 10;
    });
  };
  const marked = Object.keys(d.marks)
    .map(Number)
    .sort((a, b) => a - b);
  if (marked.length)
    section(
      'DIAS MARCADOS',
      rgb(0.6, 0.35, 0.05),
      marked.map((i) => [`${DAY_NAMES[i]} ${dm(d.days[i])}`, up(d.marks[i].label), d.marks[i].text]),
      [2, 2, 6]
    );
  section(
    'AUSENTES NA SEMANA — férias, atestados e licenças',
    rgb(0.5, 0.1, 0.1),
    d.absent.length ? d.absent.map((a) => [up(a.name), up([a.cargo, a.team].filter(Boolean).join(' · ')), up(`${a.kind} ${dm(a.from)} a ${dm(a.to)}`)]) : [['NINGUÉM AUSENTE NESTA SEMANA', '', '']],
    [3, 4, 3]
  );
  section('REVISÕES', DARK, d.pubs.length ? d.pubs.map((r) => [`REV. ${r.rev}`, dt(r.at), up(r.by)]) : [['AINDA NÃO PUBLICADA', '', '']], [1, 2, 4]);

  // Rodapé com a página
  pages.forEach((p, i) => center(p, `${d.unit} · ${d.company} · Programação Semanal de Serviços · Semana ${d.week} · Rev. ${d.rev} · Página ${i + 1} de ${pages.length}`, M, tableW, M - 2, 6.5, reg, GRAY));
  return pdf.save();
}
