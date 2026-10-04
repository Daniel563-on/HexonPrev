import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  QueryDocumentSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  arrayUnion
} from './guard';
import { OsStage, OsSystemField, OsSystemKey, OsTemplate, OsTemplateField, WorkOrder, WorkOrderEvent } from '../types';
import { firebaseActive, dbInstance, cleanUndefined, checkQuotaException } from './core';

// OS (Hexon 2.0): corretiva, layout e acompanhamento — modelos ("osTemplates"), OS ("workOrders")
// e o contador do número por ano ("counters/workOrders_AAAA").
// Número: "OS-" + ano + 6 dígitos, uma sequência para todas as gerências, recomeça todo ano.

// ===== Campos do sistema =====
export const OS_SYSTEM_STAGE: Record<OsSystemKey, OsStage> = {
  gerencia: 'criacao',
  enderecoRequerente: 'criacao',
  enderecoExecucao: 'criacao',
  intervencao: 'criacao',
  glpi: 'criacao',
  ativo: 'criacao',
  prazo: 'criacao',
  tecnico: 'execucao',
  equipe: 'execucao',
  responsavel: 'execucao',
  pendencia: 'execucao',
  materiais: 'execucao',
  homemHora: 'execucao'
};

// Sempre ligados e obrigatórios (o Hexon precisa deles para funcionar)
export const OS_LOCKED_SYSTEM: OsSystemKey[] = ['gerencia', 'enderecoExecucao'];

export const OS_SYSTEM_HINT: Record<OsSystemKey, string> = {
  gerencia: 'Lista de gerências. Decide quem enxerga a OS.',
  enderecoRequerente: 'Lista de Endereços (CRAAI e comarca vêm junto).',
  enderecoExecucao: 'Lista de Endereços. Monta o histórico de cada endereço.',
  intervencao: 'Lista com as opções abaixo.',
  glpi: 'Número do chamado no GLPI.',
  ativo: 'Código colado de outro sistema. Se existir na Gestão de Ativos, a OS entra no histórico do ativo.',
  prazo: 'Data limite.',
  tecnico: 'Técnico atribuído (ao atribuir, a OS fica "Em andamento").',
  equipe: 'Pessoas do efetivo que participam (homem-hora).',
  responsavel: 'Responsável pela OS.',
  pendencia: 'Pausa com motivo.',
  materiais: 'Lista de materiais da gerência, com valor.',
  homemHora: 'Calculado pelo sistema.'
};

export function defaultSystemFields(): OsSystemField[] {
  const f = (key: OsSystemKey, label: string, order: number, extra: Partial<OsSystemField> = {}): OsSystemField => ({
    key,
    label,
    enabled: true,
    required: false,
    order,
    ...extra
  });
  return [
    // Criação (a ordem se mistura com as perguntas livres da mesma etapa)
    f('intervencao', 'Intervenção', 1, { required: true, options: ['Corretiva', 'Layout', 'Acompanhamento', 'Vistoria'] }),
    f('glpi', 'GLPI', 2, { required: true }),
    f('enderecoRequerente', 'Endereço do requerente', 5, { required: true }),
    f('enderecoExecucao', 'Endereço de execução', 8, { required: true }),
    f('ativo', 'Ativo', 9),
    f('gerencia', 'Gerência responsável', 12, { required: true }),
    f('prazo', 'Prazo limite (SLA)', 13),
    // Execução (usados na Fase 5)
    f('tecnico', 'Técnico atribuído', 1),
    f('equipe', 'Equipe', 2, { required: true }),
    f('responsavel', 'Responsável', 3),
    f('pendencia', 'Pendência', 4),
    f('materiais', 'Materiais utilizados', 5),
    f('homemHora', 'Homem-hora', 6)
  ];
}

