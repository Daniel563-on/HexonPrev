import React, { useEffect, useMemo, useState } from 'react';
import { Search, CheckCircle2, XCircle, Clock, PackageCheck, Warehouse as WarehouseIcon, AlertTriangle } from 'lucide-react';
import { Company, HexonUser, LiveState, SupplyBalance, SupplyRequest, SupplyRequestStatus } from '../../types';
import {
  balanceSaldo,
  dbApproveSupplyRequest,
  dbGetCompanies,
  dbGetManagements,
  dbGetSupplyBalancesByIds,
  dbGetSupplyRequestsPage,
  dbRejectSupplyRequest,
  dbSupplySupplyRequest,
  formatSupplyQty,
  isCompanyVisible,
  itemApprovedQty,
  parseQty,
  SR_STATUS_LABEL
} from '../../db/firebase';

// PEDIDOS DE INSUMOS NO COMPUTADOR (Fase 8C-2) — uma tela, dois modos:
// - "confirm" (Solicitações › Insumos): o administrativo APROVA vendo o saldo do contrato (Lote 3; pode diminuir a
//   quantidade de cada item, nunca acima do saldo — o aprovado fica reservado) ou reprova com motivo.
// - "store" (menu Almoxarifado): o almoxarifado fornece exatamente o aprovado (abate do saldo) ou recusa com motivo
//   (o aprovado volta ao saldo). O GLPI aparece em destaque.
// A situação "da vez" (Pendente / Confirmado) chega em tempo real (lista do App); as outras vêm do banco em páginas de 20.

