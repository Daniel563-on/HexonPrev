import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, FileSpreadsheet, Filter } from 'lucide-react';
import { Material } from '../../types';
import { brl, dbGetManagements, dbGetSupplyOutputs, formatSupplyQty, localDate, localTodayStr, SupplyOutputRow, valueAt } from '../../db/firebase';
import { deliverFile } from '../../lib/fileDelivery';

// RELATÓRIO DE SAÍDAS DE INSUMOS (Lote 3): uma linha por item fornecido pelo almoxarifado, com a gerência, a OS, o GLPI
// e o técnico (rastreabilidade). Período e gerência buscam no banco (1 busca por gerência); item, técnico e OS/GLPI
// filtram na tela. Preço = o que valia no dia do fornecimento. Excel com as mesmas linhas e filtro em cada coluna.

interface Props {
  company: string;
  companyName: string;
  visibleUnits: string[] | null;
  contract: Material[];
}

const lbl = 'block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1';
const field = 'h-9 text-xs px-3 border border-slate-200 rounded-lg outline-none font-semibold bg-white';
const th = 'p-2 text-[10px] font-black uppercase tracking-wider text-slate-500 text-left whitespace-nowrap';
const dt = (iso?: string) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const d = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '');
const price4 = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const norm = (s: string) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export default function SupplyOutputsReport({ company, companyName, visibleUnits, contract }: Props) {
  const today = localTodayStr();
  const [units, setUnits] = useState<string[]>(visibleUnits || []);
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [unit, setUnit] = useState('Todas');
  const [item, setItem] = useState('Todos');
  const [tech, setTech] = useState('Todos');
  const [osText, setOsText] = useState('');
  const [rows, setRows] = useState<SupplyOutputRow[] | null>(null);
  const [loadedFor, setLoadedFor] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visibleUnits === null)
      dbGetManagements()
        .then((l) => setUnits(l.map((m) => m.name).filter((n) => n && n !== 'Todas')))
        .catch(() => {});
  }, []);

  const run = async () => {
    if (!from || !to || from > to) return setError('Confira o período (a data inicial vem antes da final).');
    const list = unit === 'Todas' ? units : [unit];
    if (list.length === 0) return;
    setError(null);
    setLoading(true);
    try {
      setRows(await dbGetSupplyOutputs(list, company, from, to));
      setLoadedFor(`${company}|${from}|${to}|${unit}`);
    } catch (err: any) {
      setError(`Não foi possível buscar: ${err?.message || err}`);
    } finally {
      setLoading(false);
    }
  };
  // 1ª busca ao abrir (mês atual, todas as gerências) e ao trocar de empresa
  useEffect(() => {
    if (units.length) run();
  }, [company, units.length]);

  const byId = useMemo(() => new Map(contract.map((m) => [m.id, m])), [contract]);
  const priced = useMemo(
    () =>
      (rows || []).map((r) => {
        const m = byId.get(r.supplyId);
        const price = m ? valueAt(m.history, localDate(r.suppliedAt)) : null;
        return { r, price, value: price !== null ? Math.round(r.qty * price * 100) / 100 : null };
      }),
    [rows, byId]
  );
  const techs = useMemo(() => {
    const m = new Map<string, string>();
    (rows || []).forEach((r) => m.set(r.techMatricula, r.techName));
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);
  const shown = useMemo(() => {
    const q = norm(osText.trim());
    return priced.filter(({ r }) => {
      if (item !== 'Todos' && r.code !== item) return false;
      if (tech !== 'Todos' && r.techMatricula !== tech) return false;
      if (q && !norm(`${r.orderLabel} ${r.glpi} ${r.number}`).includes(q)) return false;
      return true;
    });
  }, [priced, item, tech, osText]);
  const total = shown.reduce((s, x) => s + (x.value || 0), 0);
  const distinct = new Set(shown.map((x) => x.r.code)).size;
  const stale = !!rows && loadedFor !== `${company}|${from}|${to}|${unit}`;

  const excel = () => {
    const head = [
      'Data do fornecimento', 'Pedido', 'Item', 'Descrição', 'Unidade', 'Quantidade', 'Preço unitário (R$)', 'Valor (R$)', 'Gerência', 'Empresa', 'OS',
      'OS (descrição)', 'GLPI', 'Técnico', 'Matrícula', 'Aprovado por', 'Data da aprovação', 'Fornecido por', 'Situação', 'Recebido na OS em'
    ];
    const body = shown.map(({ r, price, value }) => [
      dt(r.suppliedAt), r.number, r.code, r.description, r.measureUnit, r.qty, price ?? '', value ?? '', r.unit, companyName, r.orderRef,
      r.orderLabel, r.glpi, r.techName, r.techMatricula, r.approvedBy, dt(r.approvedAt), r.suppliedBy,
      r.status === 'Recebido' ? 'Recebido na OS' : 'Fornecido (aguarda o técnico)', dt(r.receivedAt)
    ]);
    const ws = XLSX.utils.aoa_to_sheet([head, ...body]);
    ws['!autofilter'] = { ref: ws['!ref'] || 'A1' };
    ws['!cols'] = head.map((h, i) => ({ wch: i === 3 || i === 11 ? 45 : Math.max(10, h.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Saídas de insumos');
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    deliverFile(
      new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      `Saidas de insumos ${companyName} ${from} a ${to}${unit !== 'Todas' ? ` ${unit}` : ''}.xlsx`
    );
  };

  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-end gap-2">
        <label>
          <span className={lbl}>Fornecido de</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={field} aria-label="Fornecido de" />
        </label>
        <label>
          <span className={lbl}>Até</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={field} aria-label="Fornecido até" />
        </label>
        <label>
          <span className={lbl}>Gerência</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value)} className={`${field} cursor-pointer`} aria-label="Gerência">
            <option value="Todas">Todas</option>
            {units.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={run} disabled={loading} className="h-9 px-3 rounded-lg bg-indigo-600 text-white text-xs font-black flex items-center gap-1 cursor-pointer disabled:opacity-50">
          <Filter className="w-4 h-4" /> {loading ? 'Buscando...' : 'Filtrar'}
        </button>
        <span className="w-px h-9 bg-slate-200 mx-1 hidden md:block" />
        <label>
          <span className={lbl}>Item</span>
          <select value={item} onChange={(e) => setItem(e.target.value)} className={`${field} cursor-pointer`} style={{ maxWidth: 260 }} aria-label="Item">
            <option value="Todos">Todos</option>
            {contract.map((m) => (
              <option key={m.id} value={m.code}>
                {m.code} — {m.description.slice(0, 60)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={lbl}>Técnico</span>
          <select value={tech} onChange={(e) => setTech(e.target.value)} className={`${field} cursor-pointer`} aria-label="Técnico">
            <option value="Todos">Todos</option>
            {techs.map(([mat, name]) => (
              <option key={mat} value={mat}>
                {name} ({mat})
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={lbl}>OS ou GLPI</span>
          <input value={osText} onChange={(e) => setOsText(e.target.value)} placeholder="nº da OS, GLPI ou pedido" className={field} aria-label="OS ou GLPI" />
        </label>
        <button
          type="button"
          onClick={excel}
          disabled={!rows || shown.length === 0 || stale}
          className="h-9 px-3 rounded-lg bg-emerald-600 text-white text-xs font-black flex items-center gap-1 cursor-pointer disabled:opacity-50"
        >
          <FileSpreadsheet className="w-4 h-4" /> Baixar Excel
        </button>
      </div>

      {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
      {stale && <p className="text-xs font-bold text-amber-700">O período ou a gerência mudou: toque em "Filtrar" para buscar de novo.</p>}
      {rows && !stale && (
        <p className="text-[11px] font-bold text-slate-600">
          {shown.length} {shown.length === 1 ? 'saída' : 'saídas'} · {distinct} {distinct === 1 ? 'item diferente' : 'itens diferentes'} · {brl(total)} no período ({companyName}). Uma
          linha por item fornecido; preço do dia do fornecimento.
        </p>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {['Data', 'Pedido', 'Item', 'Descrição', 'Unid.', 'Qtd', 'Preço unit.', 'Valor', 'Gerência', 'OS', 'GLPI', 'Técnico', 'Fornecido por'].map((h) => (
                <th key={h} className={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map(({ r, price, value }, i) => (
              <tr key={`${r.number}-${r.supplyId}-${i}`} className="border-b border-slate-100">
                <td className="p-2 whitespace-nowrap text-slate-700">{d(r.suppliedAt)}</td>
                <td className="p-2 whitespace-nowrap font-mono text-slate-700">{r.number}</td>
                <td className="p-2 whitespace-nowrap font-mono font-black text-indigo-700">{r.code}</td>
                <td className="p-2 text-slate-700" style={{ maxWidth: 280 }}>
                  {r.description}
                </td>
                <td className="p-2 text-slate-600">{r.measureUnit}</td>
                <td className="p-2 text-right font-bold">{formatSupplyQty(r.qty)}</td>
                <td className="p-2 text-right whitespace-nowrap">{price !== null ? price4(price) : '—'}</td>
                <td className="p-2 text-right whitespace-nowrap font-bold">{value !== null ? brl(value) : '—'}</td>
                <td className="p-2 whitespace-nowrap">{r.unit}</td>
                <td className="p-2 whitespace-nowrap">{r.orderRef}</td>
                <td className="p-2 whitespace-nowrap font-mono">{r.glpi}</td>
                <td className="p-2 whitespace-nowrap">
                  {r.techName} ({r.techMatricula})
                </td>
                <td className="p-2 whitespace-nowrap">{r.suppliedBy}</td>
              </tr>
            ))}
            {rows && shown.length === 0 && (
              <tr>
                <td colSpan={13} className="p-6 text-center text-slate-500 font-bold">
                  Nenhuma saída no período com esses filtros.
                </td>
              </tr>
            )}
            {!rows && (
              <tr>
                <td colSpan={13} className="p-6 text-center text-slate-500 font-bold">
                  {loading ? 'Buscando...' : 'Escolha o período e toque em "Filtrar".'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500 flex items-center gap-1">
        <Download className="w-3.5 h-3.5" />O Excel sai com estas colunas e mais: Empresa, OS (descrição), Matrícula, Aprovado por, Data da aprovação, Situação (fornecido / recebido na
        OS) e Recebido na OS em — com filtro em cada coluna.
      </p>
    </div>
  );
}
