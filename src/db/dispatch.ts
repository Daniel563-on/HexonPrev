import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { Address, Asset, AssetTypeConfig, CycleSetting, MaintenanceTemplate, ServiceOrder } from '../types';
import { firebaseActive, dbInstance, cleanUndefined, withoutEmptyTechnician, checkQuotaException } from './core';
import { addToDispatchIndexInBatch, dbGetDispatchedIds } from './dispatchIndex';
import { withOrderControl } from './orderControl';
import { dbEnsureTemplateVersion, toStoredOrder } from './checklistVersions';
import { addMonths, assetTypeKey, cycleMonthIndex, duePeriodicity } from './cycle';
import { isSectorInGerencia } from '../types';

// DISPARO DAS OS (formato novo, Etapa 4c)
// Preventiva: 1 OS por ativo por mês, da maior periodicidade que vence no mês do ciclo. Período = mês inteiro.
// Vistoria (DOM): por endereço, conforme o modelo: Diária (dias úteis), Semanal (seg–sex), Quinzenal (1–15 / 16–fim).
// Nada cai em fim de semana. Número fixo da OS = ativo/endereço + período, então não existe OS repetida.

export const MAX_DISPATCH_MONTHS = 12;

export interface DispatchSkip {
  reason: string;
  items: string[];
}

export interface DispatchMonthSummary {
  month: string;          // "AAAA-MM"
  cycleMonth: number;
  counts: Record<string, number>; // periodicidade -> quantidade de OS novas
  total: number;
}

export interface DispatchPlan {
  unit: string;
  months: string[];
  isTest: boolean;
  summary: DispatchMonthSummary[];
  toCreate: ServiceOrder[];
  blocked: ServiceOrder[];     // já existem (não serão criadas de novo)
  skipped: DispatchSkip[];     // o que não gera OS e por quê
  usedModels: MaintenanceTemplate[]; // modelos usados (a versão de cada um é congelada ao gravar)
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const token = (v: string) =>
  (v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
const isWeekday = (d: Date) => d.getDay() !== 0 && d.getDay() !== 6;
const lastDayOfMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
};

// Lista de meses "AAAA-MM" entre início e fim (inclusive)
export function monthRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let m = start; m <= end && out.length < 60; m = addMonths(m, 1)) out.push(m);
  return out;
}

const assetComarca = (a: Asset) =>
  String(a.specs?.COMARCA || a.specs?.comarca || (a.location && a.location.includes(' - ') ? a.location.split(' - ')[0] : a.location) || '').trim();
const assetCraai = (a: Asset) => String(a.specs?.CRAAI || a.specs?.craai || '').trim();

// Períodos da vistoria dentro do mês (só os que ainda não terminaram)
function surveyPeriods(periodicity: string, month: string, todayStr: string): { code: string; start: string; end: string }[] {
  const [y, m] = month.split('-').map(Number);
  const last = lastDayOfMonth(month);
  const out: { code: string; start: string; end: string }[] = [];
  if (periodicity === 'Diária') {
    for (let d = 1; d <= last; d++) {
      const date = new Date(y, m - 1, d);
      if (!isWeekday(date)) continue;
      const s = ymd(date);
      if (s >= todayStr) out.push({ code: 'DIA', start: s, end: s });
    }
  } else if (periodicity === 'Semanal') {
    // Semanas cuja segunda-feira cai no mês: segunda a sexta
    for (let d = 1; d <= last; d++) {
      const date = new Date(y, m - 1, d);
      if (date.getDay() !== 1) continue;
      const friday = new Date(y, m - 1, d + 4);
      if (ymd(friday) >= todayStr) out.push({ code: 'SEM', start: ymd(date), end: ymd(friday) });
    }
  } else if (periodicity === 'Quinzenal') {
    // 1–15 e 16–fim, ajustados para o 1º e o último dia útil de cada quinzena
    const firstWorkday = (from: number, to: number) => {
      for (let d = from; d <= to; d++) if (isWeekday(new Date(y, m - 1, d))) return ymd(new Date(y, m - 1, d));
      return '';
    };
    const lastWorkday = (from: number, to: number) => {
      for (let d = to; d >= from; d--) if (isWeekday(new Date(y, m - 1, d))) return ymd(new Date(y, m - 1, d));
      return '';
    };
    for (const [a, b] of [[1, 15], [16, last]]) {
      const s = firstWorkday(a, b);
      const e = lastWorkday(a, b);
      if (s && e && e >= todayStr) out.push({ code: 'QUI', start: s, end: e });
    }
  }
  return out;
}

