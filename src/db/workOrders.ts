import {
  collection,
  deleteDoc,
  doc,
  getDoc,
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
  arrayUnion,
  deleteField
} from './guard';
import { OsLocationAnswer, OsStage, OsSystemField, OsSystemKey, OsTemplate, OsTemplateField, WorkOrder, WorkOrderEvent, WorkOrderExec, WorkOrderPause } from '../types';
import { firebaseActive, dbInstance, cleanUndefined, checkQuotaException } from './core';
import { nowMs, recordLoad } from '../utils/loadTimes';

// OS (Hexon 2.0): corretiva, layout e acompanhamento — modelos ("osTemplates"), OS ("workOrders")
// e o contador do número por ano ("counters/workOrders_AAAA").
// Número: "OS-" + ano + 6 dígitos, uma sequência para todas as gerências, recomeça todo ano.

// ===== Campos do sistema =====
export const OS_SYSTEM_STAGE: Record<OsSystemKey, OsStage> = {
  gerencia: 'criacao',
  empresa: 'criacao',
  numeroOs: 'criacao',
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
export const OS_LOCKED_SYSTEM: OsSystemKey[] = ['gerencia', 'empresa', 'enderecoExecucao'];

export const OS_SYSTEM_HINT: Record<OsSystemKey, string> = {
  gerencia: 'Gerência de quem abre (fixa). Só quem é dessa gerência enxerga a OS. Super Administrador e gerência "Todas" escolhem.',
  empresa: 'Empresa contratada que executa a OS (empresas ativas da gerência). O técnico da atribuição é dessa empresa. Enquanto a OS está "Nova", dá para trocar em "Editar OS".',
  numeroOs: 'Número da OS, automático (OS-AAAA + 6 dígitos). Mostra o próximo número previsto; o definitivo é reservado ao emitir.',
  tecnico: 'Atribuição: lista só os técnicos da gerência da OS. Aparece para quem pode atribuir; ao atribuir, a OS fica "Em andamento".',
  enderecoExecucao: 'Local da execução: CRAAI › Comarca › Endereço (cadastro de Endereços). Monta o histórico de cada endereço.',
  intervencao: 'Lista com as opções abaixo (aparece na lista de OS).',
  glpi: 'Número do chamado no GLPI.',
  ativo: 'Ativo da Gestão de Ativos (busca pelo código ou patrimônio). Vinculado, a OS entra no histórico do ativo. Obrigatório = só emite com ativo cadastrado.',
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
    f('gerencia', 'Gerência responsável', 1, { required: true, width: 'third' }),
    f('empresa', 'Empresa', 1.5, { required: true, width: 'third' }),
    f('intervencao', 'Intervenção', 2, { required: true, width: 'third', options: ['Corretiva', 'Layout', 'Acompanhamento', 'Vistoria'] }),
    f('numeroOs', 'Nº da OS', 3, { width: 'third' }),
    f('glpi', 'GLPI', 4, { required: true, width: 'third' }),
    f('prazo', 'Prazo limite (SLA)', 6, { width: 'third' }),
    f('enderecoExecucao', 'Local da execução', 11, { required: true }),
    f('ativo', 'Ativo', 14, { width: 'half' }),
    f('tecnico', 'Atribuição (técnico)', 15),
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
      q('f_data_abertura', 'Data de abertura', 'date', 5, 'criacao', true, { width: 'third' }),
      q('f_nome_requerente', 'Nome do requerente', 'text', 7, 'criacao'),
      q('f_local_requerente', 'Local do requerente', 'location', 8, 'criacao', true, { locationDepth: 'comarca' }),
      q('f_tel_requerente', 'Telefone do requerente', 'phone', 9, 'criacao', true, { width: 'half' }),
      q('f_email_requerente', 'E-mail do requerente', 'email', 10, 'criacao', true, { width: 'half' }),
      q('f_descricao', 'Descrição do serviço solicitado', 'textarea', 12, 'criacao'),
      q('f_categoria', 'Categoria', 'select', 13, 'criacao', true, { options: ['ACJ', 'Split', 'Bombas', 'Elevadores', 'Outros'], width: 'half' }),
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
  const out = { ...rest, fields, systemFields };
  // MPRJ salvo antes das larguras existirem: recebe a arrumação padrão (ordem e largura) uma vez
  if (t.id === 'mprj_os' && ![...fields, ...known].some((x) => x.width)) return applyMprjLayout(out);
  return out;
}

function applyMprjLayout(t: OsTemplate): OsTemplate {
  const ref = mprjTemplate(t.updatedBy);
  return {
    ...t,
    fields: t.fields.map((f) => {
      const r = ref.fields.find((x) => x.id === f.id);
      return r ? { ...f, order: r.order, width: r.width } : f;
    }),
    systemFields: t.systemFields.map((s) => {
      const r = ref.systemFields.find((x) => x.key === s.key);
      return r && OS_SYSTEM_STAGE[s.key] === 'criacao' ? { ...s, order: r.order, width: r.width } : s;
    })
  };
}

// Próximo número previsto (só para mostrar no formulário; o definitivo é reservado ao emitir)
export async function dbPeekNextOsNumber(): Promise<string | null> {
  if (!firebaseActive || !dbInstance) return null;
  const year = new Date().getFullYear();
  try {
    const snap = await getDoc(doc(dbInstance, 'counters', `workOrders_${year}`));
    return formatOsNumber(year, (snap.exists() ? Number(snap.data().last) || 0 : 0) + 1);
  } catch (err: any) {
    checkQuotaException(err);
    return null;
  }
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
        ...(assignNow ? { assignedTechnicianMatricula: assignNow.matricula, assignedTechnicianName: assignNow.name, techOpen: assignNow.matricula } : {}),
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
    techOpen: tech.matricula, // o técnico anterior deixa de ver a OS; o novo continua de onde parou
    ...(order.status === 'Nova' ? { assignedAt: serverTimestamp() } : {}),
    updatedAt: now,
    timeline: arrayUnion(cleanUndefined(event))
  });
}

