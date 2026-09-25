import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch
} from 'firebase/firestore';
import { Address, Asset, MaintenanceLog } from '../types';
import { idbGet, idbSet } from '../utils/idbCache';
import { sanitizePublicAsset, sanitizePublicLog } from '../utils/lgpdUtils';
import {
  firebaseActive,
  dbInstance,
  cleanUndefined,
  isCacheValid,
  updateCacheTimestamp,
  checkQuotaException,
  ensureFirebaseAuthReady
} from './core';
import { isMockOrLegacyId } from './templates';
import { addressToAssetItem } from './addresses';
import {
  canUseAssetSync,
  ensureAssetSync,
  getLocalAssets,
  stopAssetSync,
  upsertLocalAssets,
  removeLocalAssets
} from './assetSync';

// In-Memory Asset Cache
let cacheAssets: Asset[] | null = null;
let cacheAssetsFromFirebase = false;
let pendingAssetsPromise: Promise<Asset[]> | null = null;

export function clearAssetsCache(): void {
  cacheAssets = null;
  cacheAssetsFromFirebase = false;
  pendingAssetsPromise = null;
  stopAssetSync();
}

// Atualiza a cópia antiga (modo sem login) SOMENTE se já estiver carregada; nunca baixa a coleção para gravar 1 ativo
function updateLoadedAssetsCache(change: (list: Asset[]) => Asset[]): void {
  if (cacheAssets === null) return;
  cacheAssets = change(cacheAssets);
  idbSet('hexon_assets', cacheAssets).catch(() => {});
}

