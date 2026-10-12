import { collection, doc, getDocs, query, where, writeBatch } from './guard';
import { UsualTeam } from '../types';
import { firebaseActive, dbInstance, cleanUndefined } from './core';

// PROGRAMAÇÃO › EQUIPES (Fase 7A): a equipe é a equipe habitual do responsável (coleção "usualTeams", id = matrícula
// do responsável). Por isso a execução continua igual: os participantes da OS e da preventiva já vêm dessa equipe.
// Só quem tem "Programar" grava (regra do banco); o técnico só lê a dele.

// Equipes da gerência (1 leitura por equipe, ao abrir a tela)
export async function dbListTeams(unit: string): Promise<UsualTeam[]> {
  if (!firebaseActive || !dbInstance || !unit) return [];
  const snap = await getDocs(query(collection(dbInstance, 'usualTeams'), where('unit', '==', unit)));
  return snap.docs.map((d) => ({ ...(d.data() as UsualTeam), matricula: d.id }));
}

// Grava e apaga equipes num pacote só: trocar o responsável muda o id (apaga a antiga) e trazer alguém de
// outra equipe tira a pessoa de lá na mesma gravação (nunca fica alguém em duas equipes).
export async function dbSaveTeams(save: UsualTeam[], remove: string[] = []): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const db = dbInstance;
  const batch = writeBatch(db);
  const saving = new Set(save.map((t) => t.matricula));
  remove.filter((m) => !saving.has(m)).forEach((m) => batch.delete(doc(db, 'usualTeams', m)));
  save.forEach((t) => batch.set(doc(db, 'usualTeams', t.matricula), cleanUndefined(t)));
  await batch.commit();
}
