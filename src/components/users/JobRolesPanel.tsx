import React, { useState } from 'react';
import { JobRole } from '../../types';
import { cargoKey, dbSetJobRoleRate, dbSyncJobRoles, localTodayStr } from '../../db/firebase';

// CARGOS: valor da hora de cada cargo (vale para todos do cargo), com histórico. Só o Super Administrador.

interface Props {
  roles: JobRole[];
  cargoNames: string[];               // cargos que existem hoje no efetivo e nos usuários
  activeCountByCargo: Map<string, number>; // pessoas ativas por cargo (chave = cargoKey)
  currentUserName: string;
  darkMode: boolean;
  onChanged: () => void;
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dateBR = (d: string) => (d ? d.split('-').reverse().join('/') : '—');

export default function JobRolesPanel({ roles, cargoNames, activeCountByCargo, currentUserName, darkMode, onChanged }: Props) {
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<JobRole | null>(null);
  const [value, setValue] = useState('');
  const [from, setFrom] = useState(localTodayStr());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [historyOf, setHistoryOf] = useState<string | null>(null);

  // Só os cargos que alguém tem hoje (os arquivados ficam guardados, fora da lista)
  const visibleRoles = roles.filter((r) => !r.archived);
  const withoutRate = visibleRoles.filter((r) => !r.rateFrom).length;
  const card = darkMode ? 'bg-[#0a1122]/40 border-slate-800' : 'bg-white border-slate-200';
  const strong = darkMode ? 'text-slate-200' : 'text-slate-800';

  const sync = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await dbSyncJobRoles(cargoNames);
      const parts = [
        res.created.length > 0 ? `Novos (com R$ 0,00): ${res.created.join(', ')}` : '',
        res.archived.length > 0 ? `Removidos da lista (ninguém tem mais): ${res.archived.join(', ')}` : '',
        res.restored.length > 0 ? `Voltaram (com o valor que tinham): ${res.restored.join(', ')}` : ''
      ].filter(Boolean);
      setMessage(parts.length > 0 ? `${parts.join('. ')}.` : 'A lista já está igual aos cargos do sistema.');
      onChanged();
    } catch (err: any) {
      setMessage(`Não foi possível atualizar: ${err?.message || err}`);
    } finally {
      setSyncing(false);
    }
  };

  const openEdit = (role: JobRole) => {
    setEditing(role);
    setValue(role.hourlyRate ? String(role.hourlyRate).replace('.', ',') : '');
    setFrom(localTodayStr());
    setError(null);
  };

  const save = async () => {
    if (!editing) return;
    // Aceita "32,69", "1.032,69" e "32.69"
    const raw = value.trim();
    const parsed = Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw);
    if (!value.trim() || !Number.isFinite(parsed) || parsed <= 0) {
      setError('Informe um valor maior que zero (ex.: 32,69).');
      return;
    }
    if (!from) {
      setError('Informe a data de início da vigência.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await dbSetJobRoleRate(editing, Math.round(parsed * 100) / 100, from, currentUserName);
      setEditing(null);
      onChanged();
    } catch (err: any) {
      setError(`Não foi possível salvar: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className={`border rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 ${card}`}>
        <div className="text-xs">
          <p className={`font-bold ${strong}`}>Cargos e valor da hora</p>
          <p className="text-slate-500">
            O valor vale para todas as pessoas do cargo. Ao mudar, informe a partir de quando vale; o valor anterior fica no histórico.
          </p>
        </div>
        <button
          type="button"
          onClick={sync}
          disabled={syncing}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold cursor-pointer shrink-0 disabled:opacity-50"
        >
          {syncing ? 'Atualizando...' : 'Atualizar cargos'}
        </button>
      </div>

      {message && <p className="text-xs font-bold text-blue-600">{message}</p>}
      {withoutRate > 0 && (
        <p className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold">
          {withoutRate} cargo(s) ainda com R$ 0,00. Informe o valor da hora de cada um.
        </p>
      )}
      {visibleRoles.length === 0 && (
        <p className="text-xs text-slate-500">Nenhum cargo cadastrado. Clique em "Atualizar cargos" para gerar os cargos que existem no sistema.</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {visibleRoles.map((r) => (
          <div key={r.id} className={`border rounded-xl p-4 space-y-2 ${card} ${!r.rateFrom ? 'border-amber-300' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <p className={`text-sm font-black ${strong}`}>{r.name}</p>
              <span className="text-[10px] font-bold text-slate-500">{activeCountByCargo.get(cargoKey(r.name)) || 0} ativo(s)</span>
            </div>
            <p className={`text-lg font-black ${r.rateFrom ? 'text-emerald-600' : 'text-amber-600'}`}>
              {brl(r.hourlyRate)} <span className="text-[11px] font-bold text-slate-500">/ hora</span>
            </p>
            <p className="text-[11px] text-slate-500">Vigência: {r.rateFrom ? `desde ${dateBR(r.rateFrom)}` : 'não informado'}</p>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => openEdit(r)}
                className="flex-1 px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 text-[11px] font-bold cursor-pointer"
              >
                {r.rateFrom ? 'Alterar valor' : 'Informar valor'}
              </button>
              {(r.history || []).length > 0 && (
                <button
                  type="button"
                  onClick={() => setHistoryOf(historyOf === r.id ? null : r.id)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-[11px] font-bold cursor-pointer"
                >
                  Histórico
                </button>
              )}
            </div>
            {historyOf === r.id && (
              <ul className="text-[11px] text-slate-500 space-y-0.5 pt-1 border-t border-slate-100">
                {[...(r.history || [])].reverse().map((h, i) => (
                  <li key={i}>
                    {brl(h.value)} desde {dateBR(h.from)} — por {h.setBy}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className={`w-full max-w-sm rounded-2xl border shadow-2xl p-6 space-y-4 ${darkMode ? 'bg-[#0b1220] border-slate-800' : 'bg-white border-slate-200'}`}>
            <h3 className={`text-base font-black ${strong}`}>Valor da hora — {editing.name}</h3>
            <label className="block">
              <span className="block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500">Valor da hora (R$)</span>
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Ex.: 32,69"
                inputMode="decimal"
                className="w-full text-xs px-3 py-2 border rounded-lg outline-none border-slate-200"
              />
            </label>
            <label className="block">
              <span className="block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500">Vale a partir de</span>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full text-xs px-3 py-2 border rounded-lg outline-none border-slate-200" />
            </label>
            {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                disabled={saving}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-xs font-bold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={save}
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
