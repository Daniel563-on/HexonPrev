import React, { useMemo, useState } from 'react';
import { HexonUser, OvernightRateSetting, PlanningLot, ServiceOrder } from '../../../types';
import { dbDetachOrderFromLot, dbSaveServiceOrder, lotOvernightCost, timelineEvent } from '../../../db/firebase';
import { formatOrderNumber } from '../../../utils/orderNumber';
import { dayBR, isOrderOfTechnician, isWeekend, scheduledRange, STATUS_STYLE } from './planningUtils';

// PROGRAMADAS NO PERÍODO: agrupadas por técnico. Ações (só OS não iniciadas): trocar técnico, remarcar, voltar para "Novo".
// Mexer numa OS sozinha a tira do lote (a parte do pernoite é redividida entre as que ficam).

interface Props {
  orders: ServiceOrder[];
  technicians: HexonUser[];
  lots: PlanningLot[];
  overnightRate: OvernightRateSetting | null;
  canViewCosts: boolean;
  locked: boolean;
  todayStr: string;
  canRevertUnexecutedOrder: (os: ServiceOrder) => boolean;
  onViewOrder: (os: ServiceOrder) => void;
  onChanged: (msg?: string) => void;
  userName?: string; // quem mexeu (linha do tempo da OS)
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function ScheduledList({ orders, technicians, lots, overnightRate, canViewCosts, locked, todayStr, canRevertUnexecutedOrder, onViewOrder, onChanged, userName }: Props) {
  const [editing, setEditing] = useState<{ id: string; mode: 'tech' | 'date' | 'revert' } | null>(null);
  const [newTech, setNewTech] = useState('');
  const [newStart, setNewStart] = useState('');
  const [newEnd, setNewEnd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Agrupa por técnico (pela matrícula; OS antigas pelo nome)
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; title: string; items: ServiceOrder[] }>();
    for (const o of orders) {
      const tech = technicians.find((t) => isOrderOfTechnician(o, t));
      // Mesmo técnico = um grupo só (OS com matrícula e OS antigas só com o nome)
      const key = tech ? `u:${tech.id}` : `n:${o.assignedTechnicianMatricula || o.assignedTechnician || '(sem técnico)'}`;
      const title = tech ? `${tech.name} (${tech.matricula})` : o.assignedTechnician || 'Sem técnico';
      const g = map.get(key) || { key, title, items: [] };
      g.items.push(o);
      map.set(key, g);
    }
    return Array.from(map.values()).sort((a, b) => a.title.localeCompare(b.title));
  }, [orders, technicians]);

  const canEdit = (o: ServiceOrder) =>
    !locked && (o.status === 'Planejada' || (o.status === 'Atrasada' && canRevertUnexecutedOrder(o)));

  const open = (o: ServiceOrder, mode: 'tech' | 'date' | 'revert') => {
    setError(null);
    setEditing({ id: o.id, mode });
    const r = scheduledRange(o);
    setNewStart(r && r[0] >= todayStr ? r[0] : todayStr);
    setNewEnd(r && r[1] >= todayStr ? r[1] : todayStr);
    setNewTech('');
  };

  const apply = async (o: ServiceOrder) => {
    if (!editing) return;
    setError(null);
    const base: ServiceOrder = { ...o, lotId: undefined, updatedAt: new Date().toISOString() };
    let updated: ServiceOrder;
    let msg = '';
    if (editing.mode === 'tech') {
      const t = technicians.find((x) => x.id === newTech);
      if (!t) return setError('Escolha o técnico.');
      updated = { ...base, assignedTechnician: t.name, assignedTechnicianMatricula: t.matricula };
      msg = `OS ${formatOrderNumber(o.id)} passou para ${t.name}.`;
    } else if (editing.mode === 'date') {
      if (!newStart || !newEnd || newEnd < newStart) return setError('Informe início e fim válidos.');
      if (newStart < todayStr) return setError('Não é possível agendar antes de hoje.');
      if (isWeekend(newStart) || isWeekend(newEnd)) return setError('Início e fim não podem cair em sábado ou domingo.');
      if ((o.startDate && newStart < o.startDate) || (o.endDate && newEnd > o.endDate)) {
        return setError(`Fora do prazo da OS (${dayBR(o.startDate || '')} a ${dayBR(o.endDate || '')}).`);
      }
      updated = { ...base, scheduledDate: newStart, scheduledEndDate: newEnd > newStart ? newEnd : undefined, status: 'Planejada' };
      msg = `OS ${formatOrderNumber(o.id)} remarcada para ${dayBR(newStart)}${newEnd > newStart ? ` a ${dayBR(newEnd)}` : ''}.`;
    } else {
      updated = { ...base, status: 'Novo', scheduledDate: '', scheduledEndDate: undefined, assignedTechnician: '', assignedTechnicianMatricula: undefined };
      msg = `OS ${formatOrderNumber(o.id)} voltou para "Novo".`;
    }
    // Linha do tempo da OS (vai na mesma gravação)
    const eventName = editing.mode === 'tech' ? 'Técnico trocado' : editing.mode === 'date' ? 'Remarcada' : 'Voltou para Novo';
    updated = { ...updated, timeline: [...(o.timeline || []), timelineEvent(eventName, userName, msg)] };
    setBusy(true);
    try {
      if (o.lotId) await dbDetachOrderFromLot(o);
      await dbSaveServiceOrder(updated);
      setEditing(null);
      onChanged(msg);
    } catch (err: any) {
      setError(`Não foi possível salvar: ${err?.message || err}`);
    } finally {
      setBusy(false);
    }
  };

  const field = 'h-8 px-2 text-xs border border-slate-200 rounded-lg bg-white font-semibold';

  return (
    <div className="space-y-4">
      {/* Lotes do período */}
      {lots.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Lotes do período</p>
          {lots.map((l) => {
            const cost = lotOvernightCost(l, overnightRate);
            return (
              <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-[11px]">
                <span className="font-bold text-slate-700">
                  {l.technicianName} • {dayBR(l.periodStart)}{l.periodEnd !== l.periodStart ? ` a ${dayBR(l.periodEnd)}` : ''} • {l.orderIds.length} OS
                </span>
                <span className="text-slate-600">
                  {l.overnight ? `${l.overnight.people} pessoa(s) × ${l.overnight.nights} pernoite(s)` : 'Sem pernoite'}
                  {canViewCosts && l.overnight && ` • ${brl(cost.total)} (${brl(cost.perOrder)} por OS)`}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {groups.length === 0 && <p className="text-xs text-slate-400 py-6 text-center">Nenhuma OS programada neste período.</p>}
      {error && <p className="text-xs font-bold text-rose-600">{error}</p>}

      {groups.map((g) => (
        <div key={g.key} className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <span className="text-xs font-black text-slate-800">{g.title}</span>
            <span className="text-[10px] font-bold text-slate-500">{g.items.length} OS</span>
          </div>
          <div className="divide-y divide-slate-100">
            {g.items.map((o) => {
              const r = scheduledRange(o);
              const st = STATUS_STYLE[o.status];
              const isEditing = editing?.id === o.id;
              return (
                <div key={o.id} className="px-3 py-2 text-xs space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-mono text-[10px] font-bold text-indigo-600">#{formatOrderNumber(o.id)}</span>
                      <p className="font-bold text-slate-800 truncate">{o.title}</p>
                      <p className="text-[10px] text-slate-500">
                        {r ? `${dayBR(r[0])}${r[1] !== r[0] ? ` a ${dayBR(r[1])}` : ''}` : '—'} • {o.comarca || o.surveyLocation || '—'}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      {st && <span className={`px-2 py-0.5 rounded-full border text-[9px] font-black uppercase ${st.chip}`}>{o.status}</span>}
                      <button type="button" onClick={() => onViewOrder(o)} className="h-7 px-2 rounded-md border border-slate-200 text-[10px] font-bold text-slate-600 cursor-pointer">Abrir</button>
                      {canEdit(o) && (
                        <>
                          <button type="button" onClick={() => open(o, 'tech')} className="h-7 px-2 rounded-md border border-slate-200 text-[10px] font-bold text-slate-600 cursor-pointer">Técnico</button>
                          <button type="button" onClick={() => open(o, 'date')} className="h-7 px-2 rounded-md border border-slate-200 text-[10px] font-bold text-slate-600 cursor-pointer">Remarcar</button>
                          <button type="button" onClick={() => open(o, 'revert')} className="h-7 px-2 rounded-md border border-amber-200 bg-amber-50 text-[10px] font-bold text-amber-800 cursor-pointer">Voltar p/ Novo</button>
                        </>
                      )}
                    </div>
                  </div>
                  {isEditing && (
                    <div className="flex flex-wrap items-end gap-2 p-2 rounded-lg bg-slate-50 border border-slate-200">
                      {editing!.mode === 'tech' && (
                        <select value={newTech} onChange={(e) => setNewTech(e.target.value)} className={field}>
                          <option value="">Novo técnico...</option>
                          {technicians.filter((t) => !o.company || (t.companies || []).includes(o.company)).map((t) => <option key={t.id} value={t.id}>{t.name} ({t.matricula})</option>)}
                        </select>
                      )}
                      {editing!.mode === 'date' && (
                        <>
                          <input type="date" value={newStart} min={todayStr} onChange={(e) => { setNewStart(e.target.value); if (newEnd < e.target.value) setNewEnd(e.target.value); }} className={field} />
                          <span className="text-[10px] text-slate-500 pb-2">até</span>
                          <input type="date" value={newEnd} min={newStart} onChange={(e) => setNewEnd(e.target.value)} className={field} />
                        </>
                      )}
                      {editing!.mode === 'revert' && <span className="text-[11px] text-slate-700 pb-1.5">Voltar esta OS para "Novo" (sem data e sem técnico)?</span>}
                      {o.lotId && <span className="w-full text-[10px] text-slate-500">A OS sai do lote; o pernoite do lote é redividido entre as que ficam.</span>}
                      <button type="button" onClick={() => setEditing(null)} disabled={busy} className="h-8 px-3 rounded-lg border border-slate-300 text-[11px] font-bold text-slate-600 cursor-pointer">Cancelar</button>
                      <button type="button" onClick={() => apply(o)} disabled={busy} className="h-8 px-3 rounded-lg bg-blue-600 text-white text-[11px] font-bold cursor-pointer disabled:opacity-50">
                        {busy ? 'Salvando...' : 'Confirmar'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
