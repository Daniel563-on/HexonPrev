import React, { useEffect, useMemo, useState } from 'react';
import { Search, Download, FileSearch } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Asset, HexonUser, Management, ServiceOrder, formatDateBR } from '../../types';
import {
  dbSearchClosedOrders,
  dbGetManagements,
  dbGetUsers,
  localMonthKey,
  OrdersSearchField,
  ORDERS_SEARCH_LIMIT
} from '../../db/firebase';
import { formatOrderNumber } from '../../utils/orderNumber';
import OrderDetailsDrawer from './OrderDetailsDrawer';

interface OrdersSearchPanelProps {
  userProfile?: HexonUser | null;
  assets: Asset[];
  templates: any[];
  userHasActionPermission?: (actionId: string) => boolean;
}

const PAGE_SIZE = 50;

// CONSULTA DE OS: ordens encerradas (Concluída / Não Executada) de um mês.
// O banco filtra mês + gerência + um filtro principal; status e texto são refinados aqui.
export default function OrdersSearchPanel({ userProfile, assets, templates, userHasActionPermission }: OrdersSearchPanelProps) {
  const fixedSector =
    userProfile?.perfil === 'Administrador' && userProfile.gerencia && userProfile.gerencia !== 'Todas'
      ? userProfile.gerencia
      : null;

  const [month, setMonth] = useState(localMonthKey());
  const [sector, setSector] = useState<string>(fixedSector || 'Todas');
  const [field, setField] = useState<OrdersSearchField | ''>('craai');
  const [value, setValue] = useState('');
  const [statusFilter, setStatusFilter] = useState<'Todos' | 'Concluída' | 'Não Executada'>('Todos');
  const [textFilter, setTextFilter] = useState('');

  const [managements, setManagements] = useState<Management[]>([]);
  const [technicians, setTechnicians] = useState<string[]>([]);
  const [results, setResults] = useState<ServiceOrder[] | null>(null);
  const [limited, setLimited] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [openOrder, setOpenOrder] = useState<ServiceOrder | null>(null);

  useEffect(() => {
    dbGetManagements().then((list) => setManagements(list.filter((m) => m.name !== 'Todas'))).catch(() => {});
    dbGetUsers()
      .then((list) =>
        setTechnicians(
          Array.from(new Set(list.filter((u) => u.perfil === 'Profissional').map((u) => u.name))).sort((a, b) => a.localeCompare(b))
        )
      )
      .catch(() => {});
  }, []);

  const effectiveSector = fixedSector || (sector === 'Todas' ? null : sector);

  // Opções de CRAAI e comarca a partir do cadastro de ativos da gerência
  const locationOptions = useMemo(() => {
    const craais = new Set<string>();
    const comarcas = new Set<string>();
    assets.forEach((a) => {
      if (effectiveSector && (a.sector || '').trim() !== effectiveSector) return;
      const craai = a.specs?.CRAAI || a.specs?.craai;
      const comarca = a.specs?.COMARCA || a.specs?.comarca;
      if (typeof craai === 'string' && craai.trim()) craais.add(craai.trim());
      if (typeof comarca === 'string' && comarca.trim()) comarcas.add(comarca.trim());
    });
    const sort = (s: Set<string>) => Array.from(s).sort((a, b) => a.localeCompare(b));
    return { craai: sort(craais), comarca: sort(comarcas) };
  }, [assets, effectiveSector]);

  const valueOptions =
    field === 'craai' ? locationOptions.craai : field === 'comarca' ? locationOptions.comarca : field === 'assignedTechnician' ? technicians : [];

  const handleSearch = async () => {
    if (field && !value) {
      alert('Escolha o valor do filtro principal (ou selecione "Nenhum").');
      return;
    }
    setLoading(true);
    setError(null);
    setPage(1);
    try {
      const res = await dbSearchClosedOrders({ month, sector: effectiveSector, field: field || null, value });
      setResults(res.orders);
      setLimited(res.limited);
    } catch (err: any) {
      console.warn('Consulta de OS falhou:', err);
      setError(err?.message || String(err));
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  // Refino na tela: status e texto
  const refined = useMemo(() => {
    if (!results) return [];
    const q = textFilter.trim().toLowerCase();
    return results.filter((o) => {
      if (statusFilter !== 'Todos' && o.status !== statusFilter) return false;
      if (!q) return true;
      return [o.id, o.title, o.assetName, o.assetCode, o.assignedTechnician]
        .some((v) => (v || '').toLowerCase().includes(q));
    });
  }, [results, statusFilter, textFilter]);

  const totalPages = Math.max(1, Math.ceil(refined.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = refined.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const handleExport = () => {
    const rows = refined.map((o) => ({
      'Nº OS': o.id,
      'Título': o.title,
      'Ativo': o.assetName,
      'Código': o.assetCode,
      'Gerência': o.sector,
      'CRAAI': o.craai || '',
      'Comarca': o.comarca || o.surveyLocation || '',
      'Técnico': o.assignedTechnician,
      'Status': o.status,
      'Periodicidade': o.periodicity || '',
      'Início do Período': formatDateBR(o.startDate),
      'Fim do Período': formatDateBR(o.endDate),
      'Concluída em': formatDateBR(o.signedAt)
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Consulta de OS');
    XLSX.writeFile(workbook, `Consulta_OS_${month}.xlsx`);
  };

  const inputClass = 'w-full text-xs py-2 px-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none font-bold text-slate-800';
  const labelClass = 'block text-[10px] font-extrabold text-slate-500 uppercase mb-1';

  return (
    <div className="space-y-4">
      {/* Filtros do banco */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className={labelClass}>Mês de encerramento*</label>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Gerência</label>
            {fixedSector ? (
              <input type="text" value={fixedSector} disabled className={`${inputClass} text-slate-500 cursor-not-allowed`} />
            ) : (
              <select value={sector} onChange={(e) => setSector(e.target.value)} className={inputClass}>
                <option value="Todas">Todas</option>
                {managements.map((m) => (
                  <option key={m.id} value={m.name}>{m.name}</option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className={labelClass}>Filtro principal</label>
            <select
              value={field}
              onChange={(e) => {
                setField(e.target.value as OrdersSearchField | '');
                setValue('');
              }}
              className={inputClass}
            >
              <option value="craai">CRAAI</option>
              <option value="comarca">Comarca</option>
              <option value="assignedTechnician">Técnico</option>
              <option value="">Nenhum</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Valor</label>
            <select value={value} onChange={(e) => setValue(e.target.value)} disabled={!field} className={inputClass}>
              <option value="">{field ? 'Selecione...' : '—'}</option>
              {valueOptions.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSearch}
            disabled={loading}
            className="px-5 py-2.5 bg-[#3525cd] hover:bg-[#281bbb] text-white text-xs font-black uppercase tracking-wider rounded-xl flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
          >
            <Search className="w-4 h-4" />
            {loading ? 'Buscando...' : 'Buscar'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-bold text-rose-800">
          Não foi possível buscar: {error}
        </div>
      )}

      {results && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3">
          {/* Refino na tela */}
          <div className="flex flex-col md:flex-row gap-3 md:items-end">
            <div className="flex-1">
              <label className={labelClass}>Buscar no resultado</label>
              <input
                type="text"
                value={textFilter}
                onChange={(e) => {
                  setTextFilter(e.target.value);
                  setPage(1);
                }}
                placeholder="Nº da OS, título, ativo, código, técnico..."
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Status</label>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as typeof statusFilter);
                  setPage(1);
                }}
                className={inputClass}
              >
                <option value="Todos">Todos</option>
                <option value="Concluída">Concluída</option>
                <option value="Não Executada">Não Executada</option>
              </select>
            </div>
            <button
              type="button"
              onClick={handleExport}
              disabled={refined.length === 0}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider rounded-xl flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              Exportar Excel
            </button>
          </div>

          <p className="text-[11px] font-bold text-slate-500">
            {refined.length} OS encontrada(s)
            {limited && ` — resultado limitado às ${ORDERS_SEARCH_LIMIT} primeiras; use um filtro principal para refinar`}
          </p>

          <div className="divide-y divide-slate-100">
            {pageItems.map((o) => (
              <div key={o.id} className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <span className="font-mono text-[10px] font-bold text-indigo-600">#{formatOrderNumber(o.id)}</span>
                  <p className="font-extrabold text-slate-800 truncate">{o.title}</p>
                  <p className="text-[10px] text-slate-500">
                    {o.craai || o.sector} • {o.comarca || o.surveyLocation || 'Geral'} • {o.assignedTechnician || 'Sem técnico'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                      o.status === 'Concluída' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                    }`}
                  >
                    {o.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => setOpenOrder(o)}
                    className="py-1 px-2.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-[9px] font-black text-indigo-700 rounded-lg flex items-center gap-1 cursor-pointer"
                  >
                    <FileSearch className="w-3 h-3" />
                    VER OS COMPLETA
                  </button>
                </div>
              </div>
            ))}
            {pageItems.length === 0 && (
              <p className="py-8 text-center text-xs font-bold text-slate-400 italic">Nenhuma OS encontrada para estes filtros.</p>
            )}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage(safePage - 1)}
                className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-40"
              >
                Anterior
              </button>
              <span className="text-xs font-bold text-slate-600">
                Página {safePage} de {totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage(safePage + 1)}
                className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-40"
              >
                Próxima
              </button>
            </div>
          )}
        </div>
      )}

      {/* OS completa (somente consulta) */}
      <OrderDetailsDrawer
        isOpen={!!openOrder}
        order={openOrder}
        onClose={() => setOpenOrder(null)}
        onReload={() => {}}
        assets={assets}
        templates={templates}
        userProfile={userProfile}
        userHasActionPermission={userHasActionPermission}
        canRevertUnexecutedOrder={() => false}
        currentCalendarDate={new Date()}
      />
    </div>
  );
}
