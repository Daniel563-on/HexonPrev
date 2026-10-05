import React, { useState } from 'react';
import { AccessProfile, HexonUser, Management, ProfileKind } from '../../types';
import { DEFAULT_PERMISSIONS, PERMISSION_AREAS, dbDeleteProfile, dbSaveProfile, resolveUserProfile, withDerivedPermissions } from '../../db/firebase';

// PERFIS DE ACESSO (somente Super Administrador)
// Nome livre, tipo de uso, unidades visíveis e permissões de cada perfil.

const KIND_INFO: Record<ProfileKind, { label: string; hint: string }> = {
  total: { label: 'Acesso total', hint: 'Administra tudo, em todas as unidades.' },
  planejamento: { label: 'Escritório', hint: 'Usa o sistema no computador, conforme as permissões abaixo.' },
  execucao: { label: 'Campo (técnico)', hint: 'Usa o aplicativo de execução em campo.' }
};

const OS_SIGN_LABEL: Record<NonNullable<AccessProfile['osSignAs']>, string> = {
  none: 'Nenhum',
  engenheiro: 'Engenheiro',
  gerente: 'Gerente'
};

const OS_SCOPE_LABEL: Record<NonNullable<AccessProfile['osScope']>, string> = {
  own: 'Só as minhas',
  unit: 'Da minha gerência',
  all: 'Todas as gerências do perfil'
};

const SCOPE_LABEL: Record<AccessProfile['unitScope'], string> = {
  own: 'Só a unidade do usuário',
  selected: 'Unidades escolhidas',
  all: 'Todas as unidades'
};

interface Props {
  profiles: AccessProfile[];
  managements: Management[];
  users: HexonUser[];
  darkMode: boolean;
  onChanged: () => void;
}

const emptyProfile = (): AccessProfile => {
  const now = new Date().toISOString();
  return {
    id: `perfil_${Date.now()}`,
    name: '',
    description: '',
    kind: 'planejamento',
    unitScope: 'own',
    units: [],
    permissions: Object.fromEntries(Object.keys(DEFAULT_PERMISSIONS).map((k) => [k, false])),
    system: false,
    createdAt: now,
    updatedAt: now
  };
};

