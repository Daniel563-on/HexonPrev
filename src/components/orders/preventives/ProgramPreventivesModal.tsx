import React, { useState } from 'react';
import { AlertTriangle, Info, Star } from 'lucide-react';
import { BlockStop, Company, HexonUser, PlanningLot, ServiceOrder, UsualTeam } from '../../../types';
import { dbSaveBlock, localTodayStr, UnitPersonInfo } from '../../../db/firebase';
import { coversDay, fitsWindow, localKey, localLabel, lotPlace } from '../../programacao/blockLayout';
import { addDays, DAY_LABEL, isoWeek, mondayOf, weekDays } from '../../programacao/weekDates';
import { MARK_LABEL, Shell, btn, btnMain } from '../../programacao/WeekModals';
import { teamLabel } from '../../programacao/TeamForm';
import { brDay, crewOf, DaysPicker, dayTxt as dayTxtOf, NightsBox, techOptions, useWeekData } from '../../programacao/weekPick';

// PROGRAMAR PELA LISTA (Fase 7E-1): as preventivas marcadas em Ordens de Serviço › Preventivas viram um bloco da
// Programação (o mesmo da grade da semana): técnico, dias da semana dentro do prazo de todas, noites fora e pessoas.
// Depois dá para abrir e mudar o bloco na Programação.

interface Props {
  user: HexonUser;
  unit: string;
  company: Company;
  orders: ServiceOrder[]; // marcadas (todas "Novo", da mesma gerência e empresa)
  unitOrders: ServiceOrder[]; // preventivas da gerência (para mostrar o que o técnico já tem na semana)
  people: UnitPersonInfo[];
  teams: UsualTeam[];
  onDone: (msg: string) => void;
  onClose: () => void;
}

const MAX_STOPS = 20;
const br = brDay;
const rawLocal = (k: string) => {
  const i = k.indexOf('|');
  return { comarca: k.slice(0, i), address: k.slice(i + 1) };
};

