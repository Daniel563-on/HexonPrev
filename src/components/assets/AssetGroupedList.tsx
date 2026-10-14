import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Building2, ChevronDown, ChevronRight, Download, Edit, Eye, Filter, List, Trash2 } from 'lucide-react';
import { Asset } from '../../types';
import { norm } from './assetImport';

// LISTA DE ATIVOS (A4-B): agrupada por prédio (padrão) ou lista corrida. Cada prédio mostra quantos ativos tem,
// a situação deles e os tipos; abrindo, aparecem os ativos com a sala, o equipamento e o tipo.

interface Props {
  results: Asset[];
  resetKey: string;
  searching: boolean; // com busca digitada os prédios já abrem mostrando o que foi achado
  companyName: (id: string) => string;
  canViewCosts: boolean;
  onSelectAsset: (a: Asset) => void;
  onEditAsset: (a: Asset) => void;
  onDeleteAsset: (a: Asset) => void;
  canEdit: boolean;
  canDelete: boolean;
}

const VIEW_KEY = 'hexon_assets_view';
const GROUPS_PER_PAGE = 25;
const ROWS_PER_PAGE = 50;

export const buildingOf = (a: Asset) => (a.kind === 'address' ? a.name : a.location || '').trim() || 'Sem endereço';
const spec = (a: Asset, ...keys: string[]) => {
  for (const k of keys) {
    const v = a.specs?.[k];
    if (v !== undefined && String(v).trim() !== '') return String(v).trim();
  }
  return '';
};
export const assetRoom = (a: Asset) => spec(a, 'LOCALIZAÇÃO', 'SALA', 'sala', 'SETOR', 'setor');
export const assetCapacity = (a: Asset) => spec(a, 'CAPACIDADE', 'capacity');
export const assetTipo = (a: Asset) => (a.kind === 'address' ? 'IMÓVEL / ENDEREÇO' : spec(a, 'TIPO', 'tipo'));

const statusCls = (s: string) =>
  s === 'Operando'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : s === 'Em Manutenção'
    ? 'bg-amber-50 text-amber-700 border-amber-200'
    : s === 'Parado'
    ? 'bg-orange-50 text-orange-700 border-orange-200'
    : 'bg-slate-100 text-slate-500 border-slate-200';

interface Group {
  key: string;
  building: string;
  comarca: string;
  craai: string;
  items: Asset[];
  status: Map<string, number>;
  types: Map<string, number>;
}

