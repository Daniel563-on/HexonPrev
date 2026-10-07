import { collection, doc, getDocs, setDoc } from './guard';
import { AccessProfile, Company, HexonUser } from '../types';
import { firebaseActive, dbInstance, cleanUndefined, checkQuotaException } from './core';

// EMPRESAS CONTRATADAS (etapa especial E1): coleção "companies"; a equipe lê, só o Super Administrador grava.
// Não se exclui empresa (o que é dela continua guardado): inativa = some das listas de escolha.

let cache: Company[] | null = null;

export function clearCompaniesCache(): void {
  cache = null;
}

export async function dbGetCompanies(force = false): Promise<Company[]> {
  if (cache && !force) return [...cache];
  if (!firebaseActive || !dbInstance) return [];
  try {
    const snap = await getDocs(collection(dbInstance, 'companies'));
    cache = snap.docs.map((d) => ({ ...(d.data() as Company), id: d.id })).sort((a, b) => a.name.localeCompare(b.name));
    return [...cache];
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}

// id curto e estável a partir do nome (ex.: "Almeida França" -> "almeida-franca")
export function companyIdOf(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || `empresa-${Date.now()}`
  );
}

export async function dbSaveCompany(c: Company, by: string): Promise<Company> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const now = new Date().toISOString();
  const saved: Company = { ...c, name: c.name.trim(), createdAt: c.createdAt || now, updatedAt: now, updatedBy: by };
  await setDoc(doc(dbInstance, 'companies', saved.id), cleanUndefined(saved));
  cache = null;
  return saved;
}

// Empresas que atuam numa gerência ("Todas" = todas)
export const companiesOfUnit = (list: Company[], unit: string): Company[] =>
  unit === 'Todas' ? list : list.filter((c) => c.units.includes(unit));

// Empresas que o usuário vê (as telas das próximas partes usam isto): perfil "todas" = as das gerências que vê
export function visibleCompanies(user: HexonUser, profile: AccessProfile | undefined | null, list: Company[], units: string[] | null): Company[] {
  const all = user.perfil === 'Super Administrador' || !profile || profile.kind === 'total' || (profile.companyScope || 'all') === 'all';
  if (all) return units === null ? list : list.filter((c) => c.units.some((u) => units.includes(u)));
  const mine = new Set(user.companies || []);
  return list.filter((c) => mine.has(c.id));
}

// A empresa contabiliza homem-hora, hora extra e pernoite? (sem empresa = não)
export const companyTracksCost = (list: Company[], id: string | undefined): boolean => !!id && !!list.find((c) => c.id === id)?.costTracking;

export const companyNames = (ids: string[] | undefined, list: Company[]): string =>
  (ids || []).map((id) => list.find((c) => c.id === id)?.name || id).join(', ');
