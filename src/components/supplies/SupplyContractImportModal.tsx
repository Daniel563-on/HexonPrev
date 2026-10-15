import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Material } from '../../types';
import {
  dbApplySupplyContractImport,
  dbGetSupplyBalances,
  dbGetSupplyContract,
  formatSupplyQty,
  planSupplyContractImport,
  SupplyContractPlan,
  SupplyContractRow
} from '../../db/firebase';

// IMPORTAR CONTRATO / ADITIVO DE INSUMOS (Lote 3): a planilha traz Item, Descrição, Unidade, Quantidade (TOTAL do
// contrato + aditivos), Preço unitário e Preço total. Nada é gravado antes da conferência. Linha com erro não é gravada;
// item do contrato que não vier na planilha continua como está (com aviso). Preço novo vale a partir de hoje.

interface Props {
  company: string;
  companyName: string;
  contract: Material[];
  currentUserName: string;
  onClose: () => void;
  onDone: () => void;
}

type Field = 'code' | 'description' | 'measureUnit' | 'qty' | 'price' | 'total';
const FIELDS: { key: Field; label: string; required: boolean; guesses: string[] }[] = [
  { key: 'code', label: 'Item', required: true, guesses: ['ITEM', 'CODIGO', 'COD', 'CODIGO DO ITEM', 'CODIGO DO INSUMO'] },
  { key: 'description', label: 'Descrição', required: true, guesses: ['DESCRICAO', 'DESCRICAO DO ITEM', 'INSUMO', 'ESPECIFICACAO'] },
  { key: 'measureUnit', label: 'Unidade', required: false, guesses: ['UNIDADE', 'UN', 'UND', 'UNID', 'UM', 'UNIDADE DE MEDIDA'] },
  { key: 'qty', label: 'Quantidade', required: true, guesses: ['QUANTIDADE', 'QTD', 'QTDE', 'QUANT', 'QUANTIDADE TOTAL'] },
  { key: 'price', label: 'Preço unitário', required: true, guesses: ['PRECO UNITARIO', 'VALOR UNITARIO', 'PRECO UNIT', 'VALOR UNIT', 'PRECO'] },
  { key: 'total', label: 'Preço total (só para conferir)', required: false, guesses: ['PRECO TOTAL', 'VALOR TOTAL', 'TOTAL'] }
];

const norm = (h: unknown) =>
  String(h ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.\-_:()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Número da planilha: célula numérica usa o valor completo; texto aceita "R$ 1.234,5678" e "12.5"
function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  if (typeof v === 'number') return v;
  const raw = String(v).replace(/R\$\s*/i, '').replace(/\s/g, '').trim();
  const n = Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw);
  return Number.isFinite(n) ? n : NaN;
}
const brl2 = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const todayBR = () => new Date().toLocaleDateString('pt-BR');

