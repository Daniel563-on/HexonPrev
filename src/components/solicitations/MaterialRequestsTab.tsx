import React, { useEffect, useMemo, useState } from 'react';
import { Search, Warehouse as WarehouseIcon, CheckCircle2, XCircle, Clock, PackageCheck } from 'lucide-react';
import { Company, HexonUser, MaterialRequest, MaterialRequestStatus, Warehouse } from '../../types';
import {
  dbApproveMaterialRequest,
  dbGetCompanies,
  dbGetManagements,
  dbGetMaterialRequestsPage,
  dbGetWarehouses,
  dbRejectMaterialRequest,
  formatQty,
  isCompanyVisible,
  MR_STATUS_LABEL,
  parseQty
} from '../../db/firebase';

// SOLICITAÇÕES › MATERIAL (Fase 8B): pedidos de material do MP feitos pelos técnicos.
// Pendentes chegam em tempo real (lista do App); as outras situações vêm do banco em páginas de 20, por gerência.
// Aprovar: quantidade fornecida de cada item (já vem a pedida; 0 = não fornecido), almoxarifado e nº da RM (só números).
// Reprovar: motivo obrigatório. Depois do "Retirei" do técnico o pedido vira Atendido.

type Filter = MaterialRequestStatus;
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'Pendente', label: 'Pendentes' },
  { key: 'Aprovado', label: 'Aguardando retirada' },
  { key: 'Atendido', label: 'Atendidos' },
  { key: 'Reprovado', label: 'Reprovados' }
];

const STATUS_STYLE: Record<string, string> = {
  Pendente: 'bg-amber-100 text-amber-800',
  Aprovado: 'bg-blue-100 text-blue-800',
  Reprovado: 'bg-rose-100 text-rose-800',
  Atendido: 'bg-emerald-100 text-emerald-800'
};

interface Analysis {
  id: string;
  supplied: string[];
  warehouse: string;
  rm: string;
  rejecting: boolean;
  reason: string;
}

