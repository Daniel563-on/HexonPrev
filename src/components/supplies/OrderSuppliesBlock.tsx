import React, { useEffect, useState } from 'react';
import { PackageOpen } from 'lucide-react';
import { OrderSupplies } from '../../types';
import { dbGetOrderSupplies, formatSupplyQty, orderSupplyEntries } from '../../db/firebase';

// BLOCO "INSUMOS" DA OS (Fase 8C-2): insumos recebidos pelo técnico (pedido a pedido, com o GLPI).
// Vem do registro "orderSupplies/{id da OS}" (1 leitura). Ninguém edita aqui: entra pelo "Recebi" do técnico.
export default function OrderSuppliesBlock({ orderId, darkMode = false, compact = false }: { orderId: string; darkMode?: boolean; compact?: boolean }) {
  const [data, setData] = useState<OrderSupplies | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    setData(undefined);
    dbGetOrderSupplies(orderId).then((v) => alive && setData(v));
    return () => {
      alive = false;
    };
  }, [orderId]);

  const entries = orderSupplyEntries(data || null);
  const box = darkMode ? 'bg-slate-900/90 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-700';
  const fmt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  // Sem insumos: no modo compacto (celular) não mostra nada
  if (compact && entries.length === 0) return null;
  return (
    <div className={`p-3 rounded-xl border space-y-2 ${box}`}>
      <p className="text-[11px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
        <PackageOpen className="w-3.5 h-3.5" /> Insumos ({entries.reduce((n, e) => n + e.items.length, 0)})
      </p>
      {data === undefined && <p className="text-xs text-slate-400">Carregando...</p>}
      {data !== undefined && entries.length === 0 && <p className="text-xs text-slate-400">Nenhum insumo recebido.</p>}
      {entries.map((e) => (
        <div key={e.number} className="space-y-0.5">
          <p className="text-[11px] text-slate-500">
            <span className="font-mono font-bold">{e.number}</span> · GLPI <span className="font-mono font-bold">{e.glpi}</span> · fornecido em {fmt(e.suppliedAt)}
          </p>
          {e.items.map((it) => (
            <p key={it.supplyId} className="text-xs">
              {it.description} <span className="text-slate-400">· {formatSupplyQty(it.qty)} {it.measureUnit} · cód. {it.code}</span>
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}
