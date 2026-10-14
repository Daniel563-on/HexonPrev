const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp();
const DB_ID = 'ai-studio-f520b7fc-edf5-4548-b2db-299670f2da9a';
// No emulador (testes) usa o banco padrão; publicado, o banco do app
const db = getFirestore(process.env.FUNCTIONS_EMULATOR === 'true' ? '(default)' : DB_ID);
const TEMP_PASSWORD = '123456';

function matriculaToAuthEmail(matricula) {
  return String(matricula).trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_') + '@hexon.corp';
}

exports.resetUserPassword = onCall({ region: 'us-central1', serviceAccount: 'hexon-functions@core-philosophy-lr5vm.iam.gserviceaccount.com', invoker: 'public' }, async (request) => {
  const auth = request.auth;
  if (!auth || !auth.uid || auth.token?.firebase?.sign_in_provider === 'anonymous') {
    throw new HttpsError('unauthenticated', 'É necessário estar logado.');
  }

  // 1) Quem chamou precisa ser Super Administrador ativo e vinculado
  const idx = await db.doc(`authIndex/${auth.uid}`).get();
  const callerId = idx.exists ? idx.get('userId') : null;
  const caller = callerId ? await db.doc(`users/${callerId}`).get() : null;
  if (!caller || !caller.exists ||
      caller.get('authUid') !== auth.uid ||
      caller.get('status') !== 'Ativo' ||
      caller.get('perfil') !== 'Super Administrador') {
    throw new HttpsError('permission-denied', 'Apenas Super Administrador pode redefinir senhas.');
  }

  // 2) Usuário alvo
  const userId = request.data && request.data.userId;
  if (typeof userId !== 'string' || !userId) {
    throw new HttpsError('invalid-argument', 'userId inválido.');
  }
  const target = await db.doc(`users/${userId}`).get();
  if (!target.exists) throw new HttpsError('not-found', 'Cadastro não encontrado.');
  const matricula = target.get('matricula');
  if (!matricula) throw new HttpsError('failed-precondition', 'Cadastro sem matrícula.');
  const email = matriculaToAuthEmail(matricula);

  // 3) Redefine a senha (ou cria a conta se não existir)
  let uid;
  try {
    const existing = await getAuth().getUserByEmail(email);
    await getAuth().updateUser(existing.uid, { password: TEMP_PASSWORD });
    uid = existing.uid;
  } catch (e) {
    if (e && e.code === 'auth/user-not-found') {
      const created = await getAuth().createUser({ email, password: TEMP_PASSWORD });
      uid = created.uid;
    } else {
      console.error('Falha ao redefinir senha', e);
      throw new HttpsError('internal', 'Falha ao redefinir a senha.');
    }
  }

  // 4) Derruba sessões abertas do usuário, vincula e registra auditoria
  await getAuth().revokeRefreshTokens(uid);
  await db.doc(`users/${userId}`).update({ authUid: uid });
  await db.doc(`authIndex/${uid}`).set({ userId });
  await db.collection('auditLogs').add({
    userMatricula: caller.get('matricula'),
    userName: caller.get('name'),
    action: 'Redefiniu Senha',
    target: `users/${userId}`,
    details: `Redefiniu a senha do colaborador ${target.get('name')} (Matrícula: ${matricula}) para a senha provisória`,
    timestamp: new Date().toISOString()
  });

  return { ok: true };
});

// ============================================================================
// FUNÇÕES AGENDADAS (rodam sozinhas no servidor, horário de Brasília)
// ============================================================================
const { onSchedule } = require('firebase-functions/v2/scheduler');

const SCHEDULE_OPTIONS = {
  region: 'us-central1',
  timeZone: 'America/Sao_Paulo',
  serviceAccount: 'hexon-functions@core-philosophy-lr5vm.iam.gserviceaccount.com',
  timeoutSeconds: 540,
  memory: '1GiB'
};
const OPEN_STATUSES = ['Novo', 'Planejada', 'Em Execução', 'Atrasada'];

// Data de hoje (AAAA-MM-DD) no horário de Brasília
function todayBR() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

// Mesma regra de prazos do app (src/db/serviceOrders.ts → computeDeadlineStatus)
function computeDeadlineStatus(o, todayStr) {
  if (o.status === 'Concluída') return o.status;
  if (o.endDate && todayStr > o.endDate) return 'Não Executada';
  const executionDeadline = o.scheduledEndDate || o.scheduledDate;
  const windowExpired = !!(executionDeadline && todayStr > executionDeadline);
  if (o.status === 'Não Executada') {
    if (windowExpired) return 'Atrasada';
    return o.scheduledDate ? 'Planejada' : 'Novo';
  }
  if (o.status === 'Planejada' && windowExpired) return 'Atrasada';
  if (o.status === 'Atrasada' && !windowExpired) return executionDeadline ? 'Planejada' : 'Novo';
  return o.status;
}

