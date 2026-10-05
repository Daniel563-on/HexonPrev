import React, { useEffect, useRef, useState } from 'react';
import { Eraser, Star, X } from 'lucide-react';
import { OsSignatureRole } from '../../types';
import { OS_SIGN_COLOR, OS_SIGN_LABEL } from '../../db/firebase';

// QUADRO DE ASSINATURA DA OS com carimbo no fundo ("VALIDAÇÃO DE ASSINATURA ELETRÔNICA"), uma cor por papel.
// No celular abre deitado (paisagem): o Android vira a tela; quando o aparelho não deixa (iPhone), o quadro aparece
// girado e a pessoa vira o celular. Ao confirmar, volta para retrato.
// O desenho é guardado em pontos; a imagem final é gerada com o carimbo e a hora de cada assinatura
// (assinatura em lote: o mesmo desenho, cada OS com a sua hora).
// Cliente: primeiro uma tela em pé com nome, matrícula e estrelas; depois o quadro deitado, com o carimbo já preenchido.

export type Stroke = { x: number; y: number }[];
export interface StampInfo {
  role: OsSignatureRole;
  name: string;
  matricula?: string;
  cargo?: string;
  rating?: number;
  at: string; // ISO
}

const W = 720;
const H = 270;

function drawStamp(ctx: CanvasRenderingContext2D, s: StampInfo) {
  const color = OS_SIGN_COLOR[s.role];
  const sw = 520;
  const sh = 150;
  const x = (W - sw) / 2;
  const y = (H - sh) / 2;
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.6;
  ctx.strokeRect(x, y, sw, sh);
  ctx.lineWidth = 0.8;
  ctx.strokeRect(x + 3, y + 3, sw - 6, sh - 6);
  ctx.beginPath();
  ctx.moveTo(x + 3, y + 30);
  ctx.lineTo(x + sw - 3, y + 30);
  ctx.stroke();
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const title = s.role === 'cliente' ? 'VALIDAÇÃO DE ACEITE DO CLIENTE' : `VALIDAÇÃO DE ASSINATURA ELETRÔNICA — ${OS_SIGN_LABEL[s.role].toUpperCase()}`;
  ctx.fillText(title, x + sw / 2, y + 15, sw - 16);
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'left';
  const when = new Date(s.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
  const lines =
    s.role === 'cliente'
      ? [
          `NOME: ${(s.name || 'NÃO INFORMADO').toUpperCase()}`,
          `MATRÍCULA: ${s.matricula || 'NÃO INFORMADA'}`,
          `AVALIAÇÃO: ${s.rating ? `${'★'.repeat(s.rating)}${'☆'.repeat(5 - s.rating)} (${s.rating}/5)` : 'NÃO INFORMADA'}`,
          `DATA/HORA: ${when}`
        ]
      : [`NOME: ${(s.name || '').toUpperCase()}`, `MATRÍCULA: ${s.matricula || '—'}`, `CARGO: ${(s.cargo || OS_SIGN_LABEL[s.role]).toUpperCase()}`, `DATA/HORA: ${when}`];
  lines.forEach((l, i) => ctx.fillText(l, x + 16, y + 30 + 18 + i * 26, sw - 32));
  ctx.restore();
}

function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[]) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#0f172a';
  ctx.fillStyle = '#0f172a';
  strokes.forEach((st) => {
    if (st.length === 1) {
      ctx.beginPath();
      ctx.arc(st[0].x, st[0].y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (st.length > 1) {
      ctx.beginPath();
      ctx.moveTo(st[0].x, st[0].y);
      st.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
      ctx.stroke();
    }
  });
  ctx.restore();
}

// Imagem final (PNG) = carimbo + desenho
export function renderOsSignature(strokes: Stroke[], stamp: StampInfo): string {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  drawStamp(ctx, stamp);
  drawStrokes(ctx, strokes);
  return c.toDataURL('image/png');
}

interface Props {
  role: OsSignatureRole;
  signer: { name: string; matricula?: string; cargo?: string };
  title?: string;           // ex.: "Assinar 3 OS"
  client?: boolean;         // cliente: pede nome, matrícula e estrelas
  onConfirm: (strokes: Stroke[], signer: { name: string; matricula?: string; cargo?: string; rating?: number }) => void;
  onCancel: () => void;
}

export default function OsSignaturePad({ role, signer, title, client, onConfirm, onCancel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokes = useRef<Stroke[]>([]);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [name, setName] = useState(client ? '' : signer.name);
  const [matricula, setMatricula] = useState(client ? '' : signer.matricula || '');
  const [rating, setRating] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [rotated, setRotated] = useState(false);
  const [step, setStep] = useState<'data' | 'sign'>(client ? 'data' : 'sign');
  const [now, setNow] = useState(() => new Date().toISOString());

  // Paisagem: tenta virar a tela (tela cheia + trava); se não der, gira o quadro na tela
  useEffect(() => {
    if (step !== 'sign') return;
    const isPhonePortrait = () => window.matchMedia('(max-width: 900px) and (orientation: portrait)').matches;
    let locked = false;
    let alive = true;
    (async () => {
      if (!isPhonePortrait()) return;
      try {
        const el: any = document.documentElement;
        if (el.requestFullscreen) await el.requestFullscreen();
        const o: any = (window.screen as any).orientation;
        if (o?.lock) {
          await o.lock('landscape');
          locked = true;
        }
      } catch {
        /* sem suporte (ex.: iPhone) */
      }
      if (!locked && alive) setRotated(isPhonePortrait());
    })();
    const onResize = () => setRotated((r) => (locked ? false : r && isPhonePortrait()));
    window.addEventListener('resize', onResize);
    return () => {
      alive = false;
      setRotated(false);
      window.removeEventListener('resize', onResize);
      try {
        (window.screen as any).orientation?.unlock?.();
      } catch {
        /* ignora */
      }
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, [step]);

  // Hora do carimbo na tela (a definitiva é a do momento de confirmar)
  useEffect(() => {
    const t = setInterval(() => setNow(new Date().toISOString()), 1000);
    return () => clearInterval(t);
  }, []);

  const stamp = (): StampInfo => ({ role, name: client ? name : signer.name, matricula: client ? matricula : signer.matricula, cargo: signer.cargo, rating: client ? rating || undefined : undefined, at: now });

  const redraw = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    drawStamp(ctx, stamp());
    drawStrokes(ctx, strokes.current);
  };
  useEffect(redraw, [name, matricula, rating, now, rotated, step]);

  // Ponto do dedo/caneta nas coordenadas do quadro (também com o quadro girado 90°)
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (rotated) {
      const lx = e.clientY - r.top;
      const ly = r.right - e.clientX;
      return { x: (lx / r.height) * W, y: (ly / r.width) * H };
    }
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    strokes.current.push([point(e)]);
    setHasInk(true);
    redraw();
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    strokes.current[strokes.current.length - 1].push(point(e));
    redraw();
  };
  const up = () => {
    drawing.current = false;
  };
  const clear = () => {
    strokes.current = [];
    setHasInk(false);
    redraw();
  };

  const dataError = () =>
    !client ? null : !name.trim() ? 'Informe o nome do cliente.' : !matricula.trim() ? 'Informe a matrícula do cliente.' : !rating ? 'O cliente precisa escolher de 1 a 5 estrelas.' : null;
  const goSign = () => {
    const err = dataError();
    if (err) return setMsg(err);
    setMsg(null);
    setStep('sign');
  };
  const confirm = () => {
    const err = dataError();
    if (err) {
      setMsg(err);
      return setStep('data');
    }
    if (!hasInk) return setMsg('Desenhe a assinatura no quadro.');
    onConfirm(strokes.current.map((s) => [...s]), { name: client ? name.trim() : signer.name, matricula: client ? matricula.trim() : signer.matricula, cargo: signer.cargo, rating: client ? rating : undefined });
  };

  const color = OS_SIGN_COLOR[role];
  const box = rotated
    ? { width: '100vh', height: '100vw', transform: 'rotate(90deg)', transformOrigin: 'center center', position: 'absolute' as const, top: 'calc(50% - 50vw)', left: 'calc(50% - 50vh)' }
    : { width: '100%', height: '100%' };

  // 1º passo do cliente (em pé): dados do carimbo
  if (step === 'data')
    return (
      <div className="fixed inset-0 z-[2000] bg-slate-900/80 overflow-y-auto flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2" style={{ borderTop: `4px solid ${color}` }}>
            <p className="text-sm font-black text-slate-900 truncate">{title || `Assinatura — ${OS_SIGN_LABEL[role]}`}</p>
            <button type="button" onClick={onCancel} className="h-8 w-8 rounded-lg border border-slate-200 flex items-center justify-center cursor-pointer shrink-0" title="Cancelar">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-[11px] text-slate-500">Preencha os dados do cliente. Depois o quadro abre deitado para a assinatura.</p>
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Nome do cliente *</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 h-11 w-full px-3 text-sm border border-slate-200 rounded-lg" autoComplete="off" />
            </label>
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Matrícula *</span>
              <input value={matricula} onChange={(e) => setMatricula(e.target.value)} className="mt-1 h-11 w-full px-3 text-sm border border-slate-200 rounded-lg" autoComplete="off" />
            </label>
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Avaliação do atendimento *</span>
              <div className="mt-1 flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" onClick={() => setRating(n)} className="p-1 cursor-pointer" aria-label={`${n} estrela(s)`}>
                    <Star className={`w-8 h-8 ${n <= rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
                  </button>
                ))}
              </div>
            </div>
            {msg && <p className="text-xs font-bold text-rose-600">{msg}</p>}
          </div>
          <div className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
            <button type="button" onClick={onCancel} className="h-10 px-4 rounded-xl border border-slate-200 text-xs font-bold cursor-pointer">Cancelar</button>
            <button type="button" onClick={goSign} className="h-10 px-5 rounded-xl text-white text-xs font-black cursor-pointer" style={{ background: color }}>
              Continuar para assinar
            </button>
          </div>
        </div>
      </div>
    );

  return (
    <div className="fixed inset-0 z-[2000] bg-slate-900/80 overflow-hidden">
      <div style={box} className="flex items-center justify-center p-2">
        <div className="w-full max-w-4xl max-h-full bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2" style={{ borderTop: `4px solid ${color}` }}>
            <div className="min-w-0">
              <p className="text-sm font-black text-slate-900 truncate">{title || `Assinatura — ${OS_SIGN_LABEL[role]}`}</p>
              {client ? (
                <p className="text-[11px] text-slate-500 truncate">
                  {name} · {matricula} · {'★'.repeat(rating)}{' '}
                  <button type="button" onClick={() => setStep('data')} className="font-bold underline cursor-pointer" style={{ color }}>Alterar</button>
                </p>
              ) : (
                <p className="text-[11px] text-slate-500 truncate">{signer.name}{signer.matricula ? ` · ${signer.matricula}` : ''}{signer.cargo ? ` · ${signer.cargo}` : ''}</p>
              )}
            </div>
            <button type="button" onClick={onCancel} className="h-8 w-8 rounded-lg border border-slate-200 flex items-center justify-center cursor-pointer shrink-0" title="Cancelar">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-2 flex-1 min-h-0 flex items-center justify-center bg-slate-50">
            <canvas
              ref={canvasRef}
              width={W}
              height={H}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              className="w-full max-h-full bg-white rounded-xl border-2 border-dashed touch-none cursor-crosshair"
              style={{ aspectRatio: `${W} / ${H}`, borderColor: color }}
              aria-label="Quadro de assinatura"
            />
          </div>
          {msg && <p className="px-4 text-xs font-bold text-rose-600">{msg}</p>}
          <div className="px-4 py-2.5 border-t border-slate-200 flex justify-between gap-2">
            <button type="button" onClick={clear} className="h-10 px-4 rounded-xl border border-slate-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer">
              <Eraser className="w-4 h-4" /> Limpar
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={onCancel} className="h-10 px-4 rounded-xl border border-slate-200 text-xs font-bold cursor-pointer">Cancelar</button>
              <button type="button" onClick={confirm} className="h-10 px-5 rounded-xl text-white text-xs font-black cursor-pointer" style={{ background: color }}>
                Confirmar assinatura
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
