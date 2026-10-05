import {
  Timestamp,
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
  writeBatch
} from './guard';
import { OsSignatureMeta, OsSignatureRole, OsValidation, WorkOrder, WorkOrderEvent, WorkOrderExec, WorkOrderPause } from '../types';
import { firebaseActive, dbInstance, cleanUndefined, checkQuotaException } from './core';

// ASSINATURAS DA OS (Fase 5B): Técnico → Cliente (celular ou link) → Engenheiro → Gerente, na ordem do modelo.
// A imagem (com o carimbo) fica fora da OS ("workOrderSignatures/{OS}_{papel}"); na OS ficam os dados do carimbo.
// Validação do cliente por link: "osValidations/{código}" — leitura sem login (só quem tem o código), uma resposta só.

export const OS_SIGN_LABEL: Record<OsSignatureRole, string> = {
  tecnico: 'Técnico',
  cliente: 'Cliente',
  engenheiro: 'Engenheiro',
  gerente: 'Gerente'
};
// Uma cor por papel (carimbo e cartões)
export const OS_SIGN_COLOR: Record<OsSignatureRole, string> = {
  tecnico: '#1e40af',
  cliente: '#047857',
  engenheiro: '#6d28d9',
  gerente: '#c2410c'
};

// Papéis exigidos, na ordem (o técnico sempre primeiro)
export function osSignOrder(o: WorkOrder): OsSignatureRole[] {
  const list = (o.templateSignatures?.length ? o.templateSignatures : (['tecnico', 'cliente', 'engenheiro', 'gerente'] as OsSignatureRole[])).filter(
    (r) => r !== 'tecnico'
  );
  return ['tecnico', ...list];
}
export function nextSignerAfter(o: WorkOrder, role: OsSignatureRole): OsSignatureRole | null {
  const order = osSignOrder(o);
  const i = order.indexOf(role);
  return i >= 0 && i < order.length - 1 ? order[i + 1] : null;
}
// Fila: "GERÊNCIA|papel" enquanto espera cliente (link), engenheiro ou gerente (índice esparso workOrders.signQueue)
const queueKey = (o: WorkOrder, role: OsSignatureRole | null) => (role === 'cliente' || role === 'engenheiro' || role === 'gerente' ? `${o.unit}|${role}` : null);

const ev = (by: string, action: string, note?: string): WorkOrderEvent => cleanUndefined({ at: new Date().toISOString(), by, action, note });
const sigRef = (orderId: string, role: OsSignatureRole) => doc(dbInstance!, 'workOrderSignatures', `${orderId}_${role}`);

export async function dbGetOsSignatureImage(orderId: string, role: OsSignatureRole): Promise<string | null> {
  if (!firebaseActive || !dbInstance) return null;
  try {
    const snap = await getDoc(sigRef(orderId, role));
    return snap.exists() ? String(snap.data().image || '') || null : null;
  } catch (err: any) {
    checkQuotaException(err);
    return null;
  }
}

// Campos que entram na OS quando ela fica concluída (some do celular e da fila; entra no histórico do ativo)
function closeFields(o: WorkOrder, now: string) {
  return { status: 'Concluída', closedAt: now, techOpen: deleteField(), signQueue: deleteField(), nextSigner: deleteField() };
}

// Histórico do ativo: id "os:<ativo>" separa as corretivas das preventivas (mesmo índice assetId + date)
function historyDoc(o: WorkOrder, now: string) {
  const execText = Object.values(o.exec?.answers || {})
    .filter((v) => typeof v === 'string')
    .join(' · ')
    .slice(0, 500);
  return cleanUndefined({
    id: `os_${o.id}`,
    assetId: `os:${o.assetId}`,
    osId: o.id,
    osTitle: `${o.intervencao || 'OS'}${o.glpi ? ` · GLPI ${o.glpi}` : ''}`,
    date: now,
    technician: o.assignedTechnicianName || '',
    status: 'Concluída',
    notes: execText,
    checklistCount: 0,
    checkedCount: 0
  });
}

