/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ChecklistItem {
  id: string;
  task: string;
  checked: boolean;
  checkedAt: string | null;
  observations: string | null;
  statusCheck?: 'Atestado' | 'Não Atestado' | 'Não se Aplica';
  responseType?: 'three_states' | 'text' | 'number' | 'boolean' | 'date';
  naObservationRequired?: boolean;
  observationRequired?: boolean;
  autoCreateCorrective?: boolean;
  autoCorrectiveAnswer?: 'Sim' | 'Não';
  autoCorrectiveStatus?: 'Pendente' | 'Resolvido' | 'Cancelado';
}

export interface AssetSpecs {
  model: string;
  serialNumber: string;
  installationDate: string;
  manufacturer: string;
  power?: string;
  capacity?: string;
  voltage?: string;
  warrantyUntil?: string;
  [key: string]: string | undefined;
}

export interface Asset {
  id: string;
  code: string; // QR code key, e.g. "AT-HVAC-001"
  name: string;
  sector: 'HVAC' | 'Elétrica' | 'Hidráulica' | 'Civil' | string;
  location: string;
  specs: AssetSpecs;
  status: 'Operando' | 'Em Manutenção' | 'Parado';
  createdAt: string;
  updatedAt?: string;
  periodicities?: ('Mensal' | 'Trimestral' | 'Semestral' | 'Anual')[];
  qrCode?: string; // Base64 data URL
}

export interface ServiceOrder {
  id: string;           // e.g. "28941"
  assetId: string | null;      // Related asset (null for independent surveys/vistorias)
  assetName: string;    // Snapshot of asset name ("S/V - Vistoria" for surveys)
  assetCode: string;    // Snapshot of asset code ("PE-VISTORIA" for surveys)
  sector: string;       // HVAC, Elétrica, etc.
  title: string;
  description: string;
  priority: 'Baixa' | 'Média' | 'Alta' | 'Urgente';
  status: 'Novo' | 'Planejada' | 'Em Execução' | 'Concluída' | 'Atrasada' | 'Não Executada';
  scheduledDate: string;
  startDate?: string;   // date window start, e.g. "2026-06-01"
  endDate?: string;     // date window end, e.g. "2026-06-06"
  assignedTechnician: string;
  checklist: ChecklistItem[];
  notes: string;
  signature: string | null;      // Base64 drawing
  signedBy: string | null;       // Client or technician name
  signedAt: string | null;       // ISO timestamp
  createdAt: string;
  updatedAt: string;
  photoEvidence: string | null;  // base64 or placeholder image url
  isSurvey?: boolean;            // Flag indicating this is an independent inspection/vistoria
  surveyType?: string;           // e.g., "Inspeção de Ambientes", "Casa de Máquinas", "Quadro Elétrico"
  surveyLocation?: string;       // Location/room name for independent surveys
  periodicity?: string;          // e.g., "Semanal", "Quinzenal", "Mensal"
}

export interface MaintenanceLog {
  id: string;
  assetId: string;
  osId: string;
  osTitle: string;
  date: string;
  technician: string;
  status: string;
  notes: string;
  checklistCount: number;
  checkedCount: number;
  preventiveType?: string; // e.g. "Mensal", "Semestral", "Anual"
  resultStatus?: 'Aprovado' | 'Aprovado com Ressalvas' | 'Não Conforme';
  verifiedItemsText?: string; // list of approved tasks 
  nonConformItemsText?: string; // list of failed tasks
  correctiveActionsText?: string; // details of any corrective OS created
}

export interface ChecklistTemplateItem {
  id: string;
  task: string;
  isActive: boolean;
  defaultChecked?: boolean; // true = Verificado por padrão, false = Não Verificado
  observationRequired?: boolean; // Campo de observação obrigatório
  criticality?: 'Baixa' | 'Média' | 'Alta';
  autoCreateCorrective?: boolean; // Abre corretiva imediata na não conformidade
  responseType?: 'three_states' | 'text' | 'number' | 'boolean' | 'date';
  naObservationRequired?: boolean;
}

