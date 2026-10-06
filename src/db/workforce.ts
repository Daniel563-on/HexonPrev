import { runBulk } from './guard';
import { collection, deleteDoc, doc, getDocs, setDoc, writeBatch } from './guard';
import { HexonUser, JobRole, WorkforcePerson } from '../types';
import { firebaseActive, dbInstance, cleanUndefined, checkQuotaException } from './core';

// EFETIVO (coleção "workforce": só as pessoas importadas, sem login) e CARGOS (coleção "jobRoles", só o Super Administrador)

export const normalizeMatricula = (m: unknown) => String(m ?? '').trim().toUpperCase();
export const workforceIdOf = (matricula: string) => `wf_${normalizeMatricula(matricula).replace(/[^A-Z0-9-]/g, '_')}`;
// Mesmo cargo escrito diferente ("Técnico", "TECNICO") conta como um só
export const cargoKey = (c: unknown) =>
  String(c ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');

let cacheWorkforce: WorkforcePerson[] | null = null;
let cacheJobRoles: JobRole[] | null = null;

export function clearWorkforceCache(): void {
  cacheWorkforce = null;
  cacheJobRoles = null;
}

export async function dbGetWorkforce(force = false): Promise<WorkforcePerson[]> {
  if (cacheWorkforce && !force) return [...cacheWorkforce];
  if (!firebaseActive || !dbInstance) return [];
  try {
    const snap = await getDocs(collection(dbInstance, 'workforce'));
    cacheWorkforce = snap.docs.map((d) => ({ ...(d.data() as WorkforcePerson), id: d.id }));
    return [...cacheWorkforce];
  } catch (err: any) {
    console.warn('Não foi possível ler o efetivo:', err);
    checkQuotaException(err);
    return [];
  }
}

export async function dbSetWorkforceStatus(person: WorkforcePerson, status: WorkforcePerson['status']): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const now = new Date().toISOString();
  await setDoc(
    doc(dbInstance, 'workforce', person.id),
    cleanUndefined({ ...person, status, updatedAt: now, inactivatedAt: status === 'Inativo' ? now : undefined })
  );
  cacheWorkforce = null;
}

export async function dbDeleteWorkforcePerson(personId: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  await deleteDoc(doc(dbInstance, 'workforce', personId));
  cacheWorkforce = null;
}

// Usuário com login tem prioridade: se havia alguém importado com a mesma matrícula, sai do efetivo importado.
// Retorna a pessoa excluída (para avisar) ou null.
export async function dbRemoveImportedPersonForUser(user: HexonUser): Promise<WorkforcePerson | null> {
  if (!firebaseActive || !dbInstance || !user.matricula) return null;
  const list = await dbGetWorkforce(true);
  const found = list.find((p) => normalizeMatricula(p.matricula) === normalizeMatricula(user.matricula));
  if (!found) return null;
  await dbDeleteWorkforcePerson(found.id);
  return found;
}

// ===== IMPORTAÇÃO DA PLANILHA (Matrícula, Nome, Cargo, Gerência), uma empresa por planilha =====
export interface WorkforceImportRow {
  matricula: string;
  name: string;
  cargo: string;
  unit: string;
  line: number; // linha da planilha (para os avisos)
}

export interface WorkforceImportPlan {
  toCreate: WorkforcePerson[];
  toUpdate: { before: WorkforcePerson; after: WorkforcePerson }[];
  toInactivate: WorkforcePerson[];
  skippedLogin: WorkforceImportRow[];     // matrícula de usuário com login: não importa
  skippedDuplicate: WorkforceImportRow[]; // repetida na planilha: só a primeira entra
  skippedInvalid: { row: WorkforceImportRow; reason: string }[];
  unchanged: number;
}

