import React, { useEffect, useMemo, useState } from 'react';
import { Search, Download, FileSearch } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Asset, HexonUser, Management, ServiceOrder, formatDateBR } from '../../types';
import {
  isSectorVisible,
  dbSearchOrders,
  dbGetManagements,
  dbGetUsers,
  ORDERS_SEARCH_LIMIT
} from '../../db/firebase';
import { formatOrderNumber } from '../../utils/orderNumber';
import OrderDetailsDrawer from './OrderDetailsDrawer';

interface OrdersSearchPanelProps {
  userProfile?: HexonUser | null;
  visibleUnits?: string[] | null; // unidades do perfil (null = todas)
  assets: Asset[];
  templates: any[];
  userHasActionPermission?: (actionId: string) => boolean;
}

const PAGE_SIZE = 50;
const STATUS_OPTIONS: ServiceOrder['status'][] = ['Novo', 'Planejada', 'Em Execução', 'Atrasada', 'Concluída', 'Não Executada', 'Cancelada'];

// CONSULTA DE OS: qualquer OS (abertas e fechadas), de qualquer mês.
// Todos os filtros são opcionais e independentes (1, 2, 3 ou todos). O texto refina o resultado na tela.
export default function OrdersSearchPanel({ userProfile, visibleUnits = null, assets, templates, userHasActionPermission }: OrdersSearchPanelProps) {
  // Uma unidade só: fica fixa. Várias: o seletor mostra apenas as do perfil.
  const fixedSector = visibleUnits && visibleUnits.length === 1 ? visibleUnits[0] : null;

  const [month, setMonth] = useState('');
  const [sector, setSector] = useState<string>(fixedSector || 'Todas');
  const [status, setStatus] = useState<ServiceOrder['status'] | ''>('');
  const [craai, setCraai] = useState('');
  const [comarca, setComarca] = useState('');
  const [technician, setTechnician] = useState('');
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
          Array.from(new Set(list.filter((u) => u.perfil === 'Profissional' && (visibleUnits === null || u.gerencia === 'Todas' || visibleUnits.includes(u.gerencia))).map((u) => u.name))).sort((a, b) => a.localeCompare(b))
        )
      )
      .catch(() => {});
  }, []);

  const effectiveSector = fixedSector || (sector === 'Todas' ? null : sector);

  // Opções de CRAAI e comarca a partir do cadastro de ativos (comarca só da CRAAI escolhida)
  const locationOptions = useMemo(() => {
    const craais = new Set<string>();
    const comarcas = new Set<string>();
    assets.forEach((a) => {
      if (effectiveSector && !isSectorVisible(a.sector || '', [effectiveSector])) return;
      if (!isSectorVisible(a.sector || '', visibleUnits)) return;
      const c = a.specs?.CRAAI || a.specs?.craai;
      const cm = a.specs?.COMARCA || a.specs?.comarca;
      if (typeof c === 'string' && c.trim()) craais.add(c.trim());
      if (typeof cm === 'string' && cm.trim() && (!craai || (typeof c === 'string' && c.trim() === craai))) comarcas.add(cm.trim());
    });
    const sort = (set: Set<string>) => Array.from(set).sort((a, b) => a.localeCompare(b));
    return { craai: sort(craais), comarca: sort(comarcas) };
  }, [assets, effectiveSector, visibleUnits, craai]);

  const clearFilters = () => {
    setMonth('');
    setSector(fixedSector || 'Todas');
    setStatus('');
    setCraai('');
    setComarca('');
    setTechnician('');
    setTextFilter('');
  };

  const handleSearch = async () => {
    setLoading(true);
    setError(null);
    setPage(1);
    try {
      const res = await dbSearchOrders({
        month,
        units: effectiveSector ? [effectiveSector] : visibleUnits,
        status,
        craai,
        comarca,
        technician
      });
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

  // Refino na tela: texto
  const refined = useMemo(() => {
    if (!results) return [];
    const q = textFilter.trim().toLowerCase();
    return results.filter((o) => {
      if (!q) return true;
      return [o.id, o.title, o.assetName, o.assetCode, o.assignedTechnician]
        .some((v) => (v || '').toLowerCase().includes(q));
    });
  }, [results, textFilter]);

  const totalPages = Math.max(1, Math.ceil(refined.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = refined.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const handleExport = () => {
    const rows = refined.map((o) => ({
      'Nº OS': o.id,
      'Título': o.title,
      'Ativo': o.assetName,
      'Código': o.assetCode,
      'Gerência': o.unit || o.sector,
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
    XLSX.writeFile(workbook, `Consulta_OS_${month || 'todos-os-meses'}.xlsx`);
  };

  const inputClass = 'w-full text-xs py-2 px-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none font-bold text-slate-800';
  const labelClass = 'block text-[10px] font-extrabold text-slate-500 uppercase mb-1';

  return (
    <div className="space-y-4">
      {/* Filtros do banco */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className={labelClass}>Mês (período da OS)</label>
            <div className="flex gap-1.5">
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inputClass} />
              {month && (
                <button type="button" onClick={() => setMonth('')} className="px-2 text-[10px] font-black text-slate-500 border border-slate-200 rounded-lg cursor-pointer" title="Todos os meses">
                  ✕
                </button>
              )}
            </div>
            {!month && <span className="text-[9px] font-bold text-slate-400">Todos os meses</span>}
          </div>
          <div>
            <label className={labelClass}>Gerência</label>
            {fixedSector ? (
              <input type="text" value={fixedSector} disabled className={`${inputClass} text-slate-500 cursor-not-allowed`} />
            ) : (
              <select value={sector} onChange={(e) => setSector(e.target.value)} className={inputClass}>
                <option value="Todas">{visibleUnits ? 'Todas as minhas unidades' : 'Todas'}</option>
                {managements.filter((m) => visibleUnits === null || visibleUnits.includes(m.name)).map((m) => (
                  <option key={m.id} value={m.name}>{m.name}</option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className={labelClass}>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as ServiceOrder['status'] | '')} className={inputClass}>
              <option value="">Todos</option>
              {STATUS_OPTIONS.map((st) => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>CRAAI</label>
            <select value={craai} onChange={(e) => { setCraai(e.target.value); setComarca(''); }} className={inputClass}>
              <option value="">Todas</option>
              {locationOptions.craai.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Comarca</label>
            <select value={comarca} onChange={(e) => setComarca(e.target.value)} className={inputClass}>
              <option value="">Todas</option>
              {locationOptions.comarca.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Técnico</label>
            <select value={technician} onChange={(e) => setTechnician(e.target.value)} className={inputClass}>
              <option value="">Todos</option>
              {technicians.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={clearFilters}
            className="px-4 py-2.5 border border-slate-200 text-slate-600 text-xs font-black uppercase tracking-wider rounded-xl cursor-pointer"
          >
            Limpar filtros
          </button>
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
            {limited && ` — mostrando as ${ORDERS_SEARCH_LIMIT} mais recentes; use mais filtros para refinar`}
          </p>

          <div className="divide-y divide-slate-100">
            {pageItems.map((o) => (
              <div key={o.id} className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <span className="font-mono text-[10px] font-bold text-indigo-600">#{formatOrderNumber(o.id)}</span>
                  <p className="font-extrabold text-slate-800 truncate">{o.title}</p>
                  <p className="text-[10px] text-slate-500">
                    {formatDateBR(o.startDate)} a {formatDateBR(o.endDate)} • {o.unit || o.sector} • {o.craai || '—'} • {o.comarca || o.surveyLocation || '—'} • {o.assignedTechnician || 'Sem técnico'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                      o.status === 'Concluída'
                        ? 'bg-emerald-100 text-emerald-800'
                        : o.status === 'Não Executada' || o.status === 'Atrasada'
                        ? 'bg-rose-100 text-rose-800'
                        : o.status === 'Cancelada'
                        ? 'bg-slate-200 text-slate-700'
                        : 'bg-indigo-100 text-indigo-800'
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
