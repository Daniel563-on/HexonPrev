// templateScheduler.ts - Pure date calculation, scheduling alignment and asset-template compatibility utilities
import { Asset, MaintenanceTemplate } from '../types';

export function getYearWeekLocal(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  const tempDate = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = tempDate.getUTCDay() || 7;
  tempDate.setUTCDate(tempDate.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tempDate.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((tempDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${tempDate.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function getQuarterLocal(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()}-Q${q}`;
}

export function getSemesterLocal(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  const s = Math.floor(d.getMonth() / 6) + 1;
  return `${d.getFullYear()}-S${s}`;
}

export function isSamePeriod(dateAStr: string, dateBStr: string, periodicity: string): boolean {
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

export function getPeriodKey(dateStr: string, periodicity: string): string {
  if (!dateStr) return '';
  const p = periodicity || '';
  if (p === 'Semanal') {
    return getYearWeekLocal(dateStr);
  }
  if (p === 'Mensal') {
    return dateStr.slice(0, 7);
  }
  if (p === 'Trimestral') {
    return getQuarterLocal(dateStr);
  }
  if (p === 'Semestral') {
    return getSemesterLocal(dateStr);
  }
  if (p === 'Anual') {
    return dateStr.slice(0, 4);
  }
  return dateStr;
}

export const getAssetComarcaClean = (asset: Asset): string => {
  const c = asset.specs?.COMARCA || asset.specs?.comarca || (asset.location && asset.location.includes(' - ') ? asset.location.split(' - ')[0] : asset.location) || '';
  return c.trim();
};

export const isAssetCompatibleWithTemplate = (asset: Asset, t: MaintenanceTemplate): boolean => {
  // Ativo baixado não recebe novas preventivas
  if (asset.status === 'Baixado') return false;
  if (t.type !== 'preventive') return false;
  const tAssetType = (t.targetAssetType || '').toLowerCase().trim();
  const assetTipoSpec = (asset.specs?.TIPO || asset.specs?.tipo || '').toLowerCase().trim();
  const tSector = (t.targetSectorOrType || '').toLowerCase().trim();
  const assetSector = (asset.sector || '').toLowerCase().trim();

  if (tAssetType && assetTipoSpec) {
    if (!assetTipoSpec.includes(tAssetType) && !tAssetType.includes(assetTipoSpec)) {
      return false;
    }
  } else if (tAssetType && !assetTipoSpec) {
    const assetName = (asset.name || '').toLowerCase();
    if (!assetName.includes(tAssetType)) return false;
  } else if (!tAssetType && tSector) {
    if (assetSector !== tSector) return false;
  }

  const tPeriodicities = (t.periodicity || '').split(',').map((p) => p.trim());
  const activePeriodicities = asset.periodicities || [];
  const commonPeriodicities = activePeriodicities.filter((ap) =>
    tPeriodicities.some((tp) => tp.toLowerCase() === ap.toLowerCase())
  );
  return commonPeriodicities.length > 0;
};

export const defaultScopeInfo: {
  eligibleComarcas: { comarca: string; pendingCount: number }[];
  totalComarcaPending: number;
  eligibleSectors: { sector: string; pendingCount: number }[];
  totalSectorPending: number;
} = {
  eligibleComarcas: [],
  totalComarcaPending: 0,
  eligibleSectors: [],
  totalSectorPending: 0
};

export function alignPeriodDates(baseDateStr: string, periodicity: string): { startDate: string; endDate: string; scheduledDate: string } {
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
