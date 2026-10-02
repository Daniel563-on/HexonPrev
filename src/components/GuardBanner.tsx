import React, { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { GuardTrip, onGuardTrip } from '../db/firebase';

// Aviso do disjuntor do banco (src/db/guard.ts): aparece só se este aparelho fizer um uso anormal do banco
export default function GuardBanner() {
  const [trip, setTrip] = useState<GuardTrip | null>(null);
  useEffect(() => onGuardTrip(setTrip), []);
  if (!trip) return null;
  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[9999] w-[calc(100%-2rem)] max-w-lg bg-rose-600 text-white rounded-xl shadow-2xl p-4 flex items-start gap-3">
      <ShieldAlert className="w-6 h-6 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-black text-sm">Proteção do sistema ativada</p>
        <p className="text-xs mt-1 leading-snug">
          Uso anormal do banco detectado neste aparelho ({trip.count} {trip.label} em 1 minuto). Para não gerar custo,
          as gravações e buscas foram pausadas. Recarregue a página. Se repetir, avise o administrador.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-3 px-4 py-1.5 bg-white text-rose-700 text-xs font-black uppercase tracking-wide rounded-lg cursor-pointer"
        >
          Recarregar página
        </button>
      </div>
    </div>
  );
}
