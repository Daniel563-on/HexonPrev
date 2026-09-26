import { useMemo, useState } from 'react';
import { Asset, Address } from '../types';

// FILTROS DE ATIVOS COM CONTAGEM INTELIGENTE (usado na tela de QR Codes)
// Busca + Gerência, CRAAI, Comarca, Tipo e Status. Cada opção mostra quantos itens teria,
// respeitando os OUTROS filtros; opções sem item somem (menos a escolhida).

export type FacetKey = 'status' | 'gerencia' | 'craai' | 'comarca' | 'tipo';
const FACETS: FacetKey[] = ['status', 'gerencia', 'craai', 'comarca', 'tipo'];
export const ASSET_STATUS_OPTIONS = ['Operando', 'Em Manutenção', 'Parado', 'Baixado'];

export function matchesAssetSearch(a: Asset, q: string): boolean {
  return (
    !q ||
    [
      a.code, a.id, a.name, a.location,
      a.specs?.PATRIMONIO, a.specs?.serialNumber, a.specs?.['Nº DE SÉRIE'],
      a.specs?.setor, a.specs?.SETOR, a.specs?.sala,
      a.specs?.manufacturer, a.specs?.MARCA, a.specs?.model, a.specs?.MODELO, a.specs?.TIPO
    ].some((value) => String(value || '').toLowerCase().includes(q))
  );
}

const sortedUnique = (list: string[]) =>
  Array.from(new Set(list.filter(Boolean))).sort((a, b) => a.localeCompare(b));

export function useAssetFilters(items: Asset[], addresses: Address[], managementNames: string[]) {
  const [searchText, setSearchText] = useState('');
  const [status, setStatus] = useState('Todos');
  const [gerencia, setGerencia] = useState('Todas');
  const [craai, setCraai] = useState('Todas');
  const [comarca, setComarca] = useState('Todas');
  const [tipo, setTipo] = useState('Todos');

  const { results, counts, totals } = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const counts = Object.fromEntries(FACETS.map((f) => [f, new Map<string, number>()])) as Record<FacetKey, Map<string, number>>;
    const totals: Record<FacetKey, number> = { status: 0, gerencia: 0, craai: 0, comarca: 0, tipo: 0 };
    const results: Asset[] = [];
    for (const a of items) {
      if (!matchesAssetSearch(a, q)) continue;
      const v: Record<FacetKey, string> = {
        status: a.status,
        gerencia: a.sector,
        craai: String(a.specs?.CRAAI || ''),
        comarca: String(a.specs?.COMARCA || ''),
        tipo: String(a.specs?.TIPO || '').trim()
      };
      const ok: Record<FacetKey, boolean> = {
        status: status === 'Todos' || v.status === status,
        gerencia: gerencia === 'Todas' || v.gerencia === gerencia,
        craai: craai === 'Todas' || v.craai === craai,
        comarca: comarca === 'Todas' || v.comarca === comarca,
        tipo: tipo === 'Todos' || v.tipo === tipo
      };
      for (const f of FACETS) {
        if (FACETS.every((o) => o === f || ok[o])) {
          counts[f].set(v[f], (counts[f].get(v[f]) || 0) + 1);
          totals[f]++;
        }
      }
      if (FACETS.every((f) => ok[f])) results.push(a);
    }
    results.sort((x, y) => String(x.code).localeCompare(String(y.code), undefined, { numeric: true }));
    return { results, counts, totals };
  }, [items, searchText, status, gerencia, craai, comarca, tipo]);

  const countOf = (f: FacetKey, value: string) => counts[f].get(value) || 0;
  const optionLabel = (label: string, n: number) => `${label} (${n.toLocaleString('pt-BR')})`;
  const visibleOptions = (f: FacetKey, values: string[], selected: string) =>
    values.filter((v) => v === selected || countOf(f, v) > 0);

  // Opções de cada filtro (CRAAI e Comarca do cadastro de Endereços; Comarca só da CRAAI escolhida)
  const options = useMemo(
    () => ({
      gerencia: sortedUnique([...managementNames, ...items.map((a) => a.sector)]),
      craai: sortedUnique(addresses.map((a) => a.craai)),
      comarca: sortedUnique(addresses.filter((a) => craai === 'Todas' || a.craai === craai).map((a) => a.comarca)),
      tipo: sortedUnique(items.map((a) => String(a.specs?.TIPO || '').trim())),
      status: ASSET_STATUS_OPTIONS
    }),
    [managementNames, items, addresses, craai]
  );

  const filtersKey = [searchText, status, gerencia, craai, comarca, tipo].join('|');
  const hasActiveFilters = filtersKey !== ['', 'Todos', 'Todas', 'Todas', 'Todas', 'Todos'].join('|');

  const clear = () => {
    setSearchText('');
    setStatus('Todos');
    setGerencia('Todas');
    setCraai('Todas');
    setComarca('Todas');
    setTipo('Todos');
  };

  return {
    searchText, setSearchText,
    status, setStatus,
    gerencia, setGerencia,
    craai, setCraai: (v: string) => { setCraai(v); setComarca('Todas'); },
    comarca, setComarca,
    tipo, setTipo,
    results, totals, options,
    countOf, optionLabel, visibleOptions,
    filtersKey, hasActiveFilters, clear
  };
}

export type AssetFiltersState = ReturnType<typeof useAssetFilters>;