// ===== Editar enquanto "Nova" e desatribuir (etapa especial E4) =====
// Campos que a edição pode mudar (gerência, modelo e número nunca mudam); a regra do banco confere a mesma lista.
export const OS_EDITABLE_FIELDS = [
  'answers', 'execAddressId', 'execAddressText', 'execAddressManual', 'craai', 'comarca', 'reqAddressId', 'reqAddressText',
  'intervencao', 'glpi', 'assetCode', 'assetId', 'assetName', 'deadline', 'company'
] as const;
export type OsEditPatch = Partial<Pick<WorkOrder, (typeof OS_EDITABLE_FIELDS)[number]>>;

// Grava só o que mudou; "changes" = o que mudou, em texto ("Campo: antes → depois"), para a linha do tempo
export async function dbEditWorkOrder(order: WorkOrder, patch: OsEditPatch, changes: string[], by: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  if (order.status !== 'Nova') throw new Error('Só dá para editar a OS enquanto ela está "Nova".');
  const data: Record<string, any> = {};
  (OS_EDITABLE_FIELDS as readonly string[]).forEach((k) => {
    if (!(k in patch)) return;
    const v = (patch as any)[k];
    const before = (order as any)[k];
    if (JSON.stringify(v ?? null) === JSON.stringify(before ?? null)) return;
    data[k] = v === undefined || v === '' ? deleteField() : k === 'answers' ? cleanUndefined(v) : v;
  });
  if (Object.keys(data).length === 0) return;
  const now = new Date().toISOString();
  await updateDoc(doc(dbInstance, 'workOrders', order.id), {
    ...data,
    updatedAt: now,
    timeline: arrayUnion(cleanUndefined({ at: now, by, action: 'OS editada', note: changes.join(' · ') || undefined }))
  });
}

// Desatribuir: só se o técnico ainda não começou (sem execução salva e nunca ficou Pendente).
// A OS volta para "Nova", sai do celular do técnico e o homem-hora zera (volta a contar na próxima atribuição).
export const osTechStarted = (o: WorkOrder) => !!o.exec || (o.pauses || []).length > 0;
export async function dbUnassignWorkOrder(order: WorkOrder, by: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  if (order.status !== 'Em andamento' || osTechStarted(order)) throw new Error('O técnico já começou: não dá para desatribuir.');
  const now = new Date().toISOString();
  await updateDoc(doc(dbInstance, 'workOrders', order.id), {
    status: 'Nova',
    assignedTechnicianMatricula: deleteField(),
    assignedTechnicianName: deleteField(),
    assignedAt: deleteField(),
    techOpen: deleteField(),
    updatedAt: now,
    timeline: arrayUnion(cleanUndefined({ at: now, by, action: `Técnico desatribuído: ${order.assignedTechnicianName || order.assignedTechnicianMatricula} (a OS voltou para "Nova")` }))
  });
}

