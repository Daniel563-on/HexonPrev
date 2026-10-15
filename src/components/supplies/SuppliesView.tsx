import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Info, Pencil, Search, Trash2, Upload } from 'lucide-react';
import { Company, HexonUser, Material, SupplyBalance } from '../../types';
import {
  balanceSaldo,
  brl,
  dbDeleteContractSupply,
  dbEditContractSupply,
  dbGetCompanies,
  dbGetSupplyBalances,
  dbGetSupplyContract,
  formatSupplyQty,
  isCompanyVisible,
  supplyContractSyncStatus
} from '../../db/firebase';
import { useSyncVersion } from '../../utils/useSyncVersion';
import SupplyContractImportModal from './SupplyContractImportModal';
import SupplyOutputsReport from './SupplyOutputsReport';

// GESTÃO DE INSUMOS (Lote 3, 15/10/2026): CONTRATO DE INSUMOS DA EMPRESA — uma lista para todas as gerências.
// Aba "Contrato e saldo" ("Ver insumos"): contratado, fornecido, aprovado aguardando o almoxarifado, saldo e preço.
// Aba "Relatório de saídas" ("Relatório de saídas de insumos"): Excel com filtros (item, gerência, OS, GLPI e técnico).
// Importar contrato/aditivo: "Importar contrato e aditivos de insumos". Corrigir descrição e unidade: "Editar descrição
// e unidade dos insumos". Excluir item (erro de importação, sem saída): só o Super Administrador.

interface Props {
  userProfile: HexonUser;
  visibleUnits: string[] | null;
  visibleCompanies: string[] | null;
  canView: boolean;
  canReport: boolean;
  canImport: boolean;
  canEdit: boolean;
}

