import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { MaintenanceTemplate } from '../types';
import {
  firebaseActive,
  dbInstance,
  cleanUndefined,
  checkQuotaException,
  isCacheValid,
  updateCacheTimestamp
} from './core';

export function isMockOrLegacyId(id: string): boolean {
  if (!id) return false;
  const legacyIds = [
    'as_chiller_01', 'as_qgbt_01', 'as_bomba_02', 'as_elev_03', 'as_elevador_01',
    '28941', '28942', '28943', '28944', '28890',
    'hist_mock_01', 'hist_mock_02', 'hist_mock_03', 'hist_1', 'hist_2', 'hist_3', 'hist_4',
    'ck_1', 'ck_2', 'ck_3', 'ck_4', 'ck_5', 'ck_6', 'ck_e1', 'ck_e2', 'ck_e3', 'ck_e4', 'ck_h1', 'ck_h2', 'ck_h3', 'ck_h4'
  ];
  if (legacyIds.includes(id)) return true;
  if (id.startsWith('tmp_') && (
    id.includes('hvac') || id.includes('elet') || id.includes('hidr') || id.includes('civ') || id.includes('vist') || id.includes('preset')
  )) {
    return true;
  }
  return false;
}

export const DEFAULT_TEMPLATES: MaintenanceTemplate[] = [];

let cacheTemplates: MaintenanceTemplate[] | null = null;
let cacheTemplatesFromFirebase = false;
let pendingTemplatesPromise: Promise<MaintenanceTemplate[]> | null = null;

export function clearTemplatesCache(): void {
  cacheTemplates = null;
  cacheTemplatesFromFirebase = false;
  pendingTemplatesPromise = null;
}

// GET ALL CHECKLIST/MAINTENANCE TEMPLATES
export async function dbGetTemplates(): Promise<MaintenanceTemplate[]> {
  const hasUser = !!(firebaseActive && dbInstance);

  // Try retrieving from local storage fallback first
  let localData: MaintenanceTemplate[] | null = null;
  try {
    const saved = localStorage.getItem('hexon_templates');
    if (saved) {
      localData = JSON.parse(saved);
    }
  } catch (e) {
    console.warn('Error reading templates from local storage fallback:', e);
  }

  // Check if in-memory cache OR local storage cache is valid
  if (cacheTemplates !== null && (!hasUser || cacheTemplatesFromFirebase)) {
    return [...cacheTemplates];
  }
  if (isCacheValid('templates') && localData && localData.length > 0) {
    cacheTemplates = localData;
    cacheTemplatesFromFirebase = true;
    return [...cacheTemplates];
  }

  if (pendingTemplatesPromise !== null) {
    return pendingTemplatesPromise;
  }

  pendingTemplatesPromise = (async () => {
    if (firebaseActive && dbInstance) {
      const path = 'templates';
      try {
        const snap = await getDocs(collection(dbInstance, path));
        const list: MaintenanceTemplate[] = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data();
          if (!data.deleted && !isMockOrLegacyId(docSnap.id)) {
            list.push({ id: docSnap.id, ...data } as MaintenanceTemplate);
          }
        });
        cacheTemplates = list;
        cacheTemplatesFromFirebase = true;
        updateCacheTimestamp('templates');
        try {
          localStorage.setItem('hexon_templates', JSON.stringify(cacheTemplates));
        } catch (lsErr) {
          console.warn('LocalStorage limit writing templates:', lsErr);
        }
        pendingTemplatesPromise = null;
        return [...cacheTemplates];
      } catch (err: any) {
        console.warn('Could not fetch templates from Firestore. Using local fallback:', err);
        checkQuotaException(err);
      }
    }

    cacheTemplates = localData || [];
    cacheTemplatesFromFirebase = false;
    try {
      localStorage.setItem('hexon_templates', JSON.stringify(cacheTemplates));
    } catch (lsErr) {
      console.warn('LocalStorage limit writing templates fallback:', lsErr);
    }
    pendingTemplatesPromise = null;
    return [...cacheTemplates];
  })();

  return pendingTemplatesPromise;
}

// SAVE OR UPDATE TEMPLATE
export async function dbSaveTemplate(template: MaintenanceTemplate): Promise<void> {
  if (cacheTemplates === null) {
    await dbGetTemplates();
  }

  const idx = cacheTemplates!.findIndex((t) => t.id === template.id);
  if (idx >= 0) {
    cacheTemplates![idx] = { ...template };
  } else {
    cacheTemplates!.push({ ...template });
  }

  try {
    localStorage.setItem('hexon_templates', JSON.stringify(cacheTemplates));
  } catch (lsErr) {
    console.warn('LocalStorage limit saving template:', lsErr);
  }

  if (firebaseActive && dbInstance) {
    try {
      await setDoc(doc(dbInstance, 'templates', template.id), cleanUndefined(template));
    } catch (err: any) {
      console.warn('Firestore write template failed:', err);
      checkQuotaException(err);
    }
  }
}

// DELETE TEMPLATE
export async function dbDeleteTemplate(templateId: string): Promise<void> {
  if (cacheTemplates === null) {
    await dbGetTemplates();
  }

  cacheTemplates = cacheTemplates!.filter((t) => t.id !== templateId);

  try {
    localStorage.setItem('hexon_templates', JSON.stringify(cacheTemplates));
  } catch (lsErr) {
    console.warn('LocalStorage limit deleting template:', lsErr);
  }

  if (firebaseActive && dbInstance) {
    try {
      await setDoc(doc(dbInstance, 'templates', templateId), cleanUndefined({ deleted: true }));
    } catch (err: any) {
      console.warn('Firestore delete template failed:', err);
      checkQuotaException(err);
    }
  }
}
