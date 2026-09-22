import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  where,
  writeBatch
} from 'firebase/firestore';
import { Asset, MaintenanceLog } from '../types';
import { idbGet, idbSet } from '../utils/idbCache';
import { sanitizePublicAsset, sanitizePublicLog } from '../utils/lgpdUtils';
import {
  firebaseActive,
  dbInstance,
  cleanUndefined,
  isCacheValid,
  updateCacheTimestamp,
  checkQuotaException
} from './core';
import { isMockOrLegacyId } from './templates';

// In-Memory Asset Cache
let cacheAssets: Asset[] | null = null;
let cacheAssetsFromFirebase = false;
let pendingAssetsPromise: Promise<Asset[]> | null = null;

export function clearAssetsCache(): void {
  cacheAssets = null;
  cacheAssetsFromFirebase = false;
  pendingAssetsPromise = null;
}

// Clean legacy heavy QR codes from Firestore documents in the background
async function cleanLegacyAssetQrCodesBackground(assetsWithQr: string[]): Promise<void> {
  if (!firebaseActive || !dbInstance || assetsWithQr.length === 0) return;
  try {
    const batchSize = 100;
    for (let i = 0; i < assetsWithQr.length; i += batchSize) {
      const chunk = assetsWithQr.slice(i, i + batchSize);
      const batch = writeBatch(dbInstance);
      for (const assetId of chunk) {
        batch.update(doc(dbInstance, 'assets', assetId), {
          qrCode: deleteField()
        });
      }
      await batch.commit().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    console.log(`[Firestore Optimization] Cleaned ${assetsWithQr.length} legacy QR codes from assets in Firestore.`);
  } catch (e) {
    console.warn('[Firestore Optimization] Legacy QR cleanup skipped:', e);
  }
}

// Get all assets
export async function dbGetAssets(): Promise<Asset[]> {
  const hasUser = !!(firebaseActive && dbInstance);

  // 1. Check in-memory cache
  if (cacheAssets !== null && (!hasUser || cacheAssetsFromFirebase)) {
    return [...cacheAssets];
  }

  // 2. Try retrieving from high-capacity IndexedDB cache first
  let localData: Asset[] | null = null;
  try {
    localData = await idbGet<Asset[]>('hexon_assets');
  } catch (e) {
    // IndexedDB fallback
  }

  // 3. Fallback to localStorage
  if (!localData || localData.length === 0) {
    try {
      const saved = localStorage.getItem('hexon_assets');
      if (saved) {
        localData = JSON.parse(saved).filter((item: any) => !isMockOrLegacyId(item.id));
      }
    } catch (e) {
      console.warn('Error reading assets from local storage fallback:', e);
    }
  }

  // Ensure any cached data has heavy qrCode stripped
  if (localData && localData.length > 0) {
    localData = localData.map((a: any) => {
      if (a.qrCode) delete a.qrCode;
      return a;
    });
  }

  if (isCacheValid('assets') && localData && localData.length > 0) {
    cacheAssets = localData;
    cacheAssetsFromFirebase = true;
    return [...cacheAssets];
  }

  if (pendingAssetsPromise !== null) {
    return pendingAssetsPromise;
  }

  pendingAssetsPromise = (async () => {
    if (firebaseActive && dbInstance) {
      const path = 'assets';
      try {
        const snap = await getDocs(collection(dbInstance, path));
        const list: Asset[] = [];
        const legacyQrIdsToClean: string[] = [];

        snap.forEach((docSnap) => {
          if (!isMockOrLegacyId(docSnap.id)) {
            const data = docSnap.data() as any;
            if (data.qrCode) {
              legacyQrIdsToClean.push(docSnap.id);
              delete data.qrCode; // Strip heavy base64 string immediately from memory
            }
            list.push({ id: docSnap.id, ...data } as Asset);
          }
        });

        cacheAssets = list;
        cacheAssetsFromFirebase = true;
        updateCacheTimestamp('assets');

        // Persist to IndexedDB (supports unlimited items without quota errors)
        idbSet('hexon_assets', cacheAssets).catch(() => {});

        // Safely update localStorage only if small dataset to avoid quota overflow
        try {
          if (cacheAssets.length <= 200) {
            localStorage.setItem('hexon_assets', JSON.stringify(cacheAssets));
          } else {
            localStorage.removeItem('hexon_assets');
          }
        } catch (lsErr) {
          // If 10k items exceed localStorage, IndexedDB already holds the cache safely
        }

        // Asynchronously clean legacy heavy fields from Firestore documents without blocking UI
        if (legacyQrIdsToClean.length > 0) {
          cleanLegacyAssetQrCodesBackground(legacyQrIdsToClean).catch(() => {});
        }

        pendingAssetsPromise = null;
        return [...cacheAssets];
      } catch (err: any) {
        console.warn('Could not fetch Assets from Firestore. Using local storage fallback:', err);
        checkQuotaException(err);
      }
    }

    cacheAssets = localData || [];
    cacheAssetsFromFirebase = false;
    pendingAssetsPromise = null;
    return [...cacheAssets];
  })();

  return pendingAssetsPromise;
}

// Get single asset
export async function dbGetAsset(assetId: string): Promise<Asset | null> {
  const assets = await dbGetAssets();
  return assets.find((a) => a.id === assetId) || null;
}

// SECURE PUBLIC ASSET LOOKUP (Only fetches the scanned document - no batch collection leak)
export async function dbGetSingleAssetPublic(assetIdentifier: string): Promise<Asset | null> {
  if (!assetIdentifier) return null;
  const clean = decodeURIComponent(assetIdentifier).trim();
  const cleanLower = clean.toLowerCase();
  const rawId = cleanLower.startsWith('hexon_preventiva_asset_id_')
    ? clean.substring('hexon_preventiva_asset_id_'.length).trim()
    : clean;

  if (firebaseActive && dbInstance) {
    try {
      // 1. Try direct document fetch by ID (1 read only)
      const docRef = doc(dbInstance, 'assets', rawId);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data() as any;
        if (data.qrCode) delete data.qrCode;
        return sanitizePublicAsset({ id: snap.id, ...data } as Asset);
      }

      // 2. Fallback: Search by code field with limit(1) (e.g. "AR-001" or "168548")
      const qCode = query(
        collection(dbInstance, 'assets'),
        where('code', '==', rawId),
        limit(1)
      );
      const qSnap = await getDocs(qCode);
      if (!qSnap.empty) {
        const docItem = qSnap.docs[0];
        const data = docItem.data() as any;
        if (data.qrCode) delete data.qrCode;
        return sanitizePublicAsset({ id: docItem.id, ...data } as Asset);
      }

      // 3. Fallback: Upper/lower case variations for code matching
      if (rawId !== rawId.toUpperCase()) {
        const qUpper = query(
          collection(dbInstance, 'assets'),
          where('code', '==', rawId.toUpperCase()),
          limit(1)
        );
        const qUpperSnap = await getDocs(qUpper);
        if (!qUpperSnap.empty) {
          const docItem = qUpperSnap.docs[0];
          const data = docItem.data() as any;
          if (data.qrCode) delete data.qrCode;
          return sanitizePublicAsset({ id: docItem.id, ...data } as Asset);
        }
      }
    } catch (err: any) {
      console.warn('dbGetSingleAssetPublic error querying Firestore:', err);
      checkQuotaException(err);
    }
  }

  // 4. Offline/Local fallback (checks if already in local storage, WITHOUT saving all assets)
  try {
    const saved = localStorage.getItem('hexon_assets');
    if (saved) {
      const parsed: Asset[] = JSON.parse(saved);
      const found = parsed.find(
        (a) =>
          a.id.toLowerCase() === rawId.toLowerCase() ||
          a.code.toLowerCase() === rawId.toLowerCase()
      );
      if (found) {
        const cleanFound = { ...found };
        if (cleanFound.qrCode) delete cleanFound.qrCode;
        return sanitizePublicAsset(cleanFound);
      }
    }
  } catch (e) {
    // ignore
  }

  return null;
}

