import React, { useEffect, useMemo, useState } from 'react';
import { Company, HexonUser, Material } from '../../types';
import {
  companiesOfUnit,
  dbGetCompanies,
  dbGetManagements,
  isCompanyVisible,
  dbDeleteMaterial,
  dbGetMaterials,
  dbSaveMaterial,
  dbSetMaterialCost,
  localTodayStr,
  materialCodeKey,
  materialIdOf
} from '../../db/firebase';
import MaterialImportModal from './MaterialImportModal';

// MATERIAIS: lista de cada gerência + empresa (etapa especial E2). Sem controle de estoque; valor R$ 0,00 = o técnico não pode usar.

interface Props {
  userProfile: HexonUser;
  visibleUnits: string[] | null; // gerências do perfil (null = todas)
  visibleCompanies: string[] | null; // empresas que vê (null = todas as das gerências que vê)
  canManage: boolean;            // permissão "Cadastrar e Importar Materiais"
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dateBR = (d: string) => (d ? d.split('-').reverse().join('/') : '—');
const PAGE = 200;

export default function MaterialsView({ userProfile, visibleUnits, visibleCompanies, canManage }: Props) {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [units, setUnits] = useState<string[]>(visibleUnits || []);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [unit, setUnit] = useState('Todas');
  const [company, setCompany] = useState('Todas');
  const [availability, setAvailability] = useState<'Todos' | 'Disponível' | 'Sem valor'>('Todos');
  const [shown, setShown] = useState(PAGE);
  const [showImport, setShowImport] = useState(false);
  const [editing, setEditing] = useState<Material | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [costOf, setCostOf] = useState<Material | null>(null);
  const [historyOf, setHistoryOf] = useState<Material | null>(null);
  const [toDelete, setToDelete] = useState<Material | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const isSuperAdmin = userProfile.perfil === 'Super Administrador';

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await dbDeleteMaterial(toDelete.id);
      setToDelete(null);
      await load();
    } catch (err: any) {
      setDeleteError(`Não foi possível excluir: ${err?.message || err}`);
    } finally {
      setDeleting(false);
    }
  };

  const load = async (force = true) => {
    setLoading(true);
    setMaterials((await dbGetMaterials(visibleUnits, force)).filter((m) => isCompanyVisible(m.company, visibleCompanies)));
    setLoading(false);
  };
  useEffect(() => {
    load(false);
    dbGetCompanies().then(setCompanies).catch(() => {});
    if (visibleUnits === null) {
      dbGetManagements()
        .then((list) => setUnits(list.map((m) => m.name).filter((n) => n && n !== 'Todas')))
        .catch(() => {});
    }
  }, []);

  // Empresas que aparecem no filtro e nos cadastros: as que o usuário vê, nas gerências que vê
  const myCompanies = useMemo(
    () => companies.filter((c) => isCompanyVisible(c.id, visibleCompanies) && (visibleUnits === null || c.units.some((u) => visibleUnits.includes(u)))),
    [companies, visibleCompanies, visibleUnits]
  );
  const companyName = (id: string) => companies.find((c) => c.id === id)?.name || id || '—';

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return materials.filter((m) => {
      if (unit !== 'Todas' && m.unit !== unit) return false;
      if (company !== 'Todas' && m.company !== company) return false;
      if (availability === 'Disponível' && !(m.cost > 0)) return false;
      if (availability === 'Sem valor' && m.cost > 0) return false;
      if (q && ![m.code, m.description, m.measureUnit].some((v) => (v || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [materials, search, unit, company, availability]);

  const inUnit = materials.filter((m) => (unit === 'Todas' || m.unit === unit) && (company === 'Todas' || m.company === company));
  const available = inUnit.filter((m) => m.cost > 0).length;

  const openNew = () => {
    setIsNew(true);
    setEditing({
      id: '', unit: units.length === 1 ? units[0] : unit !== 'Todas' ? unit : '', company: company !== 'Todas' ? company : '', code: '', description: '', measureUnit: 'UN',
      cost: 0, costFrom: '', history: [], createdAt: '', updatedAt: ''
    });
  };

  const field = 'w-full h-9 text-xs px-3 border border-slate-200 rounded-lg outline-none font-semibold bg-white';

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-800">Materiais</h2>
          <p className="text-xs text-slate-500">
            Cada gerência + empresa tem a sua lista, com os seus preços. O técnico só usa materiais da gerência e da empresa dele, com valor; material com R$ 0,00 fica aqui para o histórico.
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2 shrink-0">
            <button type="button" onClick={openNew} className="px-4 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-xs font-bold cursor-pointer">
              Novo material
            </button>
            <button type="button" onClick={() => setShowImport(true)} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer">
              Importar planilha
            </button>
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3">
        <p className="text-xs font-bold text-slate-700">
          {inUnit.length} material(is){unit !== 'Todas' ? ` em ${unit}` : ''}{company !== 'Todas' ? ` • ${companyName(company)}` : ''} • {available} disponível(is) para o técnico • {inUnit.length - available} com R$ 0,00
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <input value={search} onChange={(e) => { setSearch(e.target.value); setShown(PAGE); }} placeholder="Buscar código, descrição..." className={field} />
          <select value={unit} onChange={(e) => { setUnit(e.target.value); setShown(PAGE); }} className={field}>
            <option value="Todas">Todas as gerências</option>
            {units.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <select value={company} onChange={(e) => { setCompany(e.target.value); setShown(PAGE); }} className={field} aria-label="Filtrar por empresa">
            <option value="Todas">Todas as empresas</option>
            {(unit === 'Todas' ? myCompanies : companiesOfUnit(myCompanies, unit)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={availability} onChange={(e) => { setAvailability(e.target.value as typeof availability); setShown(PAGE); }} className={field}>
            <option value="Todos">Com e sem valor</option>
            <option value="Disponível">Disponíveis (com valor)</option>
            <option value="Sem valor">Sem valor (R$ 0,00)</option>
          </select>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-500">
              <th className="p-3">Código</th>
              <th className="p-3">Descrição</th>
              <th className="p-3">Unid.</th>
              <th className="p-3">Valor</th>
              <th className="p-3">Gerência</th>
              <th className="p-3">Empresa</th>
              <th className="p-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.slice(0, shown).map((m) => (
              <tr key={m.id} className={m.cost > 0 ? '' : 'bg-amber-50/40'}>
                <td className="p-3 font-mono font-bold">{m.code}</td>
                <td className="p-3 font-semibold text-slate-800">{m.description}</td>
                <td className="p-3">{m.measureUnit}</td>
                <td className="p-3">
                  <span className={`font-black ${m.cost > 0 ? 'text-emerald-600' : 'text-amber-600'}`}>{brl(m.cost)}</span>
                  {m.costFrom && <span className="block text-[10px] text-slate-400">desde {dateBR(m.costFrom)}</span>}
                </td>
                <td className="p-3">{m.unit}</td>
                <td className="p-3">{companyName(m.company)}</td>
                <td className="p-3 text-right whitespace-nowrap">
                  {canManage && (
                    <>
                      <button type="button" onClick={() => { setIsNew(false); setEditing({ ...m }); }} className="px-2.5 py-1 rounded-lg border border-slate-200 text-[10px] font-bold text-slate-600 cursor-pointer mr-1.5">
                        Editar
                      </button>
                      <button type="button" onClick={() => setCostOf(m)} className="px-2.5 py-1 rounded-lg border border-blue-200 bg-blue-50 text-[10px] font-bold text-blue-700 cursor-pointer mr-1.5">
                        Valor
                      </button>
                    </>
                  )}
                  {(m.history || []).length > 0 && (
                    <button type="button" onClick={() => setHistoryOf(m)} className="px-2.5 py-1 rounded-lg border border-slate-200 text-[10px] font-bold text-slate-600 cursor-pointer">
                      Histórico
                    </button>
                  )}
                  {isSuperAdmin && (
                    <button
                      type="button"
                      onClick={() => { setDeleteError(null); setToDelete(m); }}
                      className="px-2.5 py-1 rounded-lg border border-rose-200 bg-rose-50 text-[10px] font-bold text-rose-700 cursor-pointer ml-1.5"
                    >
                      Excluir
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-slate-400 italic">Nenhum material encontrado.</td></tr>
            )}
            {loading && (
              <tr><td colSpan={7} className="p-6 text-center text-slate-400">Carregando...</td></tr>
            )}
          </tbody>
        </table>
        {filtered.length > shown && (
          <div className="p-3 text-center">
            <button type="button" onClick={() => setShown(shown + PAGE)} className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-600 cursor-pointer">
              Mostrar mais ({filtered.length - shown} restantes)
            </button>
          </div>
        )}
      </div>

      {showImport && (
        <MaterialImportModal
          units={units}
          companies={myCompanies}
          existing={materials}
          currentUserName={userProfile.name}
          onClose={() => setShowImport(false)}
          onDone={() => load()}
        />
      )}

      {editing && (
        <MaterialFormModal
          material={editing}
          isNew={isNew}
          units={units}
          companies={myCompanies}
          materials={materials}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {costOf && (
        <MaterialCostModal
          material={costOf}
          userName={userProfile.name}
          onClose={() => setCostOf(null)}
          onSaved={() => { setCostOf(null); load(); }}
        />
      )}

      {toDelete && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-2xl p-6 space-y-3">
            <h3 className="text-base font-black text-slate-800">Excluir material</h3>
            <p className="text-xs text-slate-600">
              Excluir <strong>{toDelete.code} - {toDelete.description}</strong> ({toDelete.unit} • {companyName(toDelete.company)})? Use para corrigir um cadastro errado.
              As OS que já usaram este material mantêm o registro delas.
            </p>
            {deleteError && <p className="text-xs font-bold text-rose-600">{deleteError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setToDelete(null)} disabled={deleting} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-xs font-bold cursor-pointer">
                Cancelar
              </button>
              <button type="button" onClick={confirmDelete} disabled={deleting} className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50">
                {deleting ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {historyOf && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl p-6 space-y-3">
            <h3 className="text-base font-black text-slate-800">Histórico de valor — {historyOf.code}</h3>
            <ul className="text-xs text-slate-600 space-y-1 max-h-72 overflow-y-auto">
              {[...(historyOf.history || [])].reverse().map((h, i) => (
                <li key={i}>
                  <strong>{brl(h.value)}</strong> desde {dateBR(h.from)} — {h.setBy}{h.reason ? ` (${h.reason})` : ''}
                </li>
              ))}
            </ul>
            <div className="flex justify-end">
              <button type="button" onClick={() => setHistoryOf(null)} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-xs font-bold cursor-pointer">Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Cadastro manual: código, descrição, unidade de medida, gerência e empresa (o valor é informado em "Valor")
function MaterialFormModal({ material, isNew, units, companies, materials, onClose, onSaved }: {
  material: Material; isNew: boolean; units: string[]; companies: Company[]; materials: Material[]; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState(material);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const field = 'w-full h-9 text-xs px-3 border border-slate-200 rounded-lg outline-none font-semibold bg-white';

  const save = async () => {
    if (!form.unit) return setError('Escolha a gerência.');
    if (!form.company) return setError('Escolha a empresa.');
    if (!form.code.trim() || !form.description.trim()) return setError('Informe o código e a descrição.');
    const id = isNew ? materialIdOf(form.unit, form.company, form.code) : form.id;
    const clash = materials.find((m) => m.id !== form.id && m.unit === form.unit && m.company === form.company && materialCodeKey(m.code) === materialCodeKey(form.code));
    if (clash || (isNew && materials.some((m) => m.id === id))) return setError('Já existe um material com esse código nesta gerência e empresa.');
    setSaving(true);
    setError(null);
    try {
      const now = new Date().toISOString();
      await dbSaveMaterial({
        ...form,
        id,
        code: form.code.trim(),
        description: form.description.trim(),
        measureUnit: (form.measureUnit || 'UN').trim().toUpperCase(),
        createdAt: form.createdAt || now
      });
      onSaved();
    } catch (err: any) {
      setError(`Não foi possível salvar: ${err?.message || err}`);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl p-6 space-y-3">
        <h3 className="text-base font-black text-slate-800">{isNew ? 'Novo material' : 'Editar material'}</h3>
        <label className="block">
          <span className="block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500">Gerência *</span>
          <select value={form.unit} disabled={!isNew} onChange={(e) => setForm({ ...form, unit: e.target.value, company: '' })} className={field}>
            <option value="">Selecione...</option>
            {units.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500">Empresa *</span>
          <select value={form.company} disabled={!isNew || !form.unit} onChange={(e) => setForm({ ...form, company: e.target.value })} className={field} aria-label="Empresa do material">
            <option value="">{form.unit ? 'Selecione...' : 'Escolha a gerência primeiro'}</option>
            {companiesOfUnit(companies, form.unit)
              .filter((c) => c.active || c.id === form.company)
              .map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-3 gap-3">
          <label className="block col-span-2">
            <span className="block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500">Código *</span>
            <input value={form.code} disabled={!isNew} onChange={(e) => setForm({ ...form, code: e.target.value })} className={field} />
          </label>
          <label className="block">
            <span className="block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500">Unidade</span>
            <input value={form.measureUnit} onChange={(e) => setForm({ ...form, measureUnit: e.target.value })} placeholder="UN, M, KG..." className={field} />
          </label>
        </div>
        <label className="block">
          <span className="block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500">Descrição *</span>
          <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={field} />
        </label>
        {isNew && <p className="text-[11px] text-slate-500">Depois de salvar, informe o valor em "Valor". Sem valor, o técnico não pode usar.</p>}
        {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-xs font-bold cursor-pointer">Cancelar</button>
          <button type="button" onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50">
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Novo valor a partir de uma data (R$ 0,00 deixa o material indisponível para o técnico)
function MaterialCostModal({ material, userName, onClose, onSaved }: {
  material: Material; userName: string; onClose: () => void; onSaved: () => void;
}) {
  const [value, setValue] = useState(material.cost ? String(material.cost).replace('.', ',') : '');
  const [from, setFrom] = useState(localTodayStr());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const field = 'w-full h-9 text-xs px-3 border border-slate-200 rounded-lg outline-none font-semibold bg-white';

  const save = async () => {
    const raw = value.trim();
    const parsed = Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw);
    if (!raw || !Number.isFinite(parsed) || parsed < 0) return setError('Informe um valor válido (ex.: 12,50). Use 0 para deixar indisponível.');
    if (!from) return setError('Informe a data de início.');
    setSaving(true);
    setError(null);
    try {
      await dbSetMaterialCost(material, Math.round(parsed * 100) / 100, from, userName, 'manual');
      onSaved();
    } catch (err: any) {
      setError(`Não foi possível salvar: ${err?.message || err}`);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-2xl p-6 space-y-3">
        <h3 className="text-base font-black text-slate-800">Valor — {material.code}</h3>
        <p className="text-xs text-slate-500">{material.description} ({material.measureUnit})</p>
        <label className="block">
          <span className="block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500">Valor por {material.measureUnit} (R$)</span>
          <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="Ex.: 12,50" className={field} />
        </label>
        <label className="block">
          <span className="block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500">Vale a partir de</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={field} />
        </label>
        {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-xs font-bold cursor-pointer">Cancelar</button>
          <button type="button" onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50">
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
