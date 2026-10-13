import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Info, Lock, MapPin, Moon, Search, Star, Trash2, Users, Wrench } from 'lucide-react';
import { DayMarkKind, HexonUser, PlanningLot, ServiceOrder, WorkOrder } from '../../types';
import { dbRemoveBlock, dbSaveBlock, WeekKey } from '../../db/firebase';
import { formatOrderNumber } from '../../utils/orderNumber';
import { fitsWindow, localKey, localLabel } from './blockLayout';
import { DAY_LABEL } from './weekDates';
import { MARK_LABEL, Shell, btn, btnMain, input } from './WeekModals';

// PROGRAMAÇÃO › BLOCO (Fase 7C-1): equipe + local + dias seguidos + preventivas do local + pernoite + observação.
// Só entram preventivas cujo prazo do Super Admin cobre todos os dias do bloco (vale até o último dia do prazo).
// Salvar = o mesmo que o lote do PMOC (Planejada, técnico e dias); desmarcar = volta para "Novo".
// Fase 7C-2: chamados GLPI da comarca do bloco — sem técnico passam para o responsável; com ele ganham o dia; de outro
// técnico que ainda não começou podem ser trazidos; desmarcado perde o dia e continua com o técnico.

export interface LocalOption {
  key: string;
  count: number;
}
interface Props {
  user: HexonUser;
  weekKey: WeekKey;
  days: string[];
  today: string;
  lot: PlanningLot | null;
  readOnly: string; // motivo de só ver ('' = pode mudar)
  teams: { matricula: string; label: string; name: string }[]; // equipes com técnico responsável
  initialTeam?: string;
  initialLocal?: string;
  initialDays?: [string, string];
  orders: ServiceOrder[]; // preventivas da gerência e empresa (cópia do aparelho)
  workOrders: WorkOrder[]; // chamados abertos da gerência e empresa (Fase 7C-2)
  initialWos?: string[]; // chamados já marcados ao abrir (veio do "A programar")
  localOptions: LocalOption[]; // locais com preventivas a programar nesta semana
  dayMarks: Record<string, { kind: DayMarkKind; text: string }>;
  teamPeople: (resp: string, s: string, e: string) => { matricula: string; name: string; absent: boolean }[];
  costTracking: boolean;
  onSaved: (msg: string) => void;
  onClose: () => void;
  onOpen: (o: ServiceOrder) => void;
}

