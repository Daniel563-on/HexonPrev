import { arrayUnion, collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { LaborRate } from '../types';
import { firebaseActive, dbInstance, checkQuotaException } from './core';

// CUSTO HOMEM-HORA: um documento por profissional (laborRates/{userId}).
// Fica fora do cadastro de usuários porque esse cadastro é lido por toda a equipe;
// aqui só o Super Administrador lê e grava (regras do Firestore).

export async function dbGetLaborRates(): Promise<Record<string, LaborRate>> {
  if (!firebaseActive || !dbInstance) return {};
  try {
    const snap = await getDocs(collection(dbInstance, 'laborRates'));
    const map: Record<string, LaborRate> = {};
    snap.forEach((d) => {
      map[d.id] = { userId: d.id, history: [], ...(d.data() as any) } as LaborRate;
    });
    return map;
  } catch (err: any) {
    console.warn('Não foi possível ler o custo homem-hora:', err);
    checkQuotaException(err);
    return {};
  }
}

// Grava o valor atual e acrescenta a alteração ao histórico
export async function dbSaveLaborRate(
  userId: string,
  hourlyRate: number,
  saturdayPct: number,
  validFrom: string,
  changedBy: string
): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const now = new Date().toISOString();
  await setDoc(
    doc(dbInstance, 'laborRates', userId),
    {
      userId,
      hourlyRate,
      saturdayPct,
      validFrom,
      updatedAt: now,
      updatedBy: changedBy,
      history: arrayUnion({ hourlyRate, saturdayPct, validFrom, changedAt: now, changedBy })
    },
    { merge: true }
  );
}
