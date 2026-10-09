import React, { useEffect, useMemo, useState } from 'react';
import { Search, CheckCircle2, XCircle, Clock, PackageCheck, Warehouse as WarehouseIcon } from 'lucide-react';
import { Company, HexonUser, SupplyRequest, SupplyRequestStatus } from '../../types';
import {
  dbConfirmSupplyRequest,
  dbGetCompanies,
  dbGetManagements,
  dbGetSupplyRequestsPage,
  dbRejectSupplyRequest,
  dbSupplySupplyRequest,
  formatSupplyQty,
  isCompanyVisible,
  parseQty,
  SR_STATUS_LABEL
} from '../../db/firebase';

// PEDIDOS DE INSUMOS NO COMPUTADOR (Fase 8C-2) — uma tela, dois modos:
// - "confirm" (Solicitações › Insumos): o administrativo confirma (vai para o almoxarifado) ou reprova com motivo.
// - "store" (menu Almoxarifado): o almoxarifado fornece (quantidade de cada item; já vem a pedida; 0 = não fornecido)
//   ou recusa com motivo. O GLPI aparece em destaque.
// A situação "da vez" (Pendente / Confirmado) chega em tempo real (lista do App); as outras vêm do banco em páginas de 20.

type Mode = 'confirm' | 'store';
const FILTERS: Record<Mode, { key: SupplyRequestStatus; label: string }[]> = {
  confirm: [
    { key: 'Pendente', label: 'Aguardando confirmação' },
    { key: 'Confirmado', label: 'No almoxarifado' },
    { key: 'Fornecido', label: 'Aguardando recebimento' },
    { key: 'Recebido', label: 'Recebidos' },
    { key: 'Reprovado', label: 'Reprovados' }
  ],
  store: [
    { key: 'Confirmado', label: 'Para fornecer' },
    { key: 'Fornecido', label: 'Aguardando recebimento' },
    { key: 'Recebido', label: 'Recebidos' },
    { key: 'Reprovado', label: 'Recusados / reprovados' }
  ]
};

const STATUS_STYLE: Record<string, string> = {
  Pendente: 'bg-amber-100 text-amber-800',
  Confirmado: 'bg-blue-100 text-blue-800',
  Fornecido: 'bg-violet-100 text-violet-800',
  Recebido: 'bg-emerald-100 text-emerald-800',
  Reprovado: 'bg-rose-100 text-rose-800'
};

interface Work {
  id: string;
  supplied: string[];
  note: string;
  rejecting: boolean;
  reason: string;
}

