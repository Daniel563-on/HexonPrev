// ENTREGA DE ARQUIVOS (PDF, planilha, ZIP) — P39.
// No iPhone, baixar por link abre o arquivo na mesma tela: a página "sai" e o banco do Firebase se desliga até recarregar.
// No celular, então, o arquivo não é baixado por link: aparece o aviso "PDF pronto" (PdfReadySheet) e o toque em
// "Abrir / compartilhar" abre o menu de compartilhar do celular, sem o app sair da tela. No computador, baixa como antes.

export interface ReadyFile {
  file: File;
  url: string;
}

const listeners = new Set<(f: ReadyFile) => void>();
export function onReadyFile(cb: (f: ReadyFile) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function isPhoneOrTablet(): boolean {
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod|Android/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function deliverFile(blob: Blob, fileName: string): void {
  if (isPhoneOrTablet() && listeners.size > 0) {
    const file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
    const ready = { file, url: URL.createObjectURL(file) };
    listeners.forEach((cb) => cb(ready));
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}

export function deliverBytes(bytes: Uint8Array, fileName: string, mime = 'application/pdf'): void {
  deliverFile(new Blob([bytes], { type: mime }), fileName);
}

// Toque em "Abrir / compartilhar" (chamado direto no toque): menu de compartilhar; sem ele, abre em outra aba.
// false = a pessoa fechou o menu sem escolher
export async function openReadyFile(r: ReadyFile): Promise<boolean> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [r.file] })) {
    try {
      await nav.share({ files: [r.file] });
      return true;
    } catch (err: any) {
      if (err?.name === 'AbortError') return false;
    }
  }
  if (!window.open(r.url, '_blank')) throw new Error('o celular bloqueou a abertura do arquivo');
  return true;
}
