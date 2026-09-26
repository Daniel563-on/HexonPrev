import React, { useEffect, useMemo, useState } from 'react';
import { HexonUser, LaborRate, SUNDAY_HOLIDAY_PCT } from '../../types';
import { dbGetLaborRates, dbSaveLaborRate } from '../../db/firebase';

// CUSTO HOMEM-HORA (somente Super Administrador)
// Valor da hora de cada Profissional (operador de campo) + adicional de sábado.
// Domingo/feriado é sempre +100%. Cada alteração fica no histórico com "válido a partir de".

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const formatDate = (iso: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '-');
const SATURDAY_OPTIONS = [0, 50, 70, 100];

interface Props {
  users: HexonUser[];
  currentUserProfile: HexonUser;
  darkMode: boolean;
}

export default function LaborRatesTab({ users, currentUserProfile, darkMode }: Props) {
  const [rates, setRates] = useState<Record<string, LaborRate>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<HexonUser | null>(null);
  const [form, setForm] = useState({ hourlyRate: '', saturdayPct: 50, validFrom: todayStr() });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setRates(await dbGetLaborRates());
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  // Só profissionais de campo
  const professionals = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users
      .filter((u) => u.perfil === 'Profissional')
      .filter((u) => !q || [u.name, u.matricula, u.gerencia, u.cargo].some((v) => (v || '').toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [users, search]);

  const withoutRate = professionals.filter((u) => !rates[u.id]).length;

  const openEdit = (u: HexonUser) => {
    const r = rates[u.id];
    setEditing(u);
    setError(null);
    setForm({
      hourlyRate: r ? String(r.hourlyRate).replace('.', ',') : '',
      saturdayPct: r ? r.saturdayPct : 50,
      validFrom: todayStr()
    });
  };

  // Aceita "32,69", "1.234,56" ou "32.69"
  const rawRate = String(form.hourlyRate).trim();
  const parsedRate = Number(rawRate.includes(',') ? rawRate.replace(/\./g, '').replace(',', '.') : rawRate) || 0;

  const handleSave = async () => {
    if (!editing) return;
    if (!parsedRate || parsedRate <= 0) {
      setError('Informe o valor da hora (ex.: 32,69).');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await dbSaveLaborRate(
        editing.id,
        Math.round(parsedRate * 100) / 100,
        form.saturdayPct,
        form.validFrom,
        currentUserProfile.name
      );
      setEditing(null);
      await load();
    } catch (err: any) {
      setError(`Não foi possível salvar: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  const card = darkMode ? 'bg-[#0a1122]/40 border-slate-800' : 'bg-white border-slate-200';
  const muted = darkMode ? 'text-slate-400' : 'text-slate-500';
  const strong = darkMode ? 'text-white' : 'text-slate-900';
  const input = `w-full px-3 py-2.5 rounded-lg border text-sm font-bold outline-none ${
    darkMode ? 'bg-[#0b1220] border-slate-700 text-white focus:border-blue-500' : 'bg-white border-slate-300 text-slate-900 focus:border-blue-500'
  }`;

  return (
    <div className="space-y-4">
      {/* Explicação + busca */}
      <div className={`border rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 ${card}`}>
        <div className="text-xs">
          <p className={`font-bold ${strong}`}>Custo homem-hora dos profissionais de campo</p>
          <p className={muted}>
            Valor da hora em dia útil e adicional de sábado de cada colaborador. Domingo e feriado: sempre +{SUNDAY_HOLIDAY_PCT}%.
            {withoutRate > 0 && <strong className="text-amber-600"> {withoutRate} sem valor definido.</strong>}
          </p>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome, matrícula ou gerência..."
          className={`md:w-72 px-3 py-2 rounded-lg border text-xs font-medium outline-none ${
            darkMode ? 'bg-[#0b1220] border-slate-800 text-slate-200' : 'bg-white border-slate-200 text-slate-800'
          }`}
        />
      </div>

      {/* Tabela */}
      <div className={`border rounded-xl overflow-hidden ${card}`}>
        {loading ? (
          <p className={`py-10 text-center text-xs font-bold ${muted}`}>Carregando valores...</p>
        ) : professionals.length === 0 ? (
          <p className={`py-10 text-center text-xs italic ${muted}`}>Nenhum profissional de campo encontrado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className={`text-[10px] uppercase tracking-wider ${darkMode ? 'bg-slate-900/60 text-slate-400' : 'bg-slate-50 text-slate-500'}`}>
                  <th className="py-3 px-4">Colaborador</th>
                  <th className="py-3 px-4">Dia útil</th>
                  <th className="py-3 px-4">Sábado</th>
                  <th className="py-3 px-4">Dom / Feriado</th>
                  <th className="py-3 px-4">Válido desde</th>
                  <th className="py-3 px-4 text-right"></th>
                </tr>
              </thead>
              <tbody className={darkMode ? 'divide-y divide-slate-800' : 'divide-y divide-slate-100'}>
                {professionals.map((u) => {
                  const r = rates[u.id];
                  return (
                    <tr key={u.id} className={u.status === 'Inativo' ? 'opacity-50' : ''}>
                      <td className="py-3 px-4">
                        <span className={`font-bold block ${strong}`}>{u.name}</span>
                        <span className={`text-[10px] ${muted}`}>
                          Mat. {u.matricula} · {u.gerencia}
                          {u.status === 'Inativo' ? ' · Inativo' : ''}
                        </span>
                      </td>
                      {r ? (
                        <>
                          <td className={`py-3 px-4 font-black ${strong}`}>{brl(r.hourlyRate)}/h</td>
                          <td className="py-3 px-4">
                            <span className="font-bold text-amber-700">{brl(r.hourlyRate * (1 + r.saturdayPct / 100))}/h</span>
                            <span className={`block text-[10px] ${muted}`}>+{r.saturdayPct}%</span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-bold text-rose-700">{brl(r.hourlyRate * (1 + SUNDAY_HOLIDAY_PCT / 100))}/h</span>
                            <span className={`block text-[10px] ${muted}`}>+{SUNDAY_HOLIDAY_PCT}%</span>
                          </td>
                          <td className={`py-3 px-4 ${muted}`}>{formatDate(r.validFrom)}</td>
                        </>
                      ) : (
                        <td colSpan={4} className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800">Valor não definido</span>
                        </td>
                      )}
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => openEdit(u)}
                          className="px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 text-[11px] font-bold cursor-pointer"
                        >
                          {r ? 'Editar' : 'Definir valor'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de edição */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className={`w-full max-w-md rounded-2xl border shadow-2xl p-6 space-y-4 ${darkMode ? 'bg-[#0b1220] border-slate-800' : 'bg-white border-slate-200'}`}>
            <div>
              <p className={`text-[10px] font-black uppercase tracking-wider ${muted}`}>Custo homem-hora</p>
              <h3 className={`text-base font-black ${strong}`}>{editing.name}</h3>
              <p className={`text-[11px] ${muted}`}>Mat. {editing.matricula} · {editing.gerencia}</p>
            </div>

            <label className="block">
              <span className={`block text-[10px] font-black uppercase tracking-wider mb-1 ${muted}`}>Valor da hora (dia útil)</span>
              <div className="relative">
                <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold ${muted}`}>R$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.hourlyRate}
                  onChange={(e) => setForm({ ...form, hourlyRate: e.target.value })}
                  placeholder="0,00"
                  className={`${input} pl-10`}
                />
              </div>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={`block text-[10px] font-black uppercase tracking-wider mb-1 ${muted}`}>Adicional de sábado</span>
                <select
                  value={form.saturdayPct}
                  onChange={(e) => setForm({ ...form, saturdayPct: Number(e.target.value) })}
                  className={input}
                >
                  {SATURDAY_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      {p === 0 ? 'Sem adicional (0%)' : `+${p}%`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={`block text-[10px] font-black uppercase tracking-wider mb-1 ${muted}`}>Válido a partir de</span>
                <input
                  type="date"
                  value={form.validFrom}
                  onChange={(e) => setForm({ ...form, validFrom: e.target.value })}
                  className={input}
                />
              </label>
            </div>

            {/* Resumo calculado */}
            <div className={`grid grid-cols-3 gap-2 text-center rounded-xl p-3 ${darkMode ? 'bg-slate-900' : 'bg-slate-50'}`}>
              <div>
                <p className={`text-[10px] font-bold uppercase ${muted}`}>Dia útil</p>
                <p className={`text-sm font-black ${strong}`}>{parsedRate > 0 ? brl(parsedRate) : '-'}</p>
              </div>
              <div>
                <p className={`text-[10px] font-bold uppercase ${muted}`}>Sábado +{form.saturdayPct}%</p>
                <p className="text-sm font-black text-amber-700">{parsedRate > 0 ? brl(parsedRate * (1 + form.saturdayPct / 100)) : '-'}</p>
              </div>
              <div>
                <p className={`text-[10px] font-bold uppercase ${muted}`}>Dom/Fer +{SUNDAY_HOLIDAY_PCT}%</p>
                <p className="text-sm font-black text-rose-700">{parsedRate > 0 ? brl(parsedRate * (1 + SUNDAY_HOLIDAY_PCT / 100)) : '-'}</p>
              </div>
            </div>

            {/* Histórico */}
            {(rates[editing.id]?.history || []).length > 0 && (
              <div>
                <p className={`text-[10px] font-black uppercase tracking-wider mb-1 ${muted}`}>Histórico de valores</p>
                <div className={`max-h-32 overflow-y-auto rounded-lg border text-[11px] ${darkMode ? 'border-slate-800' : 'border-slate-200'}`}>
                  {[...(rates[editing.id]?.history || [])]
                    .sort((a, b) => b.changedAt.localeCompare(a.changedAt))
                    .map((h, i) => (
                      <div key={i} className={`px-3 py-1.5 flex justify-between gap-2 ${i ? (darkMode ? 'border-t border-slate-800' : 'border-t border-slate-100') : ''}`}>
                        <span className={strong}>
                          {brl(h.hourlyRate)}/h · sáb. +{h.saturdayPct}%
                        </span>
                        <span className={muted}>
                          desde {formatDate(h.validFrom)} · {h.changedBy}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {error && <p className="text-xs font-bold text-rose-600">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setEditing(null)}
                disabled={saving}
                className={`px-4 py-2 rounded-lg border text-xs font-bold cursor-pointer ${darkMode ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600'}`}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
