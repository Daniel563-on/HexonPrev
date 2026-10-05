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
import { OsLocationAnswer, OsStage, OsSystemField, OsSystemKey, OsTemplate, OsTemplateField, WorkOrder, WorkOrderEvent } from '../types';
import { firebaseActive, dbInstance, cleanUndefined, checkQuotaException } from './core';

// OS (Hexon 2.0): corretiva, layout e acompanhamento — modelos ("osTemplates"), OS ("workOrders")
// e o contador do número por ano ("counters/workOrders_AAAA").
// Número: "OS-" + ano + 6 dígitos, uma sequência para todas as gerências, recomeça todo ano.

// ===== Campos do sistema =====
export const OS_SYSTEM_STAGE: Record<OsSystemKey, OsStage> = {
  gerencia: 'criacao',
  tecnico: 'criacao',
  enderecoExecucao: 'criacao',
  intervencao: 'criacao',
  glpi: 'criacao',
  ativo: 'criacao',
  prazo: 'criacao',
  equipe: 'execucao',
  responsavel: 'execucao',
  pendencia: 'execucao',
  materiais: 'execucao',
  homemHora: 'execucao'
};

// Sempre ligados e obrigatórios (o Hexon precisa deles para funcionar)
export const OS_LOCKED_SYSTEM: OsSystemKey[] = ['gerencia', 'enderecoExecucao'];

export const OS_SYSTEM_HINT: Record<OsSystemKey, string> = {
  gerencia: 'Gerência de quem abre (fixa). Só quem é dessa gerência enxerga a OS. Super Administrador e gerência "Todas" escolhem.',
  tecnico: 'Atribuição: lista só os técnicos da gerência da OS. Aparece para quem pode atribuir; ao atribuir, a OS fica "Em andamento".',
  enderecoExecucao: 'Local da execução: CRAAI › Comarca › Endereço (cadastro de Endereços). Monta o histórico de cada endereço.',
  intervencao: 'Lista com as opções abaixo (aparece na lista de OS).',
  glpi: 'Número do chamado no GLPI.',
  ativo: 'Código colado de outro sistema. Se existir na Gestão de Ativos, a OS entra no histórico do ativo.',
  prazo: 'Data limite.',
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
    f('enderecoExecucao', 'Local da execução', 8, { required: true }),
    f('ativo', 'Ativo', 9),
    f('gerencia', 'Gerência responsável', 12, { required: true }),
    f('prazo', 'Prazo limite (SLA)', 13),
    f('tecnico', 'Atribuição (técnico)', 14),
    // Execução (usados na Fase 5)
    f('equipe', 'Equipe', 1, { required: true }),
    f('responsavel', 'Responsável', 2),
    f('pendencia', 'Pendência', 3),
    f('materiais', 'Materiais utilizados', 4),
    f('homemHora', 'Homem-hora', 5)
  ];
}

// Modelo "MPRJ OS" (como o do principal; intervenção, GLPI, local da execução, ativo e gerência são campos do sistema)
export function mprjTemplate(by: string): OsTemplate {
  const now = new Date().toISOString();
  const q = (id: string, label: string, type: OsTemplateField['type'], order: number, stage: OsStage, required = true, extra: Partial<OsTemplateField> = {}): OsTemplateField => ({
    id,
    label,
    type,
    required,
    stage,
    order,
    ...extra
  });
  return {
    id: 'mprj_os',
    name: 'MPRJ OS',
    description: '',
    version: 1,
    fields: [
      q('f_data_abertura', 'Data de abertura', 'date', 3, 'criacao'),
      q('f_nome_requerente', 'Nome do requerente', 'text', 4, 'criacao'),
      q('f_local_requerente', 'Local do requerente', 'location', 5, 'criacao', true, { locationDepth: 'comarca' }),
      q('f_tel_requerente', 'Telefone do requerente', 'phone', 6, 'criacao'),
      q('f_email_requerente', 'E-mail do requerente', 'email', 7, 'criacao'),
      q('f_descricao', 'Descrição do serviço solicitado', 'textarea', 10, 'criacao'),
      q('f_categoria', 'Categoria', 'select', 11, 'criacao', true, { options: ['ACJ', 'Split', 'Bombas', 'Elevadores', 'Outros'] }),
      q('f_servico_executado', 'Descrição do serviço executado', 'textarea', 10, 'execucao')
    ],
    systemFields: defaultSystemFields(),
    signatures: ['tecnico', 'cliente', 'engenheiro', 'gerente'],
    createdAt: now,
    updatedAt: now,
    updatedBy: by
  };
}