// TÉCNICO: Concluir = salva a execução e assina. O homem-hora para aqui.
export async function dbConcludeWorkOrder(o: WorkOrder, exec: WorkOrderExec, meta: OsSignatureMeta, image: string, by: string): Promise<WorkOrder> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const now = meta.at;
  const next = nextSignerAfter(o, 'tecnico');
  const batch = writeBatch(dbInstance);
  batch.set(sigRef(o.id, 'tecnico'), { orderId: o.id, role: 'tecnico', image, at: now });
  const qk = queueKey(o, next);
  const updates: any = {
    exec: cleanUndefined({ ...exec, updatedAt: now, updatedBy: by }),
    signatures: { tecnico: cleanUndefined(meta) },
    techSignedAt: now,
    updatedAt: now,
    timeline: arrayUnion(ev(by, o.status === 'Contestada' ? 'Concluída de novo pelo técnico (após contestação)' : 'Concluída pelo técnico e assinada'))
  };
  if (next) {
    Object.assign(updates, { status: 'Aguardando assinaturas', nextSigner: next, ...(qk ? { signQueue: qk } : {}) });
  } else {
    Object.assign(updates, closeFields(o, now));
    if (o.assetId) batch.set(doc(dbInstance, 'histories', `os_${o.id}`), historyDoc(o, now));
  }
  batch.update(doc(dbInstance, 'workOrders', o.id), updates);
  await batch.commit();
  return {
    ...o,
    exec: { ...exec, updatedAt: now, updatedBy: by },
    signatures: { tecnico: meta },
    techSignedAt: now,
    status: next ? 'Aguardando assinaturas' : 'Concluída',
    nextSigner: next || undefined,
    signQueue: qk || undefined
  };
}

// CLIENTE no celular do técnico (ou o escritório) — só quando é a vez do cliente
export async function dbSignClient(o: WorkOrder, meta: OsSignatureMeta, image: string | null, by: string): Promise<WorkOrder> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  if (o.status !== 'Aguardando assinaturas' || o.nextSigner !== 'cliente') throw new Error('Não é a vez da assinatura do cliente.');
  const now = new Date().toISOString();
  const next = nextSignerAfter(o, 'cliente');
  const batch = writeBatch(dbInstance);
  if (image) batch.set(sigRef(o.id, 'cliente'), { orderId: o.id, role: 'cliente', image, at: meta.at });
  const qk = queueKey(o, next);
  const updates: any = {
    signatures: { ...(o.signatures || {}), cliente: cleanUndefined(meta) },
    validationToken: deleteField(),
    updatedAt: now,
    timeline: arrayUnion(ev(by, meta.via === 'link' ? 'Validada pelo cliente (link)' : 'Assinada pelo cliente', `${meta.name}${meta.rating ? ` · ${meta.rating} estrela(s)` : ''}`))
  };
  if (next) Object.assign(updates, { nextSigner: next, ...(qk ? { signQueue: qk } : { signQueue: deleteField() }) });
  else {
    Object.assign(updates, closeFields(o, now));
    if (o.assetId) batch.set(doc(dbInstance, 'histories', `os_${o.id}`), historyDoc(o, now));
  }
  batch.update(doc(dbInstance, 'workOrders', o.id), updates);
  await batch.commit();
  return { ...o, signatures: { ...(o.signatures || {}), cliente: meta }, validationToken: undefined, nextSigner: next || undefined, status: next ? o.status : 'Concluída' };
}