// Monta o que a importação vai fazer (nada é gravado aqui).
// Uma empresa por planilha (etapa especial E2): a gerência de cada linha tem que ser uma das gerências da empresa,
// e só as pessoas dessa empresa que sumirem da planilha ficam inativas.
export function planWorkforceImport(
  rows: WorkforceImportRow[],
  existing: WorkforcePerson[],
  users: HexonUser[],
  unitNames: string[],
  company: { id: string; units: string[] }
): WorkforceImportPlan {
  const plan: WorkforceImportPlan = {
    toCreate: [], toUpdate: [], toInactivate: [], skippedLogin: [], skippedDuplicate: [], skippedInvalid: [], unchanged: 0
  };
  const now = new Date().toISOString();
  const userMatriculas = new Set(users.map((u) => normalizeMatricula(u.matricula)));
  const existingById = new Map(existing.map((p) => [p.id, p]));
  const unitByKey = new Map(unitNames.map((n) => [n.trim().toUpperCase(), n]));
  const companyUnits = new Set(company.units.map((u) => u.trim().toUpperCase()));
  const seen = new Set<string>();

  for (const row of rows) {
    const matricula = normalizeMatricula(row.matricula);
    if (!matricula || !row.name.trim()) {
      plan.skippedInvalid.push({ row, reason: 'sem matrícula ou nome' });
      continue;
    }
    if (seen.has(matricula)) {
      plan.skippedDuplicate.push(row);
      continue;
    }
    seen.add(matricula);
    if (userMatriculas.has(matricula)) {
      plan.skippedLogin.push(row);
      continue;
    }
    const unit = unitByKey.get(row.unit.trim().toUpperCase());
    if (!unit) {
      plan.skippedInvalid.push({ row, reason: `gerência "${row.unit || '(vazia)'}" não cadastrada` });
      continue;
    }
    if (!companyUnits.has(unit.toUpperCase())) {
      plan.skippedInvalid.push({ row, reason: `a empresa não atua na gerência ${unit}` });
      continue;
    }
    const id = workforceIdOf(matricula);
    const before = existingById.get(id);
    const data = { matricula, name: row.name.trim(), cargo: row.cargo.trim(), unit, company: company.id };
    if (!before) {
      plan.toCreate.push({ id, ...data, status: 'Ativo', source: 'importado', createdAt: now, updatedAt: now });
    } else if (
      before.name !== data.name || before.cargo !== data.cargo || before.unit !== data.unit || before.company !== data.company || before.status !== 'Ativo'
    ) {
      plan.toUpdate.push({ before, after: { ...before, ...data, status: 'Ativo', updatedAt: now, inactivatedAt: undefined } });
    } else {
      plan.unchanged++;
    }
  }

  // Quem é da empresa e sumiu da planilha fica inativo
  const inSheet = new Set(Array.from(seen).map((m) => workforceIdOf(m)));
  plan.toInactivate = existing.filter((p) => p.status === 'Ativo' && p.company === company.id && !inSheet.has(p.id));
  return plan;
}

// Operação em massa: roda liberada do disjuntor (src/db/guard.ts)
export function dbApplyWorkforceImport(...args: Parameters<typeof dbApplyWorkforceImportNow>): ReturnType<typeof dbApplyWorkforceImportNow> {
  return runBulk(() => dbApplyWorkforceImportNow(...args));
}
async function dbApplyWorkforceImportNow(plan: WorkforceImportPlan): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const db = dbInstance;
  const now = new Date().toISOString();
  const writes: WorkforcePerson[] = [
    ...plan.toCreate,
    ...plan.toUpdate.map((u) => u.after),
    ...plan.toInactivate.map((p) => ({ ...p, status: 'Inativo' as const, updatedAt: now, inactivatedAt: now }))
  ];
  for (let i = 0; i < writes.length; i += 400) {
    const batch = writeBatch(db);
    writes.slice(i, i + 400).forEach((p) => batch.set(doc(db, 'workforce', p.id), cleanUndefined(p)));
    await batch.commit();
  }
  cacheWorkforce = null;
}

