import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, Lock, MapPin, Moon, Plus, Search, Star, Trash2, Users, Wrench } from 'lucide-react';
import { BlockStop, DayMarkKind, HexonUser, PlanningLot, ServiceOrder, WorkOrder } from '../../types';
import { dbRemoveBlock, dbSaveBlock, WeekKey } from '../../db/firebase';
import { formatOrderNumber } from '../../utils/orderNumber';
import { fitsWindow, localKey, localLabel, lotStops, stopKey } from './blockLayout';
import { DAY_LABEL } from './weekDates';
import { MARK_LABEL, Shell, btn, btnMain, input } from './WeekModals';

// PROGRAMAÇÃO › BLOCO (Fase 7C-1): equipe + local + dias seguidos + preventivas do local + pernoite + observação.
// Só entram preventivas cujo prazo do Super Admin cobre todos os dias do bloco (vale até o último dia do prazo).
// Salvar = o mesmo que o lote do PMOC (Planejada, técnico e dias); desmarcar = volta para "Novo".
// Fase 7C-2: chamados GLPI da comarca do bloco — sem técnico passam para o responsável; com ele ganham o dia; de outro
// técnico que ainda não começou podem ser trazidos; desmarcado perde o dia e continua com o técnico.
// U4: o "A programar nesta semana" (antes ao lado da grade) fica aqui dentro, com Preventivas e Corretivas (chamados).
// Fase 7C-3: vários locais no bloco (roteiro). Cada local tem os seus dias seguidos dentro do bloco (padrão: todos);
// a preventiva fica programada nos dias do seu local (o prazo é conferido com eles) e o chamado nos dias do local da
// sua comarca. Tirar um local = as preventivas dele voltam para "Novo" e os chamados perdem o dia.

