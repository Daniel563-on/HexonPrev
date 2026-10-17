import {
  Timestamp,
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  updateDoc,
  where,
  writeBatch
} from './guard';
import { OsContest, OsSignatureMeta, OsSignatureRole, OsTemplateField, OsValidation, WorkOrder, WorkOrderEvent, WorkOrderExec, WorkOrderPause } from '../types';
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
// Situação para mostrar: "Aguardando assinaturas" diz de quem é a vez (cliente, engenheiro ou gerente)
export function osStatusLabel(o: { status: string; nextSigner?: string | null; linkExp?: string }): string {
  // U16: vez do cliente com o link enviado (ficha, lista, planilha e PDF; o celular do técnico continua "Aguardando cliente")
  if (o.status === 'Aguardando assinaturas' && o.nextSigner === 'cliente' && o.linkExp) return 'Link enviado ao cliente';
  const who = o.status === 'Aguardando assinaturas' && o.nextSigner ? OS_SIGN_LABEL[o.nextSigner as OsSignatureRole] : '';
  return who ? `Aguardando assinatura do ${who.toLowerCase()}` : o.status;
}

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
    ...(o.assignedTechnicianMatricula ? { cliSigned: o.assignedTechnicianMatricula } : {}),
    validationToken: deleteField(),
    ...LINK_CLEAR,
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
  return { ...o, signatures: { ...(o.signatures || {}), cliente: meta }, cliSigned: o.assignedTechnicianMatricula || o.cliSigned, validationToken: undefined, linkAt: undefined, linkBy: undefined, linkExp: undefined, nextSigner: next || undefined, status: next ? o.status : 'Concluída' };
}

// ENGENHEIRO / GERENTE: assina uma ou várias OS de uma vez (mesmo desenho; carimbo com a hora de cada uma)
export const SIGN_BATCH = 25;
export async function dbSignAsRole(orders: WorkOrder[], role: 'engenheiro' | 'gerente', meta: Omit<OsSignatureMeta, 'at'>, images: Record<string, string>, by: string): Promise<number> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  let done = 0;
  // Pacotes de até 25 OS (cada OS = 2 ou 3 gravações; Lote 4, S9): bem abaixo do limite de 10 MiB por pedido do banco.
  // Se um pacote falhar, os anteriores já ficaram assinados: a mensagem diz quantos
  for (let i = 0; i < orders.length; i += SIGN_BATCH) {
    const batch = writeBatch(dbInstance);
    let inBatch = 0;
    orders.slice(i, i + SIGN_BATCH).forEach((o) => {
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
      inBatch++;
    });
    if (!inBatch) continue;
    try {
      await batch.commit();
    } catch (err: any) {
      if (!done) throw err;
      throw new Error(`${done} de ${orders.length} OS assinada(s); as outras não foram (${err?.message || err}). Atualize a lista e assine as que faltaram.`);
    }
    done += inBatch;
  }
  return done;
}

