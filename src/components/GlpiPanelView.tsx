import React, { useEffect, useRef, useState } from 'react';
import { Maximize2, RefreshCw, Upload, X } from 'lucide-react';
import { GlpiPanelHead, HexonUser } from '../types';
import { dbGetGlpiPanelHead, dbLoadGlpiPanelHtml, dbUploadGlpiPanel } from '../db/glpiPanel';

// HISTÓRICO GLPI (Fase 9B): mostra o painel do mês (HTML feito por fora) dentro de uma moldura isolada:
// os gráficos do painel funcionam, mas ele não enxerga nada do Hexon (sem acesso ao login nem aos dados do app).
// Quem tem "Atualizar Histórico GLPI" envia o arquivo novo, que substitui o anterior para todos.

const brDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

export default function GlpiPanelView({ user, canManage }: { user: HexonUser; canManage: boolean }) {
  const [head, setHead] = useState<GlpiPanelHead | null | undefined>(undefined);
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [full, setFull] = useState(false);
  const [sending, setSending] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const urlRef = useRef('');

  const show = (html: string) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    setUrl(urlRef.current);
  };

  const load = async () => {
    setStatus('Buscando o painel…');
    try {
      const h = await dbGetGlpiPanelHead();
      setHead(h);
      if (h) {
        setStatus('Abrindo o painel (na 1ª vez neste aparelho pode levar alguns segundos)…');
        show(await dbLoadGlpiPanelHtml(h));
      }
    } catch (err: any) {
      setMsg({
        ok: false,
        text: err?.code === 'permission-denied' ? 'Seu perfil não tem "Ver Histórico GLPI".' : `Não foi possível abrir o painel: ${err?.message || err}`
      });
    } finally {
      setStatus('');
    }
  };

  useEffect(() => {
    load();
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  const send = async (file?: File) => {
    if (!file) return;
    setMsg(null);
    setSending({ done: 0, total: 1 });
    try {
      await dbUploadGlpiPanel(file, { matricula: user.matricula, name: user.name }, (done, total) => setSending({ done, total }));
      setMsg({
        ok: true,
        text: 'Painel novo enviado. Todos passam a ver esta versão.'
      });
      await load();
    } catch (err: any) {
      setMsg({
        ok: false,
        text: err?.code === 'permission-denied' ? 'O banco recusou: seu perfil não atualiza o Histórico GLPI.' : `Não foi possível enviar: ${err?.message || err}`
      });
    } finally {
      setSending(null);
    }
  };

  const btn =
    'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 hover:border-indigo-300 cursor-pointer';
  // sandbox sem "allow-same-origin": o painel roda isolado do Hexon
  const frame = <iframe title="Painel GLPI" src={url} sandbox="allow-scripts" className="w-full h-full border-0 bg-white" />;

  return (
    <div className="p-4 sm:p-6 space-y-3 flex flex-col h-full">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-600 dark:text-slate-300 min-w-0">
          {head === undefined ? (
            'Carregando…'
          ) : head ? (
            <>
              <b>{head.fileName}</b> · enviado em {brDateTime(head.uploadedAt)} por {head.uploadedBy.name} · {(head.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB
            </>
          ) : (
            'Nenhum painel enviado ainda.'
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          {url && (
            <button type="button" className={btn} onClick={() => setFull(true)}>
              <Maximize2 className="w-4 h-4" />
              Tela cheia
            </button>
          )}
          <button type="button" className={btn} onClick={load} disabled={!!status}>
            <RefreshCw className={`w-4 h-4 ${status ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
          {canManage && (
            <label className={`${btn} bg-indigo-600 border-indigo-600 text-white hover:bg-indigo-700 ${sending ? 'opacity-60 pointer-events-none' : ''}`}>
              <Upload className="w-4 h-4" />
              {sending ? `Enviando ${Math.min(sending.done + 1, sending.total)} de ${sending.total}…` : 'Enviar painel novo'}
              <input type="file" accept=".html,.htm,text/html" className="hidden" onChange={(e) => send(e.target.files?.[0])} onClick={(e) => ((e.target as HTMLInputElement).value = '')} />
            </label>
          )}
        </div>
      </div>
      {canManage && <p className="text-[11px] text-slate-500">O painel novo substitui o atual para todos (o anterior é apagado).</p>}
      {msg && <p className={`text-xs font-bold ${msg.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{msg.text}</p>}
      {status && <p className="text-xs text-slate-500">{status}</p>}
      {/* Uma moldura só: a tela cheia muda o tamanho dela (o painel não recarrega) */}
      {url && (
        <div className={full ? 'fixed inset-0 z-[1500] bg-white' : 'h-[75vh] rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800'}>
          {frame}
          {full && (
            <button
              type="button"
              onClick={() => setFull(false)}
              className="absolute top-3 right-3 h-10 w-10 rounded-full bg-slate-900/80 text-white flex items-center justify-center cursor-pointer"
              title="Sair da tela cheia"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
