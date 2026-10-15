import React, { useEffect, useState } from 'react';
import { AlertTriangle, CalendarDays, Info } from 'lucide-react';
import { BlockStop, Company, HexonUser, PlanningLot, UsualTeam, WorkOrder } from '../../types';
import { dbAssignWorkOrder, dbGetCompanies, dbGetUnitPeopleInfo, dbListTeams, dbSaveBlock, localTodayStr, osTechStarted, UnitPersonInfo } from '../../db/firebase';
import { localLabel, lotPlace, lotStops } from '../programacao/blockLayout';
import { addDays, isoWeek, mondayOf, weekDays } from '../programacao/weekDates';
import { Shell, btn, btnMain } from '../programacao/WeekModals';
import { teamLabel } from '../programacao/TeamForm';
import { brDay, crewOf, DaysPicker, dayTxt as dayTxtOf, NightsBox, TechOption, useWeekData } from '../programacao/weekPick';
import TechTwoLists from './TechTwoLists';
import { LOCAL_TECH_UNIT, localTechOptions } from '../../lib/localTech';

// ATRIBUIR TÉCNICO DO CHAMADO (Fase 7E-2; etapa de junção: "Atribuir técnico" do Hexon principal + bloco da Programação).
// Quem também tem "Programar" pode informar o dia (opcional) e o pernoite: se o técnico já tem um bloco nesses dias, o
// chamado entra nele (o pernoite da viagem passa a ser dividido também com ele); senão vira um bloco só dele, com
// "Dormem fora?". Dias que já passaram valem (urgência: o técnico viajou sem estar programado), enquanto o chamado não
// foi concluído. O técnico não lança mais pernoite.

interface Props {
  order: WorkOrder;
  techs: HexonUser[]; // técnicos ativos da empresa do chamado (como antes)
  user: HexonUser;
  canProgram: boolean; // "Programar"
  onDone: (msg: string) => void;
  onClose: () => void;
}