export default function ProgramPreventivesModal({ user, unit, company, orders, unitOrders, people, teams, onDone, onClose }: Props) {
  const today = localTodayStr();
  // Dias que servem para todas as marcadas: dentro do prazo de cada uma (até o último dia) e de hoje em diante
  const lo = orders.reduce((m, o) => (o.startDate && o.startDate.slice(0, 10) > m ? o.startDate.slice(0, 10) : m), today);
  const hi = orders.reduce((m, o) => (o.endDate && (!m || o.endDate.slice(0, 10) < m) ? o.endDate.slice(0, 10) : m), '');
  const noCommon = !!hi && lo > hi;
  const firstWeek = mondayOf(new Date(`${lo}T12:00:00`));
  const lastWeek = hi ? mondayOf(new Date(`${hi}T12:00:00`)) : addDays(firstWeek, 7 * 8);

  const [weekStart, setWeekStart] = useState(firstWeek);
  const { plan, absences, lots } = useWeekData(unit, company.id, weekStart);
  const [tech, setTech] = useState('');
  const [s, setS] = useState('');
  const [e, setE] = useState('');
  const [anchor, setAnchor] = useState<string | null>(null);
  const [sleep, setSleep] = useState(false);
  const [nights, setNights] = useState<string[]>([]);
  const [peopleTxt, setPeopleTxt] = useState('');
  const [weekendOk, setWeekendOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const days = weekDays(weekStart);
  const goWeek = (n: number) => {
    setWeekStart(addDays(weekStart, 7 * n));
    setS('');
    setE('');
    setAnchor(null);
    setNights([]);
    setWeekendOk(false);
  };
  const usable = (d: string) => d >= lo && (!hi || d <= hi);

  // Técnicos da empresa; responsáveis de equipe primeiro (★)
  const options = techOptions(people, teams, company.id);
  const chosen = options.find((x) => x.matricula === tech);

  const range = s && e ? days.filter((d) => d >= s && d <= e) : [];
  const weekendIn = range.filter((d) => days.indexOf(d) >= 5);
  const marksIn = range.filter((d) => plan?.days?.[d]);
  const possibleNights = range.slice(0, -1);
  const usedNights = sleep ? nights.filter((n) => possibleNights.includes(n)).sort() : [];
  const crew = crewOf(chosen, plan, absences, company.id, range);
  const peopleN = Number(peopleTxt || crew.here);

  // O que o técnico já tem na semana
  const hisLots = chosen ? lots.filter((l) => l.technicianMatricula === chosen.matricula && !l.removedAt && (!l.company || l.company === company.id)) : [];
  // preventivas dele na semana fora desses blocos/lotes (programadas sozinhas)
  const hisPrevs = chosen
    ? unitOrders.filter(
        (o) => o.assignedTechnicianMatricula === chosen.matricula && ['Planejada', 'Em Execução', 'Atrasada'].includes(o.status) && days.some((d) => coversDay(o, d)) && !hisLots.some((l) => l.id === o.lotId)
      ).length
    : 0;
  const dayTxt = (a: string, b: string) => dayTxtOf(days, a, b);
  const clip = (l: PlanningLot) => dayTxt(l.periodStart < days[0] ? days[0] : l.periodStart, l.periodEnd > days[6] ? days[6] : l.periodEnd);

  const pickDay = (d: string) => {
    if (!usable(d)) return;
    setError('');
    if (!anchor) {
      setAnchor(d);
      setS(d);
      setE(d);
    } else {
      setS(anchor <= d ? anchor : d);
      setE(anchor <= d ? d : anchor);
      setAnchor(null);
    }
  };

  const keys = Array.from(new Set<string>(orders.map(localKey)));
  const save = async () => {
    setError('');
    if (noCommon) return setError('As preventivas marcadas não têm dia em comum dentro do prazo: programe em partes.');
    if (!chosen) return setError('Escolha o técnico responsável.');
    if (!s || !e) return setError('Escolha os dias (clique no 1º e no último).');
    if (s < today) return setError('Não dá para programar em dia que já passou.');
    const misfit = orders.filter((o) => !fitsWindow(o, s, e));
    if (misfit.length > 0) return setError(`${misfit.length} preventiva(s) não cabem no prazo com esses dias.`);
    if (weekendIn.length > 0 && !weekendOk) return setError('Confirme o trabalho no fim de semana.');
    if (keys.length > MAX_STOPS) return setError(`São ${keys.length} locais: no máximo ${MAX_STOPS} por bloco. Programe em partes.`);
    if (usedNights.length > 0 && (!Number.isInteger(peopleN) || peopleN < 1)) return setError('Informe quantas pessoas dormem fora (número inteiro a partir de 1).');
    const stops: BlockStop[] = keys.map((k) => ({ ...rawLocal(k), from: s, to: e, pdfText: '' }));
    const place = keys.length === 1 ? localLabel(rawLocal(keys[0])) : `${keys.length} locais`;
    const label = chosen.team ? `${teamLabel(chosen.team)} (${chosen.name})` : chosen.name;
    const pern = usedNights.length ? `, ${usedNights.length} noite(s) × ${peopleN} pessoa(s)` : '';
    setSaving(true);
    try {
      await dbSaveBlock({
        lot: null,
        key: { unit, company: company.id, weekStart },
        technician: { name: chosen.name, matricula: chosen.matricula },
        periodStart: s,
        periodEnd: e,
        stops,
        note: '',
        nights: usedNights,
        people: usedNights.length ? peopleN : 0,
        plan: orders.map((o) => ({ item: o, s, e, where: localLabel(rawLocal(localKey(o))) })),
        fixedIds: [],
        drop: [],
        woPlan: [],
        woFixedIds: [],
        woDrop: [],
        by: user.name,
        logText: `Criou o bloco ${label} · ${place} (${dayTxt(s, e)}) pela lista de preventivas: ${orders.length} preventiva(s)${pern}`
      });
      onDone(`${orders.length} preventiva(s) programada(s) para ${chosen.name}, ${dayTxt(s, e)}${pern}. O bloco está na Programação da semana ${isoWeek(weekStart)}.`);
    } catch (err: any) {
      setSaving(false);
      setError(err?.code === 'permission-denied' ? 'O banco recusou: seu perfil não pode programar nesta gerência.' : `Não foi possível programar: ${err?.message || err}`);
    }
  };

  return (
    <Shell
      title={`Programar ${orders.length} preventiva${orders.length > 1 ? 's' : ''} — ${keys.length === 1 ? localLabel(rawLocal(keys[0])) : `${keys.length} locais`}`}
      sub={`${unit} · ${company.name} · cria o mesmo bloco que a Programação cria na grade da semana (dá para abrir e mudar por lá).`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="button" className={btnMain} onClick={save} disabled={saving || noCommon}>
            {saving ? 'Programando…' : `Programar ${orders.length} preventiva${orders.length > 1 ? 's' : ''}`}
          </button>
        </>
      }
    >
      {noCommon && (
        <p className="p-2.5 rounded-lg border border-rose-200 bg-rose-50 text-[11px] font-bold text-rose-800">
          As preventivas marcadas não têm dia em comum dentro do prazo (prazos diferentes). Desmarque algumas e programe em partes.
        </p>
      )}
      <label className="block">
        <span className="block text-[11px] font-black text-slate-700 dark:text-slate-200 mb-1">Técnico responsável</span>
        <select value={tech} onChange={(ev) => setTech(ev.target.value)} className="w-full h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold">
          <option value="">Escolha o técnico...</option>
          {options.map((x) => (
            <option key={x.matricula} value={x.matricula}>
              {x.team ? `★ ${x.name} — ${teamLabel(x.team)}` : x.name} ({x.matricula})
            </option>
          ))}
        </select>
        {options.length === 0 && <span className="block mt-1 text-[11px] font-bold text-amber-700">Nenhum técnico da {company.name} nesta gerência.</span>}
        {chosen && (
          <span className="block mt-1 text-[10px] text-slate-500">
            Na semana {isoWeek(weekStart)} ele já tem:{' '}
            {hisLots.length === 0 && hisPrevs === 0
              ? 'nada programado.'
              : [
                  ...hisLots.map((l) => (l.source === 'programacao' ? `bloco em ${lotPlace(l)} (${clip(l)})` : `lote do PMOC (${clip(l)})`)),
                  hisPrevs ? `${hisPrevs} preventiva(s) programada(s) sem bloco` : ''
                ]
                  .filter(Boolean)
                  .join(' · ')}
            {!chosen.team && ' Não é responsável de equipe: na Programação aparece em "Fora das equipes".'}
          </span>
        )}
      </label>

      <DaysPicker
        weekStart={weekStart}
        days={days}
        range={range}
        anchor={anchor}
        canPrev={weekStart > firstWeek}
        canNext={weekStart < lastWeek}
        onWeek={goWeek}
        usable={usable}
        offTitle={(d) => (d < today ? 'Dia que já passou' : 'Fora do prazo das preventivas marcadas')}
        onPick={pickDay}
      />

      <p className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-[11px] font-bold text-emerald-800 dark:text-emerald-300">
        Prazo das preventivas marcadas: {hi ? `dá para programar de ${br(lo)} até ${br(hi)}` : `a partir de ${br(lo)}`} (até o último dia do prazo).
      </p>

      {marksIn.length > 0 && (
        <p className="text-[11px] font-bold text-amber-700">
          {marksIn.map((d) => `${DAY_LABEL[days.indexOf(d)]} ${br(d)}: ${MARK_LABEL[plan!.days![d].kind]}${plan!.days![d].text ? ` (${plan!.days![d].text})` : ''}`).join(' · ')} — não bloqueia.
        </p>
      )}
      {weekendIn.length > 0 && (
        <label className="flex items-center gap-2 p-2.5 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 text-[11px] font-bold text-amber-900 dark:text-amber-200 cursor-pointer">
          <input type="checkbox" checked={weekendOk} onChange={(ev) => setWeekendOk(ev.target.checked)} className="w-4 h-4" />
          <AlertTriangle className="w-4 h-4" />
          Confirmo o trabalho no fim de semana ({weekendIn.map((d) => `${DAY_LABEL[days.indexOf(d)]} ${br(d)}`).join(', ')}).
        </label>
      )}

      <NightsBox
        company={company}
        days={days}
        range={range}
        sleep={sleep}
        setSleep={setSleep}
        nights={nights}
        setNights={setNights}
        peopleTxt={peopleTxt}
        setPeopleTxt={setPeopleTxt}
        crew={crew}
        hasTech={!!chosen}
        shareText={`entre as ${orders.length} preventivas (e os chamados que entrarem neste bloco)`}
      />

      <div className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900 text-[11px] text-indigo-900 dark:text-indigo-200 flex gap-2">
        <Info className="w-4 h-4 shrink-0" />
        <span>
          Depois de programar: as {orders.length} ficam <b>Planejadas</b>
          {chosen ? ` com ${chosen.name}` : ''}
          {s && e ? ` (${dayTxt(s, e)})` : ''}, aparecem na <b>Programação da semana {isoWeek(weekStart)}</b>
          {chosen?.team ? ` na linha da ${teamLabel(chosen.team)}` : ''} (bloco normal, entra no PDF) e no celular do técnico como hoje.
          {keys.length > 1 && ` São ${keys.length} locais no mesmo bloco, todos nesses dias.`}
        </span>
      </div>
      {chosen?.team && (
        <p className="text-[10px] text-slate-500 flex items-center gap-1">
          <Star className="w-3 h-3 text-amber-500 fill-amber-400" /> = responsável de equipe (Programação › Equipes).
        </p>
      )}
      {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
    </Shell>
  );
}
