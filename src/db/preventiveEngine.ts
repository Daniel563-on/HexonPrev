import { doc, writeBatch } from 'firebase/firestore';
import { Asset, ServiceOrder, ChecklistItem, MaintenanceTemplate } from '../types';
import {
  firebaseActive,
  dbInstance,
  cleanUndefined
} from './core';
import { dbGetTemplates } from './templates';
import { dbGetManagements } from './organization';

// Forward references to service orders / assets functions
// (will be resolved via dependency injection or direct barrel import)
let getAssetsFn: () => Promise<Asset[]>;
let getServiceOrdersFn: () => Promise<ServiceOrder[]>;
let saveDeadlineFn: (deadline: { id: string; expiresAt: string }) => Promise<void>;
let appendServiceOrdersCacheFn: (orders: ServiceOrder[]) => void;

export function configurePreventiveEngineDeps(deps: {
  getAssets: () => Promise<Asset[]>;
  getServiceOrders: () => Promise<ServiceOrder[]>;
  saveDeadline: (deadline: { id: string; expiresAt: string }) => Promise<void>;
  appendServiceOrdersCache: (orders: ServiceOrder[]) => void;
}) {
  getAssetsFn = deps.getAssets;
  getServiceOrdersFn = deps.getServiceOrders;
  saveDeadlineFn = deps.saveDeadline;
  appendServiceOrdersCacheFn = deps.appendServiceOrdersCache;
}

// DATA CONTRACT FOR BULK GENERATION FILTERS
export interface AutoGenFilter {
  templateId: string;
  comarca: string;
  sector: string;
  startDate: string;
  endDate: string;
}

