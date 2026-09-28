import { AssetTypeConfig, ChecklistTemplateItem, MaintenanceTemplate } from '../../types';
import { assetTypeKey } from '../../db/firebase';

// Periodicidades das vistorias (rondas): as menores que o mês
export const SURVEY_PERIODICITIES = ['Diária', 'Semanal', 'Quinzenal'] as const;

export const isNewFormat = (t: MaintenanceTemplate) => t.format === 'v2' && !!t.unit;

// Número fixo do modelo de preventiva: um só por gerência + tipo + periodicidade
export const preventiveModelId = (unit: string, assetTypeName: string, periodicity: string) =>
  `mdl_${unit}_${assetTypeKey(assetTypeName)}_${periodicity}`
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9_-]/g, '_');

export const newChecklistItem = (task = ''): ChecklistTemplateItem => ({
  id: `ck_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  task,
  isActive: true,
  defaultChecked: false,
  observationRequired: false,
  criticality: 'Média',
  autoCreateCorrective: false,
  responseType: 'three_states',
  naObservationRequired: false
});

// Periodicidades do tipo que ainda não têm modelo na gerência
export function missingPeriodicities(type: AssetTypeConfig, templates: MaintenanceTemplate[]): string[] {
  return type.periodicities.filter(
    (p) => !templates.some((t) => isNewFormat(t) && t.type === 'preventive' && t.unit === type.unit && t.periodicity === p && assetTypeKey(t.assetTypeName) === assetTypeKey(type.name))
  );
}