const th = 'p-2.5 text-[10px] font-black uppercase tracking-wider text-slate-500 text-left whitespace-nowrap';
const dateBR = (iso?: string) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('pt-BR') : '');
const price4 = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export default function SuppliesView({ userProfile, visibleUnits, visibleCompanies, canView, canReport, canImport, canEdit }: Props) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [company, setCompany] = useState('');
  const [tab, setTab] = useState<'lista' | 'rel'>(canView ? 'lista' : 'rel');
  const [contract, setContract] = useState<Material[]>([]);
  const [balances, setBalances] = useState<SupplyBalance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [saldoFilter, setSaldoFilter] = useState<'Todos' | 'Com saldo' | 'Sem saldo'>('Todos');
  const [openId, setOpenId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [editing, setEditing] = useState<Material | null>(null);
  const [toDelete, setToDelete] = useState<Material | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const isSuperAdmin = userProfile.perfil === 'Super Administrador';
  const needBalances = canView || canImport;

  useEffect(() => {
    dbGetCompanies().then(setCompanies).catch(() => {});
  }, []);

  // Empresas: as que o usuário vê, nas gerências que vê (ativas)
  const myCompanies = useMemo(
    () =>
      companies.filter(
        (c) => c.active && isCompanyVisible(c.id, visibleCompanies) && (visibleUnits === null || c.units.some((u) => visibleUnits.includes(u)))
      ),
    [companies, visibleCompanies, visibleUnits]
  );
  useEffect(() => {
    if (company && myCompanies.some((c) => c.id === company)) return;
    const mine = myCompanies.find((c) => (userProfile.companies || []).includes(c.id));
    setCompany((mine || myCompanies[0])?.id || '');
  }, [myCompanies]);
  const companyName = (id: string) => companies.find((c) => c.id === id)?.name || id;

  const load = async (force: boolean) => {
    if (!company) return;
    setLoading(true);
    setError(null);
    try {
      const [items, bals] = await Promise.all([dbGetSupplyContract(company, force), needBalances ? dbGetSupplyBalances(company, force) : Promise.resolve([])]);
      setContract(items);
      setBalances(bals);
      const st = supplyContractSyncStatus(company);
      if (st?.error) setError(`Não foi possível atualizar a lista: ${st.error}`);
    } catch (err: any) {
      setError(`Não foi possível carregar: ${err?.message || err}`);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    setContract([]);
    setBalances([]);
    setOpenId(null);
    load(false);
  }, [company]);
  // Tempo real: importação ou correção feita em outro aparelho aparece sozinha (relê da memória)
  const supVersion = useSyncVersion('supplies');
  useEffect(() => {
    if (supVersion > 0 && company) dbGetSupplyContract(company).then(setContract).catch(() => {});
  }, [supVersion]);

  const balOf = useMemo(() => new Map(balances.map((b) => [b.id, b])), [balances]);
  const rows = useMemo(
    () =>
      contract.map((m) => {
        const b = balOf.get(m.id) || null;
        return { m, b, saldo: balanceSaldo(b) };
      }),
    [contract, balOf]
  );
  const totals = useMemo(() => {
    let c = 0;
    let f = 0;
    let zero = 0;
    rows.forEach(({ m, b, saldo }) => {
      if (!b) return;
      c += b.contractQty * m.cost;
      f += b.suppliedQty * m.cost;
      if ((saldo ?? 0) <= 0) zero++;
    });
    return { c, f, zero };
  }, [rows]);
  const filtered = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return rows.filter(({ m, saldo }) => {
      if (saldoFilter === 'Com saldo' && !((saldo ?? 0) > 0)) return false;
      if (saldoFilter === 'Sem saldo' && (saldo ?? 0) > 0) return false;
      const hay = `${m.code} ${m.description} ${m.measureUnit}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [rows, search, saldoFilter]);

  const first = contract.length === 0;
  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    setMsg(null);
    try {
      await dbEditContractSupply(editing, editing.description, editing.measureUnit);
      setEditing(null);
      setMsg({ ok: true, text: 'Item corrigido.' });
      await load(true);
    } catch (err: any) {
      setMsg({ ok: false, text: `Não foi possível salvar: ${err?.message || err}` });
    } finally {
      setBusy(false);
    }
  };
  const confirmDelete = async () => {
    if (!toDelete) return;
    setBusy(true);
    setMsg(null);
    try {
      await dbDeleteContractSupply(toDelete);
      setMsg({ ok: true, text: `Item ${toDelete.code} excluído do contrato.` });
      setToDelete(null);
      await load(true);
    } catch (err: any) {
      setMsg({ ok: false, text: `Não foi possível excluir: ${err?.message || err}` });
      setToDelete(null);
    } finally {
      setBusy(false);
    }
  };

  const field = 'h-9 text-xs px-3 border border-slate-200 rounded-lg outline-none font-semibold bg-white';

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-800">Gestão de Insumos</h2>
          <p className="text-xs text-slate-500">
            Contrato de insumos da empresa — <b>uma lista para todas as gerências</b>. Cada fornecimento do almoxarifado abate do saldo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <select value={company} onChange={(e) => setCompany(e.target.value)} aria-label="Empresa" className={`${field} cursor-pointer`}>
            {myCompanies.length === 0 && <option value="">Nenhuma empresa</option>}
            {myCompanies.map((c) => (
              <option key={c.id} value={c.id}>
                Empresa: {c.name}
              </option>
            ))}
          </select>
          {canImport && company && (
            <button
              type="button"
              onClick={() => setShowImport(true)}
              disabled={loading}
              className="h-9 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
            >
              <Upload className="w-4 h-4" /> {first ? 'Importar contrato' : 'Importar aditivo'}
            </button>
          )}
        </div>
      </div>

      {canView && canReport && (
        <div className="inline-flex gap-1 p-1 rounded-xl border border-slate-200 bg-white" role="tablist">
          {(
            [
              ['lista', 'CONTRATO E SALDO'],
              ['rel', 'RELATÓRIO DE SAÍDAS']
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-black cursor-pointer ${tab === k ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {msg && <p className={`text-xs font-bold ${msg.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{msg.text}</p>}

      {tab === 'rel' && canReport ? (
        company ? (
          <SupplyOutputsReport company={company} companyName={companyName(company)} visibleUnits={visibleUnits} contract={contract} />
        ) : null
      ) : !canView ? null : (
        <>
          {!first && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" style={{ maxWidth: 1000 }}>
              {[
                ['Valor do contrato', brl(totals.c), 'text-slate-900'],
                ['Já fornecido', brl(totals.f), 'text-violet-700'],
                ['Saldo em valor', brl(totals.c - totals.f), 'text-emerald-700'],
                ['Itens sem saldo', String(totals.zero), totals.zero ? 'text-rose-600' : 'text-slate-900']
              ].map(([l, v, c]) => (
                <div key={l} className="bg-white border border-slate-200 rounded-xl px-4 py-3">
                  <p className={`text-lg font-black ${c}`}>{v}</p>
                  <p className="text-[11px] font-bold text-slate-500">{l}</p>
                </div>
              ))}
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar item ou descrição..." className={`${field} w-full pl-9`} />
            </div>
            <select value={saldoFilter} onChange={(e) => setSaldoFilter(e.target.value as typeof saldoFilter)} aria-label="Filtrar por saldo" className={`${field} cursor-pointer`}>
              <option value="Todos">Com e sem saldo</option>
              <option value="Com saldo">Com saldo</option>
              <option value="Sem saldo">Sem saldo</option>
            </select>
          </div>

          {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
          {loading && <p className="text-xs text-slate-500">Carregando...</p>}
          {!loading && first && (
            <div className="bg-white p-8 rounded-xl border border-slate-200 text-center text-sm font-bold text-slate-500">
              Nenhum contrato de insumos importado para {companyName(company) || 'esta empresa'}.{' '}
              {canImport ? 'Use "Importar contrato".' : 'Peça a quem tem a permissão "Importar contrato e aditivos de insumos".'}
            </div>
          )}

          {!first && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className={th}>Item</th>
                    <th className={th}>Descrição</th>
                    <th className={th}>Unid.</th>
                    <th className={`${th} text-right`}>Contratado</th>
                    <th className={`${th} text-right`}>Fornecido</th>
                    <th className={`${th} text-right`}>Aprovado (aguarda almox.)</th>
                    <th className={`${th} text-right`}>Saldo</th>
                    <th className={`${th} text-right`}>Preço unitário</th>
                    <th className={`${th} text-right`}>Valor contratado</th>
                    {(canEdit || isSuperAdmin) && <th className={`${th} text-right`}>Ações</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(({ m, b, saldo }) => {
                    const open = openId === m.id;
                    return (
                      <React.Fragment key={m.id}>
                        <tr className="border-b border-slate-100 align-top">
                          <td className="p-2.5 font-mono font-black text-indigo-700 whitespace-nowrap">
                            <button type="button" onClick={() => setOpenId(open ? null : m.id)} className="flex items-center gap-1 cursor-pointer" aria-label={`Histórico de ${m.code}`}>
                              {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                              {m.code}
                            </button>
                          </td>
                          <td className="p-2.5 text-slate-800" style={{ maxWidth: 420 }}>
                            {m.description}
                          </td>
                          <td className="p-2.5 text-slate-600">{m.measureUnit}</td>
                          <td className="p-2.5 text-right font-bold">{b ? formatSupplyQty(b.contractQty) : '—'}</td>
                          <td className="p-2.5 text-right text-violet-700 font-bold">{b ? formatSupplyQty(b.suppliedQty) : '—'}</td>
                          <td className="p-2.5 text-right text-blue-700">{b && b.reservedQty > 0 ? formatSupplyQty(b.reservedQty) : '—'}</td>
                          <td className={`p-2.5 text-right font-black whitespace-nowrap ${saldo === null ? 'text-slate-400' : saldo <= 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                            {saldo === null ? '—' : saldo <= 0 ? 'sem saldo' : formatSupplyQty(saldo)}
                          </td>
                          <td className="p-2.5 text-right whitespace-nowrap">{price4(m.cost)}</td>
                          <td className="p-2.5 text-right whitespace-nowrap">{b ? brl(b.contractQty * m.cost) : '—'}</td>
                          {(canEdit || isSuperAdmin) && (
                            <td className="p-2.5 text-right whitespace-nowrap">
                              {canEdit && (
                                <button type="button" onClick={() => setEditing({ ...m })} className="p-1.5 text-slate-500 hover:text-indigo-600 cursor-pointer" aria-label={`Editar ${m.code}`}>
                                  <Pencil className="w-4 h-4" />
                                </button>
                              )}
                              {isSuperAdmin && (!b || (b.suppliedQty === 0 && b.reservedQty === 0)) && (
                                <button type="button" onClick={() => setToDelete(m)} className="p-1.5 text-slate-400 hover:text-rose-600 cursor-pointer" aria-label={`Excluir ${m.code}`}>
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                        {open && (
                          <tr className="border-b border-slate-100 bg-slate-50/60">
                            <td colSpan={10} className="px-4 py-3">
                              <div className="grid sm:grid-cols-2 gap-4 text-[11px] text-slate-600">
                                <div>
                                  <p className="font-black uppercase text-[10px] text-slate-500 mb-1">Preço unitário (vale a partir de)</p>
                                  {[...(m.history || [])]
                                    .sort((a, c) => c.from.localeCompare(a.from) || c.setAt.localeCompare(a.setAt))
                                    .map((h, i) => (
                                      <p key={i}>
                                        {dateBR(h.from)} · <b>{price4(h.value)}</b> · {h.reason || '—'} · {h.setBy}
                                      </p>
                                    ))}
                                </div>
                                <div>
                                  <p className="font-black uppercase text-[10px] text-slate-500 mb-1">Quantidade total do contrato</p>
                                  {[...(b?.qtyHistory || [])].reverse().map((h, i) => (
                                    <p key={i}>
                                      {dateBR(h.at)} · <b>{formatSupplyQty(h.qty)} {m.measureUnit}</b> · {h.reason} · {h.by}
                                    </p>
                                  ))}
                                  {!b?.qtyHistory?.length && <p>—</p>}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={10} className="p-6 text-center text-slate-500 font-bold">
                        Nenhum item encontrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div className="px-4 py-2 text-[11px] text-slate-500 border-t border-slate-100 flex gap-2">
                <Info className="w-4 h-4 shrink-0 text-indigo-600" />
                <span>
                  {contract.length} {contract.length === 1 ? 'item' : 'itens'} no contrato. <b>Saldo</b> = contratado − fornecido − aprovado que ainda está no almoxarifado. O
                  técnico não vê o saldo. Os valores em R$ usam o preço atual de cada item; o preço unitário usa o valor completo da planilha (o Excel mostra
                  arredondado). Toque no item para ver o histórico de preço e de quantidade.
                </span>
              </div>
            </div>
          )}
        </>
      )}

      {showImport && company && (
        <SupplyContractImportModal
          company={company}
          companyName={companyName(company)}
          contract={contract}
          currentUserName={userProfile.name}
          onClose={() => setShowImport(false)}
          onDone={() => load(true)}
        />
      )}

      {editing && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl p-6 space-y-4 text-slate-800">
            <div>
              <p className="text-sm font-black">Editar item {editing.code}</p>
              <p className="text-[11px] text-slate-500">Só a descrição e a unidade. Quantidade e preço mudam pela importação do aditivo.</p>
            </div>
            <label className="block space-y-1">
              <span className="block text-[10px] font-black uppercase tracking-wider text-slate-500">Descrição *</span>
              <textarea
                value={editing.description}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                rows={3}
                className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg font-semibold"
              />
            </label>
            <label className="block space-y-1">
              <span className="block text-[10px] font-black uppercase tracking-wider text-slate-500">Unidade</span>
              <input value={editing.measureUnit} onChange={(e) => setEditing({ ...editing, measureUnit: e.target.value })} className={`${field} w-32`} aria-label="Unidade" />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={busy} onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-bold text-slate-600 cursor-pointer">
                Cancelar
              </button>
              <button type="button" disabled={busy} onClick={saveEdit} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-black cursor-pointer disabled:opacity-50">
                {busy ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toDelete && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 space-y-4 text-slate-800">
            <p className="text-sm font-black">Excluir o item {toDelete.code} do contrato?</p>
            <p className="text-xs text-slate-600">
              {toDelete.description}. Só para corrigir erro de importação: o item nunca foi aprovado nem fornecido. Os técnicos deixam de vê-lo.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={busy} onClick={() => setToDelete(null)} className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-bold text-slate-600 cursor-pointer">
                Cancelar
              </button>
              <button type="button" disabled={busy} onClick={confirmDelete} className="px-4 py-2 rounded-lg bg-rose-600 text-white text-xs font-black cursor-pointer disabled:opacity-50">
                {busy ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
