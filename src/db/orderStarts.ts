import { collection, deleteDoc, doc, getDocs, getDocsFromCache, onSnapshot, query, serverTimestamp, setDoc, where } from './guard';
import { HexonUser, ServiceOrder } from '../types';
import { firebaseActive, dbInstance, checkQuotaException, awaitWrite } from './core';
import { dbSaveServiceOrder } from './serviceOrders';
import { timelineEvent } from './executionTeam';

// EXECUÇÃO (Etapa 6.1): o início fica num registro pequeno à parte ("orderStarts/{número da OS}"),
// sem regravar a OS. Só existe enquanto a OS está em execução: ao concluir ou desfazer, o registro é apagado.
// Cada técnico só pode ter uma OS em execução por vez.
// Sem internet (Etapa 7): iniciar, desfazer e concluir ficam na fila do aparelho e sobem sozinhos quando a internet volta.

export interface OrderStart {
  orderId: string;
  unit: string;
  matricula: string;
  name: string;
  deviceStartedAt: string;   // hora do aparelho quando tocou em "Iniciar"
  serverStartedAt?: any;     // hora em que o servidor recebeu (Timestamp)
  offline?: boolean;         // iniciada sem internet (a hora do servidor será a da chegada, não a do início)
}

const toStart = (id: string, data: any): OrderStart => ({ ...(data as OrderStart), orderId: id });
export const startServerIso = (s: OrderStart | null | undefined): string | undefined =>
  s?.serverStartedAt && typeof s.serverStartedAt.toDate === 'function' ? s.serverStartedAt.toDate().toISOString() : undefined;

// OS em execução do próprio técnico (no máximo 1). "online" = o banco está conectado ao servidor agora
export function subscribeMyActiveStart(matricula: string, cb: (s: OrderStart | null, online: boolean) => void): () => void {
  if (!firebaseActive || !dbInstance || !matricula) {
    cb(null, true);
    return () => {};
  }
  return onSnapshot(
    query(collection(dbInstance, 'orderStarts'), where('matricula', '==', matricula)),
    { includeMetadataChanges: true },
    (snap) => cb(snap.empty ? null : toStart(snap.docs[0].id, snap.docs[0].data()), !snap.metadata.fromCache),
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
// Retorna "queued" quando ficou no aparelho (sem internet).
export async function dbStartOrder(order: ServiceOrder, user: HexonUser, offline = false): Promise<{ start: OrderStart; result: 'saved' | 'queued' }> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const matricula = (user.matricula || '').trim();
  if (!matricula) throw new Error('Seu cadastro está sem matrícula. Procure o administrador.');
  const mineQuery = query(collection(dbInstance, 'orderStarts'), where('matricula', '==', matricula));
  const mine = await (offline ? getDocsFromCache(mineQuery) : getDocs(mineQuery));
  const other = mine.docs.find((d) => d.id !== order.id);
  if (other) throw new Error(`Você já tem a OS #${other.id} em execução. Conclua ou desfaça o início dela antes de iniciar outra.`);
  const start: OrderStart = {
    orderId: order.id,
    unit: order.unit || '',
    matricula,
    name: user.name,
    deviceStartedAt: new Date().toISOString(),
    ...(offline ? { offline: true } : {})
  };
  const result = await awaitWrite(setDoc(doc(dbInstance, 'orderStarts', order.id), { ...start, serverStartedAt: serverTimestamp() }));
  return { start, result };
}

// Desfazer o início (iniciou por engano): apaga o registro; o que foi preenchido no aparelho é descartado
export async function dbUndoStart(orderId: string): Promise<'saved' | 'queued'> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  return awaitWrite(deleteDoc(doc(dbInstance, 'orderStarts', orderId)));
}

// Concluir: 1 gravação da OS com tudo (respostas, horários, tempo, homem-hora, assinatura) e o registro de início é apagado.
// Tempo pela hora do celular (início → conclusão), que funciona sem internet; as horas do servidor ficam guardadas
// para conferência (horário divergente). Homem-hora = tempo × pessoas (quem executa + participantes).
export async function dbCompleteOrder(
  order: ServiceOrder,
  start: OrderStart | null,
  offline = false
): Promise<{ result: 'saved' | 'queued'; completed: ServiceOrder }> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const completedAt = new Date().toISOString();
  const startedAt = start?.deviceStartedAt || order.startedAt;
  const durationMin = startedAt ? Math.max(0, Math.round((Date.parse(completedAt) - Date.parse(startedAt)) / 60000)) : undefined;
  const people = Math.max(1, (order.participants || []).length);
  const completed: ServiceOrder = {
    ...order,
    status: 'Concluída',
    startedAt,
    startedAtServer: startServerIso(start) || order.startedAtServer,
    startedBy: start ? { matricula: start.matricula, name: start.name } : order.startedBy,
    completedAt,
    durationMin,
    manMinutes: durationMin !== undefined ? durationMin * people : undefined,
    execOffline: offline || !!start?.offline || (!!start && !start.serverStartedAt) ? true : undefined
  };
  // Linha do tempo: início e conclusão entram na mesma gravação
  completed.timeline = [
    ...(order.timeline || []),
    ...(start ? [{ ...timelineEvent('Iniciada', start.name), at: start.deviceStartedAt }] : []),
    { ...timelineEvent('Concluída', order.signedBy || start?.name), at: completedAt }
  ];
  const result = await dbSaveServiceOrder(completed, { completedAtServer: serverTimestamp() });
  if (start) await awaitWrite(deleteDoc(doc(dbInstance, 'orderStarts', order.id))).catch(() => {});
  return { result, completed };
}
