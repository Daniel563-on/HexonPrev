import { QueryDocumentSnapshot, collection, doc, getCountFromServer, getDoc, getDocs, limit, onSnapshot, orderBy, query, startAfter, updateDoc, where } from './guard';
import { OsSignatureRole, WorkOrder, WorkOrderStatus } from '../types';
import { osStatusLabel } from './workOrderSign';
import { firebaseActive, dbInstance, checkQuotaException } from './core';

// LISTA E ACOMPANHAMENTO DAS OS (Fase 6): busca, filtros, contadores e as consultas da exportação.
// Filtros no banco: gerência + (situação OU técnico) + período de abertura. Intervenção e "atrasada" filtram o que já veio.
// Índices: unit+createdAt (já existe); unit+status+createdAt; unit+assignedTechnicianMatricula+createdAt;
// unit+status+deadline (atrasadas); unit+status+closedAt (concluídas no período); unit+glpi (busca por GLPI).
// Empresa (etapa especial E4): "cos" = empresas da busca (null = todas). Uma = igual; várias = "in".
// Índices: unit+company+createdAt; unit+company+status+createdAt; unit+company+status+deadline; unit+company+status+closedAt.
// O filtro por técnico não usa a empresa (o técnico é de uma empresa só).

export const OS_LIST_PAGE = 20;
export const OS_OPEN_STATUSES: WorkOrderStatus[] = ['Nova', 'Em andamento', 'Pendente'];
export const OS_ALL_STATUSES: WorkOrderStatus[] = ['Nova', 'Em andamento', 'Pendente', 'Aguardando assinaturas', 'Contestada', 'Concluída', 'Cancelada'];
// Filtro de situação: "Aguardando assinaturas" separada por quem falta assinar (campo nextSigner, que só existe
// enquanto a OS espera assinatura). Índices: unit+nextSigner+createdAt e unit+company+nextSigner+createdAt (esparsos).
// U16: "link" = vez do cliente COM link enviado (campo linkExp, esparso; índices unit+linkExp e unit+company+linkExp);
// "sign:cliente" passa a ser só a vez do cliente SEM link (contagem = vez do cliente − com link)
export type OsStatusFilter = WorkOrderStatus | `sign:${OsSignatureRole}` | 'link';
export const OS_SIGN_FILTERS: OsStatusFilter[] = ['sign:cliente', 'link', 'sign:engenheiro', 'sign:gerente'];
export const OS_FILTER_STATUSES: OsStatusFilter[] = ['Nova', 'Em andamento', 'Pendente', ...OS_SIGN_FILTERS, 'Contestada', 'Concluída', 'Cancelada'];
export const osFilterLabel = (s: OsStatusFilter): string =>
  s === 'link' ? 'Link enviado ao cliente' : s.startsWith('sign:') ? osStatusLabel({ status: 'Aguardando assinaturas', nextSigner: s.slice(5) }) : s;

export type OsListMode =
  | { kind: 'filter'; status?: OsStatusFilter; tech?: string; from?: string; to?: string } // datas AAAA-MM-DD (abertura)
  | { kind: 'late' } // atrasadas: prazo passou e ainda em aberto
  | { kind: 'closed'; from: string; to: string } // concluídas no período (data da conclusão)
  | { kind: 'pending' }; // A5-B: em aberto das empresas de "cos" (as inativas da gerência) = "Sem empresa"

export interface OsListPage {
  items: WorkOrder[];
  cursor: QueryDocumentSnapshot | null;
  hasMore: boolean;
  fixed?: number; // U16: OS de link antigo acertadas nesta leitura (a tela reconta)
}

const startOf = (d: string) => new Date(`${d}T00:00:00`).toISOString();
const endOf = (d: string) => new Date(`${d}T23:59:59.999`).toISOString();
export const todayStr = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
export const monthStartStr = () => `${todayStr().slice(0, 8)}01`;

