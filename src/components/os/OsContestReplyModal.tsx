import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, MessageSquareReply, X } from 'lucide-react';
import { Address, HexonUser, OrderParticipant, UsedMaterial, WorkOrder, WorkOrderOvertimeDay } from '../../types';
import { dbGetAddresses, dbReplyContest, osFieldVisible, supplyBlockMessage } from '../../db/firebase';
import OsFieldInput from './OsFieldInput';
import OsTeamPicker from './OsTeamPicker';
import { osRefText } from '../../lib/osRef';
import OsFieldExtras from './OsFieldExtras';
import ExecutionExtras from '../orders/execution/ExecutionExtras';

// RESPONDER CONTESTAÇÃO: depois da assinatura do técnico a OS não muda. Aqui se informa o que foi resolvido e,
// se precisar, ACRESCENTA (perguntas ainda sem resposta, pessoas, materiais e hora extra; desde a Fase 7E-2 sem pernoite a
// mais: o pernoite é o do bloco da Programação, informado pelo planejador).
// Ao confirmar, a OS volta para a vez do cliente (assinar no celular ou novo link). Técnico da OS ou quem tem
// "Responder contestação de OS".

interface Props {
  order: WorkOrder;
  userProfile: HexonUser;
  onClose: () => void;
  onDone: (o: WorkOrder) => void;
}

const label = 'block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500';
const empty = (v: any) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

