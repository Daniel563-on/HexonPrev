import React, { useEffect, useRef, useState } from 'react';
import {
  brandTagline,
  brandTopText,
  dbClearLoginBackground,
  dbSaveBrandingTexts,
  dbSaveLoginBackground,
  DEFAULT_TAGLINE,
  DEFAULT_TOP_TEXT,
  loadLoginBackground,
  LoginBgKind,
  prepareLoginBackground,
  useBranding
} from '../../db/branding';

// TELA DE LOGIN (só Super Administrador): frases e fundos (computador e celular) da tela de entrada.
// Sem fundo enviado, a tela usa o fundo desenhado (azul-marinho com hexágonos e luzes neon).
export default function LoginBrandingCard({ darkMode, userName }: { darkMode: boolean; userName: string }) {
  const branding = useBranding();
  const [tagline, setTagline] = useState(brandTagline(branding));
  const [topText, setTopText] = useState(brandTopText(branding));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setTagline(brandTagline(branding));
    setTopText(brandTopText(branding));
  }, [branding.tagline, branding.topText]);

  const box = darkMode ? 'bg-[#0a1122]/40 border-slate-800' : 'bg-white border-slate-200';
  const strong = darkMode ? 'text-slate-200' : 'text-slate-800';
  const input = `w-full px-3 py-2 rounded-lg border text-xs font-semibold ${darkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300 text-slate-800'}`;
  const btn = 'px-4 py-2 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-50';

  const run = async (action: () => Promise<void>, okText: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await action();
      setMsg({ ok: true, text: okText });
    } catch (err: any) {
      setMsg({ ok: false, text: `Não foi possível: ${err?.message || err}` });
    } finally {
      setBusy(false);
    }
  };

  const textsChanged = tagline !== brandTagline(branding) || topText !== brandTopText(branding);

  return (
    <div className={`p-5 rounded-xl border space-y-4 ${box}`}>
      <div>
        <h3 className={`text-sm font-black uppercase tracking-wider ${strong}`}>Tela de login</h3>
        <p className="text-xs text-slate-500 mt-1">
          Frases e imagens de fundo da tela de entrada (computador e celular). Sem imagem enviada, a tela usa o fundo desenhado da marca.
        </p>
      </div>

      {/* FRASES */}
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-[10px] font-bold uppercase text-slate-400">Frase abaixo do nome (Enter = nova linha; vazio = sem frase)</span>
          <textarea rows={2} value={tagline} onChange={(e) => setTagline(e.target.value)} className={input} />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-bold uppercase text-slate-400">Texto do canto superior (só no computador; vazio = sem texto)</span>
          <textarea rows={2} value={topText} onChange={(e) => setTopText(e.target.value)} className={input} />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !textsChanged}
          onClick={() => run(() => dbSaveBrandingTexts(tagline.trim(), topText.trim(), userName), 'Frases salvas.')}
          className={`${btn} bg-blue-600 hover:bg-blue-700 text-white`}
        >
          Salvar frases
        </button>
        <button
          type="button"
          disabled={busy || (branding.tagline === undefined && branding.topText === undefined)}
          onClick={() => run(() => dbSaveBrandingTexts(null, null, userName), 'Frases voltaram ao padrão.')}
          className={`${btn} border border-slate-300 text-slate-600`}
          title={`Padrão: "${DEFAULT_TAGLINE.replace('\n', ' ')}" e "${DEFAULT_TOP_TEXT}"`}
        >
          Frases padrão
        </button>
      </div>

      {/* FUNDOS */}
      <div className="grid sm:grid-cols-2 gap-4">
        <BackgroundSlot kind="desktop" label="Fundo do computador" hint="Imagem deitada (ex.: 1920×1080)" busy={busy} run={run} userName={userName} strong={strong} btn={btn} />
        <BackgroundSlot kind="mobile" label="Fundo do celular" hint="Imagem em pé (ex.: 1080×1920)" busy={busy} run={run} userName={userName} strong={strong} btn={btn} />
      </div>
      <p className="text-[10px] text-slate-400">
        Use uma versão da arte <strong>sem o cartão de acesso, sem o logo e sem textos</strong> — o sistema desenha esses itens por cima. Se enviar só um
        dos dois fundos, ele serve para computador e celular. A imagem é reduzida para até ~900 KB; cada aparelho baixa uma vez e guarda a cópia.
      </p>

      {msg && <p className={`text-xs font-bold ${msg.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{msg.text}</p>}
    </div>
  );
}

function BackgroundSlot({
  kind,
  label,
  hint,
  busy,
  run,
  userName,
  strong,
  btn
}: {
  kind: LoginBgKind;
  label: string;
  hint: string;
  busy: boolean;
  run: (action: () => Promise<void>, okText: string) => Promise<void>;
  userName: string;
  strong: string;
  btn: string;
}) {
  const branding = useBranding();
  const at = kind === 'desktop' ? branding.bgDesktopAt : branding.bgMobileAt;
  const fileRef = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    loadLoginBackground(kind, branding).then((img) => alive && setCurrent(img));
    return () => {
      alive = false;
    };
  }, [at]);

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    setErr('');
    setConfirmClear(false);
    if (!file) return;
    if (!file.type.startsWith('image/')) return setErr('Escolha uma imagem (PNG, JPG ou WEBP).');
    if (file.size > 25 * 1024 * 1024) return setErr('Imagem muito grande (máximo 25 MB).');
    try {
      setDraft(await prepareLoginBackground(file, kind));
    } catch (ex: any) {
      setErr(ex?.message || 'Não foi possível ler esta imagem.');
    }
  };

  const shown = draft || current;
  const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');

  return (
    <div className="space-y-2">
      <p className={`text-xs font-bold ${strong}`}>{label}</p>
      <div className={`rounded-lg border border-slate-700 bg-[#050b1f] overflow-hidden flex items-center justify-center ${kind === 'desktop' ? 'aspect-video' : 'aspect-[9/16] max-h-56'}`}>
        {shown ? (
          <img src={shown} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-[10px] text-slate-400 text-center px-3">Fundo desenhado (padrão)</span>
        )}
      </div>
      <p className="text-[10px] text-slate-400">
        {draft ? `Prévia — ainda não salvo (${Math.round(draft.length / 1024)} KB)` : at ? `Enviado em ${fmt(at)}` : hint}
      </p>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={pick} />
      <div className="flex flex-wrap gap-2">
        {draft ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(async () => { await dbSaveLoginBackground(kind, draft, userName); setDraft(null); }, `${label} salvo.`)}
              className={`${btn} bg-blue-600 hover:bg-blue-700 text-white`}
            >
              {busy ? 'Salvando...' : 'Salvar fundo'}
            </button>
            <button type="button" disabled={busy} onClick={() => setDraft(null)} className={`${btn} border border-slate-300 text-slate-600`}>
              Cancelar
            </button>
          </>
        ) : (
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className={`${btn} bg-blue-600 hover:bg-blue-700 text-white`}>
            {at ? 'Trocar fundo' : 'Enviar fundo'}
          </button>
        )}
        {at && !draft && (
          confirmClear ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(async () => { await dbClearLoginBackground(kind, userName); setConfirmClear(false); }, `${label} removido: voltou o fundo desenhado.`)}
                className={`${btn} bg-rose-600 hover:bg-rose-700 text-white`}
              >
                Sim, remover
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirmClear(false)} className={`${btn} border border-slate-300 text-slate-600`}>
                Cancelar
              </button>
            </>
          ) : (
            <button type="button" disabled={busy} onClick={() => setConfirmClear(true)} className={`${btn} border border-slate-300 text-slate-600`}>
              Remover fundo
            </button>
          )
        )}
      </div>
      {err && <p className="text-[11px] font-bold text-rose-600">{err}</p>}
    </div>
  );
}
