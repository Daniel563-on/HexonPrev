import {
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  QueryDocumentSnapshot,
  runTransaction,
  startAfter,
  updateDoc,
  where,
  writeBatch
} from './guard';
import { MaterialRequestEvent, OrderSupplies, SupplyOsEntry, SupplyRequest, SupplyRequestItem, SupplyRequestStatus } from '../types';
import { firebaseActive, dbInstance, cleanUndefined, checkQuotaException } from './core';
import { clearSupplyBalancesCache, round3 } from './supplies';

// PEDIDOS DE INSUMOS (Fase 8C-2) — coleção "supplyRequests" (id = número PI-AAAA-NNNN)
// e o contador do número por ano ("counters/supplyRequests_AAAA").
// Fluxo: Pendente (aguarda o administrativo) → Confirmado (aguarda o almoxarifado) → Fornecido (aguarda o técnico)
//        → Recebido: os insumos fornecidos entram na OS (registro "orderSupplies/{id da OS}", no mesmo pacote).
//        O administrativo (Pendente) ou o almoxarifado (Confirmado) podem reprovar com motivo → o técnico toca em "Ciente".
// Lote 3 (contrato de insumos da empresa, src/db/supplies.ts): o administrativo APROVA vendo o saldo e pode diminuir a
// quantidade de cada item (qtyApproved) — o aprovado fica reservado no saldo; o almoxarifado fornece exatamente o
// aprovado (abate do saldo) ou recusa (a reserva volta ao saldo). Tudo em transação (dois ao mesmo tempo não passam do saldo).
// Campos de controle (índices esparsos): techSr = matrícula enquanto aparece para o técnico;
// srConf = gerência enquanto aguarda a confirmação; srStore = gerência enquanto aguarda o almoxarifado.

export const SR_STATUS_LABEL: Record<SupplyRequestStatus, string> = {
  Pendente: 'Aguardando aprovação',
  Confirmado: 'Aguardando almoxarifado',
  Fornecido: 'Aguardando recebimento',
  Recebido: 'Recebido (na OS)',
  Reprovado: 'Reprovado'
};

// Pedido ainda aberto (a OS não pode ser concluída enquanto houver)
export const SR_OPEN: SupplyRequestStatus[] = ['Pendente', 'Confirmado', 'Fornecido'];

export const formatSrNumber = (year: number, seq: number) => `PI-${year}-${String(seq).padStart(4, '0')}`;

const ev = (by: string, action: string, note?: string): MaterialRequestEvent => cleanUndefined({ at: new Date().toISOString(), by, action, note });
const fmtQty = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');
type Who = { name: string; matricula: string };

export interface SupplyRequestDraft {
  unit: string;
  company: string;
  orderKind: 'preventiva' | 'os';
  orderId: string;
  orderLabel: string;
  glpi: string;
  techMatricula: string;
  techName: string;
  items: SupplyRequestItem[];
  note?: string;
}

// Envia o pedido: reserva o próximo número do ano e grava o pedido na mesma transação (precisa de internet)
export async function dbCreateSupplyRequest(draft: SupplyRequestDraft): Promise<SupplyRequest> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Sem internet: enviar o pedido precisa de conexão.');
  if (draft.items.length === 0) throw new Error('Adicione pelo menos um insumo.');
  const glpi = String(draft.glpi || '').replace(/\D/g, '');
  if (!glpi) throw new Error('Informe o número do GLPI (só números).');
  const db = dbInstance;
  const year = new Date().getFullYear();
  const counterRef = doc(db, 'counters', `supplyRequests_${year}`);
  try {
    return await runTransaction(db, async (tx) => {
      const counter = await tx.get(counterRef);
      const seq = (counter.exists() ? Number(counter.data().last) || 0 : 0) + 1;
      const number = formatSrNumber(year, seq);
      const now = new Date().toISOString();
      const req: SupplyRequest = {
        ...draft,
        glpi,
        note: draft.note?.trim() || undefined,
        id: number,
        number,
        year,
        seq,
        status: 'Pendente',
        createdAt: now,
        updatedAt: now,
        timeline: [ev(draft.techName, `Pedido enviado (${draft.items.length} ${draft.items.length === 1 ? 'item' : 'itens'}) · GLPI ${glpi}`)],
        techSr: draft.techMatricula,
        srConf: draft.unit
      };
      tx.set(counterRef, { year, last: seq });
      tx.set(doc(db, 'supplyRequests', number), cleanUndefined(req));
      return req;
    });
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}

