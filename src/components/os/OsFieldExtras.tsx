import React, { useEffect, useState } from 'react';
import { AlertTriangle, Hotel, Plus, Timer, Trash2 } from 'lucide-react';
import { OrderParticipant, OvertimeRules, WorkOrderOvertimeDay } from '../../types';
import { OVERTIME_DAYS, companyTracksCost, dbGetCompanies, dbGetOvertimeRules, overtimeDayKey, overtimeWarnings, rulesOfCompany } from '../../db/firebase';

// ADICIONAIS DE CAMPO (técnico): hora extra por dia (o pernoite só aparece: desde a Fase 7E-2 é o planejador quem informa). Dia de hora extra marcado como feriado
// também zera o homem-hora daquele dia. Valem para todos os colaboradores lançados na OS. O técnico não vê valores (R$).
// Etapa especial E5: só aparece quando a empresa da OS contabiliza homem-hora, hora extra e pernoite; avisos com as regras dela.

interface Props {
  editable: boolean;
  team: OrderParticipant[];
  overtime: WorkOrderOvertimeDay[] | null;
  overnightNights: number | null;
  onChange: (next: { overtime?: WorkOrderOvertimeDay[] | null; overnightNights?: number | null }) => void;
  extra?: boolean; // resposta à contestação: lança só o que for A MAIS (soma ao que já está na OS)
  company?: string; // empresa da OS
  plannedOvernight?: { nights: number; text: string } | null; // chamado em bloco da Programação: pernoite do planejador (Fase 7C-2)
}

const today = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const fmtH = (min: number) => `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`;
const label = 'text-[10px] font-black text-slate-400 uppercase tracking-widest';
const field = 'h-9 px-3 text-xs border border-slate-200 rounded-lg bg-white font-semibold';

function YesNo({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const b = (on: boolean, text: string) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(on)}
      className={`h-8 px-4 rounded-lg text-xs font-black cursor-pointer disabled:cursor-default ${value === on ? 'bg-[#3525cd] text-white' : 'text-slate-600'}`}
    >
      {text}
    </button>
  );
  return (
    <div className="flex bg-slate-100 rounded-xl p-1 shrink-0">
      {b(true, 'Sim')}
      {b(false, 'Não')}
    </div>
  );
}

