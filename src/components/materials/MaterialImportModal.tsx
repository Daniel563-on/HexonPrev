import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { Company, Material } from '../../types';
import { companiesOfUnit, dbApplyMaterialImport, MaterialImportPlan, MaterialImportRow, planMaterialImport } from '../../db/firebase';

// IMPORTAÇÃO DE MATERIAIS POR GERÊNCIA + EMPRESA: escolha a gerência, a empresa, o arquivo e diga qual coluna é o quê.
// Quem sair da planilha fica na lista (histórico) com valor R$ 0,00 (o técnico não pode usar). Só mexe na lista daquela empresa.

interface Props {
  units: string[];
  companies: Company[];
  existing: Material[];
  currentUserName: string;
  onClose: () => void;
  onDone: () => void;
}

type Field = 'code' | 'description' | 'measureUnit' | 'cost';
const FIELDS: { key: Field; label: string; required: boolean; guesses: string[] }[] = [
  { key: 'code', label: 'Código', required: true, guesses: ['CODIGO', 'COD', 'CÓDIGO', 'CODIGO DO MATERIAL', 'ITEM'] },
  { key: 'description', label: 'Descrição', required: true, guesses: ['DESCRICAO', 'DESCRIÇÃO', 'MATERIAL', 'NOME'] },
  { key: 'measureUnit', label: 'Unidade de medida', required: false, guesses: ['UNIDADE', 'UN', 'UND', 'UNID', 'UNIDADE DE MEDIDA', 'MEDIDA'] },
  { key: 'cost', label: 'Valor (R$)', required: false, guesses: ['VALOR', 'PRECO', 'PREÇO', 'CUSTO', 'VALOR UNITARIO', 'VALOR UNITÁRIO'] }
];

const norm = (h: unknown) =>
  String(h ?? '').trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Aceita 12,5 / "R$ 1.234,56" / "12.50"
