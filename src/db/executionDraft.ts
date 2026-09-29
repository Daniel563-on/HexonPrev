import { ChecklistItem, ServiceOrder } from '../types';

// RASCUNHO DA EXECUÇÃO (Etapa 6.1): o que o técnico preenche fica só no aparelho até a assinatura.
// Nada vai para o banco enquanto ele preenche. Se não concluir (trocou de aparelho, apagou os dados), refaz o checklist.

interface ExecutionDraft {
  checklist: Pick<ChecklistItem, 'id' | 'checked' | 'checkedAt' | 'observations' | 'statusCheck' | 'autoCorrectiveAnswer'>[];
  notes: string;
  savedAt: string;
}

const key = (orderId: string) => `hexon_exec_draft_v1_${orderId}`;

export function saveExecutionDraft(order: ServiceOrder): void {
  try {
    const draft: ExecutionDraft = {
      checklist: (order.checklist || []).map((c) => ({
        id: c.id,
        checked: c.checked,
        checkedAt: c.checkedAt,
        observations: c.observations,
        statusCheck: c.statusCheck,
        autoCorrectiveAnswer: c.autoCorrectiveAnswer
      })),
      notes: order.notes || '',
      savedAt: new Date().toISOString()
    };
    localStorage.setItem(key(order.id), JSON.stringify(draft));
  } catch {
    // sem espaço ou bloqueado: segue só na memória
  }
}

export function hasExecutionDraft(orderId: string): boolean {
  try {
    return !!localStorage.getItem(key(orderId));
  } catch {
    return false;
  }
}

// Aplica o rascunho salvo sobre a OS (mesmo item pelo id)
export function applyExecutionDraft(order: ServiceOrder): ServiceOrder {
  try {
    const raw = localStorage.getItem(key(order.id));
    if (!raw) return order;
    const draft = JSON.parse(raw) as ExecutionDraft;
    const byId = new Map(draft.checklist.map((c) => [c.id, c]));
    return {
      ...order,
      checklist: (order.checklist || []).map((c) => {
        const d = byId.get(c.id);
        return d ? { ...c, ...d } : c;
      }),
      notes: draft.notes ?? order.notes
    };
  } catch {
    return order;
  }
}

export function clearExecutionDraft(orderId: string): void {
  try {
    localStorage.removeItem(key(orderId));
  } catch {}
}
