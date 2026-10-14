import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { X } from 'lucide-react';
import { Company } from '../../types';
import { dbApplyStockImport, dbGetMaterials, planStockImport, StockImportPlan, StockImportRow } from '../../db/firebase';
import { dbGetWarehouses, dbSaveWarehouses, warehouseIdOf } from '../../db/warehouses';

// IMPORTAR PLANILHA DO ALMOXARIFADO (ajuste A7): sempre no mesmo padrão — GERÊNCIA, ALMOXARIFADO, CÓDIGO, MATERIAL,
// MATERIAL RESUMIDO, U.M., TOTAL - QTDE., TOTAL - VALOR, VALOR UNITÁRIO. A gerência vem da coluna; a empresa é escolhida
// (a que pede material do MP). Conferência antes de gravar; almoxarifado que não existe entra em Configurações › Almoxarifados.

interface Props {
  units: string[]; // gerências que a pessoa pode alterar
  companies: Company[];
  currentUserName: string;
  onClose: () => void;
  onDone: () => void;
}

type Col = 'unit' | 'warehouse' | 'code' | 'description' | 'short' | 'measureUnit' | 'qty' | 'totalValue' | 'unitValue';
const COLS: { key: Col; label: string; names: string[] }[] = [
  { key: 'unit', label: 'GERÊNCIA', names: ['GERENCIA'] },
  { key: 'warehouse', label: 'ALMOXARIFADO', names: ['ALMOXARIFADO'] },
  { key: 'code', label: 'CÓDIGO', names: ['CODIGO', 'COD'] },
  { key: 'description', label: 'MATERIAL', names: ['MATERIAL', 'DESCRICAO'] },
  { key: 'short', label: 'MATERIAL RESUMIDO', names: ['MATERIALRESUMIDO', 'RESUMIDO', 'DESCRICAORESUMIDA'] },
  { key: 'measureUnit', label: 'U.M.', names: ['UM', 'UNIDADE', 'UND', 'UNID', 'UNIDADEDEMEDIDA'] },
  { key: 'qty', label: 'TOTAL - QTDE.', names: ['TOTALQTDE', 'QTDE', 'QUANTIDADE', 'SALDO'] },
  { key: 'totalValue', label: 'TOTAL - VALOR', names: ['TOTALVALOR', 'VALORTOTAL'] },
  { key: 'unitValue', label: 'VALOR UNITÁRIO', names: ['VALORUNITARIO', 'VALORUNIT'] }
];
const key = (h: unknown) =>
  String(h ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]/g, '');
