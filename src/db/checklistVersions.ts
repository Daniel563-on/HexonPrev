import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ChecklistAnswer, ChecklistItem, MaintenanceTemplate, ServiceOrder, TemplateVersionSnapshot } from '../types';
import { idbGet, idbSet } from '../utils/idbCache';
import { firebaseActive, dbInstance, cleanUndefined, checkQuotaException } from './core';

// CHECKLIST ENXUTO (1.2)
// A OS nova não guarda o texto do checklist: guarda o modelo + versão (templateId/templateVersion) e só as respostas.
// O texto vem da versão congelada do modelo (coleção "templateVersions"), baixada 1 vez por aparelho.
// - hydrateOrder: monta o checklist completo na memória (o resto do sistema continua usando order.checklist).
// - toStoredOrder: caminho inverso na gravação (tira o checklist e grava só as respostas).

export const versionIdOf = (templateId: string, version: number) => `${templateId}__v${version}`;

const cache = new Map<string, TemplateVersionSnapshot>();
const loading = new Map<string, Promise<TemplateVersionSnapshot | null>>();
const loadedListeners = new Set<() => void>();
const idbKey = (id: string) => `hexon_tplver_v1_${id}`;

// Telas com lista em tempo real: avisadas quando chega uma versão que faltava (para montar o checklist)
export function onChecklistVersionLoaded(cb: () => void): () => void {
  loadedListeners.add(cb);
  return () => {
    loadedListeners.delete(cb);
  };
}

export function loadChecklistVersion(id: string): Promise<TemplateVersionSnapshot | null> {
  const cached = cache.get(id);
  if (cached) return Promise.resolve(cached);
  let p = loading.get(id);
  if (!p) {
    p = (async () => {
      const local = await idbGet<TemplateVersionSnapshot>(idbKey(id)).catch(() => undefined);
      if (local && local.items) {
        cache.set(id, local);
        return local;
      }
      if (!firebaseActive || !dbInstance) return null;
      try {
        const snap = await getDoc(doc(dbInstance, 'templateVersions', id));
        if (!snap.exists()) return null;
        const v = { ...(snap.data() as TemplateVersionSnapshot), id };
        cache.set(id, v);
        idbSet(idbKey(id), v).catch(() => {});
        return v;
      } catch (err: any) {
        console.warn('Não foi possível baixar a versão do modelo:', err);
        checkQuotaException(err);
        return null;
      }
    })();
    loading.set(id, p);
    p.then((v) => {
      loading.delete(id);
      if (v) loadedListeners.forEach((cb) => cb());
    });
  }
  return p;
}

const needsVersion = (o: ServiceOrder) => o.checklistFormat === 2 && !!o.templateId && !!o.templateVersion;

// Baixa (se faltar) as versões usadas pelas OS. Para as buscas que devolvem a lista de uma vez.
export async function ensureChecklistVersions(orders: ServiceOrder[]): Promise<void> {
  const ids = new Set<string>();
  orders.forEach((o) => {
    if (needsVersion(o)) ids.add(versionIdOf(o.templateId!, o.templateVersion!));
  });
  await Promise.all(Array.from(ids).map((id) => loadChecklistVersion(id)));
}

// Monta o checklist completo na memória. Sem a versão ainda: checklist vazio + checklistPending (não salvar).
export function hydrateOrder(o: ServiceOrder): ServiceOrder {
  if (!needsVersion(o)) return o;
  const id = versionIdOf(o.templateId!, o.templateVersion!);
  const v = cache.get(id);
  if (!v) {
    loadChecklistVersion(id);
    return { ...o, checklist: [], checklistPending: true };
  }
  const answers = o.answers || {};
  const checklist: ChecklistItem[] = v.items.map((it, idx) => {
    const a: ChecklistAnswer = answers[String(idx)] || {};
    return {
      id: String(idx),
      task: it.task,
      checked: a.c ?? it.defaultChecked ?? false,
      checkedAt: a.t ?? null,
      observations: a.o ?? null,
      statusCheck: a.s,
      criticality: it.criticality || 'Média',
      responseType: it.responseType || 'three_states',
      observationRequired: it.observationRequired ?? false,
      naObservationRequired: it.naObservationRequired ?? false,
      autoCreateCorrective: it.autoCreateCorrective ?? false,
      autoCorrectiveAnswer: a.ca,
      autoCorrectiveStatus: a.cs
    } as ChecklistItem;
  });
  return { ...o, checklist, checklistPending: false };
}

export function hydrateOrders(list: ServiceOrder[]): ServiceOrder[] {
  return list.map(hydrateOrder);
}

// Respostas a partir do checklist montado (grava só o que foi respondido)
function answersFromChecklist(o: ServiceOrder): Record<string, ChecklistAnswer> {
  const out: Record<string, ChecklistAnswer> = {};
  const v = o.templateId && o.templateVersion ? cache.get(versionIdOf(o.templateId, o.templateVersion)) : undefined;
  (o.checklist || []).forEach((item, idx) => {
    const key = String(idx);
    const def = v?.items[idx]?.defaultChecked ?? false;
    const a: ChecklistAnswer = {};
    if (item.checked !== def) a.c = item.checked;
    if (item.checkedAt) a.t = item.checkedAt;
    if (item.observations) a.o = item.observations;
    if (item.statusCheck) a.s = item.statusCheck;
    if (item.autoCorrectiveAnswer) a.ca = item.autoCorrectiveAnswer;
    if (item.autoCorrectiveStatus) a.cs = item.autoCorrectiveStatus;
    if (Object.keys(a).length > 0) out[key] = a;
  });
  return out;
}

// Documento que vai para o banco: no formato enxuto, sem o checklist (só as respostas).
// Com a versão ainda não baixada (checklistPending), mantém as respostas que já estavam na OS.
export function toStoredOrder(o: ServiceOrder): ServiceOrder {
  if (o.checklistFormat !== 2) {
    const { checklistPending, ...rest } = o;
    return rest as ServiceOrder;
  }
  const answers = o.checklistPending || !o.checklist || o.checklist.length === 0 ? o.answers || {} : answersFromChecklist(o);
  const { checklist, checklistPending, ...rest } = o;
  return { ...rest, answers } as ServiceOrder;
}

// Disparo: garante que a versão do modelo usada esteja congelada (1 gravação por versão, não por OS)
export async function dbEnsureTemplateVersion(model: MaintenanceTemplate): Promise<string> {
  const version = model.version || 1;
  const id = versionIdOf(model.id, version);
  const existing = await loadChecklistVersion(id);
  if (existing) return id;
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const snapshot: TemplateVersionSnapshot = {
    id,
    templateId: model.id,
    version,
    name: model.name,
    unit: model.unit,
    type: model.type,
    periodicity: model.periodicity,
    items: (model.checklistItems || [])
      .filter((it) => it.isActive)
      .map(({ id: _id, isActive: _active, ...rest }) => rest),
    createdAt: new Date().toISOString()
  };
  await setDoc(doc(dbInstance, 'templateVersions', id), cleanUndefined(snapshot));
  cache.set(id, snapshot);
  idbSet(idbKey(id), snapshot).catch(() => {});
  return id;
}