// Últimos pedidos do técnico (da escuta abaixo): usados para travar a conclusão da OS com pedido em aberto
let mineLatest: SupplyRequest[] = [];
export const openSupplyRequestsFor = (orderId: string): SupplyRequest[] =>
  mineLatest.filter((r) => r.orderId === orderId && SR_OPEN.includes(r.status));
// Texto do aviso que trava a conclusão (null = pode concluir)
export function supplyBlockMessage(orderId: string): string | null {
  const open = openSupplyRequestsFor(orderId);
  if (open.length === 0) return null;
  const list = open.map((r) => `${r.number} (${SR_STATUS_LABEL[r.status].toLowerCase()})`).join(', ');
  return `Esta OS tem ${open.length === 1 ? '1 pedido' : `${open.length} pedidos`} de insumos em aberto: ${list}. Toque em "Recebi" quando receber, ou peça ao administrativo para reprovar, antes de concluir.`;
}

const mapDocs = (snap: { docs: QueryDocumentSnapshot[] }) => snap.docs.map((d) => ({ ...(d.data() as SupplyRequest), id: d.id }));

// Pedidos do técnico que ainda aparecem para ele (tempo real; poucos registros)
export function subscribeMySupplyRequests(matricula: string, onChange: (list: SupplyRequest[]) => void): () => void {
  if (!firebaseActive || !dbInstance || !matricula) {
    mineLatest = [];
    onChange([]);
    return () => {};
  }
  const stop = onSnapshot(
    query(collection(dbInstance, 'supplyRequests'), where('techSr', '==', matricula)),
    (snap) => {
      mineLatest = mapDocs(snap).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      onChange(mineLatest);
    },
    (err) => {
      console.warn('Não foi possível acompanhar os pedidos de insumos:', err);
      checkQuotaException(err);
      onChange(mineLatest);
    }
  );
  return () => {
    stop();
    mineLatest = [];
  };
}

// Aguardando o administrativo (Solicitações) ou o almoxarifado, das gerências que a pessoa vê (máx. 30; tempo real)
function subscribeByControl(field: 'srConf' | 'srStore', units: string[], onChange: (list: SupplyRequest[]) => void): () => void {
  if (!firebaseActive || !dbInstance || units.length === 0) {
    onChange([]);
    return () => {};
  }
  return onSnapshot(
    query(collection(dbInstance, 'supplyRequests'), where(field, 'in', units.slice(0, 30))),
    (snap) => onChange(mapDocs(snap).sort((a, b) => a.createdAt.localeCompare(b.createdAt))),
    (err) => {
      console.warn('Não foi possível acompanhar os pedidos de insumos:', err);
      checkQuotaException(err);
      onChange([]);
    }
  );
}
export const subscribeSupplyAwaitingConfirm = (units: string[], cb: (l: SupplyRequest[]) => void) => subscribeByControl('srConf', units, cb);
export const subscribeSupplyAwaitingStore = (units: string[], cb: (l: SupplyRequest[]) => void) => subscribeByControl('srStore', units, cb);

export const SR_PAGE_SIZE = 20;

