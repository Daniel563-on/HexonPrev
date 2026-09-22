import { collection, doc, getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { SavedQrTemplate } from '../types';
import { DEFAULT_SAVED_TEMPLATES } from '../utils/qrDefaults';
import {
  firebaseActive,
  dbInstance,
  cleanUndefined,
  checkQuotaException,
  isCacheValid,
  updateCacheTimestamp
} from './core';

// In-Memory cache for fast local responses
let cacheQrTemplates: SavedQrTemplate[] | null = null;
let cacheQrTemplatesFromFirebase = false;
let pendingQrTemplatesPromise: Promise<SavedQrTemplate[]> | null = null;

export function clearQrTemplatesCache(): void {
  cacheQrTemplates = null;
  cacheQrTemplatesFromFirebase = false;
  pendingQrTemplatesPromise = null;
}

export async function dbGetQrTemplates(): Promise<SavedQrTemplate[]> {
  const hasUser = !!(firebaseActive && dbInstance);

  let localData: SavedQrTemplate[] | null = null;
  try {
    const saved = localStorage.getItem('hexon_saved_qr_templates_v2');
    if (saved) {
      localData = JSON.parse(saved);
    }
  } catch (e) {
    console.warn('Error reading local qr templates:', e);
  }

  if (cacheQrTemplates !== null && (!hasUser || cacheQrTemplatesFromFirebase)) {
    return [...cacheQrTemplates];
  }

  if (isCacheValid('qrTemplates') && localData && localData.length > 0) {
    cacheQrTemplates = localData;
    cacheQrTemplatesFromFirebase = true;
    return [...cacheQrTemplates];
  }

  if (pendingQrTemplatesPromise !== null) {
    return pendingQrTemplatesPromise;
  }

  pendingQrTemplatesPromise = (async () => {
    if (firebaseActive && dbInstance) {
      try {
        const snap = await getDocs(collection(dbInstance, 'qrTemplates'));
        const list: SavedQrTemplate[] = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data();
          if (!data.deleted) {
            list.push({ id: docSnap.id, ...data } as SavedQrTemplate);
          }
        });

        // Se o banco estiver vazio na primeira vez, semeia os modelos padrão para a nuvem
        if (list.length === 0) {
          console.log('[Firestore] Inicializando modelos de QR Code padrão no banco de dados em nuvem...');
          for (const tpl of DEFAULT_SAVED_TEMPLATES) {
            try {
              await setDoc(doc(dbInstance, 'qrTemplates', tpl.id), cleanUndefined(tpl));
              list.push(tpl);
            } catch (seedErr) {
              console.warn('Erro ao inicializar modelo padrão no firestore:', seedErr);
            }
          }
        }

        // Ordenação estável por data de criação descrescente
        list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

        cacheQrTemplates = list;
        cacheQrTemplatesFromFirebase = true;
        updateCacheTimestamp('qrTemplates');
        try {
          localStorage.setItem('hexon_saved_qr_templates_v2', JSON.stringify(cacheQrTemplates));
        } catch (lsErr) {
          console.warn('LocalStorage limit writing qr templates:', lsErr);
        }
        pendingQrTemplatesPromise = null;
        return [...cacheQrTemplates];
      } catch (err: any) {
        console.warn('Could not fetch qrTemplates from Firestore. Using local fallback:', err);
        checkQuotaException(err);
      }
    }

    cacheQrTemplates = localData && localData.length > 0 ? localData : [...DEFAULT_SAVED_TEMPLATES];
    cacheQrTemplatesFromFirebase = false;
    try {
      localStorage.setItem('hexon_saved_qr_templates_v2', JSON.stringify(cacheQrTemplates));
    } catch (lsErr) {
      console.warn('LocalStorage limit writing fallback qr templates:', lsErr);
    }
    pendingQrTemplatesPromise = null;
    return [...cacheQrTemplates];
  })();

  return pendingQrTemplatesPromise;
}

export async function dbSaveQrTemplate(template: SavedQrTemplate): Promise<void> {
  if (cacheQrTemplates === null) {
    await dbGetQrTemplates();
  }

  const current = cacheQrTemplates || [];
  const idx = current.findIndex((t) => t.id === template.id);
  if (idx >= 0) {
    current[idx] = { ...template };
  } else {
    current.unshift({ ...template });
  }
  cacheQrTemplates = [...current];

  try {
    localStorage.setItem('hexon_saved_qr_templates_v2', JSON.stringify(cacheQrTemplates));
  } catch (lsErr) {
    console.warn('LocalStorage limit saving qr template:', lsErr);
  }

  if (firebaseActive && dbInstance) {
    try {
      await setDoc(doc(dbInstance, 'qrTemplates', template.id), cleanUndefined(template));
      console.log(`[Firestore] Modelo de etiqueta "${template.name}" salvo no banco de dados com sucesso!`);
    } catch (err: any) {
      console.error('Firestore write qrTemplate failed:', err);
      checkQuotaException(err);
      throw err;
    }
  }
}

export async function dbDeleteQrTemplate(templateId: string): Promise<void> {
  if (cacheQrTemplates === null) {
    await dbGetQrTemplates();
  }

  if (cacheQrTemplates) {
    cacheQrTemplates = cacheQrTemplates.filter((t) => t.id !== templateId);
  }

  try {
    localStorage.setItem('hexon_saved_qr_templates_v2', JSON.stringify(cacheQrTemplates || []));
  } catch (lsErr) {
    console.warn('LocalStorage limit deleting qr template:', lsErr);
  }

  if (firebaseActive && dbInstance) {
    try {
      await deleteDoc(doc(dbInstance, 'qrTemplates', templateId));
      console.log(`[Firestore] Modelo de etiqueta "${templateId}" excluído do banco de dados!`);
    } catch (err: any) {
      console.error('Firestore delete qrTemplate failed:', err);
      checkQuotaException(err);
      throw err;
    }
  }
}
