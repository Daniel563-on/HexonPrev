import {
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  QueryDocumentSnapshot,
  runTransaction,
  startAfter,
  updateDoc,
  where
} from './guard';
import { MaterialRequest, MaterialRequestEvent, MaterialRequestItem, MaterialRequestStatus } from '../types';
import { firebaseActive, dbInstance, cleanUndefined, checkQuotaException } from './core';

// PEDIDOS DE MATERIAL DO MP (Fase 8B) — coleção "materialRequests" (id = número PM-AAAA-NNNN)
// e o contador do número por ano ("counters/materialRequests_AAAA").
// Fluxo: Pendente → Aprovado (almoxarifado, nº da RM e quantidade fornecida de cada item) → Atendido ("Retirei" do técnico)
//        Pendente → Reprovado (motivo) → o técnico toca em "Ciente" e o pedido sai da tela dele.
// Campos de controle (índices esparsos): techMr = matrícula enquanto o pedido aparece para o técnico;
// mrPend = gerência enquanto pendente (número do menu Solicitações).

export const MR_STATUS_LABEL: Record<MaterialRequestStatus, string> = {
  Pendente: 'Aguardando aprovação',
  Aprovado: 'Aguardando retirada',
  Reprovado: 'Reprovado',
  Atendido: 'Atendido'
};

export const formatMrNumber = (year: number, seq: number) => `PM-${year}-${String(seq).padStart(4, '0')}`;

const ev = (by: string, action: string, note?: string): MaterialRequestEvent => cleanUndefined({ at: new Date().toISOString(), by, action, note });

const fmtQty = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

export interface MaterialRequestDraft {
  unit: string;
  company: string;
  orderKind: 'preventiva' | 'os';
  orderId: string;
  orderLabel: string;
  techMatricula: string;
  techName: string;
  items: MaterialRequestItem[];
  note?: string;
}

// Envia o pedido: reserva o próximo número do ano e grava o pedido na mesma transação (precisa de internet)
export async function dbCreateMaterialRequest(draft: MaterialRequestDraft): Promise<MaterialRequest> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Sem internet: enviar o pedido precisa de conexão.');
  if (draft.items.length === 0) throw new Error('Adicione pelo menos um material.');
  const db = dbInstance;
  const year = new Date().getFullYear();
  const counterRef = doc(db, 'counters', `materialRequests_${year}`);
  try {
    return await runTransaction(db, async (tx) => {
      const counter = await tx.get(counterRef);
      const seq = (counter.exists() ? Number(counter.data().last) || 0 : 0) + 1;
      const number = formatMrNumber(year, seq);
      const now = new Date().toISOString();
      const req: MaterialRequest = {
        ...draft,
        note: draft.note?.trim() || undefined,
        id: number,
        number,
        year,
        seq,
        status: 'Pendente',
        createdAt: now,
        updatedAt: now,
        timeline: [ev(draft.techName, `Pedido enviado (${draft.items.length} ${draft.items.length === 1 ? 'item' : 'itens'})`)],
        techMr: draft.techMatricula,
        mrPend: draft.unit
      };
      tx.set(counterRef, { year, last: seq });
      tx.set(doc(db, 'materialRequests', number), cleanUndefined(req));
      return req;
    });
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}

