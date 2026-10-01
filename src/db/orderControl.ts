import { deleteField } from 'firebase/firestore';

// CAMPOS DE CONTROLE DA OS (otimização de gravações)
// Cada campo só existe enquanto a OS precisa dele. Os índices do banco usam estes campos (índices esparsos):
// assim cada OS só entra nos índices que fazem sentido para ela, e cada gravação custa menos.
//   unitOpen   = gerência, enquanto a OS está aberta           -> cópia local do planejador (OS abertas da gerência)
//   openEnd    = fim do prazo, enquanto aberta                  -> rotina das 00:00 (prazo vencido)
//   plannedEnd = último dia programado, enquanto "Planejada"    -> rotina das 00:00 (atrasadas)
//   techOpen   = matrícula do técnico, enquanto aberta          -> lista do técnico
//   techSol    = matrícula do técnico, com solicitação pendente -> aba Solicitações do técnico
//   solAt      = data da última alteração, se tem solicitação   -> Solicitações (decididas, mais recentes primeiro)
//   addrEnd    = fim do prazo, se é vistoria de endereço        -> histórico de vistorias do endereço

const OPEN = ['Novo', 'Planejada', 'Em Execução', 'Atrasada'];
export const CONTROL_FIELDS = ['unitOpen', 'openEnd', 'plannedEnd', 'techOpen', 'techSol', 'solAt', 'addrEnd'] as const;

interface ControlSource {
  status?: string;
  unit?: string;
  endDate?: string;
  scheduledDate?: string;
  scheduledEndDate?: string;
  assignedTechnicianMatricula?: string;
  solicitationStatus?: string;
  updatedAt?: string;
  addressId?: string;
}

const text = (v: unknown) => String(v ?? '').trim();

// Valor de cada campo (undefined = o campo não deve existir)
export function orderControlValues(o: ControlSource): Record<string, string | undefined> {
  const open = OPEN.includes(text(o.status));
  const mat = text(o.assignedTechnicianMatricula);
  const planned = text(o.scheduledEndDate) || text(o.scheduledDate);
  return {
    unitOpen: open && text(o.unit) ? text(o.unit) : undefined,
    openEnd: open && text(o.endDate) ? text(o.endDate) : undefined,
    plannedEnd: o.status === 'Planejada' && planned ? planned : undefined,
    techOpen: open && mat ? mat : undefined,
    techSol: o.solicitationStatus === 'Pendente' && mat ? mat : undefined,
    solAt: o.solicitationStatus ? text(o.updatedAt) || undefined : undefined,
    addrEnd: text(o.addressId) && text(o.endDate) ? text(o.endDate) : undefined
  };
}

// Para gravações completas (setDoc / batch.set): acrescenta só os campos que existem
export function withOrderControl<T extends object>(stored: T): T {
  const out: any = { ...stored };
  CONTROL_FIELDS.forEach((k) => delete out[k]);
  const v = orderControlValues(out);
  CONTROL_FIELDS.forEach((k) => {
    if (v[k] !== undefined) out[k] = v[k];
  });
  return out;
}

// Para gravações parciais (batch.update): grava o valor ou apaga o campo
export function orderControlUpdate(merged: ControlSource): Record<string, unknown> {
  const v = orderControlValues(merged);
  const out: Record<string, unknown> = {};
  CONTROL_FIELDS.forEach((k) => {
    out[k] = v[k] !== undefined ? v[k] : deleteField();
  });
  return out;
}