// 1) ROTINA DE PRAZOS — todo dia às 00:00 (logo que o dia vira: prazo vencido ontem já não pode ser executado)
// Marca "Atrasada" (janela do técnico venceu) e "Não Executada" (período do Super Admin venceu).
exports.dailyDeadlines = onSchedule({ ...SCHEDULE_OPTIONS, schedule: '0 0 * * *' }, async () => {
  const today = todayBR();
  // Lê só as OS que podem mudar hoje (não todas as abertas):
  // a) abertas com o prazo do Super Admin vencido  -> "Não Executada"  (campo de controle openEnd, índice esparso)
  // b) "Planejada" com o dia programado já passado -> "Atrasada"       (campo de controle plannedEnd, índice esparso)
  // (Atrasada remarcada e Não Executada com prazo prorrogado são acertadas pelo app ao gravar a OS.)
  const [expiredSnap, lateSnap] = await Promise.all([
    db.collection('serviceOrders').where('openEnd', '<', today).get(),
    db.collection('serviceOrders').where('plannedEnd', '<', today).get()
  ]);
  const seen = new Set();
  const docs = [...expiredSnap.docs, ...lateSnap.docs].filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
  const snap = { docs, size: docs.length };
  // OS em execução agora (registro de início): não vira "Atrasada"; se o período venceu, vira
  // "Não Executada" e o início é apagado (sai da execução do técnico)
  const startsSnap = await db.collection('orderStarts').get();
  const started = new Set(startsSnap.docs.map((d) => d.id));
  const updatedAt = new Date().toISOString();
  let batch = db.batch();
  let pending = 0;
  let changed = 0;
  let closedStarts = 0;
  for (const d of snap.docs) {
    const o = d.data();
    const status = computeDeadlineStatus(o, today);
    if (status === o.status) continue;
    if (status === 'Atrasada' && started.has(d.id)) continue;
    const fields = { status, updatedAt, syncAt: FieldValue.serverTimestamp() };
    // Campos de controle (mesma regra do app, src/db/orderControl.ts): fechada perde os de OS aberta;
    // Atrasada deixa de ser "Planejada"
    if (status === 'Não Executada') {
      for (const k of ['unitOpen', 'openEnd', 'plannedEnd', 'techOpen']) fields[k] = FieldValue.delete();
    } else if (status === 'Atrasada') {
      fields.plannedEnd = FieldValue.delete();
    }
    // Mês de encerramento: a OS "Não Executada" conta no mês em que terminou o período
    if (status === 'Não Executada') fields.closedMonth = (o.endDate || today).slice(0, 7);
    batch.update(d.ref, fields);
    pending++;
    changed++;
    if (status === 'Não Executada' && started.has(d.id)) {
      batch.delete(db.doc(`orderStarts/${d.id}`));
      pending++;
      closedStarts++;
    }
    if (pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();
  console.log(`[Prazos] ${today}: ${snap.size} OS candidatas lidas, ${changed} atualizadas, ${closedStarts} em execução encerradas.`);
});

// Resultado da OS para os gráficos (mesma regra do Dashboard):
// P = concluída no dia agendado; A = concluída dentro do período, fora do dia agendado; N = não realizada
function resultOf(o) {
  if (o.status !== 'Concluída') return 'N';
  const exec = o.signedAt ? String(o.signedAt).slice(0, 10) : '';
  if (!exec) return 'N';
  const inRange = o.startDate && o.endDate ? exec >= o.startDate && exec <= o.endDate : true;
  if (!inRange) return 'N';
  return o.scheduledDate && exec === o.scheduledDate ? 'P' : 'A';
}

function sectorToken(value) {
  return String(value || 'SEM_GERENCIA')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase() || 'SEM_GERENCIA';
}

// 2) FECHAMENTO DO MÊS — dia 1º às 00:10 (logo depois da rotina de prazos das 00:00)
// Grava o resumo congelado do mês anterior. O mês da OS é o mês em que termina o período do
// Super Admin (endDate). Um documento por gerência: monthlySummaries/{AAAA-MM}__{GERENCIA}.
exports.monthlyClosing = onSchedule({ ...SCHEDULE_OPTIONS, schedule: '10 0 1 * *' }, async () => {
  const [y, m] = todayBR().split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1));
  const month = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
  const snap = await db.collection('serviceOrders')
    .where('endDate', '>=', `${month}-01`)
    .where('endDate', '<=', `${month}-31`)
    .get();

  // Agrupa por gerência e, dentro dela, por periodicidade + técnico + CRAAI + comarca + resultado
  const bySector = new Map();
  for (const d of snap.docs) {
    const o = d.data();
    if (o.status === 'Cancelada') continue; // OS cancelada (ativo baixado) não entra nas estatísticas
    const sector = o.unit || o.sector || 'Sem gerência'; // gerência da OS (o mesmo que o Dashboard filtra)
    if (!bySector.has(sector)) bySector.set(sector, new Map());
    const rows = bySector.get(sector);
    const row = {
      p: o.periodicity || '',
      t: o.assignedTechnician || '',
      c: o.craai || '',
      m: o.comarca || o.surveyLocation || '',
      r: resultOf(o)
    };
    const key = `${row.p}|${row.t}|${row.c}|${row.m}|${row.r}`;
    const current = rows.get(key);
    if (current) current.n++;
    else rows.set(key, { ...row, n: 1 });
  }

  const generatedAt = new Date().toISOString();
  for (const [sector, rows] of bySector) {
    const list = Array.from(rows.values());
    await db.doc(`monthlySummaries/${month}__${sectorToken(sector)}`).set({
      month,
      sector,
      total: list.reduce((acc, r) => acc + r.n, 0),
      rows: list,
      generatedAt
    });
  }
  console.log(`[Fechamento] ${month}: ${snap.size} OS resumidas em ${bySector.size} gerência(s).`);
});

