import { Asset } from '../../types';

// IMPORTAÇÃO DE ATIVOS (A4-A): colunas reconhecidas pelo nome, tipo por grupo de material e conferência antes de gravar.
// O tipo de manutenção decide a preventiva (PMOC › Tipos de ativo e ciclo); a periodicidade fica no tipo, não no ativo.

export type ImportField =
  | 'code'
  | 'material'
  | 'capacity'
  | 'brand'
  | 'model'
  | 'serial'
  | 'address'
  | 'room'
  | 'craai'
  | 'comarca'
  | 'acquisitionDate'
  | 'netValue'
  | 'company'
  | 'status'
  | 'type';

export const norm = (v: unknown) =>
  String(v ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');

export const IMPORT_FIELDS: { key: ImportField; label: string; hint: string; required?: boolean; match: (h: string) => boolean }[] = [
  { key: 'code', label: 'Patrimônio', hint: 'Número único do bem (vira o código do QR)', required: true, match: (h) => h.startsWith('PATRIMONI') || ['CODIGO', 'TAG', 'N PATRIMONIAL', 'NO PATRIMONIAL'].includes(h) },
  { key: 'material', label: 'Material', hint: 'Nome do equipamento; os tipos são escolhidos por material', required: true, match: (h) => ['MATERIAL', 'EQUIPAMENTO', 'DESCRICAO', 'NOME'].includes(h) },
  { key: 'address', label: 'Endereço (prédio)', hint: 'Rua e número; a lista agrupa por ele', required: true, match: (h) => h.startsWith('ENDERECO') },
  { key: 'room', label: 'Localização (sala/setor)', hint: 'Onde fica dentro do prédio', match: (h) => ['LOCALIZACAO', 'LOCAL', 'SALA', 'SETOR', 'AMBIENTE'].includes(h) },
  { key: 'craai', label: 'CRAAI', hint: '', match: (h) => h === 'CRAAI' },
  { key: 'comarca', label: 'Comarca / unidade', hint: '', match: (h) => h === 'COMARCA' || h === 'UNIDADE' },
  { key: 'capacity', label: 'Capacidade', hint: 'Ex.: 18.000 BTUs', match: (h) => h.startsWith('CAPACIDADE') || h.includes('BTU') || h === 'POTENCIA' },
  { key: 'brand', label: 'Marca', hint: '', match: (h) => h === 'MARCA' || h === 'FABRICANTE' },
  { key: 'model', label: 'Modelo', hint: '', match: (h) => h === 'MODELO' },
  { key: 'serial', label: 'Nº de série', hint: '', match: (h) => h.includes('SERIE') || h === 'SERIAL' },
  { key: 'acquisitionDate', label: 'Data de aquisição', hint: '', match: (h) => h.includes('AQUISICAO') && !h.includes('VALOR') },
  { key: 'netValue', label: 'Valor líquido (R$)', hint: 'Só quem tem "Visualizar Valores" vê', match: (h) => h.includes('LIQUIDO') || h.includes('RESIDUAL') },
  { key: 'company', label: 'Empresa (conferência)', hint: 'Só confere com a empresa escolhida', match: (h) => h === 'EMPRESA' || h === 'CONTRATADA' },
  { key: 'status', label: 'Status', hint: 'Sem coluna: o ativo continua com o status que já tinha', match: (h) => h === 'STATUS' || h === 'SITUACAO' },
  { key: 'type', label: 'Tipo (se a planilha tiver)', hint: 'Só sugere o tipo de cada material', match: (h) => h === 'TIPO' || h === 'TIPO DE MANUTENCAO' || h === 'TIPO DO ATIVO' }
];

export type ColumnMap = Partial<Record<ImportField, string>>;

// Cada campo pega a primeira coluna com o nome parecido (uma coluna não serve a dois campos)
export function autoMap(headers: string[]): ColumnMap {
  const map: ColumnMap = {};
  const used = new Set<string>();
  for (const f of IMPORT_FIELDS) {
    const h = headers.find((x) => !used.has(x) && f.match(norm(x)));
    if (h) {
      map[f.key] = h;
      used.add(h);
    }
  }
  return map;
}

export const cell = (row: Record<string, unknown>, map: ColumnMap, f: ImportField) => (map[f] ? String(row[map[f]!] ?? '').trim() : '');

// Data da planilha (número do Excel, DD/MM/AAAA ou AAAA-MM-DD) → AAAA-MM-DD ("" se não der para ler)
export function parseDate(val: unknown): string {
  if (val === undefined || val === null || String(val).trim() === '') return '';
  if (val instanceof Date) return isNaN(val.getTime()) ? '' : val.toISOString().slice(0, 10);
  const str = String(val).trim();
  const num = Number(str);
  if (!isNaN(num) && num > 10000 && num < 100000) {
    const d = new Date(Math.round((num - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  }
  const br = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (br) return `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
  const iso = str.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  return '';
}

// Valor (número da planilha ou texto "1.353,31") → "1.353,31"
export function formatMoney(val: string): string {
  if (!val) return '';
  const n = /^-?\d+(\.\d+)?$/.test(val) ? Number(val) : Number(val.replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? val : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function statusFrom(val: string): Asset['status'] | null {
  const s = norm(val);
  if (!s) return null;
  if (s.includes('MANUTEN')) return 'Em Manutenção';
  if (s.includes('PARADO') || s.includes('INATIVO')) return 'Parado';
  if (s.includes('BAIXA')) return 'Baixado';
  return 'Operando';
}

// ===== GRUPOS DE MATERIAL (etapa "Tipos") =====
export interface MaterialGroup {
  key: string;          // material normalizado
  material: string;     // como veio na planilha (o mais comum)
  count: number;
  capacities: string[]; // capacidades encontradas (para ajudar a reconhecer o grupo)
  suggested: string;    // tipo sugerido
  suggestedFrom: 'ativos' | 'planilha' | '';
}

const mostCommon = (values: string[]) => {
  const m = new Map<string, number>();
  values.filter(Boolean).forEach((v) => m.set(v, (m.get(v) || 0) + 1));
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
};

export const assetMaterial = (a: Asset) => String(a.specs?.MATERIAL || a.name || '');
export const assetType = (a: Asset) => String(a.specs?.TIPO || a.specs?.tipo || '').trim();

// Tipo sugerido: o que os ativos já cadastrados da gerência com o mesmo material têm; senão, a coluna TIPO da planilha
export function materialGroups(rows: Record<string, unknown>[], map: ColumnMap, existing: Asset[], unit: string): MaterialGroup[] {
  const byKey = new Map<string, { names: string[]; caps: Set<string>; types: string[] }>();
  for (const r of rows) {
    const material = cell(r, map, 'material');
    if (!material || !cell(r, map, 'code')) continue;
    const k = norm(material);
    const g = byKey.get(k) || { names: [], caps: new Set<string>(), types: [] };
    g.names.push(material);
    const cap = cell(r, map, 'capacity');
    if (cap) g.caps.add(cap);
    const t = cell(r, map, 'type');
    if (t) g.types.push(t);
    byKey.set(k, g);
  }
  const sameUnit = existing.filter((a) => a.kind !== 'address' && norm(a.sector) === norm(unit));
  return Array.from(byKey.entries())
    .map(([key, g]) => {
      const fromAssets = mostCommon(sameUnit.filter((a) => norm(assetMaterial(a)) === key).map(assetType));
      const fromSheet = mostCommon(g.types);
      return {
        key,
        material: mostCommon(g.names),
        count: g.names.length,
        capacities: Array.from(g.caps).sort((a, b) => parseInt(a.replace(/\D/g, '') || '0') - parseInt(b.replace(/\D/g, '') || '0')),
        suggested: fromAssets || fromSheet,
        suggestedFrom: (fromAssets ? 'ativos' : fromSheet ? 'planilha' : '') as MaterialGroup['suggestedFrom']
      };
    })
    .sort((a, b) => b.count - a.count);
}

// ===== CONFERÊNCIA (nada é gravado aqui) =====
export interface ImportPlan {
  toSave: Asset[];
  newCount: number;
  updatedCount: number;
  unchangedCount: number;
  toRetire: Asset[];
  moved: { asset: Asset; from: string }[];
  skipped: number;          // linhas sem patrimônio ou sem material
  duplicates: string[];     // patrimônios repetidos na planilha (vale a última linha)
  byType: { type: string; count: number }[]; // "" = sem tipo
  sectorTotal: number;      // ativos dessa gerência + empresa antes da importação
}

const SPEC_KEYS = ['MATERIAL', 'TIPO', 'CAPACIDADE', 'capacity', 'MARCA', 'manufacturer', 'MODELO', 'model', 'Nº DE SÉRIE', 'serialNumber', 'LOCALIZAÇÃO', 'CRAAI', 'COMARCA', 'DATA DE AQUISIÇÃO', 'installationDate', 'VALOR LÍQUIDO'];
const snapshot = (a: Asset) =>
  JSON.stringify([a.name, a.sector, a.company || '', a.location || '', a.status, a.retiredAt || '', !!a.periodicities, SPEC_KEYS.map((k) => String(a.specs?.[k] ?? ''))]);

export function buildImportPlan(p: {
  rows: Record<string, unknown>[];
  map: ColumnMap;
  unit: string;
  company: string;
  typeByMaterial: Record<string, string>; // material normalizado → tipo ("" = sem tipo)
  existing: Asset[];
  now: string;
}): ImportPlan {
  const { rows, map, unit, company, typeByMaterial, existing, now } = p;
  const byCode = new Map<string, Asset>();
  existing.filter((a) => a.kind !== 'address' && a.code).forEach((a) => byCode.set(a.code.trim().toUpperCase(), a));
  const result = new Map<string, Asset>(); // código → ativo como vai ficar (a última linha vale)
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  let skipped = 0;
  const has = (f: ImportField) => !!map[f];

  for (const r of rows) {
    const code = cell(r, map, 'code').toUpperCase();
    const material = cell(r, map, 'material');
    if (!code || !material) {
      skipped++;
      continue;
    }
    if (seen.has(code)) duplicates.add(code);
    seen.add(code);
    const before = byCode.get(code);
    const specs: Record<string, string | undefined> = { ...(before?.specs || {}) };
    const set = (keys: string[], v: string) => keys.forEach((k) => (specs[k] = v));
    set(['MATERIAL'], material);
    set(['TIPO'], (typeByMaterial[norm(material)] || '').trim());
    if (has('capacity')) set(['CAPACIDADE', 'capacity'], cell(r, map, 'capacity'));
    if (has('brand')) set(['MARCA', 'manufacturer'], cell(r, map, 'brand'));
    if (has('model')) set(['MODELO', 'model'], cell(r, map, 'model'));
    if (has('serial')) set(['Nº DE SÉRIE', 'serialNumber'], cell(r, map, 'serial'));
    if (has('room')) set(['LOCALIZAÇÃO'], cell(r, map, 'room'));
    if (has('craai')) set(['CRAAI'], cell(r, map, 'craai'));
    if (has('comarca')) set(['COMARCA'], cell(r, map, 'comarca'));
    if (has('acquisitionDate')) set(['DATA DE AQUISIÇÃO', 'installationDate'], parseDate(map.acquisitionDate ? r[map.acquisitionDate] : ''));
    if (has('netValue')) set(['VALOR LÍQUIDO'], formatMoney(cell(r, map, 'netValue')));
    // Campos da primeira versão que não valem mais (status vai no próprio ativo)
    delete specs.STATUS;
    const sheetStatus = has('status') ? statusFrom(cell(r, map, 'status')) : null;
    const status: Asset['status'] = sheetStatus || (before && before.status !== 'Baixado' ? before.status : 'Operando');
    const base: Asset = before
      ? { ...before }
      : {
          id: `as_${unit.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now().toString().slice(-4)}_${Math.random().toString(36).slice(2, 6)}`,
          code,
          name: material,
          sector: unit,
          location: '',
          specs: {} as Asset['specs'],
          status,
          createdAt: now
        };
    const next: Asset = {
      ...base,
      name: material,
      sector: unit,
      company,
      location: has('address') ? cell(r, map, 'address') : base.location,
      status,
      specs: specs as Asset['specs'],
      retiredAt: status === 'Baixado' ? base.retiredAt || now : undefined
    };
    delete next.periodicities; // a periodicidade vem do tipo (PMOC)
    if (before && (before.company || '') !== company) {
      next.companyHistory = [...(before.companyHistory || []), { from: before.company || '', to: company, at: now, via: 'importação' }];
    }
    result.set(code, next);
  }

  const toSave: Asset[] = [];
  const moved: { asset: Asset; from: string }[] = [];
  let newCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  const typeCount = new Map<string, number>();
  for (const [code, next] of result) {
    const t = String(next.specs?.TIPO || '');
    typeCount.set(t, (typeCount.get(t) || 0) + 1);
    const before = byCode.get(code);
    if (!before) {
      newCount++;
      toSave.push(next);
    } else if (snapshot(before) !== snapshot(next)) {
      updatedCount++;
      toSave.push({ ...next, updatedAt: now });
      if ((before.company || '') !== company) moved.push({ asset: before, from: before.company || '' });
    } else unchangedCount++;
  }

  // Ativos dessa gerência + empresa que não vieram na planilha: serão baixados (depois da confirmação)
  const sectorAssets = existing.filter((a) => a.kind !== 'address' && norm(a.sector) === norm(unit) && (a.company || '') === company);
  const toRetire = sectorAssets.filter((a) => a.status !== 'Baixado' && !result.has((a.code || '').trim().toUpperCase()));

  return {
    toSave,
    newCount,
    updatedCount,
    unchangedCount,
    toRetire,
    moved,
    skipped,
    duplicates: Array.from(duplicates),
    byType: Array.from(typeCount.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => (a.type ? 0 : 1) - (b.type ? 0 : 1) || b.count - a.count),
    sectorTotal: sectorAssets.length
  };
}