// Listas do computador: uma gerência, uma situação (e empresa, se escolhida), mais novos primeiro, em páginas
export async function dbGetSupplyRequestsPage(
  unit: string,
  status: SupplyRequestStatus,
  company: string | null,
  cursor: QueryDocumentSnapshot | null
): Promise<{ items: SupplyRequest[]; cursor: QueryDocumentSnapshot | null; hasMore: boolean }> {
  if (!firebaseActive || !dbInstance || !unit) return { items: [], cursor: null, hasMore: false };
  try {
    const parts: any[] = [where('unit', '==', unit)];
    if (company) parts.push(where('company', '==', company));
    parts.push(where('status', '==', status), orderBy('createdAt', 'desc'));
    if (cursor) parts.push(startAfter(cursor));
    parts.push(limit(SR_PAGE_SIZE + 1));
    const snap = await getDocs(query(collection(dbInstance, 'supplyRequests'), ...parts));
    const docs = snap.docs.slice(0, SR_PAGE_SIZE);
    return { items: mapDocs({ docs }), cursor: docs.length ? docs[docs.length - 1] : null, hasMore: snap.docs.length > SR_PAGE_SIZE };
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}

const reqRef = (id: string) => doc(dbInstance!, 'supplyRequests', id);

// Quantidade aprovada de cada item (pedidos aprovados antes do Lote 3 não têm: vale a pedida, sem reserva no saldo)
export const itemApprovedQty = (it: SupplyRequestItem): number => (it.qtyApproved !== undefined ? it.qtyApproved : it.qty);
const balRef = (id: string) => doc(dbInstance!, 'supplyBalances', id);
// Soma por item do contrato (o mesmo insumo em duas linhas soma)
function perSupply(items: SupplyRequestItem[], qtys: number[]): Map<string, { qty: number; it: SupplyRequestItem }> {
  const m = new Map<string, { qty: number; it: SupplyRequestItem }>();
  items.forEach((it, i) => {
    const q = qtys[i] || 0;
    if (q <= 0) return;
    const cur = m.get(it.supplyId);
    m.set(it.supplyId, { qty: round3((cur?.qty || 0) + q), it });
  });
  return m;
}
const txErr = (err: any) => {
  checkQuotaException(err);
  clearSupplyBalancesCache();
  return err;
};

// ADMINISTRATIVO: aprovar (vai para o almoxarifado) com a quantidade de cada item (pode ser menor que a pedida; 0 = não
// aprovado). Confere o saldo do contrato e reserva o aprovado, na mesma transação.
export async function dbApproveSupplyRequest(req: SupplyRequest, approved: number[], by: Who): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  if (approved.length !== req.items.length || approved.some((q) => !Number.isFinite(q) || q < 0)) throw new Error('Confira as quantidades aprovadas.');
  const over = req.items.find((it, i) => approved[i] > it.qty);
  if (over) throw new Error(`A quantidade aprovada de "${over.description}" é maior que a pedida.`);
  if (approved.every((q) => q === 0)) throw new Error('Nenhum item aprovado: use "Reprovar" e informe o motivo.');
  const db = dbInstance;
  const now = new Date().toISOString();
  try {
    await runTransaction(db, async (tx) => {
      const cur = await tx.get(reqRef(req.id));
      if (!cur.exists() || cur.data().status !== 'Pendente') throw new Error('Este pedido já foi analisado por outra pessoa.');
      const items = (cur.data() as SupplyRequest).items;
      const need = perSupply(items, approved);
      const bals = new Map<string, any>();
      for (const id of need.keys()) {
        const b = await tx.get(balRef(id));
        bals.set(id, b.exists() ? b.data() : null);
      }
      for (const [id, { qty, it }] of need) {
        const b = bals.get(id);
        if (!b) throw new Error(`"${it.description}" (${it.code}) não está no contrato de insumos da empresa: aprove 0 ou reprove.`);
        const saldo = round3((Number(b.contractQty) || 0) - (Number(b.suppliedQty) || 0) - (Number(b.reservedQty) || 0));
        if (qty > saldo + 1e-9)
          throw new Error(`Saldo insuficiente de "${it.description}" (${it.code}): o saldo agora é ${fmtQty(Math.max(0, saldo))} ${it.measureUnit}. Ajuste a quantidade.`);
      }
      for (const [id, { qty }] of need) tx.update(balRef(id), { reservedQty: round3((Number(bals.get(id).reservedQty) || 0) + qty), updatedAt: now });
      const less = items.map((it, i) => (approved[i] < it.qty ? `${it.code}: ${fmtQty(approved[i])} de ${fmtQty(it.qty)}` : '')).filter(Boolean);
      tx.update(reqRef(req.id), {
        status: 'Confirmado',
        items: items.map((it, i) => cleanUndefined({ ...it, qtyApproved: approved[i] })),
        confirmation: { by: by.name, byMatricula: by.matricula, at: now },
        srConf: deleteField(),
        srStore: req.unit,
        updatedAt: now,
        timeline: arrayUnion(ev(by.name, 'Aprovado — enviado ao almoxarifado', less.length ? `Aprovado menos que o pedido: ${less.join('; ')}` : undefined))
      });
    });
  } catch (err: any) {
    throw txErr(err);
  }
  clearSupplyBalancesCache();
}

