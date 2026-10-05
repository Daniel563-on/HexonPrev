import React, { useEffect, useState } from 'react';
import { AlertTriangle, Hotel, Plus, Timer, Trash2 } from 'lucide-react';
import { OrderParticipant, OvertimeRules, WorkOrderOvertimeDay } from '../../types';
import { OVERTIME_DAYS, dbGetOvertimeRules, overtimeDayKey, overtimeWarnings } from '../../db/firebase';

// ADICIONAIS DE CAMPO (técnico): hora extra por dia e pernoite. Dia de hora extra marcado como feriado
// também zera o homem-hora daquele dia. Valem para todos os colaboradores lançados na OS. O técnico não vê valores (R$).

interface Props {
  editable: boolean;
  team: OrderParticipant[];
  overtime: WorkOrderOvertimeDay[] | null;
  overnightNights: number | null;
  onChange: (next: { overtime?: WorkOrderOvertimeDay[] | null; overnightNights?: number | null }) => void;
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

export default function OsFieldExtras({ editable, team, overtime, overnightNights, onChange }: Props) {
  const [rules, setRules] = useState<OvertimeRules[]>([]);
  useEffect(() => {
    if (overtime?.length) dbGetOvertimeRules().then(setRules).catch(() => setRules([]));
  }, [!!overtime?.length]);

  const days = overtime || [];
  const setDay = (i: number, patch: Partial<WorkOrderOvertimeDay>) => onChange({ overtime: days.map((d, j) => (j === i ? { ...d, ...patch } : d)) });
  const totalMin = days.reduce((s, d) => s + (d.minutes || 0), 0);
  const warnings = overtimeWarnings(days, team, rules);
  const card = 'p-4 rounded-2xl border border-slate-200 bg-white space-y-3';

  return (
    <div className="space-y-3">
      {/* HORA EXTRA */}
      <div className={card}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Timer className="w-4 h-4 text-rose-500 mt-0.5" />
            <div>
              <p className="text-xs font-black text-slate-800">Houve hora extra?</p>
              <p className="text-[10px] text-slate-500">Vale para todos os colaboradores lançados nesta OS.</p>
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

      {/* PERNOITE */}
      <div className={card}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Hotel className="w-4 h-4 text-rose-500 mt-0.5" />
            <div>
              <p className="text-xs font-black text-slate-800">Houve pernoite (diária de hotel)?</p>
              <p className="text-[10px] text-slate-500">Diárias × valor do pernoite × colaboradores da OS.</p>
            </div>
          </div>
          <YesNo value={overnightNights !== null} disabled={!editable} onChange={(v) => onChange({ overnightNights: v ? overnightNights || 1 : null })} />
        </div>
        {overnightNights !== null && (
          <label className="block">
            <span className={label}>Quantidade de diárias</span>
            <input
              inputMode="numeric"
              className={`${field} block w-28`}
              value={overnightNights || ''}
              disabled={!editable}
              onChange={(e) => onChange({ overnightNights: Math.min(60, Number(e.target.value.replace(/\D/g, '')) || 0) })}
              aria-label="Quantidade de diárias"
            />
          </label>
        )}
      </div>
    </div>
  );
}