export default function OsContestReplyModal({ order, userProfile, onClose, onDone }: Props) {
  const base = order.exec!;
  const fields = order.templateFields || [];
  const last = order.contests?.length ? order.contests[order.contests.length - 1] : null;
  const [resolution, setResolution] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [team, setTeam] = useState<OrderParticipant[]>(base.team || []);
  const [materials, setMaterials] = useState<UsedMaterial[]>([]);
  const [overtime, setOvertime] = useState<WorkOrderOvertimeDay[] | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const executor: OrderParticipant = base.team?.[0] || { matricula: order.assignedTechnicianMatricula || '', name: order.assignedTechnicianName || '', cargo: '' };
  const locked = (base.team || []).map((p) => p.matricula);
  const merged = { ...base.answers, ...answers };
  // Só as perguntas de execução que ficaram sem resposta
  const open = useMemo(
    () => fields.filter((f) => f.stage === 'execucao' && f.type !== 'signature' && empty(base.answers?.[f.id]) && osFieldVisible(f, fields, merged)),
    [fields, base.answers, answers]
  );
  const needsAddresses = open.some((f) => f.type === 'location');
  useEffect(() => {
    if (needsAddresses) dbGetAddresses().then(setAddresses);
  }, [needsAddresses]);

  const confirm = async () => {
    if (resolution.trim().length < 5) return setMsg('Informe o que foi resolvido (pelo menos algumas palavras).');
    // Pedido de insumos em aberto para esta OS (Fase 8C-2): responder também encerra o trabalho do técnico
    const supplyBlock = supplyBlockMessage(order.id);
    if (supplyBlock) return setMsg(supplyBlock);
    if (overtime !== null) {
      const valid = overtime.filter((d) => d.date && d.minutes > 0);
      if (valid.length !== overtime.length || valid.length === 0) return setMsg('Hora extra a mais: informe o dia e as horas de cada dia, ou marque "Não".');
      const dates = valid.map((d) => d.date);
      if (new Set(dates).size !== dates.length) return setMsg('Hora extra a mais: o mesmo dia foi lançado duas vezes. Junte as horas num só.');
    }
    const add = {
      answers: Object.fromEntries(Object.entries(answers).filter(([id, v]) => !empty(v) && open.some((f) => f.id === id))),
      team: team.filter((p) => !locked.includes(p.matricula)),
      materials: materials.filter((m) => m.qty > 0),
      overtime,
      overnightNights: null
    };
    setBusy(true);
    setMsg(null);
    try {
      onDone(await dbReplyContest(order, resolution, add, userProfile.name));
    } catch (err: any) {
      setMsg(err?.code === 'permission-denied' ? 'O banco recusou: seu perfil não responde contestação nesta OS.' : `Não foi possível: ${err?.message || err}`);
      setBusy(false);
    }
  };

  const section = 'p-3 rounded-xl border border-slate-200 bg-white space-y-2';
  return (
    <div className="fixed inset-0 z-[1500] bg-slate-900/70 flex items-start md:items-center justify-center p-2 md:p-4">
      <div className="w-full max-w-2xl max-h-full flex flex-col bg-slate-50 rounded-2xl shadow-2xl overflow-hidden">
        <div className="shrink-0 px-4 py-3 bg-white border-b border-slate-200 flex items-center justify-between gap-2" style={{ borderTop: '4px solid #e11d48' }}>
          <div className="min-w-0">
            <p className="text-sm font-black text-slate-900">Responder contestação — {osRefText(order)}</p>
            <p className="text-[11px] text-slate-500">O que já está na OS não muda; aqui só se acrescenta.</p>
          </div>
          <button type="button" onClick={onClose} className="h-8 w-8 rounded-lg border border-slate-200 flex items-center justify-center cursor-pointer shrink-0" title="Fechar">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
            <p className="font-black">Contestação do cliente{last?.clientName ? ` (${last.clientName})` : ''}:</p>
            <p className="whitespace-pre-wrap">{order.contestReason || last?.reason || '—'}</p>
          </div>

          <label className="block">
            <span className={label}>O que foi resolvido *</span>
            <textarea
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Ex.: voltei ao local, troquei a bandeja do dreno e testei por 30 min sem vazamento."
              className="w-full p-3 text-sm border border-slate-200 rounded-xl bg-white"
            />
          </label>

          <button type="button" onClick={() => setShowAdd(!showAdd)} className="w-full p-3 rounded-xl border border-slate-200 bg-white flex items-center justify-between text-left cursor-pointer">
            <span className="text-xs font-black text-slate-800">Acrescentar à OS (opcional): respostas, equipe, materiais e hora extra</span>
            {showAdd ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>

          {showAdd && (
            <div className="space-y-3">
              {open.length > 0 && (
                <div className={section}>
                  <p className="text-xs font-black text-slate-800">Perguntas que ficaram sem resposta</p>
                  {open.map((f) => (
                    <div key={f.id}>
                      <span className={label}>{f.label}</span>
                      <OsFieldInput field={f} value={answers[f.id]} onChange={(v) => setAnswers((p) => ({ ...p, [f.id]: v }))} addresses={addresses} signerName={userProfile.name} unit={order.unit} />
                    </div>
                  ))}
                </div>
              )}
              <div className={section}>
                <p className="text-xs font-black text-slate-800">Equipe (quem já está não sai; pode acrescentar)</p>
                <OsTeamPicker unit={order.unit} company={order.company} executor={executor} executorTag="(técnico)" team={team} editable locked={locked} onChange={setTeam} />
              </div>
              <div className={section}>
                <p className="text-xs font-black text-slate-800">Materiais a mais (mesmo material soma à quantidade já lançada)</p>
                <ExecutionExtras
                  unit={order.unit}
                  company={order.company}
                  editable
                  executor={null}
                  materials={materials}
                  participants={[]}
                  hideParticipants
                  onChange={(next) => next.materialsUsed && setMaterials(next.materialsUsed)}
                />
              </div>
              <OsFieldExtras
                company={order.company}
                editable
                extra
                team={team}
                overtime={overtime}
                overnightNights={null}
                onChange={(next) => {
                  if ('overtime' in next) setOvertime(next.overtime ?? null);
                }}
              />
            </div>
          )}

          <p className="text-[11px] text-slate-500">Ao confirmar, a OS volta para o cliente: assinar no celular ou receber um novo link.</p>
        </div>
        <div className="shrink-0 px-4 py-3 bg-white border-t border-slate-200 flex flex-wrap items-center justify-end gap-2">
          {msg && <p className="flex-1 min-w-[160px] text-xs font-bold text-rose-600">{msg}</p>}
          <button type="button" onClick={onClose} className="h-10 px-4 rounded-xl border border-slate-200 bg-white text-xs font-bold cursor-pointer">Cancelar</button>
          <button type="button" onClick={confirm} disabled={busy} className="h-10 px-5 rounded-xl bg-rose-600 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
            <MessageSquareReply className="w-4 h-4" /> {busy ? 'Gravando...' : 'Confirmar resposta'}
          </button>
        </div>
      </div>
    </div>
  );
}
