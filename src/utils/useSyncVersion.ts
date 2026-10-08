import { useEffect, useState } from 'react';
import { onSyncChange, SyncedCollection } from '../db/localSync';

// Número que aumenta quando alguma das listas guardadas no aparelho muda (tempo real).
// A tela coloca esse número nas dependências do efeito que lê a lista: relê da memória, sem ler o banco.
export function useSyncVersion(...colls: SyncedCollection[]): number {
  const [version, setVersion] = useState(0);
  const key = colls.join('|');
  useEffect(() => {
    const offs = colls.map((c) => onSyncChange(c, () => setVersion((v) => v + 1)));
    return () => offs.forEach((off) => off());
  }, [key]);
  return version;
}
