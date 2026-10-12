import React, { useEffect, useMemo, useState } from 'react';
import { Company, ServiceOrder, WorkOrder } from '../../types';
import { onSyncChange, syncedList } from '../../db/localSync';
import { subscribeTeamWorkOrders } from '../../db/homeTeam';
import { homeCard, homeTitle } from './HomeNeeds';

// INÍCIO › EQUIPE AGORA: o que cada técnico da gerência tem com ele — preventivas para executar (atribuídas e ainda
// não feitas: Planejada, Atrasada ou Em Execução, deste mês e de antes), chamados em andamento e pendentes.
// Não mostra "em preventiva agora" (a preventiva dura minutos; o número mudaria o tempo todo). Técnicos: cópia guardada
// no aparelho (0 leitura); preventivas: o que o app já carrega; chamados: escuta só dos "Em andamento" e "Pendente".

const SHOW = 12;
const TO_DO = ['Planejada', 'Atrasada', 'Em Execução'];

interface Tech {
  matricula: string;
  name: string;
  companies: string[];
}

const pl = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function HomeTeam(props: {
  units: string[];
  cos: string[] | null;
  orders: ServiceOrder[];
  companies: Company[];
  onOpenOs: (matricula: string) => void;
  onOpenPreventives: (name: string) => void;
}) {
  const { units, cos, orders, companies } = props;
  const unitsKey = units.join('|');
  const cosKey = cos === null ? '*' : cos.join(',');
  const [techs, setTechs] = useState<Tech[] | null>(null);
  const [calls, setCalls] = useState<WorkOrder[]>([]);
  const [all, setAll] = useState(false);
  // Técnicos ativos das gerências (cópia no aparelho; cadastro novo ou alterado chega sozinho)
  useEffect(() => {
    let alive = true;
    const load = () =>
      Promise.all(units.map((u) => syncedList<any>('users', u, [['gerencia', u]])))
        .then((lists) => {
          if (!alive) return;
          const byMat = new Map<string, Tech>();
          lists.flat().forEach((x) => {
            if (x.perfil !== 'Profissional' || x.status !== 'Ativo' || !x.matricula) return;
            const cs: string[] = Array.isArray(x.companies) ? x.companies : [];
            if (cos && !cs.some((c) => cos.includes(c))) return;
            byMat.set(String(x.matricula), { matricula: String(x.matricula), name: x.name || String(x.matricula), companies: cs });
          });
          setTechs(Array.from(byMat.values()));
        })
        .catch(() => alive && setTechs([]));
    load();
    return onSyncChange((col) => {
      if (col === 'users') load();
    });
  }, [unitsKey, cosKey]);

  // Chamados em andamento e pendentes das gerências (escuta em tempo real: só esses chamados)
  useEffect(() => {
    return subscribeTeamWorkOrders(units, setCalls);
  }, [unitsKey]);

  const rows = useMemo(() => {
    if (!techs) return null;
    const d = new Date();
    const end = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-31`;
    const toDo = orders.filter((o) => TO_DO.includes(o.status) && (o.startDate || o.scheduledDate || o.endDate || '') <= end);
    return techs
      .map((t) => {
        const prevs = toDo.filter((o) => o.assignedTechnicianMatricula === t.matricula || (!o.assignedTechnicianMatricula && o.assignedTechnician === t.name));
        const late = prevs.filter((o) => o.status === 'Atrasada').length;
        const mine = calls.filter((o) => o.assignedTechnicianMatricula === t.matricula);
        const andamento = mine.filter((o) => o.status === 'Em andamento').length;
        const pend = mine.filter((o) => o.status === 'Pendente').length;
        return { t, prevs: prevs.length, late, andamento, pend, load: prevs.length + andamento + pend };
      })
      .sort((a, b) => b.load - a.load || a.t.name.localeCompare(b.t.name));
  }, [techs, calls, orders]);
// CONTINUA NA PRÓXIMA PARTE (HomeTeam.tsx 4/7)