export default function AssignWorkOrderModal({ order, techs, user, canProgram, onDone, onClose }: Props) {
  const today = localTodayStr();
  const opened = String(order.createdAt || '').slice(0, 10) || today;
  const firstWeek = mondayOf(new Date(`${opened}T12:00:00`));
  const lastWeek = addDays(mondayOf(new Date()), 7 * 8);
  const [tech, setTech] = useState(order.assignedTechnicianMatricula || '');
  const [withDay, setWithDay] = useState(false);
  const [weekStart, setWeekStart] = useState(mondayOf(new Date()));
  const [s, setS] = useState('');
  const [e, setE] = useState('');
  const [anchor, setAnchor] = useState<string | null>(null);
  const [join, setJoin] = useState<string>(''); // id do bloco escolhido ('' = bloco separado)
  const [joinTouched, setJoinTouched] = useState(false);
  const [sleep, setSleep] = useState(false);
  const [nights, setNights] = useState<string[]>([]);
  const [peopleTxt, setPeopleTxt] = useState('');
  const [weekendOk, setWeekendOk] = useState(false);
  const [company, setCompany] = useState<Company | null>(null);
  const [teams, setTeams] = useState<UsualTeam[]>([]);
  const [people, setPeople] = useState<UnitPersonInfo[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const inBlock = !!order.lotId || !!order.scheduledDate;
  const techChanged = tech !== (order.assignedTechnicianMatricula || '');
  // Técnicos da gerência e técnicos locais (Lote 2): para o técnico local só atribui (sem dia e sem pernoite)
  const unitTechs = techs.filter((x) => x.gerencia === order.unit);
  const localTechs = order.unit === LOCAL_TECH_UNIT ? [] : localTechOptions(techs.filter((x) => x.gerencia !== order.unit));
  const localChosen = !!tech && localTechs.some((x) => x.matricula === tech);
  // Chamado já com dia: mudar o dia é pela Programação; trocar o técnico tira do bloco (como antes) e aí pode programar
  const canDay = canProgram && !!order.company && (!inBlock || techChanged) && !localChosen;
  useEffect(() => {
    if (!canDay || !withDay) return;
    dbGetCompanies()
      .then((l) => setCompany(l.find((c) => c.id === order.company) || null))
      .catch(() => setCompany(null));
    dbListTeams(order.unit)
      .then(setTeams)
      .catch(() => setTeams([]));
    dbGetUnitPeopleInfo(order.unit)
      .then(setPeople)
      .catch(() => setPeople([]));
  }, [canDay, withDay]);
  const { plan, absences, lots } = useWeekData(canDay && withDay ? order.unit : '', order.company || '', weekStart);

  const days = weekDays(weekStart);
  const dayTxt = (a: string, b: string) => dayTxtOf(days, a, b);
  const range = s && e ? days.filter((d) => d >= s && d <= e) : [];
  const t = techs.find((x) => x.matricula === tech);
  const team = teams.find((x) => x.matricula === tech) || null;
  const chosen: TechOption | undefined = t ? { matricula: t.matricula, name: t.name, team } : undefined;
  const crew = crewOf(chosen, plan, absences, order.company || '', range);
  const peopleN = Number(peopleTxt || crew.here);
  const weekendIn = range.filter((d) => days.indexOf(d) >= 5);
  const afterDeadline = !!order.deadline && !!e && e > order.deadline.slice(0, 10);

  // Blocos do técnico nesses dias (mesma empresa): o chamado pode entrar num deles
  const candidates = chosen && s && e ? lots.filter((l) => l.source === 'programacao' && !l.removedAt && l.technicianMatricula === chosen.matricula && l.company === order.company && l.periodStart <= e && l.periodEnd >= s) : [];
  useEffect(() => {
    if (!joinTouched) setJoin(candidates[0]?.id || '');
  }, [candidates.map((l) => l.id).join('|')]);
  const joinLot = candidates.find((l) => l.id === join) || null;
  // Dias do chamado dentro do bloco: os do local da comarca dele; sem esse local, os dias escolhidos dentro do bloco
  const joinStop = (l: PlanningLot) => {
    const st = lotStops(l).find((x) => (x.comarca || '') === (order.comarca || ''));
    if (st) return { stop: st, add: false };
    const from = s > l.periodStart ? s : l.periodStart;
    const to = e < l.periodEnd ? e : l.periodEnd;
    return { stop: { comarca: order.comarca || '', address: order.execAddressText || '', from, to, pdfText: '' } as BlockStop, add: true };
  };

  const goWeek = (n: number) => {
    setWeekStart(addDays(weekStart, 7 * n));
    setS('');
    setE('');
    setAnchor(null);
    setNights([]);
    setWeekendOk(false);
    setJoinTouched(false);
  };
  const pickDay = (d: string) => {
    if (d < opened) return;
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

  const save = async () => {
    setError('');
    if (!t) return setError('Escolha o técnico.');
    const by = user.name;
    // Sem dia: como antes (atribuir ou trocar o técnico)
    if (!(canDay && withDay)) {
      if (!techChanged && order.status !== 'Nova') return onClose();
      setSaving(true);
      try {
        await dbAssignWorkOrder(order, { matricula: t.matricula, name: t.name }, by);
        onDone(`${order.number}: ${order.assignedTechnicianMatricula ? 'técnico trocado para' : 'atribuído a'} ${t.name}.`);
      } catch (err: any) {
        setSaving(false);
        setError(err?.code === 'permission-denied' ? 'O banco recusou: seu perfil não pode atribuir OS nesta gerência.' : `Não foi possível atribuir: ${err?.message || err}`);
      }
      return;
    }
    if (!s || !e) return setError('Escolha os dias (clique no 1º e no último).');
    if (!joinLot && weekendIn.length > 0 && !weekendOk) return setError('Confirme o trabalho no fim de semana.');
    const usedNights = !joinLot && sleep ? nights.filter((n) => range.slice(0, -1).includes(n)).sort() : [];
    if (usedNights.length > 0 && (!Number.isInteger(peopleN) || peopleN < 1)) return setError('Informe quantas pessoas dormem fora (número inteiro a partir de 1).');
    setSaving(true);
    try {
      // Trocar o técnico de um chamado já começado: primeiro a troca (o caminho de sempre), depois o dia
      let w: WorkOrder = order;
      if (techChanged && (osTechStarted(order) || inBlock)) {
        await dbAssignWorkOrder(order, { matricula: t.matricula, name: t.name }, by);
        w = { ...order, status: order.status === 'Nova' ? 'Em andamento' : order.status, assignedTechnicianMatricula: t.matricula, assignedTechnicianName: t.name, lotId: undefined, scheduledDate: undefined, scheduledEndDate: undefined };
      }
      const label = chosen!.team ? `${teamLabel(chosen!.team)} (${t.name})` : t.name;
      if (joinLot) {
        const { stop, add } = joinStop(joinLot);
        const stops = add ? [...lotStops(joinLot), stop] : lotStops(joinLot);
        await dbSaveBlock({
          lot: joinLot,
          key: { unit: joinLot.unit, company: joinLot.company || order.company!, weekStart: joinLot.weekStart || weekStart },
          technician: { name: joinLot.technicianName, matricula: joinLot.technicianMatricula },
          periodStart: joinLot.periodStart,
          periodEnd: joinLot.periodEnd,
          stops,
          note: joinLot.note || '',
          nights: joinLot.nights || [],
          people: joinLot.overnight?.people || 0,
          plan: [],
          fixedIds: joinLot.orderIds || [],
          drop: [],
          woPlan: [{ item: w, s: stop.from, e: stop.to, where: localLabel(stop) }],
          woFixedIds: (joinLot.woIds || []).filter((id) => id !== order.id),
          woDrop: [],
          by,
          logText: `Chamado ${order.number} entrou no bloco ${label} · ${lotPlace(joinLot)} pelo "Atribuir técnico" (${dayTxt(stop.from, stop.to)})`
        });
        onDone(`${order.number}: ${t.name}, ${dayTxt(stop.from, stop.to)}, no bloco de ${lotPlace(joinLot)} (semana ${isoWeek(joinLot.weekStart || weekStart)}).`);
      } else {
        const stop: BlockStop = { comarca: order.comarca || '', address: order.execAddressText || '', from: s, to: e, pdfText: '' };
        const pern = usedNights.length ? `, ${usedNights.length} noite(s) × ${peopleN} pessoa(s)` : '';
        await dbSaveBlock({
          lot: null,
          key: { unit: order.unit, company: order.company!, weekStart },
          technician: { name: t.name, matricula: t.matricula },
          periodStart: s,
          periodEnd: e,
          stops: [stop],
          note: '',
          nights: usedNights,
          people: usedNights.length ? peopleN : 0,
          plan: [],
          fixedIds: [],
          drop: [],
          woPlan: [{ item: w, s, e, where: localLabel(stop) }],
          woFixedIds: [],
          woDrop: [],
          by,
          logText: `Criou o bloco ${label} · ${localLabel(stop)} (${dayTxt(s, e)}) pelo "Atribuir técnico" do chamado ${order.number}${pern}`
        });
        onDone(`${order.number}: ${t.name}, ${dayTxt(s, e)}${pern}. Está na Programação da semana ${isoWeek(weekStart)}.`);
      }
    } catch (err: any) {
      setSaving(false);
      setError(err?.code === 'permission-denied' ? 'O banco recusou: seu perfil não pode programar nesta gerência.' : `Não foi possível salvar: ${err?.message || err}`);
    }
  };

  return (
    <Shell
      title={`${order.assignedTechnicianMatricula ? 'Trocar técnico' : 'Atribuir técnico'} — ${order.number}`}
      sub={`${order.intervencao || 'Chamado'} · ${[order.comarca, order.execAddressText].filter(Boolean).join(' · ') || '—'}${order.deadline ? ` · prazo do chamado ${brDay(order.deadline)}` : ''}`}
      width="max-w-xl"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="button" className={btnMain} onClick={save} disabled={saving}>
            {saving ? 'Salvando…' : 'Confirmar'}
          </button>
        </>
      }
    >
      {order.status === 'Nova' ? (
        <p className="text-[11px] font-bold text-amber-700">Ao atribuir, a OS fica "Em andamento" e o homem-hora começa a contar.</p>
      ) : (
        <p className="text-[11px] text-slate-500">A contagem do homem-hora continua desde a primeira atribuição.</p>
      )}
      {localTechs.length > 0 ? (
        <TechTwoLists unit={order.unit} unitTechs={unitTechs} localTechs={localTechs} comarca={order.comarca} value={tech} onChange={(m) => { setTech(m); setWithDay(false); }} />
      ) : (
        <label className="block">
          <span className="block text-[11px] font-black text-slate-700 dark:text-slate-200 mb-1">Técnico</span>
          <TechTwoLists unit={order.unit} unitTechs={unitTechs} localTechs={[]} value={tech} onChange={setTech} />
          {techs.length === 0 && <span className="block mt-1 text-[11px] text-slate-500">Nenhum técnico ativo nesta gerência.</span>}
        </label>
      )}
      {localChosen && (
        <p className="p-2.5 rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 text-[11px] text-emerald-900 dark:text-emerald-200">
          <b>Técnico local: sem dia e sem pernoite.</b> Ele recebe no celular e faz dentro do prazo{order.deadline ? ` do chamado (${brDay(order.deadline)})` : ''}. Não entra na Programação da {order.unit}. O material usado sai da {order.unit}.
        </p>
      )}

      {inBlock && (
        <p className="p-2.5 rounded-lg border border-indigo-200 bg-indigo-50 dark:bg-indigo-950/30 text-[11px] text-indigo-900 dark:text-indigo-200">
          Programado: <b>{dayTxtOf(weekDays(mondayOf(new Date(`${order.scheduledDate || today}T12:00:00`))), order.scheduledDate || '', order.scheduledEndDate || order.scheduledDate || '')}</b> (bloco da Programação).{' '}
          {techChanged ? 'Trocando o técnico, o chamado sai do bloco e perde o dia (dá para programar o dia do novo técnico abaixo).' : 'Para mudar o dia ou o pernoite, use a Programação.'}
        </p>
      )}

      {canDay && (
        <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-black text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
              <CalendarDays className="w-4 h-4 text-indigo-600" />
              Programar o dia? <span className="font-medium text-slate-500">(opcional)</span>
            </p>
            <div className="flex gap-1.5 text-xs font-black">
              <button type="button" onClick={() => setWithDay(false)} className={`px-3 py-1.5 rounded-lg border cursor-pointer ${!withDay ? 'bg-slate-700 border-slate-700 text-white' : 'border-slate-200 dark:border-slate-700 text-slate-600'}`}>
                Não
              </button>
              <button type="button" onClick={() => setWithDay(true)} className={`px-3 py-1.5 rounded-lg border cursor-pointer ${withDay ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-200 dark:border-slate-700 text-slate-600'}`}>
                Sim
              </button>
            </div>
          </div>
          {withDay && (
            <>
              <DaysPicker
                weekStart={weekStart}
                days={days}
                range={range}
                anchor={anchor}
                canPrev={weekStart > firstWeek}
                canNext={weekStart < lastWeek}
                onWeek={goWeek}
                usable={(d) => d >= opened}
                offTitle={() => 'Antes da abertura do chamado'}
                onPick={pickDay}
              />
              {s && s < today && <p className="text-[11px] font-bold text-slate-600">Dia que já passou: vale para registrar a viagem que já aconteceu (o chamado ainda não foi concluído).</p>}
              {afterDeadline && (
                <p className="text-[11px] font-bold text-amber-700 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  O último dia passa do prazo do chamado ({brDay(order.deadline!)}): avisa, mas deixa programar.
                </p>
              )}
              {candidates.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-black text-slate-700 dark:text-slate-200">{t?.name.split(' ')[0]} já tem viagem nesses dias:</p>
                  {candidates.map((l) => {
                    const { stop } = joinStop(l);
                    const n = (l.nights || []).length;
                    const share = (l.orderIds || []).length + (l.woIds || []).filter((id) => id !== order.id).length + 1;
                    const on = join === l.id;
                    return (
                      <label key={l.id} className={`flex items-start gap-2 p-2.5 rounded-lg border text-[11px] cursor-pointer ${on ? 'border-2 border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30' : 'border-slate-200 dark:border-slate-700'}`}>
                        <input type="radio" name="join" checked={on} onChange={() => { setJoin(l.id); setJoinTouched(true); }} className="mt-0.5" />
                        <span>
                          <b>Entrar no bloco de {lotPlace(l)}</b> ({dayTxtOf(weekDays(l.weekStart || weekStart), l.periodStart, l.periodEnd)}
                          {n && l.overnight ? ` · ${n} noite(s) × ${l.overnight.people} pessoa(s)` : ' · sem pernoite'}). O chamado fica em {dayTxt(stop.from, stop.to)}
                          {n && l.overnight ? ` e o pernoite da viagem passa a ser dividido entre ${share} OS` : ''}. <b>Recomendado.</b>
                        </span>
                      </label>
                    );
                  })}
                  <label className={`flex items-start gap-2 p-2.5 rounded-lg border text-[11px] cursor-pointer ${!join ? 'border-2 border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30' : 'border-slate-200 dark:border-slate-700'}`}>
                    <input type="radio" name="join" checked={!join} onChange={() => { setJoin(''); setJoinTouched(true); }} className="mt-0.5" />
                    <span>Bloco separado, só deste chamado (dias e pernoite próprios).</span>
                  </label>
                </div>
              )}
              {!joinLot && weekendIn.length > 0 && (
                <label className="flex items-center gap-2 p-2.5 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 text-[11px] font-bold text-amber-900 dark:text-amber-200 cursor-pointer">
                  <input type="checkbox" checked={weekendOk} onChange={(ev) => setWeekendOk(ev.target.checked)} className="w-4 h-4" />
                  Confirmo o trabalho no fim de semana.
                </label>
              )}
              {!joinLot && company && (
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
                  shareText="pelas OS deste bloco (este chamado e as que entrarem nele)"
                />
              )}
            </>
          )}
        </div>
      )}

      {!localChosen && (
        <div className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900 text-[11px] text-indigo-900 dark:text-indigo-200 flex gap-2">
          <Info className="w-4 h-4 shrink-0" />
          <span>
            {canDay
              ? 'Com o dia, o chamado aparece na Programação (no bloco) e no celular do técnico com "Programada: …". Sem o dia, fica como hoje: com o técnico, sem dia. '
              : ''}
            <b>O técnico não lança pernoite:</b> o pernoite é o do bloco da Programação.
          </span>
        </div>
      )}
      {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
    </Shell>
  );
}
