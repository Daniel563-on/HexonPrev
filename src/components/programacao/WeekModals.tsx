import React, { useMemo, useState } from 'react';
import { ArrowRightLeft, Search, Star, X } from 'lucide-react';
import { Absence, AbsenceKind, DayMarkKind, HexonUser, OrderParticipant, ServiceOrder, WeekLogEntry } from '../../types';
import { dbSaveAbsence, UnitPersonInfo } from '../../db/firebase';
import { DAY_LONG, brFull } from './weekDates';

// PROGRAMAÇÃO › SEMANA (Fase 7B): janelas da semana — marcar o dia, equipe desta semana, férias/atestado e a lista do dia.

export const MARK_LABEL: Record<DayMarkKind, string> = { feriado: 'Feriado', ponto: 'Ponto facultativo', municipal: 'Feriado municipal', outro: 'Outro' };
export const ABSENCE_KINDS: AbsenceKind[] = ['Férias', 'Atestado', 'Licença', 'Outro'];

export function Shell({
  title,
  sub,
  onClose,
  children,
  footer,
  width = 'max-w-2xl'
}: {
  title: string;
  sub: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
  width?: string;
}) {
  return (
    <div className="fixed inset-0 z-[1400] bg-slate-900/60 flex items-center justify-center p-3">
      <div className={`w-full ${width} max-h-full flex flex-col rounded-2xl bg-white dark:bg-[#0b1220] border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden`} style={{ borderTop: '4px solid #4f46e5' }}>
        <div className="shrink-0 px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black text-slate-900 dark:text-white">{title}</p>
            <p className="text-[11px] text-slate-500">{sub}</p>
          </div>
          <button type="button" onClick={onClose} className="h-8 w-8 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center cursor-pointer" title="Fechar">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-3 text-xs">{children}</div>
        <div className="shrink-0 px-5 py-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap justify-between gap-2">{footer}</div>
      </div>
    </div>
  );
}
export const btn = 'px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-bold cursor-pointer disabled:opacity-50';
export const btnMain = 'px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-black cursor-pointer disabled:opacity-50';
export const input = 'w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold';
const chipOpt = (on: boolean) =>
  `px-3 py-2 rounded-lg border text-xs font-bold cursor-pointer ${on ? 'border-rose-400 bg-rose-50 text-rose-700' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`;

// ··· no dia: feriado, ponto facultativo, feriado municipal ou outro (não bloqueia nada)
export function DayMarkModal(props: {
  day: string;
  index: number;
  mark?: { kind: DayMarkKind; text: string };
  onSave: (m: { kind: DayMarkKind; text: string } | null) => Promise<boolean>;
  onClose: () => void;
}) {
  const { day, index, mark, onSave, onClose } = props;
  const [kind, setKind] = useState<DayMarkKind>(mark?.kind || 'feriado');
  const [text, setText] = useState(mark?.text || '');
  const [saving, setSaving] = useState(false);
  const run = async (m: { kind: DayMarkKind; text: string } | null) => {
    setSaving(true);
    const ok = await onSave(m);
    setSaving(false);
    if (ok) onClose();
  };
  return (
    <Shell
      title={`Marcar o dia — ${DAY_LONG[index]}, ${brFull(day)}`}
      sub="Vale para esta gerência e empresa. Marcar o dia não bloqueia nada."
      onClose={onClose}
      width="max-w-xl"
      footer={
        <>
          {mark ? (
            <button type="button" className={btn} disabled={saving} onClick={() => run(null)}>
              Desmarcar
            </button>
          ) : (
            <span />
          )}
          <button type="button" className={btnMain} disabled={saving} onClick={() => run({ kind, text: text.trim().slice(0, 80) })}>
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </>
      }
    >
      <div className="flex flex-wrap gap-2">
        {(Object.keys(MARK_LABEL) as DayMarkKind[]).map((k) => (
          <button key={k} type="button" className={chipOpt(kind === k)} onClick={() => setKind(k)}>
            {MARK_LABEL[k]}
          </button>
        ))}
      </div>
      <input value={text} onChange={(e) => setText(e.target.value)} maxLength={80} placeholder="Ex.: Nossa Senhora Aparecida" className={input} />
    </Shell>
  );
}

