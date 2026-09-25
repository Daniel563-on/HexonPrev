const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();
const DB_ID = 'ai-studio-f520b7fc-edf5-4548-b2db-299670f2da9a';
const db = getFirestore(DB_ID);
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

// 1) ROTINA DE PRAZOS — todo dia às 02:00
// Marca "Atrasada" (janela do técnico venceu) e "Não Executada" (período do Super Admin venceu).
exports.dailyDeadlines = onSchedule({ ...SCHEDULE_OPTIONS, schedule: '0 2 * * *' }, async () => {
  const today = todayBR();
  const snap = await db.collection('serviceOrders').where('status', 'in', OPEN_STATUSES).get();
  const updatedAt = new Date().toISOString();
  let batch = db.batch();
  let pending = 0;
  let changed = 0;
  for (const d of snap.docs) {
    const o = d.data();
    const status = computeDeadlineStatus(o, today);
    if (status === o.status) continue;
    const fields = { status, updatedAt };
    // Mês de encerramento: a OS "Não Executada" conta no mês em que terminou o período
    if (status === 'Não Executada') fields.closedMonth = (o.endDate || today).slice(0, 7);
    batch.update(d.ref, fields);
    changed++;
    if (++pending === 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();
  console.log(`[Prazos] ${today}: ${snap.size} OS abertas verificadas, ${changed} atualizadas.`);
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

// 2) FECHAMENTO DO MÊS — dia 1º às 03:30 (depois da rotina de prazos)
// Grava o resumo congelado do mês anterior. O mês da OS é o mês em que termina o período do
// Super Admin (endDate). Um documento por gerência: monthlySummaries/{AAAA-MM}__{GERENCIA}.
exports.monthlyClosing = onSchedule({ ...SCHEDULE_OPTIONS, schedule: '30 3 1 * *' }, async () => {
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
    const sector = o.sector || 'Sem gerência';
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
