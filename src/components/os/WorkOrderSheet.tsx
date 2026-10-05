import React, { useEffect, useState } from 'react';
import { AlertTriangle, Calculator, X } from 'lucide-react';
import { HexonUser, WorkOrder } from '../../types';
import {
  WorkOrderCost,
  brl,
  dbCancelWorkOrder,
  dbGetWorkOrder,
  dbGetWorkOrderCost,
  dbPauseWorkOrder,
  dbResumeWorkOrder,
  fmtMinutes,
  osMembers
} from '../../db/firebase';
import OsAnswersView, { STATUS_STYLE, dayBR, isOverdue } from './OsAnswersView';

// FICHA DA OS (escritório): cabeçalho, dados da abertura, execução (respostas, equipe, materiais, feriados,
// hora extra, pernoite), custo e homem-hora (quem pode ver valores), pausas, linha do tempo.
// Botões: Pendente/Retomar (quem atribui), Cancelar OS (permissão "Cancelar OS"), Fechar.

interface Props {
  order: WorkOrder;
  userProfile: HexonUser;
  canAssign: boolean;
  canCancel: boolean;
  canViewCosts: boolean;
  onClose: () => void;
  onChanged: () => void;
}

const h3 = 'text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5';
const fmtDT = (iso?: string) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

export default function WorkOrderSheet({ order: initial, userProfile, canAssign, canCancel, canViewCosts, onClose, onChanged }: Props) {
  const [o, setO] = useState<WorkOrder>(initial);
  const [cost, setCost] = useState<WorkOrderCost | null>(null);
  const [costBusy, setCostBusy] = useState(false);
  const [action, setAction] = useState<'pause' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Lê a versão mais nova da OS (a lista pode estar alguns minutos atrás)
  useEffect(() => {
    dbGetWorkOrder(initial.id).then((fresh) => fresh && setO(fresh)).catch(() => {});
  }, [initial.id]);

  const calc = async (target = o) => {
    setCostBusy(true);
    try {
      setCost(await dbGetWorkOrderCost(target));
    } catch (err: any) {
      setMsg(`Não foi possível calcular: ${err?.message || err}`);
    } finally {
      setCostBusy(false);
    }
  };
  useEffect(() => {
    if (canViewCosts && o.assignedAt) calc(o);
  }, [canViewCosts, o.updatedAt]);

  const run = async (fn: () => Promise<any>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      const fresh = await dbGetWorkOrder(o.id);
      if (fresh) setO(fresh);
      setAction(null);
      setReason('');
      onChanged();
    } catch (err: any) {
      setMsg(err?.code === 'permission-denied' ? 'O banco recusou: seu perfil não pode fazer isso nesta OS.' : `Não foi possível: ${err?.message || err}`);
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    if (!reason.trim()) return setMsg('Informe o motivo.');
    if (action === 'pause') run(() => dbPauseWorkOrder(o, reason, userProfile.name));
    if (action === 'cancel') run(() => dbCancelWorkOrder(o, reason, userProfile.name));
  };

  const exec = o.exec;
  const members = osMembers(o);
  const open = ['Nova', 'Em andamento', 'Pendente'].includes(o.status);
  const line = (l: { label: string; detail: string; value: number | null }, i: number) => (
    <div key={i} className="flex items-start justify-between gap-3 py-1.5 text-xs border-t border-slate-100 first:border-t-0">
      <div className="min-w-0">
        <p className="font-bold text-slate-800">{l.label}</p>
        <p className="text-[10px] text-slate-500">{l.detail}</p>
      </div>
      <span className={`font-black whitespace-nowrap ${l.value === null ? 'text-amber-600' : 'text-slate-800'}`}>{l.value === null ? 'sem valor' : brl(l.value)}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[1000] bg-slate-900/60 flex items-center justify-center p-2 md:p-4">
      <div className="w-full max-w-4xl max-h-[94vh] overflow-y-auto rounded-2xl bg-slate-50">
        {/* Cabeçalho */}
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-5 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-base font-black text-indigo-700">{o.number}</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${STATUS_STYLE[o.status] || ''}`}>{o.status}</span>
              {isOverdue(o) && <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-600 text-white">ATRASADA</span>}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {o.intervencao || 'OS'} · modelo {o.templateName} (v{o.templateVersion}) · gerência {o.unit}
            </p>
          </div>
          <button type="button" onClick={onClose} className="h-8 w-8 rounded-lg border border-slate-200 flex items-center justify-center cursor-pointer shrink-0" title="Fechar">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            {[
              ['Registrada por', o.createdByName],
              ['Criada em', fmtDT(o.createdAt)],
              ['Prazo (SLA)', dayBR(o.deadline)],
              ['Técnico', o.assignedTechnicianName || 'Em aberto']
            ].map(([k, v]) => (
              <div key={k} className="p-2.5 rounded-xl bg-white border border-slate-200">
                <p className="text-[10px] font-black uppercase text-slate-400">{k}</p>
                <p className="font-bold text-slate-800 truncate">{v}</p>
              </div>
            ))}
          </div>

          {o.status === 'Cancelada' && (
            <p className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
              <b>Cancelada</b> por {o.cancelledBy} em {fmtDT(o.cancelledAt)}: {o.cancelReason}
            </p>
          )}

          <div>
            <p className={h3}>Dados da abertura</p>
            <OsAnswersView order={o} stage="criacao" />
          </div>

          <div className="space-y-3">
            <p className={h3}>Execução {exec?.updatedBy ? `· salva por ${exec.updatedBy} em ${fmtDT(exec.updatedAt)}` : '· ainda não preenchida'}</p>
            {exec && <OsAnswersView order={o} stage="execucao" />}
            <div className="grid md:grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-white border border-slate-200">
                <p className={h3}>Equipe ({members.length})</p>
                {members.map((p) => (
                  <p key={p.matricula} className="text-xs text-slate-700">{p.name} <span className="text-slate-400">· {p.cargo || 'sem cargo'} · {p.matricula}</span></p>
                ))}
              </div>
              <div className="p-3 rounded-xl bg-white border border-slate-200">
                <p className={h3}>Materiais ({exec?.materials.length || 0})</p>
                {(exec?.materials || []).map((m) => (
                  <p key={m.id} className="text-xs text-slate-700">{m.description} <span className="text-slate-400">· {String(m.qty).replace('.', ',')} {m.measureUnit}</span></p>
                ))}
              </div>
              <div className="p-3 rounded-xl bg-white border border-slate-200 text-xs text-slate-700 space-y-1">
                <p className={h3}>Feriados, hora extra e pernoite</p>
                <p>Feriados: {exec?.holidays.length ? exec.holidays.map(dayBR).join(', ') : 'nenhum'}</p>
                <p>
                  Hora extra:{' '}
                  {exec?.overtime?.length
                    ? exec.overtime.map((d) => `${dayBR(d.date)} ${fmtMinutes(d.minutes)}${d.holiday ? ' (feriado)' : ''}`).join(' · ')
                    : 'não houve'}
                </p>
                <p>Pernoite: {exec?.overnightNights ? `${exec.overnightNights} diária(s)` : 'não houve'}</p>
              </div>
              <div className="p-3 rounded-xl bg-white border border-slate-200 text-xs text-slate-700 space-y-1">
                <p className={h3}>Pendências</p>
                {(o.pauses || []).length === 0 && <p className="text-slate-400">Nenhuma.</p>}
                {(o.pauses || []).map((p, i) => (
                  <p key={i}>
                    {fmtDT(p.start)} → {p.end ? fmtDT(p.end) : 'em aberto'} · {p.reason} <span className="text-slate-400">({p.by})</span>
                  </p>
                ))}
              </div>
            </div>
          </div>

          {canViewCosts && (
            <div className="p-4 rounded-2xl bg-white border border-slate-200 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className={h3}>Custo e homem-hora</p>
                <button type="button" onClick={() => calc()} disabled={costBusy || !o.assignedAt} className="h-7 px-2.5 rounded-lg border border-slate-200 text-[10px] font-bold flex items-center gap-1 cursor-pointer disabled:opacity-40">
                  <Calculator className="w-3 h-3" /> {costBusy ? 'Calculando...' : 'Recalcular'}
                </button>
              </div>
              {!o.assignedAt && <p className="text-xs text-slate-400">O homem-hora começa a contar quando a OS é atribuída.</p>}
              {cost && (
                <>
                  <p className="text-[11px] text-slate-500">
                    Tempo que contou: <b>{fmtMinutes(cost.minutes)}</b> (seg–sex, 08–12 e 13–18, sem pendências e feriados) → <b>{String(cost.billedHours).replace('.', ',')} h</b> cobradas por pessoa
                    {cost.partial ? ' · parcial: conta até agora (fecha na assinatura do técnico)' : ''}.
                  </p>
                  {cost.labor.length > 0 && <div><p className="text-[10px] font-black text-slate-400 uppercase">Homem-hora</p>{cost.labor.map(line)}</div>}
                  {cost.overtime.length > 0 && <div><p className="text-[10px] font-black text-slate-400 uppercase">Hora extra</p>{cost.overtime.map(line)}</div>}
                  {cost.overnight && <div><p className="text-[10px] font-black text-slate-400 uppercase">Pernoite</p>{line(cost.overnight, 0)}</div>}
                  {cost.materials.length > 0 && <div><p className="text-[10px] font-black text-slate-400 uppercase">Materiais</p>{cost.materials.map(line)}</div>}
                  {cost.warnings.map((w, i) => (
                    <p key={i} className="text-[11px] font-bold text-amber-700 flex gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {w}</p>
                  ))}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                    <span className="text-xs font-black text-slate-700">{cost.partial ? 'Total parcial' : 'Total'}</span>
                    <span className="text-base font-black text-emerald-700">{brl(cost.total)}</span>
                  </div>
                  {cost.missing > 0 && <p className="text-[11px] font-bold text-amber-700">{cost.missing} linha(s) sem valor (cargo sem valor da hora, sem regras de hora extra ou material sem preço).</p>}
                </>
              )}
            </div>
          )}

          <div>
            <p className={h3}>Linha do tempo</p>
            <ul className="space-y-1 p-3 rounded-xl bg-white border border-slate-200">
              {(o.timeline || []).map((e, i) => (
                <li key={i} className="text-[11px] text-slate-700">
                  {fmtDT(e.at)} · <b>{e.action}</b>{e.note ? `: ${e.note}` : ''} · {e.by}
                </li>
              ))}
            </ul>
          </div>

          {msg && <p className="text-xs font-bold text-rose-600">{msg}</p>}
          {action ? (
            <div className="p-3 rounded-xl bg-white border border-slate-200 space-y-2">
              <p className="text-xs font-black text-slate-800">{action === 'pause' ? 'Deixar a OS pendente' : 'Cancelar a OS'}</p>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={action === 'pause' ? 'Motivo (ex.: aguardando peça)' : 'Motivo (ex.: chamado duplicado no GLPI)'} className="w-full h-9 px-3 text-xs border border-slate-200 rounded-lg" autoFocus />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => { setAction(null); setMsg(null); }} className="h-8 px-3 rounded-lg border border-slate-200 text-xs font-bold cursor-pointer">Voltar</button>
                <button type="button" onClick={confirm} disabled={busy} className={`h-8 px-3 rounded-lg text-white text-xs font-black cursor-pointer disabled:opacity-50 ${action === 'cancel' ? 'bg-rose-600' : 'bg-orange-600'}`}>
                  {busy ? 'Salvando...' : action === 'cancel' ? 'Cancelar OS' : 'Deixar pendente'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap justify-end gap-2">
              {canAssign && o.status === 'Em andamento' && (
                <button type="button" onClick={() => setAction('pause')} className="h-9 px-4 rounded-lg border border-orange-300 text-orange-700 text-xs font-black cursor-pointer">Pendente</button>
              )}
              {canAssign && o.status === 'Pendente' && (
                <button type="button" onClick={() => run(() => dbResumeWorkOrder(o, userProfile.name))} disabled={busy} className="h-9 px-4 rounded-lg border border-orange-300 text-orange-700 text-xs font-black cursor-pointer disabled:opacity-50">Retomar</button>
              )}
              {canCancel && open && (
                <button type="button" onClick={() => setAction('cancel')} className="h-9 px-4 rounded-lg border border-rose-300 text-rose-700 text-xs font-black cursor-pointer">Cancelar OS</button>
              )}
              <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg bg-slate-800 text-white text-xs font-black cursor-pointer">Fechar</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