// SECURE PUBLIC ASSET HISTORY (Only fetches logs belonging strictly to this single asset)
export async function dbGetAssetHistoryPublic(assetId: string): Promise<MaintenanceLog[]> {
  if (!assetId) return [];

  if (firebaseActive && dbInstance) {
    try {
      // Direct filtered query: only histories matching this specific assetId
      const q = query(
        collection(dbInstance, 'histories'),
        where('assetId', '==', assetId)
      );
      const snap = await getDocs(q);
      const list: MaintenanceLog[] = [];
      snap.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() } as MaintenanceLog);
      });

      // Sort chronologically descending (newest first) and sanitize each log for LGPD
      list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      return list.map(sanitizePublicLog);
    } catch (err: any) {
      console.warn('dbGetAssetHistoryPublic error querying Firestore:', err);
      checkQuotaException(err);
    }
  }

  // Offline/Local fallback for this asset only
  try {
    const saved = localStorage.getItem('hexon_histories');
    if (saved) {
      const parsed: MaintenanceLog[] = JSON.parse(saved);
      return parsed
        .filter((h) => h.assetId === assetId)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        .map(sanitizePublicLog);
    }
  } catch (e) {
    // ignore
  }

  return [];
}

// Save or Update asset
export async function dbSaveAsset(asset: Asset): Promise<void> {
  // Ensure cache is initialized
  if (cacheAssets === null) {
    await dbGetAssets();
  }

  // Ensure asset is lightweight: never persist base64 QR images
  const cleanAsset: Asset = { ...asset };
  if (cleanAsset.qrCode) {
    delete cleanAsset.qrCode;
  }

  // Optimistically update cache instantly
  const idx = cacheAssets!.findIndex((a) => a.id === cleanAsset.id);
  if (idx >= 0) {
    cacheAssets![idx] = { ...cleanAsset };
  } else {
    cacheAssets!.push({ ...cleanAsset });
  }

  idbSet('hexon_assets', cacheAssets).catch(() => {});
  try {
    localStorage.setItem('hexon_assets', JSON.stringify(cacheAssets));
  } catch (lsErr) {
    // Handled by IndexedDB
  }

  if (firebaseActive && dbInstance) {
    try {
      await setDoc(doc(dbInstance, 'assets', cleanAsset.id), cleanUndefined(cleanAsset));
    } catch (err: any) {
      console.warn('Firestore write asset failed, utilizing local fallback state:', err);
      checkQuotaException(err);
    }
  }
}

