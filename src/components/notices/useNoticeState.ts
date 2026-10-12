import { useEffect, useState } from 'react';
import { Notice } from '../../types';
import { dbConfirmNotice, dbHasConfirmedNotice } from '../../db/notices';
import { markNotices, noticeIds } from '../../lib/noticeSeen';

// QUADRO DE AVISOS: "novo" (ainda não visto neste aparelho) e "Li e estou ciente" dos urgentes.
// Urgente que o aparelho não sabe se já foi confirmado: confere no banco 1 vez por sessão (1 leitura).
const checked = new Set<string>();

export function useNoticeState(matricula: string, name: string, list: Notice[]) {
  const [seen, setSeen] = useState(() => noticeIds(matricula, 'seen'));
  const [confirmed, setConfirmed] = useState(() => noticeIds(matricula, 'confirmed'));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const reload = () => {
      setSeen(noticeIds(matricula, 'seen'));
      setConfirmed(noticeIds(matricula, 'confirmed'));
    };
    reload();
    window.addEventListener('hexon-notices-seen', reload);
    return () => window.removeEventListener('hexon-notices-seen', reload);
  }, [matricula]);

  const openUrgent = list.filter((n) => n.kind === 'urgente' && !confirmed.has(n.id)).map((n) => n.id);
  const urgentKey = openUrgent.join('|');
  useEffect(() => {
    openUrgent
      .filter((id) => !checked.has(`${matricula}|${id}`))
      .forEach((id) => {
        checked.add(`${matricula}|${id}`);
        dbHasConfirmedNotice(id, matricula).then((ok) => ok && markNotices(matricula, 'confirmed', [id]));
      });
  }, [urgentKey, matricula]);

  const confirm = async (id: string) => {
    setBusy(id);
    setError('');
    try {
      await dbConfirmNotice(id, { matricula, name });
      markNotices(matricula, 'confirmed', [id]);
    } catch (err: any) {
      setError(err?.code === 'permission-denied' ? 'O banco recusou a confirmação.' : `Não foi possível gravar: ${err?.message || err}`);
    } finally {
      setBusy('');
    }
  };

  const isNew = (n: Notice) => !seen.has(n.id) && n.createdBy.matricula !== matricula;
  const needs = (n: Notice) => n.kind === 'urgente' && !confirmed.has(n.id);
  return {
    isNew,
    needs,
    confirm,
    busy,
    error,
    pending: list.filter((n) => isNew(n) || needs(n)).length,
    markSeen: (ids: string[]) =>
      markNotices(
        matricula,
        'seen',
        ids.filter((id) => !seen.has(id))
      )
  };
}
