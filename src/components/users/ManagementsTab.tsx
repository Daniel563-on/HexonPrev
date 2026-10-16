import React, { useEffect, useState } from 'react';
import CloseX from '../CloseX';
import { Network, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Management } from '../../types';
import { dbAddAuditLog, dbDeleteManagement, dbGetAssets, dbGetManagements, dbGetProfiles, dbGetUsers, dbSaveManagement } from '../../db/firebase';
import { dbBumpDataVersion } from '../../db/appControl';
import UnitBackfillCard from './UnitBackfillCard';

// CONFIGURAÇÕES › GERÊNCIAS (ajuste A6, 14/10/2026; antes ficava em Usuários › Gerências; só o Super Administrador).
// O nome não muda depois de criada (OS, usuários, ativos e regras do banco guardam o nome); gerência em uso não se exclui.

const blank = (): Management => ({ id: '', name: '', description: '' });

export default function ManagementsTab({ userName, userMatricula, darkMode }: { userName: string; userMatricula: string; darkMode: boolean }) {
  const [list, setList] = useState<Management[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Management | null>(null);
  const [toDelete, setToDelete] = useState<Management | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setList(await dbGetManagements());
    } catch (e: any) {
      setError(`Não foi possível carregar: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) return setError('Informe o nome da gerência.');
    if (!editing.id && list.some((m) => m.name.trim().toLowerCase() === name.toLowerCase())) return setError('Já existe uma gerência com esse nome.');
    setBusy(true);
    setError(null);
    try {
      const item: Management = { id: editing.id || `m_${Date.now()}`, name, description: editing.description.trim() };
      await dbSaveManagement(item);
      await dbAddAuditLog({
        userMatricula,
        userName,
        action: editing.id ? 'Atualizou Gerência' : 'Criou Gerência',
        target: `managements/${item.id}`,
        details: `Registrou gerência ${item.name}`,
        timestamp: new Date().toISOString()
      });
      dbBumpDataVersion();
      setEditing(null);
      setNotice(`Gerência ${item.name} salva.`);
      await load();
    } catch (e: any) {
      setError(e?.code === 'permission-denied' ? 'O banco recusou a gravação da gerência.' : `Não foi possível salvar: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  // Gerência em uso não pode ser excluída (OS, usuários, ativos e regras do banco guardam o nome)
  const askDelete = async (m: Management) => {
    setNotice(null);
    setError(null);
    if (m.name === 'Todas') return setError('A gerência de atuação global "Todas" não pode ser excluída.');
    setBusy(true);
    try {
      const [users, assets, profiles] = await Promise.all([dbGetUsers(), dbGetAssets().catch(() => []), dbGetProfiles()]);
      const usersIn = users.filter((u) => u.gerencia === m.name).length;
      const assetsIn = assets.filter((a) => a.sector === m.name).length;
      const profilesIn = profiles.filter((p) => (p.units || []).includes(m.name)).length;
      if (usersIn + assetsIn + profilesIn > 0)
        return setError(`A gerência "${m.name}" está em uso (${usersIn} usuário(s), ${assetsIn} ativo(s), ${profilesIn} perfil(is)) e não pode ser excluída.`);
      setToDelete(m);
    } catch (e: any) {
      setError(`Não foi possível conferir o uso da gerência: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setBusy(true);
    try {
      await dbDeleteManagement(toDelete.id);
      dbBumpDataVersion();
      setNotice(`Gerência ${toDelete.name} excluída.`);
      setToDelete(null);
      await load();
    } catch (e: any) {
      setToDelete(null);
      setError(`Não foi possível excluir a gerência: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const card = darkMode ? 'bg-[#0a1122]/40 border-slate-800' : 'bg-white border-slate-200';
  const muted = darkMode ? 'text-slate-400' : 'text-slate-500';
  const strong = darkMode ? 'text-slate-100' : 'text-slate-900';
  const modal = darkMode ? 'bg-[#0b1426] text-slate-100' : 'bg-white';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`text-xs ${muted}`}>Gerências técnicas e oficinas. As empresas, os usuários, os ativos e as OS são de uma gerência. O nome não muda depois de criada.</p>
        <button
          type="button"
          onClick={() => {
            setEditing(blank());
            setError(null);
            setNotice(null);
          }}
          className="h-9 px-4 rounded-lg bg-blue-600 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer"
        >
          <Plus className="w-4 h-4" /> Nova gerência
        </button>
      </div>
      {error && !editing && <p className="text-xs font-bold text-rose-600">{error}</p>}
      {notice && <p className="text-xs font-bold text-emerald-600">{notice}</p>}

      <div className={`border rounded-xl overflow-x-auto ${card}`}>
        <table className="w-full text-left text-xs">
          <thead>
            <tr className={`text-[10px] font-black uppercase tracking-wider border-b ${darkMode ? 'border-slate-800 text-slate-400' : 'border-slate-100 text-slate-500 bg-slate-50/70'}`}>
              <th className="py-3 px-4">Gerência</th>
              <th className="py-3 px-4">Descrição</th>
              <th className="py-3 px-4 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.id} className={`border-t ${darkMode ? 'border-slate-800' : 'border-slate-100'}`}>
                <td className={`py-3 px-4 font-bold ${strong}`}>
                  <span className="flex items-center gap-2">
                    <Network className="w-4 h-4 text-blue-500" /> {m.name}
                  </span>
                </td>
                <td className={`py-3 px-4 ${m.description ? '' : `italic ${muted}`}`}>{m.description || 'Sem descrição'}</td>
                <td className="py-3 px-4 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing({ ...m, description: m.description || '' });
                      setError(null);
                      setNotice(null);
                    }}
                    className="p-1.5 rounded text-slate-400 hover:text-blue-600 cursor-pointer"
                    title="Editar gerência"
                    aria-label={`Editar gerência ${m.name}`}
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => askDelete(m)}
                    disabled={busy}
                    className="p-1.5 rounded text-slate-400 hover:text-rose-600 cursor-pointer disabled:opacity-50"
                    title="Excluir gerência"
                    aria-label={`Excluir gerência ${m.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
            {!loading && list.length === 0 && (
              <tr>
                <td colSpan={3} className={`py-8 text-center italic ${muted}`}>Nenhuma gerência cadastrada.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <UnitBackfillCard darkMode={darkMode} />

      {editing && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/60 flex items-center justify-center p-4">
          <div className={`w-full max-w-md rounded-2xl p-5 space-y-4 ${modal}`}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-black">{editing.id ? `Editar gerência — ${editing.name}` : 'Nova gerência'}</p>
              <button type="button" onClick={() => setEditing(null)} className="h-8 w-8 rounded-lg border border-slate-200 flex items-center justify-center cursor-pointer" title="Fechar">
                <X className="w-4 h-4" />
              </button>
            </div>
            <label className="block">
              <span className={`block text-[10px] font-black uppercase tracking-wider mb-1 ${muted}`}>Nome da gerência *</span>
              <input
                value={editing.name}
                disabled={!!editing.id}
                onChange={(e) => {
                  setEditing({ ...editing, name: e.target.value });
                  setError(null);
                }}
                className={`w-full h-9 px-3 text-xs border rounded-lg disabled:opacity-60 disabled:cursor-not-allowed ${darkMode ? 'bg-[#121b2d] border-slate-800' : 'bg-white border-slate-200'}`}
                placeholder="Ex.: GMMR, GMEE, DOM"
                aria-label="Nome da gerência"
              />
              {editing.id && <span className={`block text-[10px] mt-1 ${muted}`}>O nome não muda depois de criada: OS, usuários, ativos e regras do banco guardam este nome. Só a descrição pode ser editada.</span>}
            </label>
            <label className="block">
              <span className={`block text-[10px] font-black uppercase tracking-wider mb-1 ${muted}`}>Descrição</span>
              <input
                value={editing.description}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                className={`w-full h-9 px-3 text-xs border rounded-lg ${darkMode ? 'bg-[#121b2d] border-slate-800' : 'bg-white border-slate-200'}`}
                placeholder="Ex.: Manutenção de refrigeração"
                aria-label="Descrição da gerência"
              />
            </label>
            {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="h-9 px-4 rounded-lg border border-slate-200 text-xs font-bold cursor-pointer">Cancelar</button>
              <button type="button" onClick={save} disabled={busy} className="h-9 px-4 rounded-lg bg-blue-600 text-white text-xs font-black cursor-pointer disabled:opacity-50">
                {busy ? 'Salvando...' : 'Salvar gerência'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toDelete && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/60 flex items-center justify-center p-4">
          <div className={`relative w-full max-w-sm rounded-2xl p-5 space-y-4 ${modal}`}>
            <CloseX onClick={() => setToDelete(null)} />
            <p className="text-sm font-black pr-10">Excluir a gerência {toDelete.name}?</p>
            <p className={`text-xs ${muted}`}>Nenhum usuário, ativo ou perfil usa esta gerência. A exclusão não pode ser desfeita.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setToDelete(null)} className="h-9 px-4 rounded-lg border border-slate-200 text-xs font-bold cursor-pointer">Cancelar</button>
              <button type="button" onClick={confirmDelete} disabled={busy} className="h-9 px-4 rounded-lg bg-rose-600 text-white text-xs font-black cursor-pointer disabled:opacity-50">
                {busy ? 'Excluindo...' : 'Excluir gerência'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
