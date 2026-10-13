import { Bytes, collection, doc, getDoc, getDocFromCache, getDocs, onSnapshot, query, setDoc, where, writeBatch } from './guard';
import { HexonUser, Notice, NoticeRead } from '../types';
import { firebaseActive, dbInstance, checkQuotaException, awaitWrite } from './core';
import { localTodayStr } from './serviceOrders';

// QUADRO DE AVISOS (Fase 9A). Escuta só os avisos que ainda valem (until >= hoje) das gerências da pessoa
// (+ os de "todas as gerências"); empresa e público (técnicos/escritório) são filtrados na tela.
// Foto à parte (noticeImages/{id}, comprimida no aparelho): só é lida quando o aviso aparece, 1 vez por aparelho.
// Fase 7D: PDF à parte (noticeFiles/{id}, até 900 KB): só é lido quando alguém aperta "Abrir PDF".

export const NOTICE_FOREVER = '9999-12-31';
export const NOTICE_ALL_UNITS = '*';
export const NOTICE_FILE_MAX = 900 * 1024;
export type NoticeFile = { bytes: Uint8Array; name: string };
// Documento do PDF do aviso (o mesmo formato vale para a publicação da Programação)
export const noticeFileData = (f: NoticeFile) => ({ data: Bytes.fromUint8Array(f.bytes), mime: 'application/pdf', name: f.name.slice(0, 150), at: new Date().toISOString() });

const dayShift = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Quem a pessoa é para os avisos: tipo de perfil, gerências (null = todas) e empresas (null = todas)
export interface NoticeViewer {
  perfil: HexonUser['perfil'];
  units: string[] | null;
  companies: string[] | null;
}
// Empresas que contam: o técnico é da empresa dele; o escritório, das empresas que o perfil vê
export const noticeCompaniesOf = (u: HexonUser, visible: string[] | null): string[] | null => (u.perfil === 'Profissional' ? u.companies || [] : visible);

// O aviso é para esta pessoa? (gerência, empresa e público)
export function noticeTargets(n: Notice, v: NoticeViewer): boolean {
  const unitOk = v.units === null || n.units.includes(NOTICE_ALL_UNITS) || n.units.some((x) => v.units!.includes(x));
  const companyOk = n.companies.length === 0 || v.companies === null || n.companies.some((c) => v.companies!.includes(c));
  const audienceOk = n.audience === 'todos' || (n.audience === 'tecnicos') === (v.perfil === 'Profissional');
  return unitOk && companyOk && audienceOk;
}

export const noticeActive = (n: Notice) => n.until >= localTodayStr();

// Fixados primeiro, depois urgentes, depois os mais novos
export function sortNotices(list: Notice[]): Notice[] {
  const rank = (n: Notice) => (n.pinned ? 0 : 2) + (n.kind === 'urgente' ? 0 : 1);
  return [...list].sort((a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt));
}

function unitQueries(units: string[] | null, range: ReturnType<typeof where>[]) {
  const col = collection(dbInstance!, 'notices');
  if (units === null) return [query(col, ...range)];
  const keys = Array.from(new Set([...units, NOTICE_ALL_UNITS]));
  const out = [];
  for (let i = 0; i < keys.length; i += 30) out.push(query(col, where('units', 'array-contains-any', keys.slice(i, i + 30)), ...range));
  return out;
}

// Tempo real: avisos que ainda valem (units = gerências da pessoa; null = todas)
export function subscribeNotices(units: string[] | null, onChange: (list: Notice[]) => void): () => void {
  if (!firebaseActive || !dbInstance || (units !== null && units.length === 0)) {
    onChange([]);
    return () => {};
  }
  const parts = new Map<number, Notice[]>();
  const qs = unitQueries(units, [where('until', '>=', localTodayStr())]);
  const stops = qs.map((q, i) =>
    onSnapshot(
      q,
      (snap) => {
        parts.set(
          i,
          snap.docs.map((d) => ({ ...(d.data() as Notice), id: d.id }))
        );
        const byId = new Map<string, Notice>();
        parts.forEach((l) => l.forEach((n) => byId.set(n.id, n)));
        onChange(Array.from(byId.values()));
      },
      (err) => {
        console.warn('Não foi possível acompanhar os avisos:', err);
        checkQuotaException(err);
      }
    )
  );
  return () => stops.forEach((s) => s());
}