// Save or Update multiple assets at once (e.g. from bulk import)
export async function dbSaveAssetsBulk(assets: Asset[]): Promise<void> {
  // Ensure cache is initialized
  if (cacheAssets === null) {
    await dbGetAssets();
  }

  const cleanedAssets = assets.map((a) => {
    const clean = { ...a };
    if (clean.qrCode) delete clean.qrCode;
    return clean;
  });

  for (const asset of cleanedAssets) {
    const idx = cacheAssets!.findIndex((a) => a.id === asset.id || a.code === asset.code);
    if (idx >= 0) {
      cacheAssets![idx] = { ...cacheAssets![idx], ...asset };
    } else {
      cacheAssets!.push({ ...asset });
    }
  }

  idbSet('hexon_assets', cacheAssets).catch(() => {});
  try {
    localStorage.setItem('hexon_assets', JSON.stringify(cacheAssets));
  } catch (lsErr) {
    // Handled by IndexedDB
  }

  if (firebaseActive && dbInstance) {
    try {
      const batchSize = 100;
      for (let i = 0; i < cleanedAssets.length; i += batchSize) {
        const chunk = cleanedAssets.slice(i, i + batchSize);
        const batch = writeBatch(dbInstance);
        for (const asset of chunk) {
          batch.set(doc(dbInstance, 'assets', asset.id), cleanUndefined(asset));
        }
        await batch.commit();
        // Give the write stream queue a brief moment to process and drain
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    } catch (err: any) {
      console.warn('Firestore bulk write asset failed:', err);
      checkQuotaException(err);
    }
  }
}

// DELETE SINGLE ASSET
export async function dbDeleteAsset(assetId: string): Promise<void> {
  if (cacheAssets === null) {
    await dbGetAssets();
  }

  cacheAssets = cacheAssets!.filter((a) => a.id !== assetId);

  idbSet('hexon_assets', cacheAssets).catch(() => {});
  try {
    localStorage.setItem('hexon_assets', JSON.stringify(cacheAssets));
  } catch (lsErr) {
    // Handled by IndexedDB
  }

  if (firebaseActive && dbInstance) {
    try {
      await deleteDoc(doc(dbInstance, 'assets', assetId));
    } catch (err: any) {
      console.warn('Firestore delete asset failed:', err);
      checkQuotaException(err);
    }
  }
}

// DELETE ALL ASSETS BY SECTOR
export async function dbDeleteAssetsBySector(sectorName: string): Promise<void> {
  if (cacheAssets === null) {
    await dbGetAssets();
  }

  const isMatch = (sec: string) => {
    const s = (sec || '').toLowerCase();
    const target = sectorName.toLowerCase();

    // Normalizing synonyms in Portuguese and old types
    if (target === 'mecânica/refrigeração' || target === 'mecânica / refrigeração') {
      return s === 'mecânica/refrigeração' || s === 'mecânica / refrigeração' || s === 'hvac';
    }
    if (target === 'elétrica/eletrônica' || target === 'elétrica / eletrônica') {
      return s === 'elétrica/eletrônica' || s === 'elétrica / eletrônica' || s === 'elétrica';
    }
    if (target === 'civil') {
      return s === 'civil' || s === 'civil / predial' || s === 'hidráulica';
    }
    return s === target;
  };

  const assetsToDelete = cacheAssets!.filter((a) => isMatch(a.sector));
  cacheAssets = cacheAssets!.filter((a) => !isMatch(a.sector));

  idbSet('hexon_assets', cacheAssets).catch(() => {});
  try {
    localStorage.setItem('hexon_assets', JSON.stringify(cacheAssets));
  } catch (lsErr) {
    // Handled by IndexedDB
  }

  if (firebaseActive && dbInstance) {
    try {
      const batchSize = 100;
      for (let i = 0; i < assetsToDelete.length; i += batchSize) {
        const chunk = assetsToDelete.slice(i, i + batchSize);
        const batch = writeBatch(dbInstance);
        for (const asset of chunk) {
          batch.delete(doc(dbInstance, 'assets', asset.id));
        }
        await batch.commit();
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } catch (err: any) {
      console.warn('Could not delete batch of assets by sector in Firestore:', err);
    }
  }
}
