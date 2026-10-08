import React, { useEffect, useMemo, useState } from 'react';
import { AccessProfile, Company, HexonUser, JobRole, Management, WorkforcePerson } from '../../types';
import {
  cargoKey,
  dbGetCompanies,
  dbDeleteWorkforcePerson,
  dbGetJobRoles,
  dbGetWorkforce,
  dbSetWorkforceStatus,
  resolveUserProfile
} from '../../db/firebase';
import WorkforceImportModal from './WorkforceImportModal';
import JobRolesPanel from './JobRolesPanel';
import { useSyncVersion } from '../../utils/useSyncVersion';

// EFETIVO (Super Administrador): todas as pessoas que podem participar de uma preventiva.
// "Com login" = usuários do sistema; "Só efetivo" = importados por planilha, sem acesso ao sistema.

interface Props {
  users: HexonUser[];
  managements: Management[];
  profiles: AccessProfile[];
  currentUserName: string;
  darkMode: boolean;
}

interface Row {
  key: string;
  matricula: string;
  name: string;
  cargo: string;
  unit: string;
  companies: string[];
  status: 'Ativo' | 'Inativo';
  hasLogin: boolean;
  profileName?: string;
  person?: WorkforcePerson;
}

export default function WorkforceTab({ users, managements, profiles, currentUserName, darkMode }: Props) {
  const [view, setView] = useState<'pessoas' | 'cargos'>('pessoas');
  const [people, setPeople] = useState<WorkforcePerson[]>([]);
  const [roles, setRoles] = useState<JobRole[]>([]);
  const [showImport, setShowImport] = useState(false);
  const [search, setSearch] = useState('');
  const [unit, setUnit] = useState('Todas');
  const [company, setCompany] = useState('Todas');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [cargo, setCargo] = useState('Todos');
  const [origin, setOrigin] = useState<'Todos' | 'login' | 'importado'>('Todos');
  const [status, setStatus] = useState<'Ativo' | 'Inativo' | 'Todos'>('Ativo');
  const [toDelete, setToDelete] = useState<WorkforcePerson | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = async (force = true) => {
    const [p, r] = await Promise.all([dbGetWorkforce(force), dbGetJobRoles(force)]);
    setPeople(p);
    setRoles(r);
  };
  useEffect(() => {
    load(false);
    dbGetCompanies().then(setCompanies).catch(() => {});
  }, []);
  // Tempo real: alteração feita em outro aparelho aparece sozinha (relê da memória, sem ler o banco)
  const wfVersion = useSyncVersion('workforce');
  useEffect(() => {
    if (wfVersion === 0) return;
    dbGetWorkforce(false).then(setPeople).catch(() => {});
  }, [wfVersion]);
  const companyName = (id: string) => companies.find((c) => c.id === id)?.name || id;

  const unitNames = managements.map((m) => m.name).filter((n) => n && n !== 'Todas');

  // Usuários (com login) + importados, numa lista só
  const rows = useMemo<Row[]>(
    () => [
      ...users.map((u) => ({
        key: `u_${u.id}`,
        matricula: u.matricula,
        name: u.name,
        cargo: u.cargo || '',
        unit: u.gerencia,
        companies: u.companies || [],
        status: u.status,
        hasLogin: true,
        profileName: resolveUserProfile(u, profiles)?.name || u.perfil
      })),
      ...people.map((p) => ({
        key: p.id,
        matricula: p.matricula,
        name: p.name,
        cargo: p.cargo,
        unit: p.unit,
        companies: p.company ? [p.company] : [],
        status: p.status,
        hasLogin: false,
        person: p
      }))
    ],
    [users, people, profiles]
  );

  // Resumo por cargo (ativos), com quantos têm login
  const summary = useMemo(() => {
    const map = new Map<string, { name: string; total: number; login: number }>();
    rows
      .filter((r) => r.status === 'Ativo' && r.cargo)
      .forEach((r) => {
        const k = cargoKey(r.cargo);
        const item = map.get(k) || { name: r.cargo.trim(), total: 0, login: 0 };
        item.total++;
        if (r.hasLogin) item.login++;
        map.set(k, item);
      });
    return Array.from(map.values()).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }, [rows]);
  const activeCountByCargo = useMemo(() => new Map(summary.map((s) => [cargoKey(s.name), s.total])), [summary]);
  const cargoNames = useMemo(() => Array.from(new Set(rows.map((r) => r.cargo.trim()).filter(Boolean))), [rows]);

  const filtered = rows
    .filter((r) => {
      const q = search.trim().toLowerCase();
      if (q && ![r.name, r.matricula, r.cargo].some((v) => (v || '').toLowerCase().includes(q))) return false;
      if (unit !== 'Todas' && r.unit !== unit) return false;
      if (company !== 'Todas' && !r.companies.includes(company)) return false;
      if (cargo !== 'Todos' && cargoKey(r.cargo) !== cargo) return false;
      if (origin === 'login' && !r.hasLogin) return false;
      if (origin === 'importado' && r.hasLogin) return false;
      if (status !== 'Todos' && r.status !== status) return false;
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const activeTotal = rows.filter((r) => r.status === 'Ativo').length;
  const activeLogin = rows.filter((r) => r.status === 'Ativo' && r.hasLogin).length;

  const toggleStatus = async (p: WorkforcePerson) => {
    setActionError(null);
    try {
      await dbSetWorkforceStatus(p, p.status === 'Ativo' ? 'Inativo' : 'Ativo');
      await load();
    } catch (err: any) {
      setActionError(err?.message || String(err));
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setActionError(null);
    try {
      await dbDeleteWorkforcePerson(toDelete.id, toDelete.unit);
      setToDelete(null);
      await load();
    } catch (err: any) {
      setActionError(err?.message || String(err));
    }
  };

  const card = darkMode ? 'bg-[#0a1122]/40 border-slate-800' : 'bg-white border-slate-200';
  const strong = darkMode ? 'text-slate-200' : 'text-slate-800';
  const field = `w-full h-9 text-xs px-3 border rounded-lg outline-none font-semibold ${darkMode ? 'bg-[#121b2d] border-slate-800' : 'bg-white border-slate-200'}`;
  const tabBtn = (active: boolean) =>
    `px-4 py-2 rounded-lg text-xs font-black cursor-pointer ${active ? 'bg-blue-600 text-white' : 'border border-slate-200 text-slate-600'}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <button type="button" className={tabBtn(view === 'pessoas')} onClick={() => setView('pessoas')}>Pessoas</button>
          <button type="button" className={tabBtn(view === 'cargos')} onClick={() => setView('cargos')}>Cargos e valores</button>
        </div>
        {view === 'pessoas' && (
          <button
            type="button"
            onClick={() => setShowImport(true)}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold cursor-pointer"
          >
            Importar planilha
          </button>
        )}
      </div>

      {view === 'cargos' ? (
        <JobRolesPanel
          roles={roles}
          cargoNames={cargoNames}
          activeCountByCargo={activeCountByCargo}
          currentUserName={currentUserName}
          darkMode={darkMode}
          onChanged={() => load()}
        />
      ) : (
        <>
          {/* Resumo */}
          <div className={`border rounded-xl p-4 space-y-3 ${card}`}>
            <p className={`text-xs font-bold ${strong}`}>
              Efetivo ativo: {activeTotal} pessoa(s) • {activeLogin} com login • {activeTotal - activeLogin} só efetivo (importadas)
            </p>
            <div className="flex flex-wrap gap-2">
              {summary.map((s) => (
                <span key={s.name} className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-bold text-slate-700 dark:text-slate-200">
                  {s.total} {s.name} <span className="text-slate-500 font-semibold">({s.login} com login)</span>
                </span>
              ))}
              {summary.length === 0 && <span className="text-xs text-slate-500">Nenhuma pessoa ativa com cargo.</span>}
            </div>
          </div>

          {/* Filtros */}
          <div className={`border rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 ${card}`}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar nome, matrícula, cargo..." className={`${field} lg:col-span-1`} />
            <select value={unit} onChange={(e) => setUnit(e.target.value)} className={field}>
              <option value="Todas">Todas as gerências</option>
              {unitNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <select value={company} onChange={(e) => setCompany(e.target.value)} className={field} aria-label="Filtrar por empresa">
              <option value="Todas">Todas as empresas</option>
              {(unit === 'Todas' ? companies : companies.filter((c) => c.units.includes(unit))).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={cargo} onChange={(e) => setCargo(e.target.value)} className={field}>
              <option value="Todos">Todos os cargos</option>
              {summary.map((s) => <option key={s.name} value={cargoKey(s.name)}>{s.name}</option>)}
            </select>
            <select value={origin} onChange={(e) => setOrigin(e.target.value as typeof origin)} className={field}>
              <option value="Todos">Com e sem login</option>
              <option value="login">Com login (usuários)</option>
              <option value="importado">Só efetivo (importados)</option>
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={field}>
              <option value="Ativo">Ativos</option>
              <option value="Inativo">Inativos</option>
              <option value="Todos">Ativos e inativos</option>
            </select>
          </div>

          {actionError && <p className="text-xs font-bold text-rose-600">{actionError}</p>}

          {/* Lista */}
          <div className={`border rounded-xl overflow-x-auto ${card}`}>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="p-3">Nome / Matrícula</th>
                  <th className="p-3">Cargo</th>
                  <th className="p-3">Gerência</th>
                  <th className="p-3">Empresa</th>
                  <th className="p-3">Origem</th>
                  <th className="p-3">Situação</th>
                  <th className="p-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.map((r) => (
                  <tr key={r.key} className={r.status === 'Inativo' ? 'opacity-60' : ''}>
                    <td className="p-3">
                      <span className={`font-bold block ${strong}`}>{r.name}</span>
                      <span className="font-mono text-[10px] text-slate-500">{r.matricula}</span>
                    </td>
                    <td className="p-3 font-semibold">{r.cargo || '—'}</td>
                    <td className="p-3">{r.unit}</td>
                    <td className="p-3">{r.companies.length ? r.companies.map(companyName).join(', ') : <span className="text-slate-400">—</span>}</td>
                    <td className="p-3">
                      {r.hasLogin ? (
                        <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-[10px] font-black" title="Usuário do sistema">
                          Com login • {r.profileName}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-black" title="Importado só para compor o efetivo">
                          Só efetivo (importado)
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      <span className={`font-bold ${r.status === 'Ativo' ? 'text-emerald-600' : 'text-slate-500'}`}>{r.status}</span>
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      {r.person ? (
                        <>
                          <button type="button" onClick={() => toggleStatus(r.person!)} className="px-2.5 py-1 rounded-lg border border-slate-200 text-[10px] font-bold text-slate-600 cursor-pointer mr-1.5">
                            {r.status === 'Ativo' ? 'Inativar' : 'Reativar'}
                          </button>
                          <button type="button" onClick={() => setToDelete(r.person!)} className="px-2.5 py-1 rounded-lg border border-rose-200 bg-rose-50 text-[10px] font-bold text-rose-700 cursor-pointer">
                            Excluir
                          </button>
                        </>
                      ) : (
                        <span className="text-[10px] text-slate-400">editar em Colaboradores</span>
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-slate-400 italic">Nenhuma pessoa encontrada.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showImport && (
        <WorkforceImportModal
          companies={companies}
          existing={people}
          users={users}
          unitNames={unitNames}
          darkMode={darkMode}
          onClose={() => setShowImport(false)}
          onDone={() => load()}
        />
      )}

      {toDelete && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className={`w-full max-w-sm rounded-2xl border shadow-2xl p-6 space-y-4 ${darkMode ? 'bg-[#0b1220] border-slate-800' : 'bg-white border-slate-200'}`}>
            <h3 className={`text-base font-black ${strong}`}>Excluir do efetivo</h3>
            <p className="text-xs text-slate-500">
              Excluir {toDelete.name} ({toDelete.matricula})? Use isto, por exemplo, antes de criar essa pessoa como usuário com login.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setToDelete(null)} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-xs font-bold cursor-pointer">
                Cancelar
              </button>
              <button type="button" onClick={confirmDelete} className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer">
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
