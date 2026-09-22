import { collection, doc, getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { Management, Unit } from '../types';
import {
  firebaseActive,
  dbInstance,
  cleanUndefined,
  checkQuotaException,
  isCacheValid,
  updateCacheTimestamp
} from './core';

export const SEED_MANAGEMENTS: Management[] = [
  { id: 'm-0', name: 'Todas', description: 'Abrangência de atuação irrestrita' },
  { id: 'm-1', name: 'Refrigeração', description: 'Climatização, Chillers e HVAC central' },
  { id: 'm-2', name: 'Elétrica', description: 'Subestações, geradores e quadros de força' },
  { id: 'm-3', name: 'Civil', description: 'Manutenção de fachada, marcenaria e hidráulica predial' },
  { id: 'm-4', name: 'Segurança', description: 'CFTV, incêndio e cabeamento estruturado' }
];

export const SEED_UNITS: Unit[] = [
  { id: 'u-1', name: 'Sede Principal - Bloco Central', location: 'Edifício Central, Rio de Janeiro' },
  { id: 'u-2', name: 'Subsede Centro - Apoio Técnico', location: 'Av. Rio Branco 120, Rio de Janeiro' },
  { id: 'u-3', name: 'Unidade Zona Norte', location: 'Galpão Operacional Triagem, Rio de Janeiro' },
  { id: 'u-4', name: 'Unidade Zona Sul', location: 'Posto de Atendimento Copacabana, Rio de Janeiro' }
];

let cacheManagements: Management[] | null = null;
let cacheManagementsFromFirebase = false;
let pendingManagementsPromise: Promise<Management[]> | null = null;

let cacheUnits: Unit[] | null = null;
let cacheUnitsFromFirebase = false;
let pendingUnitsPromise: Promise<Unit[]> | null = null;

export function clearOrganizationCache(): void {
  cacheManagements = null;
  cacheManagementsFromFirebase = false;
  pendingManagementsPromise = null;

  cacheUnits = null;
  cacheUnitsFromFirebase = false;
  pendingUnitsPromise = null;
}

// GET MANAGEMENTS (GERENCIAS)
export async function dbGetManagements(): Promise<Management[]> {
  const hasUser = !!(firebaseActive && dbInstance);

  let localData: Management[] | null = null;
  try {
    const saved = localStorage.getItem('hexon_managements');
    if (saved) {
      localData = JSON.parse(saved);
    }
  } catch (e) {
    console.warn('Error reading managements:', e);
  }

  if (cacheManagements !== null && (!hasUser || cacheManagementsFromFirebase)) {
    return [...cacheManagements];
  }
  if (isCacheValid('managements') && localData && localData.length > 0) {
    cacheManagements = localData;
    cacheManagementsFromFirebase = true;
    return [...cacheManagements];
  }

  if (pendingManagementsPromise !== null) {
    return pendingManagementsPromise;
  }

  pendingManagementsPromise = (async () => {
    if (firebaseActive && dbInstance) {
      const path = 'managements';
      try {
        const snap = await getDocs(collection(dbInstance, path));
        const list: Management[] = [];
        snap.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...docSnap.data() } as Management);
        });
        if (list.length > 0) {
          cacheManagements = list;
          cacheManagementsFromFirebase = true;
          updateCacheTimestamp('managements');
          try {
            localStorage.setItem('hexon_managements', JSON.stringify(cacheManagements));
          } catch (lsErr) {
            console.warn('LocalStorage limit writing managements:', lsErr);
          }
          pendingManagementsPromise = null;
          return [...cacheManagements];
        }
      } catch (err: any) {
        console.warn('Could not fetch managements. using local fallback:', err);
        checkQuotaException(err);
      }
    }

    cacheManagements = localData || [...SEED_MANAGEMENTS];
    cacheManagementsFromFirebase = false;
    try {
      localStorage.setItem('hexon_managements', JSON.stringify(cacheManagements));
    } catch (lsErr) {
      console.warn('LocalStorage limit writing managements fallback:', lsErr);
    }
    pendingManagementsPromise = null;
    return [...cacheManagements];
  })();

  return pendingManagementsPromise;
}

