import { runBulk } from './guard';
import { arrayUnion, collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from './guard';
import { firebaseActive, dbInstance, checkQuotaException } from './core';
import { timelineEvent } from './executionTeam';

// TROCA DE EMPRESA DO ATIVO / ENDEREÇO (etapa especial E3): as preventivas e vistorias dele ainda "Novo"
// (não programadas) passam para a empresa nova; as programadas ou em execução ficam com a antiga até terminar.
// Lê uma vez as OS abertas da gerência (campo de controle unitOpen) — só acontece quando há troca, que é rara.
// Operação em massa: roda liberada do disjuntor (src/db/guard.ts)
export function dbMoveNewOrdersToCompany(...args: Parameters<typeof dbMoveNewOrdersNow>): ReturnType<typeof dbMoveNewOrdersNow> {
  return runBulk(() => dbMoveNewOrdersNow(...args));
}

async function dbMoveNewOrdersNow(
  unit: string,
  field: 'assetId' | 'addressId',
  moves: { id: string; company: string }[], // ativo/endereço -> empresa nova
  companyLabel: (id: string) => string,
  by: string
): Promise<number> {
  if (!firebaseActive || !dbInstance || !unit || moves.length === 0) return 0;
  const db = dbInstance;
  const target = new Map(moves.map((m) => [m.id, m.company]));
  try {
    const snap = await getDocs(query(collection(db, 'serviceOrders'), where('unitOpen', '==', unit)));
    const toMove = snap.docs.filter((d) => {
      const o = d.data() as any;
      const to = target.get(String(o[field] || ''));
      return o.status === 'Novo' && !!to && o.company !== to;
    });
    const now = new Date().toISOString();
    for (let i = 0; i < toMove.length; i += 400) {
      const batch = writeBatch(db);
      toMove.slice(i, i + 400).forEach((d) => {
        const o = d.data() as any;
        const to = target.get(String(o[field]))!;
        batch.update(doc(db, 'serviceOrders', d.id), {
          company: to,
          updatedAt: now,
          syncAt: serverTimestamp(),
          timeline: arrayUnion(
            timelineEvent('Empresa alterada', by, `${o.company ? companyLabel(o.company) : 'sem empresa'} → ${companyLabel(to)} (o ${field === 'assetId' ? 'ativo' : 'endereço'} mudou de empresa)`)
          )
        });
      });
      await batch.commit();
    }
    return toMove.length;
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}
