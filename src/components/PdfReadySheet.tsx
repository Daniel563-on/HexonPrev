import React, { useEffect, useState } from 'react';
import { FileDown, X } from 'lucide-react';
import { ReadyFile, onReadyFile, openReadyFile } from '../lib/fileDelivery';

// Aviso "PDF pronto" (celular, P39): "Abrir / compartilhar" abre o menu do celular (Salvar em Arquivos, WhatsApp,
// e-mail, imprimir) sem o app sair da tela — no iPhone, sair da tela desliga o banco até recarregar.
export default function PdfReadySheet() {
  const [ready, setReady] = useState<ReadyFile | null>(null);
  const [err, setErr] = useState('');
  useEffect(
    () =>
      onReadyFile((r) => {
        setErr('');
        setReady((cur) => {
          if (cur) URL.revokeObjectURL(cur.url);
          return r;
        });
      }),
    []
  );
  if (!ready) return null;
  const close = () => {
    URL.revokeObjectURL(ready.url);
    setReady(null);
  };
  const open = () => {
    setErr('');
    openReadyFile(ready)
      .then((done) => done && close())
      .catch((e) => setErr(`Não foi possível abrir: ${e?.message || e}`));
  };
  return (
    <div className="fixed inset-x-0 bottom-0 z-[200] p-3">
      <div className="max-w-md mx-auto rounded-2xl bg-white border border-slate-200 shadow-2xl p-4 space-y-3">
        <div className="flex items-start gap-2">
          <p className="flex-1 text-sm font-black text-slate-900">
            {/\.pdf$/i.test(ready.file.name) ? 'PDF pronto' : 'Arquivo pronto'}
            <span className="block text-[11px] font-bold text-slate-500 break-all">{ready.file.name}</span>
          </p>
          <button type="button" onClick={close} title="Fechar" className="p-1 text-slate-400 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>
        <button type="button" onClick={open} className="w-full h-12 rounded-xl bg-indigo-600 text-white text-sm font-black flex items-center justify-center gap-2 cursor-pointer">
          <FileDown className="w-5 h-5" /> Abrir / compartilhar
        </button>
        {err && <p className="text-xs font-bold text-rose-600">{err}</p>}
      </div>
    </div>
  );
}
