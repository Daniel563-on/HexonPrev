import React from 'react';
import { OsStage, WorkOrder } from '../../types';
import { osAnswerText, osFieldVisible, stageItems } from '../../db/firebase';

// RESPOSTAS DA OS (somente leitura): perguntas do modelo copiado na emissão, da etapa pedida.
// Perguntas escondidas pela condição não aparecem. Na execução, Equipe e Materiais têm bloco próprio.

export const STATUS_STYLE: Record<string, string> = {
  Nova: 'bg-slate-100 text-slate-700',
  'Em andamento': 'bg-amber-100 text-amber-800',
  Pendente: 'bg-orange-100 text-orange-800',
  'Aguardando assinaturas': 'bg-indigo-100 text-indigo-800',
  Contestada: 'bg-rose-100 text-rose-800',
  'Concluída': 'bg-emerald-100 text-emerald-800',
  Cancelada: 'bg-rose-100 text-rose-700'
};
export const dayBR = (s?: string) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—');

// Atrasada: passou do prazo e ainda não foi concluída nem cancelada
export const isOverdue = (o: WorkOrder) => {
  if (!o.deadline || o.status === 'Concluída' || o.status === 'Cancelada') return false;
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return o.deadline < `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export default function OsAnswersView({ order, stage }: { order: WorkOrder; stage: OsStage }) {
  const answers = stage === 'criacao' ? order.answers || {} : order.exec?.answers || {};
  const items = stageItems(order.templateFields || [], order.templateSystemFields || [], stage).filter((it) => {
    if (it.kind === 'field') return it.field.stage === stage && osFieldVisible(it.field, order.templateFields, answers);
    // Execução: equipe, materiais e homem-hora aparecem em blocos próprios
    return stage === 'criacao';
  });
  if (items.length === 0) return <p className="text-xs text-slate-400">Nenhuma resposta.</p>;
  return (
    <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
      {items.map((it) => {
        let value: any;
        if (it.kind === 'field') {
          value = answers[it.field.id];
          if (it.field.type === 'signature' && value) {
            return (
              <div key={it.field.id} className="p-2.5 grid grid-cols-[minmax(0,160px)_minmax(0,1fr)] gap-3 text-xs">
                <span className="font-bold text-slate-500">{it.field.label}</span>
                <img src={value} alt="Assinatura" className="h-16 border border-slate-200 rounded-lg bg-white" />
              </div>
            );
          }
          value = osAnswerText(it.field, value);
        } else if (it.sys.key === 'gerencia') value = order.unit;
        else if (it.sys.key === 'numeroOs') value = order.number;
        else if (it.sys.key === 'tecnico') value = order.assignedTechnicianName || 'Em aberto';
        else if (it.sys.key === 'enderecoExecucao')
          value = [order.execAddressText, order.comarca && `Comarca ${order.comarca}`, order.craai && `CRAAI ${order.craai}`].filter(Boolean).join(' · ');
        else if (it.sys.key === 'ativo') value = order.assetName ? `${order.assetCode} (vinculado: ${order.assetName})` : order.assetCode;
        else if (it.sys.key === 'prazo') value = order.deadline ? dayBR(order.deadline) : '';
        else value = order.answers?.[`sys:${it.sys.key}`];
        const text = value === undefined || value === null || value === '' ? '—' : String(value);
        return (
          <div key={it.kind === 'field' ? it.field.id : it.sys.key} className="p-2.5 grid grid-cols-[minmax(0,160px)_minmax(0,1fr)] gap-3 text-xs">
            <span className="font-bold text-slate-500">{it.kind === 'field' ? it.field.label : it.sys.label}</span>
            <span className="text-slate-800 whitespace-pre-wrap break-words">{text}</span>
          </div>
        );
      })}
    </div>
  );
}
