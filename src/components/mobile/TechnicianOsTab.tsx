import React, { useEffect, useState } from 'react';
import { CalendarRange, CheckCircle2, ChevronRight, Clock, FileDown, MapPin } from 'lucide-react';
import { HexonUser, WorkOrder } from '../../types';
import { dbDismissClientSigned, dbSyncOsValidation, osStatusLabel } from '../../db/firebase';
import { buildOsPdfBytes, downloadBytes } from '../../lib/osPdf';
import OsExecutionForm from '../os/OsExecutionForm';
import { osFileBase, osRefText } from '../../lib/osRef';
import { STATUS_STYLE, dayBR, isOverdue } from '../os/OsAnswersView';

// U14: cartão da OS no celular — faixa colorida pela situação, GLPI em destaque, situação curta numa linha só,
// endereço com a comarca, e embaixo o prazo e o dia programado
const STRIPE: Record<string, string> = {
  'Em andamento': 'bg-amber-400',
  Pendente: 'bg-orange-500',
  'Aguardando assinaturas': 'bg-indigo-500',
  Contestada: 'bg-rose-500'
};
const shortStatus = (o: WorkOrder) => osStatusLabel({ status: o.status, nextSigner: o.nextSigner }).replace(/^Aguardando assinatura d[oa] /, 'Aguardando ');