const EDITABLE = ['Novo', 'Planejada', 'Atrasada'];
const br = (d?: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');
const rawLocal = (k: string) => {
  const i = k.indexOf('|');
  return { comarca: k.slice(0, i), address: k.slice(i + 1) };
};
const dayTxt = (days: string[], s: string, e: string) => {
  const name = (d: string) => `${DAY_LABEL[days.indexOf(d)]?.toLowerCase() || ''} ${br(d)}`.trim();
  return s === e ? name(s) : `${name(s)} a ${name(e)}`;
};

export default function BlockEditor(props: Props) {
  const { user, weekKey, days, today, lot, teams, orders, workOrders, localOptions, dayMarks, teamPeople, costTracking, onSaved, onClose, onOpen } = props;
  const initialWos = props.initialWos || [];
  const lotOrders = useMemo(() => (lot ? orders.filter((o) => o.lotId === lot.id) : []), [lot, orders]);
  const lotLocal = useMemo(() => {
    if (lot?.local) return `${lot.local.comarca}|${lot.local.address}`;
    const count = new Map<string, number>();
    lotOrders.forEach((o) => count.set(localKey(o), (count.get(localKey(o)) || 0) + 1));
    return Array.from(count.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  }, [lot, lotOrders]);
  const inWeek = !lot || (lot.periodStart >= days[0] && lot.periodEnd <= days[6]);
  const started = !!lot && lot.periodStart < today;
  const finished = !!lot && lot.periodEnd < today;
  const readOnly = props.readOnly || (finished ? 'Este bloco já terminou: só consulta.' : '');

  const [team, setTeam] = useState(lot?.technicianMatricula || props.initialTeam || '');
  const [localK, setLocalK] = useState(lot ? lotLocal : props.initialLocal || '');
  const [s, setS] = useState(lot ? lot.periodStart : props.initialDays?.[0] || '');
  const [e, setE] = useState(lot ? lot.periodEnd : props.initialDays?.[1] || '');
  const [anchor, setAnchor] = useState<string | null>(null);
  const [findLocal, setFindLocal] = useState('');
  const [nights, setNights] = useState<string[]>(lot?.nights || []);
  const [people, setPeople] = useState(String(lot?.overnight?.people || ''));
  const [pdfText, setPdfText] = useState(lot?.pdfText || '');
  const [note, setNote] = useState(lot?.note || '');
  const [weekendOk, setWeekendOk] = useState(!!lot);
  const [open, setOpen] = useState<string[]>([]);
  const [askRemove, setAskRemove] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [tries, setTries] = useState(0);
  const errorRef = useRef<HTMLParagraphElement>(null);
  // Só o meio da janela rola: ao salvar com erro, leva até a mensagem (fica no fim do formulário)
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [error, tries]);

  const candidates = useMemo(() => orders.filter((o) => o.status === 'Novo' && !!localK && localKey(o) === localK && (!lot || o.lotId !== lot.id)), [orders, localK, lot]);
  const items = useMemo(() => [...lotOrders, ...candidates], [lotOrders, candidates]);
  const editable = (o: ServiceOrder) => EDITABLE.includes(o.status);
  const fits = (o: ServiceOrder) => !!s && !!e && fitsWindow(o, s, e);
  const notYet = (o: ServiceOrder) => !!o.startDate && o.startDate.slice(0, 10) > days[6];
  // Marcadas: as do bloco; num bloco novo, as do local que cabem nos dias (o que o planejador marcar/desmarcar vale por cima)
  const [on, setOn] = useState<Set<string>>(new Set());
  const [off, setOff] = useState<Set<string>>(new Set());
  const isChecked = (o: ServiceOrder) => {
    if (!editable(o) || off.has(o.id)) return false;
    if (on.has(o.id) || (lot && o.lotId === lot.id)) return true;
    return !lot && fits(o);
  };
  const fixedIds = lot ? lot.orderIds.filter((id) => !lotOrders.some((o) => o.id === id && editable(o))) : [];
  const fixedOrders = lotOrders.filter((o) => !editable(o));

  // Chamados (Fase 7C-2): os do bloco + os abertos da mesma comarca (ou escolhidos no "A programar")
  const [woOn, setWoOn] = useState<Set<string>>(new Set());
  const [woOff, setWoOff] = useState<Set<string>>(new Set());
  const lotWos = useMemo(() => (lot ? workOrders.filter((w) => w.lotId === lot.id) : []), [lot, workOrders]);
  const comarca = localK ? rawLocal(localK).comarca : '';
  const woCandidates = useMemo(
    () => workOrders.filter((w) => (!lot || w.lotId !== lot.id) && (initialWos.includes(w.id) || (!!localK && (w.comarca || '') === comarca))),
    [workOrders, lot, localK, comarca, initialWos.join('|')]
  );
  const woItems = [...lotWos, ...woCandidates];
  const woStarted = (w: WorkOrder) => !!w.exec || (w.pauses || []).length > 0;
  const woBlocked = (w: WorkOrder) => !!team && !!w.assignedTechnicianMatricula && w.assignedTechnicianMatricula !== team && woStarted(w);
  const woChecked = (w: WorkOrder) => !woBlocked(w) && !woOff.has(w.id) && (woOn.has(w.id) || (!!lot && w.lotId === lot.id) || initialWos.includes(w.id));
  const woPlan = woItems.filter(woChecked);
  const woDrop = lotWos.filter((w) => !woChecked(w));
  const woFixedIds = lot ? (lot.woIds || []).filter((id) => !workOrders.some((w) => w.id === id)) : [];
  const teamLocked = fixedOrders.length > 0 || lotWos.some(woStarted);
  const toggleWo = (id: string, value: boolean) => {
    setWoOn((prev) => {
      const next = new Set(prev);
      value ? next.add(id) : next.delete(id);
      return next;
    });
    setWoOff((prev) => {
      const next = new Set(prev);
      value ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const techLabel = (mat?: string, name?: string) => {
    const t = teams.find((x) => x.matricula === mat);
    return t ? `${t.name} (${t.label})` : name || mat || '';
  };

  // Grupos: mesmo prazo e periodicidade
  const groups = useMemo(() => {
    const m = new Map<string, ServiceOrder[]>();
    items.forEach((o) => {
      const k = `${o.startDate || ''}|${o.endDate || ''}|${o.periodicity || ''}`;
      m.set(k, [...(m.get(k) || []), o]);
    });
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  const teamObj = teams.find((t) => t.matricula === team) || (lot && team === lot.technicianMatricula ? { matricula: lot.technicianMatricula, label: lot.technicianName, name: lot.technicianName } : undefined);
  const range = s && e ? days.filter((d) => d >= s && d <= e) : [];
  const weekendIn = range.filter((d) => days.indexOf(d) >= 5);
  const marksIn = range.filter((d) => dayMarks[d]);
  const possibleNights = range.slice(0, -1);
  const crew = team && s && e ? teamPeople(team, s, e) : [];
  const checkedPlan = items.filter(isChecked);
  const misfit = checkedPlan.filter((o) => !fits(o));
  const drop = lotOrders.filter((o) => editable(o) && !isChecked(o));
  const usedNights = nights.filter((n) => possibleNights.includes(n)).sort();
  const peopleN = Number(people || crew.filter((c) => !c.absent).length);
  const sameComarca = localOptions.filter((l) => l.key !== localK && rawLocal(l.key).comarca === rawLocal(localK).comarca).slice(0, 6);
  const foundLocals = findLocal.trim()
    ? localOptions.filter((l) => localLabel(rawLocal(l.key)).toLowerCase().includes(findLocal.trim().toLowerCase())).slice(0, 8)
    : localOptions.slice(0, 8);

  const pickDay = (d: string) => {
    if (readOnly || !inWeek) return;
    if (started) {
      if (d >= today && d >= s) setE(d);
      return;
    }
    if (d < today) return;
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
  const toggle = (ids: string[], value: boolean) => {
    setOn((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (value ? next.add(id) : next.delete(id)));
      return next;
    });
    setOff((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (value ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const save = async () => {
    setError('');
    setTries((n) => n + 1);
    if (!teamObj) return setError('Escolha a equipe.');
    if (!localK) return setError('Escolha o local.');
    if (!s || !e) return setError('Escolha os dias do bloco.');
    if (!started && s < today) return setError('Não dá para programar em dia que já passou.');
    if (e < today) return setError('O último dia do bloco já passou.');
    if (weekendIn.length > 0 && !weekendOk) return setError('Confirme o trabalho no fim de semana.');
    if (misfit.length > 0) return setError(`${misfit.length} preventiva(s) marcada(s) não cabem no prazo com esses dias: desmarque ou mude os dias.`);
    if (checkedPlan.length === 0 && fixedIds.length === 0 && woPlan.length === 0 && woFixedIds.length === 0)
      return setError(lot ? 'Nada marcado no bloco: use "Tirar o bloco".' : 'Marque ao menos uma preventiva ou um chamado.');
    if (usedNights.length > 0 && (!Number.isInteger(peopleN) || peopleN < 1)) return setError('Informe quantas pessoas dormem fora (número inteiro a partir de 1).');
    const local = rawLocal(localK);
    const added = checkedPlan.filter((o) => o.lotId !== lot?.id).length;
    const pern = usedNights.length ? `, ${usedNights.length} noite(s) × ${peopleN} pessoa(s)` : '';
    const what = `${teamObj.label} · ${localLabel(local)} (${dayTxt(days, s, e)})`;
    const chs = woPlan.length + woFixedIds.length ? `, ${woPlan.length + woFixedIds.length} chamado(s)` : '';
    const chDrop = woDrop.length ? `, ${woDrop.length} chamado(s) perderam o dia` : '';
    const logText = lot
      ? `Mudou o bloco ${what}: ${checkedPlan.length + fixedIds.length} preventiva(s)${added ? `, +${added}` : ''}${drop.length ? `, −${drop.length} (voltaram para Novo)` : ''}${chs}${chDrop}${pern}`
      : `Criou o bloco ${what}: ${checkedPlan.length} preventiva(s)${chs}${pern}`;
    setSaving(true);
    try {
      await dbSaveBlock({
        lot,
        key: weekKey,
        technician: { name: teamObj.name, matricula: teamObj.matricula },
        periodStart: s,
        periodEnd: e,
        local,
        pdfText,
        note,
        nights: usedNights,
        people: usedNights.length ? peopleN : 0,
        plan: checkedPlan,
        fixedIds,
        drop,
        woPlan,
        woFixedIds,
        woDrop,
        by: user.name,
        logText
      });
      onSaved(
        `Bloco salvo: ${checkedPlan.length} preventiva(s)${woPlan.length ? ` e ${woPlan.length} chamado(s)` : ''} para ${teamObj.name}, ${dayTxt(days, s, e)}${drop.length ? `; ${drop.length} preventiva(s) voltaram para "Novo"` : ''}${woDrop.length ? `; ${woDrop.length} chamado(s) perderam o dia` : ''}.`
      );
    } catch (err: any) {
      setSaving(false);
      setError(err?.code === 'permission-denied' ? 'O banco recusou: seu perfil não pode programar nesta gerência.' : `Não foi possível salvar: ${err?.message || err}`);
    }
  };
  const remove = async () => {
    if (!lot) return;
    setSaving(true);
    setError('');
    setTries((n) => n + 1);
    try {
      const editableLot = lotOrders.filter(editable);
      const chs = lotWos.length ? `; ${lotWos.length} chamado(s) perderam o dia` : '';
      await dbRemoveBlock(lot, editableLot, weekKey, user.name, `Tirou o bloco ${teamObj?.label || lot.technicianName} · ${localLabel(rawLocal(localK))} (${editableLot.length} preventiva(s) voltaram para Novo${chs})`, lotWos);
      onSaved(`Bloco tirado: ${editableLot.length} preventiva(s) voltaram para "Novo"${chs}.`);
    } catch (err: any) {
      setSaving(false);
      setError(err?.code === 'permission-denied' ? 'O banco recusou: seu perfil não pode programar nesta gerência.' : `Não foi possível tirar o bloco: ${err?.message || err}`);
    }
  };

  const box = 'rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b1220] p-3';
  const h = 'text-xs font-black text-slate-800 dark:text-slate-100';
  const check = (on: boolean, disabled: boolean) => (
    <span className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center ${disabled ? 'border-slate-300 bg-slate-100 dark:bg-slate-800' : on ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white dark:bg-slate-900'}`}>
      {on && <CheckCircle2 className="w-3 h-3" />}
    </span>
  );
  const title = lot ? `Bloco — ${teamObj?.label || lot.technicianName} · ${localK ? localLabel(rawLocal(localK)) : 'sem local'}` : 'Novo bloco';
  const sub = `${weekKey.unit} · semana ${br(days[0])} a ${br(days[6])}${lot && lot.source !== 'programacao' ? ' · programado no PMOC (salvar aqui transforma em bloco)' : ''}`;

  return (
    <Shell
      title={title}
      sub={sub}
      onClose={onClose}
      width="max-w-6xl"
      footer={
        readOnly ? (
          <>
            <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
              <Lock className="w-3.5 h-3.5" />
              {readOnly}
            </span>
            <button type="button" className={btn} onClick={onClose}>
              Fechar
            </button>
          </>
        ) : (
          <>
            {lot ? (
              askRemove ? (
                <span className="flex items-center gap-2 text-xs font-bold text-rose-700">
                  Tirar o bloco? As preventivas voltam para "Novo" e os chamados perdem o dia.
                  <button type="button" onClick={remove} disabled={saving} className="px-3 py-2 rounded-lg bg-rose-600 text-white cursor-pointer disabled:opacity-50">
                    Sim, tirar
                  </button>
                  <button type="button" onClick={() => setAskRemove(false)} className="px-3 py-2 rounded-lg border border-slate-300 cursor-pointer">
                    Não
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setAskRemove(true)}
                  disabled={fixedIds.length > 0 || woFixedIds.length > 0 || saving}
                  title={fixedIds.length > 0 || woFixedIds.length > 0 ? 'Há preventiva em execução ou concluída, ou chamado já concluído, neste bloco' : ''}
                  className="px-4 py-2.5 rounded-xl border border-rose-200 text-rose-600 text-sm font-bold flex items-center gap-1 cursor-pointer disabled:opacity-40"
                >
                  <Trash2 className="w-4 h-4" />
                  Tirar o bloco
                </button>
              )
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button type="button" className={btn} onClick={onClose} disabled={saving}>
                Cancelar
              </button>
              <button type="button" className={btnMain} onClick={save} disabled={saving}>
                {saving ? 'Salvando...' : 'Salvar o bloco'}
              </button>
            </div>
          </>
        )
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-4">
        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className={`block mb-1 ${h}`}>1. Equipe</span>
              <select value={team} onChange={(ev) => setTeam(ev.target.value)} disabled={!!readOnly || teamLocked} className={input}>
                <option value="">Escolha a equipe...</option>
                {teams.map((t) => (
                  <option key={t.matricula} value={t.matricula}>
                    {t.label} — {t.name}
                  </option>
                ))}
                {lot && !teams.some((t) => t.matricula === lot.technicianMatricula) && <option value={lot.technicianMatricula}>{lot.technicianName}</option>}
              </select>
              {teamLocked && <span className="text-[10px] text-slate-500">Há preventiva em execução ou concluída, ou chamado já começado: a equipe não muda.</span>}
            </label>
            <div>
              <span className={`block mb-1 ${h}`}>2. Local</span>
              {localK ? (
                <div className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span className="truncate flex-1">{localLabel(rawLocal(localK))}</span>
                  {!lot && !readOnly && (
                    <button type="button" onClick={() => setLocalK('')} className="text-[10px] font-black text-indigo-600 cursor-pointer">
                      trocar
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  <label className="relative block">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                    <input value={findLocal} onChange={(ev) => setFindLocal(ev.target.value)} placeholder="Buscar comarca ou endereço..." className={`${input} pl-8`} />
                  </label>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {foundLocals.map((l) => (
                      <button
                        key={l.key}
                        type="button"
                        onClick={() => setLocalK(l.key)}
                        className="w-full text-left px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-indigo-400 text-[11px] font-bold cursor-pointer"
                      >
                        {localLabel(rawLocal(l.key))} <span className="text-emerald-700">· {l.count} a programar</span>
                      </button>
                    ))}
                    {foundLocals.length === 0 && <p className="text-[11px] text-slate-500">Nenhum local com preventiva a programar nesta semana.</p>}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div>
            <p className={`mb-1.5 ${h}`}>
              3. Dias seguidos <span className="font-medium text-slate-500">(clique no 1º e no último dia; sábado e domingo pedem confirmação)</span>
            </p>
            {inWeek ? (
              <div className="flex flex-wrap gap-1.5">
                {days.map((d, i) => {
                  const on = !!s && d >= s && d <= e;
                  const blocked = (!started && d < today) || (started && d < today);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => pickDay(d)}
                      disabled={!!readOnly || (blocked && !on)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-bold flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed ${
                        on ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200' : blocked ? 'border-slate-200 bg-slate-100 text-slate-300 dark:bg-slate-800' : i >= 5 ? 'border-slate-200 bg-slate-50 text-slate-500 dark:bg-slate-900' : 'border-slate-200 bg-white text-slate-500 dark:bg-slate-900'
                      }`}
                    >
                      {on && <CheckCircle2 className="w-3.5 h-3.5" />}
                      {DAY_LABEL[i]} {br(d)}
                      {dayMarks[d] && <span className="text-rose-600">· {MARK_LABEL[dayMarks[d].kind].toLowerCase()}</span>}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-[11px] text-slate-600">
                Período do lote: <b>{br(s)} a {br(e)}</b> (passa desta semana; os dias não mudam por aqui).
              </p>
            )}
            {anchor && <p className="mt-1 text-[10px] font-bold text-indigo-600">Agora clique no último dia (ou no mesmo dia para um dia só).</p>}
            {started && !readOnly && <p className="mt-1 text-[10px] text-slate-500">O bloco já começou: só dá para mudar o último dia.</p>}
            {marksIn.length > 0 && (
              <p className="mt-1 text-[10px] font-bold text-rose-600">
                {marksIn.map((d) => `${br(d)}: ${MARK_LABEL[dayMarks[d].kind].toLowerCase()}${dayMarks[d].text ? ` (${dayMarks[d].text})` : ''}`).join(' · ')} — não bloqueia.
              </p>
            )}
            {weekendIn.length > 0 && !readOnly && (
              <label className="mt-2 flex items-start gap-2 p-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 text-[11px] text-amber-900 dark:text-amber-200 cursor-pointer">
                <input type="checkbox" checked={weekendOk} onChange={(ev) => setWeekendOk(ev.target.checked)} className="w-4 h-4 mt-px" />
                <span>
                  <AlertTriangle className="inline w-3.5 h-3.5 mr-1" />O bloco tem <b>{weekendIn.map((d) => DAY_LABEL[days.indexOf(d)].toLowerCase()).join(' e ')}</b>. Confirmo que a equipe vai trabalhar no fim de semana
                  (preventiva no fim de semana é caso especial).
                </span>
              </label>
            )}
          </div>

          <div className={`${box} space-y-2`}>
            <p className={`${h} flex items-center gap-1`}>
              <ClipboardCheck className="w-4 h-4 text-emerald-600" />
              4. Preventivas deste local — {checkedPlan.length + fixedIds.length} no bloco
            </p>
            {!localK && <p className="text-[11px] text-slate-500">Escolha o local para ver as preventivas.</p>}
            {localK && items.length === 0 && <p className="text-[11px] text-slate-500">Nenhuma preventiva aguardando programação neste local.</p>}
            {groups.map(([k, list]) => {
              const o0 = list[0];
              const ok = list.filter((o) => editable(o) && fits(o));
              const allOn = ok.length > 0 && ok.every(isChecked);
              const late = list.filter((o) => editable(o) && !fits(o) && !notYet(o));
              const future = list.filter((o) => editable(o) && notYet(o));
              const fixedHere = list.filter((o) => !editable(o));
              const isOpen = open.includes(k);
              return (
                <div key={k} className={`rounded-lg border ${late.length && !ok.length ? 'border-rose-200 bg-rose-50/60 dark:bg-rose-950/20' : future.length && !ok.length ? 'border-slate-200 bg-slate-50 dark:bg-slate-900' : 'border-slate-200 dark:border-slate-700'}`}>
                  <div className="p-2 flex items-start gap-2 text-[11px]">
                    <button type="button" disabled={!!readOnly || ok.length === 0} onClick={() => toggle(ok.map((o) => o.id), !allOn)} className="mt-px cursor-pointer disabled:cursor-not-allowed">
                      {check(allOn, !!readOnly || ok.length === 0)}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-slate-800 dark:text-slate-100">
                        <b>
                          {list.length} preventiva{list.length > 1 ? 's' : ''}
                          {o0.periodicity ? ` ${o0.periodicity.toLowerCase()}${list.length > 1 ? 's' : ''}` : ''}
                        </b>{' '}
                        · prazo {br(o0.startDate)} a {br(o0.endDate)}
                      </p>
                      {late.length > 0 && s && (
                        <p className="text-[10px] text-rose-700">
                          {late.length === list.length ? 'Não cabem' : `${late.length} não cabem`} neste bloco: o prazo {o0.endDate && o0.endDate.slice(0, 10) < e ? `acaba em ${br(o0.endDate)}` : `começa em ${br(o0.startDate)}`}. Mude os dias ou faça outro bloco.
                        </p>
                      )}
                      {future.length > 0 && (
                        <p className="text-[10px] text-slate-500 flex items-center gap-1">
                          <Lock className="w-3 h-3" />
                          Ainda não podem: o prazo começa depois desta semana.
                        </p>
                      )}
                      {fixedHere.length > 0 && <p className="text-[10px] text-slate-500">{fixedHere.length} em execução ou concluída(s): continuam no bloco.</p>}
                    </div>
                    <button type="button" onClick={() => setOpen((p) => (isOpen ? p.filter((x) => x !== k) : [...p, k]))} className="text-[10px] font-black text-indigo-600 cursor-pointer shrink-0">
                      {isOpen ? 'esconder' : `ver as ${list.length}`}
                    </button>
                  </div>
                  {isOpen && (
                    <div className="border-t border-slate-100 dark:border-slate-800 max-h-56 overflow-y-auto">
                      {list.map((o) => {
                        const can = editable(o) && fits(o) && !readOnly;
                        return (
                          <div key={o.id} className="px-2 py-1 flex items-center gap-2 text-[11px] border-b border-slate-50 dark:border-slate-800/50">
                            <button type="button" disabled={!can && !isChecked(o)} onClick={() => toggle([o.id], !isChecked(o))} className="cursor-pointer disabled:cursor-not-allowed">
                              {check(editable(o) ? isChecked(o) : true, !can && !isChecked(o))}
                            </button>
                            <span className="font-mono text-[10px] font-bold text-indigo-600">#{formatOrderNumber(o.id)}</span>
                            <span className="flex-1 truncate">{o.assetName || o.title}</span>
                            <span className="text-[10px] text-slate-500">{o.status}</span>
                            <button type="button" onClick={() => onOpen(o)} className="text-[10px] font-black text-indigo-600 cursor-pointer">
                              Abrir
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className={`${box} space-y-2`}>
            <p className={`${h} flex items-center gap-1`}>
              <Wrench className="w-4 h-4 text-indigo-600" />
              Chamados GLPI {comarca ? `de ${comarca}` : 'da comarca'} — {woPlan.length + woFixedIds.length} no bloco
            </p>
            {!localK && <p className="text-[11px] text-slate-500">Escolha o local para ver os chamados abertos da comarca.</p>}
            {localK && woItems.length === 0 && <p className="text-[11px] text-slate-500">Nenhum chamado aberto nesta comarca.</p>}
            {woFixedIds.length > 0 && <p className="text-[10px] text-slate-500">{woFixedIds.length} chamado(s) do bloco já concluído(s): continuam no bloco.</p>}
            {woItems.map((w) => {
              const blocked = woBlocked(w);
              const checked = woChecked(w);
              const mine = !!team && w.assignedTechnicianMatricula === team;
              const lateDeadline = !!w.deadline && !!e && w.deadline.slice(0, 10) < e;
              const state = !team
                ? 'escolha a equipe'
                : w.status === 'Nova' || !w.assignedTechnicianMatricula
                  ? `sem técnico → passa a ser do ${teamObj?.name || ''}`
                  : blocked
                    ? `já começou com ${techLabel(w.assignedTechnicianMatricula, w.assignedTechnicianName)}: não muda de técnico aqui`
                    : !mine
                      ? `está com ${techLabel(w.assignedTechnicianMatricula, w.assignedTechnicianName)}; se marcar, sai dele e passa para ${teamObj?.name || ''}`
                      : lot && w.lotId === lot.id
                        ? 'neste bloco'
                        : w.lotId
                          ? `já tem dia em outro bloco (${br(w.scheduledDate)}): se marcar, muda para este`
                          : `já com ele${w.status === 'Pendente' ? ' (pendente)' : ''}, sem dia → ganha o dia`;
              const tone = blocked ? 'border-rose-200 bg-rose-50/60 dark:bg-rose-950/20' : team && !mine && w.assignedTechnicianMatricula ? 'border-amber-200 bg-amber-50/60 dark:bg-amber-950/20' : 'border-slate-200 dark:border-slate-700';
              return (
                <div key={w.id} className={`p-2 rounded-lg border flex items-start gap-2 text-[11px] ${tone}`}>
                  <button type="button" disabled={!!readOnly || blocked || !team} onClick={() => toggleWo(w.id, !checked)} className="mt-px cursor-pointer disabled:cursor-not-allowed">
                    {check(checked, !!readOnly || blocked || !team)}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-800 dark:text-slate-100">
                      <span className="font-mono font-black text-indigo-700 dark:text-indigo-300">{w.number || w.id}</span>
                      {w.intervencao ? ` · ${w.intervencao}` : ''}
                      {w.glpi ? ` · GLPI ${w.glpi}` : ''}
                      {w.deadline ? (
                        <span className={lateDeadline ? 'text-rose-600 font-bold' : ''}>
                          {' '}
                          · prazo {br(w.deadline)}
                        </span>
                      ) : (
                        ' · sem prazo'
                      )}
                    </p>
                    <p className="text-[10px] text-slate-500 truncate">
                      <MapPin className="inline w-3 h-3 mr-0.5" />
                      {w.execAddressText || w.comarca || '—'}
                    </p>
                    <p className={`text-[10px] ${blocked ? 'text-rose-700' : team && !mine && w.assignedTechnicianMatricula ? 'text-amber-800' : 'text-slate-600 dark:text-slate-400'}`}>{state}</p>
                    {lateDeadline && checked && <p className="text-[10px] font-bold text-rose-600">O prazo do chamado acaba antes do último dia do bloco (não bloqueia).</p>}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className={box}>
              <p className={`${h} flex items-center gap-1`}>
                <Users className="w-4 h-4 text-indigo-600" />
                5. Equipe nestes dias
              </p>
              {crew.length ? (
                <p className="mt-1 text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed">
                  {crew.map((c, i) => (
                    <span key={c.matricula} className={c.absent ? 'line-through text-rose-500' : ''}>
                      {i === 0 && <Star className="inline w-3 h-3 text-amber-500 fill-amber-400 mr-0.5" />}
                      {c.name}
                      {c.absent ? ' (ausente)' : ''}
                      {i < crew.length - 1 ? ', ' : ''}
                    </span>
                  ))}
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-slate-500">Escolha a equipe e os dias.</p>
              )}
              <p className="text-[10px] text-slate-500 mt-1">Vem da equipe desta semana (✎ na linha), sem os ausentes. Ao começar cada preventiva, o técnico já recebe essa equipe e ainda pode tirar ou pôr gente.</p>
            </div>
            <div className={`${box} space-y-2`}>
              <p className={`${h} flex items-center gap-1`}>
                <Moon className="w-4 h-4 text-sky-600" />
                6. Pernoite (viagem)
              </p>
              {!costTracking ? (
                <p className="text-[11px] text-slate-500">A empresa não contabiliza pernoite.</p>
              ) : possibleNights.length === 0 ? (
                <p className="text-[11px] text-slate-500">Bloco de 1 dia: sem pernoite.</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {possibleNights.map((d) => {
                      const on = nights.includes(d);
                      const i = days.indexOf(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          disabled={!!readOnly}
                          onClick={() => setNights((p) => (on ? p.filter((x) => x !== d) : [...p, d]))}
                          className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-bold flex items-center gap-1 cursor-pointer ${on ? 'border-sky-400 bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200' : 'border-slate-200 text-slate-500'}`}
                        >
                          <Moon className="w-3.5 h-3.5" />
                          {DAY_LABEL[i]?.toLowerCase()}→{DAY_LABEL[i + 1]?.toLowerCase() || ''}: {on ? 'dormem fora' : 'voltam'}
                        </button>
                      );
                    })}
                  </div>
                  {usedNights.length > 0 && (
                    <>
                      <label className="flex items-center gap-2 text-[11px]">
                        <span className="font-bold text-slate-600">Pessoas:</span>
                        <input value={people} onChange={(ev) => setPeople(ev.target.value.replace(/\D/g, '').slice(0, 2))} placeholder={String(crew.filter((c) => !c.absent).length)} disabled={!!readOnly} className="w-14 h-7 px-2 rounded-md border border-slate-200 font-black bg-white dark:bg-slate-900" />
                        <span className="text-slate-500">(da equipe; pode ajustar)</span>
                      </label>
                      <p className="text-[11px] text-slate-700 dark:text-slate-300">
                        <b>
                          {usedNights.length} noite{usedNights.length > 1 ? 's' : ''} × {peopleN} pessoa{peopleN > 1 ? 's' : ''} = {usedNights.length * peopleN} pernoites
                        </b>
                        , divididos entre as {checkedPlan.length + fixedIds.length + woPlan.length + woFixedIds.length} OS do bloco (preventivas e chamados).
                      </p>
                    </>
                  )}
                  <p className="text-[10px] text-slate-500">Valor em R$ só para quem tem "Visualizar Valores".</p>
                </>
              )}
            </div>
          </div>

          <div className="grid sm:grid-cols-[220px_minmax(0,1fr)] gap-2">
            <label className="block">
              <span className={`block mb-1 ${h}`}>7. Texto do local no PDF</span>
              <input value={pdfText} onChange={(ev) => setPdfText(ev.target.value)} maxLength={80} disabled={!!readOnly} placeholder={localK ? localLabel(rawLocal(localK)).toUpperCase() : ''} className={input} />
            </label>
            <label className="block">
              <span className={`block mb-1 ${h}`}>Observação</span>
              <input value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={300} disabled={!!readOnly} placeholder="Ex.: hotel reservado" className={input} />
            </label>
          </div>
          {error && (
            <p ref={errorRef} className="text-xs font-bold text-rose-600">
              {error}
            </p>
          )}
        </div>

        <div className="space-y-3 self-start">
          {!readOnly && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-[11px] text-emerald-900 dark:text-emerald-200 flex gap-2">
              <Info className="w-4 h-4 shrink-0" />
              <span>
                <b>Ao salvar:</b> {checkedPlan.length} preventiva(s) ficam <b>Programadas</b>
                {teamObj ? ` para ${teamObj.name}` : ''}
                {s ? `, ${dayTxt(days, s, e)}` : ''} (o mesmo que o PMOC faz). Entram no celular do técnico <b>como hoje</b>.
                {woPlan.length > 0 && (
                  <>
                    {' '}
                    <b>{woPlan.length}</b> chamado(s) ficam com ele, com o dia programado.
                  </>
                )}
                {drop.length > 0 && (
                  <>
                    {' '}
                    <b>{drop.length}</b> preventiva(s) desmarcada(s) voltam para "Novo".
                  </>
                )}
                {woDrop.length > 0 && (
                  <>
                    {' '}
                    <b>{woDrop.length}</b> chamado(s) desmarcado(s) perdem o dia e continuam com o técnico.
                  </>
                )}
              </span>
            </div>
          )}
          {sameComarca.length > 0 && (
            <div className={`${box} space-y-1.5`}>
              <p className="text-xs font-black text-slate-900 dark:text-white">Na mesma comarca, ainda a programar</p>
              {sameComarca.map((l) => (
                <p key={l.key} className="text-[11px] text-slate-700 dark:text-slate-300">
                  <MapPin className="inline w-3 h-3 text-indigo-600 mr-0.5" />
                  {rawLocal(l.key).address || 'sem endereço'} · <b className="text-emerald-700">{l.count}</b>
                </p>
              ))}
              <p className="text-[10px] text-slate-500">Cada local é um bloco: use o "A programar" ao lado da grade.</p>
            </div>
          )}
          <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[10px] text-slate-600 dark:text-slate-400 space-y-1">
            <p>
              <b>Prazo:</b> a preventiva só entra se o prazo dado pelo Super Admin cobre todos os dias do bloco (vale até o último dia do prazo).
            </p>
            <p>
              <b>Desmarcar</b> uma preventiva: ela volta para "Novo". <b>Tirar o bloco</b>: faz isso com todas.
            </p>
          </div>
        </div>
      </div>
    </Shell>
  );
}
