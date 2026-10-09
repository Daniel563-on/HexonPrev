import React, { useEffect, useState } from 'react';
import { Building2, Pencil, Plus, X } from 'lucide-react';
import { Company, Management } from '../../types';
import { companyIdOf, dbGetCompanies, dbGetManagements, dbSaveCompany } from '../../db/firebase';

// CONFIGURAÇÕES › EMPRESAS (etapa especial E1, só o Super Administrador): empresas contratadas, as gerências em que
// atuam e se contabilizam homem-hora, hora extra e pernoite. Não se exclui: inativa some das listas de escolha.

const blank = (): Company => ({ id: '', name: '', units: [], costTracking: false, active: true, createdAt: '', updatedAt: '', updatedBy: '' });

export default function CompaniesTab({ userName, darkMode }: { userName: string; darkMode: boolean }) {
  const [list, setList] = useState<Company[]>([]);
  const [units, setUnits] = useState<Management[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Company | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [c, m] = await Promise.all([dbGetCompanies(true), dbGetManagements()]);
      setList(c);
      setUnits(m);
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
    if (!name) return setError('Informe o nome da empresa.');
    if (editing.units.length === 0) return setError('Marque pelo menos uma gerência em que a empresa atua.');
    const id = isNew ? companyIdOf(name) : editing.id;
    if (list.some((c) => c.id !== editing.id && (c.id === id || c.name.trim().toLowerCase() === name.toLowerCase()))) return setError('Já existe uma empresa com esse nome.');
    setSaving(true);
    setError(null);
    try {
      await dbSaveCompany({ ...editing, id, name }, userName);
      setEditing(null);
      await load();
    } catch (e: any) {
      setError(e?.code === 'permission-denied' ? 'O banco recusou: só o Super Administrador cadastra empresas.' : `Não foi possível salvar: ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  const card = darkMode ? 'bg-[#0a1122]/40 border-slate-800' : 'bg-white border-slate-200';
  const muted = darkMode ? 'text-slate-400' : 'text-slate-500';
  const strong = darkMode ? 'text-slate-100' : 'text-slate-900';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`text-xs ${muted}`}>
          Empresas contratadas de cada gerência. Cada uma tem seu planejador, seus técnicos, materiais e ativos. Use "MPRJ" para o trabalho da própria gerência.
        </p>
        <button
          type="button"
          onClick={() => {
            setEditing(blank());
            setIsNew(true);
            setError(null);
          }}
          className="h-9 px-4 rounded-lg bg-blue-600 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer"
        >
          <Plus className="w-4 h-4" /> Nova empresa
        </button>
      </div>
      {error && !editing && <p className="text-xs font-bold text-rose-600">{error}</p>}

      <div className={`border rounded-xl overflow-x-auto ${card}`}>
        <table className="w-full text-left text-xs">
          <thead>
            <tr className={`text-[10px] font-black uppercase tracking-wider border-b ${darkMode ? 'border-slate-800 text-slate-400' : 'border-slate-100 text-slate-500 bg-slate-50/70'}`}>
              <th className="py-3 px-4">Empresa</th>
              <th className="py-3 px-4">Gerências</th>
              <th className="py-3 px-4">Contabiliza HH / HE / pernoite</th>
              <th className="py-3 px-4">Pede material do MP</th>
              <th className="py-3 px-4">Pede insumos</th>
              <th className="py-3 px-4">Situação</th>
              <th className="py-3 px-4 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id} className={`border-t ${darkMode ? 'border-slate-800' : 'border-slate-100'} ${c.active ? '' : 'opacity-55'}`}>
                <td className={`py-3 px-4 font-bold ${strong}`}>
                  <span className="flex items-center gap-2"><Building2 className="w-4 h-4 text-blue-500" /> {c.name}</span>
                </td>
                <td className="py-3 px-4">
                  <div className="flex flex-wrap gap-1">
                    {c.units.map((u) => (
                      <span key={u} className="px-2 py-0.5 rounded bg-slate-500/10 text-slate-600 font-bold text-[10px]">{u}</span>
                    ))}
                  </div>
                </td>
                <td className="py-3 px-4">{c.costTracking ? <span className="font-black text-emerald-600">Sim</span> : <span className={muted}>Não</span>}</td>
                <td className="py-3 px-4">{c.requestsMpMaterial ? <span className="font-black text-emerald-600">Sim</span> : <span className={muted}>Não</span>}</td>
                <td className="py-3 px-4">{c.requestsSupplies ? <span className="font-black text-emerald-600">Sim</span> : <span className={muted}>Não</span>}</td>
                <td className="py-3 px-4">{c.active ? <span className="font-bold text-emerald-600">Ativa</span> : <span className="font-bold text-rose-600">Inativa</span>}</td>
                <td className="py-3 px-4 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing({ ...c, units: [...c.units] });
                      setIsNew(false);
                      setError(null);
                    }}
                    className="p-1.5 rounded text-slate-400 hover:text-blue-600 cursor-pointer"
                    title="Editar empresa"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
            {!loading && list.length === 0 && (
              <tr>
                <td colSpan={7} className={`py-8 text-center italic ${muted}`}>Nenhuma empresa cadastrada.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/60 flex items-center justify-center p-4">
          <div className={`w-full max-w-lg rounded-2xl p-5 space-y-4 ${darkMode ? 'bg-[#0b1426] text-slate-100' : 'bg-white'}`}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-black">{isNew ? 'Nova empresa' : `Editar empresa — ${editing.name}`}</p>
              <button type="button" onClick={() => setEditing(null)} className="h-8 w-8 rounded-lg border border-slate-200 flex items-center justify-center cursor-pointer" title="Fechar">
                <X className="w-4 h-4" />
              </button>
            </div>
            <label className="block">
              <span className={`block text-[10px] font-black uppercase tracking-wider mb-1 ${muted}`}>Nome da empresa *</span>
              <input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className={`w-full h-9 px-3 text-xs border rounded-lg ${darkMode ? 'bg-[#121b2d] border-slate-800' : 'bg-white border-slate-200'}`}
                placeholder="Ex.: Almeida França"
                aria-label="Nome da empresa"
              />
            </label>
            <div>
              <span className={`block text-[10px] font-black uppercase tracking-wider mb-1 ${muted}`}>Gerências em que atua *</span>
              <div className="flex flex-wrap gap-3">
                {units.map((m) => (
                  <label key={m.id} className="flex items-center gap-1.5 text-xs font-bold">
                    <input
                      type="checkbox"
                      checked={editing.units.includes(m.name)}
                      onChange={(e) => setEditing({ ...editing, units: e.target.checked ? [...editing.units, m.name] : editing.units.filter((u) => u !== m.name) })}
                    />
                    {m.name}
                  </label>
                ))}
                {units.length === 0 && <span className={`text-xs ${muted}`}>Cadastre as gerências primeiro (Usuários › Gerências).</span>}
              </div>
            </div>
            <label className="flex items-start gap-2 text-xs font-bold cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={editing.costTracking} onChange={(e) => setEditing({ ...editing, costTracking: e.target.checked })} />
              <span>
                Contabiliza homem-hora, hora extra e pernoite
                <span className={`block text-[10px] font-normal ${muted}`}>Marque só nas empresas em que esses valores são cobrados.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs font-bold cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={!!editing.requestsMpMaterial} onChange={(e) => setEditing({ ...editing, requestsMpMaterial: e.target.checked })} />
              <span>
                Técnicos pedem material do MP
                <span className={`block text-[10px] font-normal ${muted}`}>Os técnicos desta empresa passam a ver "Material" na aba Solicitações do celular, para pedir material para as OS deles.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs font-bold cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={!!editing.requestsSupplies} onChange={(e) => setEditing({ ...editing, requestsSupplies: e.target.checked })} />
              <span>
                Técnicos pedem insumos
                <span className={`block text-[10px] font-normal ${muted}`}>Os técnicos desta empresa passam a pedir insumos (Gestão de Insumos) pelo celular, informando o GLPI.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs font-bold cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
              <span>
                Ativa
                <span className={`block text-[10px] font-normal ${muted}`}>Inativa some das listas de escolha; o que já é dela continua guardado.</span>
              </span>
            </label>
            {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="h-9 px-4 rounded-lg border border-slate-200 text-xs font-bold cursor-pointer">Cancelar</button>
              <button type="button" onClick={save} disabled={saving} className="h-9 px-4 rounded-lg bg-blue-600 text-white text-xs font-black cursor-pointer disabled:opacity-50">
                {saving ? 'Salvando...' : 'Salvar empresa'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
