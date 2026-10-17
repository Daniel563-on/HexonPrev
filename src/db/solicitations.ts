import { ChecklistItem, ServiceOrder, isCorrectiveRequested } from '../types';
import { dbSaveServiceOrder } from './serviceOrders';
import { deleteField, doc, getDoc, updateDoc } from './guard';
import { awaitWrite, dbInstance, firebaseActive } from './core';

// SOLICITAÇÕES DE CORRETIVA (Etapa 8): decisão do planejador por item.
// "Abrir corretiva" = chamado aberto no GLPI (nº obrigatório); "Não abrir" = justificativa obrigatória.
// Grava só as respostas da OS concluída (o banco permite mudar isso nela). A decisão não muda depois:
// quem tem a permissão só pode corrigir o nº do GLPI ou o texto da justificativa.

export type CorrectiveDecision = 'open' | 'skip';

export const requestedItems = (o: ServiceOrder): ChecklistItem[] => (o.checklist || []).filter(isCorrectiveRequested);
export const isItemPending = (item: ChecklistItem) => !item.autoCorrectiveStatus || item.autoCorrectiveStatus === 'Pendente';

function withItem(order: ServiceOrder, itemId: string, patch: (item: ChecklistItem) => ChecklistItem): ServiceOrder {
  if (order.checklistPending) throw new Error('O checklist desta OS ainda está carregando. Aguarde e tente de novo.');
  const item = order.checklist.find((c) => c.id === itemId);
  if (!item || !isCorrectiveRequested(item)) throw new Error('Item de solicitação não encontrado nesta OS.');
  return {
    ...order,
    checklist: order.checklist.map((c) => (c.id === itemId ? patch(c) : c)),
    updatedAt: new Date().toISOString()
  };
}

// Decide um item ("Abrir corretiva" com nº do GLPI, ou "Não abrir" com justificativa)
export async function dbDecideCorrective(order: ServiceOrder, itemId: string, decision: CorrectiveDecision, text: string, by: string): Promise<ServiceOrder> {
  const value = text.trim();
  if (!value) throw new Error(decision === 'open' ? 'Informe o nº do chamado GLPI.' : 'Informe a justificativa.');
  const updated = withItem(order, itemId, (item) => {
    if (!isItemPending(item)) throw new Error('Este item já tem decisão.');
    return {
      ...item,
      autoCorrectiveStatus: decision === 'open' ? 'Resolvido' : 'Cancelado',
      correctiveTicket: decision === 'open' ? value : undefined,
      correctiveReason: decision === 'skip' ? value : undefined,
      correctiveBy: by,
      correctiveAt: new Date().toISOString()
    };
  });
  // U10: decidido o último item, o técnico passa a ver a resposta na aba Solicitações até tocar em "Ciente"
  const mat = (updated.assignedTechnicianMatricula || '').trim();
  const done = !requestedItems(updated).some(isItemPending);
  const notified: ServiceOrder = done && mat ? { ...updated, solNotice: mat } : updated;
  await dbSaveServiceOrder(notified, {}, { skipHistory: true });
  return notified;
}

// U10: "Ciente" do técnico na resposta do pedido de corretiva — sai da aba Solicitações dele (só os 2 campos mudam)
export async function dbAckSolicitation(orderId: string): Promise<'saved' | 'queued'> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  return awaitWrite(updateDoc(doc(dbInstance, 'serviceOrders', orderId), { solNotice: deleteField(), techSol: deleteField() }));
}

// Corrige o nº do GLPI ou a justificativa de um item já decidido (a decisão continua a mesma)
export async function dbFixCorrective(order: ServiceOrder, itemId: string, text: string, by: string): Promise<ServiceOrder> {
  const value = text.trim();
  const updated = withItem(order, itemId, (item) => {
    if (isItemPending(item)) throw new Error('Este item ainda não tem decisão.');
    const open = item.autoCorrectiveStatus === 'Resolvido';
    if (!value) throw new Error(open ? 'Informe o nº do chamado GLPI.' : 'Informe a justificativa.');
    return {
      ...item,
      correctiveTicket: open ? value : item.correctiveTicket,
      correctiveReason: open ? item.correctiveReason : value,
      correctiveEditedBy: by,
      correctiveEditedAt: new Date().toISOString()
    };
  });
  // U10: a correção não mexe no aviso ao técnico — vale o que está no banco (se ele já deu "Ciente", não volta;
  // se ainda não deu, continua), mesmo com a tela aberta numa cópia antiga
  let fixed: ServiceOrder = updated;
  if (firebaseActive && dbInstance) {
    const current = await getDoc(doc(dbInstance, 'serviceOrders', order.id))
      .then((snap) => (snap.exists() ? String(snap.data()?.solNotice || '') : null))
      .catch(() => null);
    if (current !== null) fixed = { ...updated, solNotice: current || undefined };
  }
  await dbSaveServiceOrder(fixed, {}, { skipHistory: true });
  return fixed;
}
