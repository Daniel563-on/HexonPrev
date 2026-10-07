import React, { useMemo, useState } from 'react';
import { JobRole, OvertimeDayKey, OvertimeDayRule, OvertimeRules } from '../../types';
import {
  OVERTIME_DAYS,
  blankOvertimeDays,
  dbSaveOvertimeRules,
  dbSetJobRoleOvertimeTariffs,
  overtimeHourValue,
  overtimeRuleId,
  overtimePercents,
  localTodayStr
} from '../../db/firebase';

// HORA EXTRA DO CARGO (Cargos e valores): para cada dia da semana, "primeiras X h a Y%, demais a Z%" e o máximo do dia.
// Tarifas próprias em R$ por percentual (opcional; em branco = valor da hora × (1 + %)).
// Etapa especial E5: tudo é da EMPRESA escolhida em "Cargos e valores".

interface Props {
  role: JobRole;       // o cargo com os valores da empresa (roleForCompany)
  baseRole: JobRole;   // o cargo como está no banco (é ele que é gravado)
  company: string;
  companyName: string;
  rules: OvertimeRules | null;
  currentUserName: string;
  darkMode: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const num = (raw: string) => {
  const t = raw.trim();
  if (!t) return NaN;
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
};
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type DayForm = { firstHours: string; firstPct: string; restPct: string; maxHours: string };

const toForm = (r: OvertimeDayRule): DayForm => ({
  firstHours: String(r.firstHours).replace('.', ','),
  firstPct: String(r.firstPct),
  restPct: String(r.restPct),
  maxHours: r.maxHours === null || r.maxHours === undefined ? '' : String(r.maxHours).replace('.', ',')
});

export default function OvertimeRulesModal({ role, baseRole, company, companyName, rules, currentUserName, darkMode, onClose, onSaved }: Props) {
  const start = rules?.days || blankOvertimeDays();
  const [days, setDays] = useState<Record<OvertimeDayKey, DayForm>>(
    () => Object.fromEntries(OVERTIME_DAYS.map((d) => [d.key, toForm(start[d.key])])) as Record<OvertimeDayKey, DayForm>
  );
  const [tariffs, setTariffs] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(role.overtimeTariffs || {}).map(([k, v]) => [k, String(v).replace('.', ',')]))
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const setDay = (key: OvertimeDayKey, patch: Partial<DayForm>) => setDays((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  // Regras como ficariam ao salvar (null = algum campo inválido)
  const parsed = useMemo(() => {
    const out = {} as Record<OvertimeDayKey, OvertimeDayRule>;
    for (const d of OVERTIME_DAYS) {
      const f = days[d.key];
      const firstHours = f.firstHours.trim() ? num(f.firstHours) : 0;
      const firstPct = f.firstPct.trim() ? num(f.firstPct) : 0;
      const restPct = num(f.restPct);
      const maxHours = f.maxHours.trim() ? num(f.maxHours) : null;
      if (![firstHours, firstPct, restPct].every((v) => Number.isFinite(v) && v >= 0) || (maxHours !== null && !(Number.isFinite(maxHours) && maxHours >= 0))) {
        return { error: `${d.label}: confira os números (horas e percentuais não podem ficar negativos; "demais a %" é obrigatório).` };
      }
      if (firstPct > 300 || restPct > 300) return { error: `${d.label}: percentual acima de 300%.` };
      if (firstHours > 24 || (maxHours !== null && maxHours > 24)) return { error: `${d.label}: horas acima de 24.` };
      out[d.key] = { firstHours, firstPct: firstHours > 0 ? firstPct : 0, restPct, maxHours };
    }
    return { days: out };
  }, [days]);

  const percents = parsed.days ? overtimePercents({ id: role.id, roleName: role.name, days: parsed.days, updatedAt: '', updatedBy: '' }) : [];

  const save = async () => {
    if (!parsed.days) return setError(parsed.error || 'Confira os campos.');
    const cleanTariffs: Record<string, number> = {};
    for (const p of percents) {
      const raw = (tariffs[String(p)] || '').trim();
      if (!raw) continue;
      const v = num(raw);
      if (!Number.isFinite(v) || v <= 0) return setError(`Tarifa de +${p}%: informe um valor maior que zero ou deixe em branco.`);
      cleanTariffs[String(p)] = Math.round(v * 100) / 100;
    }
    setSaving(true);
    setError(null);
    try {
      await dbSaveOvertimeRules({ id: overtimeRuleId(company, role.id), company, roleId: role.id, roleName: role.name, days: parsed.days, updatedAt: new Date().toISOString(), updatedBy: currentUserName });
      const before = JSON.stringify(role.overtimeTariffs || {});
      if (before !== JSON.stringify(cleanTariffs)) await dbSetJobRoleOvertimeTariffs(baseRole, cleanTariffs, company);
      onSaved();
    } catch (err: any) {
      setError(`Não foi possível salvar: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  const strong = darkMode ? 'text-slate-200' : 'text-slate-800';
  const input = 'w-full h-8 px-2 text-xs border rounded-lg outline-none border-slate-200 bg-white text-slate-800 text-center';
  const th = 'px-2 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500 text-left';
  const today = localTodayStr();

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className={`w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl border shadow-2xl p-6 space-y-4 ${darkMode ? 'bg-[#0b1220] border-slate-800' : 'bg-white border-slate-200'}`}>
        <div>
          <h3 className={`text-base font-black ${strong}`}>Hora extra — {role.name} · {companyName}</h3>
          <p className="text-xs text-slate-500 mt-1">
            Para cada dia: as primeiras horas recebem um adicional e as demais outro. Acima do máximo do dia, o técnico vê um aviso e o excesso não é pago.
            Feriado marcado pelo técnico conta como domingo.
          </p>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[560px]">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>Dia</th>
                <th className={th}>Primeiras (h)</th>
                <th className={th}>a (%)</th>
                <th className={th}>Demais a (%)</th>
                <th className={th}>Máximo no dia (h)</th>
              </tr>
            </thead>
            <tbody>
              {OVERTIME_DAYS.map((d) => {
                const f = days[d.key];
                const noFirst = !f.firstHours.trim() || num(f.firstHours) === 0;
                return (
                  <tr key={d.key} className="border-t border-slate-100">
                    <td className={`px-2 py-1.5 text-xs font-bold ${strong} whitespace-nowrap`}>{d.label}</td>
                    <td className="px-2 py-1.5 w-24"><input className={input} inputMode="decimal" value={f.firstHours} onChange={(e) => setDay(d.key, { firstHours: e.target.value })} aria-label={`${d.label} primeiras horas`} /></td>
                    <td className="px-2 py-1.5 w-24"><input className={input} inputMode="decimal" value={noFirst ? '' : f.firstPct} disabled={noFirst} placeholder="—" onChange={(e) => setDay(d.key, { firstPct: e.target.value })} aria-label={`${d.label} percentual das primeiras horas`} /></td>
                    <td className="px-2 py-1.5 w-24"><input className={input} inputMode="decimal" value={f.restPct} onChange={(e) => setDay(d.key, { restPct: e.target.value })} aria-label={`${d.label} percentual das demais horas`} /></td>
                    <td className="px-2 py-1.5 w-28"><input className={input} inputMode="decimal" value={f.maxHours} placeholder="sem máximo" onChange={(e) => setDay(d.key, { maxHours: e.target.value })} aria-label={`${d.label} máximo de horas`} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-500">Exemplo: "Primeiras 1 h a 50%, demais a 100%, máximo 2 h". Para o dia inteiro num só percentual, deixe "Primeiras" em 0.</p>

        <div className="p-4 rounded-xl border border-indigo-100 bg-indigo-50/40 space-y-2">
          <p className="text-[11px] font-black uppercase tracking-wider text-indigo-700">Tarifas próprias (opcional)</p>
          <p className="text-[11px] text-slate-500">Valor em R$ por hora para cada percentual usado acima. Em branco = valor da hora × (1 + %).</p>
          {percents.length === 0 ? (
            <p className="text-[11px] text-slate-500">Nenhum percentual nas regras.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {percents.map((p) => {
                const auto = overtimeHourValue({ ...role, overtimeTariffs: {} }, p, today);
                return (
                  <label key={p} className="block">
                    <span className="block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500">H.E. +{p}% (R$)</span>
                    <input
                      className="w-full h-9 px-3 text-xs border rounded-lg outline-none border-slate-200 bg-white text-slate-800"
                      inputMode="decimal"
                      value={tariffs[String(p)] || ''}
                      placeholder={auto ? brl(auto).replace('R$', '').trim() : 'sem valor da hora'}
                      onChange={(e) => setTariffs((prev) => ({ ...prev, [String(p)]: e.target.value }))}
                    />
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {rules && <p className="text-[10px] text-slate-400">Última alteração por {rules.updatedBy} em {new Date(rules.updatedAt).toLocaleString('pt-BR')}.</p>}
        {!rules && <p className="text-[11px] font-bold text-amber-700">Este cargo ainda não tem regras salvas: confira os valores sugeridos e salve.</p>}
        {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-xs font-bold cursor-pointer">
            Cancelar
          </button>
          <button type="button" onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50">
            {saving ? 'Salvando...' : 'Salvar regras'}
          </button>
        </div>
      </div>
    </div>
  );
}
