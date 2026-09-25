import React from 'react';
import { Search, RotateCcw } from 'lucide-react';
import { AssetFiltersState, FacetKey } from '../../hooks/useAssetFilters';

// Barra de busca + 5 filtros (Gerência, CRAAI, Comarca, Tipo, Status) com a quantidade em cada opção
export function AssetFilterBar({ f }: { f: AssetFiltersState }) {
  const selectClass =
    'w-full text-xs font-bold py-2 px-2.5 bg-white border border-gray-300 rounded-lg text-slate-800 focus:outline-[#3525cd] focus:ring-1 focus:ring-[#3525cd] cursor-pointer';
  const labelClass = 'block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1';

  const fields: { key: FacetKey; label: string; all: string; value: string; set: (v: string) => void; values: string[] }[] = [
    { key: 'gerencia', label: 'Gerência', all: 'Todas', value: f.gerencia, set: f.setGerencia, values: f.options.gerencia },
    { key: 'craai', label: 'CRAAI', all: 'Todas', value: f.craai, set: f.setCraai, values: f.options.craai },
    { key: 'comarca', label: 'Comarca', all: 'Todas', value: f.comarca, set: f.setComarca, values: f.options.comarca },
    { key: 'tipo', label: 'Tipo', all: 'Todos', value: f.tipo, set: f.setTipo, values: f.options.tipo },
    { key: 'status', label: 'Status', all: 'Todos', value: f.status, set: f.setStatus, values: f.options.status }
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
          <input
            type="text"
            value={f.searchText}
            onChange={(e) => f.setSearchText(e.target.value)}
            placeholder="Buscar patrimônio, nome, série, sala, fabricante, modelo..."
            className="w-full text-sm font-medium py-2.5 pl-10 pr-3 bg-slate-50 border border-gray-300 rounded-xl text-slate-800 placeholder-gray-400 focus:outline-[#3525cd] focus:ring-1 focus:ring-[#3525cd]"
          />
        </div>
        {f.hasActiveFilters && (
          <button
            type="button"
            onClick={f.clear}
            className="text-[11px] font-bold text-slate-500 hover:text-[#3525cd] flex items-center gap-1 cursor-pointer whitespace-nowrap"
          >
            <RotateCcw className="w-3 h-3" /> Limpar filtros
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
        {fields.map((field) => (
          <label key={field.key} className="block min-w-0">
            <span className={labelClass}>{field.label}</span>
            <select value={field.value} onChange={(e) => field.set(e.target.value)} className={selectClass}>
              <option value={field.all}>{f.optionLabel(field.all, f.totals[field.key])}</option>
              {f.visibleOptions(field.key, field.values, field.value).map((v) => (
                <option key={v} value={v}>
                  {f.optionLabel(v, f.countOf(field.key, v))}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </div>
  );
}
