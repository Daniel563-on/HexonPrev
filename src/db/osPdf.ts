import { deleteDoc, doc, getDoc, writeBatch } from './guard';
import { OsPdfLayout } from '../types';
import { firebaseActive, dbInstance, cleanUndefined, checkQuotaException } from './core';
import { idbGet, idbSet } from '../utils/idbCache';

// PDF MAPEADO DA OS (Fase 5C): um PDF oficial por modelo de OS.
// "osPdfLayouts/{modelo}" guarda as caixas (leve); "osPdfFiles/{modelo}" guarda o PDF em base64 (até ~1 MB no banco).
// O PDF fica copiado no aparelho pela versão: só é lido do banco quando muda.

export const OS_PDF_MAX_BYTES = 740 * 1024; // PDF original (em base64 fica ~1/3 maior; o registro do banco aceita ~1 MB)

const cacheKey = (templateId: string, version: number) => `hexon_os_pdf_${templateId}_v${version}`;

export async function dbGetOsPdfLayout(templateId: string): Promise<OsPdfLayout | null> {
  if (!firebaseActive || !dbInstance || !templateId) return null;
  try {
    const snap = await getDoc(doc(dbInstance, 'osPdfLayouts', templateId));
    return snap.exists() ? (snap.data() as OsPdfLayout) : null;
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}

// PDF original (base64, sem o prefixo "data:")
export async function dbGetOsPdfFile(layout: OsPdfLayout): Promise<string | null> {
  if (!firebaseActive || !dbInstance) return null;
  const key = cacheKey(layout.templateId, layout.version);
  const cached = await idbGet<string>(key).catch(() => null);
  if (cached) return cached;
  try {
    const snap = await getDoc(doc(dbInstance, 'osPdfFiles', layout.templateId));
    if (!snap.exists()) return null;
    const data = snap.data() as { pdfBase64: string; version: number };
    if (data.version === layout.version) idbSet(key, data.pdfBase64).catch(() => {});
    return data.pdfBase64 || null;
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}

// Salva as caixas; com "pdfBase64" troca também o PDF (a versão sobe)
export async function dbSaveOsPdfLayout(layout: OsPdfLayout, by: string, pdfBase64?: string): Promise<OsPdfLayout> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const saved: OsPdfLayout = { ...layout, version: pdfBase64 ? (layout.version || 0) + 1 : layout.version, updatedAt: new Date().toISOString(), updatedBy: by };
  const batch = writeBatch(dbInstance);
  batch.set(doc(dbInstance, 'osPdfLayouts', layout.templateId), cleanUndefined(saved));
  if (pdfBase64) batch.set(doc(dbInstance, 'osPdfFiles', layout.templateId), { templateId: layout.templateId, pdfBase64, version: saved.version });
  await batch.commit();
  if (pdfBase64) idbSet(cacheKey(saved.templateId, saved.version), pdfBase64).catch(() => {});
  return saved;
}

export async function dbDeleteOsPdfLayout(templateId: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  await deleteDoc(doc(dbInstance, 'osPdfLayouts', templateId));
  await deleteDoc(doc(dbInstance, 'osPdfFiles', templateId));
}
