// ASSINATURA LEVE (Lote 4, S8 da simulação de carga — 15/10/2026): a imagem continua do mesmo tamanho (OS 720×270,
// preventiva 400×160), com o mesmo carimbo e o mesmo traço, mas é gravada como PNG de PALETA com 4 tons (2 bits por ponto)
// em vez do PNG comum do navegador (32 bits por ponto). Assinatura da OS: ~35 KB → ~4 KB; preventiva: ~12 KB → ~1,5 KB.
// Escolha do usuário: 4 tons ("não vi diferença nenhuma mesmo com zoom"). O pdf-lib e as telas leem PNG de paleta.
// A compressão usa o recurso do próprio navegador (CompressionStream). Aparelho sem ele (ex.: iPhone com iOS antigo)
// grava o PNG de sempre. As assinaturas antigas não mudam.

type RGB = [number, number, number];

const hexRgb = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: RGB, b: RGB, t: number): RGB => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t)) as RGB;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
function pngChunk(type: string, data: Uint8Array | number[]): Uint8Array {
  const body = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i++) body[i] = type.charCodeAt(i);
  body.set(data, 4);
  const out = new Uint8Array(12 + data.length);
  out.set(u32(data.length), 0);
  out.set(body, 4);
  out.set(u32(crc32(body)), 8 + data.length);
  return out;
}

export const compactSignatureSupported = (): boolean => typeof CompressionStream !== 'undefined' && typeof Response !== 'undefined';

async function zlibDeflate(raw: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toDataUrl(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return 'data:image/png;base64,' + btoa(s);
}

// PNG de paleta com 4 tons (2 bits). "alpha" = transparência de cada tom (preventiva: fundo transparente)
async function palettePng(canvas: HTMLCanvasElement, palette: RGB[], alpha?: number[]): Promise<string> {
  const w = canvas.width;
  const h = canvas.height;
  const px = canvas.getContext('2d')!.getImageData(0, 0, w, h).data;
  const rowLen = Math.ceil(w / 4);
  const raw = new Uint8Array((rowLen + 1) * h); // cada linha começa com o filtro 0
  const a = alpha || palette.map(() => 255);
  for (let y = 0; y < h; y++) {
    const row = y * (rowLen + 1) + 1;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let best = 0;
      let bd = Infinity;
      for (let k = 0; k < palette.length; k++) {
        const c = palette[k];
        const d = (px[i] - c[0]) ** 2 + (px[i + 1] - c[1]) ** 2 + (px[i + 2] - c[2]) ** 2 + (px[i + 3] - a[k]) ** 2;
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
      raw[row + (x >> 2)] |= best << (6 - 2 * (x & 3));
    }
  }
  const idat = await zlibDeflate(raw);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', [...u32(w), ...u32(h), 2, 3, 0, 0, 0]),
    pngChunk('PLTE', palette.flat()),
    ...(alpha ? [pngChunk('tRNS', alpha)] : []),
    pngChunk('IDAT', idat),
    pngChunk('IEND', [])
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  parts.forEach((p) => {
    out.set(p, off);
    off += p.length;
  });
  return toDataUrl(out);
}

const dataUrlBytes = (u: string) => Math.round((u.length - u.indexOf(',') - 1) * 0.75);

// Assinatura da OS (fundo branco, carimbo na cor do papel com 85% e traço quase preto): branco, carimbo, traço e
// 1 tom de passagem. Sem suporte ou se não ficar menor: devolve o PNG de sempre.
export async function compactOsSignature(canvas: HTMLCanvasElement, stampHex: string, inkHex: string): Promise<string> {
  const plain = () => canvas.toDataURL('image/png');
  if (!compactSignatureSupported()) return plain();
  try {
    const white: RGB = [255, 255, 255];
    const stamp = mix(white, hexRgb(stampHex), 0.85);
    const url = await palettePng(canvas, [white, stamp, hexRgb(inkHex), mix(white, stamp, 0.5)]);
    const normal = plain();
    return dataUrlBytes(url) < dataUrlBytes(normal) ? url : normal;
  } catch {
    return plain();
  }
}

// Assinatura sem carimbo (preventiva e campo "assinatura" do modelo de OS): fundo transparente e o traço em 3 níveis
// de transparência (borda lisa)
export async function compactInkSignature(canvas: HTMLCanvasElement, inkHex: string): Promise<string> {
  const plain = () => canvas.toDataURL('image/png');
  if (!compactSignatureSupported()) return plain();
  try {
    const ink = hexRgb(inkHex);
    const url = await palettePng(canvas, [[0, 0, 0], ink, ink, ink], [0, 85, 170, 255]);
    const normal = plain();
    return dataUrlBytes(url) < dataUrlBytes(normal) ? url : normal;
  } catch {
    return plain();
  }
}
