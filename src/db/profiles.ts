import { collection, deleteDoc, doc, getDocs, setDoc, writeBatch } from 'firebase/firestore';
import { AccessProfile, HexonUser, ProfileKind, isSectorInGerencia } from '../types';
import { firebaseActive, dbInstance, cleanUndefined, checkQuotaException } from './core';
import { DEFAULT_PERMISSIONS, dbGetPermissions } from './permissions';
import { dbGetUsers, dbSaveUser } from './users';

// PERFIS DE ACESSO (coleção "profiles")
// O Super Administrador cria perfis com nome livre, permissões e unidades visíveis.
// O "tipo básico" (kind) é gravado também no usuário (campo "perfil"), porque o restante do
// sistema e as regras do banco ainda usam esse campo. Assim trocar o NOME do perfil nunca quebra nada.

export const SYSTEM_PROFILE_IDS = { total: 'perfil_total', planejamento: 'perfil_planejamento', execucao: 'perfil_execucao' } as const;

// Tipo básico -> valor gravado em users.perfil (usado pelo código atual e pelas regras do banco)
export function legacyPerfilOf(kind: ProfileKind): HexonUser['perfil'] {
  if (kind === 'total') return 'Super Administrador';
  if (kind === 'planejamento') return 'Administrador';
  return 'Profissional';
}

export function kindOfLegacyPerfil(perfil: HexonUser['perfil']): ProfileKind {
  if (perfil === 'Super Administrador') return 'total';
  if (perfil === 'Administrador') return 'planejamento';
  return 'execucao';
}

// Perfil do usuário: o gravado nele ou, se ainda não tiver, o de fábrica equivalente ao tipo antigo
export function resolveUserProfile(user: HexonUser | null | undefined, profiles: AccessProfile[]): AccessProfile | undefined {
  if (!user) return undefined;
  const byId = user.profileId ? profiles.find((p) => p.id === user.profileId) : undefined;
  return byId || profiles.find((p) => p.id === SYSTEM_PROFILE_IDS[kindOfLegacyPerfil(user.perfil)]);
}

let cacheProfiles: AccessProfile[] | null = null;

export function clearProfilesCache(): void {
  cacheProfiles = null;
}

// Perfis de fábrica, com as permissões da matriz atual (para nada mudar na primeira vez)
async function buildSystemProfiles(): Promise<AccessProfile[]> {
  const matrix = await dbGetPermissions().catch(() => DEFAULT_PERMISSIONS);
  const permsOf = (legacy: HexonUser['perfil']) =>
    Object.fromEntries(Object.values(matrix).map((p) => [p.id, !!p.roles?.[legacy]]));
  const now = new Date().toISOString();
  const base = (id: string, name: string, description: string, kind: ProfileKind, unitScope: AccessProfile['unitScope']): AccessProfile => ({
    id,
    name,
    description,
    kind,
    unitScope,
    units: [],
    permissions: kind === 'total' ? Object.fromEntries(Object.keys(matrix).map((k) => [k, true])) : permsOf(legacyPerfilOf(kind)),
    system: true,
    createdAt: now,
    updatedAt: now
  });
  return [
    base(SYSTEM_PROFILE_IDS.total, 'Super Administrador', 'Acesso total a todas as unidades e funções.', 'total', 'all'),
    base(SYSTEM_PROFILE_IDS.planejamento, 'Planejador', 'Planeja e acompanha as preventivas da sua unidade.', 'planejamento', 'own'),
    base(SYSTEM_PROFILE_IDS.execucao, 'Técnico', 'Executa as preventivas atribuídas a ele.', 'execucao', 'own')
  ];
}

// Lê os perfis. Na primeira vez (coleção vazia), o Super Administrador cria os 3 de fábrica
// e vincula os usuários atuais ao perfil equivalente.
export async function dbGetProfiles(force = false, canSeed = false): Promise<AccessProfile[]> {
  if (cacheProfiles && !force) return [...cacheProfiles];
  if (!firebaseActive || !dbInstance) return buildSystemProfiles();
  try {
    const snap = await getDocs(collection(dbInstance, 'profiles'));
    let list = snap.docs.map((d) => ({ ...(d.data() as AccessProfile), id: d.id }));
    if (list.length === 0) {
      list = await buildSystemProfiles();
      if (canSeed) {
        const batch = writeBatch(dbInstance);
        list.forEach((p) => batch.set(doc(dbInstance!, 'profiles', p.id), cleanUndefined(p)));
        await batch.commit();
        await linkUsersToSystemProfiles();
      }
    }
    cacheProfiles = list.sort((a, b) => a.name.localeCompare(b.name));
    return [...cacheProfiles];
  } catch (err: any) {
    console.warn('Não foi possível ler os perfis de acesso:', err);
    checkQuotaException(err);
    return buildSystemProfiles();
  }
}

// Usuários sem perfil recebem o perfil de fábrica do seu tipo atual
async function linkUsersToSystemProfiles(): Promise<void> {
  const users = await dbGetUsers(true);
  for (const u of users.filter((x) => !x.profileId)) {
    await dbSaveUser({ ...u, profileId: SYSTEM_PROFILE_IDS[kindOfLegacyPerfil(u.perfil)] });
  }
}

// Salva o perfil e atualiza o tipo básico dos usuários que usam esse perfil
export async function dbSaveProfile(profile: AccessProfile): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const toSave: AccessProfile = { ...profile, updatedAt: new Date().toISOString() };
  await setDoc(doc(dbInstance, 'profiles', toSave.id), cleanUndefined(toSave));
  cacheProfiles = null;

  const legacy = legacyPerfilOf(toSave.kind);
  const users = await dbGetUsers(true);
  for (const u of users.filter((x) => x.profileId === toSave.id && x.perfil !== legacy)) {
    await dbSaveUser({ ...u, perfil: legacy });
  }
}

// Exclui só perfis criados pelo usuário e sem ninguém usando
export async function dbDeleteProfile(profile: AccessProfile): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  if (profile.system) throw new Error('Perfis de fábrica podem ser renomeados, mas não excluídos.');
  const users = await dbGetUsers(true);
  const inUse = users.filter((u) => u.profileId === profile.id).length;
  if (inUse > 0) throw new Error(`Há ${inUse} usuário(s) com este perfil. Troque o perfil deles antes de excluir.`);
  await deleteDoc(doc(dbInstance, 'profiles', profile.id));
  cacheProfiles = null;
}

// UNIDADES QUE O USUÁRIO ENXERGA DENTRO DO SISTEMA
// null = todas. "Própria" usa a gerência do usuário; "Escolhidas" usa as marcadas no perfil.
export function userVisibleUnits(user: HexonUser | null | undefined, profiles: AccessProfile[]): string[] | null {
  if (!user) return [];
  const profile = resolveUserProfile(user, profiles);
  const kind = profile?.kind || kindOfLegacyPerfil(user.perfil);
  if (kind === 'total') return null;
  const scope = profile?.unitScope || 'own';
  if (scope === 'all') return null;
  if (scope === 'selected') return profile && profile.units.length > 0 ? [...profile.units] : [];
  if (!user.gerencia || user.gerencia === 'Todas') return null;
  return [user.gerencia];
}

// O setor (de uma OS ou ativo) pertence a alguma das unidades visíveis?
export function isSectorVisible(sector: string, units: string[] | null): boolean {
  if (units === null) return true;
  return units.some((u) => isSectorInGerencia(sector, u));
}
