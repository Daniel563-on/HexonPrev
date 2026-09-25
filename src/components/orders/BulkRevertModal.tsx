import React, { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { ServiceOrder } from '../../types';
import { dbSaveServiceOrder } from '../../db/firebase';

export interface BulkRevertModalProps {
  isOpen: boolean;
  onClose: () => void;
  orders: ServiceOrder[];
  currentCalendarDate: Date;
  bulkRevertScope: 'period' | 'month';
  selectedCalendarDay: number | null;
  selectedCalendarEndDay: number | null;
  monthNames: string[];
  canRevertUnexecutedOrder: (os: ServiceOrder, targetMonthDate?: Date) => boolean;
  onSuccess: () => void;
}

export default function BulkRevertModal({
  isOpen,
  onClose,
  orders,
  currentCalendarDate,
  bulkRevertScope,
  selectedCalendarDay,
  selectedCalendarEndDay,
  monthNames,
  canRevertUnexecutedOrder,
  onSuccess
}: BulkRevertModalProps) {
  const [isBulkReverting, setIsBulkReverting] = useState(false);

  if (!isOpen) return null;

  const monthRevertible = orders.filter((os) => canRevertUnexecutedOrder(os, currentCalendarDate));

  // Se o escopo for período, filtra as não executadas que sobrepõem o período selecionado e que são revertíveis
  let unexecutedList = monthRevertible;
  if (bulkRevertScope === 'period' && selectedCalendarDay !== null) {
    const startStr = `${currentCalendarDate.getFullYear()}-${String(currentCalendarDate.getMonth() + 1).padStart(2, '0')}-${String(selectedCalendarDay).padStart(2, '0')}`;
    const endDay = selectedCalendarEndDay !== null ? selectedCalendarEndDay : selectedCalendarDay;
    const endStr = `${currentCalendarDate.getFullYear()}-${String(currentCalendarDate.getMonth() + 1).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;

    unexecutedList = monthRevertible.filter((os) => {
      if (!os.scheduledDate) return false;
      const s = os.scheduledDate.slice(0, 10);
      const e = (os.scheduledEndDate || os.scheduledDate).slice(0, 10);
      return s <= endStr && e >= startStr;
    });
  }

  const handleConfirmRevert = async () => {
    setIsBulkReverting(true);
    try {
      const now = new Date().toISOString();
      const updatePromises = unexecutedList.map((os) => {
        const updatedOS: ServiceOrder = {
          ...os,
          status: 'Novo',
          scheduledDate: '',
          scheduledEndDate: undefined,
          assignedTechnician: '',
          updatedAt: now
        };
        return dbSaveServiceOrder(updatedOS);
      });

      await Promise.all(updatePromises);
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Failed to bulk revert unexecuted orders:', err);
      alert('Erro ao reverter preventivas atrasadas. Tente novamente.');
    } finally {
      setIsBulkReverting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/65 backdrop-blur-xs flex items-center justify-center p-4 font-sans">
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full border border-amber-200 transform transition-all animate-in fade-in zoom-in-95 duration-150 text-left">
        <div className="flex items-center gap-3 mb-4">
          <div className="bg-amber-100 p-2.5 rounded-xl border border-amber-200 text-amber-700">
            <RotateCcw className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-extrabold text-[#0b1c30] text-sm tracking-tight uppercase">
              Reverter Preventivas Atrasadas
            </h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
              {bulkRevertScope === 'period' && selectedCalendarDay !== null
                ? `Período Selecionado (${selectedCalendarDay}${selectedCalendarEndDay && selectedCalendarEndDay !== selectedCalendarDay ? ` a ${selectedCalendarEndDay}` : ''} de ${monthNames[currentCalendarDate.getMonth()]})`
                : `Mês de ${monthNames[currentCalendarDate.getMonth()]} / ${currentCalendarDate.getFullYear()}`}
            </p>
          </div>
        </div>

        <div className="space-y-3 mb-6">
          <p className="text-xs text-slate-700 leading-relaxed font-medium">
            Você está prestes a reverter <strong className="font-black text-amber-800">{unexecutedList.length}</strong>{' '}
            {unexecutedList.length === 1 ? 'preventiva atrasada' : 'preventivas atrasadas'} (dentro do prazo do Super Administrador)
            de volta para o status <strong className="font-bold text-indigo-700">"Novo"</strong>.
          </p>

          <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-900 space-y-1.5 font-medium">
            <p className="font-bold flex items-center gap-1.5 text-amber-950">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-600"></span>
              O que vai acontecer:
            </p>
            <ul className="list-disc list-inside space-y-1 text-[10.5px] text-amber-850 pl-1">
              <li>As preventivas terão a data agendada e técnico anterior desvinculados.</li>
              <li>Retornarão à aba de <strong>"Aguardando Agendamento" (Novas)</strong> no painel de planejamento.</li>
              <li>O encarregado poderá agendar nova data (a partir de hoje) e técnico, dentro do prazo do Super Administrador.</li>
              <li>Preventivas que passaram do prazo do Super Administrador ficam como Não Executadas e não são revertidas.</li>
            </ul>
          </div>
        </div>

        <div className="flex justify-end gap-2.5">
          <button
            type="button"
            disabled={isBulkReverting}
            onClick={onClose}
            className="px-4 py-2 border border-gray-250 text-slate-600 rounded-lg text-[11px] font-black uppercase tracking-wider hover:bg-gray-50 active:scale-95 transition-all duration-150 cursor-pointer disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={isBulkReverting || unexecutedList.length === 0}
            onClick={handleConfirmRevert}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[11px] font-black uppercase tracking-wider active:scale-95 transition-all duration-150 cursor-pointer shadow-sm border border-amber-700 disabled:opacity-55 flex items-center gap-1.5"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${isBulkReverting ? 'animate-spin' : ''}`} />
            {isBulkReverting ? 'Revertendo...' : `Confirmar Reversão (${unexecutedList.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
