import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { dbDeleteServiceOrder } from '../../db/firebase';
import { formatOrderNumber } from '../../utils/orderNumber';

export interface DeleteOrderModalProps {
  isOpen: boolean;
  orderIds: string[];
  onClose: () => void;
  onSuccess: () => void;
}

export default function DeleteOrderModal({
  isOpen,
  orderIds,
  onClose,
  onSuccess
}: DeleteOrderModalProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  if (!isOpen || orderIds.length === 0) return null;

  const isBulk = orderIds.length > 1;
  const singleId = orderIds[0];

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await Promise.all(orderIds.map((id) => dbDeleteServiceOrder(id)));
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Failed to delete service order(s):', err);
      alert('Erro ao excluir preventiva(s).');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/65 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full border border-gray-150 transform transition-all animate-in fade-in zoom-in-95 duration-150 text-left">
        <div className="flex items-center gap-3 text-rose-600 mb-4">
          <div className="bg-rose-50 p-2.5 rounded-full border border-rose-100">
            <Trash2 className="w-5 h-5 text-rose-600" />
          </div>
          <h3 className="font-extrabold text-[#0b1c30] text-sm tracking-tight uppercase">
            {isBulk ? 'Excluir em Lote?' : 'Excluir Preventiva?'}
          </h3>
        </div>

        <p className="text-xs text-slate-600 leading-relaxed mb-6 font-medium">
          {isBulk ? (
            <>
              Você está prestes a excluir permanentemente{' '}
              <strong className="font-black text-rose-700">{orderIds.length}</strong> preventivas selecionadas.
              Essa ação não pode ser desfeita e removerá os dados do cronograma correspondentes. Deseja continuar?
            </>
          ) : (
            <>
              Você está prestes a excluir permanentemente a preventiva{' '}
              <strong className="font-black text-rose-700">#{formatOrderNumber(singleId)}</strong>. Essa ação não pode ser desfeita e
              removerá todos os dados do cronograma. Deseja continuar?
            </>
          )}
        </p>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={isDeleting}
            onClick={onClose}
            className="px-4 py-2 border border-gray-250 text-slate-600 rounded-lg text-[11px] font-black uppercase tracking-wider hover:bg-gray-50 active:scale-95 transition-all duration-150 cursor-pointer disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={isDeleting}
            onClick={handleDelete}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[11px] font-black uppercase tracking-wider active:scale-95 transition-all duration-150 cursor-pointer shadow-sm border border-rose-700 disabled:opacity-55"
          >
            {isDeleting ? 'Excluindo...' : isBulk ? 'Sim, Excluir Todas' : 'Sim, Excluir'}
          </button>
        </div>
      </div>
    </div>
  );
}
