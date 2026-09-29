import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { OrderParticipant, OrderTimelineEvent, UsualTeam } from '../types';
import { firebaseActive, dbInstance, cleanUndefined, checkQuotaException } from './core';

// EXECUÇÃO (Etapa 6.2): pessoas da gerência (participantes), equipe habitual e linha do tempo da OS

// Evento da linha do tempo (guardado dentro da OS, aproveitando as gravações que já acontecem)
export const timelineEvent = (event: string, by?: string, detail?: string): OrderTimelineEvent =>
  cleanUndefined({ at: new Date().toISOString(), event, by, detail });

// Pessoas ativas da gerência: usuários com login + efetivo importado (sem repetir matrícula).
// Guardado na memória durante a sessão (lista muda pouco).
const peopleCache = new Map<string, Promise<OrderParticipant[]>>();
export function dbGetUnitPeople(unit: string): Promise<OrderParticipant[]> {
  if (!unit || !firebaseActive || !dbInstance) return Promise.resolve([]);
  let p = peopleCache.get(unit);
  if (!p) {
    const db = dbInstance;
    p = (async () => {
      const [usersSnap, wfSnap] = await Promise.all([
        getDocs(query(collection(db, 'users'), where('gerencia', '==', unit))),
        getDocs(query(collection(db, 'workforce'), where('unit', '==', unit)))
      ]);
      const byMat = new Map<string, OrderParticipant>();
      wfSnap.forEach((d) => {
        const w = d.data() as any;
        if (w.status === 'Ativo' && w.matricula) byMat.set(String(w.matricula), { matricula: String(w.matricula), name: w.name, cargo: w.cargo || '' });
      });
      usersSnap.forEach((d) => {
        const u = d.data() as any;
        if (u.status === 'Ativo' && u.matricula) byMat.set(String(u.matricula), { matricula: String(u.matricula), name: u.name, cargo: u.cargo || '' });
      });
      return Array.from(byMat.values()).sort((a, b) => a.name.localeCompare(b.name));
    })().catch((err) => {
      console.warn('Não foi possível ler as pessoas da gerência:', err);
      checkQuotaException(err);
      peopleCache.delete(unit);
      return [];
    });
    peopleCache.set(unit, p);
  }
  return p;
}

// Equipe habitual do técnico (1 leitura)
export async function dbGetUsualTeam(matricula: string): Promise<UsualTeam | null> {
  if (!matricula || !firebaseActive || !dbInstance) return null;
  try {
    const snap = await getDoc(doc(dbInstance, 'usualTeams', matricula));
    return snap.exists() ? (snap.data() as UsualTeam) : null;
  } catch (err: any) {
    console.warn('Não foi possível ler a equipe habitual:', err);
    checkQuotaException(err);
    return null;
  }
}

// Salva a equipe habitual (o técnico ou o planejador; 1 gravação)
export async function dbSaveUsualTeam(team: UsualTeam): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  await setDoc(doc(dbInstance, 'usualTeams', team.matricula), cleanUndefined(team));
}
