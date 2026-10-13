import React, { useEffect, useState } from 'react';
import { AlertOctagon, AlertTriangle, CheckCircle2, FileText, Info, Pin, X } from 'lucide-react';
import { Company, Notice } from '../../types';
import { NOTICE_ALL_UNITS, NOTICE_FOREVER, dbGetNoticeFile, dbGetNoticeImageUrl } from '../../db/notices';
import { deliverBytes } from '../../lib/fileDelivery';

// QUADRO DE AVISOS: cartão de um aviso (computador e celular). Cor pelo tipo; foto só carrega quando o cartão aparece.
// PDF (Fase 7D): só é lido ao apertar "Abrir PDF"; no celular vai para o aviso "PDF pronto" (sem link de download).

export const NOTICE_KINDS = {
  urgente: {
    label: 'Urgente',
    color: '#e11d48',
    bg: 'bg-rose-50 dark:bg-rose-950/40',
    text: 'text-rose-700 dark:text-rose-300',
    Icon: AlertOctagon
  },
  atencao: {
    label: 'Atenção',
    color: '#d97706',
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    text: 'text-amber-700 dark:text-amber-300',
    Icon: AlertTriangle
  },
  info: {
    label: 'Informação',
    color: '#2563eb',
    bg: 'bg-blue-50 dark:bg-blue-950/40',
    text: 'text-blue-700 dark:text-blue-300',
    Icon: Info
  }
};

export const brDate = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

// "Para: GMMR · ELETRODATA · só técnicos"
export function noticeTargetText(n: Notice, companies: Company[]): string {
  const units = n.units.includes(NOTICE_ALL_UNITS) ? 'Todas as gerências' : n.units.join(', ');
  const cos = n.companies.length ? n.companies.map((id) => companies.find((c) => c.id === id)?.name || id).join(', ') : 'todas as empresas';
  const aud = n.audience === 'tecnicos' ? ' · só técnicos' : n.audience === 'escritorio' ? ' · só escritório' : '';
  return `${units} · ${cos}${aud}`;
}

function NoticeImage({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [big, setBig] = useState(false);
  useEffect(() => {
    let alive = true;
    dbGetNoticeImageUrl(id).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [id]);
  if (!url) return <div className="h-24 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />;
  return (
    <>
      <button type="button" onClick={() => setBig(true)} className="block cursor-zoom-in">
        <img src={url} alt="" className="max-h-64 rounded-lg border border-slate-200 dark:border-slate-700 object-contain" />
      </button>
      {big && (
        <div className="fixed inset-0 z-[1600] bg-slate-950/85 flex items-center justify-center p-3" onClick={() => setBig(false)}>
          <img src={url} alt="" className="max-w-full max-h-full rounded-lg" />
          <button type="button" className="absolute top-3 right-3 h-9 w-9 rounded-full bg-white/90 text-slate-800 flex items-center justify-center" title="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>
      )}
    </>
  );
}

function NoticePdf({ id, name }: { id: string; name: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const open = async () => {
    setBusy(true);
    setErr('');
    try {
      const f = await dbGetNoticeFile(id);
      if (!f) setErr('O PDF não foi encontrado.');
      else deliverBytes(f.bytes, f.name || name);
    } catch (e: any) {
      setErr(`Não foi possível abrir: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
      <FileText className="w-5 h-5 text-red-600 shrink-0" />
      <span className="flex-1 min-w-0 text-xs font-bold text-slate-800 dark:text-slate-100 truncate">{name}</span>
      <button type="button" onClick={open} disabled={busy} className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-black cursor-pointer disabled:opacity-60 shrink-0">
        {busy ? 'Abrindo…' : 'Abrir PDF'}
      </button>
      {err && <span className="text-[11px] font-bold text-rose-600">{err}</span>}
    </div>
  );
}

export interface NoticeCardProps {
  key?: string; // o projeto não tem os tipos do React: a lista precisa declarar a chave
  notice: Notice;
  companies: Company[];
  isNew?: boolean;
  showTarget?: boolean; // computador: para quem é
  confirm?: 'need' | 'done'; // urgente para esta pessoa: falta / já confirmou
  onConfirm?: () => void;
  confirming?: boolean;
  actions?: React.ReactNode; // botões de quem publica
}

export default function NoticeCard({ notice: n, companies, isNew, showTarget, confirm, onConfirm, confirming, actions }: NoticeCardProps) {
  const k = NOTICE_KINDS[n.kind];
  return (
    <article className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b1220] overflow-hidden" style={{ borderLeft: `5px solid ${k.color}` }}>
      <div className="p-4 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md ${k.bg} ${k.text}`}>
            <k.Icon className="w-3.5 h-3.5" />
            {k.label}
          </span>
          {n.pinned && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300">
              <Pin className="w-3 h-3" />
              Fixado
            </span>
          )}
          {isNew && <span className="px-2 py-0.5 rounded-md bg-emerald-600 text-white">Novo</span>}
          <span className="text-slate-500 font-medium">{brDate(n.createdAt)}</span>
        </div>
        <h3 className="text-base font-black text-slate-900 dark:text-white leading-snug">{n.title}</h3>
        <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words">{n.text}</p>
        {n.hasImage && <NoticeImage id={n.id} />}
        {n.hasFile && <NoticePdf id={n.id} name={n.fileName || 'aviso.pdf'} />}
        <p className="text-[11px] text-slate-500">
          {showTarget && <>Para: {noticeTargetText(n, companies)} · </>}
          Publicado por {n.createdBy.name}
          {n.until !== NOTICE_FOREVER && <> · até {brDate(n.until)}</>}
        </p>
        {confirm === 'need' && (
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirming}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-black cursor-pointer disabled:opacity-60"
          >
            {confirming ? 'Gravando…' : 'Li e estou ciente'}
          </button>
        )}
        {confirm === 'done' && (
          <p className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="w-4 h-4" />
            Você confirmou a leitura
          </p>
        )}
        {actions && <div className="flex flex-wrap gap-1.5 pt-1">{actions}</div>}
      </div>
    </article>
  );
}