export interface DispatchInput {
  unit: string;
  startMonth: string;
  endMonth: string;
  assets: Asset[];
  assetTypes: AssetTypeConfig[];
  templates: MaintenanceTemplate[];
  addresses: Address[];
  cycle: CycleSetting | null;
  todayStr: string;
}

// Monta o disparo (nada é gravado aqui)
export function planDispatch(input: DispatchInput): DispatchPlan {
  const { unit, startMonth, endMonth, assets, assetTypes, templates, addresses, cycle, todayStr } = input;
  const months = monthRange(startMonth, endMonth);
  const isTest = !cycle;
  const now = new Date().toISOString();
  const models = templates.filter((t) => t.format === 'v2' && t.unit === unit);
  const skipMap = new Map<string, Set<string>>();
  const skip = (reason: string, item: string) => {
    const set = skipMap.get(reason) || new Set<string>();
    set.add(item);
    skipMap.set(reason, set);
  };
  const orders: ServiceOrder[] = [];
  const summary: DispatchMonthSummary[] = [];
  const usedModels = new Map<string, MaintenanceTemplate>();
  const isSurveyUnit = unit.trim().toUpperCase() === 'DOM';

  for (const month of months) {
    // Mês do ciclo: oficial (a partir do início) ou teste (o 1º mês escolhido é o mês 1)
    const cycleMonth = cycle ? cycleMonthIndex(cycle.cycleStart, month) : months.indexOf(month) + 1;
    const counts: Record<string, number> = {};
    const [y, m] = month.split('-').map(Number);
    const monthStart = `${month}-01`;
    const monthEnd = `${month}-${pad(lastDayOfMonth(month))}`;

    // ===== PREVENTIVAS (equipamentos) =====
    const unitTypes = assetTypes.filter((t) => t.unit === unit && !t.archived);
    for (const asset of assets) {
      if (asset.status === 'Baixado' || asset.kind === 'address' || !isSectorInGerencia(asset.sector || '', unit)) continue;
      const tipo = String(asset.specs?.TIPO || asset.specs?.tipo || '').trim();
      const label = `${asset.code} - ${asset.name}`;
      if (!tipo) { skip('Ativo sem TIPO no cadastro', label); continue; }
      const type = unitTypes.find((t) => assetTypeKey(t.name) === assetTypeKey(tipo));
      if (!type) { skip('Tipo não cadastrado (aba 1: "Atualizar tipos")', tipo); continue; }
      if (type.periodicities.length === 0) { skip('Tipo sem periodicidade marcada (aba 1)', type.name); continue; }
      if (cycleMonth < 1) continue;
      const due = duePeriodicity(type.periodicities, cycleMonth);
      if (!due) continue; // nada vence neste mês para este tipo
      const model = models.find((t) => t.type === 'preventive' && t.periodicity === due && assetTypeKey(t.assetTypeName) === assetTypeKey(type.name));
      if (!model) { skip('Sem modelo (aba 2)', `${type.name} – ${due}`); continue; }
      const id = `${asset.id}-MES-${y}${pad(m)}01`;
      counts[due] = (counts[due] || 0) + 1;
      orders.push({
        id,
        assetId: asset.id,
        assetName: asset.name,
        assetCode: asset.code,
        sector: asset.sector || unit,
        unit,
        title: `Preventiva ${due} - ${asset.name}`,
        description: model.description || `Preventiva ${due} (${type.name}). Modelo "${model.name}" v${model.version || 1}.`,
        priority: due === 'Anual' || due === 'Semestral' ? 'Alta' : 'Média',
        status: 'Novo',
        scheduledDate: '',
        startDate: monthStart,
        endDate: monthEnd,
        assignedTechnician: '',
        checklist: [], // formato enxuto: o texto vem da versão congelada do modelo; a OS guarda só as respostas
        checklistFormat: 2,
        answers: {},
        notes: '',
        signature: null,
        signedBy: null,
        signedAt: null,
        createdAt: now,
        updatedAt: now,
        photoEvidence: null,
        periodicity: due,
        comarca: assetComarca(asset) || undefined,
        craai: assetCraai(asset) || undefined,
        templateId: model.id,
        templateVersion: model.version || 1,
        cycleMonth,
        isTest
      } as ServiceOrder);
    }

    // ===== VISTORIAS (endereços) =====
    if (isSurveyUnit) {
      const surveyModels = models.filter((t) => t.type === 'survey');
      const byAddress = new Map<string, MaintenanceTemplate>();
      surveyModels.filter((t) => t.addressScope === 'selected').forEach((t) => (t.addressIds || []).forEach((id) => byAddress.set(id, t)));
      const restModel = surveyModels.find((t) => t.addressScope === 'rest');
      for (const addr of addresses.filter((a) => a.active)) {
        const model = byAddress.get(addr.id) || restModel;
        if (!model) { skip('Endereço sem modelo de vistoria (aba 2)', `${addr.code} - ${addr.address}`); continue; }
        for (const p of surveyPeriods(model.periodicity, month, todayStr)) {
          counts[model.periodicity] = (counts[model.periodicity] || 0) + 1;
          orders.push({
            id: `VST_${token(addr.id)}-${p.code}-${p.start.replace(/-/g, '')}`,
            assetId: null,
            assetName: 'S/V - Vistoria Periódica',
            assetCode: 'PE-VISTORIA',
            sector: unit,
            unit,
            title: `${model.name} - ${addr.comarca} - ${addr.address}`,
            description: model.description || `Vistoria ${model.periodicity}. Comarca: ${addr.comarca}. Endereço: ${addr.address}.`,
            priority: 'Baixa',
            status: 'Novo',
            scheduledDate: '',
            startDate: p.start,
            endDate: p.end,
            assignedTechnician: '',
            checklist: [],
            checklistFormat: 2,
            answers: {},
            notes: '',
            signature: null,
            signedBy: null,
            signedAt: null,
            createdAt: now,
            updatedAt: now,
            photoEvidence: null,
            isSurvey: true,
            surveyType: 'Vistoria',
            surveyLocation: addr.comarca,
            comarca: addr.comarca,
            craai: addr.craai || undefined,
            addressId: addr.id,
            addressText: addr.address,
            periodicity: model.periodicity,
            templateId: model.id,
            templateVersion: model.version || 1,
            cycleMonth,
            isTest
          } as ServiceOrder);
        }
      }
    }

    summary.push({ month, cycleMonth, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) });
  }

  const skipped = Array.from(skipMap.entries()).map(([reason, set]) => ({ reason, items: Array.from(set).sort() }));
  orders.forEach((o) => {
    const model = models.find((t) => t.id === o.templateId);
    if (model) usedModels.set(model.id, model);
  });
  return { unit, months, isTest, summary, toCreate: orders, blocked: [], skipped, usedModels: Array.from(usedModels.values()) };
}