// ===== CARGOS =====
export async function dbGetJobRoles(force = false): Promise<JobRole[]> {
  if (cacheJobRoles && !force) return [...cacheJobRoles];
  if (!firebaseActive || !dbInstance) return [];
  try {
    const snap = await getDocs(collection(dbInstance, 'jobRoles'));
    cacheJobRoles = snap.docs
      .map((d) => ({ ...(d.data() as JobRole), id: d.id }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return [...cacheJobRoles];
  } catch (err: any) {
    console.warn('Não foi possível ler os cargos:', err);
    checkQuotaException(err);
    return [];
  }
}

// "Atualizar cargos": deixa a lista igual aos cargos que existem hoje no efetivo e nos usuários.
// - cargo novo: é criado com R$ 0,00;
// - cargo que ninguém tem mais: é arquivado (some das listas; valor e histórico ficam guardados);
// - cargo arquivado que voltou a existir: volta com o valor que tinha.
export interface JobRoleSyncResult {
  created: string[];
  archived: string[];
  restored: string[];
}

export async function dbSyncJobRoles(cargoNames: string[]): Promise<JobRoleSyncResult> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const current = await dbGetJobRoles(true);
  const known = new Set(current.map((r) => cargoKey(r.name)));
  const inUse = new Set(cargoNames.map(cargoKey).filter(Boolean));
  const now = new Date().toISOString();
  const result: JobRoleSyncResult = { created: [], archived: [], restored: [] };
  const created = result.created;
  const batch = writeBatch(dbInstance);
  for (const role of current) {
    const used = inUse.has(cargoKey(role.name));
    if (!used && !role.archived) {
      batch.set(doc(dbInstance, 'jobRoles', role.id), { ...role, archived: true, updatedAt: now });
      result.archived.push(role.name);
    } else if (used && role.archived) {
      batch.set(doc(dbInstance, 'jobRoles', role.id), { ...role, archived: false, updatedAt: now });
      result.restored.push(role.name);
    }
  }
  for (const name of cargoNames) {
    const key = cargoKey(name);
    if (!key || known.has(key)) continue;
    known.add(key);
    const role: JobRole = {
      id: `cargo_${key.replace(/[^A-Z0-9]/g, '_')}`,
      name: name.trim(),
      hourlyRate: 0,
      rateFrom: '',
      history: [],
      createdAt: now,
      updatedAt: now
    };
    batch.set(doc(dbInstance, 'jobRoles', role.id), role);
    created.push(role.name);
  }
  if (created.length + result.archived.length + result.restored.length > 0) await batch.commit();
  cacheJobRoles = null;
  return result;
}

// Novo valor da hora do cargo, a partir de uma data (o anterior fica no histórico)
export async function dbSetJobRoleRate(role: JobRole, value: number, from: string, setBy: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const now = new Date().toISOString();
  const updated: JobRole = {
    ...role,
    hourlyRate: value,
    rateFrom: from,
    history: [...(role.history || []), { value, from, setAt: now, setBy }],
    updatedAt: now
  };
  await setDoc(doc(dbInstance, 'jobRoles', role.id), cleanUndefined(updated));
  cacheJobRoles = null;
}

// Exclui um lançamento errado do histórico do cargo (Super Administrador).
// O valor atual passa a ser o último lançamento que sobrar; sem nenhum, o cargo volta a R$ 0,00.
export async function dbRemoveJobRoleRateEntry(role: JobRole, entry: JobRole['history'][number]): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  const history = (role.history || []).filter((h) => !(h.setAt === entry.setAt && h.from === entry.from && h.value === entry.value));
  const latest = history[history.length - 1];
  const updated: JobRole = {
    ...role,
    hourlyRate: latest ? latest.value : 0,
    rateFrom: latest ? latest.from : '',
    history,
    updatedAt: new Date().toISOString()
  };
  await setDoc(doc(dbInstance, 'jobRoles', role.id), cleanUndefined(updated));
  cacheJobRoles = null;
}

export async function dbDeleteJobRole(roleId: string): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível');
  await deleteDoc(doc(dbInstance, 'jobRoles', roleId));
  cacheJobRoles = null;
}