export default function MaterialRequestsTab({
  pending,
  scopeUnits,
  visibleCompanies = null,
  userProfile,
  canDecide
}: {
  pending: MaterialRequest[];          // pendentes das gerências que vê (tempo real)
  scopeUnits: string[] | null;         // null = todas
  visibleCompanies?: string[] | null;  // null = todas as das gerências que vê
  userProfile: HexonUser;
  canDecide: boolean;
}) {
  const [units, setUnits] = useState<string[]>(scopeUnits || []);
  const [unit, setUnit] = useState('');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [company, setCompany] = useState('Todas');
  const [filter, setFilter] = useState<Filter>('Pendente');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState<MaterialRequest[]>([]);
  const [cursor, setCursor] = useState<any>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const [changed, setChanged] = useState<Record<string, MaterialRequest>>({}); // decididos nesta tela (saem dos pendentes na hora)

  useEffect(() => {
    dbGetCompanies().then(setCompanies).catch(() => {});
    dbGetWarehouses().then(setWarehouses).catch(() => {});
    if (scopeUnits === null) {
      dbGetManagements()
        .then((l) => setUnits(l.map((m) => m.name).filter((n) => n && n !== 'Todas')))
        .catch(() => {});
    }
  }, []);
  useEffect(() => {
    if (!unit && units.length) setUnit(units.includes(userProfile.gerencia || '') ? userProfile.gerencia! : units[0]);
  }, [units]);

  const unitCompanies = companies.filter((c) => c.units.includes(unit) && isCompanyVisible(c.id, visibleCompanies));
  const companyName = (id: string) => companies.find((c) => c.id === id)?.name || id;

  const load = async (more = false) => {
    if (!unit || filter === 'Pendente') return;
    setLoading(true);
    try {
      const r = await dbGetMaterialRequestsPage(unit, filter, company === 'Todas' ? null : company, more ? cursor : null);
      const items = r.items.filter((x) => isCompanyVisible(x.company, visibleCompanies));
      setPage(more ? [...page, ...items] : items);
      setCursor(r.cursor);
      setHasMore(r.hasMore);
    } catch (err: any) {
      setMsg({ id: '', ok: false, text: `Não foi possível carregar: ${err?.message || err}` });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    setPage([]);
    setCursor(null);
    setHasMore(false);
    load(false);
  }, [unit, company, filter]);

  const list = useMemo(() => {
    const base =
      filter === 'Pendente'
        ? pending
            .filter((r) => r.unit === unit && (company === 'Todas' || r.company === company) && isCompanyVisible(r.company, visibleCompanies))
            .filter((r) => !changed[r.id])
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        : page;
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter((r) =>
      [r.number, r.techName, r.techMatricula, r.orderLabel, ...r.items.map((i) => `${i.code} ${i.description}`)].join(' ').toLowerCase().includes(q)
    );
  }, [filter, pending, page, unit, company, search, changed, visibleCompanies]);

  const pendingCount = pending.filter((r) => r.unit === unit && isCompanyVisible(r.company, visibleCompanies) && !changed[r.id]).length;
  const activeWarehouses = warehouses.filter((w) => w.active);
  const by = { name: userProfile.name, matricula: userProfile.matricula };

  const startAnalysis = (r: MaterialRequest) => {
    setMsg(null);
    setAnalysis({ id: r.id, supplied: r.items.map((i) => formatQty(i.qty)), warehouse: '', rm: '', rejecting: false, reason: '' });
  };

  const approve = async (r: MaterialRequest) => {
    if (!analysis) return;
    const supplied = analysis.supplied.map(parseQty);
    if (supplied.some((q) => !Number.isFinite(q) || q < 0)) return setMsg({ id: r.id, ok: false, text: 'Confira as quantidades fornecidas (0 = não fornecido).' });
    const over = r.items.find((it, i) => supplied[i] > it.qty);
    if (over) return setMsg({ id: r.id, ok: false, text: `A quantidade fornecida de "${over.description}" é maior que a pedida.` });
    setBusy(true);
    try {
      const updated = await dbApproveMaterialRequest(r, supplied, analysis.warehouse, analysis.rm, by);
      setChanged({ ...changed, [r.id]: updated });
      setAnalysis(null);
      setMsg({ id: r.id, ok: true, text: `${r.number} aprovado: o técnico vê onde retirar.` });
    } catch (err: any) {
      setMsg({ id: r.id, ok: false, text: err?.message || String(err) });
    } finally {
      setBusy(false);
    }
  };

  const reject = async (r: MaterialRequest) => {
    if (!analysis) return;
    setBusy(true);
    try {
      const updated = await dbRejectMaterialRequest(r, analysis.reason, by);
      setChanged({ ...changed, [r.id]: updated });
      setAnalysis(null);
      setMsg({ id: r.id, ok: true, text: `${r.number} reprovado.` });
    } catch (err: any) {
      setMsg({ id: r.id, ok: false, text: err?.message || String(err) });
    } finally {
      setBusy(false);
    }
  };

  const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
  const inputCls = 'px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-800';

  return (
    <div className="space-y-5 font-sans">
      <section className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <div className="border-l-4 border-indigo-500 pl-4">
          <h1 className="text-xl font-black text-slate-800 tracking-tight">Pedidos de material</h1>
          <p className="text-xs text-slate-500 mt-1">
            Material do MP pedido pelos técnicos para as OS deles. Aprove informando a quantidade fornecida de cada item, o almoxarifado e o nº da
            RM, ou reprove com o motivo. Depois do "Retirei" do técnico, o pedido fica como Atendido.
          </p>
        </div>
      </section>

      <div className="bg-white p-3 rounded-xl border border-slate-200 flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nº do pedido, técnico, OS ou material..."
            className="w-full text-xs pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg font-bold text-slate-800"
          />
        </div>
        <select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Gerência" className="text-xs font-bold border border-slate-200 bg-slate-50 rounded-lg px-3 py-2.5 cursor-pointer text-slate-700 shrink-0">
          {units.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <select value={company} onChange={(e) => setCompany(e.target.value)} aria-label="Empresa" className="text-xs font-bold border border-slate-200 bg-slate-50 rounded-lg px-3 py-2.5 cursor-pointer text-slate-700 shrink-0">
          <option value="Todas">Todas as empresas</option>
          {unitCompanies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`px-4 py-2 rounded-lg text-xs font-black cursor-pointer border ${filter === f.key ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200'}`}
          >
            {f.label}
            {f.key === 'Pendente' ? ` (${pendingCount})` : ''}
          </button>
        ))}
      </div>

      {msg && !msg.id && <p className={`text-xs font-bold ${msg.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{msg.text}</p>}
      {loading && <p className="text-xs text-slate-500">Carregando...</p>}
      {!loading && list.length === 0 && (
        <div className="bg-white p-8 rounded-xl border border-slate-200 text-center text-sm font-bold text-slate-500">Nenhum pedido nesta situação.</div>
      )}

      <div className="space-y-3">
        {list.map((r) => {
          const a = analysis?.id === r.id ? analysis : null;
          return (
            <div key={r.id} className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-sm font-black text-indigo-700">{r.number}</p>
                  <p className="text-[11px] text-slate-500">
                    {fmtDate(r.createdAt)} · {r.techName} ({r.techMatricula}) · {companyName(r.company)}
                  </p>
                  <p className="text-xs font-bold text-slate-700 mt-0.5">{r.orderLabel}</p>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-black ${STATUS_STYLE[r.status] || ''}`}>{MR_STATUS_LABEL[r.status]}</span>
              </div>

              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] uppercase text-slate-400 text-left">
                    <th className="py-1 pr-2">Código</th>
                    <th className="py-1 pr-2">Material</th>
                    <th className="py-1 pr-2 text-right">Pedido</th>
                    {(a || r.status === 'Aprovado' || r.status === 'Atendido') && <th className="py-1 text-right">Fornecido</th>}
                  </tr>
                </thead>
                <tbody>
                  {r.items.map((it, i) => (
                    <tr key={it.materialId} className="border-t border-slate-100">
                      <td className="py-1.5 pr-2 font-mono text-slate-500">{it.code}</td>
                      <td className="py-1.5 pr-2 font-semibold text-slate-800">{it.description}</td>
                      <td className="py-1.5 pr-2 text-right whitespace-nowrap">
                        {formatQty(it.qty)} {it.measureUnit}
                      </td>
                      {a ? (
                        <td className="py-1.5 text-right">
                          <input
                            value={a.supplied[i]}
                            onChange={(e) => setAnalysis({ ...a, supplied: a.supplied.map((x, j) => (j === i ? e.target.value : x)) })}
                            inputMode="decimal"
                            aria-label={`Fornecido de ${it.description}`}
                            className="w-20 px-2 py-1 border border-slate-300 rounded text-right font-bold"
                          />
                        </td>
                      ) : (
                        (r.status === 'Aprovado' || r.status === 'Atendido') && (
                          <td className={`py-1.5 text-right font-bold whitespace-nowrap ${(it.qtySupplied ?? 0) < it.qty ? 'text-amber-600' : 'text-emerald-700'}`}>
                            {formatQty(it.qtySupplied ?? 0)} {it.measureUnit}
                          </td>
                        )
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {r.note && <p className="text-xs text-slate-600">Observação do técnico: {r.note}</p>}

              {(r.status === 'Aprovado' || r.status === 'Atendido') && r.decision && (
                <p className="text-xs text-slate-600 flex items-center gap-1.5">
                  <WarehouseIcon className="w-4 h-4 text-blue-600" />
                  {r.decision.warehouse} · RM <b>{r.decision.rm}</b> · aprovado por {r.decision.by} em {fmtDate(r.decision.at)}
                  {r.status === 'Atendido' && r.pickedUpAt && (
                    <span className="flex items-center gap-1 text-emerald-700 font-bold">
                      <PackageCheck className="w-4 h-4" /> retirado em {fmtDate(r.pickedUpAt)}
                    </span>
                  )}
                </p>
              )}
              {r.status === 'Reprovado' && r.decision && (
                <p className="text-xs text-rose-700">
                  Reprovado por {r.decision.by} em {fmtDate(r.decision.at)}: {r.decision.reason}
                  {r.ackAt ? ' · técnico ciente' : ''}
                </p>
              )}

              {r.status === 'Pendente' && canDecide && !a && (
                <button type="button" onClick={() => startAnalysis(r)} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-black cursor-pointer">
                  Analisar
                </button>
              )}
              {r.status === 'Pendente' && !canDecide && (
                <p className="text-[11px] text-slate-500 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> Aguardando quem aprova os pedidos de material.
                </p>
              )}

              {a && !a.rejecting && (
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex flex-wrap items-end gap-3">
                  <label className="space-y-1">
                    <span className="block text-[10px] font-bold uppercase text-slate-500">Almoxarifado *</span>
                    <select value={a.warehouse} onChange={(e) => {
                        setAnalysis({ ...a, warehouse: e.target.value });
                        setMsg(null);
                      }} className={inputCls}>
                      <option value="">Escolha</option>
                      {activeWarehouses.map((w) => (
                        <option key={w.id} value={w.name}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="block text-[10px] font-bold uppercase text-slate-500">Nº da RM *</span>
                    <input
                      value={a.rm}
                      onChange={(e) => {
                        setAnalysis({ ...a, rm: e.target.value.replace(/\D/g, '') });
                        setMsg(null);
                      }}
                      inputMode="numeric"
                      placeholder="Só números"
                      className={`${inputCls} w-36`}
                    />
                  </label>
                  <button type="button" disabled={busy} onClick={() => approve(r)} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-black cursor-pointer disabled:opacity-50 flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" /> {busy ? 'Salvando...' : 'Aprovar'}
                  </button>
                  <button type="button" disabled={busy} onClick={() => setAnalysis({ ...a, rejecting: true })} className="px-4 py-2 rounded-lg border border-rose-300 text-rose-700 text-xs font-black cursor-pointer flex items-center gap-1">
                    <XCircle className="w-4 h-4" /> Reprovar
                  </button>
                  <button type="button" disabled={busy} onClick={() => setAnalysis(null)} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-xs font-bold cursor-pointer">
                    Cancelar
                  </button>
                </div>
              )}
              {a && a.rejecting && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 space-y-2">
                  <label className="block space-y-1">
                    <span className="block text-[10px] font-bold uppercase text-rose-700">Motivo da reprovação *</span>
                    <textarea
                      value={a.reason}
                      onChange={(e) => setAnalysis({ ...a, reason: e.target.value })}
                      rows={2}
                      placeholder='Ex.: "o técnico não irá mais precisar do material"'
                      className="w-full px-3 py-2 bg-white border border-rose-300 rounded-lg text-xs font-semibold text-slate-800"
                    />
                  </label>
                  <div className="flex gap-2">
                    <button type="button" disabled={busy} onClick={() => reject(r)} className="px-4 py-2 rounded-lg bg-rose-600 text-white text-xs font-black cursor-pointer disabled:opacity-50">
                      {busy ? 'Salvando...' : 'Confirmar reprovação'}
                    </button>
                    <button type="button" disabled={busy} onClick={() => setAnalysis({ ...a, rejecting: false })} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-xs font-bold cursor-pointer">
                      Voltar
                    </button>
                  </div>
                </div>
              )}
              {msg && msg.id === r.id && <p className={`text-xs font-bold ${msg.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{msg.text}</p>}
            </div>
          );
        })}
      </div>

      {filter !== 'Pendente' && hasMore && (
        <button type="button" disabled={loading} onClick={() => load(true)} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-xs font-bold cursor-pointer">
          Carregar mais
        </button>
      )}
    </div>
  );
}