// HELPERS FOR PREVENTIVE CYCLE MOTOR
export function getYearWeek(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  const tempDate = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = tempDate.getUTCDay() || 7;
  tempDate.setUTCDate(tempDate.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tempDate.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((tempDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${tempDate.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function getAssetCycles(asset: Asset, orders: ServiceOrder[]): {
  [periodicity: string]: {
    lastExecution: string | null;
    nextGenerationPrevista: string | null;
    status: 'Em Dia' | 'Atrasado' | 'Pendente de Planejamento';
  };
} {
  const assetOrders = orders.filter((o) => o.assetId === asset.id);
  const periodicities = asset.periodicities || ['Mensal', 'Semestral', 'Anual'];
  const cycles: any = {};

  for (const p of periodicities) {
    // Last executed/completed
    const completed = [...assetOrders]
      .filter((o) => o.status === 'Concluída' && (o.periodicity === p || o.title.includes(p)))
      .sort((a, b) => b.scheduledDate.localeCompare(a.scheduledDate));

    const lastExecDate = completed.length > 0 ? completed[0].scheduledDate : null;

    // Find any planned/pending future OS
    const planned = [...assetOrders]
      .filter((o) => (o.status === 'Novo' || o.status === 'Planejada' || o.status === 'Em Execução') && (o.periodicity === p || o.title.includes(p)))
      .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));

    let nextPrevista: string | null = null;
    let status: 'Em Dia' | 'Atrasado' | 'Pendente de Planejamento' = 'Pendente de Planejamento';

    if (planned.length > 0) {
      nextPrevista = planned[0].scheduledDate;
      status = 'Em Dia';
    } else {
      // Calculate next recommended generation
      const referenceDate = lastExecDate || asset.createdAt.slice(0, 10) || new Date().toISOString().slice(0, 10);
      const ref = new Date(referenceDate + 'T12:00:00');

      if (p === 'Semanal') {
        ref.setDate(ref.getDate() + 7);
      } else if (p === 'Mensal') {
        ref.setMonth(ref.getMonth() + 1);
      } else if (p === 'Semestral') {
        ref.setMonth(ref.getMonth() + 6);
      } else if (p === 'Anual') {
        ref.setFullYear(ref.getFullYear() + 1);
      }
      nextPrevista = ref.toISOString().slice(0, 10);

      // Check if overdue
      const todayStr = new Date().toISOString().slice(0, 10);
      if (nextPrevista < todayStr) {
        status = 'Atrasado';
      } else {
        status = 'Em Dia';
      }
    }

    cycles[p] = {
      lastExecution: lastExecDate,
      nextGenerationPrevista: nextPrevista,
      status
    };
  }

  return cycles;
}

function getYearWeekLocal(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  const tempDate = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = tempDate.getUTCDay() || 7;
  tempDate.setUTCDate(tempDate.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tempDate.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((tempDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${tempDate.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function getQuarterLocal(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()}-Q${q}`;
}

function getSemesterLocal(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  const s = Math.floor(d.getMonth() / 6) + 1;
  return `${d.getFullYear()}-S${s}`;
}

function isSamePeriodLocal(dateAStr: string, dateBStr: string, periodicity: string): boolean {
  if (!dateAStr || !dateBStr) return false;
  const p = periodicity || '';
  if (p === 'Semanal') {
    return getYearWeekLocal(dateAStr) === getYearWeekLocal(dateBStr);
  }
  if (p === 'Mensal') {
    return dateAStr.slice(0, 7) === dateBStr.slice(0, 7);
  }
  if (p === 'Trimestral') {
    return getQuarterLocal(dateAStr) === getQuarterLocal(dateBStr);
  }
  if (p === 'Semestral') {
    return getSemesterLocal(dateAStr) === getSemesterLocal(dateBStr);
  }
  if (p === 'Anual') {
    return dateAStr.slice(0, 4) === dateBStr.slice(0, 4);
  }
  return dateAStr === dateBStr;
}

function alignPeriodDatesLocal(baseDateStr: string, periodicity: string): { startDate: string; endDate: string; scheduledDate: string } {
  if (!baseDateStr) {
    const today = new Date().toISOString().slice(0, 10);
    return { startDate: today, endDate: today, scheduledDate: today };
  }
  const d = new Date(baseDateStr + 'T12:00:00');
  const y = d.getFullYear();

  const formatDateString = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  if (periodicity === 'Semanal') {
    const day = d.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(d);
    monday.setDate(d.getDate() + diffToMonday);
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);

    return {
      startDate: formatDateString(monday),
      endDate: formatDateString(friday),
      scheduledDate: baseDateStr
    };
  } else if (periodicity === 'Mensal') {
    const m = d.getMonth();
    const firstDay = new Date(y, m, 1);
    const lastDay = new Date(y, m + 1, 0);

    return {
      startDate: formatDateString(firstDay),
      endDate: formatDateString(lastDay),
      scheduledDate: baseDateStr
    };
  } else if (periodicity === 'Trimestral') {
    const m = d.getMonth();
    const quarter = Math.floor(m / 3);
    const qStartMonth = quarter * 3;
    const qEndMonth = qStartMonth + 2;

    const firstDay = new Date(y, qStartMonth, 1);
    const lastDay = new Date(y, qEndMonth + 1, 0);

    return {
      startDate: formatDateString(firstDay),
      endDate: formatDateString(lastDay),
      scheduledDate: baseDateStr
    };
  } else if (periodicity === 'Semestral') {
    const m = d.getMonth();
    const semester = Math.floor(m / 6);
    const sStartMonth = semester * 6;
    const sEndMonth = sStartMonth + 5;

    const firstDay = new Date(y, sStartMonth, 1);
    const lastDay = new Date(y, sEndMonth + 1, 0);

    return {
      startDate: formatDateString(firstDay),
      endDate: formatDateString(lastDay),
      scheduledDate: baseDateStr
    };
  } else if (periodicity === 'Anual') {
    const firstDay = new Date(y, 0, 1);
    const lastDay = new Date(y, 11, 31);

    return {
      startDate: formatDateString(firstDay),
      endDate: formatDateString(lastDay),
      scheduledDate: baseDateStr
    };
  }

  return {
    startDate: baseDateStr,
    endDate: baseDateStr,
    scheduledDate: baseDateStr
  };
}

let lastAutoGenTimestamp = 0;

// AUTOMATED PREVENTIVE MAINTENANCE AND SURVEY GENERATOR
export async function dbAutoGeneratePreventiveActivities(
  filtersOrTemplateId: AutoGenFilter[] | string = 'all',
  comarcaFilter: string = 'all',
  sectorFilter: string = 'all',
  startDateStr: string = new Date().toISOString().slice(0, 10),
  endDateStr: string = new Date().toISOString().slice(0, 10)
): Promise<number> {
  const now = Date.now();
  if (filtersOrTemplateId === 'all' && now - lastAutoGenTimestamp < 15000) {
    console.log('Auto-generation on cooldown, skipping background check to prevent rate and quota limits.');
    return 0;
  }
  if (filtersOrTemplateId === 'all') {
    lastAutoGenTimestamp = now;
  }

  let generatedCount = 0;

  try {
    const [assets, orders, templates] = await Promise.all([
      getAssetsFn ? getAssetsFn() : Promise.resolve([]),
      getServiceOrdersFn ? getServiceOrdersFn() : Promise.resolve([]),
      dbGetTemplates()
    ]);

    const allNewOrders: ServiceOrder[] = [];

    // Parse filters list
    const filters: AutoGenFilter[] = typeof filtersOrTemplateId === 'string'
      ? [{
          templateId: filtersOrTemplateId,
          comarca: comarcaFilter,
          sector: sectorFilter,
          startDate: startDateStr,
          endDate: endDateStr
        }]
      : filtersOrTemplateId;

    // Extract unique comarcas from registered assets
    const comarcas = new Set<string>();
    assets.forEach((asset) => {
      const c = asset.specs?.COMARCA || asset.specs?.comarca || (asset.location && asset.location.includes(' - ') ? asset.location.split(' - ')[0] : asset.location);
      if (c && typeof c === 'string' && c.trim() !== '') {
        comarcas.add(c.trim());
      }
    });
    if (comarcas.size === 0) {
      comarcas.add('Comarca Capital');
    }
    const comarcaList = Array.from(comarcas).sort((a, b) => a.localeCompare(b));

    for (const filter of filters) {
      const { templateId, comarca: filterComarca, sector: filterSector, startDate: filterStartDate, endDate: filterEndDate } = filter;

      if (filterComarca === 'none' || filterSector === 'none') {
        continue;
      }

      // Filter templates to generate
      const targetTemplates = templates.filter((t) => {
        if (templateId !== 'all' && t.id !== templateId) return false;
        return true;
      });

      for (const t of targetTemplates) {
        // 1. SURVEY / VISTORIA TEMPLATE (Semanal - sem vínculo com ativo, única por comarca)
        if (t.type === 'survey') {
          // Apply operational sector filter on template targetSectorOrType if specified
          if (filterSector !== 'all') {
            const tSector = (t.targetSectorOrType || '').toLowerCase().trim();
            if (tSector !== filterSector.toLowerCase().trim()) continue;
          }

          const targetComarcas = comarcaList.filter((comarca) => {
            if (filterComarca !== 'all' && comarca.toLowerCase().trim() !== filterComarca.toLowerCase().trim()) return false;
            return true;
          });

          for (const comarca of targetComarcas) {
            let i = 0;
            const limit = 100; // safety brake to prevent infinite loops
            while (i < limit) {
              const dates = alignPeriodDatesLocal(filterStartDate, 'Semanal');
              const scheduledDate = dates.scheduledDate;
              const pStartDate = dates.startDate;
              const pEndDate = dates.endDate;

              // If the start of the scheduled period exceeds the target end date pool, stop generating further
              if (scheduledDate > filterEndDate) {
                break;
              }

              const title = `${t.name} - ${comarca}`;

              // EXTREME SAFETY CODES: Enforce Duplication Prevention & Weekly Boundaries using unified helper
              const alreadyExists = orders.some((o) => {
                if (!o.isSurvey || o.surveyLocation !== comarca || o.title !== title) return false;
                return isSamePeriodLocal(o.startDate || o.scheduledDate, scheduledDate, 'Semanal');
              });

              if (!alreadyExists) {
                const checklistItems: ChecklistItem[] = t.checklistItems
                  .filter((item) => item.isActive)
                  .map((item, idx) => ({
                    id: `ck_v_g_${Date.now()}_${idx}_${Math.floor(Math.random() * 1000)}`,
                    task: item.task,
                    checked: item.defaultChecked ?? false,
                    checkedAt: null,
                    observations: null,
                    criticality: item.criticality || 'Média',
                    autoCreateCorrective: item.autoCreateCorrective ?? false,
                    observationRequired: item.observationRequired ?? false,
                    responseType: item.responseType || 'three_states',
                    naObservationRequired: item.naObservationRequired ?? false
                  } as any));

                const newSurvey: ServiceOrder = {
                  id: (Math.floor(Math.random() * 800000) + 100000).toString(),
                  assetId: null,
                  assetName: 'S/V - Vistoria Periódica',
                  assetCode: 'PE-VISTORIA',
                  sector: filterSector !== 'all' ? filterSector : (t.targetSectorOrType || 'Vistoria'),
                  title: title,
                  description: `Vistoria de rotina programada. Comarca: ${comarca}. Procedimento autônomo sem vinculação com ativos de engenharia.`,
                  priority: 'Baixa',
                  status: 'Novo',
                  scheduledDate: '',
                  startDate: pStartDate,
                  endDate: pEndDate,
                  assignedTechnician: '',
                  checklist: checklistItems,
                  notes: '',
                  signature: null,
                  signedBy: null,
                  signedAt: null,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                  photoEvidence: null,
                  isSurvey: true,
                  surveyType: t.targetSectorOrType || 'Comarcas',
                  surveyLocation: comarca,
                  periodicity: 'Semanal'
                };

                allNewOrders.push(newSurvey);
                orders.unshift(newSurvey);
                generatedCount++;
              }

              i = limit; // Only generate 1 instance per selected period
            }
          }
        }

        // 2. PREVENTIVE TEMPLATE (Sempre vinculada a ativo por tipo/setor, um por equipamento)
        if (t.type === 'preventive') {
          // Find matching assets across the set comarca and sector
          const matchingAssets = assets.filter((asset) => {
            const assetComarca = asset.specs?.COMARCA || asset.specs?.comarca || (asset.location && asset.location.includes(' - ') ? asset.location.split(' - ')[0] : asset.location);
            if (filterComarca !== 'all' && assetComarca.toLowerCase().trim() !== filterComarca.toLowerCase().trim()) return false;

            // Operational sector filter constraint on asset itself
            if (filterSector !== 'all' && asset.sector && asset.sector.toLowerCase().trim() !== filterSector.toLowerCase().trim()) return false;

            const tAssetType = (t.targetAssetType || '').toLowerCase().trim();
            const assetTipoSpec = (asset.specs?.TIPO || asset.specs?.tipo || '').toLowerCase().trim();
            const tSector = (t.targetSectorOrType || '').toLowerCase().trim();
            const assetSector = (asset.sector || '').toLowerCase().trim();

            if (tAssetType && assetTipoSpec) {
              return assetTipoSpec.includes(tAssetType) || tAssetType.includes(assetTipoSpec);
            }
            if (tAssetType && !assetTipoSpec) {
              const assetName = (asset.name || '').toLowerCase();
              return assetName.includes(tAssetType);
            }
            return assetSector === tSector;
          });

          // Determine periodicities in template to iterate
          const tPeriodicities = (t.periodicity || '').split(',').map((p) => p.trim());

          for (const asset of matchingAssets) {
            const activePeriodicities = asset.periodicities || [];
            const commonPeriodicities = activePeriodicities.filter((ap) =>
              tPeriodicities.some((tp) => tp.toLowerCase() === ap.toLowerCase())
            );

            // Fetch this specific asset's order history to enforce intervals and block duplicates
            const assetOrders = orders.filter((o) => o.assetId === asset.id);

            for (const periodicity of commonPeriodicities) {
              let i = 0;
              const limit = 100; // safety brake to prevent infinite loops
              while (i < limit) {
                const dates = alignPeriodDatesLocal(filterStartDate, periodicity);
                const scheduledDate = dates.scheduledDate;
                const pStartDate = dates.startDate;
                const pEndDate = dates.endDate;

                const title = `Preventiva ${periodicity} - ${asset.name}`;

                // --- MOTOR DE CICLO PREVENTIVO CONSTRAINTS (UNIFIED CALENDAR PERIOD CHECKS) ---
                const alreadyExists = assetOrders.some((o) => {
                  if (o.isSurvey) return false;
                  const oPeriodicity = o.periodicity || (o.title.includes('Mensal') ? 'Mensal' : o.title.includes('Semanal') ? 'Semanal' : o.title.includes('Trimestral') ? 'Trimestral' : o.title.includes('Semestral') ? 'Semestral' : o.title.includes('Anual') ? 'Anual' : '');
                  if (oPeriodicity.toLowerCase().trim() !== periodicity.toLowerCase().trim()) return false;
                  return isSamePeriodLocal(o.startDate || o.scheduledDate, scheduledDate, periodicity);
                });

                if (alreadyExists) {
                  console.log(`[Motor] Bloqueio: Ciclo ${periodicity} já gerado para o ativo ${asset.code} no período correspondente a ${scheduledDate}`);
                  i = limit;
                  continue;
                }

                const checklistItems: ChecklistItem[] = t.checklistItems
                  .filter((item) => item.isActive)
                  .map((item, idx) => ({
                    id: `ck_g_${Date.now()}_${idx}_${Math.floor(Math.random() * 1000)}`,
                    task: item.task,
                    checked: item.defaultChecked ?? false,
                    checkedAt: null,
                    observations: null,
                    criticality: item.criticality || 'Média',
                    autoCreateCorrective: item.autoCreateCorrective ?? false,
                    observationRequired: item.observationRequired ?? false,
                    responseType: item.responseType || 'three_states',
                    naObservationRequired: item.naObservationRequired ?? false
                  } as any));

                const newOS: ServiceOrder = {
                  id: (Math.floor(Math.random() * 800000) + 100000).toString(),
                  assetId: asset.id,
                  assetName: asset.name,
                  assetCode: asset.code,
                  sector: filterSector !== 'all' ? filterSector : (asset.sector || 'Geral'),
                  title: title,
                  description: `Atividade preventiva automática programada (${periodicity}). Equipamento: ${asset.name} (${asset.code}). Relacionado ao modelo versionado V${t.version || 1}.`,
                  priority: periodicity === 'Anual' ? 'Alta' : 'Média',
                  status: 'Novo',
                  scheduledDate: '',
                  startDate: pStartDate,
                  endDate: pEndDate,
                  assignedTechnician: '',
                  checklist: checklistItems,
                  notes: '',
                  signature: null,
                  signedBy: null,
                  signedAt: null,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                  photoEvidence: null,
                  periodicity: periodicity
                };

                allNewOrders.push(newOS);
                orders.unshift(newOS);
                generatedCount++;

                i = limit; // Only generate 1 instance per selected period
              }
            }
          }
        }
      }
    }

    // Sync in-memory cache and localStorage fallback for orders
    if (appendServiceOrdersCacheFn && allNewOrders.length > 0) {
      appendServiceOrdersCacheFn(allNewOrders);
    }

    // Save in batch chunks to Firebase (only if active)
    if (allNewOrders.length > 0 && firebaseActive && dbInstance) {
      try {
        const batchSize = 100;
        for (let i = 0; i < allNewOrders.length; i += batchSize) {
          const chunk = allNewOrders.slice(i, i + batchSize);
          const batch = writeBatch(dbInstance);
          for (const order of chunk) {
            batch.set(doc(dbInstance, 'serviceOrders', order.id), cleanUndefined(order));
          }
          await batch.commit();
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      } catch (err: any) {
        console.warn('Could not write batch of generated service orders to Firestore:', err);
      }
    }

    // Set 7-day deadlines for all managements
    if (allNewOrders.length > 0 && saveDeadlineFn) {
      try {
        const mans = await dbGetManagements();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        for (const m of mans) {
          await saveDeadlineFn({
            id: m.id,
            expiresAt: expiresAt
          });
        }
      } catch (err) {
        console.warn('Could not auto set deadlines for generated preventives:', err);
      }
    }

  } catch (error) {
    console.error('Error generating automated activities:', error);
  }

  return generatedCount;
}
