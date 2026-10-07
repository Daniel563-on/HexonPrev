import { useEffect, useState } from 'react';
import { deleteDoc, deleteField, doc, getDoc, setDoc } from './guard';
import { firebaseActive, dbInstance, checkQuotaException } from './core';

// IDENTIDADE VISUAL (Configurações › Sistema, só o Super Administrador): logo, frases e fundos da tela de login.
// Registro "appControl/branding" (todos leem, até a tela de login e as páginas públicas; só o Super Admin altera).
// O logo é guardado já reduzido (256 px, ~20 KB) e o ícone da aba (64 px). Sem logo cadastrado, as telas usam o "H" antigo.
// 1 leitura ao abrir o app; o aparelho guarda uma cópia para o logo aparecer na hora nas próximas aberturas.
// Fundos do login (computador e celular) ficam em registros separados ("appControl/loginBg_desktop" e "_mobile"), porque são
// maiores (até ~900 KB): o aparelho guarda uma cópia e só baixa de novo quando o fundo é trocado (data em bgDesktopAt/bgMobileAt).

export interface Branding {
  logo?: string;    // data:image/webp (ou png) 256×256
  favicon?: string; // data:image/png 64×64
  tagline?: string; // frase abaixo do nome no login (Enter = quebra de linha; vazio = sem frase; sem campo = frase padrão)
  topText?: string; // texto do canto superior do login no computador (mesma regra)
  bgDesktopAt?: string; // data do fundo do login para computador (sem campo = fundo desenhado)
  bgMobileAt?: string;  // data do fundo do login para celular
  updatedAt?: string;
  updatedBy?: string;
}

export type LoginBgKind = 'desktop' | 'mobile';

export const DEFAULT_TAGLINE = 'MANUTENÇÃO INTELIGENTE\nPARA UM FUTURO MAIS EFICIENTE';
export const DEFAULT_TOP_TEXT = 'TECNOLOGIA + GESTÃO + RESULTADOS';
export const brandTagline = (b: Branding): string => (b.tagline === undefined ? DEFAULT_TAGLINE : b.tagline);
export const brandTopText = (b: Branding): string => (b.topText === undefined ? DEFAULT_TOP_TEXT : b.topText);

const LOCAL_KEY = 'hexon_branding_v1';
const BG_KEY = (kind: LoginBgKind) => `hexon_login_bg_${kind}_v1`;
const BG_DOC = (kind: LoginBgKind) => `loginBg_${kind}`;

let current: Branding = (() => {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}') as Branding;
  } catch {
    return {};
  }
})();
const listeners = new Set<(b: Branding) => void>();
let loading: Promise<void> | null = null;

function publish(b: Branding): void {
  current = b;
  try {
    if (Object.keys(b).length) localStorage.setItem(LOCAL_KEY, JSON.stringify(b));
    else localStorage.removeItem(LOCAL_KEY);
  } catch {
    /* sem armazenamento: só não guarda a cópia */
  }
  applyFavicon(b.favicon);
  listeners.forEach((l) => l(current));
}

// Ícone da aba do navegador
function applyFavicon(href?: string): void {
  if (typeof document === 'undefined') return;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!href) {
    link?.remove();
    return;
  }
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = 'image/png';
  link.href = href;
}

// Ícone da aba já ao abrir (cópia guardada no aparelho)
applyFavicon(current.favicon);

export function loadBranding(force = false): Promise<void> {
  if (loading && !force) return loading;
  if (!firebaseActive || !dbInstance) return Promise.resolve();
  const db = dbInstance;
  loading = getDoc(doc(db, 'appControl', 'branding'))
    .then((snap) => publish(snap.exists() ? (snap.data() as Branding) : {}))
    .catch((err) => {
      checkQuotaException(err);
      loading = null; // tenta de novo na próxima vez
    });
  return loading;
}

export const getBranding = (): Branding => current;

// Para as telas: a identidade atual (e atualiza quando o Super Admin troca)
export function useBranding(): Branding {
  const [b, setB] = useState<Branding>(current);
  useEffect(() => {
    listeners.add(setB);
    setB(current);
    loadBranding();
    applyFavicon(current.favicon);
    return () => {
      listeners.delete(setB);
    };
  }, []);
  return b;
}

// Grava só os campos informados (null = apaga o campo) e atualiza as telas na hora
async function saveFields(fields: Record<string, string | null>, by: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const now = new Date().toISOString();
  const data: Record<string, any> = { updatedAt: now, updatedBy: by };
  const next: any = { ...current, updatedAt: now, updatedBy: by };
  Object.entries(fields).forEach(([k, v]) => {
    data[k] = v === null ? deleteField() : v;
    if (v === null) delete next[k];
    else next[k] = v;
  });
  await setDoc(doc(dbInstance, 'appControl', 'branding'), data, { merge: true });
  publish(next);
}

export function dbSaveBranding(logo: string, favicon: string, by: string): Promise<void> {
  return saveFields({ logo, favicon }, by);
}

// Volta ao "H" padrão (frases e fundos continuam)
export function dbClearBranding(by: string): Promise<void> {
  return saveFields({ logo: null, favicon: null }, by);
}

// Frases do login: texto (vazio = sem frase) ou null = volta à frase padrão
export function dbSaveBrandingTexts(tagline: string | null, topText: string | null, by: string): Promise<void> {
  return saveFields({ tagline, topText }, by);
}

