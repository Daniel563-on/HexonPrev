import React from 'react';
import BrandBackground from './BrandBackground';

// TELA "APLICATIVO EM MANUTENÇÃO" (modo manutenção ligado pelo Super Administrador)
export default function MaintenanceScreen({ message, denied, onAdminLogin }: { message?: string; denied?: boolean; onAdminLogin: () => void }) {
  return (
    <div className="h-screen w-screen relative overflow-hidden bg-[#050b1f] flex flex-col items-center justify-center font-sans text-white p-4">
      <BrandBackground cacheOnly />
      <div className="relative z-10 bg-[#0c1b44]/60 backdrop-blur-xl p-8 rounded-2xl border border-cyan-300/40 shadow-[0_0_40px_rgba(34,211,238,0.2)] flex flex-col items-center max-w-sm text-center gap-3">
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
