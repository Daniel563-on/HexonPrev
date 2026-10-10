import React, { useEffect, useState } from 'react';
import { ChevronRight, Smartphone } from 'lucide-react';
import { canPromptInstall, isInstalledApp, isIos, onInstallChange, promptInstall } from '../lib/installApp';
import { isPhoneOrTablet } from '../lib/fileDelivery';

// Botão "Instalar aplicativo" (PWA) — tela de login e Meu Perfil do celular. Some quando o app já foi aberto pelo ícone.
// No computador só aparece se o navegador liberar a instalação. Sem ela (ou no iPhone), mostra o passo a passo.
export default function InstallAppButton({ variant, darkMode = true }: { variant: 'login' | 'profile'; darkMode?: boolean }) {
  const [, setTick] = useState(0);
  const [msg, setMsg] = useState('');
  useEffect(() => onInstallChange(() => setTick((t) => t + 1)), []);
  if (isInstalledApp() || (!isPhoneOrTablet() && !canPromptInstall() && !msg)) return null;

  const steps = isIos()
    ? 'No Safari ou no Chrome, toque em Compartilhar (quadrado com seta para cima) › "Adicionar à Tela de Início" › Adicionar.'
    : 'No Chrome, toque no menu ⋮ (canto de cima) › "Instalar app" (ou "Adicionar à tela inicial") › Instalar.';
  const install = () => {
    setMsg('');
    promptInstall()
      .then((r) => setMsg(r === 'accepted' ? 'Instalado. Abra o Hexon pelo ícone.' : r === 'manual' ? steps : ''))
      .catch(() => setMsg(steps));
  };

  if (variant === 'login')
    return (
      <div className="w-full mt-4">
        <button type="button" onClick={install} className="w-full py-3 rounded-xl text-sm font-bold text-cyan-100 border border-cyan-300/40 bg-white/5 hover:bg-white/10 flex items-center justify-center gap-2 cursor-pointer">
          <Smartphone className="w-4 h-4" /> Instalar aplicativo
        </button>
        {msg && <p className="mt-2 text-xs text-slate-200 leading-relaxed text-center">{msg}</p>}
      </div>
    );

  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 px-1">Aplicativo</h4>
      <div className={`rounded-2xl border overflow-hidden ${darkMode ? 'bg-slate-900/90 border-slate-800' : 'bg-white border-slate-200'}`}>
        <button type="button" onClick={install} className="w-full px-4 py-3.5 flex items-center justify-between text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/10 text-cyan-500 flex items-center justify-center">
              <Smartphone className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-900 dark:text-white">Instalar aplicativo</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Ícone do Hexon na tela do celular</div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </button>
        {msg && <p className="px-4 pb-3.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{msg}</p>}
      </div>
    </div>
  );
}
