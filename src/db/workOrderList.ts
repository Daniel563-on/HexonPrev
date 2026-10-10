import { QueryDocumentSnapshot, collection, doc, getCountFromServer, getDoc, getDocs, limit, orderBy, query, startAfter, where } from './guard';
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
export type OsStatusFilter = WorkOrderStatus | `sign:${OsSignatureRole}`;
export const OS_SIGN_FILTERS: OsStatusFilter[] = ['sign:cliente', 'sign:engenheiro', 'sign:gerente'];
export const OS_FILTER_STATUSES: OsStatusFilter[] = ['Nova', 'Em andamento', 'Pendente', ...OS_SIGN_FILTERS, 'Contestada', 'Concluída', 'Cancelada'];
export const osFilterLabel = (s: OsStatusFilter): string =>
  s.startsWith('sign:') ? osStatusLabel({ status: 'Aguardando assinaturas', nextSigner: s.slice(5) }) : s;

export type OsListMode =
  | { kind: 'filter'; status?: OsStatusFilter; tech?: string; from?: string; to?: string } // datas AAAA-MM-DD (abertura)
  | { kind: 'late' } // atrasadas: prazo passou e ainda em aberto
  | { kind: 'closed'; from: string; to: string }; // concluídas no período (data da conclusão)

export interface OsListPage {
  items: WorkOrder[];
  cursor: QueryDocumentSnapshot | null;
  hasMore: boolean;
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
  } else if (mode.kind === 'closed') {
    p.push(where('status', '==', 'Concluída'), where('closedAt', '>=', startOf(mode.from)), where('closedAt', '<=', endOf(mode.to)), orderBy('closedAt', 'desc'));
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

export async function dbListWorkOrders(unit: string, mode: OsListMode, after: QueryDocumentSnapshot | null, size = OS_LIST_PAGE, cos: string[] | null = null): Promise<OsListPage> {
  if (!unit || !firebaseActive || !dbInstance || (cos && cos.length === 0)) return { items: [], cursor: null, hasMore: false };
  try {
    const q = [...parts(unit, mode, cos)];
    if (after) q.push(startAfter(after));
    q.push(limit(size + 1));
    const snap = await getDocs(query(collection(dbInstance, 'workOrders'), ...q));
    const docs = snap.docs.slice(0, size);
    return { items: docs.map((d) => ({ ...(d.data() as WorkOrder), id: d.id })), cursor: docs[docs.length - 1] || null, hasMore: snap.docs.length > size };
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
  return snap.data().count;
}

export interface OsCounters {
  byStatus: Partial<Record<OsStatusFilter, number>>;
  late: number;
  closedMonth: number;
  total: number;
}
// Painel: por situação (abertas e em assinatura), atrasadas e concluídas no mês
export async function dbGetOsCounters(unit: string, cos: string[] | null = null): Promise<OsCounters> {
  const shown: OsStatusFilter[] = ['Nova', 'Em andamento', 'Pendente', ...OS_SIGN_FILTERS, 'Contestada'];
  try {
    const [counts, late, closedMonth, total] = await Promise.all([
      Promise.all(shown.map((s) => dbCountWorkOrders(unit, { kind: 'filter', status: s }, cos))),
      dbCountWorkOrders(unit, { kind: 'late' }, cos),
      dbCountWorkOrders(unit, { kind: 'closed', from: monthStartStr(), to: todayStr() }, cos),
      dbCountWorkOrders(unit, { kind: 'filter' }, cos)
    ]);
    const byStatus: Partial<Record<OsStatusFilter, number>> = {};
    shown.forEach((s, i) => (byStatus[s] = counts[i]));
    return { byStatus, late, closedMonth, total };
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
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