// Modelo "MPRJ OS" (como o do principal; intervenção, GLPI, endereços, ativo e gerência viraram campos do sistema)
export function mprjTemplate(by: string): OsTemplate {
  const now = new Date().toISOString();
  const q = (id: string, label: string, type: OsTemplateField['type'], order: number, stage: OsStage, required = true, options?: string[]): OsTemplateField => ({
    id,
    label,
    type,
    required,
    stage,
    order,
    ...(options ? { options } : {})
  });
  return {
    id: 'mprj_os',
    name: 'MPRJ OS',
    description: '',
    version: 1,
    fields: [
      q('f_data_abertura', 'Data de abertura', 'date', 3, 'criacao'),
      q('f_nome_requerente', 'Nome do requerente', 'text', 4, 'criacao'),
      q('f_tel_requerente', 'Telefone do requerente', 'text', 6, 'criacao'),
      q('f_email_requerente', 'E-mail do requerente', 'text', 7, 'criacao'),
      q('f_descricao', 'Descrição do serviço solicitado', 'textarea', 10, 'criacao'),
      q('f_categoria', 'Categoria', 'select', 11, 'criacao', true, ['ACJ', 'Split', 'Bombas', 'Elevadores', 'Outros']),
      q('f_servico_executado', 'Descrição do serviço executado', 'textarea', 10, 'execucao')
    ],
    systemFields: defaultSystemFields(),
    allowedProfileIds: [],
    signatures: ['tecnico', 'cliente', 'engenheiro', 'gerente'],
    createdAt: now,
    updatedAt: now,
    updatedBy: by
  };
}

// Itens de uma etapa (perguntas livres + campos do sistema ligados), na ordem
export type OsStageItem = { kind: 'field'; field: OsTemplateField; order: number } | { kind: 'system'; sys: OsSystemField; order: number };

export function stageItems(fields: OsTemplateField[], systemFields: OsSystemField[], stage: OsStage): OsStageItem[] {
  const items: OsStageItem[] = [
    ...fields.filter((f) => f.stage === stage).map((field) => ({ kind: 'field' as const, field, order: field.order })),
    ...systemFields.filter((s) => s.enabled && OS_SYSTEM_STAGE[s.key] === stage).map((sys) => ({ kind: 'system' as const, sys, order: sys.order }))
  ];
  return items.sort((a, b) => a.order - b.order);
}

// ===== Modelos =====
let cacheTemplates: OsTemplate[] | null = null;

export function clearOsTemplatesCache(): void {
  cacheTemplates = null;
}

