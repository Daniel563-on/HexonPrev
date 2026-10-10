import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, ChevronDown, ChevronRight, Copy, FileDown, Link2, Mail, MessageSquarePlus, MessageSquareReply, PauseCircle, PenTool, PlayCircle } from 'lucide-react';
import { Address, HexonUser, OrderParticipant, WorkOrder, WorkOrderExec } from '../../types';
import {
  OS_SIGN_LABEL,
  dbConcludeWorkOrder,
  dbAddWorkOrderNote,
  dbCreateOsValidation,
  dbGetAddresses,
  dbPauseWorkOrder,
  dbResumeWorkOrder,
  dbSignClient,
  osAnswerText,
  osFieldVisible,
  osValidationLink,
  stageItems,
  supplyBlockMessage,
  osStatusLabel
} from '../../db/firebase';
import OsSignaturePad, { Stroke, renderOsSignature } from './OsSignaturePad';
import OsFieldInput from './OsFieldInput';
import OsAnswersView, { STATUS_STYLE, dayBR, isOverdue } from './OsAnswersView';
import OsTeamPicker from './OsTeamPicker';
import OsFieldExtras from './OsFieldExtras';
import ExecutionExtras from '../orders/execution/ExecutionExtras';
import OsContestReplyModal from './OsContestReplyModal';
import OrderSuppliesBlock from '../supplies/OrderSuppliesBlock';
import { buildOsPdfBytes, downloadBytes } from '../../lib/osPdf';

// EXECUÇÃO DA OS PELO TÉCNICO (celular): perguntas de Execução do modelo (na ordem do modelo), equipe, materiais, feriados,
// hora extra e pernoite. Salvar grava no banco; o próximo técnico (se a OS for passada) continua daqui.
// Pendente = pausa com motivo (o tempo parado não conta). Concluir = o técnico assina (o homem-hora para);
// depois o cliente assina no celular ou recebe o link de validação. Depois da assinatura do técnico nada muda:
// Contestada = "Responder contestação" (o que foi resolvido + acréscimos) e a OS volta para o cliente.

interface Props {
  order: WorkOrder;
  userProfile: HexonUser;
  onClose: () => void;
  onChanged: (o: WorkOrder) => void;
  canClientLink?: boolean; // "Enviar link de validação ao cliente": sem ela, o técnico não vê o link
  canPdf?: boolean;        // "Baixar PDF da OS": botão PDF no topo (mapeado do modelo ou o padrão; com o que está salvo)
}

const label = 'block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500';