export default function ProfilesTab({ profiles, managements, users, darkMode, onChanged }: Props) {
  const [editing, setEditing] = useState<AccessProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usersCount = (p: AccessProfile) => users.filter((u) => resolveUserProfile(u, profiles)?.id === p.id).length;
  const permissionList = Object.values(DEFAULT_PERMISSIONS);

  const card = darkMode ? 'bg-[#0a1122]/40 border-slate-800' : 'bg-white border-slate-200';
  const muted = darkMode ? 'text-slate-400' : 'text-slate-500';
  const strong = darkMode ? 'text-white' : 'text-slate-900';
  const input = `w-full px-3 py-2 rounded-lg border text-xs font-semibold outline-none ${
    darkMode ? 'bg-[#121b2d] border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-900'
  }`;

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.name.trim()) {
      setError('Informe o nome do perfil.');
      return;
    }
    if (editing.unitScope === 'selected' && editing.units.length === 0) {
      setError('Escolha pelo menos uma unidade.');
      return;
    }
    const duplicated = profiles.find((p) => p.id !== editing.id && p.name.trim().toLowerCase() === editing.name.trim().toLowerCase());
    if (duplicated) {
      setError('Já existe um perfil com esse nome.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const toSave: AccessProfile = {
        ...editing,
        name: editing.name.trim(),
        description: editing.description.trim(),
        // Acesso total vê todas as unidades e tem todas as permissões
        unitScope: editing.kind === 'total' ? 'all' : editing.unitScope,
        units: editing.kind === 'total' || editing.unitScope !== 'selected' ? [] : editing.units,
        permissions:
          editing.kind === 'total'
            ? Object.fromEntries(permissionList.map((p) => [p.id, true]))
            : editing.permissions
      };
      await dbSaveProfile(toSave);
      setEditing(null);
      onChanged();
    } catch (err: any) {
      setError(`Não foi possível salvar: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  // Confirmação dentro da tela (o preview bloqueia window.confirm/alert)
  const [toDelete, setToDelete] = useState<AccessProfile | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const handleDelete = async () => {
    if (!toDelete) return;
    setDeletingBusy(true);
    setDeleteError(null);
    try {
      await dbDeleteProfile(toDelete);
      setToDelete(null);
      onChanged();
    } catch (err: any) {
      setDeleteError(err?.message || String(err));
    } finally {
      setDeletingBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className={`border rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 ${card}`}>
        <div className="text-xs">
          <p className={`font-bold ${strong}`}>Perfis de acesso</p>
          <p className={muted}>
            Crie perfis com qualquer nome e defina o que cada um pode fazer e quais unidades pode ver. Os perfis de fábrica podem ser renomeados, mas não excluídos.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setEditing(emptyProfile());
          }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold cursor-pointer shrink-0"
        >
          Novo perfil
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {profiles.map((p) => (
          <div key={p.id} className={`border rounded-xl p-4 space-y-3 ${card}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className={`text-sm font-black truncate ${strong}`}>{p.name}</p>
                <p className={`text-[11px] ${muted}`}>{p.description || '—'}</p>
              </div>
              {p.system && (
                <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-slate-100 text-slate-600 shrink-0">Fábrica</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <p className={`text-[9px] font-black uppercase ${muted}`}>Tipo de uso</p>
                <p className={`font-bold ${strong}`}>{KIND_INFO[p.kind].label}</p>
              </div>
              <div>
                <p className={`text-[9px] font-black uppercase ${muted}`}>Unidades</p>
                <p className={`font-bold ${strong}`}>
                  {p.kind === 'total' ? 'Todas' : p.unitScope === 'selected' ? p.units.join(', ') : SCOPE_LABEL[p.unitScope]}
                </p>
              </div>
              <div>
                <p className={`text-[9px] font-black uppercase ${muted}`}>Permissões</p>
                <p className={`font-bold ${strong}`}>
                  {p.kind === 'total' ? 'Todas' : `${permissionList.filter((perm) => !!withDerivedPermissions(p).permissions[perm.id]).length} de ${permissionList.length}`}
                </p>
              </div>
              <div>
                <p className={`text-[9px] font-black uppercase ${muted}`}>Usuários</p>
                <p className={`font-bold ${strong}`}>{usersCount(p)}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  const full = withDerivedPermissions(p);
                  setEditing({ ...full, permissions: { ...full.permissions }, units: [...p.units] });
                }}
                className="flex-1 px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 text-[11px] font-bold cursor-pointer"
              >
                Editar
              </button>
              {!p.system && (
                <button
                  type="button"
                  onClick={() => { setDeleteError(null); setToDelete(p); }}
                  className="px-3 py-1.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-[11px] font-bold cursor-pointer"
                >
                  Excluir
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className={`w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border shadow-2xl p-6 space-y-4 ${darkMode ? 'bg-[#0b1220] border-slate-800' : 'bg-white border-slate-200'}`}>
            <h3 className={`text-base font-black ${strong}`}>{profiles.some((p) => p.id === editing.id) ? 'Editar perfil' : 'Novo perfil'}</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block">
                <span className={`block text-[10px] font-black uppercase tracking-wider mb-1 ${muted}`}>Nome do perfil *</span>
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={input} placeholder="Ex.: Engenheiro" />
              </label>
              <label className="block">
                <span className={`block text-[10px] font-black uppercase tracking-wider mb-1 ${muted}`}>Descrição</span>
                <input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className={input} />
              </label>
            </div>

            {/* Tipo de uso */}
            <div>
              <span className={`block text-[10px] font-black uppercase tracking-wider mb-1 ${muted}`}>Tipo de uso</span>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {(Object.keys(KIND_INFO) as ProfileKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    disabled={editing.system}
                    onClick={() => setEditing({ ...editing, kind: k })}
                    className={`p-2.5 rounded-lg border text-left cursor-pointer disabled:cursor-not-allowed ${
                      editing.kind === k
                        ? 'border-blue-500 bg-blue-50 text-blue-800'
                        : darkMode ? 'border-slate-800 text-slate-300' : 'border-slate-200 text-slate-700'
                    } ${editing.system && editing.kind !== k ? 'opacity-40' : ''}`}
                  >
                    <span className="block text-xs font-black">{KIND_INFO[k].label}</span>
                    <span className="block text-[10px] opacity-80">{KIND_INFO[k].hint}</span>
                  </button>
                ))}
              </div>
              {editing.system && <p className={`text-[10px] mt-1 ${muted}`}>O tipo de uso dos perfis de fábrica não muda; o nome e as permissões podem mudar.</p>}
            </div>

            {editing.kind !== 'total' && (
              <>
                {/* Unidades visíveis */}
                <div>
                  <span className={`block text-[10px] font-black uppercase tracking-wider mb-1 ${muted}`}>Unidades que pode ver</span>
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(SCOPE_LABEL) as AccessProfile['unitScope'][]).map((sc) => (
                      <button
                        key={sc}
                        type="button"
                        onClick={() => setEditing({ ...editing, unitScope: sc })}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-bold cursor-pointer ${
                          editing.unitScope === sc ? 'border-blue-500 bg-blue-50 text-blue-800' : darkMode ? 'border-slate-800 text-slate-300' : 'border-slate-200 text-slate-700'
                        }`}
                      >
                        {SCOPE_LABEL[sc]}
                      </button>
                    ))}
                  </div>
                  {editing.unitScope === 'selected' && (
                    <div className="flex flex-wrap gap-3 mt-2">
                      {managements.map((m) => (
                        <label key={m.id} className={`flex items-center gap-1.5 text-xs font-bold ${strong}`}>
                          <input
                            type="checkbox"
                            checked={editing.units.includes(m.name)}
                            onChange={(e) =>
                              setEditing({
                                ...editing,
                                units: e.target.checked ? [...editing.units, m.name] : editing.units.filter((u) => u !== m.name)
                              })
                            }
                          />
                          {m.name}
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {/* Permissões, por área */}
                <div className="space-y-3">
                  <span className={`block text-[10px] font-black uppercase tracking-wider ${muted}`}>Permissões</span>
                  {PERMISSION_AREAS.map((area) => {
                    const list = permissionList.filter((perm) => perm.area === area.id);
                    if (list.length === 0) return null;
                    return (
                      <div key={area.id} className={`rounded-lg border ${darkMode ? 'border-slate-800' : 'border-slate-200'}`}>
                        <div className={`px-3 py-2 border-b ${darkMode ? 'border-slate-800 bg-slate-900/40' : 'border-slate-200 bg-slate-50'}`}>
                          <p className={`text-xs font-black ${strong}`}>{area.label}</p>
                          {area.hint && <p className={`text-[10px] ${muted}`}>{area.hint}</p>}
                        </div>
                        <div className={`divide-y ${darkMode ? 'divide-slate-800' : 'divide-slate-100'}`}>
                          {list.map((perm) => (
                            <label key={perm.id} className="flex items-start gap-2.5 px-3 py-2 cursor-pointer">
                              <input
                                type="checkbox"
                                className="mt-0.5"
                                checked={!!editing.permissions[perm.id]}
                                onChange={(e) => setEditing({ ...editing, permissions: { ...editing.permissions, [perm.id]: e.target.checked } })}
                              />
                              <span className="min-w-0">
                                <span className={`block text-xs font-bold ${strong}`}>
                                  {perm.name}
                                  {perm.soon && (
                                    <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[9px] font-black uppercase">em construção · {perm.soon}</span>
                                  )}
                                </span>
                                <span className={`block text-[10px] ${muted}`}>{perm.description}</span>
                              </span>
                            </label>
                          ))}
                          {area.id === 'os' && (
                            <div className="px-3 py-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                              <label className="block">
                                <span className={`block text-[10px] font-black uppercase tracking-wider mb-1 ${muted}`}>
                                  Assinar OS como <span className="normal-case font-normal">(engenheiro assina antes do gerente)</span>
                                </span>
                                <select
                                  value={editing.osSignAs || 'none'}
                                  onChange={(e) => setEditing({ ...editing, osSignAs: e.target.value as AccessProfile['osSignAs'] })}
                                  className={input}
                                >
                                  {(Object.keys(OS_SIGN_LABEL) as NonNullable<AccessProfile['osSignAs']>[]).map((k) => (
                                    <option key={k} value={k}>{OS_SIGN_LABEL[k]}</option>
                                  ))}
                                </select>
                              </label>
                              <label className="block">
                                <span className={`block text-[10px] font-black uppercase tracking-wider mb-1 ${muted}`}>
                                  Alcance das OS <span className="text-amber-700 normal-case">(em construção · Fase 6)</span>
                                </span>
                                <select
                                  value={editing.osScope || 'unit'}
                                  onChange={(e) => setEditing({ ...editing, osScope: e.target.value as AccessProfile['osScope'] })}
                                  className={input}
                                >
                                  {(Object.keys(OS_SCOPE_LABEL) as NonNullable<AccessProfile['osScope']>[]).map((k) => (
                                    <option key={k} value={k}>{OS_SCOPE_LABEL[k]}</option>
                                  ))}
                                </select>
                              </label>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
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

      {toDelete && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className={`w-full max-w-sm rounded-2xl border shadow-2xl p-6 space-y-4 ${darkMode ? 'bg-[#0b1220] border-slate-800' : 'bg-white border-slate-200'}`}>
            <h3 className={`text-base font-black ${strong}`}>Excluir perfil</h3>
            <p className={`text-xs ${muted}`}>Deseja excluir o perfil "{toDelete.name}"? Esta ação não pode ser desfeita.</p>
            {deleteError && <p className="text-xs font-bold text-rose-600">{deleteError}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setToDelete(null)}
                disabled={deletingBusy}
                className={`px-4 py-2 rounded-lg border text-xs font-bold cursor-pointer ${darkMode ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600'}`}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deletingBusy}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {deletingBusy ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
