import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, ChevronDown, ChevronRight, Copy, Link2, Mail, MessageSquareReply, PauseCircle, PenTool, PlayCircle, Save } from 'lucide-react';
import { Address, HexonUser, OrderParticipant, WorkOrder, WorkOrderExec } from '../../types';
import {
  OS_SIGN_LABEL,
  dbConcludeWorkOrder,
  dbCreateOsValidation,
  dbGetAddresses,
  dbPauseWorkOrder,
  dbResumeWorkOrder,
  dbSaveWorkOrderExec,
  dbSignClient,
  osAnswerText,
  osFieldVisible,
  osValidationLink,
  stageItems,
  supplyBlockMessage
} from '../../db/firebase';
import OsSignaturePad, { Stroke, renderOsSignature } from './OsSignaturePad';
import OsFieldInput from './OsFieldInput';
import OsAnswersView, { STATUS_STYLE, dayBR, isOverdue } from './OsAnswersView';
import OsTeamPicker from './OsTeamPicker';
import OsFieldExtras from './OsFieldExtras';
import ExecutionExtras from '../orders/execution/ExecutionExtras';
import OsContestReplyModal from './OsContestReplyModal';
import OrderSuppliesBlock from '../supplies/OrderSuppliesBlock';

// EXECUÇÃO DA OS PELO TÉCNICO (celular): perguntas de Execução do modelo, equipe, materiais, feriados,
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
}

const label = 'block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500';

export default function OsExecutionForm({ order, userProfile, onClose, onChanged, canClientLink = false }: Props) {
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
  const [dirty, setDirty] = useState(false);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [showCreation, setShowCreation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pausing, setPausing] = useState(false);
  const [reason, setReason] = useState('');

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
    setDirty(true);
    setMsg(null);
  };
  const setAnswer = (id: string, v: any) => patch({ answers: { ...exec.answers, [id]: v } });

  const showsTeam = items.some((it) => it.kind === 'system' && it.sys.key === 'equipe');
  const showsMaterials = items.some((it) => it.kind === 'system' && it.sys.key === 'materiais');
  const execQuestions = useMemo(
    () => items.filter((it) => it.kind === 'field' && osFieldVisible(it.field, fields, exec.answers)),
    [items, fields, exec.answers]
  );

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

  const save = async () => {
    const toSave = prepare();
    if (!toSave) return;
    setBusy(true);
    setMsg(null);
    try {
      await dbSaveWorkOrderExec(order, toSave, userProfile.name, !order.exec);
      const updated: WorkOrder = { ...order, exec: { ...toSave, updatedAt: new Date().toISOString(), updatedBy: userProfile.name } };
      setDirty(false);
      setMsg({ ok: true, text: navigator.onLine === false ? 'Salvo no aparelho: vai para o banco quando a internet voltar.' : 'Execução salva.' });
      onChanged(updated);
    } catch (err: any) {
      setMsg({ ok: false, text: err?.code === 'permission-denied' ? 'O banco recusou: esta OS não está mais com você.' : `Não foi possível salvar: ${err?.message || err}` });
    } finally {
      setBusy(false);
    }
  };

  const pause = async () => {
    if (!reason.trim()) return setMsg({ ok: false, text: 'Informe o motivo da pendência.' });
    setBusy(true);
    try {
      const pauses = await dbPauseWorkOrder(order, reason, userProfile.name);
      setPausing(false);
      setReason('');
      onChanged({ ...order, status: 'Pendente', pauses });
    } catch (err: any) {
      setMsg({ ok: false, text: `Não foi possível: ${err?.message || err}` });
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
        setDirty(false);
        setMsg({ ok: true, text: updated.status === 'Concluída' ? 'OS concluída.' : 'Assinada! Agora a assinatura do cliente.' });
        onChanged(updated);
      } else {
        const updated = await dbSignClient(order, { name: who.name, matricula: who.matricula, rating: who.rating, at, via: 'celular', by: userProfile.name }, image, userProfile.name);
        setMsg({ ok: true, text: 'Assinatura do cliente registrada.' });
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
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${STATUS_STYLE[order.status] || ''}`}>{order.status}</span>
        </header>

        <div className="px-4 pt-4 space-y-3">
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

          {execQuestions.length > 0 && (
            <div className={section}>
              <p className="text-xs font-black text-slate-800">Execução</p>
              {execQuestions.map((it) =>
                it.kind === 'field' ? (
                  <div key={it.field.id}>
                    <span className={label}>{it.field.label}{it.field.required && it.field.type !== 'toggle' ? ' *' : ''}</span>
                    {editable ? (
                      <OsFieldInput field={it.field} value={exec.answers[it.field.id]} onChange={(v) => setAnswer(it.field.id, v)} addresses={addresses} signerName={userProfile.name} />
                    ) : (
                      <p className="text-xs text-slate-700 whitespace-pre-wrap">{osAnswerText(it.field, exec.answers[it.field.id]) || '—'}</p>
                    )}
                  </div>
                ) : null
              )}
            </div>
          )}

          {showsTeam && (
            <div className={section}>
              <p className="text-xs font-black text-slate-800">Equipe</p>
              <OsTeamPicker unit={order.unit} executor={me} team={exec.team} editable={editable} onChange={(team) => patch({ team })} />
            </div>
          )}

          {showsMaterials && (
            <div className={section}>
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
          {exec.updatedBy && !dirty && <p className="text-[10px] text-slate-400">Último salvamento por {exec.updatedBy}{exec.updatedAt ? ` em ${new Date(exec.updatedAt).toLocaleString('pt-BR')}` : ''}.</p>}
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

      {editable && (
        <div className="fixed bottom-0 left-0 right-0 z-[61] bg-white/95 backdrop-blur border-t border-slate-200">
          <div className="max-w-2xl mx-auto px-4 py-3 space-y-2">
            {pausing ? (
              <div className="flex gap-2">
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo da pendência (ex.: aguardando peça)" className="flex-1 h-10 px-3 text-xs border border-slate-200 rounded-xl" autoFocus />
                <button type="button" onClick={() => setPausing(false)} className="h-10 px-3 rounded-xl border border-slate-200 text-xs font-bold cursor-pointer">Voltar</button>
                <button type="button" onClick={pause} disabled={busy} className="h-10 px-3 rounded-xl bg-orange-600 text-white text-xs font-black cursor-pointer disabled:opacity-50">Confirmar</button>
              </div>
            ) : (
              <div className="flex gap-2">
                {order.status === 'Em andamento' && (
                  <button type="button" onClick={() => { setPausing(true); setMsg(null); }} disabled={busy || dirty} title={dirty ? 'Salve antes de deixar pendente' : ''} className="h-11 px-3 rounded-xl border border-orange-300 text-orange-700 text-xs font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-40">
                    <PauseCircle className="w-4 h-4" /> Pendente
                  </button>
                )}
                <button type="button" onClick={save} disabled={busy || !dirty} className="flex-1 h-11 rounded-xl border border-[#3525cd] text-[#3525cd] text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40">
                  <Save className="w-4 h-4" /> {busy ? 'Salvando...' : dirty ? 'Salvar' : 'Salvo'}
                </button>
                <button type="button" onClick={conclude} disabled={busy} className="flex-1 h-11 rounded-xl bg-[#3525cd] text-white text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50">
                  <CheckCircle2 className="w-4 h-4" /> Concluir
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
