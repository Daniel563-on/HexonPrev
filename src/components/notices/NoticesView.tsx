import React, { useEffect, useMemo, useState } from 'react';
import { Megaphone, Pin, PinOff, Plus, Search } from 'lucide-react';
import { Company, HexonUser, Notice, NoticeKind } from '../../types';
import { NOTICE_ALL_UNITS, dbDeleteNotice, dbEndNotice, dbGetEndedNotices, dbSaveNotice, noticeActive, noticeTargets, sortNotices, NoticeViewer } from '../../db/notices';
import { dbGetCompanies } from '../../db/companies';
import NoticeCard, { NOTICE_KINDS } from './NoticeCard';
import NoticeForm from './NoticeForm';
import NoticeReads from './NoticeReads';
import { useNoticeState } from './useNoticeState';

// QUADRO DE AVISOS (computador). Avisos que valem, em tempo real (a escuta fica no App); quem publica vê também
// os de outros públicos das suas gerências e os encerrados nos últimos 90 dias.
export default function NoticesView(props: {
  notices: Notice[];
  user: HexonUser;
  viewer: NoticeViewer;
  unitOptions: string[]; // gerências que a pessoa vê (para publicar e filtrar)
  canPublish: boolean;
}) {
  const { notices, user, viewer, unitOptions, canPublish } = props;
  const [companies, setCompanies] = useState<Company[]>([]);
  const [tab, setTab] = useState<'ativos' | 'encerrados'>('ativos');
  const [ended, setEnded] = useState<Notice[] | null>(null);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<NoticeKind | ''>('');
  const [unit, setUnit] = useState('');
  const [editing, setEditing] = useState<Notice | null | 'new'>(null);
  const [readsOf, setReadsOf] = useState<Notice | null>(null);
  const [askDelete, setAskDelete] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    dbGetCompanies()
      .then(setCompanies)
      .catch(() => setCompanies([]));
  }, []);

  const seesAll = viewer.units === null;
  const canManage = (n: Notice) => canPublish && (seesAll || (!n.units.includes(NOTICE_ALL_UNITS) && n.units.every((u) => unitOptions.includes(u))));
  const mine = useMemo(() => notices.filter((n) => noticeActive(n) && noticeTargets(n, viewer)), [notices, viewer]);
  const state = useNoticeState(user.matricula, user.name, mine);

  // Abrir a página = viu os avisos que são para ela
  const mineKey = mine.map((n) => n.id).join('|');
  useEffect(() => {
    if (mine.length) state.markSeen(mine.map((n) => n.id));
  }, [mineKey]);

  useEffect(() => {
    if (tab !== 'encerrados') return;
    setEnded(null);
    dbGetEndedNotices(seesAll ? null : unitOptions)
      .then(setEnded)
      .catch((err) => {
        setEnded([]);
        setMsg(`Não foi possível carregar os encerrados: ${err?.message || err}`);
      });
  }, [tab]);

  // Quem publica vê também os avisos das suas gerências feitos para outro público ou empresa
  const base = tab === 'ativos' ? notices.filter((n) => noticeActive(n) && (canManage(n) || noticeTargets(n, viewer))) : ended || [];
  const q = search.trim().toLowerCase();
  const shown = sortNotices(
    base.filter(
      (n) => (!kind || n.kind === kind) && (!unit || n.units.includes(unit) || n.units.includes(NOTICE_ALL_UNITS)) && (!q || n.title.toLowerCase().includes(q) || n.text.toLowerCase().includes(q))
    )
  );

  const run = async (fn: () => Promise<unknown>) => {
    setMsg('');
    try {
      await fn();
      if (tab === 'encerrados') setTab('ativos');
    } catch (err: any) {
      setMsg(err?.code === 'permission-denied' ? 'O banco recusou: seu perfil não pode mexer neste aviso.' : `Não foi possível: ${err?.message || err}`);
    }
  };
  const by = { matricula: user.matricula, name: user.name };
  const btn =
    'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-700 dark:text-slate-200 hover:border-indigo-300 cursor-pointer';

  const actionsOf = (n: Notice) => {
    if (!canManage(n)) return undefined;
    if (askDelete === n.id)
      return (
        <>
          <span className="text-[11px] font-bold text-rose-600 self-center">Excluir de vez?</span>
          <button type="button" className={`${btn} border-rose-300 text-rose-700`} onClick={() => run(() => dbDeleteNotice(n)).then(() => setAskDelete(''))}>
            Sim, excluir
          </button>
          <button type="button" className={btn} onClick={() => setAskDelete('')}>
            Não
          </button>
        </>
      );
    return (
      <>
        {tab === 'ativos' && (
          <button
            type="button"
            className={btn}
            onClick={() =>
              run(() =>
                dbSaveNotice({
                  ...n,
                  pinned: !n.pinned,
                  updatedAt: new Date().toISOString(),
                  updatedBy: by
                })
              )
            }
          >
            {n.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
            {n.pinned ? 'Desafixar' : 'Fixar'}
          </button>
        )}
        <button type="button" className={btn} onClick={() => setEditing(n)}>
          {tab === 'ativos' ? 'Editar' : 'Editar e reabrir'}
        </button>
        {n.kind === 'urgente' && (
          <button type="button" className={btn} onClick={() => setReadsOf(n)}>
            Quem leu
          </button>
        )}
        {tab === 'ativos' && (
          <button type="button" className={btn} onClick={() => run(() => dbEndNotice(n, by))}>
            Encerrar
          </button>
        )}
        <button type="button" className={`${btn} text-rose-700`} onClick={() => setAskDelete(n.id)}>
          Excluir
        </button>
      </>
    );
  };

  const sel = 'h-9 px-2 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900';
  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-5xl mx-auto w-full">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Megaphone className="w-5 h-5 text-indigo-600" />
          <p className="text-xs text-slate-500">Comunicados da gerência. Aviso novo aparece sozinho; urgente pede "Li e estou ciente".</p>
        </div>
        {canPublish && (
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-black cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Novo aviso
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {canPublish && (
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden text-xs font-bold">
            {(['ativos', 'encerrados'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`px-3 py-2 cursor-pointer ${tab === t ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'}`}
              >
                {t === 'ativos' ? 'Valendo' : 'Encerrados (90 dias)'}
              </button>
            ))}
          </div>
        )}
        <label className="relative flex-1 min-w-[180px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar no título ou no texto" className={`${sel} w-full pl-8 font-medium`} />
        </label>
        <select value={kind} onChange={(e) => setKind(e.target.value as NoticeKind | '')} className={sel} title="Tipo">
          <option value="">Todos os tipos</option>
          {(Object.keys(NOTICE_KINDS) as NoticeKind[]).map((k) => (
            <option key={k} value={k}>
              {NOTICE_KINDS[k].label}
            </option>
          ))}
        </select>
        {unitOptions.length > 1 && (
          <select value={unit} onChange={(e) => setUnit(e.target.value)} className={sel} title="Gerência">
            <option value="">Todas as gerências</option>
            {unitOptions.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        )}
      </div>

      {(msg || state.error) && <p className="text-xs font-bold text-rose-600">{msg || state.error}</p>}
      {tab === 'encerrados' && ended === null && <p className="text-xs text-slate-500">Carregando…</p>}
      {shown.length === 0 && !(tab === 'encerrados' && ended === null) && (
        <p className="p-8 text-center text-sm text-slate-500 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
          {tab === 'ativos' ? 'Nenhum aviso valendo agora.' : 'Nenhum aviso encerrado nos últimos 90 dias.'}
        </p>
      )}
      <div className="space-y-3">
        {shown.map((n) => {
          const forMe = tab === 'ativos' && noticeTargets(n, viewer);
          return (
            <NoticeCard
              key={n.id}
              notice={n}
              companies={companies}
              isNew={forMe && state.isNew(n)}
              showTarget={canPublish}
              confirm={forMe && n.kind === 'urgente' ? (state.needs(n) ? 'need' : 'done') : undefined}
              confirming={state.busy === n.id}
              onConfirm={() => state.confirm(n.id)}
              actions={actionsOf(n)}
            />
          );
        })}
      </div>

      {editing && (
        <NoticeForm
          notice={editing === 'new' ? null : editing}
          user={user}
          unitOptions={unitOptions}
          canAllUnits={seesAll}
          companies={companies}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            if (tab === 'encerrados') setTab('ativos');
          }}
        />
      )}
      {readsOf && <NoticeReads notice={readsOf} allUnits={unitOptions} onClose={() => setReadsOf(null)} />}
    </div>
  );
}