// Ajusta um modelo da 1ª versão: tira campos do sistema que não existem mais, acrescenta os novos
// e transforma o antigo "Endereço do requerente" em pergunta Local (CRAAI › Comarca).
export function normalizeOsTemplate(t: OsTemplate): OsTemplate {
  const raw = (t.systemFields || []) as unknown as (Omit<OsSystemField, 'key'> & { key: string })[];
  const fields = [...(t.fields || [])].map((f) => (f.type === 'checkbox' ? { ...f, type: 'yesno' as const } : f));
  const oldReq = raw.find((s) => s.key === 'enderecoRequerente');
  if (oldReq?.enabled && !fields.some((f) => f.type === 'location')) {
    fields.push({ id: 'f_local_requerente', label: 'Local do requerente', type: 'location', locationDepth: 'comarca', required: !!oldReq.required, stage: 'criacao', order: oldReq.order });
  }
  const known = raw.filter((s) => s.key in OS_SYSTEM_STAGE) as OsSystemField[];
  const defaults = defaultSystemFields();
  const systemFields = defaults.map((d) => {
    const cur = known.find((s) => s.key === d.key);
    if (!cur) return { ...d, enabled: d.key === 'tecnico' ? true : d.enabled };
    return d.key === 'enderecoExecucao' && cur.label === 'Endereço de execução' ? { ...cur, label: d.label } : cur;
  });
  const { allowedProfileIds, ...rest } = t;
  return { ...rest, fields, systemFields };
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

// ===== Condições ("Mostrar só quando...") =====
// Perguntas que podem servir de condição: as de resposta fechada
export const OS_CONDITION_TYPES: OsTemplateField['type'][] = ['select', 'multiselect', 'yesno', 'checkbox', 'toggle'];

export function osConditionOptions(f: OsTemplateField): string[] {
  if (f.type === 'yesno' || f.type === 'checkbox') return ['Sim', 'Não'];
  if (f.type === 'toggle') return ['Ligado', 'Desligado'];
  return f.options || [];
}

// A pergunta aparece? (a condição também precisa estar visível; Liga/desliga sem resposta = Desligado)
export function osFieldVisible(f: OsTemplateField, all: OsTemplateField[], answers: Record<string, any>, depth = 0): boolean {
  if (!f.showIf) return true;
  const parent = all.find((x) => x.id === f.showIf!.fieldId);
  if (!parent || depth > 10) return true;
  if (!osFieldVisible(parent, all, answers, depth + 1)) return false;
  const v = answers[parent.id];
  if (parent.type === 'toggle') return (v ? 'Ligado' : 'Desligado') === f.showIf.value;
  if (Array.isArray(v)) return v.includes(f.showIf.value);
  return v === f.showIf.value;
}

// Texto de uma resposta (lista de OS, detalhe, planilhas)
export function osAnswerText(f: OsTemplateField, v: any): string {
  if (v === undefined || v === null || v === '') return '';
  if (f.type === 'date') {
    const [y, m, d] = String(v).split('-');
    return d ? `${d}/${m}/${y}` : String(v);
  }
  if (f.type === 'toggle') return v ? 'Ligado' : 'Desligado';
  if (f.type === 'multiselect') return Array.isArray(v) ? v.join(', ') : String(v);
  if (f.type === 'location') {
    const l = v as OsLocationAnswer;
    return [l.address, l.comarca && `Comarca ${l.comarca}`, l.craai && `CRAAI ${l.craai}`].filter(Boolean).join(' · ');
  }
  if (f.type === 'signature') return 'Assinado';
  return String(v);
}

export const OS_PHONE_OK = (v: string) => v.replace(/\D/g, '').length >= 10;
export const OS_EMAIL_OK = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

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
    let list = snap.docs.map((d) => normalizeOsTemplate({ ...(d.data() as OsTemplate), id: d.id }));
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
