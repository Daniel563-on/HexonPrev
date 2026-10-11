import { collection, onSnapshot, query, where } from './guard';
import { WorkOrder } from '../types';
import { firebaseActive, dbInstance, checkQuotaException } from './core';

// INÍCIO › EQUIPE AGORA: chamados "Em andamento" e "Pendente" das gerências do resumo, em tempo real
// (com quem está cada um). Ao abrir lê só esses chamados; depois, 1 leitura por chamado que mudar.
export function subscribeTeamWorkOrders(units: string[], onChange: (list: WorkOrder[]) => void): () => void {
  if (!firebaseActive || !dbInstance || units.length === 0) {
    onChange([]);
    return () => {};
  }
  const parts = new Map<string, WorkOrder[]>();
  const emit = () => onChange(Array.from(parts.values()).flat());
  const stops = units.map((u) =>
    onSnapshot(
      query(collection(dbInstance!, 'workOrders'), where('unit', '==', u), where('status', 'in', ['Em andamento', 'Pendente'])),
      (snap) => {
        parts.set(u, snap.docs.map((d) => ({ ...(d.data() as WorkOrder), id: d.id })));
        emit();
      },
      (err) => {
        console.warn(`Não foi possível acompanhar os chamados da equipe (${u}):`, err);
        checkQuotaException(err);
      }
    )
  );
  return () => stops.forEach((s) => s());
}
