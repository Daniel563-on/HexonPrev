import { collection, doc, getDocs, setDoc, writeBatch } from 'firebase/firestore';
import { Address, Asset } from '../types';
import { firebaseActive, dbInstance, cleanUndefined, checkQuotaException } from './core';

// CONTROLE DE ENDEREÇOS
// Coleção pequena (centenas de endereços): carregada inteira e guardada em memória.
let cacheAddresses: Address[] | null = null;

export function clearAddressesCache(): void {
  cacheAddresses = null;
}

export function addressCodeFromItem(item: string | number): string {
  const n = String(item ?? '').trim().replace(/\D/g, '');
  return n ? `END-${n.padStart(3, '0')}` : '';
}

export async function dbGetAddresses(force = false): Promise<Address[]> {
  if (cacheAddresses && !force) return [...cacheAddresses];
  if (!firebaseActive || !dbInstance) return [];
  try {
    const snap = await getDocs(collection(dbInstance, 'addresses'));
    const list: Address[] = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Address));
    cacheAddresses = list.sort((a, b) => a.code.localeCompare(b.code));
    return [...cacheAddresses];
  } catch (err: any) {
    console.warn('Firestore fetch addresses failed:', err);
    checkQuotaException(err);
    return cacheAddresses ? [...cacheAddresses] : [];
  }
}

export async function dbSaveAddress(address: Address): Promise<void> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível.');
  const toSave: Address = { ...address, id: address.code, updatedAt: new Date().toISOString() };
  await setDoc(doc(dbInstance, 'addresses', toSave.id), cleanUndefined(toSave));
  if (cacheAddresses) {
    cacheAddresses = [...cacheAddresses.filter((a) => a.id !== toSave.id), toSave].sort((a, b) => a.code.localeCompare(b.code));
  }
}

// Importação da planilha (ITEM, CRAAI, COMARCA, ENDEREÇO). Cria ou atualiza pelo código;
// não altera a situação (ativo/inativo) de endereços que já existem.
export async function dbImportAddresses(
  rows: Array<{ code: string; craai: string; comarca: string; address: string }>
): Promise<number> {
  if (!firebaseActive || !dbInstance) throw new Error('Banco de dados indisponível.');
  const existing = new Map((await dbGetAddresses(true)).map((a) => [a.id, a]));
  const now = new Date().toISOString();
  let saved = 0;
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
        createdAt: prev?.createdAt || now,
        updatedAt: now,
        inactivatedAt: prev?.inactivatedAt ?? null
      };
      batch.set(doc(dbInstance, 'addresses', address.id), cleanUndefined(address));
      saved++;
    }
    await batch.commit();
  }
  clearAddressesCache();
  return saved;
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