// Pedidos do técnico que ainda aparecem para ele (tempo real; poucos registros)
export function subscribeMyMaterialRequests(matricula: string, onChange: (list: MaterialRequest[]) => void): () => void {
  if (!firebaseActive || !dbInstance || !matricula) {
    onChange([]);
    return () => {};
  }
  return onSnapshot(
    query(collection(dbInstance, 'materialRequests'), where('techMr', '==', matricula)),
    (snap) => onChange(snap.docs.map((d) => ({ ...(d.data() as MaterialRequest), id: d.id })).sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
    (err) => {
      console.warn('Não foi possível acompanhar os pedidos de material:', err);
      checkQuotaException(err);
      onChange([]);
    }
  );
}

// Pendentes das gerências (número do menu Solicitações; tempo real). units = gerências que a pessoa vê (máx. 30)
export function subscribePendingMaterialRequests(units: string[], onChange: (list: MaterialRequest[]) => void): () => void {
  if (!firebaseActive || !dbInstance || units.length === 0) {
    onChange([]);
    return () => {};
  }
  return onSnapshot(
    query(collection(dbInstance, 'materialRequests'), where('mrPend', 'in', units.slice(0, 30))),
    (snap) => onChange(snap.docs.map((d) => ({ ...(d.data() as MaterialRequest), id: d.id }))),
    (err) => {
      console.warn('Não foi possível acompanhar os pedidos pendentes:', err);
      checkQuotaException(err);
      onChange([]);
    }
  );
}

export const MR_PAGE_SIZE = 20;

// Lista do computador: uma gerência, uma situação (e empresa, se escolhida), mais novos primeiro, em páginas
export async function dbGetMaterialRequestsPage(
  unit: string,
  status: MaterialRequestStatus,
  company: string | null,
  cursor: QueryDocumentSnapshot | null
): Promise<{ items: MaterialRequest[]; cursor: QueryDocumentSnapshot | null; hasMore: boolean }> {
  if (!firebaseActive || !dbInstance || !unit) return { items: [], cursor: null, hasMore: false };
  try {
    const parts: any[] = [where('unit', '==', unit)];
    if (company) parts.push(where('company', '==', company));
    parts.push(where('status', '==', status), orderBy('createdAt', 'desc'));
    if (cursor) parts.push(startAfter(cursor));
    parts.push(limit(MR_PAGE_SIZE + 1));
    const snap = await getDocs(query(collection(dbInstance, 'materialRequests'), ...parts));
    const docs = snap.docs.slice(0, MR_PAGE_SIZE);
    return {
      items: docs.map((d) => ({ ...(d.data() as MaterialRequest), id: d.id })),
      cursor: docs.length ? docs[docs.length - 1] : null,
      hasMore: snap.docs.length > MR_PAGE_SIZE
    };
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}

// APROVAR: almoxarifado, nº da RM e quantidade fornecida de cada item (0 = não fornecido)
export async function dbApproveMaterialRequest(
  req: MaterialRequest,
  supplied: number[],
  warehouse: string,
  rm: string,
  by: { name: string; matricula: string }
): Promise<MaterialRequest> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const rmClean = String(rm || '').replace(/\D/g, '');
  if (!warehouse) throw new Error('Escolha o almoxarifado.');
  if (!rmClean) throw new Error('Informe o número da RM (só números).');
  if (supplied.length !== req.items.length || supplied.some((q) => !Number.isFinite(q) || q < 0)) throw new Error('Confira as quantidades fornecidas.');
  if (supplied.every((q) => q === 0)) throw new Error('Nenhum item fornecido: use "Reprovar" e informe o motivo.');
  const now = new Date().toISOString();
  const items = req.items.map((it, i) => ({ ...it, qtySupplied: supplied[i] }));
  const partial = items.filter((it) => (it.qtySupplied || 0) < it.qty).map((it) => `${it.code}: ${fmtQty(it.qtySupplied || 0)} de ${fmtQty(it.qty)}`);
  const decision = { by: by.name, byMatricula: by.matricula, at: now, warehouse, rm: rmClean };
  const event = ev(by.name, `Aprovado — ${warehouse}, RM ${rmClean}`, partial.length ? `Fornecido menos que o pedido: ${partial.join('; ')}` : undefined);
  await updateDoc(doc(dbInstance, 'materialRequests', req.id), {
    status: 'Aprovado',
    items: items.map((it) => cleanUndefined(it)),
    decision,
    mrPend: deleteField(),
    updatedAt: now,
    timeline: arrayUnion(event)
  });
  return { ...req, status: 'Aprovado', items, decision, mrPend: undefined, updatedAt: now, timeline: [...req.timeline, event] };
}

// REPROVAR: motivo obrigatório (ex.: "o técnico não irá mais precisar do material")
export async function dbRejectMaterialRequest(req: MaterialRequest, reason: string, by: { name: string; matricula: string }): Promise<MaterialRequest> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const text = reason.trim();
  if (text.length < 3) throw new Error('Informe o motivo da reprovação.');
  const now = new Date().toISOString();
  const decision = { by: by.name, byMatricula: by.matricula, at: now, reason: text };
  const event = ev(by.name, 'Reprovado', text);
  await updateDoc(doc(dbInstance, 'materialRequests', req.id), {
    status: 'Reprovado',
    decision,
    mrPend: deleteField(),
    updatedAt: now,
    timeline: arrayUnion(event)
  });
  return { ...req, status: 'Reprovado', decision, mrPend: undefined, updatedAt: now, timeline: [...req.timeline, event] };
}

// TÉCNICO: "Retirei" (aprovado → atendido; sai da tela dele)
export async function dbPickUpMaterialRequest(req: MaterialRequest, byName: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const now = new Date().toISOString();
  await updateDoc(doc(dbInstance, 'materialRequests', req.id), {
    status: 'Atendido',
    pickedUpAt: now,
    techMr: deleteField(),
    updatedAt: now,
    timeline: arrayUnion(ev(byName, 'Retirado pelo técnico'))
  });
}

// TÉCNICO: "Ciente" do reprovado (sai da tela dele)
export async function dbAckMaterialRequest(req: MaterialRequest, byName: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const now = new Date().toISOString();
  await updateDoc(doc(dbInstance, 'materialRequests', req.id), {
    ackAt: now,
    techMr: deleteField(),
    updatedAt: now,
    timeline: arrayUnion(ev(byName, 'Técnico ciente da reprovação'))
  });
}

export const formatQty = fmtQty;

// "1,5" ou "1.5" -> 1.5; "1.000,5" -> 1000.5 (vazio ou inválido = NaN). Teclado do celular pode ter só o ponto.
export const parseQty = (s: string): number => {
  const t = String(s ?? '').trim();
  if (!t) return NaN;
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
};