// Encerrados nos últimos 90 dias (só para quem publica)
export async function dbGetEndedNotices(units: string[] | null): Promise<Notice[]> {
  if (!firebaseActive || !dbInstance) return [];
  try {
    const snaps = await Promise.all(unitQueries(units, [where('until', '>=', dayShift(-90)), where('until', '<', localTodayStr())]).map((q) => getDocs(q)));
    const byId = new Map<string, Notice>();
    snaps.forEach((s) => s.docs.forEach((d) => byId.set(d.id, { ...(d.data() as Notice), id: d.id })));
    return Array.from(byId.values()).sort((a, b) => b.until.localeCompare(a.until));
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}

export const newNoticeId = () => `av_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

// Publicar ou editar. image: foto nova (bytes já comprimidos), null = tirar a foto, undefined = não mexe; file: o mesmo para o PDF
export async function dbSaveNotice(n: Notice, image?: { bytes: Uint8Array; mime: string } | null, file?: NoticeFile | null): Promise<Notice> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const id = n.id || newNoticeId();
  const saved: Notice = {
    ...n,
    id,
    hasImage: image === undefined ? !!n.hasImage : !!image,
    hasFile: file === undefined ? !!n.hasFile : !!file,
    fileName: file === undefined ? n.fileName : file ? file.name.slice(0, 150) : undefined
  };
  if (!saved.hasFile) delete saved.fileName;
  const batch = writeBatch(dbInstance);
  if (image)
    batch.set(doc(dbInstance, 'noticeImages', id), {
      data: Bytes.fromUint8Array(image.bytes),
      mime: image.mime,
      at: new Date().toISOString()
    });
  else if (image === null && n.hasImage) batch.delete(doc(dbInstance, 'noticeImages', id));
  if (file) batch.set(doc(dbInstance, 'noticeFiles', id), noticeFileData(file));
  else if (file === null && n.hasFile) batch.delete(doc(dbInstance, 'noticeFiles', id));
  const { id: _omit, ...data } = saved;
  batch.set(doc(dbInstance, 'notices', id), JSON.parse(JSON.stringify(data)));
  await batch.commit();
  imageCache.delete(id);
  return saved;
}

// Encerrar = último dia ontem (sai do quadro e vai para "Encerrados")
export async function dbEndNotice(n: Notice, by: { matricula: string; name: string }): Promise<void> {
  await dbSaveNotice({
    ...n,
    until: dayShift(-1),
    pinned: false,
    updatedAt: new Date().toISOString(),
    updatedBy: by
  });
}

// Excluir de vez: o aviso, a foto, o PDF e os "Li e estou ciente"
export async function dbDeleteNotice(n: Notice): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const reads = n.kind === 'urgente' ? await getDocs(collection(dbInstance, 'notices', n.id, 'reads')) : null;
  const batch = writeBatch(dbInstance);
  reads?.docs.forEach((d) => batch.delete(d.ref));
  if (n.hasImage) batch.delete(doc(dbInstance, 'noticeImages', n.id));
  if (n.hasFile) batch.delete(doc(dbInstance, 'noticeFiles', n.id));
  batch.delete(doc(dbInstance, 'notices', n.id));
  await batch.commit();
}

// Foto do aviso: primeiro a cópia do aparelho; senão, 1 leitura
const imageCache = new Map<string, Promise<string | null>>();
export function dbGetNoticeImageUrl(id: string): Promise<string | null> {
  let p = imageCache.get(id);
  if (!p) {
    p = (async () => {
      if (!firebaseActive || !dbInstance) return null;
      const ref = doc(dbInstance, 'noticeImages', id);
      let snap = await getDocFromCache(ref).catch(() => null);
      if (!snap?.exists()) snap = await getDoc(ref);
      if (!snap.exists()) return null;
      const d = snap.data() as { data: Bytes; mime: string };
      return URL.createObjectURL(new Blob([d.data.toUint8Array()], { type: d.mime || 'image/jpeg' }));
    })().catch((err) => {
      checkQuotaException(err);
      imageCache.delete(id);
      return null;
    });
    imageCache.set(id, p);
  }
  return p;
}

// PDF do aviso (Fase 7D): primeiro a cópia do aparelho; senão, 1 leitura
export async function dbGetNoticeFile(id: string): Promise<NoticeFile | null> {
  if (!firebaseActive || !dbInstance) return null;
  try {
    const ref = doc(dbInstance, 'noticeFiles', id);
    let snap = await getDocFromCache(ref).catch(() => null);
    if (!snap?.exists()) snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const d = snap.data() as { data: Bytes; name: string };
    return { bytes: d.data.toUint8Array(), name: d.name || 'aviso.pdf' };
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}

// "Li e estou ciente" (avisos urgentes)
export async function dbConfirmNotice(noticeId: string, u: { matricula: string; name: string }): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const read: NoticeRead = {
    matricula: u.matricula,
    name: u.name,
    at: new Date().toISOString()
  };
  // sem internet: fica no aparelho e sobe quando voltar
  await awaitWrite(setDoc(doc(dbInstance, 'notices', noticeId, 'reads', u.matricula), read));
}
export async function dbHasConfirmedNotice(noticeId: string, matricula: string): Promise<boolean> {
  if (!firebaseActive || !dbInstance) return false;
  const ref = doc(dbInstance, 'notices', noticeId, 'reads', matricula);
  const cached = await getDocFromCache(ref).catch(() => null);
  if (cached?.exists()) return true;
  try {
    return (await getDoc(ref)).exists();
  } catch (err: any) {
    checkQuotaException(err);
    return false;
  }
}
export async function dbListNoticeReads(noticeId: string): Promise<NoticeRead[]> {
  if (!firebaseActive || !dbInstance) return [];
  try {
    const snap = await getDocs(collection(dbInstance, 'notices', noticeId, 'reads'));
    return snap.docs.map((d) => d.data() as NoticeRead).sort((a, b) => a.name.localeCompare(b.name));
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}