// ✎ Equipe desta semana: começa igual à cadastrada; mudar aqui vale só para a semana
export function TeamWeekModal(props: {
  title: string;
  respName: string;
  members: OrderParticipant[]; // equipe desta semana agora
  base: OrderParticipant[]; // equipe cadastrada
  people: UnitPersonInfo[];
  respMatricula: string;
  placeOf: (mat: string) => { label: string; resp: boolean } | null; // onde a pessoa está nesta semana (fora desta equipe)
  onSave: (members: OrderParticipant[]) => Promise<boolean>;
  onReset: () => Promise<boolean>;
  onClose: () => void;
}) {
  const { title, respName, base, people, respMatricula, placeOf, onSave, onReset, onClose } = props;
  const [members, setMembers] = useState<OrderParticipant[]>(props.members);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const baseSet = new Set(base.map((m) => m.matricula));
  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const taken = new Set([respMatricula, ...members.map((m) => m.matricula)]);
    return people.filter((p) => !taken.has(p.matricula) && `${p.name} ${p.matricula}`.toLowerCase().includes(q)).slice(0, 8);
  }, [people, search, members, respMatricula]);
  const run = async (fn: () => Promise<boolean>) => {
    setError('');
    if (search.trim()) return setError('Escolha a pessoa na lista da busca (ou apague o texto) antes de salvar.');
    setSaving(true);
    const ok = await fn();
    setSaving(false);
    if (ok) onClose();
  };
  return (
    <Shell
      title={title}
      sub="Começa igual à equipe cadastrada. Mudar aqui vale só para esta semana; o cadastro não muda."
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} disabled={saving} onClick={() => run(onReset)}>
            Voltar para a equipe cadastrada
          </button>
          <div className="flex gap-2">
            <button type="button" className={btn} onClick={onClose}>
              Cancelar
            </button>
            <button type="button" className={btnMain} disabled={saving} onClick={() => run(() => onSave(members))}>
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </>
      }
    >
      <div className="flex flex-wrap gap-2">
        <span className="px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 font-bold flex items-center gap-1">
          <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-500" />
          {respName} · responsável
        </span>
        {members.map((m) => (
          <span
            key={m.matricula}
            className={`px-3 py-1.5 rounded-lg border font-bold flex items-center gap-1 ${baseSet.has(m.matricula) ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-amber-300 bg-amber-50 text-amber-900'}`}
          >
            {!baseSet.has(m.matricula) && <ArrowRightLeft className="w-3.5 h-3.5" />}
            {m.name}
            <button type="button" className="cursor-pointer" title="Tirar desta semana" onClick={() => setMembers(members.filter((x) => x.matricula !== m.matricula))}>
              <X className="w-3.5 h-3.5" />
            </button>
          </span>
        ))}
      </div>
      <label className="relative block">
        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Trazer pessoa: nome ou matrícula..." className={`${input} pl-8 font-semibold`} />
      </label>
      {results.map((p) => {
        const place = placeOf(p.matricula);
        return (
          <div key={p.matricula} className={`p-2 rounded-lg border flex items-center justify-between gap-2 ${place ? 'border-amber-200 bg-amber-50' : 'border-slate-200 dark:border-slate-700'}`}>
            <span>
              <b>{p.name}</b> · {p.matricula}
              {p.cargo ? ` · ${p.cargo}` : ''}
              {place ? <span className="text-amber-800 font-bold"> · nesta semana na {place.label}</span> : <span className="text-slate-500"> · sem equipe nesta semana</span>}
            </span>
            {place?.resp ? (
              <span className="text-[11px] font-bold text-slate-400">responsável de lá</span>
            ) : (
              <button
                type="button"
                className="text-indigo-700 font-black cursor-pointer"
                onClick={() => {
                  setMembers([...members, { matricula: p.matricula, name: p.name, cargo: p.cargo }]);
                  setSearch('');
                }}
              >
                {place ? `trazer (sai da ${place.label} nesta semana)` : 'trazer'}
              </button>
            )}
          </div>
        );
      })}
      <p className="text-[11px] text-slate-500">
        Quem vem de outra equipe <b>sai dela nesta semana</b>. O responsável não muda aqui (muda no cadastro, em Equipes).
      </p>
      {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
    </Shell>
  );
}

