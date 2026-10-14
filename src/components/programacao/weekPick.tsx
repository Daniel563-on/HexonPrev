import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Moon } from 'lucide-react';
import { Absence, Company, PlanningLot, UsualTeam, WeekPlan } from '../../types';
import { dbGetWeekPlan, dbListAbsences, dbListWeekLots, UnitPersonInfo } from '../../db/firebase';
import { DAY_LABEL, isoWeek } from './weekDates';

// PEDAÇOS COMUNS das janelas que programam fora da grade (Fase 7E): "Programar" da lista de preventivas (7E-1) e
// "Atribuir técnico" do chamado com dia e pernoite (7E-2). A semana escolhida, os técnicos da empresa, quem vai junto
// (equipe da semana sem ausentes), os dias (clique no 1º e no último) e as noites fora × pessoas.

export const brDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
export const dayName = (days: string[], d: string) => `${DAY_LABEL[days.indexOf(d)]?.toLowerCase() || ''} ${brDay(d)}`.trim();
export const dayTxt = (days: string[], a: string, b: string) => (a === b ? dayName(days, a) : `${dayName(days, a)} a ${dayName(days, b)}`);

// Semana da Programação daquela gerência + empresa: dias marcados e equipe da semana, ausências e blocos (3 leituras)
export function useWeekData(unit: string, company: string, weekStart: string) {
  const [plan, setPlan] = useState<WeekPlan | null>(null);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [lots, setLots] = useState<PlanningLot[]>([]);
  useEffect(() => {
    if (!unit || !company || !weekStart) return;
    let alive = true;
    Promise.all([dbGetWeekPlan(unit, company, weekStart), dbListAbsences(unit, weekStart), dbListWeekLots(unit, weekStart)])
      .then(([pl, ab, lt]) => {
        if (!alive) return;
        setPlan(pl);
        setAbsences(ab);
        setLots(lt);
      })
      .catch(() => {
        if (!alive) return;
        setPlan(null);
        setAbsences([]);
        setLots([]);
      });
    return () => {
      alive = false;
    };
  }, [unit, company, weekStart]);
  return { plan, absences, lots };
}

export interface TechOption {
  matricula: string;
  name: string;
  team: UsualTeam | null; // responsável de equipe (★)
}
// Técnicos com login da empresa; responsáveis de equipe primeiro
export function techOptions(people: UnitPersonInfo[], teams: UsualTeam[], company: string): TechOption[] {
  const personOf = (mat: string) => people.find((p) => p.matricula === mat);
  const myTeams = teams.filter((t) => (t.company ? t.company === company : (personOf(t.matricula)?.companies || []).includes(company)) && personOf(t.matricula)?.perfil === 'Profissional');
  const techs = people.filter((p) => p.login && p.perfil === 'Profissional' && p.companies.includes(company));
  return [
    ...myTeams.map((t) => ({ matricula: t.matricula, name: personOf(t.matricula)?.name || t.respName || t.matricula, team: t })),
    ...techs.filter((p) => !myTeams.some((t) => t.matricula === p.matricula)).map((p) => ({ matricula: p.matricula, name: p.name, team: null }))
  ];
}

// Quem vai com ele nesses dias: equipe desta semana (ou a cadastrada); ausente em algum dia sai da conta
export function crewOf(chosen: TechOption | undefined, plan: WeekPlan | null, absences: Absence[], company: string, range: string[]) {
  if (!chosen) return { total: 0, here: 0 };
  const myAbs = absences.filter((a) => a.company === company);
  const absentIn = (mat: string) => range.some((d) => myAbs.some((a) => a.matricula === mat && a.from <= d && a.to >= d));
  const crew = [chosen.matricula, ...(chosen.team ? plan?.teams?.[chosen.team.matricula] ?? chosen.team.members : []).map((m) => m.matricula)];
  return { total: crew.length, here: crew.filter((m) => !absentIn(m)).length };
}

const chipCls = (on: boolean, off: boolean) =>
  `px-2.5 py-1.5 rounded-lg border text-[11px] font-bold ${off ? 'border-slate-100 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 text-slate-300 dark:text-slate-600 cursor-not-allowed' : on ? 'border-indigo-500 bg-indigo-600 text-white cursor-pointer' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer'}`;

