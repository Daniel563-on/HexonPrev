import React, { useEffect, useState } from 'react';
import { ServiceOrder } from '../../../types';
import { OrderCost, OrderCostLine, brl, dbGetOrderCost, fmtMinutes, orderTimeInfo } from '../../../db/firebase';

// TEMPO E HOMEM-HORA DA OS CONCLUÍDA (Etapa 7)
// Tempo e HH aparecem para todos; o custo em R$ só para quem tem "Visualizar Valores (R$)" (calculado na hora, nada gravado).

export default function OrderTimeCost({ order, canViewCosts }: { order: ServiceOrder; canViewCosts: boolean }) {
  const info = orderTimeInfo(order);
  const [cost, setCost] = useState<OrderCost | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setCost(null);
    if (!canViewCosts || !info) return;
    let alive = true;
    setLoading(true);
    dbGetOrderCost(order)
      .then((c) => alive && setCost(c))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [order.id, canViewCosts, !!info]);

  if (!info) return null;
  const label = 'text-[10px] font-black text-gray-400 uppercase tracking-widest';

  const lines = (title: string, list: OrderCostLine[]) =>
    list.length > 0 && (
      <div className="space-y-1">
        <p className="text-[10px] font-bold text-slate-500">{title}</p>
        {list.map((l, i) => (
          <div key={i} className="flex justify-between gap-2 text-[11px]">
            <div className="min-w-0">
              <p className="font-bold text-slate-800 truncate">{l.label}</p>
              <p className={l.value === null ? 'text-rose-600 font-bold' : 'text-slate-500'}>{l.detail}</p>
            </div>
            <span className={`font-bold shrink-0 ${l.value === null ? 'text-rose-600' : 'text-slate-800'}`}>{l.value === null ? '—' : brl(l.value)}</span>
          </div>
        ))}
      </div>
    );

  return (
    <div className="space-y-2">
      <p className={label}>Tempo e homem-hora</p>
      <div className="p-3 rounded-lg border border-slate-200 bg-white space-y-2">
        <p className="text-xs font-bold text-slate-800">
          Tempo: {fmtMinutes(info.durationMin)} • {info.people} {info.people === 1 ? 'pessoa' : 'pessoas'} • HH: {fmtMinutes(info.manMinutes)}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {info.suspicious && (
            <span className="px-2 py-0.5 rounded-full bg-amber-50 border border-amber-300 text-[10px] font-bold text-amber-800">Tempo suspeito (mais de 10h)</span>
          )}
          {info.offline && (
            <span className="px-2 py-0.5 rounded-full bg-slate-50 border border-slate-300 text-[10px] font-bold text-slate-700">Horário do celular (sem internet)</span>
          )}
          {info.divergent && (
            <span className="px-2 py-0.5 rounded-full bg-rose-50 border border-rose-300 text-[10px] font-bold text-rose-700">Horário divergente (celular x servidor)</span>
          )}
        </div>

        {canViewCosts && (
          <div className="pt-2 border-t border-slate-100 space-y-2">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Custo da OS</p>
            {loading && <p className="text-[11px] text-slate-400">Calculando...</p>}
            {cost && (
              <>
                {!cost.costTracking && <p className="text-[11px] font-bold text-slate-500">A empresa não contabiliza homem-hora e pernoite: o custo é só dos materiais.</p>}
                {lines('Mão de obra', cost.labor)}
                {lines('Materiais', cost.materials)}
                {lines('Insumos', cost.supplies)}
                {cost.overnight && lines('Pernoite', [cost.overnight])}
                <div className="flex justify-between pt-2 border-t border-slate-100 text-xs font-black text-slate-900">
                  <span>Total</span>
                  <span>{brl(cost.total)}</span>
                </div>
                {cost.missing > 0 && (
                  <p className="text-[10px] font-bold text-rose-600">
                    {cost.missing} {cost.missing === 1 ? 'item sem valor cadastrado ficou' : 'itens sem valor cadastrado ficaram'} fora do total.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
