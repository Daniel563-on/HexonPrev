import * as pdfjsLib from 'pdfjs-dist';

// Compatibilidade: o pdfjs novo usa Map/WeakMap.getOrInsertComputed, que navegadores um pouco mais antigos
// (e o Safari do iPhone) ainda não têm. Sem isto, desenhar o PDF na tela dá erro.
for (const C of [Map, WeakMap] as any[]) {
  if (!C.prototype.getOrInsertComputed)
    Object.defineProperty(C.prototype, 'getOrInsertComputed', {
      configurable: true,
      writable: true,
      value(this: any, key: any, fn: (k: any) => any) {
        if (this.has(key)) return this.get(key);
        const v = fn(key);
        this.set(key, v);
        return v;
      }
    });
  if (!C.prototype.getOrInsert)
    Object.defineProperty(C.prototype, 'getOrInsert', {
      configurable: true,
      writable: true,
      value(this: any, key: any, v: any) {
        if (!this.has(key)) this.set(key, v);
        return this.get(key);
      }
    });
}
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

// Configure pdfjs worker to use CDN or bundled worker
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version || '4.10.38'}/pdf.worker.min.mjs`;
}

export { pdfjsLib, PDFDocument, rgb, StandardFonts };
