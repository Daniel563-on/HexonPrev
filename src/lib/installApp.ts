// APP INSTALÁVEL (PWA): guarda o pedido de instalação do navegador (Android/computador) para o botão "Instalar aplicativo".
// Importado logo no main.tsx: o Chrome avisa cedo, antes de as telas abrirem. Sem o aviso automático do Chrome
// (também na página do QR e no link do cliente): só instala quem tocar no botão.

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((cb) => cb());

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as InstallPrompt;
  notify();
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  notify();
});

export function onInstallChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// Aberto pelo ícone (já instalado): o botão não aparece
export const isInstalledApp = (): boolean =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const canPromptInstall = (): boolean => !!deferred;

export const isIos = (): boolean => {
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
};

// 'manual' = o navegador não liberou a instalação: mostrar o passo a passo
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'manual'> {
  const ev = deferred;
  if (!ev) return 'manual';
  deferred = null; // o navegador só deixa usar o pedido uma vez
  notify();
  await ev.prompt();
  return (await ev.userChoice).outcome;
}