// Fila "Precisam da minha assinatura" (índice esparso workOrders.signQueue).
// Para o engenheiro, também confere as OS que esperam o cliente pelo link: se o cliente já aprovou, a OS entra na fila.
// Ajuste S18 (Lote 5): essa conferência (1 leitura por OS esperando o cliente + 1 por link) é feita no máximo a cada
// 15 min nesta sessão; "Atualizar" (force) confere na hora. A resposta do link não chega em tempo real: ela também
// entra na OS quando o técnico ou o escritório abrem a OS.
const LINK_CHECK_MS = 15 * 60 * 1000;
const linkCheckedAt = new Map<string, number>();
export async function dbGetSignQueue(units: string[], role: 'engenheiro' | 'gerente', by = '', force = false): Promise<WorkOrder[]> {
  if (!firebaseActive || !dbInstance || units.length === 0) return [];
  const key = units.slice().sort().join('|');
  if (role === 'engenheiro' && (force || Date.now() - (linkCheckedAt.get(key) || 0) >= LINK_CHECK_MS)) {
    const waiting = await dbGetQueueKeys(units.map((u) => `${u}|cliente`)).catch(() => null);
    if (waiting) {
      await Promise.all(waiting.filter((o) => o.validationToken).map((o) => dbSyncOsValidation(o, by || 'Sistema').catch(() => null)));
      linkCheckedAt.set(key, Date.now());
    }
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
// U16: o link saiu da OS (assinada, validada ou contestada) → saem também o envio e o vencimento
const LINK_CLEAR = { linkAt: deleteField(), linkBy: deleteField(), linkExp: deleteField() };

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
  // U16: envio e vencimento também na OS (cartão "Link enviado ao cliente" sem ler o link de cada uma)
  batch.update(doc(dbInstance, 'workOrders', o.id), {
    validationToken: token,
    linkAt: now.toISOString(),
    linkBy: by,
    linkExp: v.expiresAt.toDate().toISOString(),
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
// Aprovada = assinatura do cliente "via link". Contestada = a OS fica "Contestada" (a assinatura do técnico continua;
// nada do que foi lançado muda); o tempo esperando o cliente não conta no homem-hora (vira uma pausa) e volta a
// contar até alguém responder a contestação.
// Várias telas podem fazer isso ao mesmo tempo (lista do técnico, ficha, fila do engenheiro): no mesmo aparelho
// as chamadas da mesma OS esperam a primeira; entre aparelhos, a gravação é feita numa transação que relê a OS
// e só grava se ela ainda espera esse mesmo link (a resposta entra uma vez só na linha do tempo).
const syncing = new Map<string, Promise<WorkOrder | null>>();

export function dbSyncOsValidation(o: WorkOrder, by: string): Promise<WorkOrder | null> {
  if (!o.validationToken || o.status !== 'Aguardando assinaturas' || o.nextSigner !== 'cliente') return Promise.resolve(null);
  const key = `${o.id}|${o.validationToken}`;
  const running = syncing.get(key);
  if (running) return running;
  const p = syncOsValidation(o, by).finally(() => setTimeout(() => syncing.delete(key), 5000));
  syncing.set(key, p);
  return p;
}

async function syncOsValidation(o: WorkOrder, by: string): Promise<WorkOrder | null> {
  if (!firebaseActive || !dbInstance) return null;
  const token = o.validationToken!;
  const v = await dbGetOsValidation(token).catch(() => null);
  if (!v || v.status === 'pendente' || !v.response) return null;
  const r = v.response;
  const ref = doc(dbInstance, 'workOrders', o.id);
  return runTransaction(dbInstance, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return null;
    const cur = { ...(snap.data() as WorkOrder), id: snap.id };
    // Outra tela já trouxe a resposta: não grava de novo
    if (cur.status !== 'Aguardando assinaturas' || cur.nextSigner !== 'cliente' || cur.validationToken !== token) return null;
    const now = new Date().toISOString();
    if (v.status === 'aprovada') {
      const meta: OsSignatureMeta = cleanUndefined({ name: r.name, matricula: r.matricula, rating: r.rating, at: r.at, via: 'link' as const });
      const next = nextSignerAfter(cur, 'cliente');
      const qk = queueKey(cur, next);
      const updates: any = {
        signatures: { ...(cur.signatures || {}), cliente: meta },
        validationToken: deleteField(),
        ...LINK_CLEAR,
        updatedAt: now,
        timeline: arrayUnion(ev(by, 'Validada pelo cliente (link)', `${meta.name}${meta.rating ? ` · ${meta.rating} estrela(s)` : ''}`))
      };
      // Aviso para o técnico (ele não estava junto): a OS aparece em "Assinadas pelo cliente" até ele tocar em OK
      if (cur.assignedTechnicianMatricula) updates.cliSigned = cur.assignedTechnicianMatricula;
      if (next) Object.assign(updates, { nextSigner: next, ...(qk ? { signQueue: qk } : { signQueue: deleteField() }) });
      else {
        Object.assign(updates, closeFields(cur, now));
        if (cur.assetId) tx.set(doc(dbInstance!, 'histories', `os_${cur.id}`), historyDoc(cur, now));
      }
      tx.update(ref, updates);
      return { ...cur, signatures: { ...(cur.signatures || {}), cliente: meta }, validationToken: undefined, linkAt: undefined, linkBy: undefined, linkExp: undefined, nextSigner: next || undefined, signQueue: qk || undefined, status: next ? cur.status : 'Concluída', cliSigned: cur.assignedTechnicianMatricula || undefined } as WorkOrder;
    }
    // Contestada (a pausa vai do fim do trabalho — assinatura do técnico ou última resposta — até a contestação)
    const pauses: WorkOrderPause[] = [
      ...(cur.pauses || []),
      { start: cur.workEndAt || cur.techSignedAt || r.at, end: r.at, reason: 'Aguardando validação do cliente (contestada)', by: 'Sistema' }
    ];
    const contest: OsContest = cleanUndefined({ reason: r.reason || '', clientName: r.name || 'Cliente', clientMatricula: r.matricula || undefined, at: r.at });
    const contests = [...(cur.contests || []), contest];
    tx.update(ref, {
      status: 'Contestada',
      contestReason: r.reason || '',
      contestedAt: r.at,
      contests,
      pauses,
      nextSigner: deleteField(),
      validationToken: deleteField(),
      ...LINK_CLEAR,
      signQueue: deleteField(),
      updatedAt: now,
      timeline: arrayUnion(ev(r.name || 'Cliente', 'Contestada pelo cliente (link)', r.reason))
    });
    return { ...cur, status: 'Contestada', contestReason: r.reason, contestedAt: r.at, contests, pauses, nextSigner: undefined, validationToken: undefined, linkAt: undefined, linkBy: undefined, linkExp: undefined, signQueue: undefined } as WorkOrder;
  }).catch((err: any) => {
    checkQuotaException(err);
    throw err;
  });
}

// AVISO "ASSINADAS PELO CLIENTE" (ajustes da etapa 8): a OS assinada pelo cliente (link ou celular) fica marcada para
// o técnico (cliSigned = matrícula, índice esparso) até ele tocar em "OK" — dá tempo de baixar o PDF assinado.
// Também quando o cliente assina no celular. Em tempo real; sai sozinha da tela quando o engenheiro assina.
export function subscribeClientSignedOrders(matricula: string, onChange: (list: WorkOrder[]) => void): () => void {
  if (!firebaseActive || !dbInstance || !matricula) {
    onChange([]);
    return () => {};
  }
  return onSnapshot(
    query(collection(dbInstance, 'workOrders'), where('cliSigned', '==', matricula)),
    (snap) => onChange(snap.docs.map((d) => ({ ...(d.data() as WorkOrder), id: d.id }))),
    (err) => {
      console.warn('Não foi possível acompanhar as OS assinadas pelo cliente:', err);
      checkQuotaException(err);
      onChange([]);
    }
  );
}
export async function dbDismissClientSigned(o: WorkOrder): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  await updateDoc(doc(dbInstance, 'workOrders', o.id), { cliSigned: deleteField() });
}
// Ajuste S5 (simulação geral): os avisos que o engenheiro já assinou saem num pacote só (1 gravação para o
// disjuntor, até 400 OS por pacote). Quem chama não tenta de novo na hora se o banco recusar.
export async function dbDismissClientSignedMany(orders: WorkOrder[]): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  for (let i = 0; i < orders.length; i += 400) {
    const batch = writeBatch(dbInstance);
    orders.slice(i, i + 400).forEach((o) => batch.update(doc(dbInstance!, 'workOrders', o.id), { cliSigned: deleteField() }));
    await batch.commit();
  }
}

// ===== Resposta à contestação =====
// Depois da assinatura do técnico nada do que foi lançado muda: a resposta só ACRESCENTA (perguntas ainda sem
// resposta, pessoas na equipe, materiais, horas extras e diárias de pernoite).
export interface OsExecAdditions {
  answers: Record<string, any>;            // só perguntas que estavam sem resposta
  team: WorkOrderExec['team'];             // pessoas novas
  materials: WorkOrderExec['materials'];   // materiais (mesmo material = soma a quantidade)
  overtime: WorkOrderExec['overtime'];     // dias de hora extra (mesmo dia = soma as horas)
  overnightNights: number | null;          // diárias a mais
}

const emptyAnswer = (v: any) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
const fmtMin = (m: number) => `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}`;

export function mergeExecAdditions(base: WorkOrderExec, add: OsExecAdditions, fields: OsTemplateField[]): { exec: WorkOrderExec; added: string } {
  const parts: string[] = [];
  const answers = { ...base.answers };
  const answered: string[] = [];
  Object.entries(add.answers || {}).forEach(([id, v]) => {
    if (emptyAnswer(v) || !emptyAnswer(answers[id])) return;
    answers[id] = v;
    answered.push(fields.find((f) => f.id === id)?.label || id);
  });
  if (answered.length) parts.push(`respostas: ${answered.join(', ')}`);

  const team = [...base.team];
  const newPeople = (add.team || []).filter((p) => !team.some((x) => x.matricula === p.matricula));
  team.push(...newPeople);
  if (newPeople.length) parts.push(`equipe: ${newPeople.map((p) => p.name).join(', ')}`);

  const materials = base.materials.map((m) => ({ ...m }));
  const matText: string[] = [];
  (add.materials || []).filter((m) => m.qty > 0).forEach((m) => {
    const same = materials.find((x) => x.id === m.id);
    if (same) same.qty = Math.round((same.qty + m.qty) * 1000) / 1000;
    else materials.push({ ...m });
    matText.push(`${m.description} +${String(m.qty).replace('.', ',')} ${m.measureUnit}`);
  });
  if (matText.length) parts.push(`materiais: ${matText.join(', ')}`);

  let overtime = base.overtime ? base.overtime.map((d) => ({ ...d })) : null;
  const otText: string[] = [];
  (add.overtime || []).filter((d) => d.date && d.minutes > 0).forEach((d) => {
    overtime = overtime || [];
    const same = overtime.find((x) => x.date === d.date);
    if (same) {
      same.minutes += d.minutes;
      same.holiday = same.holiday || d.holiday;
    } else overtime.push({ ...d });
    otText.push(`${d.date.split('-').reverse().join('/')} +${fmtMin(d.minutes)}`);
  });
  if (otText.length) parts.push(`hora extra: ${otText.join(', ')}`);

  let overnightNights = base.overnightNights;
  if (add.overnightNights && add.overnightNights > 0) {
    overnightNights = (overnightNights || 0) + add.overnightNights;
    parts.push(`pernoite: +${add.overnightNights} diária(s)`);
  }
  return { exec: { ...base, answers, team, materials, overtime, overnightNights }, added: parts.join(' · ') };
}

// Responder a contestação: o que foi resolvido (+ acréscimos) → a OS volta para a vez do cliente
// (assinar no celular ou novo link). O homem-hora para de novo aqui ("workEndAt").
export async function dbReplyContest(o: WorkOrder, resolution: string, add: OsExecAdditions, by: string): Promise<WorkOrder> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const text = resolution.trim();
  if (!text) throw new Error('Informe o que foi resolvido.');
  const ref = doc(dbInstance, 'workOrders', o.id);
  return runTransaction(dbInstance, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('OS não encontrada.');
    const cur = { ...(snap.data() as WorkOrder), id: snap.id };
    if (cur.status !== 'Contestada') throw new Error('Esta OS não está mais contestada (alguém já respondeu).');
    if (!cur.techSignedAt || !cur.exec) throw new Error('Esta OS foi contestada antes da mudança: o técnico corrige e conclui de novo.');
    const now = new Date().toISOString();
    const { exec, added } = mergeExecAdditions(cur.exec, add, cur.templateFields || []);
    const contests = [...(cur.contests || [])];
    const last = contests.length ? contests[contests.length - 1] : null;
    const answer = cleanUndefined({ resolution: text, added: added || undefined, resolvedBy: by, resolvedAt: now });
    if (last && !last.resolvedAt) contests[contests.length - 1] = { ...last, ...answer };
    else contests.push({ reason: cur.contestReason || '', clientName: 'Cliente', at: cur.contestedAt || now, ...answer });
    const next: OsSignatureRole = nextSignerAfter(cur, 'tecnico') || 'cliente';
    const qk = queueKey(cur, next);
    const updates: any = {
      status: 'Aguardando assinaturas',
      nextSigner: next,
      contests,
      workEndAt: now,
      updatedAt: now,
      timeline: arrayUnion(ev(by, 'Contestação respondida', `${text}${added ? ` · Acrescentado: ${added}` : ''}`))
    };
    if (qk) updates.signQueue = qk;
    if (added) updates.exec = cleanUndefined({ ...exec, updatedAt: now, updatedBy: by });
    tx.update(ref, updates);
    return { ...cur, status: 'Aguardando assinaturas', nextSigner: next, signQueue: qk || undefined, contests, workEndAt: now, exec: added ? { ...exec, updatedAt: now, updatedBy: by } : cur.exec } as WorkOrder;
  });
}
