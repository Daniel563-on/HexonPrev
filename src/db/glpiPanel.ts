import { Bytes, doc, getDoc, getDocFromCache, runBulk, setDoc, writeBatch } from './guard';
import { GlpiPanelHead } from '../types';
import { firebaseActive, dbInstance, checkQuotaException } from './core';

// HISTÓRICO GLPI (Fase 9B): o painel do mês (HTML feito por fora) fica compactado (gzip) em pedaços de até 700 KB
// em glpiPanelChunks/{versão}_{n}; glpiPanel/current diz qual versão está valendo. Cada aparelho baixa os pedaços
// uma vez por versão (depois vêm da cópia do aparelho). Enviar um painel novo apaga os pedaços do anterior.

const CHUNK = 700 * 1024;
export const GLPI_MAX_BYTES = 30 * 1024 * 1024;

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzipText(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

// Qual painel está valendo (1 leitura)
export async function dbGetGlpiPanelHead(): Promise<GlpiPanelHead | null> {
  if (!firebaseActive || !dbInstance) return null;
  try {
    const snap = await getDoc(doc(dbInstance, 'glpiPanel', 'current'));
    return snap.exists() ? (snap.data() as GlpiPanelHead) : null;
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}

// Monta o HTML do painel: pedaços da cópia do aparelho; os que faltam vêm do banco
export async function dbLoadGlpiPanelHtml(head: GlpiPanelHead): Promise<string> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const parts = await Promise.all(
    Array.from({ length: head.chunks }, async (_, n) => {
      const ref = doc(dbInstance!, 'glpiPanelChunks', `${head.version}_${n}`);
      let snap = await getDocFromCache(ref).catch(() => null);
      if (!snap?.exists()) snap = await getDoc(ref);
      if (!snap.exists()) throw new Error('o painel está incompleto no banco; envie o arquivo de novo');
      return (snap.data().data as Bytes).toUint8Array();
    })
  ).catch((err) => {
    checkQuotaException(err);
    throw err;
  });
  const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  parts.forEach((p) => {
    all.set(p, at);
    at += p.length;
  });
  return gunzipText(all);
}

// Envia o painel novo: grava os pedaços, troca o "valendo" e apaga os pedaços do anterior
export async function dbUploadGlpiPanel(file: File, by: { matricula: string; name: string }, onProgress?: (done: number, total: number) => void): Promise<GlpiPanelHead> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  if (!/\.html?$/i.test(file.name)) throw new Error('escolha o arquivo do painel em HTML (.html)');
  if (file.size > GLPI_MAX_BYTES) throw new Error('o arquivo passa de 30 MB');
  const gz = await gzip(new Uint8Array(await file.arrayBuffer()));
  const version = `v${Date.now()}`;
  const total = Math.max(1, Math.ceil(gz.length / CHUNK));
  const head: GlpiPanelHead = {
    version,
    fileName: file.name,
    size: file.size,
    chunks: total,
    uploadedAt: new Date().toISOString(),
    uploadedBy: by
  };
  return runBulk(async () => {
    const before = await dbGetGlpiPanelHead().catch(() => null);
    for (let n = 0; n < total; n++) {
      onProgress?.(n, total);
      await setDoc(doc(dbInstance!, 'glpiPanelChunks', `${version}_${n}`), {
        data: Bytes.fromUint8Array(gz.slice(n * CHUNK, (n + 1) * CHUNK)),
        version,
        n
      });
    }
    await setDoc(doc(dbInstance!, 'glpiPanel', 'current'), head);
    onProgress?.(total, total);
    if (before && before.version !== version) {
      const batch = writeBatch(dbInstance!);
      for (let n = 0; n < before.chunks; n++) batch.delete(doc(dbInstance!, 'glpiPanelChunks', `${before.version}_${n}`));
      await batch.commit().catch((err) => console.warn('Pedaços do painel anterior ficaram no banco:', err));
    }
    return head;
  });
}