// ENGENHEIRO / GERENTE: assina uma ou várias OS de uma vez (mesmo desenho; carimbo com a hora de cada uma)
export async function dbSignAsRole(orders: WorkOrder[], role: 'engenheiro' | 'gerente', meta: Omit<OsSignatureMeta, 'at'>, images: Record<string, string>, by: string): Promise<number> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  let done = 0;
  // Lotes de até 100 OS (cada OS = 2 ou 3 gravações)
  for (let i = 0; i < orders.length; i += 100) {
    const batch = writeBatch(dbInstance);
    orders.slice(i, i + 100).forEach((o) => {
      if (o.status !== 'Aguardando assinaturas' || o.nextSigner !== role) return;
      const now = new Date().toISOString();
      const next = nextSignerAfter(o, role);
      const qk = queueKey(o, next);
      batch.set(sigRef(o.id, role), { orderId: o.id, role, image: images[o.id], at: now });
      const updates: any = {
        signatures: { ...(o.signatures || {}), [role]: cleanUndefined({ ...meta, at: now }) },
        updatedAt: now,
        timeline: arrayUnion(ev(by, `Assinada pelo ${role === 'engenheiro' ? 'engenheiro' : 'gerente'}`))
      };
      if (next) Object.assign(updates, { nextSigner: next, ...(qk ? { signQueue: qk } : { signQueue: deleteField() }) });
      else {
        Object.assign(updates, closeFields(o, now));
        if (o.assetId) batch.set(doc(dbInstance!, 'histories', `os_${o.id}`), historyDoc(o, now));
      }
      batch.update(doc(dbInstance!, 'workOrders', o.id), updates);
      done++;
    });
    await batch.commit();
  }
  return done;
}

// Fila "Precisam da minha assinatura" (índice esparso workOrders.signQueue).
// Para o engenheiro, também confere as OS que esperam o cliente pelo link: se o cliente já aprovou, a OS entra na fila.
export async function dbGetSignQueue(units: string[], role: 'engenheiro' | 'gerente', by = ''): Promise<WorkOrder[]> {
  if (!firebaseActive || !dbInstance || units.length === 0) return [];
  if (role === 'engenheiro') {
    const waiting = await dbGetQueueKeys(units.map((u) => `${u}|cliente`)).catch(() => [] as WorkOrder[]);
    await Promise.all(waiting.filter((o) => o.validationToken).map((o) => dbSyncOsValidation(o, by || 'Sistema').catch(() => null)));
  }
  return dbGetQueueKeys(units.map((u) => `${u}|${role}`));
}

async function dbGetQueueKeys(keys: string[]): Promise<WorkOrder[]> {
  if (!dbInstance) return [];
  try {
    const out: WorkOrder[] = [];
    for (let i = 0; i < keys.length; i += 30) {
      const snap = await getDocs(query(collection(dbInstance, 'workOrders'), where('signQueue', 'in', keys.slice(i, i + 30))));
      snap.docs.forEach((d) => out.push({ ...(d.data() as WorkOrder), id: d.id }));
    }
    return out.sort((a, b) => (a.techSignedAt || '').localeCompare(b.techSignedAt || ''));
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}

// ===== Validação do cliente por link =====
const newToken = () => {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};
export const osValidationLink = (token: string) => `${window.location.origin}${window.location.pathname}?validar=${token}`;

// Cria o link (vale por "days" dias) e guarda o código na OS
export async function dbCreateOsValidation(o: WorkOrder, days: number, by: string): Promise<string> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  if (o.status !== 'Aguardando assinaturas' || o.nextSigner !== 'cliente') throw new Error('O link só pode ser gerado quando é a vez do cliente.');
  const token = newToken();
  const now = new Date();
  const exec = o.exec;
  const summary = (o.templateFields || [])
    .filter((f) => f.stage === 'execucao' && (f.type === 'textarea' || f.type === 'text'))
    .map((f) => exec?.answers?.[f.id])
    .filter((v) => typeof v === 'string' && v.trim())
    .join('\n')
    .slice(0, 1500);
  const v: OsValidation = {
    orderId: o.id,
    number: o.number,
    unit: o.unit,
    intervencao: o.intervencao || '',
    glpi: o.glpi || '',
    local: o.execAddressText || '',
    comarca: o.comarca || '',
    executedAt: o.techSignedAt || now.toISOString(),
    team: (exec?.team || []).map((p) => p.name),
    summary,
    technician: o.assignedTechnicianName || '',
    status: 'pendente',
    expiresAt: Timestamp.fromDate(new Date(now.getTime() + days * 86400000)),
    createdAt: now.toISOString(),
    createdBy: by
  };
  const batch = writeBatch(dbInstance);
  // A data de validade vai como Timestamp do banco (cleanUndefined a transformaria em objeto comum)
  batch.set(doc(dbInstance, 'osValidations', token), { ...cleanUndefined({ ...v, expiresAt: null }), expiresAt: v.expiresAt });
  batch.update(doc(dbInstance, 'workOrders', o.id), {
    validationToken: token,
    updatedAt: now.toISOString(),
    timeline: arrayUnion(ev(by, 'Link de validação gerado para o cliente', `vale ${days} dia(s)`))
  });
  await batch.commit();
  return token;
}

