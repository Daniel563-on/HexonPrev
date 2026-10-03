import { collection, getDocs, limit, orderBy, query, QueryDocumentSnapshot, startAfter, where } from './guard';
import { MaintenanceLog } from '../types';
import { firebaseActive, dbInstance, checkQuotaException, ensureFirebaseAuthReady } from './core';
import { isMockOrLegacyId } from './templates';
import { sanitizePublicLog } from '../utils/lgpdUtils';

// HISTÓRICO DO ATIVO EM PÁGINAS (12 por vez, do mais recente para o mais antigo)
// Busca 13 para saber se existe próxima página. Usa o índice histories: assetId + date (decrescente).
// As regras do banco só deixam quem não é da equipe (QR público) buscar no máximo 13 por vez.

export const HISTORY_PAGE_SIZE = 12;

export interface HistoryPage {
  items: MaintenanceLog[];
  cursor: QueryDocumentSnapshot | null; // último registro da página (para buscar a próxima)
  hasMore: boolean;
}

export async function dbGetAssetHistoryPage(
  assetId: string,
  after: QueryDocumentSnapshot | null,
  publicView = false
): Promise<HistoryPage> {
  if (!assetId || !firebaseActive || !dbInstance) return { items: [], cursor: null, hasMore: false };
  try {
    if (publicView) await ensureFirebaseAuthReady(1500);
    const parts: any[] = [where('assetId', '==', assetId), orderBy('date', 'desc')];
    if (after) parts.push(startAfter(after));
    parts.push(limit(HISTORY_PAGE_SIZE + 1));
    const snap = await getDocs(query(collection(dbInstance, 'histories'), ...parts));
    const docs = snap.docs.filter((d) => !isMockOrLegacyId(d.id));
    const pageDocs = snap.docs.slice(0, HISTORY_PAGE_SIZE);
    const hasMore = snap.docs.length > HISTORY_PAGE_SIZE;
    // Uma entrada por OS (a mais recente) dentro da página
    const seen = new Set<string>();
    const items: MaintenanceLog[] = [];
    for (const d of docs.slice(0, HISTORY_PAGE_SIZE)) {
      const log = { id: d.id, ...d.data() } as MaintenanceLog;
      const key = log.osId ? `os_${log.osId}` : log.id;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(publicView ? sanitizePublicLog(log) : log);
    }
    return { items, cursor: pageDocs[pageDocs.length - 1] || null, hasMore };
  } catch (err: any) {
    console.warn('Falha ao buscar o histórico do ativo:', err);
    checkQuotaException(err);
    throw err;
  }
}
