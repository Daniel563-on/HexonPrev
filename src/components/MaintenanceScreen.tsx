import React from 'react';

// TELA "APLICATIVO EM MANUTENÇÃO" (modo manutenção ligado pelo Super Administrador)
export default function MaintenanceScreen({ message, denied, onAdminLogin }: { message?: string; denied?: boolean; onAdminLogin: () => void }) {
  return (
    <div className="h-screen w-screen bg-[#0A101D] flex flex-col items-center justify-center font-sans text-white p-4">
      <div className="bg-[#0A101D] p-8 rounded-2xl border border-slate-800/80 shadow-2xl flex flex-col items-center max-w-sm text-center gap-3">
        <span className="material-symbols-outlined text-5xl text-amber-400">construction</span>
        <h2 className="text-base font-black tracking-widest uppercase">Aplicativo em manutenção</h2>
        <p className="text-sm text-slate-300 whitespace-pre-line">{message || 'O sistema está passando por uma atualização. Tente novamente mais tarde.'}</p>
        <p className="text-[11px] text-slate-500">O que foi salvo no aparelho sem internet é enviado antes de sair.</p>
        {denied && (
          <p className="text-xs font-bold text-rose-400">Durante a manutenção, somente o Super Administrador pode entrar.</p>
        )}
        <button type="button" onClick={onAdminLogin} className="mt-4 text-[11px] font-bold text-slate-400 underline cursor-pointer">
          Entrar como Super Administrador
        </button>
      </div>
    </div>
  );
}