export async function dbGetOsValidation(token: string): Promise<OsValidation | null> {
  if (!firebaseActive || !dbInstance || !token) return null;
  try {
    const snap = await getDoc(doc(dbInstance, 'osValidations', token));
    return snap.exists() ? (snap.data() as OsValidation) : null;
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}

// Página pública: o cliente aprova (nome, matrícula, estrelas) ou contesta (motivo). Uma resposta só.
export async function dbAnswerOsValidation(token: string, approve: boolean, r: { name: string; matricula: string; rating?: number; reason?: string }): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  await updateDoc(doc(dbInstance, 'osValidations', token), {
    status: approve ? 'aprovada' : 'contestada',
    response: cleanUndefined({
      name: r.name.trim(),
      matricula: r.matricula.trim(),
      rating: approve ? r.rating : undefined,
      reason: approve ? undefined : (r.reason || '').trim(),
      at: new Date().toISOString(),
      agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : undefined
    })
  });
}

// Traz a resposta do link para a OS (quem abre a OS faz isso: técnico, escritório ou assinante).
// Aprovada = assinatura do cliente "via link". Contestada = volta para o técnico; o tempo entre a assinatura
// do técnico e a contestação não conta no homem-hora (vira uma pausa).
export async function dbSyncOsValidation(o: WorkOrder, by: string): Promise<WorkOrder | null> {
  if (!o.validationToken || o.status !== 'Aguardando assinaturas' || o.nextSigner !== 'cliente') return null;
  const v = await dbGetOsValidation(o.validationToken).catch(() => null);
  if (!v || v.status === 'pendente' || !v.response) return null;
  if (v.status === 'aprovada') {
    return dbSignClient(o, { name: v.response.name, matricula: v.response.matricula, rating: v.response.rating, at: v.response.at, via: 'link' }, null, by);
  }
  // Contestada
  const now = new Date().toISOString();
  const pauses: WorkOrderPause[] = [
    ...(o.pauses || []),
    { start: o.techSignedAt || v.response.at, end: v.response.at, reason: 'Aguardando validação do cliente (contestada)', by: 'Sistema' }
  ];
  await updateDoc(doc(dbInstance!, 'workOrders', o.id), {
    status: 'Contestada',
    contestReason: v.response.reason || '',
    contestedAt: v.response.at,
    pauses,
    signatures: {},
    techSignedAt: deleteField(),
    nextSigner: deleteField(),
    validationToken: deleteField(),
    signQueue: deleteField(),
    updatedAt: now,
    timeline: arrayUnion(ev(v.response.name || 'Cliente', 'Contestada pelo cliente (link)', v.response.reason))
  });
  return { ...o, status: 'Contestada', contestReason: v.response.reason, contestedAt: v.response.at, pauses, signatures: {}, techSignedAt: undefined, nextSigner: undefined, validationToken: undefined };
}