// Semana ◀ ▶ e os 7 dias: clique no 1º e no último
export function DaysPicker(props: {
  weekStart: string;
  days: string[];
  range: string[];
  anchor: string | null;
  canPrev: boolean;
  canNext: boolean;
  onWeek: (n: number) => void;
  usable: (d: string) => boolean;
  offTitle: (d: string) => string;
  onPick: (d: string) => void;
}) {
  const { weekStart, days, range, anchor, canPrev, canNext, onWeek, usable, offTitle, onPick } = props;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-black text-slate-700 dark:text-slate-200">Dias</span>
        <span className="flex items-center gap-1 text-[11px] font-bold text-slate-600 dark:text-slate-300">
          <button type="button" onClick={() => onWeek(-1)} disabled={!canPrev} className="h-7 w-7 rounded-md border border-slate-200 dark:border-slate-700 flex items-center justify-center cursor-pointer disabled:opacity-30" title="Semana anterior">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="px-2">
            Semana {isoWeek(weekStart)} · {brDay(days[0])} a {brDay(days[6])}
          </span>
          <button type="button" onClick={() => onWeek(1)} disabled={!canNext} className="h-7 w-7 rounded-md border border-slate-200 dark:border-slate-700 flex items-center justify-center cursor-pointer disabled:opacity-30" title="Próxima semana">
            <ChevronRight className="w-4 h-4" />
          </button>
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {days.map((d, i) => {
          const off = !usable(d);
          return (
            <button key={d} type="button" disabled={off} onClick={() => onPick(d)} className={chipCls(range.includes(d), off)} title={off ? offTitle(d) : undefined}>
              {DAY_LABEL[i]} {brDay(d)}
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-slate-500 mt-1">
        {anchor ? 'Agora clique no último dia (ou no mesmo dia para um dia só).' : 'Clique no 1º e no último dia. Sábado e domingo: liberados para caso especial, com confirmação.'}
      </p>
    </div>
  );
}

// "Dormem fora?": noites escolhidas (todas menos a volta) × pessoas (equipe da semana, ajustável)
export function NightsBox(props: {
  company: Company;
  days: string[];
  range: string[];
  sleep: boolean;
  setSleep: (on: boolean) => void;
  nights: string[];
  setNights: (fn: (prev: string[]) => string[]) => void;
  peopleTxt: string;
  setPeopleTxt: (v: string) => void;
  crew: { total: number; here: number };
  hasTech: boolean;
  shareText: string; // "entre as 5 preventivas (e os chamados que entrarem neste bloco)"
}) {
  const { company, days, range, sleep, setSleep, nights, setNights, peopleTxt, setPeopleTxt, crew, hasTech, shareText } = props;
  const possible = range.slice(0, -1);
  const used = sleep ? nights.filter((n) => possible.includes(n)) : [];
  const peopleN = Number(peopleTxt || crew.here);
  if (!company.costTracking) return <p className="text-[11px] text-slate-500">A {company.name} não contabiliza pernoite.</p>;
  if (range.length < 2) return <p className="text-[11px] text-slate-500">{range.length === 1 ? 'Um dia só: sem pernoite.' : 'Com 2 dias ou mais, dá para informar as noites fora.'}</p>;
  const last = range[range.length - 1];
  return (
    <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
      <p className="text-xs font-black text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
        <Moon className="w-4 h-4 text-sky-600" />
        Dormem fora?
      </p>
      <div className="flex gap-1.5 text-xs font-black">
        <button type="button" onClick={() => setSleep(false)} className={`px-3 py-1.5 rounded-lg border cursor-pointer ${!sleep ? 'bg-slate-700 border-slate-700 text-white' : 'border-slate-200 dark:border-slate-700 text-slate-600'}`}>
          Não
        </button>
        <button
          type="button"
          onClick={() => {
            setSleep(true);
            if (nights.length === 0) setNights(() => possible);
          }}
          className={`px-3 py-1.5 rounded-lg border cursor-pointer ${sleep ? 'bg-sky-600 border-sky-600 text-white' : 'border-slate-200 dark:border-slate-700 text-slate-600'}`}
        >
          Sim
        </button>
      </div>
      {sleep && (
        <>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="font-bold text-slate-600 dark:text-slate-300">Noites fora:</span>
            {possible.map((d) => {
              const on = nights.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setNights((p) => (on ? p.filter((x) => x !== d) : [...p, d]))}
                  className={`px-2 py-1 rounded-md border font-bold cursor-pointer ${on ? 'bg-sky-600 border-sky-600 text-white' : 'border-slate-200 dark:border-slate-700 text-slate-500'}`}
                >
                  {dayName(days, d)}
                </button>
              );
            })}
            <span className="px-2 py-1 rounded-md border border-dashed border-slate-200 dark:border-slate-700 text-slate-400 font-bold">{dayName(days, last)} (volta)</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="font-bold text-slate-600 dark:text-slate-300">Pessoas:</span>
            <input
              value={peopleTxt}
              onChange={(ev) => setPeopleTxt(ev.target.value.replace(/\D/g, '').slice(0, 2))}
              placeholder={String(crew.here)}
              className="w-14 h-7 px-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-black"
              aria-label="Pessoas que dormem fora"
            />
            <span className="text-slate-500">{hasTech ? `(${crew.here} da equipe da semana${crew.total > crew.here ? `, sem ${crew.total - crew.here} ausente(s)` : ''})` : '(escolha o técnico)'}</span>
          </div>
          {used.length > 0 && (
            <p className="text-[11px] text-slate-700 dark:text-slate-200">
              <b>
                {used.length} noite{used.length > 1 ? 's' : ''} × {peopleN} pessoa{peopleN > 1 ? 's' : ''} = {used.length * peopleN} pernoites
              </b>
              , divididos {shareText}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
