import { runBulk } from './guard';
import { doc, serverTimestamp, setDoc, writeBatch } from './guard';
import { Address, Asset } from '../types';
import { firebaseActive, dbInstance, cleanUndefined } from './core';
import { markSyncStale, syncedList } from './localSync';

// CONTROLE DE ENDEREÇOS
// Cópia guardada no aparelho (src/db/localSync.ts): baixa todos 1 vez e depois só o que mudou.
// Toda gravação leva syncAt. Endereço não é excluído (só inativado).
export function clearAddressesCache(): void {
  markSyncStale('addresses');
}

export function addressCodeFromItem(item: string | number): string {
  const n = String(item ?? '').trim().replace(/\D/g, '');
  return n ? `END-${n.padStart(3, '0')}` : '';
}

export async function dbGetAddresses(force = false): Promise<Address[]> {
  if (!firebaseActive || !dbInstance) return [];
  const list = await syncedList<Address>('addresses', '*', [], force);
  return list.sort((x, y) => x.code.localeCompare(y.code));
}

export async function dbSaveAddress(address: Address): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível.');
  const toSave: Address = { ...address, id: address.code, updatedAt: new Date().toISOString() };
  await setDoc(doc(dbInstance, 'addresses', toSave.id), { ...cleanUndefined(toSave), syncAt: serverTimestamp() });
  markSyncStale('addresses');
}

// Importação da planilha (ITEM, CRAAI, COMARCA, ENDEREÇO). Cria ou atualiza pelo código;
// não altera a situação (ativo/inativo) de endereços que já existem.
// Empresa (etapa especial E3): escolhida antes do arquivo; todos os endereços da planilha ficam com ela.
// Retorna também os endereços que mudaram de empresa (as vistorias "Novo" deles passam para a nova).
// Operação em massa: roda liberada do disjuntor (src/db/guard.ts)
export function dbImportAddresses(...args: Parameters<typeof dbImportAddressesNow>): ReturnType<typeof dbImportAddressesNow> {
  return runBulk(() => dbImportAddressesNow(...args));
}
async function dbImportAddressesNow(
  rows: Array<{ code: string; craai: string; comarca: string; address: string }>,
  company: string
): Promise<{ saved: number; moved: string[] }> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível.');
  const existing = new Map((await dbGetAddresses(true)).map((a) => [a.id, a]));
  const now = new Date().toISOString();
  let saved = 0;
  const moved: string[] = [];
  for (let i = 0; i < rows.length; i += 200) {
    const batch = writeBatch(dbInstance);
    for (const r of rows.slice(i, i + 200)) {
      const prev = existing.get(r.code);
      const address: Address = {
        id: r.code,
        code: r.code,
        craai: r.craai,
        comarca: r.comarca,
        address: r.address,
        active: prev ? prev.active : true,
        company,
        createdAt: prev?.createdAt || now,
        updatedAt: now,
        inactivatedAt: prev?.inactivatedAt ?? null
      };
      batch.set(doc(dbInstance, 'addresses', address.id), { ...cleanUndefined(address), syncAt: serverTimestamp() });
      if (prev && (prev.company || '') !== company) moved.push(address.id);
      saved++;
    }
    await batch.commit();
  }
  clearAddressesCache();
  return { saved, moved };
}

// Onde as rondas (vistorias sem ativo) são geradas: 1 por endereço ativo.
// Se ainda não houver endereços cadastrados, mantém o comportamento antigo (1 por comarca).
export interface SurveyTarget {
  key: string;        // parte do número da OS: código do endereço (ou a comarca, no modo antigo)
  comarca: string;
  craai?: string;
  address?: Address;
}

export function buildSurveyTargets(addresses: Address[], comarcas: string[]): SurveyTarget[] {
  const active = addresses.filter((a) => a.active);
  if (active.length > 0) {
    return active.map((a) => ({ key: a.code, comarca: a.comarca, craai: a.craai, address: a }));
  }
  return comarcas.map((c) => ({ key: c, comarca: c }));
}

// Endereço (vistorias da DOM) mostrado como item "Imóvel" — montado do cadastro de Endereços, sem cópia
export function addressToAssetItem(ad: Address): Asset {
  return {
    id: `addr:${ad.id}`,
    kind: 'address',
    addressId: ad.id,
    code: ad.code,
    name: ad.address,
    sector: 'DOM',
    location: `${ad.comarca} · ${ad.craai}`,
    status: ad.active ? 'Operando' : 'Baixado',
    specs: { CRAAI: ad.craai, COMARCA: ad.comarca, TIPO: 'IMÓVEL / ENDEREÇO', STATUS: ad.active ? 'Ativo' : 'Inativo' } as any,
    createdAt: ad.createdAt,
    updatedAt: ad.updatedAt
  };
}

