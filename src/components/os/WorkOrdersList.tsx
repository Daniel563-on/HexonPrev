import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, UserPlus, X } from 'lucide-react';
import { HexonUser, WorkOrder } from '../../types';
import { WORK_ORDER_PAGE_SIZE, dbAssignWorkOrder, dbGetUsers, dbGetWorkOrdersPage } from '../../db/firebase';
import WorkOrderSheet from './WorkOrderSheet';
import { STATUS_STYLE, dayBR, isOverdue } from './OsAnswersView';

// LISTA SIMPLES DAS OS (Fase 4): da gerência escolhida, mais recentes primeiro, 20 por página.
// Busca e filtros completos ficam para a Fase 6.

interface Props {
  userProfile: HexonUser;
  unitOptions: string[];   // gerências que o usuário pode ver
  canAssign: boolean;
  canCancel: boolean;
  canViewCosts: boolean;
}

export default function WorkOrdersList({ userProfile, unitOptions, canAssign, canCancel, canViewCosts }: Props) {
  const [unit, setUnit] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('hexon_os_unit');
      if (saved && unitOptions.includes(saved)) return saved;
    } catch {
      /* ignora */
    }
    return unitOptions[0] || '';
  });
  const [pages, setPages] = useState<{ items: WorkOrder[]; cursor: any; hasMore: boolean }[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<WorkOrder | null>(null);
  const [assigning, setAssigning] = useState<WorkOrder | null>(null);
  const [techs, setTechs] = useState<HexonUser[]>([]);
  const [tech, setTech] = useState('');
  const [busy, setBusy] = useState(false);
  const current = useRef(unit);

  const loadFirst = (u: string) => {
    current.current = u;
    setPages([]);
    setIndex(0);
    setError(null);
    if (!u) return;
    setLoading(true);
    dbGetWorkOrdersPage(u, null)
      .then((p) => current.current === u && setPages([p]))
      .catch((e) => current.current === u && setError(`Não foi possível carregar: ${e?.message || e}`))
      .finally(() => current.current === u && setLoading(false));
  };
  useEffect(() => {
    try {
      localStorage.setItem('hexon_os_unit', unit);
    } catch {
      /* ignora */
    }
    loadFirst(unit);
  }, [unit]);

  const page = pages[index];
  const next = async () => {
    if (!page?.hasMore || loading) return;
    if (pages[index + 1]) return setIndex(index + 1);
    setLoading(true);
    try {
      const p = await dbGetWorkOrdersPage(unit, page.cursor);
      if (current.current !== unit) return;
      setPages((prev) => [...prev.slice(0, index + 1), p]);
      setIndex(index + 1);
    } catch (e: any) {
      setError(`Não foi possível carregar: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  const openAssign = async (o: WorkOrder) => {
    setAssigning(o);
    setTech(o.assignedTechnicianMatricula || '');
    setError(null);
    const users = await dbGetUsers().catch(() => []);
    // Técnicos da gerência da OS e, em bloco separado, os de gerência "Todas"
    setTechs(users.filter((u) => u.perfil === 'Profissional' && u.status === 'Ativo' && (u.gerencia === o.unit || u.gerencia === 'Todas')));
  };

  const assign = async () => {
    if (!assigning) return;
    const t = techs.find((x) => x.matricula === tech);
    if (!t) return setError('Escolha o técnico.');
    setBusy(true);
    try {
      await dbAssignWorkOrder(assigning, { matricula: t.matricula, name: t.name }, userProfile.name);
      setAssigning(null);
      loadFirst(unit);
    } catch (e: any) {
      setError(e?.code === 'permission-denied' ? 'O banco recusou: seu perfil não pode atribuir OS nesta gerência.' : `Não foi possível atribuir: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const btn = 'flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-[11px] font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed bg-white';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Gerência</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value)} className="h-8 px-2 text-xs font-bold border border-slate-200 rounded-lg bg-white cursor-pointer">
            {unitOptions.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>
        <button type="button" className={btn} onClick={() => loadFirst(unit)} disabled={loading}>
          <RefreshCw className="w-3.5 h-3.5" /> Atualizar
        </button>
      </div>

      {error && !assigning && <p className="text-xs font-bold text-rose-600">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-xs min-w-[860px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <th className="p-2.5">Número</th>
              <th className="p-2.5">Tipo</th>
              <th className="p-2.5">GLPI</th>
              <th className="p-2.5">Local de execução</th>
              <th className="p-2.5">Técnico</th>
              <th className="p-2.5">Prazo</th>
              <th className="p-2.5">Situação</th>
              <th className="p-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {(page?.items || []).map((o) => (
              <tr key={o.id} className="border-t border-slate-100 align-top hover:bg-slate-50 cursor-pointer" onClick={() => setSelected(o)}>
                <td className="p-2.5 font-mono font-bold text-indigo-700 whitespace-nowrap">{o.number}</td>
                <td className="p-2.5">{o.intervencao || '—'}</td>
                <td className="p-2.5 font-mono">{o.glpi || '—'}</td>
                <td className="p-2.5">
                  <span className="font-bold text-slate-800">{o.execAddressText}</span>
                  <span className="block text-[10px] text-slate-500">{o.comarca}{o.craai ? ` · CRAAI ${o.craai}` : ''}</span>
                </td>
                <td className="p-2.5">{o.assignedTechnicianName || <span className="text-slate-400">Em aberto</span>}</td>
                <td className="p-2.5 whitespace-nowrap">{dayBR(o.deadline)}</td>
                <td className="p-2.5">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${STATUS_STYLE[o.status] || 'bg-slate-100'}`}>{o.status}</span>
                  {isOverdue(o) && <span className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-black bg-rose-600 text-white">ATRASADA</span>}
                </td>
                <td className="p-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                  {canAssign && (o.status === 'Nova' || o.status === 'Em andamento' || o.status === 'Pendente') && (
                    <button type="button" onClick={() => openAssign(o)} className="h-7 px-2 rounded-md border border-indigo-200 bg-indigo-50 text-indigo-700 text-[10px] font-black inline-flex items-center gap-1 cursor-pointer">
                      <UserPlus className="w-3 h-3" /> {o.assignedTechnicianMatricula ? 'Trocar' : 'Atribuir'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!loading && (page?.items || []).length === 0 && (
              <tr>
                <td colSpan={8} className="p-6 text-center text-slate-400">Nenhuma OS nesta gerência.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <button type="button" className={btn} disabled={index === 0 || loading} onClick={() => setIndex(index - 1)}>
          <ChevronLeft className="w-3.5 h-3.5" /> Anterior
        </button>
        <span className="text-[11px] font-bold text-slate-500">{loading ? 'Carregando...' : `Página ${index + 1} · ${WORK_ORDER_PAGE_SIZE} por página`}</span>
        <button type="button" className={btn} disabled={!page?.hasMore || loading} onClick={next}>
          Próxima <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Ficha da OS */}
      {selected && (
        <WorkOrderSheet
          order={selected}
          userProfile={userProfile}
          canAssign={canAssign}
          canCancel={canCancel}
          canViewCosts={canViewCosts}
          onClose={() => setSelected(null)}
          onChanged={() => loadFirst(unit)}
        />
      )}

      {/* Atribuir técnico */}
      {assigning && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 space-y-3">
            <p className="text-sm font-black text-slate-900">{assigning.assignedTechnicianMatricula ? 'Trocar técnico' : 'Atribuir técnico'} — {assigning.number}</p>
            {assigning.status === 'Nova' ? (
              <p className="text-[11px] font-bold text-amber-700">Ao atribuir, a OS fica "Em andamento" e o homem-hora começa a contar.</p>
            ) : (
              <p className="text-[11px] text-slate-500">A contagem do homem-hora continua desde a primeira atribuição.</p>
            )}
            <select value={tech} onChange={(e) => setTech(e.target.value)} className="w-full h-9 px-3 text-xs border border-slate-200 rounded-lg bg-white">
              <option value="">Selecione o técnico...</option>
              {[
                { label: `Técnicos da ${assigning.unit}`, list: techs.filter((t) => t.gerencia === assigning.unit) },
                { label: 'Técnicos de todas as gerências', list: techs.filter((t) => t.gerencia === 'Todas') }
              ]
                .filter((g) => g.list.length > 0)
                .map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.list.map((t) => (
                      <option key={t.matricula} value={t.matricula}>{t.name} ({t.matricula})</option>
                    ))}
                  </optgroup>
                ))}
            </select>
            {techs.length === 0 && <p className="text-[11px] text-slate-500">Nenhum técnico ativo nesta gerência.</p>}
            {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setAssigning(null); setError(null); }} className="h-8 px-3 rounded-lg border border-slate-200 text-xs font-bold cursor-pointer">Cancelar</button>
              <button type="button" onClick={assign} disabled={busy} className="h-8 px-3 rounded-lg bg-[#3525cd] text-white text-xs font-bold cursor-pointer disabled:opacity-50">
                {busy ? 'Salvando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
