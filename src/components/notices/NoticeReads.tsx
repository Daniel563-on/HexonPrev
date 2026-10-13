import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { HexonUser, Notice, NoticeRead } from '../../types';
import { NOTICE_ALL_UNITS, dbListNoticeReads, noticeTargets } from '../../db/notices';
import { syncedList } from '../../db/localSync';
import { brDate } from './NoticeCard';

// QUADRO DE AVISOS: quem já tocou em "Li e estou ciente" e quem falta (usuários ativos para quem o aviso é,
// pela cópia de usuários guardada no aparelho: 0 leitura; os "ciente" = 1 leitura por pessoa que confirmou).
export default function NoticeReads({ notice, allUnits, onClose }: { notice: Notice; allUnits: string[]; onClose: () => void }) {
  const [reads, setReads] = useState<NoticeRead[] | null>(null);
  const [missing, setMissing] = useState<HexonUser[] | null>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let alive = true;
    const units = notice.units.includes(NOTICE_ALL_UNITS) ? allUnits : notice.units;
    Promise.all([dbListNoticeReads(notice.id), Promise.all(units.map((u) => syncedList<HexonUser>('users', u, [['gerencia', u]])))])
      .then(([r, lists]) => {
        if (!alive) return;
        const done = new Set(r.map((x) => x.matricula));
        const people = lists
          .flat()
          .filter((u) => u.status === 'Ativo' && u.matricula && !done.has(u.matricula))
          .filter((u) =>
            noticeTargets(notice, {
              perfil: u.perfil,
              units: [u.gerencia],
              companies: u.perfil === 'Profissional' ? u.companies || [] : null
            })
          );
        setReads(r);
        setMissing(Array.from(new Map(people.map((u) => [u.matricula, u])).values()).sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch((err) => alive && setMsg(`Não foi possível carregar: ${err?.message || err}`));
    return () => {
      alive = false;
    };
  }, [notice.id]);

  const total = reads && missing ? reads.length + missing.length : null;
  return (
    <div className="fixed inset-0 z-[1500] bg-slate-900/70 flex items-start md:items-center justify-center p-2 md:p-4">
      <div className="w-full max-w-xl max-h-full flex flex-col bg-white dark:bg-[#0b1220] rounded-2xl shadow-2xl overflow-hidden">
        <div className="shrink-0 px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-black text-slate-900 dark:text-white truncate">Quem leu — {notice.title}</p>
            <p className="text-[11px] text-slate-500">{total === null ? 'Carregando…' : `${reads!.length} de ${total} marcaram "Li e estou ciente"`}</p>
          </div>
          <button type="button" onClick={onClose} className="h-8 w-8 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center cursor-pointer shrink-0" title="Fechar">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          {msg && <p className="text-rose-600 font-bold sm:col-span-2">{msg}</p>}
          <div>
            <p className="font-black text-emerald-700 dark:text-emerald-400 mb-1.5">Confirmaram ({reads?.length ?? '…'})</p>
            <ul className="space-y-1">
              {(reads || []).map((r) => (
                <li key={r.matricula} className="text-slate-700 dark:text-slate-200">
                  {r.name}{' '}
                  <span className="text-slate-400">
                    · {r.matricula} · {brDate(r.at)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-black text-rose-600 dark:text-rose-400 mb-1.5">Faltam ({missing?.length ?? '…'})</p>
            <ul className="space-y-1">
              {(missing || []).map((u) => (
                <li key={u.matricula} className="text-slate-700 dark:text-slate-200">
                  {u.name} <span className="text-slate-400">· {u.matricula}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
