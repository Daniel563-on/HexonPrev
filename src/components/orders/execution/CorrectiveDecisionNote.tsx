import React from 'react';
import { ChecklistItem, formatDateBR } from '../../../types';

// ANDAMENTO DA SOLICITAÇÃO DE CORRETIVA DE UM ITEM (Etapa 8): aguardando, corretiva aberta (GLPI) ou não abrir
export default function CorrectiveDecisionNote({ item }: { item: ChecklistItem }) {
  const status = item.autoCorrectiveStatus;
  const edited = item.correctiveEditedBy ? ` • corrigido por ${item.correctiveEditedBy} em ${formatDateBR(item.correctiveEditedAt)}` : '';
  if (!status || status === 'Pendente') {
    return (
      <p className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
        Solicitação de corretiva: aguardando decisão do planejador
      </p>
    );
  }
  if (status === 'Resolvido') {
    return (
      <p className="text-[10px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
        Corretiva aberta • GLPI nº {item.correctiveTicket || '—'}
        <span className="font-semibold"> • por {item.correctiveBy || '—'} em {formatDateBR(item.correctiveAt)}{edited}</span>
      </p>
    );
  }
  return (
    <p className="text-[10px] font-bold text-slate-700 bg-slate-100 border border-slate-300 rounded px-2 py-1">
      Não abrir • {item.correctiveReason || '—'}
      <span className="font-semibold"> • por {item.correctiveBy || '—'} em {formatDateBR(item.correctiveAt)}{edited}</span>
    </p>
  );
}
