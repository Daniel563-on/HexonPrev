import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { HexonUser, ServiceOrder } from '../types';
import { firebaseActive, dbInstance, checkQuotaException } from './core';
import { dbSaveServiceOrder } from './serviceOrders';

// EXECUÇÃO (Etapa 6.1): o início fica num registro pequeno à parte ("orderStarts/{número da OS}"),
// sem regravar a OS. Só existe enquanto a OS está em execução: ao concluir ou desfazer, o registro é apagado.
// Cada técnico só pode ter uma OS em execução por vez.

export interface OrderStart {
  orderId: string;
  unit: string;
  matricula: string;
  name: string;
  deviceStartedAt: string;   // hora do aparelho quando tocou em "Iniciar"
  serverStartedAt?: any;     // hora em que o servidor recebeu (Timestamp)
}

const toStart = (id: string, data: any): OrderStart => ({ ...(data as OrderStart), orderId: id });
export const startServerIso = (s: OrderStart | null | undefined): string | undefined =>
  s?.serverStartedAt && typeof s.serverStartedAt.toDate === 'function' ? s.serverStartedAt.toDate().toISOString() : undefined;

// OS em execução do próprio técnico (no máximo 1)
export function subscribeMyActiveStart(matricula: string, cb: (s: OrderStart | null) => void): () => void {
  if (!firebaseActive || !dbInstance || !matricula) {
    cb(null);
    return () => {};
  }
  return onSnapshot(
    query(collection(dbInstance, 'orderStarts'), where('matricula', '==', matricula)),
    (snap) => cb(snap.empty ? null : toStart(snap.docs[0].id, snap.docs[0].data())),
    (err) => {
      console.warn('Escuta da OS em execução interrompida:', err);
      checkQuotaException(err);
    }
  );
}

// OS em execução de uma gerência (planejador): poucos registros, só os que estão em andamento agora
export function subscribeUnitStarts(unit: string, cb: (starts: Map<string, OrderStart>) => void): () => void {
  if (!firebaseActive || !dbInstance || !unit) {
    cb(new Map());
    return () => {};
  }
  return onSnapshot(
    query(collection(dbInstance, 'orderStarts'), where('unit', '==', unit)),
    (snap) => {
      const map = new Map<string, OrderStart>();
      snap.forEach((d) => map.set(d.id, toStart(d.id, d.data())));
      cb(map);
    },
    (err) => {
      console.warn(`Escuta das OS em execução (${unit}) interrompida:`, err);
      checkQuotaException(err);
    }
  );
}

// Iniciar Preventiva (1 gravação pequena). Recusa se o técnico já tem outra OS em execução.
export async function dbStartOrder(order: ServiceOrder, user: HexonUser): Promise<OrderStart> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const matricula = (user.matricula || '').trim();
  if (!matricula) throw new Error('Seu cadastro está sem matrícula. Procure o administrador.');
  const mine = await getDocs(query(collection(dbInstance, 'orderStarts'), where('matricula', '==', matricula)));
  const other = mine.docs.find((d) => d.id !== order.id);
  if (other) throw new Error(`Você já tem a OS #${other.id} em execução. Conclua ou desfaça o início dela antes de iniciar outra.`);
  const start: OrderStart = {
    orderId: order.id,
    unit: order.unit || '',
    matricula,
    name: user.name,
    deviceStartedAt: new Date().toISOString()
  };
  await setDoc(doc(dbInstance, 'orderStarts', order.id), { ...start, serverStartedAt: serverTimestamp() });
  return start;
}

// Desfazer o início (iniciou por engano): apaga o registro; o que foi preenchido no aparelho é descartado
export async function dbUndoStart(orderId: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  await deleteDoc(doc(dbInstance, 'orderStarts', orderId));
}

// Concluir: 1 gravação da OS com tudo (respostas, horários, assinatura) e o registro de início é apagado
export async function dbCompleteOrder(order: ServiceOrder): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const snap = await getDoc(doc(dbInstance, 'orderStarts', order.id)).catch(() => null);
  const start = snap && snap.exists() ? toStart(snap.id, snap.data()) : null;
  const completed: ServiceOrder = {
    ...order,
    status: 'Concluída',
    startedAt: start?.deviceStartedAt || order.startedAt,
    startedAtServer: startServerIso(start) || order.startedAtServer,
    startedBy: start ? { matricula: start.matricula, name: start.name } : order.startedBy,
    completedAt: new Date().toISOString()
  };
  await dbSaveServiceOrder(completed, { completedAtServer: serverTimestamp() });
  if (start) await deleteDoc(doc(dbInstance, 'orderStarts', order.id)).catch(() => {});
}
