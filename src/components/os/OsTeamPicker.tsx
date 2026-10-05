import React, { useEffect, useMemo, useState } from 'react';
import { Search, UserPlus, X } from 'lucide-react';
import { OrderParticipant } from '../../types';
import { dbGetUnitPeople, dbGetUsualTeam } from '../../db/firebase';

// EQUIPE DA OS (técnico em campo): o técnico atribuído entra sempre; a equipe que o Encarregado deixou pronta
// aparece como atalho (um toque adiciona) e qualquer pessoa ativa da gerência pode ser buscada por nome ou matrícula.
// Contam no homem-hora, na hora extra e no pernoite só as pessoas adicionadas aqui.

interface Props {
  unit: string;
  executor: OrderParticipant;
  team: OrderParticipant[]; // inclui o executor
  editable: boolean;
  onChange: (team: OrderParticipant[]) => void;
}

export default function OsTeamPicker({ unit, executor, team, editable, onChange }: Props) {
  const [people, setPeople] = useState<OrderParticipant[]>([]);
  const [usual, setUsual] = useState<OrderParticipant[]>([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!editable) return;
    dbGetUnitPeople(unit).then(setPeople);
    dbGetUsualTeam(executor.matricula).then((t) => setUsual((t?.members || []).filter((m) => m.matricula !== executor.matricula)));
  }, [editable, unit, executor.matricula]);

  const taken = useMemo(() => new Set(team.map((p) => p.matricula)), [team]);
  const quick = usual.filter((p) => !taken.has(p.matricula));
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return people.filter((p) => !taken.has(p.matricula) && `${p.name} ${p.matricula}`.toLowerCase().includes(t)).slice(0, 12);
  }, [people, q, taken]);

  const add = (p: OrderParticipant) => {
    setQ('');
    onChange([...team, p]);
  };
  const card = (p: OrderParticipant, onClick: () => void) => (
    <button
      key={p.matricula}
      type="button"
      onClick={onClick}
      className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-left hover:border-indigo-300 hover:bg-indigo-50 cursor-pointer"
    >
      <span className="block text-[11px] font-black text-slate-800 uppercase leading-tight">{p.name}</span>
      <span className="block text-[10px] text-slate-500">{p.cargo || 'sem cargo'} • Mat. {p.matricula}</span>
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {team.map((p) => (
          <span key={p.matricula} className={`px-2.5 py-1 rounded-full border text-[11px] font-bold flex items-center gap-1 ${p.matricula === executor.matricula ? 'bg-indigo-50 border-indigo-200 text-indigo-800' : 'bg-slate-50 border-slate-200 text-slate-700'}`}>
            {p.name}
            {p.cargo && <span className="font-normal text-slate-500">· {p.cargo}</span>}
            {p.matricula === executor.matricula ? (
              <span className="font-normal">(você)</span>
            ) : (
              editable && (
                <button type="button" onClick={() => onChange(team.filter((x) => x.matricula !== p.matricula))} className="text-rose-500 cursor-pointer" title="Tirar da OS">
                  <X className="w-3 h-3" />
                </button>
              )
            )}
          </span>
        ))}
      </div>

      {editable && quick.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1"><UserPlus className="w-3 h-3" /> Sua equipe (toque para adicionar quem está com você)</p>
          <div className="flex flex-wrap gap-2">{quick.map((p) => card(p, () => add(p)))}</div>
        </div>
      )}

      {editable && (
        <div className="space-y-1.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Pesquisar colaborador (nome ou matrícula)..."
              className="w-full h-10 pl-9 pr-3 text-xs border border-slate-200 rounded-xl bg-white"
            />
          </div>
          {results.length > 0 && <div className="flex flex-wrap gap-2">{results.map((p) => card(p, () => add(p)))}</div>}
          {q.trim() && results.length === 0 && <p className="text-[11px] font-bold text-rose-600">Ninguém encontrado na {unit} com "{q.trim()}".</p>}
        </div>
      )}
    </div>
  );
}
