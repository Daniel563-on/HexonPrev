import React from 'react';
import { X } from 'lucide-react';

// U4: "X" no canto de cima de toda janela — fecha igual ao "Cancelar" dela (mesma ação, travado enquanto grava)
export default function CloseX({ onClick, disabled, className = 'absolute top-3 right-3' }: { onClick: () => void; disabled?: boolean; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title="Fechar"
      aria-label="Fechar"
      className={`h-8 w-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/90 flex items-center justify-center cursor-pointer shrink-0 z-10 text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
    >
      <X className="w-4 h-4" />
    </button>
  );
}
