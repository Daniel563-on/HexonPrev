import React, { useState } from 'react';
import { X } from 'lucide-react';
import { Company, WorkOrder } from '../../types';
import { companiesOfUnit, dbChangeWorkOrderCompany } from '../../db/firebase';
import { dayBR } from './OsAnswersView';

// ESCOLHER EMPRESA (ajuste A5-B, só o Super Administrador): chamado em aberto de empresa inativa recebe uma empresa
// ativa da gerência. Se estava num bloco da Programação, sai dele (perde o dia) e continua com o técnico.
export default function ChooseCompanyModal({
  order,
  companies,
  userName,
  onClose,
  onSaved
}: {
  order: WorkOrder;
  companies: Company[];
  userName: string;
  onClose: () => void;
  onSaved: (o: WorkOrder, msg: string) => void;
}) {
  const options = companiesOfUnit(companies, order.unit).filter((c) => c.active);
  const [to, setTo] = useState(options.length === 1 ? options[0].id : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameOf = (id?: string) => companies.find((c) => c.id === id)?.name || id || '';
  const inBlock = !!(order.scheduledDate || order.scheduledEndDate || order.lotId);

  const save = async () => {
    if (!to) return setError('Escolha a empresa nova.');
    setSaving(true);
    setError(null);
    try {
      await dbChangeWorkOrderCompany(order, to, { from: nameOf(order.company), to: nameOf(to) }, userName);
      const { scheduledDate: _s, scheduledEndDate: _e, lotId: _l, ...rest } = order;
      onSaved({ ...(inBlock ? rest : order), company: to } as WorkOrder, `${order.number}: empresa ${nameOf(to)} gravada.`);
    } catch (e: any) {
      setError(e?.code === 'permission-denied' ? 'O banco recusou: só o Super Administrador escolhe a empresa, e a empresa nova precisa estar ativa e atuar na gerência.' : `Não foi possível salvar: ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] bg-slate-900/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 space-y-3" role="dialog" aria-label="Escolher empresa" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-black text-slate-900">Escolher empresa — {order.number}</p>
          <button type="button" onClick={onClose} className="h-8 w-8 shrink-0 rounded-lg border border-slate-200 flex items-center justify-center cursor-pointer" title="Fechar">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-slate-500">A empresa {nameOf(order.company)} foi inativada. Escolha a empresa que vai cuidar deste chamado.</p>
        <label className="block">
          <span className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Empresa nova *</span>
          <select
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setError(null);
            }}
            className="w-full h-9 px-3 text-xs font-bold border border-slate-200 rounded-lg bg-white cursor-pointer"
            aria-label="Empresa nova"
          >
            <option value="">Selecione...</option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="block text-[10px] text-slate-500 mt-1">
            {options.length ? `Só aparecem as empresas ativas da ${order.unit}.` : `Nenhuma empresa ativa atua na ${order.unit} (Configurações › Empresas).`}
          </span>
        </label>
        {inBlock ? (
          <p className="text-xs rounded-lg border border-amber-300 bg-amber-50 text-amber-900 p-2.5">
            Este chamado estava na programação da {nameOf(order.company)}
            {order.scheduledDate ? ` (dia ${dayBR(order.scheduledDate)})` : ''}: <b>sai da programação</b>
            {order.assignedTechnicianName ? (
              <>
                {' '}e continua com o técnico <b>{order.assignedTechnicianName}</b>
              </>
            ) : null}
            . Se outro técnico for fazer, use <b>Trocar</b> depois.
          </p>
        ) : order.assignedTechnicianName ? (
          <p className="text-xs rounded-lg border border-amber-300 bg-amber-50 text-amber-900 p-2.5">
            Continua com o técnico <b>{order.assignedTechnicianName}</b>. Se outro técnico for fazer, use <b>Trocar</b> depois.
          </p>
        ) : null}
        <p className="text-[11px] text-slate-500">Fica registrado na linha do tempo da OS: "Empresa alterada: {nameOf(order.company)} (inativa) → {to ? nameOf(to) : '...'}".</p>
        {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg border border-slate-200 text-xs font-bold cursor-pointer">
            Cancelar
          </button>
          <button type="button" onClick={save} disabled={saving} className="h-9 px-4 rounded-lg bg-blue-600 text-white text-xs font-black cursor-pointer disabled:opacity-50">
            {saving ? 'Salvando...' : 'Salvar empresa'}
          </button>
        </div>
      </div>
    </div>
  );
}