// ============================================================================
// ZERAR O BANCO (Configurações › Sistema, só Super Administrador) — ajuste A2
// "movimento" (testes): apaga OS, preventivas, chamados, programação, pedidos, numeração e avisos;
//   mantém usuários, cadastros, Auditoria e início do ciclo oficial.
// "implantacao": o mesmo + Auditoria, registros de acesso, início do ciclo oficial e usuários
//   (ficam só os Super Administradores, com os logins deles).
// Ficam sempre: empresas, gerências, perfis, ativos e tipos, endereços, modelos (preventiva, OS, PDF,
// etiqueta) e as versões congeladas, materiais, insumos, efetivo, cargos, regras de HE, pernoite,
// equipes habituais, almoxarifados, logo/tela de login (appControl), config e o painel do Histórico GLPI.
// Andamento em appControl/reset (a tela escuta). Durante o zerar o modo manutenção fica ligado; no fim
// grava appControl/status.resetAt (e resetUsersAt na implantação) e cada aparelho apaga a própria cópia.
// Exige a palavra "ZERAR" e Super Administrador ativo; um zerar de cada vez.
// ============================================================================
const RESET_GROUPS = [
  { key: 'preventivas', label: 'Preventivas e vistorias (com assinaturas, insumos lançados e registro do disparo)', colls: ['serviceOrders', 'orderSignatures', 'orderSupplies', 'orderStarts', 'orderDeletions', 'dispatchIndex'] },
  { key: 'historicos', label: 'Histórico dos ativos', colls: ['histories'] },
  { key: 'resumos', label: 'Resumos do mês', colls: ['monthlySummaries'] },
  { key: 'chamados', label: 'Chamados GLPI (com assinaturas e validações do cliente)', colls: ['workOrders', 'workOrderSignatures', 'osValidations'] },
  { key: 'programacao', label: 'Programação (blocos, semanas, ausências)', colls: ['planningLots', 'weekPlans', 'absences', 'planningDeadlines'] },
  { key: 'pedidos', label: 'Pedidos de material e de insumos', colls: ['materialRequests', 'supplyRequests'] },
  { key: 'numeracao', label: 'Numeração dos chamados e pedidos (volta para 1)', colls: ['counters'] },
  { key: 'avisos', label: 'Quadro de Avisos (avisos, imagens, PDFs e "ciente")', colls: ['notices', 'noticeImages', 'noticeFiles'], reads: true },
  { key: 'registros', label: 'Auditoria e registros de acesso', colls: ['auditLogs', 'accessLogs'], onlyDeploy: true },
  { key: 'ciclo', label: 'Início do ciclo oficial das gerências', colls: ['cycleSettings'], onlyDeploy: true },
  { key: 'usuarios', label: 'Usuários (ficam só os Super Administradores)', users: true, onlyDeploy: true }
];
const RESET_MODES = { movimento: 'Limpar movimento (testes)', implantacao: 'Zerar para implantação' };
const RESET_PAGE = 400;