// ===== Execução (Fase 5) =====
const event = (by: string, action: string, note?: string): WorkOrderEvent => cleanUndefined({ at: new Date().toISOString(), by, action, note });

export async function dbGetWorkOrder(id: string): Promise<WorkOrder | null> {
  if (!firebaseActive || !dbInstance) return null;
  try {
    const snap = await getDoc(doc(dbInstance, 'workOrders', id));
    return snap.exists() ? ({ ...(snap.data() as WorkOrder), id: snap.id }) : null;
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}

// OS que estão com o técnico agora (índice esparso workOrders.techOpen)
export async function dbGetMyWorkOrders(matricula: string): Promise<WorkOrder[]> {
  if (!matricula || !firebaseActive || !dbInstance) return [];
  const t0 = nowMs();
  try {
    const snap = await getDocs(query(collection(dbInstance, 'workOrders'), where('techOpen', '==', matricula)));
    recordLoad('Minhas OS (busca no banco)', nowMs() - t0, `${snap.size} OS com o técnico`);
    return snap.docs.map((d) => ({ ...(d.data() as WorkOrder), id: d.id })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (err: any) {
    recordLoad('Minhas OS (busca no banco)', nowMs() - t0, undefined, String(err?.message || err));
    checkQuotaException(err);
    throw err;
  }
}

// O técnico salva o que preencheu (respostas, equipe, materiais, feriados, hora extra, pernoite)
export async function dbSaveWorkOrderExec(order: WorkOrder, exec: WorkOrderExec, by: string, first: boolean): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const now = new Date().toISOString();
  await updateDoc(doc(dbInstance, 'workOrders', order.id), {
    exec: cleanUndefined({ ...exec, updatedAt: now, updatedBy: by }),
    updatedAt: now,
    ...(first ? { timeline: arrayUnion(event(by, 'Execução iniciada pelo técnico')) } : {})
  });
}

// Pendente: pausa com motivo (o tempo parado não conta no homem-hora)
export async function dbPauseWorkOrder(order: WorkOrder, reason: string, by: string): Promise<WorkOrderPause[]> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  if (order.status !== 'Em andamento') throw new Error('Só uma OS em andamento pode ficar pendente.');
  const now = new Date().toISOString();
  const pauses: WorkOrderPause[] = [...(order.pauses || []), { start: now, reason: reason.trim(), by }];
  await updateDoc(doc(dbInstance, 'workOrders', order.id), {
    status: 'Pendente',
    pauses,
    updatedAt: now,
    timeline: arrayUnion(event(by, 'Pendente', reason.trim()))
  });
  return pauses;
}

export async function dbResumeWorkOrder(order: WorkOrder, by: string): Promise<WorkOrderPause[]> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  if (order.status !== 'Pendente') throw new Error('Só uma OS pendente pode ser retomada.');
  const now = new Date().toISOString();
  const pauses = (order.pauses || []).map((p, i, all) => (i === all.length - 1 && !p.end ? { ...p, end: now } : p));
  await updateDoc(doc(dbInstance, 'workOrders', order.id), {
    status: 'Em andamento',
    pauses,
    updatedAt: now,
    timeline: arrayUnion(event(by, 'Retomada'))
  });
  return pauses;
}

// Cancelar: motivo obrigatório; some do celular do técnico
export async function dbCancelWorkOrder(order: WorkOrder, reason: string, by: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  if (!['Nova', 'Em andamento', 'Pendente'].includes(order.status)) throw new Error('Esta OS não pode mais ser cancelada.');
  const now = new Date().toISOString();
  const pauses = (order.pauses || []).map((p, i, all) => (i === all.length - 1 && !p.end ? { ...p, end: now } : p));
  await updateDoc(doc(dbInstance, 'workOrders', order.id), {
    status: 'Cancelada',
    cancelReason: reason.trim(),
    cancelledAt: now,
    cancelledBy: by,
    pauses,
    techOpen: deleteField(),
    updatedAt: now,
    timeline: arrayUnion(event(by, 'Cancelada', reason.trim()))
  });
}
