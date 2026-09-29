import React, { useEffect, useMemo, useState } from 'react';
import { OrderParticipant } from '../../../types';
import { dbGetUnitPeople, dbGetUsualTeam, dbSaveUsualTeam } from '../../../db/firebase';

// EQUIPE HABITUAL DO TÉCNICO (Etapa 6.2): o próprio técnico ou o planejador incluem/tiram pessoas a qualquer momento.
// Ao iniciar uma OS, os participantes já vêm preenchidos com essa equipe (dá para mudar na OS).

interface Props {
  matricula: string;     // técnico dono da equipe
  techName: string;
  unit: string;
  editorName: string;    // quem está editando (fica registrado)
  onClose?: () => void;
}

export default function UsualTeamEditor({ matricula, techName, unit, editorName, onClose }: Props) {
  const [members, setMembers] = useState<OrderParticipant[]>([]);
  const [people, setPeople] = useState<OrderParticipant[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([dbGetUsualTeam(matricula), dbGetUnitPeople(unit)]).then(([team, list]) => {
      setMembers(team?.members || []);
      setPeople(list);
      setLoading(false);
    });
  }, [matricula, unit]);

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const taken = new Set([matricula, ...members.map((m) => m.matricula)]);
    return people.filter((p) => !taken.has(p.matricula) && `${p.name} ${p.matricula}`.toLowerCase().includes(q)).slice(0, 8);
  }, [people, search, members, matricula]);

  const save = async () => {
    // Texto digitado que não virou pessoa da lista: não salva (só entra quem for escolhido na lista)
    if (search.trim()) {
      setMsg({ ok: false, text: results.length > 0 ? 'Escolha a pessoa na lista abaixo da busca (ou apague o texto) antes de salvar.' : `"${search.trim()}" não foi encontrado na ${unit}. Apague o texto para salvar.` });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      await dbSaveUsualTeam({ matricula, unit, members, updatedAt: new Date().toISOString(), updatedBy: editorName });
      setMsg({ ok: true, text: 'Equipe habitual salva.' });
    } catch (err: any) {
      setMsg({ ok: false, text: `Não foi possível salvar: ${err?.message || err}` });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-black text-slate-800">Equipe habitual — {techName}</p>
        <p className="text-[11px] text-slate-500">Pessoas da {unit} que costumam executar com o técnico. Entram automaticamente como participantes ao iniciar uma OS.</p>
      </div>
      {loading ? (
        <p className="text-xs text-slate-400">Carregando...</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {members.length === 0 && <span className="text-[11px] text-slate-400">Nenhuma pessoa na equipe.</span>}
            {members.map((m) => (
              <span key={m.matricula} className="px-2.5 py-1 rounded-full bg-slate-50 border border-slate-200 text-[11px] font-bold text-slate-700 flex items-center gap-1">
                {m.name}
                <button type="button" onClick={() => setMembers(members.filter((x) => x.matricula !== m.matricula))} className="text-rose-500 cursor-pointer" title="Tirar">×</button>
              </span>
            ))}
          </div>
          <div className="relative">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Adicionar pessoa: nome ou matrícula..." className="h-9 px-3 text-xs border border-slate-200 rounded-lg bg-white font-semibold w-full" />
            {results.length > 0 && (
              <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                {results.map((p) => (
                  <button key={p.matricula} type="button" onClick={() => { setSearch(''); setMembers([...members, p]); }} className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 cursor-pointer">
                    <span className="font-bold text-slate-800">{p.name}</span>
                    <span className="text-slate-500"> • {p.matricula}{p.cargo ? ` • ${p.cargo}` : ''}</span>
                  </button>
                ))}
              </div>
            )}
            {search.trim() && results.length === 0 && (
              <p className="text-[11px] font-bold text-rose-600 mt-1">Nenhuma pessoa encontrada na {unit} com "{search.trim()}".</p>
            )}
            {people.length === 0 && <p className="text-[11px] text-amber-700 mt-1">Nenhuma pessoa ativa cadastrada na {unit} (usuários ou efetivo).</p>}
          </div>
          {msg &&<p className={`text-[11px] font-bold ${msg.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{msg.text}</p>}
          <div className="flex justify-end gap-2">
            {onClose && <button type="button" onClick={onClose} disabled={saving} className="h-9 px-4 rounded-lg border border-slate-300 text-xs font-bold text-slate-600 cursor-pointer">Fechar</button>}
            <button type="button" onClick={save} disabled={saving} className="h-9 px-4 rounded-lg bg-[#3525cd] text-white text-xs font-bold cursor-pointer disabled:opacity-50">
              {saving ? 'Salvando...' : 'Salvar equipe'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