// REPROVAR: pelo administrativo (Pendente) ou recusa do almoxarifado (Confirmado; o aprovado volta ao saldo); motivo obrigatório
export async function dbRejectSupplyRequest(req: SupplyRequest, reason: string, by: Who): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const text = reason.trim();
  if (text.length < 3) throw new Error('Informe o motivo.');
  const stage = req.status === 'Pendente' ? 'confirmacao' : 'almoxarifado';
  const db = dbInstance;
  const now = new Date().toISOString();
  try {
    await runTransaction(db, async (tx) => {
      const cur = await tx.get(reqRef(req.id));
      if (!cur.exists() || cur.data().status !== req.status) throw new Error('Este pedido já foi analisado por outra pessoa.');
      const items = (cur.data() as SupplyRequest).items;
      // Recusa do almoxarifado: devolve ao saldo o que estava reservado (aprovado no Lote 3)
      const back = stage === 'almoxarifado' ? perSupply(items, items.map((it) => it.qtyApproved || 0)) : new Map();
      const bals = new Map<string, any>();
      for (const id of back.keys()) {
        const b = await tx.get(balRef(id));
        if (b.exists()) bals.set(id, b.data());
      }
      for (const [id, { qty }] of back) {
        const b = bals.get(id);
        if (b) tx.update(balRef(id), { reservedQty: Math.max(0, round3((Number(b.reservedQty) || 0) - qty)), updatedAt: now });
      }
      tx.update(reqRef(req.id), {
        status: 'Reprovado',
        rejection: { by: by.name, byMatricula: by.matricula, at: now, reason: text, stage },
        ...(stage === 'confirmacao' ? { srConf: deleteField() } : { srStore: deleteField() }),
        updatedAt: now,
        timeline: arrayUnion(ev(by.name, stage === 'confirmacao' ? 'Reprovado' : 'Recusado pelo almoxarifado', text))
      });
    });
  } catch (err: any) {
    throw txErr(err);
  }
  clearSupplyBalancesCache();
}

// ALMOXARIFADO: fornecer exatamente o aprovado (abate do saldo do contrato: sai da reserva e entra no fornecido).
// O que entra na OS fica pronto aqui. Pedidos aprovados antes do Lote 3: fornece o pedido, sem mexer no saldo.
export async function dbSupplySupplyRequest(req: SupplyRequest, note: string, by: Who): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const db = dbInstance;
  const now = new Date().toISOString();
  const text = note.trim();
  try {
    await runTransaction(db, async (tx) => {
      const cur = await tx.get(reqRef(req.id));
      if (!cur.exists() || cur.data().status !== 'Confirmado') throw new Error('Este pedido já foi fornecido ou recusado por outra pessoa.');
      const data = cur.data() as SupplyRequest;
      const items = data.items.map((it) => ({ ...it, qtySupplied: itemApprovedQty(it) }));
      if (items.every((it) => it.qtySupplied <= 0)) throw new Error('Nenhum item aprovado neste pedido: use "Recusar" e informe o motivo.');
      const move = perSupply(data.items, data.items.map((it) => it.qtyApproved || 0));
      const bals = new Map<string, any>();
      for (const id of move.keys()) {
        const b = await tx.get(balRef(id));
        if (!b.exists()) throw new Error(`O item ${move.get(id)!.it.code} não está mais no contrato de insumos da empresa. Avise quem importa o contrato.`);
        bals.set(id, b.data());
      }
      for (const [id, { qty }] of move) {
        const b = bals.get(id);
        tx.update(balRef(id), {
          reservedQty: Math.max(0, round3((Number(b.reservedQty) || 0) - qty)),
          suppliedQty: round3((Number(b.suppliedQty) || 0) + qty),
          updatedAt: now
        });
      }
      const osEntry: SupplyOsEntry = {
        number: data.number,
        glpi: data.glpi,
        suppliedAt: now,
        suppliedBy: by.name,
        items: items
          .filter((it) => it.qtySupplied > 0)
          .map((it) => ({ supplyId: it.supplyId, code: it.code, description: it.description, measureUnit: it.measureUnit, qty: it.qtySupplied }))
      };
      tx.update(reqRef(req.id), {
        status: 'Fornecido',
        items: items.map((it) => cleanUndefined(it)),
        supply: cleanUndefined({ by: by.name, byMatricula: by.matricula, at: now, note: text || undefined }),
        osEntry,
        suppliedAt: now,
        srStore: deleteField(),
        updatedAt: now,
        timeline: arrayUnion(ev(by.name, `Fornecido pelo almoxarifado (GLPI ${data.glpi})`, text || undefined))
      });
    });
  } catch (err: any) {
    throw txErr(err);
  }
  clearSupplyBalancesCache();
}

