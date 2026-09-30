import React, { useEffect, useRef, useState } from 'react';
import { APP_VERSION, fetchDeployedVersion, newForceReloadAt, reloadSafely, subscribeAppControl, takeJustUpdated } from '../db/appControl';

// NOVA VERSÃO DO SISTEMA: aviso com "Atualizar agora" e recarga sozinha em 1 minuto.
// Aparece quando o Super Administrador aperta "Forçar atualização" ou quando o app percebe sozinho
// (a cada 30 min e ao voltar para a aba) que o site publicado tem uma versão diferente da que está aberta.

const CHECK_EVERY_MS = 30 * 60 * 1000;
const COUNTDOWN_S = 60;
const AUTO_KEY = 'hexon_auto_reload_version';

export default function AppUpdateBanner() {
  const [pending, setPending] = useState<{ forceAt?: number; auto: boolean } | null>(null);
  const [left, setLeft] = useState(COUNTDOWN_S);
  const [reloading, setReloading] = useState(false);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  // Depois de recarregar: aviso rápido "Sistema atualizado"
  const [justUpdated, setJustUpdated] = useState(() => takeJustUpdated());
  useEffect(() => {
    if (!justUpdated) return;
    const t = setTimeout(() => setJustUpdated(false), 6000);
    return () => clearTimeout(t);
  }, [justUpdated]);

  // Botão "Forçar atualização" do Super Administrador
  useEffect(
    () =>
      subscribeAppControl((c) => {
        const at = newForceReloadAt(c);
        if (at && !pendingRef.current) {
          setPending({ forceAt: at, auto: true });
        }
      }),
    []
  );

  // Conferência automática da versão publicada (arquivo do site, não usa o banco)
  useEffect(() => {
    if (APP_VERSION === 'dev') return;
    const check = async () => {
      if (pendingRef.current) return;
      const deployed = await fetchDeployedVersion();
      if (!deployed || deployed === APP_VERSION) return;
      // Já recarregou uma vez por causa desta versão e continua diferente: só mostra o aviso (sem recarregar sozinho)
      let auto = true;
      try {
        auto = localStorage.getItem(AUTO_KEY) !== deployed;
        localStorage.setItem(AUTO_KEY, deployed);
      } catch {
        /* ignora */
      }
      setPending({ auto });
    };
    const first = setTimeout(check, 60 * 1000);
    const timer = setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Contagem regressiva
  useEffect(() => {
    if (!pending?.auto || reloading) return;
    if (left <= 0) {
      setReloading(true);
      reloadSafely(pending.forceAt);
      return;
    }
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [pending, left, reloading]);

  if (!pending) {
    if (!justUpdated) return null;
    return (
      <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[200] w-[calc(100%-2rem)] max-w-md p-3 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-900 shadow-2xl flex items-center gap-3 font-sans">
        <span className="flex-1 text-xs font-bold">Sistema atualizado para a versão mais recente.</span>
        <button type="button" onClick={() => setJustUpdated(false)} className="text-emerald-700 text-sm font-bold cursor-pointer">×</button>
      </div>
    );
  }

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[200] w-[calc(100%-2rem)] max-w-md p-3 rounded-xl border border-indigo-300 bg-indigo-50 text-indigo-900 shadow-2xl flex items-center gap-3 font-sans">
      <div className="flex-1 min-w-0 text-xs font-bold">
        {reloading ? (
          'Atualizando... (enviando antes o que estiver salvo no aparelho)'
        ) : (
          <>
            Nova versão do sistema disponível.
            {pending.auto && <span className="font-semibold"> Atualizando sozinho em {left}s.</span>}
          </>
        )}
      </div>
      {!reloading && (
        <button
          type="button"
          onClick={() => {
            setReloading(true);
            reloadSafely(pending.forceAt);
          }}
          className="h-9 px-3 rounded-lg bg-[#3525cd] text-white text-xs font-bold cursor-pointer shrink-0"
        >
          Atualizar agora
        </button>
      )}
    </div>
  );
}