export default function SupplyContractImportModal({ company, companyName, contract, currentUserName, onClose, onDone }: Props) {
  const [first] = useState(contract.length === 0); // fixo ao abrir (depois de gravar a lista recarrega)
  const [wb, setWb] = useState<XLSX.WorkBook | null>(null);
  const [sheet, setSheet] = useState('');
  const [rows, setRows] = useState<any[][] | null>(null);
  const [headerRow, setHeaderRow] = useState(0);
  const [rowBase, setRowBase] = useState(0); // 1ª linha usada da aba (a planilha pode não começar na linha 1)
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState<Record<Field, number>>({ code: -1, description: -1, measureUnit: -1, qty: -1, price: -1, total: -1 });
  const [plan, setPlan] = useState<SupplyContractPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const openSheet = (book: XLSX.WorkBook, name: string) => {
    const ws = book.Sheets[name];
    const data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '', blankrows: true });
    if (data.length < 2) throw new Error('A planilha está vazia.');
    // Linha dos títulos: a primeira (até a 15ª) que tenha "Item" ou "Descrição"
    let h = data.slice(0, 15).findIndex((r) => r.some((c) => norm(c) === 'ITEM' || norm(c).startsWith('DESCRICAO')));
    if (h < 0) h = 0;
    const hdr = data[h].map(norm);
    const guess = {} as Record<Field, number>;
    FIELDS.forEach((f) => {
      guess[f.key] = hdr.findIndex((x) => f.guesses.includes(x));
    });
    setSheet(name);
    setRowBase(ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).s.r : 0);
    setRows(data);
    setHeaderRow(h);
    setMapping(guess);
    setPlan(null);
  };
  const handleFile = async (file: File) => {
    setError(null);
    setPlan(null);
    setFileName(file.name);
    try {
      const book = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      setWb(book);
      openSheet(book, book.SheetNames[0]);
    } catch (err: any) {
      setError(err?.message || String(err));
      setRows(null);
    }
  };

  const headers = rows ? rows[headerRow].map((h, i) => String(h ?? '').trim() || `Coluna ${i + 1}`) : [];

  const analyze = async () => {
    if (!rows) return;
    const missing = FIELDS.filter((f) => f.required && mapping[f.key] < 0).map((f) => f.label);
    if (missing.length) return setError(`Indique a coluna de: ${missing.join(', ')}.`);
    setError(null);
    setBusy(true);
    try {
      const cell = (r: any[], f: Field) => (mapping[f] >= 0 ? r[mapping[f]] : '');
      const list: SupplyContractRow[] = rows
        .slice(headerRow + 1)
        .map((r, i) => ({
          code: String(cell(r, 'code') ?? ''),
          description: String(cell(r, 'description') ?? ''),
          measureUnit: String(cell(r, 'measureUnit') ?? ''),
          qty: parseNum(cell(r, 'qty')),
          price: parseNum(cell(r, 'price')),
          total: mapping.total >= 0 ? parseNum(cell(r, 'total')) : null,
          line: rowBase + headerRow + i + 2 // nº da linha como aparece no Excel
        }))
        .filter((r) => String(r.code).trim() || String(r.description).trim());
      // Conferência com o contrato e o saldo de agora (lidos de novo)
      const [items, bals] = await Promise.all([dbGetSupplyContract(company, true), dbGetSupplyBalances(company, true)]);
      setPlan(planSupplyContractImport(company, list, items, bals, currentUserName));
    } catch (err: any) {
      setError(`Não foi possível conferir: ${err?.message || err}`);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      await dbApplySupplyContractImport(plan, currentUserName);
      setDone(true);
      onDone();
    } catch (err: any) {
      setError(`Não foi possível gravar: ${err?.message || err}`);
    } finally {
      setBusy(false);
    }
  };

  const field = 'w-full h-9 text-xs px-3 border border-slate-200 rounded-lg outline-none font-semibold bg-white';
  const th = 'p-2 text-[10px] font-black uppercase tracking-wider text-slate-500 text-left whitespace-nowrap';
  const c = plan
    ? {
        novos: plan.changes.filter((x) => x.isNew).length,
        qty: plan.changes.filter((x) => !x.isNew && x.qtyBefore !== undefined && x.qtyBefore !== x.qtyAfter).length,
        price: plan.changes.filter((x) => !x.isNew && x.priceBefore !== x.priceAfter).length,
        text: plan.changes.filter((x) => x.textChanged).length
      }
    : null;
  // Linhas da conferência: o que muda em cada item
  const lines = plan
    ? plan.changes.flatMap((x) => {
        if (x.isNew) return [{ k: x.id + 'n', code: x.code, what: 'Item novo', before: '—', after: `${formatSupplyQty(x.qtyAfter)} ${x.measureUnit} × ${brl2(x.priceAfter)}`, tone: 'text-emerald-700' }];
        const out: { k: string; code: string; what: string; before: string; after: string; tone: string }[] = [];
        if (x.qtyBefore !== undefined && x.qtyBefore !== x.qtyAfter)
          out.push({ k: x.id + 'q', code: x.code, what: x.qtyAfter > x.qtyBefore ? 'Quantidade total aumentou' : 'Quantidade total diminuiu', before: formatSupplyQty(x.qtyBefore), after: formatSupplyQty(x.qtyAfter), tone: 'text-indigo-700' });
        if (x.priceBefore !== x.priceAfter) out.push({ k: x.id + 'p', code: x.code, what: 'Preço unitário', before: brl2(x.priceBefore || 0), after: brl2(x.priceAfter), tone: 'text-amber-700' });
        if (x.textChanged) out.push({ k: x.id + 't', code: x.code, what: 'Descrição / unidade', before: '', after: `${x.description} (${x.measureUnit})`, tone: 'text-slate-700' });
        return out;
      })
    : [];

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-4xl max-h-[92vh] flex flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl text-slate-800 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200">
          <p className="text-sm font-black">
            {first ? 'Importar contrato' : 'Importar aditivo'} — {companyName}
          </p>
          <p className="text-[11px] text-slate-500">
            {first
              ? 'Planilha do contrato: Item, Descrição, Unidade, Quantidade, Preço unitário e Preço total. Nada é gravado antes de conferir.'
              : 'A planilha traz a quantidade TOTAL de cada item (contrato + aditivo). Nada é gravado antes de conferir.'}
          </p>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          {done ? (
            <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50 text-sm text-emerald-800 flex gap-2">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span>
                {first ? 'Contrato gravado' : 'Aditivo gravado'}: {plan?.changes.length} {plan?.changes.length === 1 ? 'item' : 'itens'} de {companyName}. Os técnicos recebem a lista nova
                sozinhos.
              </span>
            </div>
          ) : (
            <>
              <label className="block space-y-1">
                <span className="block text-[10px] font-black uppercase tracking-wider text-slate-500">Arquivo (Excel)</span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  aria-label="Arquivo da planilha"
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                  className="block text-xs"
                />
                {fileName && <span className="block text-[11px] text-slate-500">{fileName}</span>}
              </label>

              {wb && wb.SheetNames.length > 1 && (
                <label className="block space-y-1 max-w-xs">
                  <span className="block text-[10px] font-black uppercase tracking-wider text-slate-500">Aba da planilha</span>
                  <select value={sheet} onChange={(e) => openSheet(wb, e.target.value)} className={field}>
                    {wb.SheetNames.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {rows && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {FIELDS.map((f) => (
                    <label key={f.key} className="block space-y-1">
                      <span className="block text-[10px] font-black uppercase tracking-wider text-slate-500">
                        {f.label}
                        {f.required ? ' *' : ''}
                      </span>
                      <select
                        value={mapping[f.key]}
                        onChange={(e) => {
                          setMapping({ ...mapping, [f.key]: Number(e.target.value) });
                          setPlan(null);
                        }}
                        aria-label={`Coluna de ${f.label}`}
                        className={field}
                      >
                        <option value={-1}>— não usar —</option>
                        {headers.map((h, i) => (
                          <option key={i} value={i}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              )}

              {plan && c && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-center">
                    {[
                      [String(c.novos), 'itens novos', 'text-emerald-700'],
                      [String(c.qty), 'quantidade mudou', 'text-indigo-700'],
                      [String(c.price), 'preço mudou', 'text-amber-700'],
                      [String(plan.unchanged), 'sem mudança', 'text-slate-700'],
                      [String(plan.errors.length), 'com erro (não grava)', plan.errors.length ? 'text-rose-600' : 'text-slate-700']
                    ].map(([n, l, t]) => (
                      <div key={l} className="p-2 rounded-lg border border-slate-200">
                        <p className={`text-lg font-black ${t}`}>{n}</p>
                        <p className="text-[10px] font-bold text-slate-500">{l}</p>
                      </div>
                    ))}
                  </div>

                  {plan.errors.length > 0 && (
                    <div className="rounded-lg border border-rose-200 overflow-hidden">
                      <p className="px-3 py-2 text-[11px] font-black text-rose-700 bg-rose-50">Linhas com erro — não são gravadas (corrija a planilha e importe de novo)</p>
                      <div className="max-h-40 overflow-y-auto">
                        <table className="w-full text-xs">
                          <tbody>
                            {plan.errors.map((e, i) => (
                              <tr key={i} className="border-t border-rose-100">
                                <td className="p-2 text-slate-500 whitespace-nowrap">linha {e.line}</td>
                                <td className="p-2 font-mono font-black">{e.code || '—'}</td>
                                <td className="p-2 text-rose-700 font-bold">{e.reason}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {lines.length > 0 && (
                    <div className="rounded-lg border border-slate-200 overflow-hidden">
                      <div className="max-h-72 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-50 sticky top-0">
                            <tr>
                              <th className={th}>Item</th>
                              <th className={th}>O que muda</th>
                              <th className={th}>Antes</th>
                              <th className={th}>Depois</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lines.map((l) => (
                              <tr key={l.k} className="border-t border-slate-100">
                                <td className="p-2 font-mono font-black">{l.code}</td>
                                <td className="p-2">{l.what}</td>
                                <td className="p-2">{l.before}</td>
                                <td className={`p-2 font-black ${l.tone}`}>{l.after}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {plan.missing.length > 0 && (
                    <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-[11px] text-amber-900 flex gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>
                        <b>
                          {plan.missing.length} {plan.missing.length === 1 ? 'item do contrato não veio' : 'itens do contrato não vieram'} na planilha
                        </b>{' '}
                        e {plan.missing.length === 1 ? 'continua' : 'continuam'} como {plan.missing.length === 1 ? 'está' : 'estão'}:{' '}
                        {plan.missing.slice(0, 30).map((m) => m.code).join(', ')}
                        {plan.missing.length > 30 ? '…' : ''}.
                      </span>
                    </div>
                  )}

                  {plan.totalMismatch.length > 0 && (
                    <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-[11px] text-amber-900 flex gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>
                        <b>
                          {plan.totalMismatch.length} {plan.totalMismatch.length === 1 ? 'linha tem' : 'linhas têm'} o Preço total diferente de Quantidade × Preço unitário
                        </b>{' '}
                        (o app usa o preço unitário):{' '}
                        {plan.totalMismatch
                          .slice(0, 10)
                          .map((t) => `${t.code} (linha ${t.line}: ${brl2(t.computed)} × planilha ${brl2(t.total)})`)
                          .join('; ')}
                        {plan.totalMismatch.length > 10 ? '…' : ''}.
                      </span>
                    </div>
                  )}

                  {!first && c.price > 0 && (
                    <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-[11px] text-amber-900 flex gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>
                        <b>Preço novo vale a partir de hoje ({todayBR()}).</b> OS já concluídas continuam com o preço antigo; OS ainda não concluídas pelo técnico passam
                        ao preço novo.
                      </span>
                    </div>
                  )}
                  {plan.changes.length === 0 && <p className="text-xs font-bold text-slate-600">Nada para gravar: a planilha é igual ao contrato.</p>}
                </div>
              )}
            </>
          )}
          {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-bold text-slate-600 cursor-pointer">
            {done ? 'Fechar' : 'Cancelar'}
          </button>
          {!done && rows && !plan && (
            <button type="button" onClick={analyze} disabled={busy} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-black cursor-pointer disabled:opacity-50">
              {busy ? 'Conferindo...' : 'Conferir'}
            </button>
          )}
          {!done && plan && (
            <button
              type="button"
              onClick={apply}
              disabled={busy || plan.changes.length === 0}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-black cursor-pointer disabled:opacity-50"
            >
              {busy ? 'Gravando...' : first ? 'Gravar contrato' : 'Gravar aditivo'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
