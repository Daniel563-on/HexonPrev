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
