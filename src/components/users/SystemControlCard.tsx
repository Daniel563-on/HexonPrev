import React, { useEffect, useState } from 'react';
import { AppControl, APP_VERSION, dbForceReloadAll, dbSetMaintenance, subscribeAppControl } from '../../db/appControl';

// SISTEMA (só Super Administrador): forçar atualização em todos os aparelhos e modo manutenção
export default function SystemControlCard({ darkMode, userName }: { darkMode: boolean; userName: string }) {
  const [control, setControl] = useState<AppControl | null>(null);
  const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState<'reload' | 'maintenance-on' | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(
    () =>
      subscribeAppControl((c) => {
        setControl(c);
        if (c?.maintenanceMessage !== undefined) setMessage((m) => m || c.maintenanceMessage || '');
      }),
    []
  );

  const run = async (action: () => Promise<void>, okText: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await action();
      setMsg({ ok: true, text: okText });
      setConfirm(null);
    } catch (err: any) {
      setMsg({ ok: false, text: `Não foi possível: ${err?.message || err}` });
    } finally {
      setBusy(false);
    }
  };

  const box = darkMode ? 'bg-[#0a1122]/40 border-slate-800' : 'bg-white border-slate-200';
  const strong = darkMode ? 'text-slate-200' : 'text-slate-800';
  const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
  const on = !!control?.maintenance;
  const btn = 'px-4 py-2 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-50';

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* FORÇAR ATUALIZAÇÃO */}
      <div className={`p-5 rounded-xl border space-y-3 ${box}`}>
        <div>
          <h3 className={`text-sm font-black uppercase tracking-wider ${strong}`}>Forçar atualização</h3>
          <p className="text-xs text-slate-500 mt-1">
            Todos os celulares e computadores com o sistema aberto veem o aviso "Nova versão do sistema" e recarregam sozinhos em 1 minuto
            (o que foi salvo sem internet é enviado antes). Use depois de publicar uma versão nova. O app também confere sozinho a cada 30 minutos.
          </p>
          <p className="text-[10px] text-slate-400 mt-1">Versão aberta neste aparelho: {APP_VERSION === 'dev' ? 'desenvolvimento' : fmt(APP_VERSION)}</p>
        </div>
        {confirm !== 'reload' ? (
          <button type="button" onClick={() => { setConfirm('reload'); setMsg(null); }} className={`${btn} bg-blue-600 hover:bg-blue-700 text-white`}>
            Forçar atualização em todos os aparelhos
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs font-bold ${strong}`}>Confirma? Todos os aparelhos abertos vão recarregar.</span>
            <button type="button" disabled={busy} onClick={() => run(() => dbForceReloadAll(userName), 'Aviso enviado: os aparelhos abertos vão recarregar em 1 minuto.')} className={`${btn} bg-blue-600 hover:bg-blue-700 text-white`}>
              {busy ? 'Enviando...' : 'Sim, forçar'}
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirm(null)} className={`${btn} border border-slate-300 text-slate-600`}>
              Cancelar
            </button>
          </div>
        )}
      </div>

      {/* MODO MANUTENÇÃO */}
      <div className={`p-5 rounded-xl border space-y-3 ${on ? 'border-amber-400 bg-amber-50/60' : box}`}>
        <div>
          <h3 className={`text-sm font-black uppercase tracking-wider ${on ? 'text-amber-900' : strong}`}>
            Modo manutenção {on ? '— LIGADO' : '— desligado'}
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Ligado: todos (menos o Super Administrador) veem "Aplicativo em manutenção", são desconectados e não conseguem entrar.
            Antes de sair, o aparelho envia o que foi salvo sem internet. Celular sem internet só recebe quando a internet voltar.
          </p>
          {control?.updatedAt && (
            <p className="text-[10px] text-slate-400 mt-1">Última alteração: {fmt(control.updatedAt)} por {control.updatedBy}</p>
          )}
        </div>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Mensagem na tela de manutenção (opcional). Ex.: Voltamos às 14h."
          className="w-full text-xs p-2.5 rounded-lg border border-slate-200 bg-white text-slate-800 min-h-[60px]"
        />
        {on ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => run(() => dbSetMaintenance(false, message, userName), 'Modo manutenção desligado: todos podem entrar de novo.')} className={`${btn} bg-emerald-600 hover:bg-emerald-700 text-white`}>
              {busy ? 'Salvando...' : 'Desligar manutenção'}
            </button>
            <button type="button" disabled={busy} onClick={() => run(() => dbSetMaintenance(true, message, userName), 'Mensagem atualizada.')} className={`${btn} border border-slate-300 text-slate-600`}>
              Atualizar mensagem
            </button>
          </div>
        ) : confirm !== 'maintenance-on' ? (
          <button type="button" onClick={() => { setConfirm('maintenance-on'); setMsg(null); }} className={`${btn} bg-amber-500 hover:bg-amber-600 text-white`}>
            Ligar modo manutenção
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs font-bold ${strong}`}>Confirma? Todos, menos o Super Administrador, serão desconectados.</span>
            <button type="button" disabled={busy} onClick={() => run(() => dbSetMaintenance(true, message, userName), 'Modo manutenção ligado.')} className={`${btn} bg-amber-500 hover:bg-amber-600 text-white`}>
              {busy ? 'Ligando...' : 'Sim, ligar'}
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirm(null)} className={`${btn} border border-slate-300 text-slate-600`}>
              Cancelar
            </button>
          </div>
        )}
      </div>

      {msg && <p className={`text-xs font-bold ${msg.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{msg.text}</p>}
    </div>
  );
}
