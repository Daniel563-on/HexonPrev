import React, { useState } from 'react';
import { Smartphone } from 'lucide-react';
import { HexonUser, ServiceOrder } from '../../../types';
import { dbSaveServiceOrder, runBulk, timelineEvent } from '../../../db/firebase';
import { formatOrderNumber } from '../../../utils/orderNumber';
import { Shell, btn, btnMain } from '../../programacao/WeekModals';
import { LocalTechOption, localTechGroups, localTechLabel } from '../../../lib/localTech';

// ATRIBUIR AO TÉCNICO LOCAL (Lote 2): as preventivas marcadas vão para o técnico local, sem dia e sem pernoite
// (ficam "Planejada" sem dia programado e fora da Programação da gerência). Ele recebe no celular e faz dentro do prazo.

interface Props {
  user: HexonUser;
  unit: string;
  orders: ServiceOrder[]; // mesma empresa
  localTechs: LocalTechOption[]; // já filtrados pela empresa das preventivas
  comarca?: string; // comarca do local marcado (quem atua nela aparece primeiro)
  where: string; // texto do local (ou "N locais")
  onDone: (msg: string) => void;
  onClose: () => void;
}

const br = (d?: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');

export default function AssignLocalModal({ user, unit, orders, localTechs, comarca, where, onDone, onClose }: Props) {
  const [tech, setTech] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const groups = localTechGroups(localTechs, comarca);
  const lastEnd = orders.reduce((m, o) => (o.endDate && o.endDate.slice(0, 10) > m ? o.endDate.slice(0, 10) : m), '');
  const firstEnd = orders.reduce((m, o) => (o.endDate && (!m || o.endDate.slice(0, 10) < m) ? o.endDate.slice(0, 10) : m), '');

  const save = async () => {
    setError('');
    const t = localTechs.find((x) => x.matricula === tech);
    if (!t) return setError('Escolha o técnico local.');
    setSaving(true);
    let done = 0;
    try {
      await runBulk(async () => {
        for (const o of orders) {
          await dbSaveServiceOrder({
            ...o,
            status: 'Planejada',
            assignedTechnician: t.name,
            assignedTechnicianMatricula: t.matricula,
            scheduledDate: '',
            scheduledEndDate: undefined,
            lotId: undefined,
            updatedAt: new Date().toISOString(),
            timeline: [...(o.timeline || []), timelineEvent('Atribuída ao técnico local', user.name, `OS ${formatOrderNumber(o.id)} atribuída a ${t.name} (técnico local), sem dia (Ordens de Serviço › Preventivas)`)]
          });
          done++;
        }
      });
      onDone(`${done} preventiva(s) atribuída(s) a ${t.name} (técnico local), sem dia. Estão em "Programadas".`);
    } catch (err: any) {
      setSaving(false);
      setError(`${done ? `${done} foram atribuídas; ` : ''}não foi possível atribuir ${done ? 'as outras' : ''}: ${err?.message || err}`);
    }
  };

  return (
    <Shell
      title={`Atribuir ao técnico local — ${orders.length} preventiva${orders.length > 1 ? 's' : ''}`}
      sub={`${where} · ${unit}${firstEnd ? ` · prazo até ${br(firstEnd === lastEnd ? lastEnd : firstEnd)}${firstEnd !== lastEnd ? ` a ${br(lastEnd)}` : ''}` : ''}`}
      width="max-w-xl"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="button" className={btnMain} onClick={save} disabled={saving || localTechs.length === 0}>
            {saving ? 'Atribuindo…' : 'Atribuir'}
          </button>
        </>
      }
    >
      <label className="block">
        <span className="block text-[11px] font-black text-slate-700 dark:text-slate-200 mb-1">Técnico local</span>
        <select aria-label="Técnico local" value={tech} onChange={(ev) => setTech(ev.target.value)} className="w-full h-9 px-3 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 font-bold">
          <option value="">Selecione o técnico local...</option>
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.list.map((t) => (
                <option key={t.matricula} value={t.matricula}>
                  {localTechLabel(t)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {localTechs.length === 0 && <span className="block mt-1 text-[11px] text-slate-500">Nenhum técnico local ativo desta empresa.</span>}
      </label>
      <p className="p-2.5 rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 text-[11px] text-emerald-900 dark:text-emerald-200 flex gap-2">
        <Smartphone className="w-4 h-4 shrink-0" />
        <span>
          <b>Técnico local: sem dia e sem pernoite.</b> Ele recebe no celular e faz dentro do prazo. Não entra na Programação da {unit}. O material usado sai da {unit}.
        </span>
      </p>
      <p className="text-[11px] text-slate-500">Elas saem de "A programar" e vão para <b>Programadas</b> com "Veio de: atribuída ao técnico local".</p>
      {error && <p className="text-[11px] font-bold text-rose-600">{error}</p>}
    </Shell>
  );
}