// Lançar férias, atestado, licença ou outro (vale pelas datas, em todas as semanas do período)
export function AbsenceForm(props: {
  absence: Absence | null;
  people: UnitPersonInfo[];
  unit: string;
  company: string;
  companyName: string;
  user: HexonUser;
  onSaved: (a: Absence) => void;
  onClose: () => void;
}) {
  const { absence, people, unit, company, companyName, user, onSaved, onClose } = props;
  const [kind, setKind] = useState<AbsenceKind>(absence?.kind || 'Férias');
  const [person, setPerson] = useState<OrderParticipant | null>(absence ? { matricula: absence.matricula, name: absence.name, cargo: absence.cargo } : null);
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState(absence?.from || '');
  const [to, setTo] = useState(absence?.to || '');
  const [note, setNote] = useState(absence?.note || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? people.filter((p) => `${p.name} ${p.matricula}`.toLowerCase().includes(q)).slice(0, 8) : [];
  }, [people, search]);
  const save = async () => {
    setError('');
    if (!person) return setError('Escolha a pessoa.');
    if (!from || !to) return setError('Informe as datas de início e de fim.');
    if (from > to) return setError('A data de fim não pode ser antes da de início.');
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const saved = await dbSaveAbsence({
        id: absence?.id || '',
        unit,
        company,
        matricula: person.matricula,
        name: person.name,
        cargo: person.cargo || '',
        kind,
        from,
        to,
        note: note.trim() ? note.trim().slice(0, 300) : undefined,
        createdAt: absence?.createdAt || now,
        createdBy: absence?.createdBy || user.name,
        updatedAt: absence ? now : undefined,
        updatedBy: absence ? user.name : undefined
      });
      onSaved(saved);
      onClose();
    } catch (err: any) {
      setError(err?.code === 'permission-denied' ? 'O banco recusou: seu perfil não tem "Programar" nesta gerência.' : `Não foi possível salvar: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Shell
      title={absence ? 'Editar ausência' : 'Lançar férias ou atestado'}
      sub={`${companyName} · ${unit}. Vale pelas datas: aparece em todas as semanas do período.`}
      onClose={onClose}
      footer={
        <>
          <span />
          <div className="flex gap-2">
            <button type="button" className={btn} onClick={onClose}>
              Cancelar
            </button>
            <button type="button" className={btnMain} disabled={saving} onClick={save}>
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </>
      }
    >
      <div className="flex flex-wrap gap-2">
        {ABSENCE_KINDS.map((k) => (
          <button key={k} type="button" className={chipOpt(kind === k)} onClick={() => setKind(k)}>
            {k}
          </button>
        ))}
      </div>
      {person ? (
        <div className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2">
          <span>
            <b>{person.name}</b> · {person.matricula}
            {person.cargo ? ` · ${person.cargo}` : ''}
          </span>
          {!absence && (
            <button type="button" className="text-indigo-700 font-black cursor-pointer" onClick={() => setPerson(null)}>
              trocar
            </button>
          )}
        </div>
      ) : (
        <>
          <label className="relative block">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pessoa: nome ou matrícula..." className={`${input} pl-8 font-semibold`} />
          </label>
          {results.map((p) => (
            <button
              key={p.matricula}
              type="button"
              onClick={() => {
                setPerson({ matricula: p.matricula, name: p.name, cargo: p.cargo });
                setSearch('');
              }}
              className="w-full text-left p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-indigo-300 cursor-pointer"
            >
              <b>{p.name}</b> · {p.matricula}
              {p.cargo ? ` · ${p.cargo}` : ''}
            </button>
          ))}
        </>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className="block font-black text-slate-700 dark:text-slate-300 mb-1">De</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} />
        </label>
        <label>
          <span className="block font-black text-slate-700 dark:text-slate-300 mb-1">Até</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={input} />
        </label>
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Observação (opcional)" className={input} />
      <p className="text-[11px] text-slate-500">Nesses dias a pessoa sai da equipe na grade e conta como ausente no resumo.</p>
      {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
    </Shell>
  );
}

// Preventivas de um local num dia (clique abre em Ordens de Serviço › Preventivas, já buscando pelo número)
export function DayListModal(props: { title: string; sub: string; orders: ServiceOrder[]; onOpen: (o: ServiceOrder) => void; onClose: () => void }) {
  const { title, sub, orders, onOpen, onClose } = props;
  return (
    <Shell
      title={title}
      sub={sub}
      onClose={onClose}
      footer={
        <>
          <span />
          <button type="button" className={btn} onClick={onClose}>
            Fechar
          </button>
        </>
      }
    >
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[60vh] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-[10px] font-black uppercase text-slate-500">
            <tr>
              <th className="p-2 text-left">Nº</th>
              <th className="p-2 text-left">Ativo</th>
              <th className="p-2 text-left">Situação</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b border-slate-100 dark:border-slate-800">
                <td className="p-2 font-mono font-black text-indigo-700 dark:text-indigo-300">{o.id}</td>
                <td className="p-2">{o.assetName || o.title}</td>
                <td className="p-2 font-bold">{o.status}</td>
                <td className="p-2 text-right">
                  <button type="button" onClick={() => onOpen(o)} className="text-indigo-700 dark:text-indigo-300 font-black cursor-pointer">
                    Abrir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500">Abrir leva a Ordens de Serviço › Preventivas já buscando pelo número. Trocar técnico ou dia continua no PMOC por enquanto.</p>
    </Shell>
  );
}

// Histórico da semana (Fase 7C): quem mudou o quê, do mais novo para o mais antigo
export function WeekHistoryModal(props: { title: string; log: WeekLogEntry[]; onClose: () => void }) {
  const { title, log, onClose } = props;
  const rows = [...log].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <Shell
      title={title}
      sub="Quem mudou o quê na programação desta semana. Cada preventiva também guarda na própria linha do tempo quando foi programada, para quem e por quem."
      onClose={onClose}
      width="max-w-3xl"
      footer={
        <>
          <span />
          <button type="button" className={btn} onClick={onClose}>
            Fechar
          </button>
        </>
      }
    >
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[60vh] overflow-y-auto">
        {rows.length === 0 && <p className="p-4 text-center text-slate-500">Nenhuma mudança registrada nesta semana.</p>}
        {rows.map((r, i) => (
          <div key={`${r.at}${i}`} className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 flex gap-3">
            <span className="font-mono text-[11px] text-slate-500 shrink-0">{new Date(r.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
            <span className="font-bold text-slate-800 dark:text-slate-200 shrink-0 w-32 truncate">{r.by}</span>
            <span className="text-slate-700 dark:text-slate-300">{r.text}</span>
          </div>
        ))}
      </div>
    </Shell>
  );
}

// Acompanhar (Fase 7C): equipe cujo responsável não é técnico (ex.: Engenharia) acompanha um bloco de outra equipe.
// Aparece na linha dela e (na 7D) no PDF; não muda nenhuma OS.
export function VisitModal(props: {
  teamLabel: string;
  options: { lotId: string; text: string }[];
  current: string[];
  onSave: (lotId: string, on: boolean) => Promise<boolean>;
  onClose: () => void;
}) {
  const { teamLabel, options, current, onSave, onClose } = props;
  const [busy, setBusy] = useState('');
  const act = async (lotId: string, on: boolean) => {
    setBusy(lotId);
    await onSave(lotId, on);
    setBusy('');
  };
  return (
    <Shell
      title={`${teamLabel} — acompanhar um bloco`}
      sub="Escolha o bloco de outra equipe que esta equipe vai acompanhar nesta semana. Não muda nenhuma OS."
      onClose={onClose}
      footer={
        <>
          <span />
          <button type="button" className={btn} onClick={onClose}>
            Fechar
          </button>
        </>
      }
    >
      <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
        {options.length === 0 && <p className="text-slate-500">Nenhum bloco de outra equipe nesta semana.</p>}
        {options.map((o) => {
          const on = current.includes(o.lotId);
          return (
            <div key={o.lotId} className={`p-2 rounded-lg border flex items-center gap-2 ${on ? 'border-slate-500 bg-slate-100 dark:bg-slate-800' : 'border-slate-200 dark:border-slate-700'}`}>
              <span className="flex-1 text-[11px] font-bold text-slate-800 dark:text-slate-200">{o.text}</span>
              <button type="button" disabled={!!busy} onClick={() => act(o.lotId, !on)} className={`px-3 py-1.5 rounded-lg text-[11px] font-black cursor-pointer disabled:opacity-50 ${on ? 'border border-rose-200 text-rose-600' : 'bg-indigo-600 text-white'}`}>
                {busy === o.lotId ? '...' : on ? 'Deixar de acompanhar' : 'Acompanhar'}
              </button>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