function parts(unit: string, mode: OsListMode, cos: string[] | null): any[] {
  const p: any[] = [where('unit', '==', unit)];
  if (cos && !(mode.kind === 'filter' && !mode.status && mode.tech))
    p.push(cos.length === 1 ? where('company', '==', cos[0]) : where('company', 'in', cos.slice(0, 10)));
  if (mode.kind === 'late') {
    p.push(where('status', 'in', OS_OPEN_STATUSES), where('deadline', '<', todayStr()), orderBy('deadline', 'asc'));
  } else if (mode.kind === 'pending') {
    p.push(where('status', 'in', OS_OPEN_STATUSES), orderBy('createdAt', 'desc'));
  } else if (mode.kind === 'closed') {
    p.push(where('status', '==', 'Concluída'), where('closedAt', '>=', startOf(mode.from)), where('closedAt', '<=', endOf(mode.to)), orderBy('closedAt', 'desc'));
  } else if (mode.status === 'link') {
    // U16: link enviado — os que vencem primeiro em cima (sem filtro de datas de abertura)
    p.push(where('linkExp', '>=', ''), orderBy('linkExp', 'asc'));
  } else {
    if (mode.status?.startsWith('sign:')) p.push(where('nextSigner', '==', mode.status.slice(5)));
    else if (mode.status) p.push(where('status', '==', mode.status));
    else if (mode.tech) p.push(where('assignedTechnicianMatricula', '==', mode.tech));
    if (mode.from) p.push(where('createdAt', '>=', startOf(mode.from)));
    if (mode.to) p.push(where('createdAt', '<=', endOf(mode.to)));
    p.push(orderBy('createdAt', 'desc'));
  }
  return p;
}

// A OS combina com o filtro da tela? Mesma regra da busca no banco (parts); usada nas mudanças em tempo real para
// tirar da lista a OS que saiu do filtro e pôr a que entrou, sem ler de novo
export function osMatchesMode(o: WorkOrder, mode: OsListMode, cos: string[] | null): boolean {
  if (cos && !(mode.kind === 'filter' && !mode.status && mode.tech) && !cos.includes(o.company || '')) return false;
  if (mode.kind === 'late') return OS_OPEN_STATUSES.includes(o.status) && !!o.deadline && o.deadline < todayStr();
  if (mode.kind === 'pending') return OS_OPEN_STATUSES.includes(o.status);
  if (mode.kind === 'closed') return o.status === 'Concluída' && !!o.closedAt && o.closedAt >= startOf(mode.from) && o.closedAt <= endOf(mode.to);
  if (mode.status === 'link') return o.status === 'Aguardando assinaturas' && !!o.linkExp;
  if (mode.status?.startsWith('sign:')) {
    if (o.nextSigner !== mode.status.slice(5)) return false;
    if (mode.status === 'sign:cliente' && o.linkExp) return false;
  } else if (mode.status) {
    if (o.status !== mode.status) return false;
  } else if (mode.tech && o.assignedTechnicianMatricula !== mode.tech) return false;
  if (mode.from && o.createdAt < startOf(mode.from)) return false;
  if (mode.to && o.createdAt > endOf(mode.to)) return false;
  return true;
}

