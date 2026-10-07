import React, { useRef, useState } from 'react';
import { dbClearBranding, dbSaveBranding, prepareBrandingImages, useBranding } from '../../db/branding';

// IDENTIDADE VISUAL (só Super Administrador): trocar o logo do sistema sem precisar mexer no código.
// Aparece no login, menu lateral, topo do celular do técnico, página pública de validação, ícone da aba e (opcional) etiquetas de QR Code.
export default function BrandingCard({ darkMode, userName }: { darkMode: boolean; userName: string }) {
  const branding = useBranding();
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<{ logo: string; favicon: string; name: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const box = darkMode ? 'bg-[#0a1122]/40 border-slate-800' : 'bg-white border-slate-200';
  const strong = darkMode ? 'text-slate-200' : 'text-slate-800';
  const btn = 'px-4 py-2 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-50';
  const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMsg(null);
    setConfirmClear(false);
    if (!file.type.startsWith('image/')) {
      setMsg({ ok: false, text: 'Escolha uma imagem (PNG, JPG, WEBP ou SVG).' });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setMsg({ ok: false, text: 'Imagem muito grande (máximo 10 MB).' });
      return;
    }
    try {
      const imgs = await prepareBrandingImages(file);
      setDraft({ ...imgs, name: file.name });
    } catch {
      setMsg({ ok: false, text: 'Não foi possível ler esta imagem. Tente outro arquivo (PNG com fundo transparente é o ideal).' });
    }
  };

  const run = async (action: () => Promise<void>, okText: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await action();
      setMsg({ ok: true, text: okText });
      setDraft(null);
      setConfirmClear(false);
    } catch (err: any) {
      setMsg({ ok: false, text: `Não foi possível: ${err?.message || err}` });
    } finally {
      setBusy(false);
    }
  };

  const preview = (src: string | undefined, dark: boolean) => (
    <div className={`w-24 h-24 rounded-xl border flex items-center justify-center ${dark ? 'bg-[#08122b] border-slate-700' : 'bg-white border-slate-200'}`}>
      {src ? <img src={src} alt="" className="w-16 h-16 object-contain" /> : <span className="text-[10px] text-slate-400 text-center px-2">Logo padrão ("H")</span>}
    </div>
  );

  const shown = draft?.logo || branding.logo;

  return (
    <div className={`p-5 rounded-xl border space-y-3 ${box}`}>
      <div>
        <h3 className={`text-sm font-black uppercase tracking-wider ${strong}`}>Logo do sistema</h3>
        <p className="text-xs text-slate-500 mt-1">
          Aparece no login, no menu lateral, no topo do celular do técnico, na página pública de validação da OS, no ícone da aba do navegador
          e, se ligado no editor de etiquetas, nas etiquetas de QR Code. Use PNG com fundo transparente (quadrado é o ideal; a imagem não é cortada).
        </p>
        {branding.logo && branding.updatedAt && (
          <p className="text-[10px] text-slate-400 mt-1">
            Logo atual enviado em {fmt(branding.updatedAt)}
            {branding.updatedBy ? ` por ${branding.updatedBy}` : ''}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {preview(shown, true)}
        {preview(shown, false)}
        {draft && <span className={`text-xs font-bold ${strong}`}>Prévia de "{draft.name}" — ainda não salvo</span>}
      </div>

      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={pick} />
      <div className="flex flex-wrap items-center gap-2">
        {draft ? (
          <>
            <button type="button" disabled={busy} onClick={() => run(() => dbSaveBranding(draft.logo, draft.favicon, userName), 'Logo salvo. Os aparelhos passam a mostrar o novo logo ao abrir o sistema.')} className={`${btn} bg-blue-600 hover:bg-blue-700 text-white`}>
              {busy ? 'Salvando...' : 'Salvar este logo'}
            </button>
            <button type="button" disabled={busy} onClick={() => setDraft(null)} className={`${btn} border border-slate-300 text-slate-600`}>
              Cancelar
            </button>
          </>
        ) : (
          <button type="button" onClick={() => fileRef.current?.click()} className={`${btn} bg-blue-600 hover:bg-blue-700 text-white`}>
            {branding.logo ? 'Trocar logo' : 'Enviar logo'}
          </button>
        )}
        {branding.logo && !draft && (
          confirmClear ? (
            <>
              <span className={`text-xs font-bold ${strong}`}>Confirma? Volta o "H" padrão em todas as telas.</span>
              <button type="button" disabled={busy} onClick={() => run(() => dbClearBranding(userName), 'Logo removido: voltou o padrão.')} className={`${btn} bg-rose-600 hover:bg-rose-700 text-white`}>
                {busy ? 'Removendo...' : 'Sim, voltar ao padrão'}
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirmClear(false)} className={`${btn} border border-slate-300 text-slate-600`}>
                Cancelar
              </button>
            </>
          ) : (
            <button type="button" onClick={() => { setConfirmClear(true); setMsg(null); }} className={`${btn} border border-slate-300 text-slate-600`}>
              Voltar ao padrão
            </button>
          )
        )}
      </div>

      {msg && <p className={`text-xs font-bold ${msg.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{msg.text}</p>}
    </div>
  );
}