type Mode = 'confirm' | 'store';
const FILTERS: Record<Mode, { key: SupplyRequestStatus; label: string }[]> = {
  confirm: [
    { key: 'Pendente', label: 'Aguardando aprovação' },
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
  note: string;
  rejecting: boolean;
  reason: string;
}

export default function SupplyRequestsBoard({
  mode,
  live,
  liveState = 'ok',
  scopeUnits,
  visibleCompanies = null,
  userProfile,
  canAct
}: {
  mode: Mode;
  live: SupplyRequest[];               // situação da vez (Pendente ou Confirmado), em tempo real
  liveState?: LiveState;               // S14: a escuta já respondeu? (até lá, "…" e não 0)
  scopeUnits: string[] | null;         // null = todas
  visibleCompanies?: string[] | null;  // null = todas as das gerências que vê
  userProfile: HexonUser;
  canAct: boolean;                     // aprovar (modo confirm) ou fornecer (modo store)
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
  // Aprovação (Lote 3): saldo do contrato de cada item dos pedidos aguardando e a quantidade a aprovar de cada pedido
  const [bal, setBal] = useState<Map<string, SupplyBalance | null>>(new Map());
  const [balReady, setBalReady] = useState(false);
  const [appr, setAppr] = useState<Record<string, string[]>>({});

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

  const unitCompanies = companies.filter((c) => c.active && c.units.includes(unit) && isCompanyVisible(c.id, visibleCompanies));
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

  // Saldo dos itens dos pedidos aguardando aprovação (1 leitura por item; guardado 30 s)
  const approving = mode === 'confirm' && canAct && filter === 'Pendente';
  const balIds = approving ? Array.from(new Set(liveOfUnit.flatMap((r) => r.items.map((i) => i.supplyId)))).sort() : [];
  const loadBal = async (force = false) => {
    if (!balIds.length) return;
    try {
      setBal(await dbGetSupplyBalancesByIds(balIds, force));
      setBalReady(true);
    } catch (err: any) {
      setMsg({ id: '', ok: false, text: `Não foi possível ler o saldo do contrato: ${err?.message || err}` });
    }
  };
  useEffect(() => {
    loadBal(false);
  }, [balIds.join('|')]);
  const saldoOf = (id: string) => balanceSaldo(bal.get(id));
  // Quantidade sugerida: a pedida, limitada ao saldo (sem saldo / fora do contrato = 0)
  const suggested = (r: SupplyRequest) =>
    r.items.map((it) => {
      const s = saldoOf(it.supplyId);
      return formatSupplyQty(s === null ? 0 : Math.max(0, Math.min(it.qty, s)));
    });
  const apprOf = (r: SupplyRequest) => appr[r.id] || (balReady ? suggested(r) : r.items.map(() => ''));

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

  const approve = async (r: SupplyRequest) => {
    const qs = apprOf(r).map(parseQty);
    if (qs.some((q) => !Number.isFinite(q) || q < 0)) return setMsg({ id: r.id, ok: false, text: 'Confira as quantidades a aprovar (0 = não aprovado).' });
    const over = r.items.find((it, i) => qs[i] > it.qty);
    if (over) return setMsg({ id: r.id, ok: false, text: `A quantidade aprovada de "${over.description}" é maior que a pedida.` });
    const noSaldo = r.items.find((it, i) => {
      const s = saldoOf(it.supplyId);
      return qs[i] > 0 && (s === null || qs[i] > s + 1e-9);
    });
    if (noSaldo) {
      const s = saldoOf(noSaldo.supplyId);
      return setMsg({
        id: r.id,
        ok: false,
        text: s === null ? `"${noSaldo.description}" não está no contrato da empresa: aprove 0.` : `Não dá para aprovar acima do saldo: "${noSaldo.description}" tem ${formatSupplyQty(Math.max(0, s))} ${noSaldo.measureUnit}.`
      });
    }
    if (qs.every((q) => q === 0)) return setMsg({ id: r.id, ok: false, text: 'Nenhum item aprovado: use "Reprovar" e informe o motivo.' });
    setBusy(true);
    try {
      await dbApproveSupplyRequest(r, qs, by);
      finish(r, `${r.number} aprovado: foi para o almoxarifado (o aprovado ficou reservado no saldo).`);
      loadBal(true);
    } catch (err: any) {
      setMsg({ id: r.id, ok: false, text: err?.message || String(err) });
      loadBal(true); // saldo mudou (outra aprovação ao mesmo tempo): mostra o de agora
    } finally {
      setBusy(false);
    }
  };
  const reject = (r: SupplyRequest) =>
    run(
      r,
      () => dbRejectSupplyRequest(r, work?.reason || '', by),
      mode === 'confirm' ? `${r.number} reprovado: o técnico vê o motivo.` : `${r.number} recusado: o aprovado voltou ao saldo e o técnico vê o motivo.`
    );
  const supply = (r: SupplyRequest) =>
    run(r, () => dbSupplySupplyRequest(r, work?.note || '', by), `${r.number} fornecido (abatido do saldo): o técnico confirma o recebimento e os insumos entram na OS.`);
  const startWork = (r: SupplyRequest, rejecting = false) => {
    setMsg(null);
    setWork({ id: r.id, note: '', rejecting, reason: '' });
  };

  const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
  const title = mode === 'confirm' ? 'Pedidos de insumos' : 'Almoxarifado — insumos';
  const intro =
    mode === 'confirm'
      ? 'Insumos pedidos pelos técnicos para as OS deles, com o nº do GLPI. Aprove vendo o saldo do contrato (pode diminuir a quantidade de cada item; o aprovado fica reservado e vai para o almoxarifado), ou reprove com o motivo. Depois do fornecimento, o "Recebi" do técnico lança os insumos na OS.'
      : 'Pedidos de insumos aprovados pelo administrativo. Forneça exatamente o aprovado (abate do saldo do contrato) ou recuse com o motivo (o aprovado volta ao saldo). O técnico confirma o recebimento e os insumos entram na OS.';

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
            {f.key === liveStatus ? ` (${liveState === 'loading' ? '…' : liveState === 'erro' ? '—' : liveOfUnit.length})` : ''}
          </button>
        ))}
      </div>

      {msg && !msg.id && <p className={`text-xs font-bold ${msg.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{msg.text}</p>}
      {(loading || (filter === liveStatus && liveState === 'loading')) && <p className="text-xs text-slate-500">Carregando...</p>}
      {!loading && !(filter === liveStatus && liveState === 'loading') && list.length === 0 && (
        <div className="bg-white p-8 rounded-xl border border-slate-200 text-center text-sm font-bold text-slate-500">
          {filter === liveStatus && liveState === 'erro' ? 'Não foi possível acompanhar os pedidos agora.' : 'Nenhum pedido nesta situação.'}
        </div>
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

              {(() => {
                const editing = approving && r.status === 'Pendente';
                const qs = editing ? apprOf(r) : [];
                const storeView = mode === 'store' && r.status === 'Confirmado';
                const hasApproved = r.items.some((it) => it.qtyApproved !== undefined);
                const showApproved = !editing && !storeView && hasApproved;
                const showSupplied = r.status === 'Fornecido' || r.status === 'Recebido';
                const list = storeView ? r.items.filter((it) => itemApprovedQty(it) > 0) : r.items;
                const notApproved = storeView ? r.items.filter((it) => itemApprovedQty(it) <= 0) : [];
                const less = editing
                  ? r.items
                      .map((it, i) => ({ it, q: parseQty(qs[i]) }))
                      .filter(({ it, q }) => Number.isFinite(q) && q < it.qty)
                  : [];
                return (
                  <>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-[10px] uppercase text-slate-400 text-left">
                          <th className="py-1 pr-2">Item</th>
                          <th className="py-1 pr-2">Insumo</th>
                          <th className="py-1 pr-2 text-right">Pedido</th>
                          {editing && <th className="py-1 pr-2 text-right">Saldo do contrato</th>}
                          {editing && <th className="py-1 text-right">Aprovar</th>}
                          {storeView && <th className="py-1 text-right">A fornecer (aprovado)</th>}
                          {showApproved && <th className="py-1 pr-2 text-right">Aprovado</th>}
                          {showSupplied && <th className="py-1 text-right">Fornecido</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((it) => {
                          const i = r.items.indexOf(it);
                          const saldo = editing ? saldoOf(it.supplyId) : null;
                          const q = editing ? parseQty(qs[i]) : NaN;
                          return (
                            <tr key={it.supplyId} className="border-t border-slate-100">
                              <td className="py-1.5 pr-2 font-mono text-slate-500">{it.code}</td>
                              <td className="py-1.5 pr-2 font-semibold text-slate-800">{it.description}</td>
                              <td className={`py-1.5 pr-2 text-right whitespace-nowrap ${storeView ? 'text-slate-500' : ''}`}>
                                {formatSupplyQty(it.qty)} {it.measureUnit}
                              </td>
                              {editing && (
                                <td
                                  className={`py-1.5 pr-2 text-right whitespace-nowrap font-black ${
                                    !balReady ? 'text-slate-400' : saldo === null || saldo <= 0 ? 'text-rose-600' : saldo < it.qty ? 'text-amber-700' : 'text-emerald-700'
                                  }`}
                                >
                                  {!balReady ? '…' : saldo === null ? 'fora do contrato' : saldo <= 0 ? 'sem saldo' : `${formatSupplyQty(saldo)} ${it.measureUnit}`}
                                </td>
                              )}
                              {editing && (
                                <td className="py-1.5 text-right">
                                  <input
                                    value={qs[i]}
                                    disabled={!balReady}
                                    onChange={(e) => setAppr({ ...appr, [r.id]: qs.map((x, j) => (j === i ? e.target.value : x)) })}
                                    inputMode="decimal"
                                    aria-label={`Aprovar de ${it.description}`}
                                    className={`w-20 px-2 py-1 border rounded text-right font-bold ${Number.isFinite(q) && q < it.qty ? 'border-amber-400 bg-amber-50' : 'border-slate-300'}`}
                                  />
                                </td>
                              )}
                              {storeView && (
                                <td className="py-1.5 text-right font-black text-slate-900 whitespace-nowrap">
                                  {formatSupplyQty(itemApprovedQty(it))} {it.measureUnit}
                                </td>
                              )}
                              {showApproved && (
                                <td className={`py-1.5 pr-2 text-right whitespace-nowrap ${itemApprovedQty(it) < it.qty ? 'text-amber-600 font-bold' : 'text-slate-700'}`}>
                                  {formatSupplyQty(itemApprovedQty(it))} {it.measureUnit}
                                </td>
                              )}
                              {showSupplied && (
                                <td className={`py-1.5 text-right font-bold whitespace-nowrap ${(it.qtySupplied ?? 0) < it.qty ? 'text-amber-600' : 'text-emerald-700'}`}>
                                  {formatSupplyQty(it.qtySupplied ?? 0)} {it.measureUnit}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {editing && balReady && less.length > 0 && (
                      <div className="p-2.5 rounded-lg border border-amber-200 bg-amber-50 text-[11px] text-amber-900 flex gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        {less.length === r.items.length && less.every(({ q }) => q === 0) ? (
                          <span>Nenhum item com quantidade a aprovar{r.items.every((it) => (saldoOf(it.supplyId) ?? 0) <= 0) ? ' (sem saldo no contrato)' : ''}: use "Reprovar" e informe o motivo.</span>
                        ) : (
                        <span>
                          Aprovando menos que o pedido:{' '}
                          {less.map(({ it, q }, k) => (
                            <React.Fragment key={it.supplyId}>
                              {k > 0 ? ' e ' : ''}
                              {it.code}{' '}
                              <b>
                                {formatSupplyQty(q)} de {formatSupplyQty(it.qty)}
                              </b>
                              {(saldoOf(it.supplyId) ?? 0) <= 0 ? ' (sem saldo)' : ''}
                            </React.Fragment>
                          ))}
                          . O técnico vê o que foi aprovado. Não dá para aprovar acima do saldo.
                        </span>
                        )}
                      </div>
                    )}
                    {storeView && (
                      <p className="text-[11px] text-slate-500">
                        {r.confirmation ? `Aprovado por ${r.confirmation.by} em ${fmtDate(r.confirmation.at)}` : 'Aprovado'}
                        {notApproved.length > 0 ? ` (${notApproved.map((it) => it.code).join(', ')} não ${notApproved.length === 1 ? 'aprovado' : 'aprovados'})` : ''}. O almoxarifado
                        não muda as quantidades.
                      </p>
                    )}
                  </>
                );
              })()}
              {r.note && <p className="text-xs text-slate-600">Observação do técnico: {r.note}</p>}

              {r.confirmation && !(mode === 'store' && r.status === 'Confirmado') && (
                <p className="text-[11px] text-slate-500">Aprovado por {r.confirmation.by} em {fmtDate(r.confirmation.at)}</p>
              )}
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
                    <button
                      type="button"
                      disabled={busy || !balReady}
                      onClick={() => approve(r)}
                      className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-black cursor-pointer disabled:opacity-50 flex items-center gap-1"
                    >
                      <CheckCircle2 className="w-4 h-4" /> {busy ? 'Salvando...' : 'Aprovar (vai ao almoxarifado)'}
                    </button>
                  ) : (
                    <button type="button" onClick={() => startWork(r)} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-black cursor-pointer flex items-center gap-1">
                      <PackageCheck className="w-4 h-4" /> Fornecer — abate do saldo
                    </button>
                  )}
                  <button type="button" disabled={busy} onClick={() => startWork(r, true)} className="px-4 py-2 rounded-lg border border-rose-300 text-rose-700 text-xs font-black cursor-pointer flex items-center gap-1">
                    <XCircle className="w-4 h-4" /> {mode === 'confirm' ? 'Reprovar' : 'Recusar (motivo)'}
                  </button>
                </div>
              )}
              {r.status === liveStatus && !canAct && (
                <p className="text-[11px] text-slate-500 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> {mode === 'confirm' ? 'Aguardando quem aprova os pedidos de insumos.' : 'Aguardando o almoxarifado.'}
                </p>
              )}

              {w && !w.rejecting && mode === 'store' && (
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex flex-wrap items-end gap-3">
                  <label className="space-y-1 flex-1 min-w-[200px]">
                    <span className="block text-[10px] font-bold uppercase text-slate-500">Observação (opcional)</span>
                    <input value={w.note} onChange={(e) => setWork({ ...w, note: e.target.value })} placeholder="Ex.: retirar no balcão 2" className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-800" />
                  </label>
                  <button type="button" disabled={busy} onClick={() => supply(r)} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-black cursor-pointer disabled:opacity-50 flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" /> {busy ? 'Salvando...' : 'Confirmar fornecimento (abate do saldo)'}
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
                      placeholder={mode === 'confirm' ? 'Ex.: "o técnico não irá mais precisar do insumo"' : 'Ex.: "sem estoque" (o aprovado volta ao saldo)'}
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