// ---------- Fundos da tela de login ----------

function readBgCache(kind: LoginBgKind): { at: string; image: string } | null {
  try {
    return JSON.parse(localStorage.getItem(BG_KEY(kind)) || 'null');
  } catch {
    return null;
  }
}

function writeBgCache(kind: LoginBgKind, at: string | null, image?: string): void {
  try {
    if (at && image) localStorage.setItem(BG_KEY(kind), JSON.stringify({ at, image }));
    else localStorage.removeItem(BG_KEY(kind));
  } catch {
    /* imagem grande demais para o armazenamento do aparelho: só baixa de novo na próxima vez */
  }
}

// Fundo atual (cópia do aparelho; baixa do banco só quando o fundo mudou). null = sem fundo (usa o desenhado)
export async function loadLoginBackground(kind: LoginBgKind, b: Branding, cacheOnly = false): Promise<string | null> {
  const at = kind === 'desktop' ? b.bgDesktopAt : b.bgMobileAt;
  if (!at) {
    writeBgCache(kind, null);
    return null;
  }
  const cached = readBgCache(kind);
  if (cached?.at === at) return cached.image;
  if (cacheOnly || !firebaseActive || !dbInstance) return cached?.image || null;
  try {
    const snap = await getDoc(doc(dbInstance, 'appControl', BG_DOC(kind)));
    const image = snap.exists() ? String((snap.data() as any).image || '') : '';
    if (!image) return null;
    writeBgCache(kind, at, image);
    return image;
  } catch (err) {
    checkQuotaException(err);
    return cached?.image || null;
  }
}

// Para a tela: o fundo certo para o tamanho da tela (se só um foi enviado, serve para os dois)
export function useLoginBackground(cacheOnly = false): string | null {
  const b = useBranding();
  const [image, setImage] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const wide = typeof window !== 'undefined' && window.innerWidth >= 768;
    const first: LoginBgKind = wide ? 'desktop' : 'mobile';
    const second: LoginBgKind = wide ? 'mobile' : 'desktop';
    (async () => {
      const img = (await loadLoginBackground(first, b, cacheOnly)) || (await loadLoginBackground(second, b, cacheOnly));
      if (alive) setImage(img);
    })();
    return () => {
      alive = false;
    };
  }, [b.bgDesktopAt, b.bgMobileAt, cacheOnly]);
  return image;
}

export async function dbSaveLoginBackground(kind: LoginBgKind, image: string, by: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const now = new Date().toISOString();
  await setDoc(doc(dbInstance, 'appControl', BG_DOC(kind)), { image, updatedAt: now, updatedBy: by });
  writeBgCache(kind, now, image);
  await saveFields({ [kind === 'desktop' ? 'bgDesktopAt' : 'bgMobileAt']: now }, by);
}

export async function dbClearLoginBackground(kind: LoginBgKind, by: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  await deleteDoc(doc(dbInstance, 'appControl', BG_DOC(kind)));
  writeBgCache(kind, null);
  await saveFields({ [kind === 'desktop' ? 'bgDesktopAt' : 'bgMobileAt']: null }, by);
}

// ---------- Preparo das imagens (no navegador, antes de gravar) ----------

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return img;
}

// Logo: quadrado (sem cortar, centralizado, fundo transparente), 256 px e 64 px
export async function prepareBrandingImages(file: File): Promise<{ logo: string; favicon: string }> {
  const img = await loadImage(file);
  const draw = (size: number, type: string, quality?: number) => {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    const iw = img.naturalWidth || size; // SVG sem tamanho definido
    const ih = img.naturalHeight || size;
    const scale = Math.min(size / iw, size / ih);
    const w = iw * scale;
    const h = ih * scale;
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    return c.toDataURL(type, quality);
  };
  let logo = draw(256, 'image/webp', 0.9);
  if (!logo.startsWith('data:image/webp')) logo = draw(256, 'image/png'); // navegador sem webp
  return { logo, favicon: draw(64, 'image/png') };
}

// Fundo do login: reduzido (computador até 1920×1200, celular até 1080×1920), sem cortar, até ~900 KB
export async function prepareLoginBackground(file: File, kind: LoginBgKind): Promise<string> {
  const img = await loadImage(file);
  const maxW = kind === 'desktop' ? 1920 : 1080;
  const maxH = kind === 'desktop' ? 1200 : 1920;
  const iw = img.naturalWidth || maxW;
  const ih = img.naturalHeight || maxH;
  const LIMIT = 900_000;
  let scale = Math.min(1, maxW / iw, maxH / ih);
  for (let attempt = 0; attempt < 6; attempt++) {
    const c = document.createElement('canvas');
    c.width = Math.round(iw * scale);
    c.height = Math.round(ih * scale);
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    for (const q of [0.82, 0.7, 0.58]) {
      let data = c.toDataURL('image/webp', q);
      if (!data.startsWith('data:image/webp')) data = c.toDataURL('image/jpeg', q); // navegador sem webp
      if (data.length <= LIMIT) return data;
    }
    scale *= 0.8;
  }
  throw new Error('Imagem muito pesada mesmo reduzida. Tente uma imagem mais simples ou menor.');
}