// TÉCNICO: "Recebi" — o pedido vira Recebido e os insumos entram na OS (os dois no mesmo pacote)
export async function dbReceiveSupplyRequest(req: SupplyRequest, byName: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  if (!req.osEntry) throw new Error('O almoxarifado ainda não registrou o fornecimento.');
  const db = dbInstance;
  const now = new Date().toISOString();
  const batch = writeBatch(db);
  batch.update(reqRef(req.id), {
    status: 'Recebido',
    receivedAt: now,
    techSr: deleteField(),
    updatedAt: now,
    timeline: arrayUnion(ev(byName, 'Recebido pelo técnico — entrou na OS'))
  });
  batch.set(
    doc(db, 'orderSupplies', req.orderId),
    { orderId: req.orderId, entries: { [req.number]: req.osEntry }, last: req.number, updatedAt: now },
    { merge: true }
  );
  try {
    await batch.commit();
    osCache.delete(req.orderId); // a ficha deste aparelho já mostra os insumos novos
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}

// TÉCNICO: "Ciente" do reprovado (sai da tela dele)
export async function dbAckSupplyRequest(req: SupplyRequest, byName: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const now = new Date().toISOString();
  await updateDoc(reqRef(req.id), {
    ackAt: now,
    techSr: deleteField(),
    updatedAt: now,
    timeline: arrayUnion(ev(byName, 'Técnico ciente da reprovação'))
  });
}

// Insumos recebidos de uma OS (ficha, custo e PDF): 1 leitura; guardado na sessão e renovado a cada 2 minutos.
// "strict" (PDF e planilha): se a leitura falhar, avisa em vez de sair "nenhum insumo"
const osCache = new Map<string, { at: number; value: OrderSupplies | null }>();
export async function dbGetOrderSupplies(orderId: string, force = false, strict = false): Promise<OrderSupplies | null> {
  if (!firebaseActive || !dbInstance || !orderId) return null;
  const hit = osCache.get(orderId);
  if (hit && !force && Date.now() - hit.at < 120000) return hit.value;
  try {
    const snap = await getDoc(doc(dbInstance, 'orderSupplies', orderId));
    const value = snap.exists() ? (snap.data() as OrderSupplies) : null;
    osCache.set(orderId, { at: Date.now(), value });
    return value;
  } catch (err: any) {
    checkQuotaException(err);
    if (strict) throw new Error(`não foi possível ler os insumos da OS (${err?.message || err})`);
    return hit?.value ?? null;
  }
}
// Lista (pedido a pedido, na ordem do fornecimento)
export const orderSupplyEntries = (os: OrderSupplies | null): SupplyOsEntry[] =>
  Object.values(os?.entries || {}).sort((a, b) => a.suppliedAt.localeCompare(b.suppliedAt));

// Insumos somados: o mesmo insumo vindo em pedidos diferentes vira uma linha só (PDF, Fase 8C-3)
export function orderSuppliesMerged(os: OrderSupplies | null): SupplyOsEntry['items'] {
  const map = new Map<string, SupplyOsEntry['items'][number]>();
  orderSupplyEntries(os).forEach((e) =>
    e.items.forEach((it) => {
      const cur = map.get(it.supplyId);
      if (cur) cur.qty = Math.round((cur.qty + it.qty) * 1000) / 1000;
      else map.set(it.supplyId, { ...it });
    })
  );
  return [...map.values()];
}
// Texto do PDF (sem código e sem R$): "DESCRIÇÃO — 3 UN" por linha, ou pedido a pedido com o nº e o GLPI
const supplyLine = (it: SupplyOsEntry['items'][number]) => `${it.description} — ${fmtQty(it.qty)} ${it.measureUnit}`;
export const orderSuppliesText = (os: OrderSupplies | null): string => orderSuppliesMerged(os).map(supplyLine).join('\n');
export const orderSuppliesByRequestText = (os: OrderSupplies | null): string =>
  orderSupplyEntries(os)
    .map((e) => [`${e.number} · GLPI ${e.glpi}`, ...e.items.map(supplyLine)].join('\n'))
    .join('\n');

export const formatSupplyQty = fmtQty;

// ===== RELATÓRIO DE SAÍDAS DE INSUMOS (Lote 3) =====
// Uma linha por item fornecido: data, pedido, item, quantidade, gerência, OS, GLPI, técnico, quem aprovou e quem forneceu.
// 1 busca por gerência (índice esparso gerência + empresa + suppliedAt), no período escolhido.
export interface SupplyOutputRow {
  suppliedAt: string;
  number: string;
  supplyId: string;
  code: string;
  description: string;
  measureUnit: string;
  qty: number;
  unit: string;
  company: string;
  orderKind: 'preventiva' | 'os';
  orderRef: string;      // "OS-2026-000123" ou "Preventiva #24117"
  orderLabel: string;
  glpi: string;
  techName: string;
  techMatricula: string;
  suppliedBy: string;
  approvedBy: string;
  approvedAt: string;
  status: SupplyRequestStatus;
  receivedAt?: string;
}

const dayStartIso = (day: string) => new Date(`${day}T00:00:00`).toISOString();
const nextDayIso = (day: string) => {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
};

export async function dbGetSupplyOutputs(units: string[], company: string, fromDay: string, toDay: string): Promise<SupplyOutputRow[]> {
  if (!firebaseActive || !dbInstance || !company || units.length === 0) return [];
  const db = dbInstance;
  const from = dayStartIso(fromDay);
  const to = nextDayIso(toDay);
  try {
    const parts = await Promise.all(
      units.map((u) =>
        getDocs(
          query(
            collection(db, 'supplyRequests'),
            where('unit', '==', u),
            where('company', '==', company),
            where('suppliedAt', '>=', from),
            where('suppliedAt', '<', to),
            orderBy('suppliedAt')
          )
        )
      )
    );
    const rows: SupplyOutputRow[] = [];
    parts.forEach((snap) =>
      mapDocs(snap).forEach((r) => {
        if (!r.suppliedAt || (r.status !== 'Fornecido' && r.status !== 'Recebido')) return;
        r.items.forEach((it) => {
          const qty = it.qtySupplied || 0;
          if (qty <= 0) return;
          rows.push({
            suppliedAt: r.suppliedAt!,
            number: r.number,
            supplyId: it.supplyId,
            code: it.code,
            description: it.description,
            measureUnit: it.measureUnit,
            qty,
            unit: r.unit,
            company: r.company,
            orderKind: r.orderKind,
            orderRef: String(r.orderLabel || '').split(' · ')[0] || r.orderId,
            orderLabel: r.orderLabel,
            glpi: r.glpi,
            techName: r.techName,
            techMatricula: r.techMatricula,
            suppliedBy: r.supply?.by || '',
            approvedBy: r.confirmation?.by || '',
            approvedAt: r.confirmation?.at || '',
            status: r.status,
            receivedAt: r.receivedAt
          });
        });
      })
    );
    return rows.sort((a, b) => b.suppliedAt.localeCompare(a.suppliedAt) || a.number.localeCompare(b.number) || a.code.localeCompare(b.code));
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}
