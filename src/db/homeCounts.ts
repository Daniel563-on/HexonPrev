import { collection, getCountFromServer, query, where } from './guard';
import { firebaseActive, dbInstance, checkQuotaException } from './core';
import { OsCounters, cachedOsCount, dbCountWorkOrdersCached, dbGetOsCounters } from './workOrderList';

// INÍCIO: números dos Chamados GLPI das gerências do resumo (somados) — as mesmas contagens do painel da lista de OS,
// mais as atrasadas (prazo passou e o técnico ainda não assinou). Contar não baixa as OS.

export interface HomeOsCounts {
  byStatus: OsCounters['byStatus'];
  late: number;
}

export async function dbGetHomeOsCounts(units: string[], cos: string[] | null): Promise<HomeOsCounts> {
  const per = await Promise.all(
    units.map(async (u) => {
      const [c, late] = await Promise.all([dbGetOsCounters(u, cos), dbCountWorkOrdersCached(u, { kind: 'late' }, cos)]);
      return { c, late };
    })
  );
  const byStatus: OsCounters['byStatus'] = {};
  per.forEach(({ c }) =>
    Object.entries(c.byStatus).forEach(([k, n]) => {
      byStatus[k as keyof typeof byStatus] = (byStatus[k as keyof typeof byStatus] || 0) + (n || 0);
    })
  );
  return { byStatus, late: per.reduce((s, p) => s + p.late, 0) };
}

// OS esperando a assinatura do engenheiro e/ou do gerente (fila "GERÊNCIA|papel", a mesma de "Precisam da minha assinatura").
// Guardada na sessão como as do painel (ajuste S10)
export function dbCountSignQueue(units: string[], roles: ('engenheiro' | 'gerente')[]): Promise<number> {
  if (!firebaseActive || !dbInstance || units.length === 0 || roles.length === 0) return Promise.resolve(0);
  return cachedOsCount(units, `sign§${roles.join(',')}`, () => countSignQueueNow(units, roles));
}
async function countSignQueueNow(units: string[], roles: ('engenheiro' | 'gerente')[]): Promise<number> {
  if (!dbInstance) return 0;
  const keys = units.flatMap((u) => roles.map((r) => `${u}|${r}`));
  try {
    let total = 0;
    for (let i = 0; i < keys.length; i += 30) {
      const snap = await getCountFromServer(query(collection(dbInstance, 'workOrders'), where('signQueue', 'in', keys.slice(i, i + 30))));
      total += snap.data().count;
    }
    return total;
  } catch (err: any) {
    checkQuotaException(err);
    throw err;
  }
}
