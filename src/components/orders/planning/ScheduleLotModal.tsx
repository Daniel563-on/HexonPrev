import React, { useMemo, useState } from 'react';
import { HexonUser, ServiceOrder } from '../../../types';
import { dbScheduleLot } from '../../../db/firebase';
import { dayBR, isOrderOfTechnician, overlaps, scheduledRange, weekdaysBetween } from './planningUtils';

// PROGRAMAR LOTE: período (da seleção no calendário) + técnico + pernoite. Grava tudo de uma vez.

interface Props {
  unit: string;
  orders: ServiceOrder[];          // OS selecionadas (todas "Novo", mesma unidade)
  allOrders: ServiceOrder[];       // para mostrar a carga de cada técnico no período
  technicians: HexonUser[];
  periodStart: string;
  periodEnd: string;
  userName: string;
  allowOvernight?: boolean; // a empresa das OS contabiliza pernoite (etapa especial E5)
  onClose: () => void;
  onDone: (msg: string) => void;
}

export default function ScheduleLotModal({ unit, orders, allOrders, technicians, periodStart, periodEnd, userName, allowOvernight = true, onClose, onDone }: Props) {
  const [techId, setTechId] = useState('');
  const [hasOvernight, setHasOvernight] = useState(false);
  const [people, setPeople] = useState('1');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const days = weekdaysBetween(periodStart, periodEnd).length;
  // Pernoites = dias úteis do período - 1 (automático, não editável). Período de 1 dia não tem pernoite.
  const nights = Math.max(0, days - 1);
  // Carga de cada técnico no período (OS programadas que cruzam o período)
  const load = useMemo(() => {
    const map = new Map<string, number>();
    technicians.forEach((t) => {
      const n = allOrders.filter((o) => {
        if (!['Planejada', 'Em Execução', 'Atrasada'].includes(o.status)) return false;
        const r = scheduledRange(o);
        return !!r && overlaps(r[0], r[1], periodStart, periodEnd) && isOrderOfTechnician(o, t);
      }).length;
      map.set(t.id, n);
    });
    return map;
  }, [technicians, allOrders, periodStart, periodEnd]);

  const tech = technicians.find((t) => t.id === techId);

  const confirm = async () => {
    setError(null);
    if (!tech) return setError('Escolha o técnico responsável.');
    if (!tech.matricula) return setError('Este técnico está sem matrícula no cadastro.');
    const p = Number(people);
    const n = nights;
    if (hasOvernight && (!Number.isInteger(p) || p < 1 || n < 1)) {
      return setError('Informe quantas pessoas (número inteiro a partir de 1).');
    }
    setSaving(true);
    try {
      await dbScheduleLot({
        unit,
        orders,
        periodStart,
        periodEnd,
        technician: { name: tech.name, matricula: tech.matricula },
        overnight: hasOvernight ? { people: p, nights: n } : null,
        createdBy: userName
      });
      onDone(`${orders.length} OS programada(s) para ${tech.name}, ${dayBR(periodStart)}${periodEnd !== periodStart ? ` a ${dayBR(periodEnd)}` : ''}${hasOvernight ? ` • ${p} pessoa(s) × ${n} pernoite(s)` : ''}.`);
    } catch (err: any) {
      setError(`Não foi possível programar: ${err?.message || err}`);
      setSaving(false);
    }
  };

  const field = 'w-full h-9 text-xs px-3 border border-slate-200 rounded-lg outline-none font-semibold bg-white';
  const label = 'block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500';

  return (
    <div className="fixed inset-0 z-[1000] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl p-6 space-y-4">
        <div>
          <h3 className="text-base font-black text-slate-800">Programar lote — {unit}</h3>
          <p className="text-xs text-slate-500">
            {orders.length} OS • {dayBR(periodStart)}{periodEnd !== periodStart ? ` a ${dayBR(periodEnd)}` : ''} ({days} dia(s) útil(eis))
          </p>
        </div>

        <label className="block">
          <span className={label}>Técnico responsável *</span>
          <select value={techId} onChange={(e) => setTechId(e.target.value)} className={field}>
            <option value="">Selecione...</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.matricula}) — {load.get(t.id) || 0} OS no período
              </option>
            ))}
          </select>
          {technicians.length === 0 && <span className="text-[11px] text-amber-700 font-bold">Nenhum técnico ativo nesta unidade.</span>}
        </label>

        <div className="space-y-2">
          {!allowOvernight ? (
            <p className="text-[11px] text-slate-500">A empresa destas OS não contabiliza pernoite.</p>
          ) : nights === 0 ? (
            <p className="text-[11px] text-slate-500">Período de 1 dia: sem pernoite.</p>
          ) : (
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
              <input type="checkbox" checked={hasOvernight} onChange={(e) => setHasOvernight(e.target.checked)} className="w-4 h-4" />
              Tem pernoite
            </label>
          )}
          {hasOvernight && nights > 0 && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={label}>Pessoas</span>
                <input type="number" min={1} value={people} onChange={(e) => setPeople(e.target.value)} className={field} />
              </label>
              <label className="block">
                <span className={label}>Pernoite</span>
                <input type="number" value={nights} readOnly disabled title="Calculado pelo período: dias úteis - 1" className={`${field} bg-slate-100 text-slate-500 cursor-not-allowed`} />
              </label>
            </div>
          )}
        </div>

        {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-xs font-bold cursor-pointer">Cancelar</button>
          <button type="button" onClick={confirm} disabled={saving} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50">
            {saving ? 'Programando...' : `Programar ${orders.length} OS`}
          </button>
        </div>
      </div>
    </div>
  );
}
