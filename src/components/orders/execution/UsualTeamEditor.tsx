import React, { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { UsualTeam } from '../../../types';
import { dbGetUsualTeam } from '../../../db/firebase';

// EQUIPE HABITUAL DO TÉCNICO, só para ver (Fase 7A): quem monta a equipe é o planejador, em Programação › Equipes.
// O técnico herda a equipe; na OS ou na preventiva ele ainda pode tirar ou colocar gente.
// Aparece no Meu Perfil do celular (compact) e no Planejamento do PMOC.

interface Props {
  matricula: string; // técnico dono da equipe
  techName: string;
  unit: string;
  editorName?: string; // não usado desde a Fase 7A (a equipe é editada na Programação)
  onClose?: () => void;
  compact?: boolean; // perfil do técnico: título discreto (a seção já se chama "Equipe")
}

export default function UsualTeamEditor({ matricula, techName, onClose, compact }: Props) {
  const [team, setTeam] = useState<UsualTeam | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    dbGetUsualTeam(matricula).then((t) => {
      setTeam(t);
      setLoading(false);
    });
  }, [matricula]);

  return (
    <div className="space-y-3">
      {compact ? (
        <div>
          <p className="text-xs font-bold">Minha equipe{team?.name ? ` — ${team.name}` : ''}</p>
          {team?.type && <p className="text-[11px] text-slate-500">{team.type}</p>}
        </div>
      ) : (
        <div>
          <p className="text-sm font-black text-slate-800">Equipe habitual — {techName}</p>
          {team?.name && (
            <p className="text-[11px] text-slate-500">
              {team.name}
              {team.type ? ` · ${team.type}` : ''}
            </p>
          )}
        </div>
      )}
      {loading ? (
        <p className="text-xs text-slate-400">Carregando...</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {(team?.members || []).length === 0 && <span className="text-[11px] text-slate-400">{team ? 'Nenhuma pessoa na equipe.' : 'Ainda sem equipe.'}</span>}
          {(team?.members || []).map((m) => (
            <span key={m.matricula} className="px-2.5 py-1 rounded-full bg-slate-50 border border-slate-200 text-[11px] font-bold text-slate-700">
              {m.name}
              {m.cargo ? <span className="font-medium text-slate-500"> · {m.cargo}</span> : null}
            </span>
          ))}
        </div>
      )}
      <p className="text-[11px] text-slate-500 flex items-start gap-1.5">
        <Lock className="w-3.5 h-3.5 shrink-0 mt-px" />
        <span>Definida pelo planejador em Programação › Equipes. Na OS ou na preventiva ainda dá para tirar ou colocar gente.</span>
      </p>
      {onClose && (
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg border border-slate-300 text-xs font-bold text-slate-600 cursor-pointer">
            Fechar
          </button>
        </div>
      )}
    </div>
  );
}
