import { useEffect, useState } from 'react';
import { deleteDoc, doc, getDoc, setDoc } from './guard';
import { firebaseActive, dbInstance, checkQuotaException } from './core';

// IDENTIDADE VISUAL (Configurações › Sistema, só o Super Administrador): o logo do sistema.
// Registro "appControl/branding" (todos leem, até a tela de login e as páginas públicas; só o Super Admin altera).
// O logo é guardado já reduzido (256 px, ~20 KB) e o ícone da aba (64 px). Sem logo cadastrado, as telas usam o "H" antigo.
// 1 leitura ao abrir o app; o aparelho guarda uma cópia para o logo aparecer na hora nas próximas aberturas.

export interface Branding {
  logo?: string;    // data:image/webp (ou png) 256×256
  favicon?: string; // data:image/png 64×64
  updatedAt?: string;
  updatedBy?: string;
}

const LOCAL_KEY = 'hexon_branding_v1';
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
    if (b.logo) localStorage.setItem(LOCAL_KEY, JSON.stringify(b));
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

// Para as telas: o logo atual (e atualiza quando o Super Admin troca)
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

export async function dbSaveBranding(logo: string, favicon: string, by: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const b: Branding = { logo, favicon, updatedAt: new Date().toISOString(), updatedBy: by };
  await setDoc(doc(dbInstance, 'appControl', 'branding'), b);
  publish(b);
}

// Volta ao "H" padrão
export async function dbClearBranding(): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  await deleteDoc(doc(dbInstance, 'appControl', 'branding'));
  publish({});
}

// Prepara a imagem escolhida: quadrada (sem cortar, centralizada, fundo transparente), 256 px e 64 px
export async function prepareBrandingImages(file: File): Promise<{ logo: string; favicon: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
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
  } finally {
    URL.revokeObjectURL(url);
  }
}
