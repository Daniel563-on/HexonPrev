import React, { useEffect, useState } from 'react';
import { Warehouse as WarehouseIcon } from 'lucide-react';
import { Warehouse } from '../../types';
import { dbGetWarehouses, dbSaveWarehouses, warehouseIdOf } from '../../db/warehouses';

// ALMOXARIFADOS (só Super Administrador, Fase 8B): lista única para todas as gerências, usada na aprovação dos
// pedidos de material (de onde o técnico retira). Renomear não muda os pedidos já aprovados (eles guardam o nome).
// Desativado some da lista de escolha.
export default function WarehousesTab({ darkMode, userName }: { darkMode: boolean; userName: string }) {
  const [list, setList] = useState<Warehouse[]>([]);
  const [saved, setSaved] = useState<Warehouse[]>([]);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    dbGetWarehouses(true).then((l) => {
      setList(l);
      setSaved(l);
    });
  }, []);

  const box = darkMode ? 'bg-[#0a1122]/40 border-slate-800' : 'bg-white border-slate-200';
  const strong = darkMode ? 'text-slate-200' : 'text-slate-800';
  const input = `px-3 py-2 rounded-lg border text-xs font-semibold ${darkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300 text-slate-800'}`;
  const btn = 'px-4 py-2 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-50';
  const changed = JSON.stringify(list) !== JSON.stringify(saved);

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    if (list.some((w) => w.name.trim().toLowerCase() === name.toLowerCase())) {
      setMsg({ ok: false, text: 'Já existe um almoxarifado com esse nome.' });
      return;
    }
    let id = warehouseIdOf(name);
    while (list.some((w) => w.id === id)) id = `${id}-2`;
    setList([...list, { id, name, active: true }]);
    setNewName('');
    setMsg(null);
  };

  const save = async () => {
    if (list.some((w) => !w.name.trim())) {
      setMsg({ ok: false, text: 'Todo almoxarifado precisa de nome.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await dbSaveWarehouses(list, userName);
      setSaved(list);
      setMsg({ ok: true, text: 'Almoxarifados salvos.' });
    } catch (err: any) {
      setMsg({ ok: false, text: `Não foi possível salvar: ${err?.message || err}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className={`p-5 rounded-xl border space-y-4 ${box}`}>
        <div>
          <h3 className={`text-sm font-black uppercase tracking-wider flex items-center gap-2 ${strong}`}>
            <WarehouseIcon className="w-4 h-4 text-blue-500" /> Almoxarifados
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Lista usada na aprovação dos pedidos de material (de onde o técnico retira). Vale para todas as gerências. Renomear não muda os
            pedidos já aprovados; desativado some da lista de escolha.
          </p>
        </div>

        <div className="space-y-2">
          {list.map((w, i) => (
            <div key={w.id} className="flex flex-wrap items-center gap-2">
              <input
                value={w.name}
                onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                className={`${input} flex-1 min-w-[200px] ${w.active ? '' : 'opacity-55'}`}
                aria-label="Nome do almoxarifado"
              />
              <label className="flex items-center gap-1.5 text-xs font-bold text-slate-500 cursor-pointer">
                <input type="checkbox" checked={w.active} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, active: e.target.checked } : x)))} />
                Ativo
              </label>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="Novo almoxarifado"
            className={`${input} flex-1 min-w-[200px]`}
          />
          <button type="button" onClick={add} disabled={!newName.trim()} className={`${btn} border border-slate-300 text-slate-600`}>
            Incluir
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={save} disabled={busy || !changed} className={`${btn} bg-blue-600 hover:bg-blue-700 text-white`}>
            {busy ? 'Salvando...' : 'Salvar almoxarifados'}
          </button>
          {changed && (
            <button type="button" onClick={() => setList(saved)} disabled={busy} className={`${btn} border border-slate-300 text-slate-600`}>
              Desfazer
            </button>
          )}
        </div>
        {msg && <p className={`text-xs font-bold ${msg.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{msg.text}</p>}
      </div>
    </div>
  );
}
