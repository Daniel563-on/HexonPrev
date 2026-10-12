import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Info, Pencil, Plus, RefreshCw, Star } from 'lucide-react';
import { Company, HexonUser, UsualTeam } from '../../types';
import { companiesOfUnit, dbGetCompanies, dbGetUnitPeopleInfo, dbListTeams, dbSaveTeams, isCompanyVisible, UnitPersonInfo } from '../../db/firebase';
import TeamForm, { teamLabel } from './TeamForm';

// PROGRAMAÇÃO › EQUIPES (Fase 7A): equipes fechadas da gerência + empresa, em ordem (ordem das linhas na Programação e no PDF).
// A equipe é a equipe habitual do responsável. Quem só vê ("Ver Programação") não tem os botões de mudar.

interface Props {
  user: HexonUser;
  unitOptions: string[];
  visibleCompanies: string[] | null;
  canEdit: boolean;
}

const byOrder = (a: UsualTeam, b: UsualTeam) => (a.order ?? 9999) - (b.order ?? 9999) || teamLabel(a).localeCompare(teamLabel(b));

export default function TeamsView({ user, unitOptions, visibleCompanies, canEdit }: Props) {
  const [unit, setUnit] = useState(() => (unitOptions.includes(user.gerencia) ? user.gerencia : unitOptions[0] || ''));
  const [companies, setCompanies] = useState<Company[]>([]);
  const [company, setCompany] = useState('');
  const [teams, setTeams] = useState<UsualTeam[]>([]);
  const [people, setPeople] = useState<UnitPersonInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<UsualTeam | 'new' | null>(null);

  useEffect(() => {
    dbGetCompanies()
      .then(setCompanies)
      .catch(() => {});
  }, []);
  const unitCompanies = useMemo(() => companiesOfUnit(companies, unit).filter((c) => c.active && isCompanyVisible(c.id, visibleCompanies)), [companies, unit, visibleCompanies]);
  useEffect(() => {
    if (!unitCompanies.some((c) => c.id === company)) setCompany(unitCompanies[0]?.id || '');
  }, [unitCompanies.map((c) => c.id).join('|')]);

  const load = async () => {
    setLoading(true);
    setMsg(null);
    try {
      const [t, p] = await Promise.all([dbListTeams(unit), dbGetUnitPeopleInfo(unit)]);
      setTeams(t);
      setPeople(p);
    } catch (err: any) {
      setMsg({ ok: false, text: err?.code === 'permission-denied' ? 'O banco não deixou ler as equipes.' : `Não foi possível ler as equipes: ${err?.message || err}` });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (unit) load();
  }, [unit]);

  const personOf = (mat: string) => people.find((p) => p.matricula === mat);
  // Empresa da equipe: a gravada; equipe antiga (sem empresa) = a empresa do responsável
  const teamCompanies = (t: UsualTeam) => (t.company ? [t.company] : personOf(t.matricula)?.companies || []);
  const here = teams.filter((t) => {
    const cs = teamCompanies(t);
    return cs.length === 0 || cs.includes(company);
  });
  here.sort(byOrder);
  // Uma pessoa fica em uma equipe só (na gerência inteira)
  const placed = useMemo(() => {
    const m = new Set<string>();
    teams.forEach((t) => {
      m.add(t.matricula);
      t.members.forEach((x) => m.add(x.matricula));
    });
    return m;
  }, [teams]);
  const candidates = people.filter((p) => p.companies.length === 0 || p.companies.includes(company));
  // Sem equipe: técnicos (com login) e pessoas do Efetivo; o escritório (outros perfis) não entra na lista
  const loose = candidates.filter((p) => !placed.has(p.matricula) && (!p.login || p.perfil === 'Profissional')).sort((a, b) => Number(b.login) - Number(a.login) || a.name.localeCompare(b.name));
  const companyName = unitCompanies.find((c) => c.id === company)?.name || company;

  const stamp = (t: UsualTeam): UsualTeam => ({ ...t, unit, company: t.company || company, updatedAt: new Date().toISOString(), updatedBy: user.name });
  const save = async (list: UsualTeam[], remove: string[]): Promise<boolean> => {
    setBusy(true);
    setMsg(null);
    try {
      await dbSaveTeams(list, remove);
      const ids = new Set([...list.map((t) => t.matricula), ...remove]);
      setTeams((prev) => [...prev.filter((t) => !ids.has(t.matricula)), ...list]);
      setMsg({ ok: true, text: 'Equipes salvas.' });
      return true;
    } catch (err: any) {
      setMsg({ ok: false, text: err?.code === 'permission-denied' ? 'O banco recusou: seu perfil não tem "Programar" nesta gerência.' : `Não foi possível salvar: ${err?.message || err}` });
      return false;
    } finally {
      setBusy(false);
    }
  };
  // ▲▼: troca de lugar e grava a ordem das equipes que mudaram
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= here.length) return;
    const list = [...here];
    [list[i], list[j]] = [list[j], list[i]];
    const changed = list.map((t, k) => ({ ...t, order: k })).filter((t) => here.find((x) => x.matricula === t.matricula)?.order !== t.order);
    save(changed.map(stamp), []);
  };
  const putIn = (p: UnitPersonInfo, mat: string) => {
    const t = here.find((x) => x.matricula === mat);
    if (t) save([stamp({ ...t, members: [...t.members, { matricula: p.matricula, name: p.name, cargo: p.cargo }] })], []);
  };

  const sel = 'h-9 px-2 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900';
  const card = 'rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b1220]';
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {unitOptions.length > 1 && (
            <select value={unit} onChange={(e) => setUnit(e.target.value)} className={sel}>
              {unitOptions.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          )}
          <select value={company} onChange={(e) => setCompany(e.target.value)} className={sel} disabled={unitCompanies.length === 0}>
            {unitCompanies.length === 0 && <option value="">Sem empresa nesta gerência</option>}
            {unitCompanies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={load} disabled={loading} className={`${sel} px-3 flex items-center gap-1.5 cursor-pointer`}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>
        {canEdit && company && (
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="h-9 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Nova equipe
          </button>
        )}
      </div>

      <div className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900 text-[11px] text-indigo-900 dark:text-indigo-200 flex gap-2">
        <Info className="w-4 h-4 shrink-0" />
        <span>
          A equipe daqui é a <b>equipe habitual</b> do responsável: entra sozinha como participantes nas OS e preventivas dele. O técnico vê a equipe no celular, mas <b>não muda</b>; na OS ou na
          preventiva ele ainda pode tirar ou colocar gente. A ordem daqui é a ordem das linhas na Programação e no PDF.
        </span>
      </div>
      {msg && <p className={`text-xs font-bold ${msg.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{msg.text}</p>}
      {unitCompanies.length === 0 && !loading && <p className="text-xs text-slate-500">Nenhuma empresa ativa nesta gerência (Configurações › Empresas).</p>}

      {company && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
          <div className="space-y-3">
            {loading && <p className="text-xs text-slate-400">Carregando...</p>}
            {!loading && here.length === 0 && <p className={`${card} p-8 text-center text-sm text-slate-500`}>Nenhuma equipe da {companyName} ainda.</p>}
            {here.map((t, i) => {
              const resp = personOf(t.matricula);
              return (
                <div key={t.matricula} className={`${card} p-4 flex gap-3 ${!t.name ? 'border-amber-300 bg-amber-50/40 dark:bg-amber-950/20' : ''}`}>
                  {canEdit && (
                    <div className="flex flex-col items-center gap-1 pt-0.5">
                      <button
                        type="button"
                        onClick={() => move(i, -1)}
                        disabled={busy || i === 0}
                        title="Subir"
                        className="h-6 w-6 rounded-md border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-500 cursor-pointer disabled:opacity-30"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-[10px] font-black text-slate-400">{i + 1}</span>
                      <button
                        type="button"
                        onClick={() => move(i, 1)}
                        disabled={busy || i === here.length - 1}
                        title="Descer"
                        className="h-6 w-6 rounded-md border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-500 cursor-pointer disabled:opacity-30"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={`text-sm font-black tracking-wide uppercase ${t.name ? 'text-rose-700 dark:text-rose-400' : 'text-amber-800'}`}>{teamLabel(t)}</p>
                      {t.type && <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-300">{t.type}</span>}
                      <span className="text-[10px] font-bold text-slate-400">{1 + t.members.length} pessoas</span>
                    </div>
                    {!t.name && <p className="text-[11px] font-bold text-amber-800">Veio da equipe habitual que o técnico montou. Dê um nome e um tipo para ela entrar na Programação.</p>}
                    <p className="text-xs text-slate-800 dark:text-slate-200 flex items-center gap-1 flex-wrap">
                      <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-400" />
                      <b>{resp?.name || t.respName || t.matricula}</b>
                      <span className="text-slate-500">
                        · {resp?.cargo || 'responsável'} · {t.matricula}
                      </span>
                      {!resp && <span className="text-[10px] font-bold text-rose-600">(não está ativo na gerência)</span>}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {t.members.length === 0 && <span className="text-[11px] text-slate-400">Sem membros.</span>}
                      {t.members.map((m) => (
                        <span key={m.matricula} className="px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-[11px] text-slate-700 dark:text-slate-300">
                          {m.name}
                          <span className="text-slate-400">
                            {m.cargo ? ` · ${m.cargo}` : ''} · {m.matricula}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => setEditing(t)}
                      className="self-start h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold text-indigo-700 dark:text-indigo-300 flex items-center gap-1 cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Editar
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className={`${card} p-3 space-y-2`}>
            <p className="text-xs font-black text-slate-900 dark:text-white">Pessoas sem equipe ({loose.length})</p>
            <p className="text-[10px] text-slate-500">
              Técnicos e Efetivo da {companyName} na {unit}.
            </p>
            {loose.length === 0 && !loading && <p className="text-[11px] text-slate-400">Todo mundo está numa equipe.</p>}
            {loose.map((p) => (
              <div key={p.matricula} className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 space-y-1">
                <p className="text-[11px] font-black text-slate-800 dark:text-slate-200">
                  {p.name}
                  {p.login && <span className="ml-1 text-[9px] text-indigo-600">técnico · login</span>}
                </p>
                <p className="text-[10px] text-slate-500">
                  {p.cargo || '—'} · {p.matricula}
                </p>
                {canEdit && here.length > 0 && (
                  <select value="" onChange={(e) => e.target.value && putIn(p, e.target.value)} disabled={busy} className={`${sel} h-8 w-full text-[11px]`}>
                    <option value="">Pôr na equipe...</option>
                    {here.map((t) => (
                      <option key={t.matricula} value={t.matricula}>
                        {teamLabel(t)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ))}
            {loose.some((p) => p.login) && <p className="text-[10px] font-bold text-amber-700">Técnico com login sem equipe: ponha numa equipe ou crie uma com ele como responsável.</p>}
          </div>
        </div>
      )}

      {editing && (
        <TeamForm
          team={editing === 'new' ? null : editing}
          teams={teams}
          people={candidates}
          companyName={companyName}
          stamp={stamp}
          nextOrder={here.length ? Math.max(...here.map((t) => t.order ?? 0)) + 1 : 0}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
