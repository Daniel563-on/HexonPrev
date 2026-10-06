import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { Company, HexonUser, WorkforcePerson } from '../../types';
import {
  dbApplyWorkforceImport,
  planWorkforceImport,
  WorkforceImportPlan,
  WorkforceImportRow
} from '../../db/firebase';

// IMPORTAÇÃO DO EFETIVO: planilha com as colunas Matrícula, Nome, Cargo, Gerência; a empresa é escolhida antes (uma por planilha).
// Quem entra por aqui NÃO tem login (só compõe o efetivo). Confira antes de gravar.

interface Props {
  companies: Company[];
  existing: WorkforcePerson[];
  users: HexonUser[];
  unitNames: string[];
  darkMode: boolean;
  onClose: () => void;
  onDone: () => void;
}

const headerKey = (h: unknown) =>
  String(h ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

export default function WorkforceImportModal({ companies, existing, users, unitNames, darkMode, onClose, onDone }: Props) {
  const [companyId, setCompanyId] = useState('');
  const company = companies.find((c) => c.id === companyId);
  const [plan, setPlan] = useState<WorkforceImportPlan | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const handleFile = async (file: File) => {
    setError(null);
    setPlan(null);
    setFileName(file.name);
    if (!company) {
      setError('Escolha a empresa desta planilha antes do arquivo.');
      return;
    }
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' });
      if (data.length < 2) throw new Error('A planilha está vazia.');
      const header = data[0].map(headerKey);
      const col = (name: string) => header.indexOf(name);
      const idx = { matricula: col('MATRICULA'), name: col('NOME'), cargo: col('CARGO'), unit: col('GERENCIA') };
      const missing = Object.entries({ Matrícula: idx.matricula, Nome: idx.name, Cargo: idx.cargo, Gerência: idx.unit })
        .filter(([, i]) => i < 0)
        .map(([n]) => n);
      if (missing.length > 0) throw new Error(`Coluna(s) não encontrada(s) na primeira linha: ${missing.join(', ')}.`);
      const rows: WorkforceImportRow[] = data
        .slice(1)
        .map((r, i) => ({
          matricula: String(r[idx.matricula] ?? ''),
          name: String(r[idx.name] ?? ''),
          cargo: String(r[idx.cargo] ?? ''),
          unit: String(r[idx.unit] ?? ''),
          line: i + 2
        }))
        .filter((r) => r.matricula.trim() || r.name.trim());
      setPlan(planWorkforceImport(rows, existing, users, unitNames, company));
    } catch (err: any) {
      setError(err?.message || String(err));
    }
  };

  const apply = async () => {
    if (!plan) return;
    setSaving(true);
    setError(null);
    try {
      await dbApplyWorkforceImport(plan);
      setDone(true);
      onDone();
    } catch (err: any) {
      setError(`Não foi possível gravar: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  const activeBefore = existing.filter((p) => p.status === 'Ativo' && p.company === companyId).length;
  const bigInactivation = !!plan && activeBefore > 0 && plan.toInactivate.length / activeBefore >= 0.2;
  const box = darkMode ? 'bg-[#0b1220] border-slate-800 text-slate-200' : 'bg-white border-slate-200 text-slate-800';
  const line = (row: WorkforceImportRow) => `linha ${row.line}: ${row.matricula} - ${row.name}`;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className={`w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border shadow-2xl p-6 space-y-4 ${box}`}>
        <div>
          <h3 className="text-base font-black">Importar efetivo por planilha</h3>
          <p className="text-xs text-slate-500 mt-1">
            Colunas na primeira linha: <strong>Matrícula, Nome, Cargo, Gerência</strong>. Quem entra por aqui não tem login (só compõe o efetivo).
            Uma empresa por planilha: quem é dessa empresa e sumir da planilha fica inativo; mudanças de nome, cargo, gerência e empresa são atualizadas.
          </p>
        </div>

        {!done && (
          <label className="block">
            <span className="block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500">Empresa *</span>
            <select
              value={companyId}
              onChange={(e) => { setCompanyId(e.target.value); setPlan(null); setFileName(''); }}
              className={`w-full h-9 text-xs px-3 border rounded-lg outline-none font-semibold ${darkMode ? 'bg-[#121b2d] border-slate-800' : 'bg-white border-slate-200'}`}
              aria-label="Empresa da planilha"
            >
              <option value="">Selecione...</option>
              {companies.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.units.join(', ')})</option>)}
            </select>
          </label>
        )}

        {!done && companyId && (
          <label className="block">
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              className="block w-full text-xs file:mr-3 file:px-4 file:py-2 file:rounded-lg file:border-0 file:bg-blue-600 file:text-white file:font-bold file:cursor-pointer"
            />
            {fileName && <span className="text-[11px] text-slate-500">{fileName}</span>}
          </label>
        )}

        {error && <p className="text-xs font-bold text-rose-600">{error}</p>}

        {plan && !done && (
          <div className="space-y-3 text-xs">
            <p className="font-black uppercase tracking-wider text-[11px]">Confira antes de gravar — {company?.name}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                ['Novos', plan.toCreate.length, 'text-emerald-600'],
                ['Atualizados', plan.toUpdate.length, 'text-blue-600'],
                ['Ficarão inativos', plan.toInactivate.length, 'text-amber-600'],
                ['Sem mudança', plan.unchanged, 'text-slate-500']
              ].map(([label, n, color]) => (
                <div key={label as string} className="p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                  <p className={`text-lg font-black ${color}`}>{n as number}</p>
                  <p className="text-[10px] font-bold text-slate-500 uppercase">{label as string}</p>
                </div>
              ))}
            </div>

            {bigInactivation && (
              <p className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 font-bold">
                Atenção: {plan.toInactivate.length} de {activeBefore} pessoas ativas da empresa vão ficar inativas. Confira se a planilha e a empresa estão certas.
              </p>
            )}

            {plan.skippedLogin.length > 0 && (
              <details className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-900">
                <summary className="font-bold cursor-pointer">
                  {plan.skippedLogin.length} não importado(s): já são usuários com login (o usuário do sistema tem prioridade)
                </summary>
                <ul className="mt-2 space-y-0.5">{plan.skippedLogin.map((r) => <li key={r.line}>{line(r)}</li>)}</ul>
              </details>
            )}
            {plan.skippedDuplicate.length > 0 && (
              <details className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900">
                <summary className="font-bold cursor-pointer">
                  {plan.skippedDuplicate.length} matrícula(s) repetida(s) na planilha: só a primeira foi considerada
                </summary>
                <ul className="mt-2 space-y-0.5">{plan.skippedDuplicate.map((r) => <li key={r.line}>{line(r)}</li>)}</ul>
              </details>
            )}
            {plan.skippedInvalid.length > 0 && (
              <details className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-900">
                <summary className="font-bold cursor-pointer">{plan.skippedInvalid.length} linha(s) com problema (não importadas)</summary>
                <ul className="mt-2 space-y-0.5">
                  {plan.skippedInvalid.map(({ row, reason }) => <li key={row.line}>{line(row)} — {reason}</li>)}
                </ul>
              </details>
            )}
            {plan.toInactivate.length > 0 && (
              <details className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-700">
                <summary className="font-bold cursor-pointer">Ver quem ficará inativo</summary>
                <ul className="mt-2 space-y-0.5">
                  {plan.toInactivate.map((p) => <li key={p.id}>{p.matricula} - {p.name} ({p.cargo}, {p.unit})</li>)}
                </ul>
              </details>
            )}
          </div>
        )}

        {done && (
          <p className="text-xs font-bold text-emerald-600">
            Importação gravada. Se entrou algum cargo novo, vá em "Cargos" e clique em "Atualizar cargos" para informar o valor da hora.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-xs font-bold cursor-pointer"
          >
            {done ? 'Fechar' : 'Cancelar'}
          </button>
          {plan && !done && (
            <button
              type="button"
              onClick={apply}
              disabled={saving || plan.toCreate.length + plan.toUpdate.length + plan.toInactivate.length === 0}
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
