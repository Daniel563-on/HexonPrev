import { doc, getDoc } from 'firebase/firestore';
import { JobRole, Material, PlanningLot, ServiceOrder } from '../types';
import { firebaseActive, dbInstance, checkQuotaException } from './core';
import { cargoKey, dbGetJobRoles } from './workforce';
import { dbGetMaterials } from './materials';
import { dbGetOvernightRate, lotOvernightCost } from './planning';

// HOMEM-HORA (Etapa 7): tempo e homem-hora ficam gravados na OS na conclusão (em minutos).
// O valor em R$ não é gravado: é calculado na hora, só para quem tem "Visualizar Valores (R$)".

export const SUSPICIOUS_MIN = 600;   // mais de 10 horas em execução = tempo suspeito
export const DIVERGENT_MIN = 30;     // diferença entre a conta do celular e a do servidor que marca "horário divergente"

// Hora gravada pelo banco (Timestamp), texto ISO ou { seconds } da cópia local → milissegundos
export function toMillis(v: any): number | null {
  if (!v) return null;
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
  return null;
}

// 135 → "2h15"; 45 → "45 min"
export function fmtMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h${String(r).padStart(2, '0')}` : `${h}h`;
}

export interface OrderTimeInfo {
  durationMin: number;
  manMinutes: number;
  people: number;
  suspicious: boolean;   // mais de 10 horas
  offline: boolean;      // início ou conclusão sem internet: vale a hora do celular
  divergent: boolean;    // com internet, a conta do servidor difere da do celular em mais de 30 min
}

// Tempo e homem-hora de uma OS concluída (null = OS sem esses dados)
export function orderTimeInfo(o: ServiceOrder): OrderTimeInfo | null {
  if (o.durationMin === undefined || o.durationMin === null) return null;
  const people = Math.max(1, (o.participants || []).length);
  const offline = !!o.execOffline;
  let divergent = false;
  const s = toMillis(o.startedAtServer);
  const e = toMillis(o.completedAtServer);
  if (!offline && s !== null && e !== null) {
    divergent = Math.abs((e - s) / 60000 - o.durationMin) > DIVERGENT_MIN;
  }
  return {
    durationMin: o.durationMin,
    manMinutes: o.manMinutes ?? o.durationMin * people,
    people,
    suspicious: o.durationMin > SUSPICIOUS_MIN,
    offline,
    divergent
  };
}

// Valor vigente numa data ("AAAA-MM-DD"): o último lançamento que começou até essa data
function valueAt(history: { value: number; from: string; setAt: string }[] | undefined, dateStr: string): number | null {
  let value: number | null = null;
  for (const h of [...(history || [])].sort((a, b) => a.from.localeCompare(b.from) || a.setAt.localeCompare(b.setAt))) {
    if (h.from <= dateStr) value = h.value;
  }
  return value;
}

const localDate = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export interface OrderCostLine {
  label: string;
  detail: string;
  value: number | null;  // null = sem valor cadastrado
}
export interface OrderCost {
  labor: OrderCostLine[];
  materials: OrderCostLine[];
  overnight: OrderCostLine | null;
  total: number;
  missing: number;       // linhas sem valor cadastrado (ficam fora do total)
}

async function getLot(lotId: string): Promise<PlanningLot | null> {
  if (!firebaseActive || !dbInstance) return null;
  try {
    const snap = await getDoc(doc(dbInstance, 'planningLots', lotId));
    return snap.exists() ? ({ ...(snap.data() as PlanningLot), id: snap.id }) : null;
  } catch (err: any) {
    checkQuotaException(err);
    return null;
  }
}

// Custo de uma OS concluída: mão de obra (horas × valor do cargo), materiais (qtd × valor) e parte do pernoite do lote.
// Valores vigentes na data da conclusão.
export async function dbGetOrderCost(o: ServiceOrder): Promise<OrderCost> {
  const date = localDate(o.completedAt || o.updatedAt || new Date().toISOString());
  const hours = (o.durationMin || 0) / 60;
  const needMaterials = (o.materialsUsed || []).length > 0 && !!o.unit;
  const [roles, materials, overnightRate, lot] = await Promise.all([
    dbGetJobRoles(),
    needMaterials ? dbGetMaterials([o.unit!]) : Promise.resolve([] as Material[]),
    o.lotId ? dbGetOvernightRate() : Promise.resolve(null),
    o.lotId ? getLot(o.lotId) : Promise.resolve(null)
  ]);
  const roleByKey = new Map<string, JobRole>(roles.map((r) => [cargoKey(r.name), r]));
  const matById = new Map<string, Material>(materials.map((m) => [m.id, m]));

  const labor: OrderCostLine[] = (o.participants || []).map((p) => {
    const role = roleByKey.get(cargoKey(p.cargo));
    const rate = role ? valueAt(role.history, date) : null;
    return {
      label: `${p.name}${p.cargo ? ` (${p.cargo})` : ''}`,
      detail: rate ? `${fmtMinutes(o.durationMin || 0)} × ${brl(rate)}/h` : p.cargo ? 'cargo sem valor cadastrado' : 'pessoa sem cargo',
      value: rate ? round2(hours * rate) : null
    };
  });

  const materialLines: OrderCostLine[] = (o.materialsUsed || []).map((m) => {
    const mat = matById.get(m.id);
    const price = mat ? valueAt(mat.history, date) : null;
    const qty = String(m.qty).replace('.', ',');
    return {
      label: `${m.description} (${m.code})`,
      detail: price ? `${qty} ${m.measureUnit} × ${brl(price)}` : `${qty} ${m.measureUnit} • sem valor cadastrado`,
      value: price ? round2(m.qty * price) : null
    };
  });

  let overnight: OrderCostLine | null = null;
  if (lot?.overnight) {
    const { total, perOrder } = lotOvernightCost(lot, overnightRate);
    overnight = {
      label: 'Pernoite (parte desta OS no lote)',
      detail: `${lot.overnight.people} pessoa(s) × ${lot.overnight.nights} noite(s) = ${brl(total)} ÷ ${lot.orderIds.length} OS`,
      value: total > 0 ? perOrder : null
    };
  }

  const all = [...labor, ...materialLines, ...(overnight ? [overnight] : [])];
  return {
    labor,
    materials: materialLines,
    overnight,
    total: round2(all.reduce((sum, l) => sum + (l.value || 0), 0)),
    missing: all.filter((l) => l.value === null).length
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
export const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
