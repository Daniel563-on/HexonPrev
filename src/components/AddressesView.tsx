import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, Plus, Upload, Search, Edit, Power } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Address } from '../types';
import { dbGetAddresses, dbSaveAddress, dbImportAddresses, addressCodeFromItem } from '../db/firebase';

// CONTROLE DE ENDEREÇOS (somente Super Administrador)
// Cada endereço ativo recebe sua ronda semanal (vistoria sem ativo da DOM).
// Endereço inativo não recebe rondas; o histórico dele continua guardado.
const emptyForm = { item: '', craai: '', comarca: '', address: '' };

export default function AddressesView() {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'Ativos' | 'Inativos' | 'Todos'>('Ativos');
  const [editing, setEditing] = useState<Address | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    setAddresses(await dbGetAddresses(true));
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return addresses.filter((a) => {
      if (statusFilter === 'Ativos' && !a.active) return false;
      if (statusFilter === 'Inativos' && a.active) return false;
      if (!q) return true;
      return [a.code, a.craai, a.comarca, a.address].some((v) => (v || '').toLowerCase().includes(q));
    });
  }, [addresses, search, statusFilter]);

  const activeCount = addresses.filter((a) => a.active).length;

  const openNew = () => {
    setEditing(null);
    const nextItem = addresses.reduce((max, a) => Math.max(max, parseInt(a.code.replace(/\D/g, ''), 10) || 0), 0) + 1;
    setForm({ ...emptyForm, item: String(nextItem) });
    setShowForm(true);
  };

  const openEdit = (a: Address) => {
    setEditing(a);
    setForm({ item: a.code.replace(/\D/g, ''), craai: a.craai, comarca: a.comarca, address: a.address });
    setShowForm(true);
  };

  const handleSave = async () => {
    const code = editing ? editing.code : addressCodeFromItem(form.item);
    if (!code || !form.craai.trim() || !form.comarca.trim() || !form.address.trim()) {
      alert('Preencha item, CRAAI, comarca e endereço.');
      return;
    }
    if (!editing && addresses.some((a) => a.code === code)) {
      alert(`Já existe um endereço com o código ${code}.`);
      return;
    }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      await dbSaveAddress({
        id: code,
        code,
        craai: form.craai.trim(),
        comarca: form.comarca.trim(),
        address: form.address.trim(),
        active: editing ? editing.active : true,
        createdAt: editing?.createdAt || now,
        updatedAt: now,
        inactivatedAt: editing?.inactivatedAt ?? null
      });
      setShowForm(false);
      await load();
    } catch (err: any) {
      alert(`Não foi possível salvar: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (a: Address) => {
    try {
      await dbSaveAddress({ ...a, active: !a.active, inactivatedAt: a.active ? new Date().toISOString() : null });
      await load();
    } catch (err: any) {
      alert(`Não foi possível alterar a situação: ${err?.message || err}`);
    }
  };

  // Importa a planilha com as colunas ITEM, CRAAI, COMARCA e ENDEREÇO
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });
      const norm = (k: string) => k.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
      const rows = raw
        .map((r) => {
          const byKey: Record<string, any> = {};
          Object.keys(r).forEach((k) => (byKey[norm(k)] = r[k]));
          return {
            code: addressCodeFromItem(byKey['ITEM']),
            craai: String(byKey['CRAAI'] ?? '').trim(),
            comarca: String(byKey['COMARCA'] ?? '').trim(),
            address: String(byKey['ENDERECO'] ?? '').trim()
          };
        })
        .filter((r) => r.code && r.comarca && r.address);
      if (rows.length === 0) {
        alert('Nenhuma linha válida encontrada. A planilha precisa das colunas ITEM, CRAAI, COMARCA e ENDEREÇO.');
        return;
      }
      const saved = await dbImportAddresses(rows);
      alert(`✅ ${saved} endereços importados/atualizados.`);
      await load();
    } catch (err: any) {
      alert(`Não foi possível importar a planilha: ${err?.message || err}`);
    }
  };

  const inputClass = 'w-full text-xs py-2 px-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none font-bold text-slate-800';
  const labelClass = 'block text-[10px] font-extrabold text-slate-500 uppercase mb-1';

  return (
    <div className="space-y-5 font-sans">
      <section className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="border-l-4 border-[#3525cd] pl-4">
          <h1 className="text-xl font-black text-slate-800 flex items-center gap-2">
            <MapPin className="w-5 h-5 text-[#3525cd]" /> Controle de Endereços
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {activeCount} endereço(s) ativo(s). Cada endereço ativo recebe sua ronda semanal.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase rounded-xl flex items-center gap-1.5 cursor-pointer"
          >
            <Upload className="w-4 h-4" /> Importar Planilha
          </button>
          <button
            type="button"
            onClick={openNew}
            className="px-4 py-2 bg-[#3525cd] hover:bg-[#281bbb] text-white text-xs font-black uppercase rounded-xl flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Adicionar Endereço
          </button>
        </div>
      </section>

      {showForm && (
        <div className="bg-white border border-indigo-200 rounded-xl p-4 shadow-xs space-y-3">
          <h3 className="text-xs font-black uppercase text-slate-700">
            {editing ? `Editar ${editing.code}` : 'Novo endereço'}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className={labelClass}>Item (código)</label>
              <input
                type="text"
                value={form.item}
                disabled={!!editing}
                onChange={(e) => setForm({ ...form, item: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>CRAAI</label>
              <input type="text" value={form.craai} onChange={(e) => setForm({ ...form, craai: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Comarca</label>
              <input type="text" value={form.comarca} onChange={(e) => setForm({ ...form, comarca: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Endereço</label>
              <input type="text" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={inputClass} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 border border-slate-200 text-xs font-bold text-slate-600 rounded-xl cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-[#3525cd] text-white text-xs font-black uppercase rounded-xl cursor-pointer disabled:opacity-60"
            >
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por código, CRAAI, comarca ou endereço..."
              className={`${inputClass} pl-9`}
            />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className={`${inputClass} md:w-40`}>
            <option value="Ativos">Ativos</option>
            <option value="Inativos">Inativos</option>
            <option value="Todos">Todos</option>
          </select>
        </div>

        {loading ? (
          <p className="py-8 text-center text-xs font-bold text-slate-400">Carregando...</p>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-xs font-bold text-slate-400 italic">Nenhum endereço encontrado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase text-slate-500 border-b border-slate-200">
                  <th className="py-2 pr-3">Código</th>
                  <th className="py-2 pr-3">CRAAI</th>
                  <th className="py-2 pr-3">Comarca</th>
                  <th className="py-2 pr-3">Endereço</th>
                  <th className="py-2 pr-3">Situação</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <tr key={a.id} className={`border-b border-slate-100 ${a.active ? '' : 'opacity-60'}`}>
                    <td className="py-2 pr-3 font-mono font-bold text-indigo-700">{a.code}</td>
                    <td className="py-2 pr-3 font-bold text-slate-700">{a.craai}</td>
                    <td className="py-2 pr-3 font-bold text-slate-700">{a.comarca}</td>
                    <td className="py-2 pr-3 text-slate-600">{a.address}</td>
                    <td className="py-2 pr-3">
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${a.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>
                        {a.active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="py-2">
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEdit(a)}
                          className="py-1 px-2 bg-indigo-50 border border-indigo-200 text-[9px] font-black text-indigo-700 rounded-lg flex items-center gap-1 cursor-pointer"
                        >
                          <Edit className="w-3 h-3" /> EDITAR
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleActive(a)}
                          className={`py-1 px-2 border text-[9px] font-black rounded-lg flex items-center gap-1 cursor-pointer ${
                            a.active ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                          }`}
                        >
                          <Power className="w-3 h-3" /> {a.active ? 'INATIVAR' : 'REATIVAR'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