// Separa as que já existem pelo registro do disparo (poucas leituras). Não há conferência OS a OS: o registro é gravado
// junto com as OS (tudo ou nada) e o banco recusa um disparo que tente regravar uma OS existente.
export async function dbSplitExistingOrders(plan: DispatchPlan): Promise<DispatchPlan> {
  if (!firebaseActive || !dbInstance || plan.toCreate.length === 0) return plan;
  const existing = await dbGetDispatchedIds(plan.toCreate.map((o) => o.startDate || ''));
  const blocked = plan.toCreate.filter((o) => existing.has(o.id));
  const toCreate = plan.toCreate.filter((o) => !existing.has(o.id));
  const summary = plan.summary.map((s) => {
    const counts: Record<string, number> = {};
    toCreate.filter((o) => (o.startDate || '').slice(0, 7) === s.month).forEach((o) => {
      const p = o.periodicity || '';
      counts[p] = (counts[p] || 0) + 1;
    });
    return { ...s, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
  });
  return { ...plan, toCreate, blocked, summary };
}

// Grava as OS em lotes (cada lote grava também o registro do disparo: tudo ou nada)
export async function dbApplyDispatch(plan: DispatchPlan, onProgress?: (done: number, total: number) => void): Promise<number> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const db = dbInstance;
  // Congela a versão de cada modelo usado (1 gravação por versão; as OS só guardam as respostas)
  for (const model of plan.usedModels || []) await dbEnsureTemplateVersion(model);
  let done = 0;
  for (let i = 0; i < plan.toCreate.length; i += 200) {
    const chunk = plan.toCreate.slice(i, i + 200);
    const batch = writeBatch(db);
    chunk.forEach((o) => batch.set(doc(db, 'serviceOrders', o.id), { ...withOrderControl(cleanUndefined(toStoredOrder(withoutEmptyTechnician(o)))), syncAt: serverTimestamp() }));
    addToDispatchIndexInBatch(batch, chunk.map((o) => o.id));
    await batch.commit();
    done += chunk.length;
    onProgress?.(done, plan.toCreate.length);
  }
  return done;
}