// Aceita número ou texto "1.234,56"
function num(v: unknown): number | null {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  if (typeof v === 'number') return v;
  const raw = String(v).replace(/R\$\s*/i, '').trim();
  const n = Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw);
  return Number.isFinite(n) ? n : NaN;
}
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function StockImportModal({ units, companies, currentUserName, onClose, onDone }: Props) {
  // Empresa: a que pede material do MP (se for só uma, já vem escolhida)
  const mpCompanies = companies.filter((c) => c.active && c.requestsMpMaterial);
  const options = (mpCompanies.length ? mpCompanies : companies.filter((c) => c.active)).filter((c) => c.units.some((u) => units.includes(u)));
  const [company, setCompany] = useState(options.length === 1 ? options[0].id : '');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<StockImportRow[] | null>(null);
  const [lines, setLines] = useState(0);
  const [plan, setPlan] = useState<StockImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const companyName = (id: string) => companies.find((c) => c.id === id)?.name || id;

  const readFile = async (file: File) => {
    setError(null);
    setPlan(null);
    setRows(null);
    setFileName(file.name);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const data = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      if (data.length < 2) throw new Error('A planilha está vazia.');
      const hdr = data[0].map(key);
      const at = {} as Record<Col, number>;
      COLS.forEach((c) => (at[c.key] = hdr.findIndex((h: string) => c.names.includes(h))));
      const missing = COLS.filter((c) => ['unit', 'warehouse', 'code', 'description', 'qty'].includes(c.key) && at[c.key] < 0).map((c) => c.label);
      if (at.totalValue < 0 && at.unitValue < 0) missing.push('TOTAL - VALOR ou VALOR UNITÁRIO');
      if (missing.length)
        throw new Error(`A planilha não está no padrão do almoxarifado. Faltam as colunas: ${missing.join(', ')}.`);
      const cell = (r: any[], c: Col) => (at[c] >= 0 ? r[at[c]] : '');
      const parsed: StockImportRow[] = data
        .slice(1)
        .map((r, i) => ({
          unit: String(cell(r, 'unit') ?? ''),
          warehouse: String(cell(r, 'warehouse') ?? ''),
          code: String(cell(r, 'code') ?? '').trim(),
          description: String(cell(r, 'description') ?? ''),
          shortDescription: String(cell(r, 'short') ?? ''),
          measureUnit: String(cell(r, 'measureUnit') ?? ''),
          qty: num(cell(r, 'qty')) ?? 0,
          totalValue: num(cell(r, 'totalValue')),
          unitValue: num(cell(r, 'unitValue')),
          line: i + 2
        }))
        .filter((r) => r.code || r.description.trim());
      setLines(parsed.length);
      setRows(parsed);
    } catch (err: any) {
      setError(err?.message || String(err));
    }
  };

  const analyze = async () => {
    if (!rows) return;
    if (!company) return setError('Escolha a empresa.');
    setBusy(true);
    setError(null);
    try {
      const fileUnits: string[] = Array.from(new Set<string>(rows.map((r) => r.unit.trim().toUpperCase()).filter(Boolean)));
      const notAllowed = fileUnits.filter((u) => !units.includes(u));
      if (notAllowed.length) throw new Error(`Você não pode alterar os materiais de: ${notAllowed.join(', ')} (gerência da coluna GERÊNCIA).`);
      const co = companies.find((c) => c.id === company);
      const outside = fileUnits.filter((u) => !(co?.units || []).includes(u));
      if (outside.length) throw new Error(`A empresa ${companyName(company)} não atua em: ${outside.join(', ')} (Configurações › Empresas).`);
      const [existing, warehouses] = await Promise.all([dbGetMaterials(fileUnits, true), dbGetWarehouses(true)]);
      setPlan(planStockImport(rows, existing, company, warehouses, warehouseIdOf, currentUserName));
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      await dbApplyStockImport(plan, async (fresh) => {
        const current = await dbGetWarehouses(true);
        const ids = new Set(current.map((w) => w.id));
        await dbSaveWarehouses([...current, ...fresh.filter((w) => !ids.has(w.id)).map((w) => ({ id: w.id, name: w.name, active: true }))], currentUserName);
      });
      const n = plan.toCreate.length + plan.toUpdate.length + plan.unchanged.length;
      setDone(`${n} material(is) com a posição de ${plan.stockAt.split('-').reverse().join('/')} · ${plan.toCreate.length} novo(s) · ${plan.toUpdate.length} alterado(s) · ${plan.toEmpty.length} ficaram sem saldo.`);
      onDone();
    } catch (err: any) {
      setError(err?.code === 'permission-denied' ? 'O banco recusou a gravação (permissão "Cadastrar e Importar Materiais" nas gerências da planilha).' : `Não foi possível gravar: ${err?.message || err}`);
    } finally {
      setBusy(false);
    }
  };

  const box = 'border border-slate-200 rounded-xl p-3';
  const label = 'block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1';
  const stockValue = plan ? [...plan.toCreate, ...plan.toUpdate.map((u) => u.after), ...plan.unchanged].reduce((s, m) => s + m.cost * (m.stockTotal || 0), 0) : 0;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white shadow-2xl p-5 space-y-4 text-slate-800" role="dialog" aria-label="Importar planilha do almoxarifado">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-black">Importar planilha do almoxarifado</h3>
            <p className="text-xs text-slate-500 mt-0.5">A planilha é a posição completa do almoxarifado. Nada é gravado antes da conferência. O saldo é só para consulta (o app não desconta).</p>
          </div>
          <button type="button" onClick={onClose} className="h-8 w-8 shrink-0 rounded-lg border border-slate-200 flex items-center justify-center cursor-pointer" title="Fechar">
            <X className="w-4 h-4" />
          </button>
        </div>

        {done ? (
          <div className="space-y-3">
            <p className="text-sm font-black text-emerald-700">Importação concluída</p>
            <p className="text-xs">{done}</p>
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg bg-blue-600 text-white text-xs font-black cursor-pointer">Fechar</button>
            </div>
          </div>
        ) : !plan ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className={label}>Empresa *</span>
                <select value={company} onChange={(e) => setCompany(e.target.value)} className="w-full h-9 px-3 text-xs font-bold border border-slate-200 rounded-lg bg-white cursor-pointer" aria-label="Empresa">
                  <option value="">Selecione...</option>
                  {options.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <span className="block text-[10px] text-slate-500 mt-1">A empresa que pede material do MP (marcada em Configurações › Empresas).</span>
              </label>
              <label className="block">
                <span className={label}>Arquivo (.xlsx) *</span>
                <input type="file" accept=".xlsx,.xls" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} className="block w-full text-xs" aria-label="Arquivo da planilha" />
                {fileName && rows && <span className="block text-[10px] text-slate-500 mt-1">{fileName} · {lines} linha(s)</span>}
              </label>
            </div>
            {rows && <p className="text-xs text-emerald-700 font-bold">✓ Colunas reconhecidas: {COLS.map((c) => c.label).join(' · ')}</p>}
            {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg border border-slate-200 text-xs font-bold cursor-pointer">Cancelar</button>
              <button type="button" onClick={analyze} disabled={!rows || busy} className="h-9 px-4 rounded-lg bg-blue-600 text-white text-xs font-black cursor-pointer disabled:opacity-50">
                {busy ? 'Conferindo...' : 'Conferir'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className={box}>
                <span className={label}>Arquivo</span>
                <p className="text-xs"><b>{fileName}</b> · {lines} linha(s)</p>
              </div>
              <div className={box}>
                <span className={label}>Empresa</span>
                <p className="text-xs font-bold">{companyName(plan.company)}</p>
              </div>
              <div className={box}>
                <span className={label}>Gerência (coluna GERÊNCIA)</span>
                <p className="text-xs font-bold">{plan.units.join(', ')}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" aria-label="Conferência">
              <div className={box}><p className="text-xl font-black text-emerald-700">{plan.toCreate.length}</p><p className="text-[11px] text-slate-500">novos</p></div>
              <div className={box}><p className="text-xl font-black text-blue-700">{plan.toUpdate.length}</p><p className="text-[11px] text-slate-500">saldo, valor ou nome mudou</p></div>
              <div className={box}><p className="text-xl font-black">{plan.unchanged.length}</p><p className="text-[11px] text-slate-500">sem mudança</p></div>
              <div className={`${box} ${plan.toEmpty.length ? 'border-amber-300 bg-amber-50' : ''}`}><p className="text-xl font-black text-amber-700">{plan.toEmpty.length}</p><p className="text-[11px] text-amber-800">saíram da planilha → ficam sem saldo</p></div>
            </div>
            <p className="text-xs">
              Posição de <b>{plan.stockAt.split('-').reverse().join('/')}</b>: <b>{plan.toCreate.length + plan.toUpdate.length + plan.unchanged.length}</b> material(is) · valor em estoque <b>{brl(stockValue)}</b>
            </p>
            <div className={box}>
              <span className={label}>Almoxarifados</span>
              <p className="text-xs">
                {plan.warehouses.map((w) => (
                  <span key={w.id} className="mr-3">
                    {w.name} {w.isNew ? <b className="text-emerald-700">(novo — entra em Configurações › Almoxarifados)</b> : <span className="text-slate-500">(já cadastrado)</span>}
                  </span>
                ))}
              </p>
            </div>
            {plan.averaged.length > 0 && (
              <p className="text-xs rounded-lg border border-amber-300 bg-amber-50 text-amber-900 p-2.5">
                {plan.averaged.length} material(is) vieram com valor unitário diferente em cada almoxarifado: fica <b>um valor só, a média</b> (ex.:{' '}
                {plan.averaged
                  .slice()
                  .sort((a, b) => Math.max(...b.values) - Math.min(...b.values) - (Math.max(...a.values) - Math.min(...a.values)))
                  .slice(0, 2)
                  .map((a) => `${a.description} — ${a.values.map(brl).join(' / ')} → ${brl(a.cost)}`)
                  .join('; ')}
                ).
              </p>
            )}
            {plan.skipped.length > 0 && (
              <div className="text-xs rounded-lg border border-rose-200 bg-rose-50 text-rose-800 p-2.5">
                <b>{plan.skipped.length} linha(s) ignorada(s):</b>{' '}
                {plan.skipped.slice(0, 8).map((s) => `linha ${s.row.line} (${s.reason})`).join(' · ')}
                {plan.skipped.length > 8 ? ' …' : ''}
              </div>
            )}
            {plan.toEmpty.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer font-bold text-amber-800">Ver os que saíram da planilha</summary>
                <ul className="list-disc pl-5 mt-1 max-h-40 overflow-y-auto">
                  {plan.toEmpty.map((m) => (
                    <li key={m.id}>{m.code} — {m.shortDescription || m.description}</li>
                  ))}
                </ul>
              </details>
            )}
            {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPlan(null)} disabled={busy} className="h-9 px-4 rounded-lg border border-slate-200 text-xs font-bold cursor-pointer">Voltar</button>
              <button type="button" onClick={apply} disabled={busy} className="h-9 px-4 rounded-lg bg-emerald-600 text-white text-xs font-black cursor-pointer disabled:opacity-50">
                {busy ? 'Gravando...' : 'Gravar a posição do almoxarifado'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