function OsCard({ o, darkMode, onOpen, footer, label, hint }: { key?: React.Key; o: WorkOrder; darkMode: boolean; onOpen: () => void; footer?: React.ReactNode; label?: string; hint?: string }) {
  const late = isOverdue(o);
  return (
    <div className={`rounded-2xl border shadow-2xs overflow-hidden flex ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
      <span className={`w-1.5 shrink-0 ${late ? 'bg-rose-500' : STRIPE[o.status] || 'bg-slate-300'}`} />
      <div className="flex-1 min-w-0">
        <button type="button" onClick={onOpen} aria-label={label || `Abrir a OS ${osRefText(o)}`} className="w-full text-left p-3.5 space-y-2 cursor-pointer">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className={`text-lg font-black leading-tight ${darkMode ? 'text-indigo-300' : 'text-indigo-700'}`}>GLPI {o.glpi || '—'}</p>
              <p className="text-[11px] font-semibold text-slate-500 truncate">
                {o.number} · {o.intervencao || 'OS'}
              </p>
            </div>
            <span className={`shrink-0 px-2 py-1 rounded-lg text-[10px] font-black whitespace-nowrap ${STATUS_STYLE[o.status] || ''}`}>{shortStatus(o)}</span>
          </div>
          <p className={`text-xs flex items-start gap-1.5 ${darkMode ? 'text-slate-300' : 'text-slate-600'}`}>
            <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
            <span className="min-w-0">
              <span className="line-clamp-2">{o.execAddressText || '—'}</span>
              {o.comarca && <span className="block text-[11px] font-bold text-slate-500">{o.comarca}</span>}
            </span>
          </p>
          {hint && <p className="text-[11px] font-black text-indigo-700 dark:text-indigo-300">{hint}</p>}
          <div className={`flex items-center gap-3 pt-2 border-t ${darkMode ? 'border-slate-800' : 'border-slate-100'}`}>
            <span className={`text-[11px] font-bold flex items-center gap-1 ${late ? 'text-rose-600' : 'text-slate-500'}`}>
              <Clock className="w-3.5 h-3.5" /> Prazo {dayBR(o.deadline)}
              {late ? ' · atrasada' : ''}
            </span>
            {o.scheduledDate && (
              <span className="text-[11px] font-black text-indigo-700 dark:text-indigo-300 flex items-center gap-1">
                <CalendarRange className="w-3.5 h-3.5" /> Dia {dayBR(o.scheduledDate).slice(0, 5)}
                {o.scheduledEndDate && o.scheduledEndDate !== o.scheduledDate ? ` a ${dayBR(o.scheduledEndDate).slice(0, 5)}` : ''}
              </span>
            )}
            <ChevronRight className="w-4 h-4 text-slate-400 ml-auto" />
          </div>
        </button>
        {footer}
      </div>
    </div>
  );
}

// MINHAS OS (técnico): as OS de corretiva, layout e acompanhamento que estão com ele agora.
// Se a OS for passada para outro técnico, some daqui (o novo continua de onde parou).
// Botões "Em aberto" e "Contestadas" (Fase 8A): as contestadas pelo cliente ficam em destaque para o técnico responder.
// "Assinadas pelo cliente" (ajustes da etapa 8): assinadas pelo cliente (link ou celular); ficam aqui (PDF e OK) até o OK
// ou até o engenheiro assinar. As duas listas vêm em tempo real do TechnicianMobileView (trocar de aba é instantâneo).
// U2 (16/10/2026): tocar na assinada abre a OS inteira em "somente visualizar" (com a linha do tempo); nada se altera.

export default function TechnicianOsTab({
  userProfile,
  darkMode,
  orders,
  signed,
  refreshKey = 0,
  canClientLink = false,
  canPdf = false
}: {
  userProfile: HexonUser;
  darkMode: boolean;
  orders: WorkOrder[] | null; // OS com o técnico (tempo real; null = carregando)
  signed: WorkOrder[]; // assinadas pelo cliente, até o OK ou a assinatura do engenheiro (tempo real)
  refreshKey?: number; // botão Atualizar do cabeçalho: traz de novo as respostas do link do cliente
  canClientLink?: boolean;
  canPdf?: boolean; // "Baixar PDF da OS": botão PDF na OS
}) {
  const [open, setOpen] = useState<WorkOrder | null>(null);
  // Assinada pelo cliente aberta só para ver: a versão mais nova da lista (tempo real); se sair da lista, fica a última
  const [openSigned, setOpenSigned] = useState<WorkOrder | null>(null);
  const signedLive = openSigned ? signed.find((o) => o.id === openSigned.id) || openSigned : null;
  type View = 'open' | 'pending' | 'contested' | 'signed';
  const [view, setView] = useState<View>('open');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const loading = orders === null;

  // Traz a resposta do link do cliente (aprovada → segue; contestada → volta para o técnico) ao abrir a aba e no
  // Atualizar. A OS muda no banco e a escuta atualiza a lista sozinha.
  useEffect(() => {
    const waiting = (orders || []).filter((o) => o.status === 'Aguardando assinaturas' && o.nextSigner === 'cliente' && o.validationToken);
    if (!waiting.length) return;
    setSyncing(true);
    Promise.all(waiting.map((o) => dbSyncOsValidation(o, userProfile.name).catch(() => null))).finally(() => setSyncing(false));
  }, [refreshKey, loading]);
  // Depois do cliente, a OS espera o engenheiro/gerente no sistema: sai da lista "Em aberto"
  const list = (orders || []).filter((o) => !(o.status === 'Aguardando assinaturas' && o.nextSigner !== 'cliente') && o.status !== 'Concluída');

  const contested = list.filter((o) => o.status === 'Contestada');
  // Pendentes em botão próprio (ajustes da etapa 8); "Em aberto" = em andamento e aguardando a assinatura do cliente
  const pending = list.filter((o) => o.status === 'Pendente');
  const openList = list.filter((o) => o.status !== 'Contestada' && o.status !== 'Pendente');
  const shown = view === 'contested' ? contested : view === 'pending' ? pending : view === 'signed' ? [] : openList;
  const tabBtn = (v: View, label: string, n: number) => {
    const on = view === v;
    const alert = (v === 'contested' || v === 'signed') && n > 0;
    return (
      <button
        type="button"
        onClick={() => setView(v)}
        className={`min-h-[44px] py-2 px-1 rounded-xl text-center transition-all flex flex-col items-center justify-center cursor-pointer ${
          on
            ? alert
              ? 'bg-rose-600 text-white shadow-xs font-black'
              : 'bg-indigo-600 text-white shadow-xs font-black'
            : alert
            ? darkMode
              ? 'bg-rose-950/40 text-rose-300 border border-rose-800 font-bold'
              : 'bg-rose-50 text-rose-700 border border-rose-300 font-bold'
            : darkMode
            ? 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800 font-bold'
            : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200 shadow-2xs font-bold'
        }`}
      >
        <span className="text-xs sm:text-[13px] leading-tight">{label}</span>
        <span className={`text-[11px] font-mono leading-none mt-1 ${on ? 'text-white/80 font-bold' : alert ? 'font-black' : 'text-slate-400 font-semibold'}`}>({n})</span>
      </button>
    );
  };
  return (
    <main className="flex-1 px-4 pt-4 space-y-3">
      <div>
        <h2 className={`text-base font-black ${darkMode ? 'text-white' : 'text-slate-900'}`}>Minhas OS</h2>
        <p className="text-[11px] text-slate-500">Corretiva, layout e acompanhamento atribuídas a você.{loading || syncing ? ' Atualizando...' : ''}</p>
      </div>
      <div className="grid grid-cols-4 gap-1.5 w-full">
        {tabBtn('open', 'Em aberto', openList.length)}
        {tabBtn('pending', 'Pendentes', pending.length)}
        {tabBtn('contested', 'Contestadas', contested.length)}
        {tabBtn('signed', 'Assinadas pelo cliente', signed.length)}
      </div>
      {notice && <p className={`text-xs font-bold ${notice.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{notice.text}</p>}
      {!loading && view !== 'signed' && shown.length === 0 && (
        <p className="text-xs text-slate-500 py-6 text-center">{view === 'contested' ? 'Nenhuma OS contestada.' : view === 'pending' ? 'Nenhuma OS pendente.' : 'Nenhuma OS com você agora.'}</p>
      )}
      {view === 'signed' && (
        <>
          <p className="text-[11px] text-slate-500">
            O cliente assinou (no celular ou pelo link). Sai daqui sozinha quando o engenheiro assinar. Toque na OS para ver tudo (só visualizar).{' '}
            {canPdf ? 'Baixe o PDF com a validação do cliente se precisar e toque em OK.' : 'Toque em OK para tirar da lista.'}
          </p>
          {!loading && signed.length === 0 && <p className="text-xs text-slate-500 py-6 text-center">Nenhuma OS assinada pelo cliente para ver.</p>}
          {signed.map((o) => {
            const cli = o.signatures?.cliente;
            return (
              <OsCard
                key={o.id}
                o={o}
                darkMode={darkMode}
                onOpen={() => setOpenSigned(o)}
                label={`Ver a OS ${osRefText(o)}`}
                hint="Ver a OS (só visualizar)"
                footer={
                  <div className="px-3.5 pb-3.5 space-y-2">
                  {cli && (
                    <p className="text-[11px] font-bold text-emerald-600 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> {cli.via === 'link' ? 'Validada' : 'Assinada'} por {cli.name} em {new Date(cli.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                    </p>
                  )}
                <div className="flex gap-2 pt-1">
                  {canPdf && (
                    <button
                      type="button"
                      disabled={busyId === o.id}
                      onClick={async () => {
                        setBusyId(o.id);
                        setNotice(null);
                        try {
                          downloadBytes(await buildOsPdfBytes(o), `${osFileBase(o)}.pdf`);
                        } catch (e: any) {
                          setNotice({ ok: false, text: `Não foi possível gerar o PDF: ${e?.message || e}` });
                        } finally {
                          setBusyId(null);
                        }
                      }}
                      className="flex-1 h-10 rounded-xl border border-slate-300 text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <FileDown className="w-4 h-4" /> PDF
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busyId === o.id}
                    onClick={async () => {
                      setBusyId(o.id);
                      setNotice(null);
                      try {
                        await dbDismissClientSigned(o);
                      } catch (e: any) {
                        setNotice({ ok: false, text: `Não foi possível: ${e?.message || e}` });
                      } finally {
                        setBusyId(null);
                      }
                    }}
                    className="flex-1 h-10 rounded-xl bg-emerald-600 text-white text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-4 h-4" /> OK
                  </button>
                </div>
                  </div>
                }
              />
            );
          })}
        </>
      )}
      {/* U14: o dia programado pelo planejador (Programação, Fase 7C-2) fica no rodapé do cartão */}
      {shown.map((o) => (
        <OsCard key={o.id} o={o} darkMode={darkMode} onOpen={() => setOpen(o)} />
      ))}
      {open && (
        <OsExecutionForm
          order={open}
          userProfile={userProfile}
          canClientLink={canClientLink}
          canPdf={canPdf}
          onClose={() => setOpen(null)}
          onChanged={(u) => setOpen(u)}
        />
      )}
      {signedLive && (
        <OsExecutionForm
          order={signedLive}
          userProfile={userProfile}
          canPdf={canPdf}
          viewOnly
          onClose={() => setOpenSigned(null)}
          onChanged={() => {}}
        />
      )}
    </main>
  );
}