export interface TemplateChangeLog {
  version: number;
  updatedAt: string;
  changeDescription: string;
  user: string;
}

export interface MaintenanceTemplate {
  id: string;
  name: string; // e.g., "Preventiva Mensal - Chiller"
  type: 'preventive' | 'survey';
  targetSectorOrType: string; // For preventive: asset sector ("HVAC", "Elétrica", etc.) | For survey: survey type ("Sala Técnica", "Telhado", etc.)
  targetAssetType?: string;   // Linked matching asset specs.TIPO (e.g. "Chiller", "Ar Condicionado")
  periodicity: 'Semanal' | 'Quinzenal' | 'Mensal' | 'Trimestral' | 'Semestral' | 'Anual' | string;
  checklistItems: ChecklistTemplateItem[];
  createdAt: string;
  version?: number;
  history?: TemplateChangeLog[];
}

/**
 * Formata qualquer string de data (do tipo YYYY-MM-DD ou ISO de banco) para o padrão brasileiro DD/MM/AAAA.
 * Mantém também o horário, se houver.
 */
export function formatDateBR(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const trimmed = dateStr.trim();
  if (!trimmed) return '';

  // Ignorar se já for um link/imagem/outro tipo de dado
  if (trimmed.startsWith('http') || trimmed.startsWith('data:')) {
    return dateStr;
  }

  // Formato YYYY-MM-DD ou YYYY-MM-DD HH:MM / ISO
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
  if (isoMatch) {
    const [, year, month, day, hours, minutes] = isoMatch;
    const formattedDate = `${day}/${month}/${year}`;
    if (hours && minutes) {
      return `${formattedDate} ${hours}:${minutes}`;
    }
    return formattedDate;
  }

  // Se já começar com DD/MM/AAAA
  if (/^\d{2}\/\d{2}\/\d{4}/.test(trimmed)) {
    return trimmed;
  }

  // Coleta pelo construtor Date se possível
  try {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      
      if (trimmed.includes(':') || trimmed.includes('T')) {
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        return `${day}/${month}/${year} ${hours}:${minutes}`;
      }
      return `${day}/${month}/${year}`;
    }
  } catch (e) {
    // desvia para retorno original
  }

  return dateStr;
}

export interface HexonUser {
  id: string; // Document ID (UID representation or matricula)
  name: string; // Nome Completo
  matricula: string; // Matrícula
  email: string; // E-mail
  cargo: string; // Cargo
  gerencia: string; // Gerência
  perfil: 'Super Administrador' | 'Administrador' | 'Profissional';
  status: 'Ativo' | 'Inativo';
  senha?: string; // Senha para login via credenciais
}

export interface Profile {
  id: string;
  name: string;
  description: string;
}

export interface Permission {
  id: string;
  profileId: string;
  resource: string;
  action: string;
  allowed: boolean;
}

export interface Management {
  id: string;
  name: string;
  description: string;
}

export interface Unit {
  id: string;
  name: string;
  location: string;
}

export interface AccessLog {
  id: string;
  userId?: string;
  userName?: string;
  userMatricula: string;
  event: string; // e.g. "Login", "Logout", "Falha de Autenticação"
  timestamp: string;
  ipAddress?: string;
}

export interface AuditLog {
  id: string;
  userId?: string;
  userName?: string;
  userMatricula: string;
  action: string; // e.g. "Create User", "Edit Asset", "Delete OS"
  target: string; // e.g. "users/1-0000", "assets/HV-011"
  details: string;
  timestamp: string;
}

export interface SystemPermission {
  id: string;
  name: string;
  description: string;
  category: 'Abas' | 'Ações';
  roles: {
    'Super Administrador': boolean;
    'Administrador': boolean;
    'Profissional': boolean;
  };
}

export interface RolePermissions {
  id: string;
  permissions: {
    [key: string]: SystemPermission;
  };
}