export default function OsFieldExtras({ editable, team, overtime, overnightNights, onChange, extra, company, plannedOvernight }: Props) {
  const [rules, setRules] = useState<OvertimeRules[]>([]);
  const [tracks, setTracks] = useState<boolean | null>(null);
  useEffect(() => {
    dbGetCompanies().then((list) => setTracks(companyTracksCost(list, company))).catch(() => setTracks(false));
  }, [company]);
  useEffect(() => {
    if (overtime?.length) dbGetOvertimeRules().then((r) => setRules(rulesOfCompany(r, company))).catch(() => setRules([]));
  }, [!!overtime?.length, company]);

  const days = overtime || [];
  const setDay = (i: number, patch: Partial<WorkOrderOvertimeDay>) => onChange({ overtime: days.map((d, j) => (j === i ? { ...d, ...patch } : d)) });
  const totalMin = days.reduce((s, d) => s + (d.minutes || 0), 0);
  const warnings = overtimeWarnings(days, team, rules);
  const card = 'p-4 rounded-2xl border border-slate-200 bg-white space-y-3';
  // Empresa que não contabiliza (ou ainda carregando): sem hora extra e pernoite
  if (!tracks) return null;

  return (
    <div className="space-y-3">
      {/* HORA EXTRA */}
      <div className={card}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Timer className="w-4 h-4 text-rose-500 mt-0.5" />
            <div>
              <p className="text-xs font-black text-slate-800">{extra ? 'Teve hora extra a mais?' : 'Houve hora extra?'}</p>
              <p className="text-[10px] text-slate-500">{extra ? 'Soma às horas já lançadas (mesmo dia = soma as horas).' : 'Vale para todos os colaboradores lançados nesta OS.'}</p>
            </div>
          </div>
          <YesNo value={overtime !== null} disabled={!editable} onChange={(v) => onChange({ overtime: v ? (days.length ? days : [{ date: today(), minutes: 0, holiday: false }]) : null })} />
        </div>
        {overtime !== null && (
          <div className="space-y-2">
            {days.map((d, i) => {
              const key = d.date ? overtimeDayKey(d.date, d.holiday) : null;
              const dayLabel = key ? OVERTIME_DAYS.find((x) => x.key === key)?.label : '';
              const h = Math.floor((d.minutes || 0) / 60);
              const m = (d.minutes || 0) % 60;
              return (
                <div key={i} className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-black text-slate-700">
                      Dia {i + 1}
                      {dayLabel && <span className="ml-2 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px]">{dayLabel}</span>}
                    </span>
                    {editable && (
                      <button type="button" onClick={() => onChange({ overtime: days.filter((_, j) => j !== i) })} className="text-rose-500 cursor-pointer" title="Tirar o dia">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="block">
                      <span className={label}>Data</span>
                      <input type="date" className={`${field} block`} value={d.date} disabled={!editable} onChange={(e) => setDay(i, { date: e.target.value })} aria-label={`Data do dia ${i + 1}`} />
                    </label>
                    <label className="block">
                      <span className={label}>Horas</span>
                      <div className="flex items-center gap-1">
                        <input
                          inputMode="numeric"
                          className={`${field} w-14 text-center`}
                          value={h || ''}
                          placeholder="0"
                          disabled={!editable}
                          onChange={(e) => setDay(i, { minutes: Math.min(24, Number(e.target.value.replace(/\D/g, '')) || 0) * 60 + m })}
                          aria-label={`Horas do dia ${i + 1}`}
                        />
                        <span className="text-xs font-bold text-slate-400">h</span>
                        <select className={`${field} w-20`} value={m} disabled={!editable} onChange={(e) => setDay(i, { minutes: h * 60 + Number(e.target.value) })} aria-label={`Minutos do dia ${i + 1}`}>
                          {[0, 15, 30, 45].map((x) => (
                            <option key={x} value={x}>{String(x).padStart(2, '0')} min</option>
                          ))}
                        </select>
                      </div>
                    </label>
                    <label className="h-9 px-3 flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-black text-slate-700">
                      <input type="checkbox" checked={d.holiday} disabled={!editable} onChange={(e) => setDay(i, { holiday: e.target.checked })} />
                      Feriado
                    </label>
                  </div>
                </div>
              );
            })}
            {editable && (
              <button
                type="button"
                onClick={() => onChange({ overtime: [...days, { date: today(), minutes: 0, holiday: false }] })}
                className="h-9 px-3 rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-700 text-[11px] font-black flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Adicionar outro dia
              </button>
            )}
            <p className="text-[11px] font-bold text-slate-600">
              Total: {fmtH(totalMin)} em {days.length} dia(s) · {team.length} colaborador(es)
            </p>
            {warnings.map((w, i) => (
              <p key={i} className="text-[11px] font-bold text-amber-700 flex gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {w}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* PERNOITE (Fase 7E-2): o técnico não lança mais — vem do bloco da Programação, informado pelo planejador.
          Resposta à contestação: sem pernoite a mais. Chamado antigo com pernoite já lançado pelo técnico: só mostra. */}
      {!extra && (
        <div className={`${card} bg-slate-50`}>
          <div className="flex items-start gap-2">
            <Hotel className="w-4 h-4 text-rose-500 mt-0.5" />
            <div>
              <p className="text-xs font-black text-slate-800">Pernoite</p>
              {plannedOvernight ? (
                <>
                  <p className="text-sm font-black text-slate-900">{plannedOvernight.text}</p>
                  <p className="text-[10px] text-slate-500">Informado pelo planejador (bloco da Programação). Você não lança pernoite nesta OS.</p>
                </>
              ) : overnightNights ? (
                <>
                  <p className="text-sm font-black text-slate-900">{overnightNights} diária(s)</p>
                  <p className="text-[10px] text-slate-500">Lançado nesta OS antes da mudança. Agora o pernoite é informado pelo planejador.</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-black text-slate-900">Sem pernoite</p>
                  <p className="text-[10px] text-slate-500">O pernoite é informado pelo planejador ao programar o dia. Se a equipe precisar dormir fora, avise o planejador.</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