export default function AssetGroupedList(p: Props) {
  const { results, resetKey, searching, companyName, canViewCosts, onSelectAsset, onEditAsset, onDeleteAsset, canEdit, canDelete } = p;
  const [view, setView] = useState<'grupo' | 'lista'>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'lista' ? 'lista' : 'grupo';
    } catch {
      return 'grupo';
    }
  });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const changeView = (v: 'grupo' | 'lista') => {
    setView(v);
    setPage(1);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignora */
    }
  };

  const groups = useMemo<Group[]>(() => {
    const m = new Map<string, Group>();
    for (const a of results) {
      const building = buildingOf(a);
      const key = norm(building);
      let g = m.get(key);
      if (!g) {
        g = { key, building, comarca: spec(a, 'COMARCA', 'comarca'), craai: spec(a, 'CRAAI', 'craai'), items: [], status: new Map(), types: new Map() };
        m.set(key, g);
      }
      g.items.push(a);
      g.status.set(a.status, (g.status.get(a.status) || 0) + 1);
      const t = a.status === 'Baixado' ? '' : assetTipo(a) || 'SEM TIPO';
      if (t) g.types.set(t, (g.types.get(t) || 0) + 1);
    }
    return Array.from(m.values()).sort(
      (x, y) => x.craai.localeCompare(y.craai) || x.comarca.localeCompare(y.comarca) || x.building.localeCompare(y.building)
    );
  }, [results]);

  // Filtros mudaram: volta para a página 1; com busca, os prédios achados já abrem
  useEffect(() => {
    setPage(1);
    setOpen(searching && results.length <= 300 ? new Set(groups.map((g) => g.key)) : new Set());
  }, [resetKey]);

  const total = view === 'grupo' ? groups.length : results.length;
  const per = view === 'grupo' ? GROUPS_PER_PAGE : ROWS_PER_PAGE;
  const pages = Math.max(1, Math.ceil(total / per));
  const pageNow = Math.min(page, pages);
  const pageGroups = groups.slice((pageNow - 1) * per, pageNow * per);
  const pageRows = results.slice((pageNow - 1) * per, pageNow * per);

  const exportExcel = () => {
    const rows = results.map((a) => ({
      'Nº PATRIMONIAL': a.code,
      MATERIAL: a.name,
      CAPACIDADE: assetCapacity(a),
      TIPO: assetTipo(a),
      'GERÊNCIA': a.sector,
      EMPRESA: a.company ? companyName(a.company) : '',
      'ENDEREÇO': buildingOf(a),
      'LOCALIZAÇÃO': assetRoom(a),
      COMARCA: spec(a, 'COMARCA', 'comarca'),
      CRAAI: spec(a, 'CRAAI', 'craai'),
      MARCA: spec(a, 'MARCA', 'manufacturer'),
      MODELO: spec(a, 'MODELO', 'model'),
      'Nº DE SÉRIE': spec(a, 'Nº DE SÉRIE', 'serialNumber'),
      'DATA DE AQUISIÇÃO': spec(a, 'DATA DE AQUISIÇÃO', 'installationDate'),
      STATUS: a.status,
      ...(canViewCosts ? { 'VALOR LÍQUIDO': spec(a, 'VALOR LÍQUIDO') } : {})
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ativos');
    XLSX.writeFile(wb, `Ativos_Hexon_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  if (results.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-12 text-center">
        <Filter className="w-10 h-10 text-indigo-300 mx-auto mb-3" />
        <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Nenhum ativo encontrado</p>
        <p className="text-xs text-slate-500 mt-1">Ajuste a busca ou os filtros acima.</p>
      </div>
    );
  }

  const actions = (a: Asset) => (
    <div className="flex items-center justify-end gap-1">
      <button type="button" onClick={() => onSelectAsset(a)} title="Ver a ficha" className="p-1.5 rounded-md bg-indigo-50 text-indigo-700 cursor-pointer">
        <Eye className="w-3.5 h-3.5" />
      </button>
      {a.kind !== 'address' && canEdit && (
        <button type="button" onClick={() => onEditAsset(a)} title="Editar" className="p-1.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer">
          <Edit className="w-3.5 h-3.5" />
        </button>
      )}
      {a.kind !== 'address' && canDelete && (
        <button type="button" onClick={() => onDeleteAsset(a)} title="Excluir" className="p-1.5 rounded-md bg-rose-50 text-rose-600 cursor-pointer">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
  const td = 'px-3 py-2 align-top';
  const equip = (a: Asset) => (
    <>
      <span className="block font-bold text-slate-800 dark:text-slate-100">{a.name}</span>
      {assetCapacity(a) && <span className="block text-[11px] text-slate-500">{assetCapacity(a)}</span>}
    </>
  );
  const tipoCell = (a: Asset) =>
    assetTipo(a) ? (
      <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200">{assetTipo(a)}</span>
    ) : (
      <span className="px-1.5 py-0.5 rounded border text-[10px] font-black bg-amber-50 text-amber-800 border-amber-200" title="Sem tipo: não gera preventiva">Sem tipo</span>
    );
  const marcaModelo = (a: Asset) => [spec(a, 'MARCA', 'manufacturer'), spec(a, 'MODELO', 'model')].filter(Boolean).join(' · ') || '—';
  const statusChip = (s: string) => <span className={`px-2 py-0.5 rounded border text-[10px] font-black whitespace-nowrap ${statusCls(s)}`}>{s}</span>;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 shadow-sm overflow-hidden">
      {/* BARRA */}
      <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900/60 border-b border-gray-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-extrabold text-indigo-700 dark:text-indigo-300">
          {results.length.toLocaleString('pt-BR')} ativo(s) em {groups.length.toLocaleString('pt-BR')} prédio(s)
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-gray-300 dark:border-slate-700 overflow-hidden text-xs font-bold" role="group" aria-label="Modo da lista">
            <button type="button" onClick={() => changeView('grupo')} aria-pressed={view === 'grupo'} className={`px-3 py-1.5 flex items-center gap-1.5 cursor-pointer ${view === 'grupo' ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'}`}>
              <Building2 className="w-3.5 h-3.5" /> Por prédio
            </button>
            <button type="button" onClick={() => changeView('lista')} aria-pressed={view === 'lista'} className={`px-3 py-1.5 flex items-center gap-1.5 cursor-pointer ${view === 'lista' ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'}`}>
              <List className="w-3.5 h-3.5" /> Lista corrida
            </button>
          </div>
          {view === 'grupo' && (
            <button type="button" onClick={() => setOpen(open.size ? new Set() : new Set(pageGroups.map((g) => g.key)))} className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 cursor-pointer">
              {open.size ? 'Fechar todos' : 'Abrir todos'}
            </button>
          )}
          <button type="button" onClick={exportExcel} className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer">
            <Download className="w-3.5 h-3.5 text-emerald-600" /> Baixar Excel ({results.length.toLocaleString('pt-BR')})
          </button>
        </div>
      </div>

      {view === 'grupo' ? (
        <div className="divide-y divide-gray-100 dark:divide-slate-800">
          {pageGroups.map((g) => {
            const isOpen = open.has(g.key);
            const statusTxt = ['Operando', 'Em Manutenção', 'Parado', 'Baixado']
              .filter((s) => g.status.get(s))
              .map((s) => `${g.status.get(s)} ${s === 'Em Manutenção' ? 'em manutenção' : s.toLowerCase()}`)
              .join(' · ');
            return (
              <div key={g.key}>
                <button
                  type="button"
                  onClick={() => setOpen((prev) => {
                    const n = new Set(prev);
                    if (n.has(g.key)) n.delete(g.key);
                    else n.add(g.key);
                    return n;
                  })}
                  aria-expanded={isOpen}
                  className="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer"
                >
                  {isOpen ? <ChevronDown className="w-4 h-4 mt-0.5 text-indigo-600 shrink-0" /> : <ChevronRight className="w-4 h-4 mt-0.5 text-slate-400 shrink-0" />}
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs font-black text-slate-900 dark:text-white">{g.building}</span>
                    <span className="block text-[11px] text-slate-500">
                      {[g.comarca, g.craai && `CRAAI ${g.craai}`].filter(Boolean).join(' · ') || '—'}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {Array.from(g.types.entries())
                        .sort((a, b) => b[1] - a[1])
                        .map(([t, c]) => (
                          <span key={t} className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${t === 'SEM TIPO' ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'}`}>
                            {t === 'SEM TIPO' ? 'Sem tipo' : t} {c}
                          </span>
                        ))}
                    </span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block text-sm font-black text-slate-900 dark:text-white">{g.items.length} ativo{g.items.length > 1 ? 's' : ''}</span>
                    <span className="block text-[11px] text-slate-500">{statusTxt}</span>
                  </span>
                </button>
                {isOpen && (
                  <div className="overflow-x-auto bg-slate-50/50 dark:bg-slate-950/30">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400">
                          <th className="px-3 py-1.5 pl-11 font-black">Patrimônio</th>
                          <th className="px-3 py-1.5 font-black">Equipamento</th>
                          <th className="px-3 py-1.5 font-black">Sala / setor</th>
                          <th className="px-3 py-1.5 font-black">Marca · modelo</th>
                          <th className="px-3 py-1.5 font-black">Tipo</th>
                          <th className="px-3 py-1.5 font-black">Empresa</th>
                          <th className="px-3 py-1.5 font-black">Status</th>
                          <th className="px-3 py-1.5" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                        {g.items.map((a) => (
                          <tr key={a.id} className="hover:bg-white dark:hover:bg-slate-900">
                            <td className={`${td} pl-11 font-mono font-bold text-indigo-700 dark:text-indigo-300 whitespace-nowrap`}>{a.code}</td>
                            <td className={td}>{equip(a)}</td>
                            <td className={`${td} text-slate-600 dark:text-slate-300 max-w-[16rem]`}>{assetRoom(a) || '—'}</td>
                            <td className={`${td} text-slate-600 dark:text-slate-300`}>{marcaModelo(a)}</td>
                            <td className={td}>{tipoCell(a)}</td>
                            <td className={`${td} text-slate-600 dark:text-slate-300 whitespace-nowrap`}>{a.kind === 'address' ? '—' : companyName(a.company || '')}</td>
                            <td className={td}>{statusChip(a.status)}</td>
                            <td className={td}>{actions(a)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 bg-slate-100 dark:bg-slate-800/60">
                <th className="px-3 py-2 font-black">Patrimônio</th>
                <th className="px-3 py-2 font-black">Equipamento</th>
                <th className="px-3 py-2 font-black">Prédio / sala</th>
                <th className="px-3 py-2 font-black">Gerência</th>
                <th className="px-3 py-2 font-black">Tipo</th>
                <th className="px-3 py-2 font-black">Empresa</th>
                <th className="px-3 py-2 font-black">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
              {pageRows.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className={`${td} font-mono font-bold text-indigo-700 dark:text-indigo-300 whitespace-nowrap`}>{a.code}</td>
                  <td className={td}>{equip(a)}</td>
                  <td className={`${td} max-w-[20rem]`}>
                    <span className="block text-slate-700 dark:text-slate-200">{buildingOf(a)}</span>
                    {assetRoom(a) && <span className="block text-[11px] text-slate-500">{assetRoom(a)}</span>}
                  </td>
                  <td className={td}>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">{a.sector}</span>
                  </td>
                  <td className={td}>{tipoCell(a)}</td>
                  <td className={`${td} text-slate-600 dark:text-slate-300 whitespace-nowrap`}>{a.kind === 'address' ? '—' : companyName(a.company || '')}</td>
                  <td className={td}>{statusChip(a.status)}</td>
                  <td className={td}>{actions(a)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900/60 border-t border-gray-200 dark:border-slate-800 flex items-center justify-between text-xs">
          <span className="text-slate-500">
            {view === 'grupo' ? 'Prédios' : 'Ativos'} {((pageNow - 1) * per + 1).toLocaleString('pt-BR')} a {Math.min(pageNow * per, total).toLocaleString('pt-BR')} de {total.toLocaleString('pt-BR')}
          </span>
          <span className="flex items-center gap-2">
            <button type="button" disabled={pageNow === 1} onClick={() => setPage(pageNow - 1)} className="px-3 py-1 rounded-lg border border-gray-300 dark:border-slate-700 font-bold disabled:opacity-40 cursor-pointer">
              Anterior
            </button>
            <b className="text-slate-700 dark:text-slate-200">{pageNow} / {pages}</b>
            <button type="button" disabled={pageNow === pages} onClick={() => setPage(pageNow + 1)} className="px-3 py-1 rounded-lg border border-gray-300 dark:border-slate-700 font-bold disabled:opacity-40 cursor-pointer">
              Próxima
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
