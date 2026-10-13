import { doc, getDoc } from './guard';
import { OrderParticipant, OrderTimelineEvent, UsualTeam } from '../types';
import { firebaseActive, dbInstance, cleanUndefined, checkQuotaException } from './core';
import { onSyncChange, syncedList } from './localSync';

// EXECUÇÃO (Etapa 6.2): pessoas da gerência (participantes), equipe habitual e linha do tempo da OS

// Evento da linha do tempo (guardado dentro da OS, aproveitando as gravações que já acontecem)
export const timelineEvent = (event: string, by?: string, detail?: string): OrderTimelineEvent =>
  cleanUndefined({ at: new Date().toISOString(), event, by, detail });

// Pessoas ativas da gerência: usuários com login + efetivo importado (sem repetir matrícula), com as empresas de cada um.
// Cópia guardada no aparelho (src/db/localSync.ts): baixa 1 vez e depois só o que mudou; na sessão fica na memória.
interface UnitPerson {
  p: OrderParticipant;
  companies: string[];
  login: boolean;   // usuário com login (efetivo importado não tem)
  perfil?: string;  // perfil do usuário (Profissional = técnico)
}
const peopleCache = new Map<string, Promise<UnitPerson[]>>();
// Usuário ou efetivo mudou (tempo real): a próxima leitura monta de novo a partir da cópia já atualizada
onSyncChange('users', () => peopleCache.clear());
onSyncChange('workforce', () => peopleCache.clear());
function unitPeople(unit: string): Promise<UnitPerson[]> {
  if (!unit || !firebaseActive || !dbInstance) return Promise.resolve([]);
  let p = peopleCache.get(unit);
  if (!p) {
    p = (async () => {
      const [users, workforce] = await Promise.all([
        syncedList<any>('users', unit, [['gerencia', unit]]),
        syncedList<any>('workforce', unit, [['unit', unit]])
      ]);
      const byMat = new Map<string, UnitPerson>();
      workforce.forEach((w) => {
        if (w.status === 'Ativo' && w.matricula)
          byMat.set(String(w.matricula), { p: { matricula: String(w.matricula), name: w.name, cargo: w.cargo || '' }, companies: w.company ? [w.company] : [], login: false });
      });
      users.forEach((u) => {
        if (u.status === 'Ativo' && u.matricula)
          byMat.set(String(u.matricula), {
            p: { matricula: String(u.matricula), name: u.name, cargo: u.cargo || '' },
            companies: Array.isArray(u.companies) ? u.companies : [],
            login: true,
            perfil: u.perfil
          });
      });
      return Array.from(byMat.values()).sort((a, b) => a.p.name.localeCompare(b.p.name));
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

export async function dbGetUnitPeople(unit: string): Promise<OrderParticipant[]> {
  return (await unitPeople(unit)).map((x) => x.p);
}

// Pessoas da gerência com empresas, login e perfil (Programação › Equipes, Fase 7A)
export interface UnitPersonInfo extends OrderParticipant {
  companies: string[];
  login: boolean;
  perfil?: string;
}
export async function dbGetUnitPeopleInfo(unit: string): Promise<UnitPersonInfo[]> {
  return (await unitPeople(unit)).map((x) => ({ ...x.p, companies: x.companies, login: x.login, perfil: x.perfil }));
}

// Empresas de uma pessoa da gerência (técnico = 1 empresa)
export async function dbGetPersonCompanies(unit: string, matricula: string): Promise<string[]> {
  return (await unitPeople(unit)).find((x) => x.p.matricula === matricula)?.companies || [];
}

// EQUIPE SÓ DA MESMA EMPRESA (etapa especial E2): pessoas da gerência que são da empresa de quem executa.
// Quem executa sem empresa cadastrada: todas as pessoas da gerência (como antes).
export async function dbGetTeamPeople(unit: string, executorMatricula: string | undefined): Promise<OrderParticipant[]> {
  const list = await unitPeople(unit);
  const mine = (executorMatricula && list.find((x) => x.p.matricula === executorMatricula)?.companies) || [];
  if (mine.length === 0) return list.map((x) => x.p);
  return list.filter((x) => x.companies.some((c) => mine.includes(c))).map((x) => x.p);
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