// Quem chamou precisa ser Super Administrador ativo e vinculado (mesma conferência da redefinição de senha)
async function requireSuperAdmin(request) {
  const auth = request.auth;
  if (!auth || !auth.uid || auth.token?.firebase?.sign_in_provider === 'anonymous') {
    throw new HttpsError('unauthenticated', 'É necessário estar logado.');
  }
  const idx = await db.doc(`authIndex/${auth.uid}`).get();
  const callerId = idx.exists ? idx.get('userId') : null;
  const caller = callerId ? await db.doc(`users/${callerId}`).get() : null;
  if (!caller || !caller.exists ||
      caller.get('authUid') !== auth.uid ||
      caller.get('status') !== 'Ativo' ||
      caller.get('perfil') !== 'Super Administrador') {
    throw new HttpsError('permission-denied', 'Apenas Super Administrador pode zerar o banco.');
  }
  return { uid: auth.uid, id: caller.id, name: caller.get('name') || '', matricula: caller.get('matricula') || '' };
}

// Implantação: saem todos os usuários menos os Super Administradores, e os logins que não são deles
async function resetUsersPlan(callerUid) {
  const users = await db.collection('users').get();
  const keep = users.docs.filter((d) => d.get('perfil') === 'Super Administrador');
  const drop = users.docs.filter((d) => d.get('perfil') !== 'Super Administrador');
  const keepIds = new Set(keep.map((d) => d.id));
  const index = await db.collection('authIndex').get();
  const indexDrop = index.docs.filter((d) => !keepIds.has(d.get('userId')));
  const keepUids = new Set([callerUid]);
  keep.forEach((d) => d.get('authUid') && keepUids.add(d.get('authUid')));
  index.docs.forEach((d) => keepIds.has(d.get('userId')) && keepUids.add(d.id));
  const keepEmails = new Set(keep.map((d) => d.get('matricula')).filter(Boolean).map(matriculaToAuthEmail));
  const loginsDrop = [];
  let pageToken;
  do {
    const page = await getAuth().listUsers(1000, pageToken);
    page.users.forEach((u) => {
      if (!keepUids.has(u.uid) && !(u.email && keepEmails.has(u.email.toLowerCase()))) loginsDrop.push(u.uid);
    });
    pageToken = page.pageToken;
  } while (pageToken);
  return { keep, drop, indexDrop, loginsDrop };
}

async function countColl(ref) {
  const snap = await ref.count().get();
  return snap.data().count || 0;
}

// Quanto cada grupo vai apagar (contagem do servidor, sem baixar os documentos)
async function resetCounts(groups, callerUid) {
  const out = [];
  let users = null;
  for (const g of groups) {
    const row = { key: g.key, label: g.label, count: 0 };
    if (g.users) {
      users = await resetUsersPlan(callerUid);
      row.count = users.drop.length;
      row.keepAdmins = users.keep.map((d) => d.get('name') || d.get('matricula') || d.id);
      row.logins = users.loginsDrop.length;
    } else {
      for (const c of g.colls) row.count += await countColl(db.collection(c));
      if (g.reads) {
        const notices = await db.collection('notices').select().get();
        for (const doc of notices.docs) row.count += await countColl(doc.ref.collection('reads'));
      }
    }
    out.push(row);
  }
  return { counts: out, users };
}

// Apaga uma coleção inteira em pacotes (só os nomes dos documentos são lidos)
async function deleteAll(ref, onPage) {
  for (;;) {
    const snap = await ref.select().limit(RESET_PAGE).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    await onPage(snap.size);
  }
}

// Apaga uma lista de documentos em pacotes
async function deleteRefs(refs, onPage) {
  for (let i = 0; i < refs.length; i += RESET_PAGE) {
    const part = refs.slice(i, i + RESET_PAGE);
    const batch = db.batch();
    part.forEach((r) => batch.delete(r));
    await batch.commit();
    await onPage(part.length);
  }
}

