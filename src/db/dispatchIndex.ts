import { arrayRemove, arrayUnion, collection, doc, getDocs, query, setDoc, where, WriteBatch } from 'firebase/firestore';
import { firebaseActive, dbInstance, checkQuotaException } from './core';

// REGISTRO DO DISPARO ("dispatchIndex")
// Guarda os números das OS já disparadas, agrupados por periodicidade + início do período.
// Como o número da OS é fixo (ativo + periodicidade + período), a tela de disparo e o motor
// conferem "já programada" lendo poucos documentos pequenos, sem baixar as ordens.
// Cada período é dividido em 8 partes para nenhum documento chegar perto do limite de 1 MB.
const SHARDS = 8;

export interface DispatchIndexKey {
  docId: string;     // ex.: "MEN_20261001_3"
  code: string;      // ex.: "MEN"
  startDate: string; // ex.: "2026-10-01"
}

// Extrai periodicidade e início do período do número da OS ("...-MEN-20261001").
// Números em outro formato (antigos, manuais, corretivas) não entram no registro.
export function dispatchIndexKey(orderId: string): DispatchIndexKey | null {
  const match = /-([A-Z]{2,4})-(\d{4})(\d{2})(\d{2})$/.exec(orderId || '');
  if (!match) return null;
  const [, code, y, m, d] = match;
  let hash = 0;
  for (let i = 0; i < orderId.length; i++) hash = (hash * 31 + orderId.charCodeAt(i)) >>> 0;
  return { docId: `${code}_${y}${m}${d}_${hash % SHARDS}`, code, startDate: `${y}-${m}-${d}` };
}

// Agrupa números de OS pelo documento do registro onde devem ficar
function groupByIndexDoc(orderIds: string[]): Map<string, { key: DispatchIndexKey; ids: string[] }> {
  const groups = new Map<string, { key: DispatchIndexKey; ids: string[] }>();
  for (const id of orderIds) {
    const key = dispatchIndexKey(id);
    if (!key) continue;
    const group = groups.get(key.docId) || { key, ids: [] };
    group.ids.push(id);
    groups.set(key.docId, group);
  }
  return groups;
}

// Inclui no lote de gravação o registro das OS disparadas (gravado junto com as OS)
export function addToDispatchIndexInBatch(batch: WriteBatch, orderIds: string[]): void {
  if (!dbInstance) return;
  for (const { key, ids } of groupByIndexDoc(orderIds).values()) {
    batch.set(
      doc(dbInstance, 'dispatchIndex', key.docId),
      { code: key.code, startDate: key.startDate, ids: arrayUnion(...ids) },
      { merge: true }
    );
  }
}

// Números já disparados para os inícios de período informados (poucas leituras)
export async function dbGetDispatchedIds(startDates: string[]): Promise<Set<string>> {
  const result = new Set<string>();
  const unique = Array.from(new Set(startDates.filter(Boolean)));
  if (!firebaseActive || !dbInstance || unique.length === 0) return result;
  try {
    for (let i = 0; i < unique.length; i += 30) {
      const snap = await getDocs(
        query(collection(dbInstance, 'dispatchIndex'), where('startDate', 'in', unique.slice(i, i + 30)))
      );
      snap.forEach((d) => {
        const ids = (d.data().ids || []) as string[];
        ids.forEach((id) => result.add(id));
      });
    }
  } catch (err: any) {
    console.warn('Firestore fetch dispatch index failed:', err);
    checkQuotaException(err);
  }
  return result;
}

// Ao excluir uma OS disparada, ela sai do registro (assim pode ser disparada de novo)
export async function dbRemoveFromDispatchIndex(orderId: string): Promise<void> {
  const key = dispatchIndexKey(orderId);
  if (!key || !firebaseActive || !dbInstance) return;
  try {
    await setDoc(
      doc(dbInstance, 'dispatchIndex', key.docId),
      { code: key.code, startDate: key.startDate, ids: arrayRemove(orderId) },
      { merge: true }
    );
  } catch (err: any) {
    console.warn('Firestore update dispatch index failed:', err);
  }
}