export default function OsExecutionForm({ order, userProfile, onClose, onChanged, canClientLink = false, canPdf = false }: Props) {
  const me: OrderParticipant = { matricula: userProfile.matricula, name: userProfile.name, cargo: userProfile.cargo || '' };
  const initial = (): WorkOrderExec => {
    const e = order.exec;
    const team = e?.team?.length ? e.team : [];
    return {
      answers: { ...(e?.answers || {}) },
      // O técnico atual entra sempre (primeiro da lista)
      team: [me, ...team.filter((p) => p.matricula !== me.matricula)],
      materials: [...(e?.materials || [])],
      holidays: [...(e?.holidays || [])],
      overtime: e?.overtime ? e.overtime.map((d) => ({ ...d })) : null,
      overnightNights: e?.overnightNights ?? null,
      updatedAt: e?.updatedAt || '',
      updatedBy: e?.updatedBy || ''
    };
  };
  const [exec, setExec] = useState<WorkOrderExec>(initial);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [showCreation, setShowCreation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Pendente e Acompanhamento (ajustes da etapa 8): caixa no meio da tela, texto obrigatório; ao salvar, aviso e volta
  // para a lista. A execução não é salva no meio do caminho: só vai para o banco ao Concluir.
  const [dialog, setDialog] = useState<'pendente' | 'acompanhamento' | null>(null);
  const [dialogText, setDialogText] = useState('');
  const [dialogErr, setDialogErr] = useState('');
  const [done, setDone] = useState('');

  // Contestada antes desta mudança (sem a assinatura do técnico guardada): ainda corrige e conclui de novo
  const oldContest = order.status === 'Contestada' && !order.techSignedAt;
  const editable = order.status === 'Em andamento' || oldContest;
  const [replying, setReplying] = useState(false);
  // Depois da resposta à contestação (acréscimos), mostra a execução atualizada
  useEffect(() => {
    if (!editable) setExec(initial());
  }, [order.exec?.updatedAt]);
  const [signing, setSigning] = useState<'tecnico' | 'cliente' | null>(null);
  const [linkDays, setLinkDays] = useState(7);
  const fields = order.templateFields || [];
  const items = stageItems(fields, order.templateSystemFields || [], 'execucao');
  const needsAddresses = fields.some((f) => f.stage === 'execucao' && f.type === 'location');
  useEffect(() => {
    if (needsAddresses) dbGetAddresses().then(setAddresses);
  }, [needsAddresses]);

  const patch = (p: Partial<WorkOrderExec>) => {
    setExec((prev) => ({ ...prev, ...p }));
    setMsg(null);
  };
  const setAnswer = (id: string, v: any) => patch({ answers: { ...exec.answers, [id]: v } });

  // Execução na ordem do modelo: perguntas em sequência ficam no mesmo cartão; Equipe e Materiais no lugar deles.
  // Responsável (já entra na equipe), Pendência (botão Pendente) e Homem-hora (calculado) não viram campo.
  type ExecBlock = { kind: 'fields'; fields: typeof fields } | { kind: 'system'; key: 'equipe' | 'materiais' };
  const execBlocks = useMemo(() => {
    const out: ExecBlock[] = [];
    items.forEach((it) => {
      if (it.kind === 'field') {
        if (!osFieldVisible(it.field, fields, exec.answers)) return;
        const last = out[out.length - 1];
        if (last?.kind === 'fields') last.fields.push(it.field);
        else out.push({ kind: 'fields', fields: [it.field] });
      } else if (it.sys.key === 'equipe' || it.sys.key === 'materiais') out.push({ kind: 'system', key: it.sys.key });
    });
    return out;
  }, [items, fields, exec.answers]);
  const firstFields = execBlocks.findIndex((b) => b.kind === 'fields');

  // Confere e monta o que vai para o banco (null = algo a corrigir; a mensagem já aparece)
  const prepare = (): WorkOrderExec | null => {
    const fail = (text: string) => {
      setMsg({ ok: false, text });
      return null;
    };
    if (exec.overtime !== null) {
      const valid = exec.overtime.filter((d) => d.date && d.minutes > 0);
      if (valid.length === 0) return fail('Hora extra: informe o dia e as horas, ou marque "Não".');
      if (valid.length !== exec.overtime.length) return fail('Hora extra: há dia sem data ou sem horas. Preencha ou tire o dia.');
      const dates = valid.map((d) => d.date);
      if (new Set(dates).size !== dates.length) return fail('Hora extra: o mesmo dia foi lançado duas vezes. Junte as horas num só.');
    }
    if (exec.overnightNights !== null && !(exec.overnightNights > 0)) return fail('Pernoite: informe a quantidade de diárias, ou marque "Não".');
    // Respostas de perguntas escondidas não são gravadas
    const answers: Record<string, any> = {};
    fields
      .filter((f) => f.stage === 'execucao' && osFieldVisible(f, fields, exec.answers))
      .forEach((f) => {
        const v = exec.answers[f.id];
        if (f.type === 'toggle') answers[f.id] = !!v;
        else if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)) answers[f.id] = v;
      });
    return { ...exec, answers, materials: exec.materials.filter((m) => m.qty > 0) };
  };

  const openDialog = (d: 'pendente' | 'acompanhamento') => {
    setDialog(d);
    setDialogText('');
    setDialogErr('');
    setMsg(null);
  };
  const submitDialog = async () => {
    const text = dialogText.trim();
    if (!text) return setDialogErr(dialog === 'pendente' ? 'Informe o motivo da pendência.' : 'Escreva o acompanhamento.');
    setBusy(true);
    setDialogErr('');
    try {
      if (dialog === 'pendente') {
        const pauses = await dbPauseWorkOrder(order, text, userProfile.name);
        onChanged({ ...order, status: 'Pendente', pauses });
        setDone('Pendência registrada. A contagem do custo da OS parou até você retomar.');
      } else {
        await dbAddWorkOrderNote(order, text, userProfile.name);
        setDone('Acompanhamento salvo na linha do tempo da OS.');
      }
      setDialog(null);
    } catch (err: any) {
      setDialogErr(`Não foi possível salvar: ${err?.message || err}`);
    } finally {
      setBusy(false);
    }
  };

  const resume = async () => {
    setBusy(true);
    try {
      const pauses = await dbResumeWorkOrder(order, userProfile.name);
      onChanged({ ...order, status: 'Em andamento', pauses });
    } catch (err: any) {
      setMsg({ ok: false, text: `Não foi possível: ${err?.message || err}` });
    } finally {
      setBusy(false);
    }
  };

  // CONCLUIR: obrigatórias respondidas → o técnico assina
  const conclude = () => {
    // Pedido de insumos em aberto para esta OS (Fase 8C-2): avisa antes de tudo e não conclui
    const supplyBlock = supplyBlockMessage(order.id);
    if (supplyBlock) return setMsg({ ok: false, text: supplyBlock });
    const toSave = prepare();
    if (!toSave) return;
    const missing = fields.find(
      (f) => f.stage === 'execucao' && f.required && f.type !== 'toggle' && osFieldVisible(f, fields, exec.answers) && (exec.answers[f.id] === undefined || exec.answers[f.id] === '' || (Array.isArray(exec.answers[f.id]) && exec.answers[f.id].length === 0))
    );
    if (missing) return setMsg({ ok: false, text: `Para concluir, responda: ${missing.label}` });
    setMsg(null);
    setSigning('tecnico');
  };

  const onSigned = async (strokes: Stroke[], who: { name: string; matricula?: string; cargo?: string; rating?: number }) => {
    const role = signing!;
    const at = new Date().toISOString();
    const image = renderOsSignature(strokes, { role, ...who, at });
    setSigning(null);
    setBusy(true);
    try {
      if (role === 'tecnico') {
        const toSave = prepare();
        if (!toSave) return;
        const updated = await dbConcludeWorkOrder(order, toSave, { name: who.name, matricula: who.matricula, cargo: who.cargo, at, via: 'celular' }, image, userProfile.name);
        setMsg({ ok: true, text: updated.status === 'Concluída' ? 'OS concluída.' : 'Assinada! Agora a assinatura do cliente.' });
        onChanged(updated);
      } else {
        const updated = await dbSignClient(order, { name: who.name, matricula: who.matricula, rating: who.rating, at, via: 'celular', by: userProfile.name }, image, userProfile.name);
        setMsg({ ok: true, text: 'Assinatura do cliente registrada.' });
        setClientSignedNow(true);
        onChanged(updated);
      }
    } catch (err: any) {
      setMsg({ ok: false, text: err?.code === 'permission-denied' ? 'O banco recusou a assinatura.' : `Não foi possível: ${err?.message || err}` });
    } finally {
      setBusy(false);
    }
  };

  const makeLink = async () => {
    setBusy(true);
    try {
      const token = await dbCreateOsValidation(order, linkDays, userProfile.name);
      onChanged({ ...order, validationToken: token });
    } catch (err: any) {
      setMsg({ ok: false, text: `Não foi possível gerar o link: ${err?.message || err}` });
    } finally {
      setBusy(false);
    }
  };
  const link = order.validationToken ? osValidationLink(order.validationToken) : '';
  const mailto = link
    ? `mailto:?subject=${encodeURIComponent(`Validação do atendimento — ${order.number}`)}&body=${encodeURIComponent(
        `Olá,\n\nPor favor, confira o atendimento da ${order.number}${order.glpi ? ` (GLPI ${order.glpi})` : ''} e valide ou conteste pelo link:\n${link}\n\nObrigado.`
      )}`
    : '';

  const openPause = order.pauses?.length ? order.pauses[order.pauses.length - 1] : null;
  const section = 'p-4 rounded-2xl border border-slate-200 bg-white space-y-3';
  // PDF da OS (mapeado do modelo ou o padrão), com o que já está salvo no banco
  const [pdfBusy, setPdfBusy] = useState(false);
  const [clientSignedNow, setClientSignedNow] = useState(false); // o cliente acabou de assinar neste celular
  const downloadPdf = async () => {
    setPdfBusy(true);
    setMsg(null);
    try {
      downloadBytes(await buildOsPdfBytes(order), `${order.number}.pdf`);
    } catch (err: any) {
      setMsg({ ok: false, text: `Não foi possível gerar o PDF: ${err?.message || err}` });
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-slate-50 overflow-y-auto">
      <div className="max-w-2xl mx-auto pb-28">
        <header className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-200 px-4 py-3 flex items-center gap-3">
          <button type="button" onClick={onClose} className="h-9 w-9 rounded-xl border border-slate-200 flex items-center justify-center cursor-pointer" title="Voltar">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-sm font-black text-indigo-700">{order.number}</p>
            <p className="text-[11px] text-slate-500 truncate">{order.intervencao || 'OS'} · {order.execAddressText}</p>
          </div>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${STATUS_STYLE[order.status] || ''}`}>{osStatusLabel(order)}</span>
          {canPdf && (
            <button type="button" onClick={downloadPdf} disabled={pdfBusy} title="Baixar o PDF da OS (com o que já está salvo)" className="h-9 px-3 rounded-xl border border-slate-200 text-xs font-black text-slate-700 flex items-center gap-1 cursor-pointer disabled:opacity-50">
              <FileDown className="w-4 h-4" /> {pdfBusy ? '...' : 'PDF'}
            </button>
          )}
        </header>

        <div className="px-4 pt-4 space-y-3">
          {clientSignedNow && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 space-y-2">
              <p className="text-xs font-black text-emerald-800 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" /> Assinatura do cliente registrada
              </p>
              <p className="text-[11px] text-emerald-800">
                {order.status === 'Concluída' ? 'A OS foi concluída' : 'A OS segue para as próximas assinaturas'} e sai da sua lista ao fechar esta tela.
                {canPdf ? ' Se o cliente quiser a OS assinada, baixe o PDF agora.' : ''}
              </p>
              {canPdf && (
                <button type="button" onClick={downloadPdf} disabled={pdfBusy} className="h-10 px-4 rounded-lg bg-emerald-600 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
                  <FileDown className="w-4 h-4" /> {pdfBusy ? 'Gerando...' : 'Baixar PDF com a assinatura do cliente'}
                </button>
              )}
            </div>
          )}
          {isOverdue(order) && <p className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-[11px] font-black text-rose-700">Atrasada: prazo {dayBR(order.deadline)}</p>}
          {order.status === 'Pendente' && (
            <div className="p-3 rounded-xl bg-orange-50 border border-orange-200 space-y-2">
              <p className="text-xs font-black text-orange-800">Pendente{openPause ? `: ${openPause.reason}` : ''}</p>
              <p className="text-[11px] text-orange-800">O tempo parado não conta no homem-hora. Toque em Retomar para voltar a preencher.</p>
              <button type="button" onClick={resume} disabled={busy} className="h-9 px-4 rounded-lg bg-orange-600 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
                <PlayCircle className="w-4 h-4" /> Retomar
              </button>
            </div>
          )}

          {order.status === 'Contestada' && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 space-y-2">
              <p className="text-xs font-black text-rose-800">Contestada pelo cliente{order.contestReason ? `: ${order.contestReason}` : ''}</p>
              {oldContest ? (
                <p className="text-[11px] text-rose-800">Verifique, corrija e conclua de novo (o homem-hora voltou a contar).</p>
              ) : (
                <>
                  <p className="text-[11px] text-rose-800">A OS assinada não muda. Resolva com o cliente e informe o que foi feito (dá para acrescentar o que faltou). O homem-hora voltou a contar.</p>
                  <button type="button" onClick={() => setReplying(true)} className="w-full h-11 rounded-xl bg-rose-600 text-white text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer">
                    <MessageSquareReply className="w-4 h-4" /> Responder contestação
                  </button>
                </>
              )}
            </div>
          )}

          {order.status === 'Aguardando assinaturas' && (
            <div className="p-4 rounded-2xl border border-emerald-200 bg-emerald-50 space-y-3">
              <p className="text-xs font-black text-emerald-900 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" /> Concluída e assinada por {order.signatures?.tecnico?.name || 'você'}
              </p>
              {order.nextSigner === 'cliente' ? (
                <>
                  <p className="text-[11px] text-emerald-900">
                    Agora o cliente: assina aqui no celular{canClientLink ? ' ou recebe o link para validar.' : '. O link para o cliente validar é enviado pelo escritório.'}
                  </p>
                  <button type="button" onClick={() => setSigning('cliente')} disabled={busy} className="w-full h-11 rounded-xl bg-emerald-700 text-white text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50">
                    <PenTool className="w-4 h-4" /> Cliente assina agora no celular
                  </button>
                  {!canClientLink ? null : link ? (
                    <div className="space-y-2">
                      <p className="text-[11px] text-emerald-900 break-all">Link de validação: {link}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <a href={mailto} className="h-10 rounded-xl border border-emerald-300 bg-white text-emerald-800 text-xs font-black flex items-center justify-center gap-1.5">
                          <Mail className="w-4 h-4" /> Enviar por e-mail
                        </a>
                        <button type="button" onClick={() => navigator.clipboard?.writeText(link).then(() => setMsg({ ok: true, text: 'Link copiado.' }))} className="h-10 rounded-xl border border-emerald-300 bg-white text-emerald-800 text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer">
                          <Copy className="w-4 h-4" /> Copiar link
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <select value={linkDays} onChange={(e) => setLinkDays(Number(e.target.value))} className="h-10 px-2 text-xs border border-emerald-300 rounded-xl bg-white" aria-label="Validade do link">
                        {[3, 7, 15, 30, 60].map((d) => (
                          <option key={d} value={d}>Vale {d} dias</option>
                        ))}
                      </select>
                      <button type="button" onClick={makeLink} disabled={busy} className="flex-1 h-10 rounded-xl border border-emerald-300 bg-white text-emerald-800 text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50">
                        <Link2 className="w-4 h-4" /> Gerar link para o cliente
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-[11px] text-emerald-900">Aguardando a assinatura do {order.nextSigner ? OS_SIGN_LABEL[order.nextSigner].toLowerCase() : '—'} no sistema.</p>
              )}
            </div>
          )}

          <div className={section}>
            <button type="button" onClick={() => setShowCreation(!showCreation)} className="w-full flex items-center justify-between text-left cursor-pointer">
              <span className="text-xs font-black text-slate-800">Dados da abertura</span>
              {showCreation ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
            {!showCreation && <p className="text-[11px] text-slate-500">Prazo {dayBR(order.deadline)} · GLPI {order.glpi || '—'} · aberta por {order.createdByName}</p>}
            {showCreation && <OsAnswersView order={order} stage="criacao" />}
          </div>

          {execBlocks.map((b, i) =>
            b.kind === 'fields' ? (
              <div key={`f${i}`} className={section}>
                {i === firstFields && <p className="text-xs font-black text-slate-800">Execução</p>}
                {b.fields.map((f) => (
                  <div key={f.id}>
                    <span className={label}>{f.label}{f.required && f.type !== 'toggle' ? ' *' : ''}</span>
                    {editable ? (
                      <OsFieldInput field={f} value={exec.answers[f.id]} onChange={(v) => setAnswer(f.id, v)} addresses={addresses} signerName={userProfile.name} />
                    ) : (
                      <p className="text-xs text-slate-700 whitespace-pre-wrap">{osAnswerText(f, exec.answers[f.id]) || '—'}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : b.key === 'equipe' ? (
              <div key="equipe" className={section}>
                <p className="text-xs font-black text-slate-800">Equipe</p>
                <OsTeamPicker unit={order.unit} executor={me} team={exec.team} editable={editable} onChange={(team) => patch({ team })} />
              </div>
            ) : (
              <div key="materiais" className={section}>
                <ExecutionExtras
                  unit={order.unit}
                  editable={editable}
                  executor={me}
                  materials={exec.materials}
                  participants={[]}
                  hideParticipants
                  onChange={(next) => next.materialsUsed && patch({ materials: next.materialsUsed })}
                />
              </div>
            )
          )}

          {/* Insumos recebidos (Fase 8C-2): entram pelo "Recebi" do pedido de insumos; aparece só se houver */}
          <OrderSuppliesBlock orderId={order.id} compact />

          <OsFieldExtras
            company={order.company}
            editable={editable}
            team={exec.team}
            overtime={exec.overtime}
            overnightNights={exec.overnightNights}
            onChange={(next) => patch(next)}
          />

          {msg && <p className={`text-xs font-bold ${msg.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{msg.text}</p>}
        </div>
      </div>

      {replying && (
        <OsContestReplyModal
          order={order}
          userProfile={userProfile}
          onClose={() => setReplying(false)}
          onDone={(updated) => {
            setReplying(false);
            setMsg({ ok: true, text: 'Contestação respondida. Agora o cliente: assina no celular ou recebe um novo link.' });
            onChanged(updated);
          }}
        />
      )}

      {signing && (
        <OsSignaturePad
          role={signing}
          client={signing === 'cliente'}
          signer={{ name: userProfile.name, matricula: userProfile.matricula, cargo: userProfile.cargo || 'Técnico' }}
          title={signing === 'cliente' ? `Assinatura do cliente — ${order.number}` : `Concluir ${order.number} — assinatura do técnico`}
          onConfirm={onSigned}
          onCancel={() => setSigning(null)}
        />
      )}

      {dialog && (
        <div className="fixed inset-0 z-[70] bg-slate-900/50 flex items-center justify-center p-4">
          <div role="dialog" aria-label={dialog === 'pendente' ? 'Deixar a OS pendente' : 'Acompanhamento'} className="w-full max-w-md rounded-2xl bg-white p-4 space-y-3 shadow-2xl">
            <p className="text-sm font-black text-slate-900">{dialog === 'pendente' ? 'Deixar a OS pendente' : 'Acompanhamento'}</p>
            <p className="text-[11px] text-slate-500">
              {dialog === 'pendente'
                ? 'A contagem do custo da OS para até você retomar. Informe o motivo.'
                : 'O texto vai para a linha do tempo da OS exatamente como você escrever. A OS continua em andamento.'}
            </p>
            <textarea
              value={dialogText}
              onChange={(e) => {
                setDialogText(e.target.value);
                setDialogErr('');
              }}
              rows={4}
              autoFocus
              placeholder={dialog === 'pendente' ? 'Motivo da pendência (ex.: aguardando peça)' : 'Escreva o acompanhamento'}
              aria-label={dialog === 'pendente' ? 'Motivo da pendência' : 'Texto do acompanhamento'}
              className="w-full p-3 text-base border border-slate-200 rounded-xl"
            />
            {dialogErr && <p className="text-xs font-bold text-rose-600">{dialogErr}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setDialog(null)} disabled={busy} className="flex-1 h-11 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 cursor-pointer disabled:opacity-50">
                Cancelar
              </button>
              <button type="button" onClick={submitDialog} disabled={busy || !dialogText.trim()} className={`flex-1 h-11 rounded-xl text-white text-xs font-black cursor-pointer disabled:opacity-40 ${dialog === 'pendente' ? 'bg-orange-600' : 'bg-[#3525cd]'}`}>
                {busy ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {done && (
        <div className="fixed inset-0 z-[70] bg-slate-900/50 flex items-center justify-center p-4">
          <div role="dialog" aria-label="Salvo" className="w-full max-w-sm rounded-2xl bg-white p-5 space-y-3 text-center shadow-2xl">
            <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
            <p className="text-sm font-black text-slate-900">Salvo</p>
            <p className="text-xs text-slate-600">{done}</p>
            <button type="button" onClick={onClose} className="w-full h-11 rounded-xl bg-emerald-600 text-white text-xs font-black cursor-pointer">
              OK
            </button>
          </div>
        </div>
      )}

      {editable && (
        <div className="fixed bottom-0 left-0 right-0 z-[61] bg-white/95 backdrop-blur border-t border-slate-200">
          <div className="max-w-2xl mx-auto px-4 py-3 space-y-2">
            <div className="flex gap-2">
              {order.status === 'Em andamento' && (
                <button type="button" onClick={() => openDialog('pendente')} disabled={busy} className="h-11 px-3 rounded-xl border border-orange-300 text-orange-700 text-xs font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-40">
                  <PauseCircle className="w-4 h-4" /> Pendente
                </button>
              )}
              <button type="button" onClick={() => openDialog('acompanhamento')} disabled={busy} className="flex-1 h-11 rounded-xl border border-[#3525cd] text-[#3525cd] text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40">
                <MessageSquarePlus className="w-4 h-4" /> Acompanhamento
              </button>
              <button type="button" onClick={conclude} disabled={busy} className="flex-1 h-11 rounded-xl bg-[#3525cd] text-white text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50">
                <CheckCircle2 className="w-4 h-4" /> Concluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