export async function dbListWorkOrders(unit: string, mode: OsListMode, after: QueryDocumentSnapshot | null, size = OS_LIST_PAGE, cos: string[] | null = null): Promise<OsListPage> {
  if (!unit || !firebaseActive || !dbInstance || (cos && cos.length === 0)) return { items: [], cursor: null, hasMore: false };
  try {
    const read = async (from: QueryDocumentSnapshot | null) => {
      const q = [...parts(unit, mode, cos)];
      if (from) q.push(startAfter(from));
      q.push(limit(size + 1));
      const snap = await getDocs(query(collection(dbInstance!, 'workOrders'), ...q));
      const docs = snap.docs.slice(0, size);
      return { items: docs.map((d) => ({ ...(d.data() as WorkOrder), id: d.id })), cursor: docs[docs.length - 1] || null, hasMore: snap.docs.length > size };
    };
    let page = await read(after);
    // U16: na vez do cliente, as que têm link vão para o cartão "Link enviado" (as antigas, sem as datas, são acertadas
    // uma vez pela linha do tempo e saem daqui); se a página ficou curta, lê a seguinte (até 5 vezes)
    if (mode.kind === 'filter' && mode.status === 'sign:cliente') {
      let fixedCount = 0;
      const keep = async (list: WorkOrder[]) => {
        const fixed = new Set(await dbFillLinkDates(list.filter((o) => o.validationToken && !o.linkExp)));
        if (fixed.size) markOsCountsStale(unit);
        fixedCount += fixed.size;
        return list.filter((o) => !o.linkExp && !fixed.has(o.id));
      };
      let items = await keep(page.items);
      for (let i = 0; i < 4 && items.length < size && page.hasMore; i++) {
        page = await read(page.cursor);
        items = [...items, ...(await keep(page.items))];
      }
      return { ...page, items, ...(fixedCount ? { fixed: fixedCount } : {}) };
    }
    return page;
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}

// Quantas OS a consulta traz (contar custa bem menos que baixar)
export async function dbCountWorkOrders(unit: string, mode: OsListMode, cos: string[] | null = null): Promise<number> {
  if (!unit || !firebaseActive || !dbInstance || (cos && cos.length === 0)) return 0;
  const q = parts(unit, mode, cos).filter((c) => c.type !== 'orderBy');
  const snap = await getCountFromServer(query(collection(dbInstance, 'workOrders'), ...q));
  // U16: "Aguardando assinatura do cliente" = vez do cliente − com link enviado
  if (mode.kind === 'filter' && mode.status === 'sign:cliente') {
    const withLink = await dbCountWorkOrdersCached(unit, { kind: 'filter', status: 'link' }, cos); // a mesma contagem do cartão "Link enviado"
    return Math.max(0, snap.data().count - withLink);
  }
  return snap.data().count;
}

// U16: OS que já tinham link antes do cartão "Link enviado": envio, quem gerou e vencimento tirados do último
// "Link de validação gerado para o cliente · vale N dia(s)" da linha do tempo. Devolve as que foram acertadas.
export function linkDatesFromTimeline(o: WorkOrder): { linkAt: string; linkBy: string; linkExp: string } | null {
  const ev = [...(o.timeline || [])].reverse().find((e) => e.action === 'Link de validação gerado para o cliente');
  const days = Number(/vale (\d+)/.exec(ev?.note || '')?.[1] || 0);
  if (!ev?.at || !days) return null;
  return { linkAt: ev.at, linkBy: ev.by || '', linkExp: new Date(Date.parse(ev.at) + days * 86400000).toISOString() };
}
export async function dbFillLinkDates(orders: WorkOrder[]): Promise<string[]> {
  if (!firebaseActive || !dbInstance || orders.length === 0) return [];
  const done: string[] = [];
  for (const o of orders.slice(0, 20)) {
    const d = linkDatesFromTimeline(o);
    if (!d) continue;
    try {
      await updateDoc(doc(dbInstance, 'workOrders', o.id), d);
      done.push(o.id);
    } catch (err: any) {
      console.warn('Não foi possível acertar as datas do link da OS', o.id, err);
      checkQuotaException(err);
    }
  }
  return done;
}

// Ajuste S10 (Lote 5): as contagens do painel (Início e Ordens de Serviço) ficam guardadas na sessão por gerência +
// empresas e são reaproveitadas ao trocar de tela. Ficam velhas quando a escuta de mudanças (abaixo) vê uma OS da
// gerência mudar — inclusive a 1ª resposta dela, que traz o que mudou nos últimos 10 min — e no máximo em 5 min.
const COUNT_TTL_MS = 5 * 60 * 1000;
const countCache = new Map<string, { unit: string; at: number; p: Promise<number> }>();
export function cachedOsCount(units: string[], key: string, fn: () => Promise<number>): Promise<number> {
  const k = `${units.join('|')}§${key}`;
  const hit = countCache.get(k);
  if (hit && Date.now() - hit.at < COUNT_TTL_MS) return hit.p;
  const p = fn();
  const entry = { unit: `|${units.join('|')}|`, at: Date.now(), p };
  countCache.set(k, entry);
  p.catch(() => countCache.get(k) === entry && countCache.delete(k));
  return p;
}
export function markOsCountsStale(unit: string): void {
  Array.from(countCache.entries()).forEach(([k, e]) => {
    if (e.unit.includes(`|${unit}|`)) countCache.delete(k);
  });
}
const oldestCountAt = (unit: string): number | null => {
  let min: number | null = null;
  countCache.forEach((e) => {
    if (e.unit.includes(`|${unit}|`)) min = min === null ? e.at : Math.min(min, e.at);
  });
  return min;
};
export const dbCountWorkOrdersCached = (unit: string, mode: OsListMode, cos: string[] | null = null): Promise<number> =>
  cachedOsCount([unit], `${JSON.stringify(mode)}§${cos ? cos.join(',') : '*'}`, () => dbCountWorkOrders(unit, mode, cos));

export interface OsCounters {
  byStatus: Partial<Record<OsStatusFilter, number>>;
}
// Painel: um contador por situação (as concluídas só pelos filtros; atrasada já aparece na lista)
export const OS_PANEL_STATUSES: OsStatusFilter[] = ['Nova', 'Em andamento', 'Pendente', ...OS_SIGN_FILTERS, 'Contestada', 'Cancelada'];
export async function dbGetOsCounters(unit: string, cos: string[] | null = null): Promise<OsCounters> {
  try {
    const counts = await Promise.all(OS_PANEL_STATUSES.map((s) => dbCountWorkOrdersCached(unit, { kind: 'filter', status: s }, cos)));
    const byStatus: Partial<Record<OsStatusFilter, number>> = {};
    OS_PANEL_STATUSES.forEach((s, i) => (byStatus[s] = counts[i]));
    return { byStatus };
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}

// Mudanças nas OS da gerência a partir de agora (números do painel em tempo real; ajustes da etapa 8).
// Abrir não lê nada antigo: só chegam as OS gravadas depois de "since" (updatedAt), 1 leitura por OS que mudar.
// Índice: workOrders unit + updatedAt. A 1ª resposta (o que já estava no intervalo) não vai para a tela; ela só serve
// para saber se as contagens guardadas na sessão (S10) ficaram velhas: se sim, "onStale" pede para contar de novo.
export function subscribeWorkOrderChanges(unit: string, sinceIso: string, onChange: (changed: WorkOrder[]) => void, onStale?: () => void): () => void {
  if (!unit || !firebaseActive || !dbInstance) return () => {};
  let first = true;
  return onSnapshot(
    query(collection(dbInstance, 'workOrders'), where('unit', '==', unit), where('updatedAt', '>=', sinceIso)),
    (snap) => {
      if (first) {
        first = false;
        // Margem de 2 min para relógios de aparelhos diferentes
        const counted = oldestCountAt(unit);
        const newest = snap.docs.reduce((m, d) => Math.max(m, Date.parse(String((d.data() as WorkOrder).updatedAt || '')) || 0), 0);
        if (counted !== null && newest && newest >= counted - 120000) {
          markOsCountsStale(unit);
          onStale?.();
        }
        return;
      }
      const changed = snap.docChanges().filter((c) => c.type !== 'removed').map((c) => ({ ...(c.doc.data() as WorkOrder), id: c.doc.id }));
      if (changed.length) {
        markOsCountsStale(unit);
        onChange(changed);
      }
    },
    (err) => {
      console.warn('Não foi possível acompanhar as mudanças das OS:', err);
      checkQuotaException(err);
    }
  );
}

// Busca: nº da OS (abre direto) ou nº do GLPI (na gerência escolhida)
export async function dbFindWorkOrders(unit: string, term: string, cos: string[] | null = null): Promise<WorkOrder[]> {
  if (!firebaseActive || !dbInstance) return [];
  const t = term.trim().toUpperCase();
  if (!t) return [];
  const digits = t.replace(/\D/g, '');
  const out: WorkOrder[] = [];
  try {
    if (t.startsWith('OS') || digits.length === 10) {
      const snap = await getDoc(doc(dbInstance, 'workOrders', `OS-${digits}`)).catch(() => null);
      if (snap?.exists()) out.push({ ...(snap.data() as WorkOrder), id: snap.id });
      if (t.startsWith('OS')) return cos ? out.filter((o) => cos.includes(o.company || '')) : out;
    }
    const snap = await getDocs(query(collection(dbInstance, 'workOrders'), where('unit', '==', unit), where('glpi', '==', term.trim()), limit(50)));
    snap.docs.forEach((d) => !out.some((o) => o.id === d.id) && out.push({ ...(d.data() as WorkOrder), id: d.id }));
    return cos ? out.filter((o) => cos.includes(o.company || '')) : out;
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}
