import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Trash2, X } from 'lucide-react';
import { OrderParticipant, UsualTeam } from '../../types';
import { UnitPersonInfo } from '../../db/firebase';

// PROGRAMAÇÃO › EQUIPES (Fase 7A): criar ou editar uma equipe. Responsável com login (recebe as OS e as preventivas);
// membros do Efetivo e usuários da empresa. Uma pessoa fica em uma equipe só: trazer alguém tira da outra equipe.

export const TEAM_TYPES = ['Preventiva mensal / vistoria', 'Preventiva semestral', 'Corretiva', 'Layout / instalação', 'Oficina', 'Engenharia / gestão'];
export const teamLabel = (t: UsualTeam) => t.name || 'Equipe sem nome';
const MAX_MEMBERS = 60;

interface Props {
  team: UsualTeam | null; // null = nova equipe
  teams: UsualTeam[]; // todas as equipes da gerência
  people: UnitPersonInfo[]; // pessoas da empresa escolhida
  companyName: string;
  stamp: (t: UsualTeam) => UsualTeam; // completa gerência, empresa, data e quem salvou
  nextOrder: number;
  onSave: (save: UsualTeam[], remove: string[]) => Promise<boolean>;
  onClose: () => void;
}

export default function TeamForm({ team, teams, people, companyName, stamp, nextOrder, onSave, onClose }: Props) {
  const [name, setName] = useState(team?.name || '');
  const [type, setType] = useState(team?.type || '');
  const [resp, setResp] = useState(team?.matricula || '');
  const [members, setMembers] = useState<OrderParticipant[]>(team?.members || []);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [tries, setTries] = useState(0);
  const errorRef = useRef<HTMLParagraphElement>(null);
  // Só o meio da janela rola: ao salvar com erro, leva até a mensagem (fica no fim do formulário)
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [error, tries]);
  const [askDelete, setAskDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  const others = teams.filter((t) => t.matricula !== team?.matricula);
  // Onde a pessoa está hoje (fora desta equipe)
  const placeOf = (mat: string): { team: UsualTeam; resp: boolean } | null => {
    const r = others.find((t) => t.matricula === mat);
    if (r) return { team: r, resp: true };
    const m = others.find((t) => t.members.some((x) => x.matricula === mat));
    return m ? { team: m, resp: false } : null;
  };
  const logins = people.filter((p) => p.login).sort((a, b) => Number(b.perfil === 'Profissional') - Number(a.perfil === 'Profissional') || a.name.localeCompare(b.name));
  if (team && !logins.some((p) => p.matricula === team.matricula)) logins.unshift({ matricula: team.matricula, name: team.respName || team.matricula, cargo: '', companies: [], login: true });

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const taken = new Set([resp, ...members.map((m) => m.matricula)]);
    return people.filter((p) => !taken.has(p.matricula) && `${p.name} ${p.matricula}`.toLowerCase().includes(q)).slice(0, 8);
  }, [people, search, members, resp]);

  const submit = async () => {
    setError('');
    setTries((n) => n + 1);
    if (!name.trim()) return setError('Dê um nome para a equipe.');
    if (!resp) return setError('Escolha o responsável.');
    if (search.trim()) return setError('Escolha a pessoa na lista da busca (ou apague o texto) antes de salvar.');
    const list = members.filter((m) => m.matricula !== resp);
    if (list.length > MAX_MEMBERS) return setError(`No máximo ${MAX_MEMBERS} pessoas por equipe.`);
    const moved = new Set([resp, ...list.map((m) => m.matricula)]);
    // Outras equipes que perdem gente (quem veio de lá sai de lá na mesma gravação)
    const touched = others.filter((t) => t.members.some((m) => moved.has(m.matricula))).map((t) => stamp({ ...t, members: t.members.filter((m) => !moved.has(m.matricula)) }));
    const mine = stamp({
      matricula: resp,
      unit: team?.unit || '',
      members: list,
      name: name.trim(),
      type: type.trim(),
      company: team?.company,
      order: team?.order ?? nextOrder,
      respName: logins.find((p) => p.matricula === resp)?.name || team?.respName,
      updatedAt: '',
      updatedBy: ''
    });
    setSaving(true);
    const ok = await onSave([mine, ...touched], team && team.matricula !== resp ? [team.matricula] : []);
    setSaving(false);
    if (ok) onClose();
  };

  const remove = async () => {
    if (!team) return;
    setSaving(true);
    const ok = await onSave([], [team.matricula]);
    setSaving(false);
    if (ok) onClose();
  };

  const input = 'w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold';
  const respPlace = resp ? placeOf(resp) : null;
  return (
    <div className="fixed inset-0 z-[1400] bg-slate-900/60 flex items-center justify-center p-3">
      <div className="w-full max-w-3xl max-h-full flex flex-col rounded-2xl bg-white dark:bg-[#0b1220] border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden" style={{ borderTop: '4px solid #4f46e5' }}>
        <div className="shrink-0 px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black text-slate-900 dark:text-white">{team ? `Editar equipe — ${teamLabel(team)}` : 'Nova equipe'}</p>
            <p className="text-[11px] text-slate-500">{companyName} · é a equipe habitual do responsável: entra sozinha nas OS e preventivas dele.</p>
          </div>
          <button type="button" onClick={onClose} className="h-8 w-8 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center cursor-pointer" title="Fechar">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4 text-xs">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block font-black text-slate-800 dark:text-slate-200 mb-1">Nome da equipe</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: PREVENTIVA 02" maxLength={60} className={input} />
            </label>
            <label className="block">
              <span className="block font-black text-slate-800 dark:text-slate-200 mb-1">Tipo de serviço (sai no PDF)</span>
              <input value={type} onChange={(e) => setType(e.target.value)} placeholder="Ex.: Preventiva mensal / vistoria" maxLength={80} className={input} />
            </label>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TEAM_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className="px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-300 cursor-pointer hover:bg-indigo-50"
              >
                {t}
              </button>
            ))}
          </div>

          <label className="block">
            <span className="block font-black text-slate-800 dark:text-slate-200 mb-1">
              Responsável <span className="font-medium text-slate-500">(precisa ter login: recebe as OS e as preventivas)</span>
            </span>
            <select value={resp} onChange={(e) => setResp(e.target.value)} className={input}>
              <option value="">Escolha...</option>
              {logins.map((p) => {
                const place = placeOf(p.matricula);
                return (
                  <option key={p.matricula} value={p.matricula} disabled={!!place?.resp}>
                    {p.name} · {p.matricula}
                    {p.perfil === 'Profissional' ? ' · técnico' : p.cargo ? ` · ${p.cargo}` : ''}
                    {place ? (place.resp ? ` — já é responsável da ${teamLabel(place.team)}` : ` — hoje na ${teamLabel(place.team)} (sai de lá)`) : ''}
                  </option>
                );
              })}
            </select>
            {respPlace && !respPlace.resp && <span className="block mt-1 text-[11px] font-bold text-amber-700">Ao salvar, sai da {teamLabel(respPlace.team)}.</span>}
          </label>

          <div>
            <p className="font-black text-slate-800 dark:text-slate-200 mb-1">
              Membros <span className="font-medium text-slate-500">(usuários e Efetivo da {companyName}; sem login entram só para compor a equipe e os cálculos)</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {members.length === 0 && <span className="text-[11px] text-slate-400">Nenhuma pessoa ainda.</span>}
              {members.map((m) => (
                <span
                  key={m.matricula}
                  className="px-2.5 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 font-bold flex items-center gap-1"
                >
                  {m.name}
                  {m.cargo ? <span className="font-medium">· {m.cargo}</span> : null}
                  <button type="button" onClick={() => setMembers(members.filter((x) => x.matricula !== m.matricula))} className="cursor-pointer" title="Tirar">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ))}
            </div>
            <label className="relative block mt-2">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Adicionar pessoa: nome ou matrícula..." className={`${input} pl-8 font-semibold`} />
            </label>
            {results.length > 0 && (
              <div className="mt-1.5 space-y-1">
                {results.map((p) => {
                  const place = placeOf(p.matricula);
                  return (
                    <div
                      key={p.matricula}
                      className={`p-2 rounded-lg border flex items-center justify-between gap-2 ${place ? 'border-amber-200 bg-amber-50 dark:bg-amber-950/30' : 'border-slate-200 dark:border-slate-700'}`}
                    >
                      <span>
                        <b>{p.name}</b> · {p.matricula}
                        {p.cargo ? ` · ${p.cargo}` : ''}
                        {place ? <span className="text-amber-800 font-bold"> · hoje na {teamLabel(place.team)}</span> : <span className="text-slate-500"> · sem equipe</span>}
                      </span>
                      {place?.resp ? (
                        <span className="text-[11px] font-bold text-slate-400">responsável de lá</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setMembers([...members, { matricula: p.matricula, name: p.name, cargo: p.cargo }]);
                            setSearch('');
                          }}
                          className="text-indigo-700 font-black cursor-pointer"
                        >
                          {place ? `trazer (sai da ${teamLabel(place.team)})` : 'pôr na equipe'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {search.trim() && results.length === 0 && <p className="text-[11px] font-bold text-rose-600 mt-1">Ninguém encontrado com "{search.trim()}".</p>}
          </div>

          <p className="text-[11px] text-slate-500">
            Uma pessoa fica em <b>uma equipe só</b>. Trocar alguém aqui muda a equipe de agora em diante. Na OS ou na preventiva o técnico ainda pode tirar ou colocar gente.
          </p>
          {error && (
            <p ref={errorRef} className="text-xs font-bold text-rose-600">
              {error}
            </p>
          )}
        </div>

        <div className="shrink-0 px-5 py-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap justify-between gap-2">
          {team ? (
            askDelete ? (
              <span className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-rose-600">Excluir a equipe? As pessoas ficam sem equipe.</span>
                <button type="button" onClick={remove} disabled={saving} className="px-3 py-2 rounded-xl bg-rose-600 text-white text-xs font-black cursor-pointer disabled:opacity-50">
                  Excluir
                </button>
                <button type="button" onClick={() => setAskDelete(false)} className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold cursor-pointer">
                  Não
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setAskDelete(true)} className="px-4 py-2.5 rounded-xl border border-rose-200 text-rose-600 text-sm font-bold flex items-center gap-1 cursor-pointer">
                <Trash2 className="w-4 h-4" />
                Excluir equipe
              </button>
            )
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-bold cursor-pointer">
              Cancelar
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-black cursor-pointer disabled:opacity-50"
            >
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
