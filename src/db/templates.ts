import { deleteDoc, doc, serverTimestamp, setDoc } from './guard';
import { MaintenanceTemplate } from '../types';
import { firebaseActive, dbInstance, cleanUndefined, checkQuotaException } from './core';
import { markSyncStale, syncedList, syncTombstone } from './localSync';

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

// MODELOS DE PREVENTIVA: cópia guardada no aparelho (src/db/localSync.ts) — baixa todos 1 vez e depois só o que mudou
// (antes, todo aparelho baixava todos os modelos a cada 12 h, com os PDFs mapeados junto).
// Toda gravação leva syncAt; excluir registra em syncDeletions.

// A cópia antiga ficava no armazenamento do navegador (com os PDFs): libera o espaço
try {
  localStorage.removeItem('hexon_templates');
} catch {
  /* sem armazenamento */
}

export function clearTemplatesCache(): void {
  markSyncStale('templates');
}

// GET ALL CHECKLIST/MAINTENANCE TEMPLATES
// forceFresh: confere agora o que mudou (tela de Modelos e Disparo: o disparo nunca pode usar um modelo desatualizado)
export async function dbGetTemplates(forceFresh = false): Promise<MaintenanceTemplate[]> {
  if (!firebaseActive || !dbInstance) return [];
  const list = await syncedList<MaintenanceTemplate & { deleted?: boolean }>('templates', '*', [], forceFresh);
  return list.filter((t) => !t.deleted && !isMockOrLegacyId(t.id));
}

// SAVE OR UPDATE TEMPLATE
export async function dbSaveTemplate(template: MaintenanceTemplate): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  try {
    await setDoc(doc(dbInstance, 'templates', template.id), { ...cleanUndefined(template), syncAt: serverTimestamp() });
    markSyncStale('templates');
  } catch (err: any) {
    console.warn('Firestore write template failed:', err);
    checkQuotaException(err);
    throw new Error('Não foi possível gravar o modelo no banco (verifique sua permissão).');
  }
}

// DELETE TEMPLATE
export async function dbDeleteTemplate(templateId: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  try {
    await deleteDoc(doc(dbInstance, 'templates', templateId));
    await syncTombstone('templates', '*', templateId); // os aparelhos apagam a cópia local
    markSyncStale('templates');
  } catch (err: any) {
    console.warn('Firestore delete template failed:', err);
    checkQuotaException(err);
    throw new Error('Não foi possível excluir o modelo (só quem tem a permissão "Excluir Modelos").');
  }
}