// Lê os modelos. Coleção vazia + quem pode editar: cria o "MPRJ OS" de exemplo.
export async function dbGetOsTemplates(force = false, seedBy?: string): Promise<OsTemplate[]> {
  if (cacheTemplates && !force) return [...cacheTemplates];
  if (!firebaseActive || !dbInstance) return [];
  try {
    const snap = await getDocs(collection(dbInstance, 'osTemplates'));
    let list = snap.docs.map((d) => ({ ...(d.data() as OsTemplate), id: d.id }));
    if (list.length === 0 && seedBy) {
      const seed = mprjTemplate(seedBy);
      await setDoc(doc(dbInstance, 'osTemplates', seed.id), cleanUndefined(seed));
      list = [seed];
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    cacheTemplates = list;
    return [...list];
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}

export async function dbSaveOsTemplate(t: OsTemplate, by: string, isNew: boolean): Promise<OsTemplate> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const saved: OsTemplate = {
    ...t,
    name: t.name.trim(),
    version: isNew ? 1 : (t.version || 1) + 1,
    updatedAt: new Date().toISOString(),
    updatedBy: by
  };
  await setDoc(doc(dbInstance, 'osTemplates', saved.id), cleanUndefined(saved));
  cacheTemplates = null;
  return saved;
}

// Excluir o modelo não mexe nas OS já emitidas (cada uma guarda a sua cópia do modelo)
export async function dbDeleteOsTemplate(id: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  await deleteDoc(doc(dbInstance, 'osTemplates', id));
  cacheTemplates = null;
}

// ===== OS =====
export const formatOsNumber = (year: number, seq: number) => `OS-${year}${String(seq).padStart(6, '0')}`;

export type WorkOrderDraft = Omit<WorkOrder, 'id' | 'number' | 'year' | 'seq' | 'createdAt' | 'updatedAt' | 'timeline' | 'status' | 'assignedAt'>;

// Emite a OS: reserva o próximo número do ano e grava a OS na mesma transação (dois ao mesmo tempo nunca repetem)
export async function dbEmitWorkOrder(
  draft: WorkOrderDraft,
  by: string,
  assignNow?: { matricula: string; name: string }
): Promise<WorkOrder> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Sem internet: emitir OS precisa de conexão.');
  const db = dbInstance;
  const year = new Date().getFullYear();
  const counterRef = doc(db, 'counters', `workOrders_${year}`);
  try {
    return await runTransaction(db, async (tx) => {
      const counter = await tx.get(counterRef);
      const seq = (counter.exists() ? Number(counter.data().last) || 0 : 0) + 1;
      const number = formatOsNumber(year, seq);
      const now = new Date().toISOString();
      const events: WorkOrderEvent[] = [{ at: now, by, action: 'OS emitida' }];
      if (assignNow) events.push({ at: now, by, action: `Atribuída a ${assignNow.name} (${assignNow.matricula})` });
      const order: WorkOrder = {
        ...draft,
        id: number,
        number,
        year,
        seq,
        status: assignNow ? 'Em andamento' : 'Nova',
        ...(assignNow ? { assignedTechnicianMatricula: assignNow.matricula, assignedTechnicianName: assignNow.name } : {}),
        createdAt: now,
        updatedAt: now,
        timeline: events
      };
      tx.set(counterRef, { year, last: seq });
      tx.set(doc(db, 'workOrders', number), {
        ...cleanUndefined(order),
        ...(assignNow ? { assignedAt: serverTimestamp() } : {})
      });
      return order;
    });
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}

export const WORK_ORDER_PAGE_SIZE = 20;

export interface WorkOrderPage {
  items: WorkOrder[];
  cursor: QueryDocumentSnapshot | null;
  hasMore: boolean;
}

// Lista da gerência, mais recentes primeiro (índice workOrders: unit + createdAt ↓)
export async function dbGetWorkOrdersPage(unit: string, after: QueryDocumentSnapshot | null): Promise<WorkOrderPage> {
  if (!unit || !firebaseActive || !dbInstance) return { items: [], cursor: null, hasMore: false };
  try {
    const parts: any[] = [where('unit', '==', unit), orderBy('createdAt', 'desc')];
    if (after) parts.push(startAfter(after));
    parts.push(limit(WORK_ORDER_PAGE_SIZE + 1));
    const snap = await getDocs(query(collection(dbInstance, 'workOrders'), ...parts));
    const docs = snap.docs.slice(0, WORK_ORDER_PAGE_SIZE);
    return {
      items: docs.map((d) => ({ ...(d.data() as WorkOrder), id: d.id })),
      cursor: docs[docs.length - 1] || null,
      hasMore: snap.docs.length > WORK_ORDER_PAGE_SIZE
    };
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}

// Atribui o técnico: a OS vai para "Em andamento" e o homem-hora começa a contar (hora do servidor)
export async function dbAssignWorkOrder(order: WorkOrder, tech: { matricula: string; name: string }, by: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const now = new Date().toISOString();
  const event: WorkOrderEvent = {
    at: now,
    by,
    action: order.assignedTechnicianMatricula
      ? `Técnico trocado: ${order.assignedTechnicianName} → ${tech.name} (${tech.matricula})`
      : `Atribuída a ${tech.name} (${tech.matricula})`
  };
  await updateDoc(doc(dbInstance, 'workOrders', order.id), {
    status: order.status === 'Nova' ? 'Em andamento' : order.status,
    assignedTechnicianMatricula: tech.matricula,
    assignedTechnicianName: tech.name,
    ...(order.status === 'Nova' ? { assignedAt: serverTimestamp() } : {}),
    updatedAt: now,
    timeline: arrayUnion(cleanUndefined(event))
  });
}