function parseCost(v: unknown): number | null {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  if (typeof v === 'number') return v;
  const raw = String(v).replace(/R\$\s*/i, '').trim();
  const n = Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

export default function MaterialImportModal({ units, companies, existing, currentUserName, onClose, onDone }: Props) {
  const [unit, setUnit] = useState(units.length === 1 ? units[0] : '');
  const [company, setCompany] = useState('');
  const unitCompanies = companiesOfUnit(companies, unit).filter((c) => c.active);
  const companyName = companies.find((c) => c.id === company)?.name || company;
  const [data, setData] = useState<any[][] | null>(null);
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState<Record<Field, number>>({ code: -1, description: -1, measureUnit: -1, cost: -1 });
  const [plan, setPlan] = useState<MaterialImportPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const headers = data ? data[0].map((h) => String(h ?? '').trim()) : [];

  const handleFile = async (file: File) => {
    setError(null);
    setPlan(null);
    setFileName(file.name);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      if (rows.length < 2) throw new Error('A planilha está vazia.');
      const hdr = rows[0].map(norm);
      const guess = {} as Record<Field, number>;
      FIELDS.forEach((f) => {
        guess[f.key] = hdr.findIndex((h) => f.guesses.map(norm).includes(h));
      });
      setMapping(guess);
      setData(rows);
    } catch (err: any) {
      setError(err?.message || String(err));
      setData(null);
    }
  };

  const analyze = () => {
    if (!data) return;
    if (!unit) return setError('Escolha a gerência desta planilha.');
    if (!company) return setError('Escolha a empresa desta planilha.');
    const missing = FIELDS.filter((f) => f.required && mapping[f.key] < 0).map((f) => f.label);
    if (missing.length > 0) return setError(`Indique a coluna de: ${missing.join(', ')}.`);
    setError(null);
    const cell = (r: any[], f: Field) => (mapping[f] >= 0 ? r[mapping[f]] : '');
    const rows: MaterialImportRow[] = data
      .slice(1)
      .map((r, i) => ({
        code: String(cell(r, 'code') ?? ''),
        description: String(cell(r, 'description') ?? ''),
        measureUnit: String(cell(r, 'measureUnit') ?? ''),
        cost: mapping.cost >= 0 ? parseCost(cell(r, 'cost')) : null,
        line: i + 2
      }))
      .filter((r) => String(r.code).trim() || String(r.description).trim());
    setPlan(planMaterialImport(unit, company, rows, existing, currentUserName));
  };

  const apply = async () => {
    if (!plan) return;
    setSaving(true);
    setError(null);
    try {
      await dbApplyMaterialImport(plan);
      setDone(true);
      onDone();
    } catch (err: any) {
      setError(`Não foi possível gravar: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  const activeBefore = existing.filter((m) => m.unit === unit && m.company === company && m.cost > 0).length;
  const bigZero = !!plan && activeBefore > 0 && plan.toZero.length / activeBefore >= 0.2;
  const field = 'w-full h-9 text-xs px-3 border border-slate-200 rounded-lg outline-none font-semibold bg-white';
  const line = (r: MaterialImportRow) => `linha ${r.line}: ${r.code} - ${r.description}`;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl p-6 space-y-4 text-slate-800">
        <div>
          <h3 className="text-base font-black">Importar materiais</h3>
          <p className="text-xs text-slate-500 mt-1">
            A importação é por gerência + empresa (cada empresa tem a sua lista e os seus preços). Código novo entra; código existente é atualizado; quem sair da planilha fica na lista com valor
            R$ 0,00 (o técnico não pode usar). Sem coluna de valor, os valores atuais são mantidos.
          </p>
        </div>

        {!done && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500">Gerência *</span>
              <select value={unit} onChange={(e) => { setUnit(e.target.value); setCompany(''); setPlan(null); }} className={field}>
                <option value="">Selecione...</option>
                {units.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500">Empresa *</span>
              <select value={company} disabled={!unit} onChange={(e) => { setCompany(e.target.value); setPlan(null); }} className={field} aria-label="Empresa da planilha">
                <option value="">{unit ? 'Selecione...' : 'Escolha a gerência primeiro'}</option>
                {unitCompanies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {unit && unitCompanies.length === 0 && <span className="text-[11px] font-bold text-amber-700">Nenhuma empresa ativa nesta gerência (Configurações › Empresas).</span>}
            </label>
            <label className="block sm:col-span-2">
              <span className="block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500">Arquivo (.xlsx, .xls, .csv) *</span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                className="block w-full text-xs file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-blue-600 file:text-white file:font-bold file:cursor-pointer"
              />
              {fileName && <span className="text-[11px] text-slate-500">{fileName}</span>}
            </label>
          </div>
        )}

        {data && !plan && !done && (
          <div className="space-y-2">
            <p className="text-[11px] font-black uppercase tracking-wider">Qual coluna é o quê?</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {FIELDS.map((f) => (
                <label key={f.key} className="block">
                  <span className="block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500">
                    {f.label} {f.required ? '*' : '(opcional)'}
                  </span>
                  <select
                    value={mapping[f.key]}
                    onChange={(e) => setMapping({ ...mapping, [f.key]: Number(e.target.value) })}
                    className={field}
                  >
                    <option value={-1}>{f.required ? 'Selecione...' : 'Não tem'}</option>
                    {headers.map((h, i) => <option key={i} value={i}>{h || `(coluna ${i + 1})`}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={analyze} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer">
                Conferir importação
              </button>
            </div>
          </div>
        )}

        {error && <p className="text-xs font-bold text-rose-600">{error}</p>}

        {plan && !done && (
          <div className="space-y-3 text-xs">
            <p className="font-black uppercase tracking-wider text-[11px]">Confira antes de gravar — {plan.unit} • {companyName}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                ['Novos', plan.toCreate.length, 'text-emerald-600'],
                ['Atualizados', plan.toUpdate.length, 'text-blue-600'],
                ['Irão para R$ 0,00', plan.toZero.length, 'text-amber-600'],
                ['Sem mudança', plan.unchanged, 'text-slate-500']
              ].map(([label, n, color]) => (
                <div key={label as string} className="p-3 rounded-xl border border-slate-200">
                  <p className={`text-lg font-black ${color}`}>{n as number}</p>
                  <p className="text-[10px] font-bold text-slate-500 uppercase">{label as string}</p>
                </div>
              ))}
            </div>
            {plan.toCreate.some((m) => m.cost === 0) && (
              <p className="text-amber-700 font-bold">
                {plan.toCreate.filter((m) => m.cost === 0).length} material(is) novo(s) sem valor: ficam indisponíveis para o técnico até você informar o valor.
              </p>
            )}
            {bigZero && (
              <p className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 font-bold">
                Atenção: {plan.toZero.length} de {activeBefore} materiais com valor vão para R$ 0,00. Confira se a planilha, a gerência e a empresa estão certas.
              </p>
            )}
            {plan.skippedDuplicate.length > 0 && (
              <details className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900">
                <summary className="font-bold cursor-pointer">{plan.skippedDuplicate.length} código(s) repetido(s): só o primeiro foi considerado</summary>
                <ul className="mt-2 space-y-0.5">{plan.skippedDuplicate.map((r) => <li key={r.line}>{line(r)}</li>)}</ul>
              </details>
            )}
            {plan.skippedInvalid.length > 0 && (
              <details className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-900">
                <summary className="font-bold cursor-pointer">{plan.skippedInvalid.length} linha(s) com problema (não importadas)</summary>
                <ul className="mt-2 space-y-0.5">{plan.skippedInvalid.map(({ row, reason }) => <li key={row.line}>{line(row)} — {reason}</li>)}</ul>
              </details>
            )}
            {plan.toZero.length > 0 && (
              <details className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-700">
                <summary className="font-bold cursor-pointer">Ver quem irá para R$ 0,00</summary>
                <ul className="mt-2 space-y-0.5">{plan.toZero.map((m) => <li key={m.id}>{m.code} - {m.description}</li>)}</ul>
              </details>
            )}
          </div>
        )}

        {done && <p className="text-xs font-bold text-emerald-600">Importação gravada.</p>}

        <div className="flex justify-end gap-2 pt-1">
          {plan && !done && (
            <button type="button" onClick={() => setPlan(null)} disabled={saving} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-xs font-bold cursor-pointer">
              Voltar
            </button>
          )}
          <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-xs font-bold cursor-pointer">
            {done ? 'Fechar' : 'Cancelar'}
          </button>
          {plan && !done && (
            <button
              type="button"
              onClick={apply}
              disabled={saving || plan.toCreate.length + plan.toUpdate.length + plan.toZero.length === 0}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              {saving ? 'Gravando...' : 'Gravar importação'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