exports.resetDatabase = onCall({ region: 'us-central1', serviceAccount: 'hexon-functions@core-philosophy-lr5vm.iam.gserviceaccount.com', invoker: 'public', timeoutSeconds: 3600, memory: '1GiB' }, async (request) => {
  const caller = await requireSuperAdmin(request);
  const data = request.data || {};
  const mode = data.mode;
  if (!RESET_MODES[mode]) throw new HttpsError('invalid-argument', 'Modo inválido.');
  const groups = RESET_GROUPS.filter((g) => mode === 'implantacao' || !g.onlyDeploy);

  // 1) Só contar (nada é apagado)
  if (data.action === 'count') {
    const { counts } = await resetCounts(groups, caller.uid);
    return { groups: counts, total: counts.reduce((s, g) => s + g.count, 0) };
  }
  if (data.action !== 'run') throw new HttpsError('invalid-argument', 'Ação inválida.');
  if (data.confirm !== 'ZERAR') throw new HttpsError('failed-precondition', 'Digite ZERAR para confirmar.');

  // 2) Zerar (um de cada vez)
  const progressRef = db.doc('appControl/reset');
  const statusRef = db.doc('appControl/status');
  const current = await progressRef.get();
  if (current.exists && current.get('running') && Date.now() - (current.get('startedAtMs') || 0) < 65 * 60 * 1000) {
    throw new HttpsError('already-exists', 'Já tem um zerar em andamento.');
  }
  const startedAtMs = Date.now();
  const { counts, users } = await resetCounts(groups, caller.uid);
  const total = counts.reduce((s, g) => s + g.count, 0);
  const result = {};
  let done = 0;
  let lastWrite = 0;
  const progress = async (step, force) => {
    if (!force && Date.now() - lastWrite < 1500) return;
    lastWrite = Date.now();
    await progressRef.set({ done, step }, { merge: true });
  };
  await progressRef.set({
    running: true, ok: null, mode, modeLabel: RESET_MODES[mode], by: caller.name, byMatricula: caller.matricula,
    startedAt: new Date(startedAtMs).toISOString(), startedAtMs, total, done: 0, step: 'Ligando o modo manutenção', result: {}, error: ''
  });
  const before = (await statusRef.get()).data() || {};
  await statusRef.set({
    maintenance: true,
    maintenanceMessage: 'O Super Administrador está zerando o banco do sistema. Volte em alguns minutos.',
    updatedAt: new Date().toISOString(), updatedBy: caller.name
  }, { merge: true });

  const audit = (action, details) => {
    const id = `aud_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    return db.doc(`auditLogs/${id}`).set({
      id, userId: caller.id, userName: caller.name, userMatricula: caller.matricula,
      action, target: 'banco', details, timestamp: new Date().toISOString()
    });
  };
  // No fim (deu certo ou parou no meio): manutenção volta como estava e os aparelhos apagam a cópia guardada
  const finish = async () => {
    const now = Date.now();
    await statusRef.set({
      maintenance: !!before.maintenance,
      maintenanceMessage: before.maintenanceMessage || '',
      resetAt: now,
      ...(mode === 'implantacao' ? { resetUsersAt: now } : {}),
      updatedAt: new Date().toISOString(), updatedBy: caller.name
    }, { merge: true });
  };

  try {
    for (const g of groups) {
      const step = `Apagando: ${g.label}`;
      let n = 0;
      const onPage = async (k) => {
        n += k;
        done += k;
        await progress(step);
      };
      await progress(step, true);
      if (g.users) {
        await deleteRefs(users.drop.map((d) => d.ref), onPage);
        await deleteRefs(users.indexDrop.map((d) => d.ref), async () => {});
        let logins = 0;
        for (let i = 0; i < users.loginsDrop.length; i += 1000) {
          const r = await getAuth().deleteUsers(users.loginsDrop.slice(i, i + 1000));
          logins += r.successCount;
        }
        result.logins = logins;
      } else {
        if (g.reads) {
          const notices = await db.collection('notices').select().get();
          for (const doc of notices.docs) await deleteAll(doc.ref.collection('reads'), onPage);
        }
        for (const c of g.colls) await deleteAll(db.collection(c), onPage);
      }
      result[g.key] = n;
    }
    await audit('Banco zerado', `${RESET_MODES[mode]}: ${done} documentos apagados` +
      (mode === 'implantacao' ? ` (usuários: ${result.usuarios || 0}; logins: ${result.logins || 0}).` : '.'));
    await finish();
    await progressRef.set({ running: false, ok: true, done, step: 'Concluído', result, finishedAt: new Date().toISOString() }, { merge: true });
    return { ok: true, total: done, result };
  } catch (e) {
    console.error('Zerar o banco parou no meio', e);
    const msg = (e && e.message) || String(e);
    await finish().catch(() => {});
    await progressRef.set({ running: false, ok: false, done, result, error: msg, finishedAt: new Date().toISOString() }, { merge: true }).catch(() => {});
    await audit('Zerar o banco parou no meio', `${RESET_MODES[mode]}: ${done} documentos apagados antes do erro: ${msg}`).catch(() => {});
    throw new HttpsError('internal', `Parou no meio (${done} documentos já apagados): ${msg}. Pode rodar de novo para terminar.`);
  }
});