export interface LocalOption {
  key: string;
  count: number;
  minEnd?: string; // prazo mais curto das preventivas do local (AAAA-MM-DD)
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
  toPlanWos: WorkOrder[]; // chamados a programar: sem técnico, ou com técnico sem dia (U4)
  notYet: number; // preventivas cujo prazo só começa na semana que vem
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
const MAX_STOPS = 20;
// Local no editor: from/to vazios = acompanha os dias do bloco
type StopEdit = { key: string; from: string; to: string; pdfText: string };
const dayTxt = (days: string[], s: string, e: string) => {
  const name = (d: string) => `${DAY_LABEL[days.indexOf(d)]?.toLowerCase() || ''} ${br(d)}`.trim();
  return s === e ? name(s) : `${name(s)} a ${name(e)}`;
};

export default function BlockEditor(props: Props) {
  const { user, weekKey, days, today, lot, teams, orders, workOrders, localOptions, dayMarks, teamPeople, costTracking, onSaved, onClose, onOpen } = props;
  const initialWos = props.initialWos || [];
  const lotOrders = useMemo(() => (lot ? orders.filter((o) => o.lotId === lot.id) : []), [lot, orders]);
  // Locais ao abrir: os do bloco (e, por segurança, os das preventivas e chamados dele que não estejam na lista); bloco
  // novo: o local escolhido. Lote do PMOC: os locais das suas preventivas, todos com os dias do lote.
  const initialStops = useMemo<StopEdit[]>(() => {
    if (!lot) return props.initialLocal ? [{ key: props.initialLocal, from: '', to: '', pdfText: '' }] : [];
    const list: StopEdit[] = lotStops(lot).map((st) => {
      const all = st.from <= lot.periodStart && st.to >= lot.periodEnd;
      return { key: stopKey(st), from: all ? '' : st.from, to: all ? '' : st.to, pdfText: st.pdfText || '' };
    });
    const has = (k: string) => list.some((x) => x.key === k);
    lotOrders.forEach((o) => !has(localKey(o)) && list.push({ key: localKey(o), from: '', to: '', pdfText: '' }));
    workOrders
      .filter((w) => w.lotId === lot.id && !list.some((x) => x.key.slice(0, x.key.indexOf('|')) === (w.comarca || '')))
      .forEach((w) => !has(`${w.comarca || ''}|`) && list.push({ key: `${w.comarca || ''}|`, from: '', to: '', pdfText: '' }));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const origKeys = useMemo(() => new Set(lot ? initialStops.map((x) => x.key) : []), [lot, initialStops]);
  const inWeek = !lot || (lot.periodStart >= days[0] && lot.periodEnd <= days[6]);
  const started = !!lot && lot.periodStart < today;
  const finished = !!lot && lot.periodEnd < today;
  const readOnly = props.readOnly || (finished ? 'Este bloco já terminou: só consulta.' : '');

  const [team, setTeam] = useState(lot?.technicianMatricula || props.initialTeam || '');
  const [stops, setStops] = useState<StopEdit[]>(initialStops);
  const [pickTab, setPickTab] = useState<'prev' | 'ch'>('prev');
  const [stopAnchor, setStopAnchor] = useState<{ key: string; d: string } | null>(null);
  const [fold, setFold] = useState<Record<string, boolean>>({});
  const [s, setS] = useState(lot ? lot.periodStart : props.initialDays?.[0] || '');
  const [e, setE] = useState(lot ? lot.periodEnd : props.initialDays?.[1] || '');
  const [anchor, setAnchor] = useState<string | null>(null);
  const [findLocal, setFindLocal] = useState('');
  const [nights, setNights] = useState<string[]>(lot?.nights || []);
  const [people, setPeople] = useState(String(lot?.overnight?.people || ''));
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

  // Dias de cada local: os escolhidos dentro do bloco (fora dele ou vazios = os dias do bloco)
  const effOf = (st: StopEdit): [string, string] | null => {
    if (!s || !e) return null;
    if (!st.from) return [s, e];
    const a = st.from > s ? st.from : s;
    const b = st.to < e ? st.to : e;
    return a <= b ? [a, b] : [s, e];
  };
  const stopKeys = stops.map((x) => x.key);
  const keySet = new Set(stopKeys);
  const comarcaOf = (k: string) => k.slice(0, k.indexOf('|'));
  const rangeOf = (o: ServiceOrder) => {
    const st = stops.find((x) => x.key === localKey(o));
    return st ? effOf(st) : null;
  };
  const candidates = useMemo(() => orders.filter((o) => o.status === 'Novo' && stopKeys.includes(localKey(o)) && (!lot || o.lotId !== lot.id)), [orders, stopKeys.join('#'), lot]);
  const items = useMemo(() => [...lotOrders, ...candidates], [lotOrders, candidates]);
  const editable = (o: ServiceOrder) => EDITABLE.includes(o.status);
  const fits = (o: ServiceOrder) => {
    const r = rangeOf(o);
    return !!r && fitsWindow(o, r[0], r[1]);
  };
  const notYet = (o: ServiceOrder) => !!o.startDate && o.startDate.slice(0, 10) > days[6];
  // Marcadas: as do bloco; num bloco novo (ou local novo no bloco), as do local que cabem nos dias (o que o planejador
  // marcar/desmarcar vale por cima); local tirado do bloco = desmarcadas
  const [on, setOn] = useState<Set<string>>(new Set());
  const [off, setOff] = useState<Set<string>>(new Set());
  const isChecked = (o: ServiceOrder) => {
    if (!editable(o) || off.has(o.id) || !keySet.has(localKey(o))) return false;
    if (on.has(o.id) || (lot && o.lotId === lot.id)) return true;
    return !origKeys.has(localKey(o)) && fits(o);
  };
  const fixedIds = lot ? lot.orderIds.filter((id) => !lotOrders.some((o) => o.id === id && editable(o))) : [];
  const fixedOrders = lotOrders.filter((o) => !editable(o));

  // Chamados (Fase 7C-2): os do bloco + os abertos das comarcas dos locais (ou escolhidos no "A programar"); dias = os
  // do(s) local(is) da comarca
  const [woOn, setWoOn] = useState<Set<string>>(new Set());
  const [woOff, setWoOff] = useState<Set<string>>(new Set());
  const lotWos = useMemo(() => (lot ? workOrders.filter((w) => w.lotId === lot.id) : []), [lot, workOrders]);
  const comarcas = Array.from(new Set(stopKeys.map(comarcaOf)));
  const woRange = (w: WorkOrder): [string, string] | null => {
    const list = stops.filter((x) => comarcaOf(x.key) === (w.comarca || '')).map(effOf).filter((r): r is [string, string] => !!r);
    if (!list.length) return null;
    return [list.map((r) => r[0]).sort()[0], list.map((r) => r[1]).sort().reverse()[0]];
  };
  const woCandidates = useMemo(
    () => workOrders.filter((w) => (!lot || w.lotId !== lot.id) && (initialWos.includes(w.id) || comarcas.includes(w.comarca || ''))),
    [workOrders, lot, comarcas.join('#'), initialWos.join('|')]
  );
  const woItems = [...lotWos, ...woCandidates];
  const woStarted = (w: WorkOrder) => !!w.exec || (w.pauses || []).length > 0;
  const woBlocked = (w: WorkOrder) => !!team && !!w.assignedTechnicianMatricula && w.assignedTechnicianMatricula !== team && woStarted(w);
  const woChecked = (w: WorkOrder) =>
    !woBlocked(w) && (!s || !!woRange(w)) && comarcas.includes(w.comarca || '') && !woOff.has(w.id) && (woOn.has(w.id) || (!!lot && w.lotId === lot.id) || initialWos.includes(w.id));
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

  // Grupos por local e, dentro dele, mesmo prazo e periodicidade
  const groupsOf = (list: ServiceOrder[]) => {
    const m = new Map<string, ServiceOrder[]>();
    list.forEach((o) => {
      const k = `${localKey(o)}#${o.startDate || ''}|${o.endDate || ''}|${o.periodicity || ''}`;
      m.set(k, [...(m.get(k) || []), o]);
    });
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  };

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
  const sameComarca = localOptions.filter((l) => !keySet.has(l.key) && comarcas.includes(rawLocal(l.key).comarca)).slice(0, 6);
  // U4: A programar nesta semana — Preventivas (locais, prazo mais curto primeiro) e Corretivas (chamados sem dia)
  const weekLast = days[days.length - 1];
  const term = findLocal.trim().toLowerCase();
  const freeLocals = localOptions.filter((l) => !keySet.has(l.key));
  const nPrevFree = freeLocals.reduce((n, l) => n + l.count, 0);
  const foundLocals = (term ? freeLocals.filter((l) => localLabel(rawLocal(l.key)).toLowerCase().includes(term)) : freeLocals).slice(0, 40);
  // os chamados da comarca de um local do bloco já aparecem em "Chamados GLPI" (com a caixa de marcar): saem daqui
  const freeWos = props.toPlanWos.filter((w) => !woItems.some((x) => x.id === w.id));
  const foundWos = freeWos
    .filter((w) => !term || [w.glpi || '', w.number, w.comarca || '', w.execAddressText || ''].some((v) => v.toLowerCase().includes(term)))
    .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'))
    .slice(0, 40);
  const pickTabCls = (on: boolean) => `h-8 rounded-md text-[11px] font-black cursor-pointer ${on ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300'}`;
  const placeTxt = stops.length === 1 ? localLabel(rawLocal(stops[0].key)) : `${stops.length} locais`;
  // O que fica preso ao local (não dá para tirar): preventiva em execução/concluída ou chamado começado
  const stopLocked = (k: string) =>
    lotOrders.some((o) => !editable(o) && localKey(o) === k) || lotWos.some((w) => woStarted(w) && (w.comarca || '') === comarcaOf(k) && stops.filter((x) => comarcaOf(x.key) === comarcaOf(k)).length === 1);
  const addStop = (k: string) => {
    if (keySet.has(k) || stops.length >= MAX_STOPS) return;
    // Bloco já começado: o local novo vale de hoje em diante
    const from = started && today > s && today <= e ? today : '';
    setStops((p) => [...p, { key: k, from, to: from ? e : '', pdfText: '' }]);
    setFindLocal('');
  };
  const removeStop = (k: string) => setStops((p) => p.filter((x) => x.key !== k));
  const setStopText = (k: string, text: string) => setStops((p) => p.map((x) => (x.key === k ? { ...x, pdfText: text } : x)));
  // Dias do local: clique no 1º e no último (dentro do bloco). Local que já começou: só muda o último dia.
  const pickStopDay = (k: string, d: string) => {
    const st = stops.find((x) => x.key === k);
    const r = st && effOf(st);
    if (!st || !r || readOnly || !inWeek || d < s || d > e || d < today) return;
    const put = (a: string, b: string) => setStops((p) => p.map((x) => (x.key === k ? { ...x, from: a === s && b === e ? '' : a, to: a === s && b === e ? '' : b } : x)));
    if (r[0] < today) {
      if (d >= r[0]) put(r[0], d);
      return;
    }
    if (!stopAnchor || stopAnchor.key !== k) {
      setStopAnchor({ key: k, d });
      put(d, d);
    } else {
      put(stopAnchor.d <= d ? stopAnchor.d : d, stopAnchor.d <= d ? d : stopAnchor.d);
      setStopAnchor(null);
    }
  };

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
    if (stops.length === 0) return setError('Escolha ao menos um local.');
    if (!s || !e) return setError('Escolha os dias do bloco.');
    if (!started && s < today) return setError('Não dá para programar em dia que já passou.');
    if (e < today) return setError('O último dia do bloco já passou.');
    if (weekendIn.length > 0 && !weekendOk) return setError('Confirme o trabalho no fim de semana.');
    if (misfit.length > 0) return setError(`${misfit.length} preventiva(s) marcada(s) não cabem no prazo com esses dias: desmarque ou mude os dias.`);
    if (checkedPlan.length === 0 && fixedIds.length === 0 && woPlan.length === 0 && woFixedIds.length === 0)
      return setError(lot ? 'Nada marcado no bloco: use "Tirar o bloco".' : 'Marque ao menos uma preventiva ou um chamado.');
    if (usedNights.length > 0 && (!Number.isInteger(peopleN) || peopleN < 1)) return setError('Informe quantas pessoas dormem fora (número inteiro a partir de 1).');
    const stopsOut: BlockStop[] = stops.map((x) => {
      const r = effOf(x) || [s, e];
      return { ...rawLocal(x.key), from: r[0], to: r[1], pdfText: x.pdfText };
    });
    const whereOf = (k: string) => localLabel(rawLocal(k));
    const added = checkedPlan.filter((o) => o.lotId !== lot?.id).length;
    const pern = usedNights.length ? `, ${usedNights.length} noite(s) × ${peopleN} pessoa(s)` : '';
    const what = `${teamObj.label} · ${stops.length === 1 ? whereOf(stops[0].key) : `${stops.length} locais (${comarcas.map((c) => c || 'Sem comarca').join(', ')})`} (${dayTxt(days, s, e)})`;
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
        stops: stopsOut,
        note,
        nights: usedNights,
        people: usedNights.length ? peopleN : 0,
        plan: checkedPlan.map((o) => {
          const r = rangeOf(o) || [s, e];
          return { item: o, s: r[0], e: r[1], where: whereOf(localKey(o)) };
        }),
        fixedIds,
        drop,
        woPlan: woPlan.map((w) => {
          const r = woRange(w) || [s, e];
          return { item: w, s: r[0], e: r[1], where: w.comarca || 'Sem comarca' };
        }),
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
      await dbRemoveBlock(lot, editableLot, weekKey, user.name, `Tirou o bloco ${teamObj?.label || lot.technicianName} · ${placeTxt} (${editableLot.length} preventiva(s) voltaram para Novo${chs})`, lotWos);
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
  // Um grupo de preventivas (mesmo local, prazo e periodicidade); r = dias do local
  const groupBox = (k: string, list: ServiceOrder[], r: [string, string] | null) => {
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
            {late.length > 0 && r && (
              <p className="text-[10px] text-rose-700">
                {late.length === list.length ? 'Não cabem' : `${late.length} não cabem`} neste bloco: o prazo {o0.endDate && r && o0.endDate.slice(0, 10) < r[1] ? `acaba em ${br(o0.endDate)}` : `começa em ${br(o0.startDate)}`}. Mude os dias ou faça outro bloco.
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
  };

  const title = lot ? `Bloco — ${teamObj?.label || lot.technicianName} · ${stops.length ? placeTxt : 'sem local'}` : 'Novo bloco';
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
      <div className="space-y-3">
        <div className="grid sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-3">
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
            <p className={`mb-1.5 ${h}`}>
              2. Dias seguidos <span className="font-medium text-slate-500">(a viagem: clique no 1º e no último dia; sábado e domingo pedem confirmação)</span>
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
        </div>

        <div className={`${box} space-y-2`}>
          <p className={`${h} flex items-center gap-1`}>
            <MapPin className="w-4 h-4 text-indigo-600" />
            3. Locais do bloco {stops.length > 0 ? `— ${stops.length} ${stops.length > 1 ? 'locais' : 'local'}` : ''}
          </p>
          <p className="text-[10px] text-slate-500 leading-snug">
            Um bloco pode ter vários locais (roteiro). Cada local tem os <b>seus dias seguidos</b> dentro do bloco (clique no 1º e no último): as preventivas dele e os chamados da comarca ficam programados nesses dias.
          </p>
          {stops.map((st) => {
            const r = effOf(st);
            const l = rawLocal(st.key);
            const nPrev = checkedPlan.filter((o) => localKey(o) === st.key).length + fixedOrders.filter((o) => localKey(o) === st.key).length;
            const firstOfComarca = stops.find((x) => comarcaOf(x.key) === l.comarca)?.key === st.key;
            const nCh = firstOfComarca ? woPlan.filter((w) => (w.comarca || '') === l.comarca).length : 0;
            const locked = stopLocked(st.key);
            return (
              <div key={st.key} className="flex flex-wrap items-center gap-2 py-1 border-b border-slate-100 dark:border-slate-800 last:border-0">
                <span className="flex-1 min-w-[160px] text-[11px] font-black text-slate-800 dark:text-slate-100 flex items-start gap-1">
                  <MapPin className="w-3 h-3 mt-px shrink-0 text-indigo-600" />
                  {localLabel(l)}
                </span>
                {inWeek && r ? (
                  <span className="flex gap-0.5" title="Dias deste local">
                    {range.map((d) => {
                      const i = days.indexOf(d);
                      const on = d >= r[0] && d <= r[1];
                      const past = d < today;
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => pickStopDay(st.key, d)}
                          disabled={!!readOnly || past}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-black border cursor-pointer disabled:cursor-not-allowed ${on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-900 text-slate-400 border-slate-200 dark:border-slate-700'}`}
                        >
                          {DAY_LABEL[i]?.toLowerCase()}
                        </button>
                      );
                    })}
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-500">{r ? dayTxt(days, r[0], r[1]) : 'escolha os dias do bloco'}</span>
                )}
                <input
                  value={st.pdfText}
                  onChange={(ev) => setStopText(st.key, ev.target.value)}
                  maxLength={80}
                  disabled={!!readOnly}
                  title="Texto deste local no PDF"
                  placeholder={localLabel(l).toUpperCase()}
                  className="w-48 h-7 px-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[10px] font-bold"
                />
                <span className="w-24 text-[10px] font-bold text-emerald-700">
                  {nPrev} prev.{nCh ? ` · ${nCh} ch.` : ''}
                </span>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => removeStop(st.key)}
                    disabled={locked}
                    title={locked ? 'Há preventiva em execução ou concluída, ou chamado começado, neste local' : 'Tirar este local do bloco'}
                    className="text-rose-500 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
          {stopAnchor && <p className="text-[10px] font-bold text-indigo-600">Agora clique no último dia deste local (ou no mesmo dia para um dia só).</p>}
          {!readOnly && sameComarca.length > 0 && (
            <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Na mesma comarca, ainda a programar</p>
              {sameComarca.map((l) => (
                <p key={l.key} className="text-[11px] text-slate-700 dark:text-slate-300 flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-indigo-600 shrink-0" />
                  <span className="flex-1">
                    {localLabel(rawLocal(l.key))} · <b className="text-emerald-700">{l.count}</b>
                  </span>
                  {stops.length < MAX_STOPS && (
                    <button type="button" onClick={() => addStop(l.key)} className="text-[10px] font-black text-indigo-600 cursor-pointer shrink-0">
                      + adicionar
                    </button>
                  )}
                </p>
              ))}
            </div>
          )}
          {!readOnly && (
            <div className="space-y-2 p-2 rounded-lg border border-indigo-200 dark:border-indigo-900 bg-indigo-50/40 dark:bg-indigo-950/20">
              <p className="text-[10px] font-black uppercase tracking-wider text-indigo-700 dark:text-indigo-300">A programar nesta semana</p>
              <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                <button type="button" onClick={() => setPickTab('prev')} className={pickTabCls(pickTab === 'prev')}>
                  Preventivas ({nPrevFree})
                </button>
                <button type="button" onClick={() => setPickTab('ch')} className={pickTabCls(pickTab === 'ch')}>
                  Corretivas — chamados ({freeWos.length})
                </button>
              </div>
              <label className="relative block">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  value={findLocal}
                  onChange={(ev) => setFindLocal(ev.target.value)}
                  placeholder={pickTab === 'prev' ? 'Buscar comarca ou endereço...' : 'Buscar GLPI, comarca ou endereço...'}
                  className={`${input} pl-8`}
                />
              </label>
              <div className="max-h-64 overflow-y-auto space-y-1">
                {pickTab === 'prev' ? (
                  <>
                    {foundLocals.map((l) => {
                      const hot = !!l.minEnd && l.minEnd <= weekLast;
                      return (
                        <div
                          key={l.key}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border ${hot ? 'border-rose-300 bg-rose-50 dark:bg-rose-950/30' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'}`}
                        >
                          <MapPin className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                          <span className="flex-1 min-w-0 text-[11px] font-bold text-slate-800 dark:text-slate-100">
                            {localLabel(rawLocal(l.key))}
                            <span className="block text-[10px] font-medium">
                              <b className="text-emerald-700">
                                {l.count} preventiva{l.count > 1 ? 's' : ''}
                              </b>
                              {l.minEnd ? <span className={hot ? 'text-rose-700 font-black' : 'text-slate-500'}> · prazo até {br(l.minEnd)}{hot ? ' (vence nesta semana)' : ''}</span> : null}
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => addStop(l.key)}
                            disabled={stops.length >= MAX_STOPS}
                            className="h-7 px-2.5 rounded-lg bg-indigo-600 text-white text-[10px] font-black cursor-pointer disabled:opacity-40 shrink-0"
                          >
                            + Adicionar
                          </button>
                        </div>
                      );
                    })}
                    {foundLocals.length === 0 && <p className="text-[11px] text-slate-500">Nenhuma preventiva a programar nesta semana{term ? ' com essa busca' : ''}.</p>}
                    {props.notYet > 0 && (
                      <p className="text-[10px] text-slate-500 flex gap-1">
                        <Lock className="w-3 h-3 shrink-0 mt-px" />
                        Ainda não podem (o prazo começa na semana que vem): <b>{props.notYet}</b> preventiva{props.notYet > 1 ? 's' : ''}.
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    {foundWos.map((w) => {
                      const hot = !!w.deadline && w.deadline <= weekLast;
                      const cantAdd = stops.length >= MAX_STOPS && !comarcas.includes(w.comarca || '');
                      return (
                        <div
                          key={w.id}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border ${hot ? 'border-rose-300 bg-rose-50 dark:bg-rose-950/30' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'}`}
                        >
                          <Wrench className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                          <span className="flex-1 min-w-0 text-[11px] text-slate-700 dark:text-slate-200">
                            <b className="font-mono text-xs font-black text-indigo-700 dark:text-indigo-300">GLPI {w.glpi || '—'}</b>
                            <span className="font-mono text-[10px] text-slate-400"> {w.number}</span>
                            {w.intervencao ? ` · ${w.intervencao}` : ''}
                            <span className="block text-[10px] text-slate-500">
                              {w.comarca || 'Sem comarca'}
                              {w.execAddressText ? ` · ${w.execAddressText}` : ''} · {w.assignedTechnicianMatricula ? `com ${techLabel(w.assignedTechnicianMatricula, w.assignedTechnicianName)}` : 'sem técnico'}
                              {w.status === 'Pendente' ? ' (pendente)' : ''}
                            </span>
                            <span className={`block text-[10px] ${hot ? 'text-rose-700 font-black' : 'text-slate-500'}`}>
                              {w.deadline ? `prazo até ${br(w.deadline)}${hot ? (w.deadline < today ? ' (atrasado)' : ' (vence nesta semana)') : ''}` : 'sem prazo'}
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              addStop(`${w.comarca || ''}|${w.execAddressText || ''}`);
                              toggleWo(w.id, true);
                            }}
                            disabled={cantAdd}
                            className="h-7 px-2.5 rounded-lg bg-indigo-600 text-white text-[10px] font-black cursor-pointer disabled:opacity-40 shrink-0"
                          >
                            + Adicionar
                          </button>
                        </div>
                      );
                    })}
                    {foundWos.length === 0 && <p className="text-[11px] text-slate-500">Nenhum chamado esperando dia{term ? ' com essa busca' : ''}.</p>}
                  </>
                )}
              </div>
              {stops.length >= MAX_STOPS && <p className="text-[10px] font-bold text-amber-700">Máximo de {MAX_STOPS} locais no bloco.</p>}
            </div>
          )}
        </div>

        <div className={`${box} space-y-2`}>
          <p className={`${h} flex items-center gap-1`}>
            <ClipboardCheck className="w-4 h-4 text-emerald-600" />
            4. Preventivas {stops.length > 1 ? 'dos locais' : 'deste local'} — {checkedPlan.length + fixedIds.length} no bloco
          </p>
          {stops.length === 0 && <p className="text-[11px] text-slate-500">Escolha o local para ver as preventivas.</p>}
          {stops.map((st) => {
            const list = items.filter((o) => localKey(o) === st.key);
            const r = effOf(st);
            const isOpenStop = fold[st.key] ?? stops.length <= 2;
            const nOn = list.filter(isChecked).length + list.filter((o) => !editable(o)).length;
            return (
              <div key={st.key} className={stops.length > 1 ? 'rounded-lg border border-slate-200 dark:border-slate-700' : ''}>
                {stops.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setFold((p) => ({ ...p, [st.key]: !isOpenStop }))}
                    className="w-full px-2 py-1.5 flex items-center gap-1 text-[11px] font-black text-slate-800 dark:text-slate-100 bg-slate-50 dark:bg-slate-900 rounded-lg cursor-pointer"
                  >
                    {isOpenStop ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    <span className="truncate">{localLabel(rawLocal(st.key))}</span>
                    <span className="font-bold text-slate-500">· {r ? dayTxt(days, r[0], r[1]) : '—'}</span>
                    <span className="ml-auto text-emerald-700">
                      {nOn} de {list.length}
                    </span>
                  </button>
                )}
                {isOpenStop && (
                  <div className={stops.length > 1 ? 'p-2 space-y-2' : 'space-y-2'}>
                    {list.length === 0 && <p className="text-[11px] text-slate-500">Nenhuma preventiva aguardando programação neste local.</p>}
                    {groupsOf(list).map(([k, glist]) => groupBox(k, glist, r))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className={`${box} space-y-2`}>
          <p className={`${h} flex items-center gap-1`}>
            <Wrench className="w-4 h-4 text-indigo-600" />
            Chamados GLPI {comarcas.length === 1 ? `de ${comarcas[0] || 'Sem comarca'}` : comarcas.length > 1 ? 'das comarcas do bloco' : 'da comarca'} — {woPlan.length + woFixedIds.length} no bloco
          </p>
          {stops.length === 0 && <p className="text-[11px] text-slate-500">Escolha o local para ver os chamados abertos da comarca.</p>}
          {stops.length > 0 && woItems.length === 0 && <p className="text-[11px] text-slate-500">Nenhum chamado aberto {comarcas.length > 1 ? 'nestas comarcas' : 'nesta comarca'}.</p>}
          {woFixedIds.length > 0 && <p className="text-[10px] text-slate-500">{woFixedIds.length} chamado(s) do bloco já concluído(s): continuam no bloco.</p>}
          {woItems.map((w) => {
            const blocked = woBlocked(w);
            const checked = woChecked(w);
            const mine = !!team && w.assignedTechnicianMatricula === team;
            const lateDeadline = !!w.deadline && !!e && w.deadline.slice(0, 10) < (woRange(w)?.[1] || e);
            const wr = woRange(w);
            const gone = !comarcas.includes(w.comarca || '');
            const state = gone
              ? 'a comarca saiu do bloco: perde o dia e continua com o técnico'
              : !team
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
                <button type="button" disabled={!!readOnly || blocked || !team || gone} onClick={() => toggleWo(w.id, !checked)} className="mt-px cursor-pointer disabled:cursor-not-allowed">
                  {check(checked, !!readOnly || blocked || !team || gone)}
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-slate-800 dark:text-slate-100">
                    <span className="font-mono text-xs font-black text-indigo-700 dark:text-indigo-300">GLPI {w.glpi || '—'}</span>
                    <span className="font-mono text-[10px] text-slate-400"> {w.number || w.id}</span>
                    {w.intervencao ? ` · ${w.intervencao}` : ''}
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
                  <p className={`text-[10px] ${blocked ? 'text-rose-700' : team && !mine && w.assignedTechnicianMatricula ? 'text-amber-800' : 'text-slate-600 dark:text-slate-400'}`}>
                    {state}
                    {checked && wr && stops.length > 1 ? ` · dia: ${dayTxt(days, wr[0], wr[1])}` : ''}
                  </p>
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

        <label className="block">
          <span className={`block mb-1 ${h}`}>Observação</span>
          <input value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={300} disabled={!!readOnly} placeholder="Ex.: hotel reservado" className={input} />
        </label>
        {!readOnly && (drop.length > 0 || woDrop.length > 0) && (
          <p className="p-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 text-[11px] font-bold text-amber-900 dark:text-amber-200 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
            <span>
              Ao salvar:
              {drop.length > 0 && ` ${drop.length} preventiva(s) voltam para "Novo"`}
              {drop.length > 0 && woDrop.length > 0 && ' e'}
              {woDrop.length > 0 && ` ${woDrop.length} chamado(s) perdem o dia (continuam com o técnico)`}.
            </span>
          </p>
        )}
        {error && (
          <p ref={errorRef} className="text-xs font-bold text-rose-600">
            {error}
          </p>
        )}
      </div>
    </Shell>
  );
}
