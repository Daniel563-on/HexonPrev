import { collection, doc, getDocs, setDoc, deleteDoc } from './guard';
import { Management, Unit } from '../types';
import {
  firebaseActive,
  dbInstance,
  cleanUndefined,
  checkQuotaException,
  isCacheValid,
  updateCacheTimestamp
} from './core';

// Sem gerências/unidades de exemplo: o que existe é só o que está no banco (cadastradas pelo Super Administrador).
// (Antes o sistema criava "Refrigeração, Elétrica, Civil, Segurança" e unidades fictícias quando a lista estava vazia.)

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
        // Banco respondeu: vale o que veio, mesmo vazio
        {
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

    cacheManagements = localData || [];
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
        // Banco respondeu: vale o que veio, mesmo vazio
        {
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

    cacheUnits = localData || [];
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