// Get all assets
export async function dbGetAssets(): Promise<Asset[]> {
  // Usuário logado: cópia local sincronizada (baixa tudo 1 vez por aparelho; depois só o que muda)
  if (canUseAssetSync()) {
    try {
      await ensureAssetSync();
      return getLocalAssets();
    } catch (e) {
      console.warn('Cópia local de ativos indisponível; usando leitura direta:', e);
    }
  }

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

        snap.forEach((docSnap) => {
          if (!isMockOrLegacyId(docSnap.id)) {
            const data = docSnap.data() as any;
            if (data.qrCode) {
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

        // Note: Heavy base64 QR codes are already stripped from memory on line 121.
        // We avoid triggering remote batch write updates to eliminate write quota consumption.

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

  // QR Code de endereço (imóvel): "addr:END-015" -> lê o cadastro de Endereços
  if (rawId.toLowerCase().startsWith('addr:') && firebaseActive && dbInstance) {
    try {
      await ensureFirebaseAuthReady(2000);
      const snap = await getDoc(doc(dbInstance, 'addresses', rawId.substring(5).trim()));
      return snap.exists() ? addressToAssetItem({ id: snap.id, ...snap.data() } as Address) : null;
    } catch (err: any) {
      console.warn('Endereço do QR Code não pôde ser lido:', err);
      return null;
    }
  }

  if (firebaseActive && dbInstance) {
    try {
      // Ensure Firebase anonymous authentication has connected
      await ensureFirebaseAuthReady(2000);

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

      // 4. Fallback: Match by specs.PATRIMONIO in case code was registered under specs
      const qPatrimonio = query(
        collection(dbInstance, 'assets'),
        where('specs.PATRIMONIO', '==', rawId),
        limit(1)
      );
      const qPatrimonioSnap = await getDocs(qPatrimonio);
      if (!qPatrimonioSnap.empty) {
        const docItem = qPatrimonioSnap.docs[0];
        const data = docItem.data() as any;
        if (data.qrCode) delete data.qrCode;
        return sanitizePublicAsset({ id: docItem.id, ...data } as Asset);
      }
    } catch (err: any) {
      console.warn('dbGetSingleAssetPublic error querying Firestore:', err);
      checkQuotaException(err);
    }
  }

  // 5. Offline/Local fallback (checks if already in local storage, WITHOUT saving all assets)
  try {
    const saved = localStorage.getItem('hexon_assets');
    if (saved) {
      const parsed: Asset[] = JSON.parse(saved);
      const found = parsed.find(
        (a) =>
          a.id.toLowerCase() === rawId.toLowerCase() ||
          a.code.toLowerCase() === rawId.toLowerCase() ||
          (a.specs?.PATRIMONIO && String(a.specs.PATRIMONIO).toLowerCase() === rawId.toLowerCase())
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
      await ensureFirebaseAuthReady(1500);

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

// TARGETED ASSET SEARCH: Queries exclusively the filtered items from Firestore (avoids downloading 10,000 assets)
export interface AssetSearchCriteria {
  codeOrPatrimonio?: string;
  sector?: string;
  unitOrComarca?: string;
  tipo?: string;
  limitResults?: number;
}

export async function dbSearchAssetsTargeted(criteria: AssetSearchCriteria): Promise<Asset[]> {
  const { codeOrPatrimonio, sector, unitOrComarca, tipo, limitResults = 50 } = criteria;
  const cleanCode = (codeOrPatrimonio || '').trim();

  // If code / patrimonio is specified, perform 1-doc exact query
  if (cleanCode) {
    const single = await dbGetSingleAssetPublic(cleanCode);
    if (single) return [single];
  }

  if (firebaseActive && dbInstance) {
    try {
      const constraints: any[] = [];
      if (sector && sector !== 'Todos' && sector !== 'Todas') {
        constraints.push(where('sector', '==', sector));
      }
      if (tipo && tipo !== 'Todos') {
        constraints.push(where('specs.TIPO', '==', tipo));
      }

      constraints.push(limit(limitResults));

      const q = query(collection(dbInstance, 'assets'), ...constraints);
      const snap = await getDocs(q);
      const list: Asset[] = [];
      snap.forEach((d) => {
        if (!isMockOrLegacyId(d.id)) {
          const data = d.data() as any;
          if (data.qrCode) delete data.qrCode;
          list.push({ id: d.id, ...data } as Asset);
        }
      });

      // Secondary client-side refinement for composite fields if needed
      let result = list;
      if (unitOrComarca && unitOrComarca !== 'Todas' && unitOrComarca !== 'Todos') {
        const uLower = unitOrComarca.toLowerCase();
        result = result.filter(a => {
          const com = String(a.specs?.COMARCA || a.specs?.comarca || '').toLowerCase();
          const cra = String(a.specs?.CRAAI || a.specs?.craai || '').toLowerCase();
          const loc = String(a.location || '').toLowerCase();
          return com.includes(uLower) || cra.includes(uLower) || loc.includes(uLower);
        });
      }

      return result;
    } catch (err: any) {
      console.warn('dbSearchAssetsTargeted error:', err);
      checkQuotaException(err);
    }
  }

  // Fallback to local cache if offline
  try {
    const saved = localStorage.getItem('hexon_assets');
    if (saved) {
      const parsed: Asset[] = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return parsed.filter(a => {
          if (cleanCode) {
            const matchesCode = a.code.toLowerCase().includes(cleanCode.toLowerCase());
            const matchesId = a.id.toLowerCase().includes(cleanCode.toLowerCase());
            if (!matchesCode && !matchesId) return false;
          }
          if (sector && sector !== 'Todos' && sector !== 'Todas' && a.sector !== sector) return false;
          return true;
        }).slice(0, limitResults);
      }
    }
  } catch (e) {}

  return [];
}

// Save or Update asset
// Toda gravação leva syncAt (horário do servidor): é por ele que os outros computadores recebem a alteração.
export async function dbSaveAsset(asset: Asset): Promise<void> {
  // Ensure asset is lightweight: never persist base64 QR images
  const cleanAsset: Asset = { ...asset };
  if (cleanAsset.qrCode) {
    delete cleanAsset.qrCode;
  }

  upsertLocalAssets([cleanAsset]);
  updateLoadedAssetsCache((list) => {
    const idx = list.findIndex((a) => a.id === cleanAsset.id);
    return idx >= 0 ? list.map((a, i) => (i === idx ? { ...cleanAsset } : a)) : [...list, { ...cleanAsset }];
  });

  if (firebaseActive && dbInstance) {
    try {
      await setDoc(doc(dbInstance, 'assets', cleanAsset.id), { ...cleanUndefined(cleanAsset), syncAt: serverTimestamp() });
    } catch (err: any) {
      console.warn('Firestore write asset failed, utilizing local fallback state:', err);
      checkQuotaException(err);
    }
  }
}

// Save or Update multiple assets at once (e.g. from bulk import)
export async function dbSaveAssetsBulk(assets: Asset[]): Promise<void> {
  const cleanedAssets = assets.map((a) => {
    const clean = { ...a };
    if (clean.qrCode) delete clean.qrCode;
    return clean;
  });

  upsertLocalAssets(cleanedAssets);
  updateLoadedAssetsCache((list) => {
    const next = [...list];
    for (const asset of cleanedAssets) {
      const idx = next.findIndex((a) => a.id === asset.id);
      if (idx >= 0) next[idx] = { ...next[idx], ...asset };
      else next.push({ ...asset });
    }
    return next;
  });

  if (firebaseActive && dbInstance) {
    try {
      const batchSize = 100;
      for (let i = 0; i < cleanedAssets.length; i += batchSize) {
        const chunk = cleanedAssets.slice(i, i + batchSize);
        const batch = writeBatch(dbInstance);
        for (const asset of chunk) {
          batch.set(doc(dbInstance, 'assets', asset.id), { ...cleanUndefined(asset), syncAt: serverTimestamp() });
        }
        await batch.commit();
        // Give the write stream queue a brief moment to process and drain
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    } catch (err: any) {
      console.warn('Firestore bulk write asset failed:', err);
      checkQuotaException(err);
      throw err;
    }
  }
}

// Exclui ativos e registra cada exclusão em assetDeletions (os outros computadores tiram da cópia local)
async function deleteAssetsWithRecord(ids: string[]): Promise<void> {
  removeLocalAssets(ids);
  const idSet = new Set(ids);
  updateLoadedAssetsCache((list) => list.filter((a) => !idSet.has(a.id)));

  if (firebaseActive && dbInstance) {
    try {
      const pairSize = 200; // 200 exclusões + 200 registros = 400 operações por lote
      for (let i = 0; i < ids.length; i += pairSize) {
        const batch = writeBatch(dbInstance);
        ids.slice(i, i + pairSize).forEach((id) => {
          batch.delete(doc(dbInstance!, 'assets', id));
          batch.set(doc(dbInstance!, 'assetDeletions', id), { assetId: id, syncAt: serverTimestamp() });
        });
        await batch.commit();
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } catch (err: any) {
      console.warn('Firestore delete asset failed:', err);
      checkQuotaException(err);
      throw err;
    }
  }
}

// DELETE SINGLE ASSET
export async function dbDeleteAsset(assetId: string): Promise<void> {
  await deleteAssetsWithRecord([assetId]);
}

// DELETE ALL ASSETS BY SECTOR
export async function dbDeleteAssetsBySector(sectorName: string): Promise<void> {
  const target = sectorName.toLowerCase();
  const isMatch = (sec: string) => {
    const s = (sec || '').toLowerCase();

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

  // A lista vem da cópia local (sem nova leitura da coleção)
  const all = await dbGetAssets();
  await deleteAssetsWithRecord(all.filter((a) => isMatch(a.sector)).map((a) => a.id));
}