export default function SupplyRequestsBoard({
  mode,
  live,
  scopeUnits,
  visibleCompanies = null,
  userProfile,
  canAct
}: {
  mode: Mode;
  live: SupplyRequest[];               // situação da vez (Pendente ou Confirmado), em tempo real
  scopeUnits: string[] | null;         // null = todas
  visibleCompanies?: string[] | null;  // null = todas as das gerências que vê
  userProfile: HexonUser;
  canAct: boolean;                     // confirmar (modo confirm) ou fornecer (modo store)
}) {
  const liveStatus: SupplyRequestStatus = mode === 'confirm' ? 'Pendente' : 'Confirmado';
  const [units, setUnits] = useState<string[]>(scopeUnits || []);
  const [unit, setUnit] = useState('');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [company, setCompany] = useState('Todas');
  const [filter, setFilter] = useState<SupplyRequestStatus>(liveStatus);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState<SupplyRequest[]>([]);
  const [cursor, setCursor] = useState<any>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [work, setWork] = useState<Work | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const [done, setDone] = useState<Record<string, true>>({}); // resolvidos nesta tela (saem da lista da vez na hora)

  useEffect(() => {
    dbGetCompanies().then(setCompanies).catch(() => {});
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
    if (!unit || filter === liveStatus) return;
    setLoading(true);
    try {
      const r = await dbGetSupplyRequestsPage(unit, filter, company === 'Todas' ? null : company, more ? cursor : null);
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

  const liveOfUnit = live.filter((r) => r.unit === unit && isCompanyVisible(r.company, visibleCompanies) && !done[r.id]);
  const list = useMemo(() => {
    const base = filter === liveStatus ? liveOfUnit.filter((r) => company === 'Todas' || r.company === company) : page;
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter((r) =>
      [r.number, r.glpi, r.techName, r.techMatricula, r.orderLabel, ...r.items.map((i) => `${i.code} ${i.description}`)].join(' ').toLowerCase().includes(q)
    );
  }, [filter, live, page, unit, company, search, done, visibleCompanies]);

  const by = { name: userProfile.name, matricula: userProfile.matricula };
  const finish = (r: SupplyRequest, text: string) => {
    setDone({ ...done, [r.id]: true });
    setWork(null);
    setMsg({ id: '', ok: true, text });
  };
  const run = async (r: SupplyRequest, fn: () => Promise<void>, text: string) => {
    setBusy(true);
    try {
      await fn();
      finish(r, text);
    } catch (err: any) {
      setMsg({ id: r.id, ok: false, text: err?.message || String(err) });
    } finally {
      setBusy(false);
    }
  };

  const confirm = (r: SupplyRequest) => run(r, () => dbConfirmSupplyRequest(r, by), `${r.number} confirmado: foi para o almoxarifado.`);
  const reject = (r: SupplyRequest) =>
    run(r, () => dbRejectSupplyRequest(r, work?.reason || '', by), `${r.number} ${mode === 'confirm' ? 'reprovado' : 'recusado'}: o técnico vê o motivo.`);
  const supply = (r: SupplyRequest) => {
    if (!work) return;
    const supplied = work.supplied.map(parseQty);
    if (supplied.some((q) => !Number.isFinite(q) || q < 0)) return setMsg({ id: r.id, ok: false, text: 'Confira as quantidades fornecidas (0 = não fornecido).' });
    const over = r.items.find((it, i) => supplied[i] > it.qty);
    if (over) return setMsg({ id: r.id, ok: false, text: `A quantidade fornecida de "${over.description}" é maior que a pedida.` });
    return run(r, () => dbSupplySupplyRequest(r, supplied, work.note, by), `${r.number} fornecido: o técnico confirma o recebimento e os insumos entram na OS.`);
  };
  const startWork = (r: SupplyRequest, rejecting = false) => {
    setMsg(null);
    setWork({ id: r.id, supplied: r.items.map((i) => formatSupplyQty(i.qty)), note: '', rejecting, reason: '' });
  };

  const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
  const title = mode === 'confirm' ? 'Pedidos de insumos' : 'Almoxarifado — insumos';
  const intro =
    mode === 'confirm'
      ? 'Insumos pedidos pelos técnicos para as OS deles, com o nº do GLPI. Confirme para enviar ao almoxarifado, ou reprove com o motivo. Depois do fornecimento, o "Recebi" do técnico lança os insumos na OS.'
      : 'Pedidos de insumos confirmados pelo administrativo. Informe a quantidade fornecida de cada item (pode ser menor que a pedida) ou recuse com o motivo. O técnico confirma o recebimento e os insumos entram na OS.';

  return (
    <div className="space-y-5 font-sans">
      <section className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
        <div className="border-l-4 border-indigo-500 pl-4">
          <h1 className="text-xl font-black text-slate-800 tracking-tight">{title}</h1>
          <p className="text-xs text-slate-500 mt-1">{intro}</p>
        </div>
      </section>

      <div className="bg-white p-3 rounded-xl border border-slate-200 flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nº do pedido, GLPI, técnico, OS ou insumo..."
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
        {FILTERS[mode].map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`px-4 py-2 rounded-lg text-xs font-black cursor-pointer border ${filter === f.key ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200'}`}
          >
            {f.label}
            {f.key === liveStatus ? ` (${liveOfUnit.length})` : ''}
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
          const w = work?.id === r.id ? work : null;
          const showSupplied = (mode === 'store' && !!w && !w.rejecting) || r.status === 'Fornecido' || r.status === 'Recebido';
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
                <div className="text-right space-y-1">
                  <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-black ${STATUS_STYLE[r.status] || ''}`}>{SR_STATUS_LABEL[r.status]}</span>
                  <p className={`font-mono font-black ${mode === 'store' ? 'text-lg text-slate-900' : 'text-xs text-slate-700'}`}>GLPI {r.glpi}</p>
                </div>
              </div>

              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] uppercase text-slate-400 text-left">
                    <th className="py-1 pr-2">Código</th>
                    <th className="py-1 pr-2">Insumo</th>
                    <th className="py-1 pr-2 text-right">Pedido</th>
                    {showSupplied && <th className="py-1 text-right">Fornecido</th>}
                  </tr>
                </thead>
                <tbody>
                  {r.items.map((it, i) => (
                    <tr key={it.supplyId} className="border-t border-slate-100">
                      <td className="py-1.5 pr-2 font-mono text-slate-500">{it.code}</td>
                      <td className="py-1.5 pr-2 font-semibold text-slate-800">{it.description}</td>
                      <td className="py-1.5 pr-2 text-right whitespace-nowrap">
                        {formatSupplyQty(it.qty)} {it.measureUnit}
                      </td>
                      {mode === 'store' && w && !w.rejecting ? (
                        <td className="py-1.5 text-right">
                          <input
                            value={w.supplied[i]}
                            onChange={(e) => setWork({ ...w, supplied: w.supplied.map((x, j) => (j === i ? e.target.value : x)) })}
                            inputMode="decimal"
                            aria-label={`Fornecido de ${it.description}`}
                            className="w-20 px-2 py-1 border border-slate-300 rounded text-right font-bold"
                          />
                        </td>
                      ) : (
                        showSupplied && (
                          <td className={`py-1.5 text-right font-bold whitespace-nowrap ${(it.qtySupplied ?? 0) < it.qty ? 'text-amber-600' : 'text-emerald-700'}`}>
                            {formatSupplyQty(it.qtySupplied ?? 0)} {it.measureUnit}
                          </td>
                        )
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {r.note && <p className="text-xs text-slate-600">Observação do técnico: {r.note}</p>}

              {r.confirmation && <p className="text-[11px] text-slate-500">Confirmado por {r.confirmation.by} em {fmtDate(r.confirmation.at)}</p>}
              {r.supply && (
                <p className="text-xs text-slate-600 flex items-center gap-1.5">
                  <WarehouseIcon className="w-4 h-4 text-violet-600" /> Fornecido por {r.supply.by} em {fmtDate(r.supply.at)}
                  {r.supply.note ? ` · ${r.supply.note}` : ''}
                  {r.status === 'Recebido' && r.receivedAt && (
                    <span className="flex items-center gap-1 text-emerald-700 font-bold">
                      <PackageCheck className="w-4 h-4" /> recebido em {fmtDate(r.receivedAt)} (na OS)
                    </span>
                  )}
                </p>
              )}
              {r.status === 'Reprovado' && r.rejection && (
                <p className="text-xs text-rose-700">
                  {r.rejection.stage === 'almoxarifado' ? 'Recusado pelo almoxarifado' : 'Reprovado'} por {r.rejection.by} em {fmtDate(r.rejection.at)}: {r.rejection.reason}
                  {r.ackAt ? ' · técnico ciente' : ''}
                </p>
              )}

              {r.status === liveStatus && canAct && !w && (
                <div className="flex flex-wrap gap-2">
                  {mode === 'confirm' ? (
                    <button type="button" disabled={busy} onClick={() => confirm(r)} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-black cursor-pointer disabled:opacity-50 flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" /> {busy ? 'Salvando...' : 'Confirmar'}
                    </button>
                  ) : (
                    <button type="button" onClick={() => startWork(r)} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-black cursor-pointer flex items-center gap-1">
                      <PackageCheck className="w-4 h-4" /> Fornecer
                    </button>
                  )}
                  <button type="button" disabled={busy} onClick={() => startWork(r, true)} className="px-4 py-2 rounded-lg border border-rose-300 text-rose-700 text-xs font-black cursor-pointer flex items-center gap-1">
                    <XCircle className="w-4 h-4" /> {mode === 'confirm' ? 'Reprovar' : 'Recusar'}
                  </button>
                </div>
              )}
              {r.status === liveStatus && !canAct && (
                <p className="text-[11px] text-slate-500 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> {mode === 'confirm' ? 'Aguardando quem confirma os pedidos de insumos.' : 'Aguardando o almoxarifado.'}
                </p>
              )}

              {w && !w.rejecting && mode === 'store' && (
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex flex-wrap items-end gap-3">
                  <label className="space-y-1 flex-1 min-w-[200px]">
                    <span className="block text-[10px] font-bold uppercase text-slate-500">Observação (opcional)</span>
                    <input value={w.note} onChange={(e) => setWork({ ...w, note: e.target.value })} placeholder="Ex.: retirar no balcão 2" className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-800" />
                  </label>
                  <button type="button" disabled={busy} onClick={() => supply(r)} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-black cursor-pointer disabled:opacity-50 flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" /> {busy ? 'Salvando...' : 'Confirmar fornecimento'}
                  </button>
                  <button type="button" disabled={busy} onClick={() => setWork(null)} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-xs font-bold cursor-pointer">
                    Cancelar
                  </button>
                </div>
              )}
              {w && w.rejecting && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 space-y-2">
                  <label className="block space-y-1">
                    <span className="block text-[10px] font-bold uppercase text-rose-700">{mode === 'confirm' ? 'Motivo da reprovação *' : 'Motivo da recusa *'}</span>
                    <textarea
                      value={w.reason}
                      onChange={(e) => setWork({ ...w, reason: e.target.value })}
                      rows={2}
                      placeholder={mode === 'confirm' ? 'Ex.: "o técnico não irá mais precisar do insumo"' : 'Ex.: "sem estoque"'}
                      className="w-full px-3 py-2 bg-white border border-rose-300 rounded-lg text-xs font-semibold text-slate-800"
                    />
                  </label>
                  <div className="flex gap-2">
                    <button type="button" disabled={busy} onClick={() => reject(r)} className="px-4 py-2 rounded-lg bg-rose-600 text-white text-xs font-black cursor-pointer disabled:opacity-50">
                      {busy ? 'Salvando...' : mode === 'confirm' ? 'Confirmar reprovação' : 'Confirmar recusa'}
                    </button>
                    <button type="button" disabled={busy} onClick={() => setWork(null)} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-xs font-bold cursor-pointer">
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

      {filter !== liveStatus && hasMore && (
        <button type="button" disabled={loading} onClick={() => load(true)} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-xs font-bold cursor-pointer">
          Carregar mais
        </button>
      )}
    </div>
  );
}