// SAVE MANAGEMENT
export async function dbSaveManagement(man: Management): Promise<void> {
  const mans = await dbGetManagements();
  const idx = mans.findIndex(m => m.id === man.id);
  if (idx >= 0) mans[idx] = man;
  else mans.push(man);

  cacheManagements = mans;

  try {
    localStorage.setItem('hexon_managements', JSON.stringify(cacheManagements));
  } catch (lsErr) {
    console.warn('LocalStorage limit saving management:', lsErr);
  }

  if (firebaseActive && dbInstance) {
    try {
      await setDoc(doc(dbInstance, 'managements', man.id), cleanUndefined(man));
    } catch (err: any) {
      console.warn('Firestore write management failed:', err);
      checkQuotaException(err);
    }
  }
}

// DELETE MANAGEMENT
export async function dbDeleteManagement(id: string): Promise<void> {
  const mans = await dbGetManagements();
  cacheManagements = mans.filter(m => m.id !== id);

  try {
    localStorage.setItem('hexon_managements', JSON.stringify(cacheManagements));
  } catch (lsErr) {
    console.warn('LocalStorage limit deleting management:', lsErr);
  }

  if (firebaseActive && dbInstance) {
    try {
      await deleteDoc(doc(dbInstance, 'managements', id));
    } catch (err: any) {
      console.warn('Firestore delete management failed:', err);
      checkQuotaException(err);
    }
  }
}

// GET UNITS (UNIDADES)
export async function dbGetUnits(): Promise<Unit[]> {
  const hasUser = !!(firebaseActive && dbInstance);

  let localData: Unit[] | null = null;
  try {
    const saved = localStorage.getItem('hexon_units');
    if (saved) {
      localData = JSON.parse(saved);
    }
  } catch (e) {
    console.warn('Error reading units:', e);
  }

  if (cacheUnits !== null && (!hasUser || cacheUnitsFromFirebase)) {
    return [...cacheUnits];
  }
  if (isCacheValid('units') && localData && localData.length > 0) {
    cacheUnits = localData;
    cacheUnitsFromFirebase = true;
    return [...cacheUnits];
  }

  if (pendingUnitsPromise !== null) {
    return pendingUnitsPromise;
  }

  pendingUnitsPromise = (async () => {
    if (firebaseActive && dbInstance) {
      const path = 'units';
      try {
        const snap = await getDocs(collection(dbInstance, path));
        const list: Unit[] = [];
        snap.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...docSnap.data() } as Unit);
        });
        if (list.length > 0) {
          cacheUnits = list;
          cacheUnitsFromFirebase = true;
          updateCacheTimestamp('units');
          try {
            localStorage.setItem('hexon_units', JSON.stringify(cacheUnits));
          } catch (lsErr) {
            console.warn('LocalStorage limit writing units:', lsErr);
          }
          pendingUnitsPromise = null;
          return [...cacheUnits];
        }
      } catch (err: any) {
        console.warn('Could not fetch units. using local fallback:', err);
        checkQuotaException(err);
      }
    }

    cacheUnits = localData || [...SEED_UNITS];
    cacheUnitsFromFirebase = false;
    try {
      localStorage.setItem('hexon_units', JSON.stringify(cacheUnits));
    } catch (lsErr) {
      console.warn('LocalStorage limit writing units fallback:', lsErr);
    }
    pendingUnitsPromise = null;
    return [...cacheUnits];
  })();

  return pendingUnitsPromise;
}

// SAVE UNIT
export async function dbSaveUnit(unit: Unit): Promise<void> {
  const list = await dbGetUnits();
  const idx = list.findIndex(u => u.id === unit.id);
  if (idx >= 0) list[idx] = unit;
  else list.push(unit);

  cacheUnits = list;

  try {
    localStorage.setItem('hexon_units', JSON.stringify(cacheUnits));
  } catch (lsErr) {
    console.warn('LocalStorage limit saving unit:', lsErr);
  }

  if (firebaseActive && dbInstance) {
    try {
      await setDoc(doc(dbInstance, 'units', unit.id), cleanUndefined(unit));
    } catch (err: any) {
      console.warn('Firestore write unit failed:', err);
      checkQuotaException(err);
    }
  }
}

// DELETE UNIT
export async function dbDeleteUnit(id: string): Promise<void> {
  const list = await dbGetUnits();
  cacheUnits = list.filter(u => u.id !== id);

  try {
    localStorage.setItem('hexon_units', JSON.stringify(cacheUnits));
  } catch (lsErr) {
    console.warn('LocalStorage limit deleting unit:', lsErr);
  }

  if (firebaseActive && dbInstance) {
    try {
      await deleteDoc(doc(dbInstance, 'units', id));
    } catch (err: any) {
      console.warn('Firestore delete unit failed:', err);
      checkQuotaException(err);
    }
  }
}
