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
  status: 'Operando' | 'Em Manutenção' | 'Parado' | 'Baixado';
  createdAt: string;
  updatedAt?: string;
  periodicities?: ('Semanal' | 'Quinzenal' | 'Mensal' | 'Trimestral' | 'Semestral' | 'Anual')[];
  qrCode?: string; // Base64 data URL
  retiredAt?: string; // data da baixa (não veio na planilha da gerência)
  kind?: 'address'; // 'address' = endereço (imóvel) mostrado na lista de ativos; não é gravado como ativo
  addressId?: string;
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
  status: 'Novo' | 'Planejada' | 'Em Execução' | 'Concluída' | 'Atrasada' | 'Não Executada' | 'Cancelada';
  scheduledDate: string;
  scheduledEndDate?: string; // Optional end of execution period assigned by manager, e.g. "2026-09-11"
  startDate?: string;   // date window start, e.g. "2026-06-01"
  endDate?: string;     // date window end, e.g. "2026-06-06"
  assignedTechnician: string;
  checklist: ChecklistItem[];
  notes: string;
  signature: string | null;      // Base64 drawing (no banco fica em "orderSignatures"; aqui só enquanto a OS está aberta na tela)
  hasSignature?: boolean;        // true quando a assinatura está gravada em "orderSignatures/{id}"
  closedMonth?: string;          // "AAAA-MM" da conclusão (Concluída) ou do fim do período (Não Executada); vazio se aberta
  comarca?: string;              // comarca do ativo (ou da vistoria), gravada no disparo
  craai?: string;                // CRAAI do ativo (ou da comarca da vistoria), gravado no disparo
  solicitationStatus?: 'Pendente' | 'Resolvido' | 'Cancelado'; // situação da solicitação de corretiva (itens "Sim"); vazio se não houver
  cancelReason?: string; // motivo do cancelamento (ex.: ativo baixado na importação)
  cancelledAt?: string;
  addressId?: string;            // endereço cadastrado (rondas da DOM geradas por endereço)
  unit?: string;                 // unidade (nome exato da gerência: GMMR, GMEE, GMC, DOM...) usada pelas regras do banco
  addressText?: string;          // endereço por extenso, gravado no disparo
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

// ENDEREÇO CADASTRADO (Controle de Endereços): cada endereço ativo recebe sua ronda semanal
export interface Address {
  id: string;       // igual ao código, ex.: "END-015"
  code: string;     // "END-" + ITEM da planilha
  craai: string;
  comarca: string;
  address: string;  // endereço por extenso
  active: boolean;  // inativo: não recebe rondas; o histórico continua guardado
  createdAt: string;
  updatedAt: string;
  inactivatedAt?: string | null;
}

export interface MaintenanceLog {
  id: string;
  assetId: string; // para vistoria de endereço: "addr:<id do endereço>" (mesmo id do QR do imóvel)
  addressId?: string;
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

export type PdfPinFieldType = 
  | 'checklist_status'      // 'Atestado' | 'Não Atestado' | 'Não se Aplica'
  | 'checklist_status_mark' // 'X', '✓', 'OK', '[X]', '[ ]'
  | 'checklist_obs'         // Observações preenchidas para o item
  | 'checklist_val'         // Valor informado (texto/número/data)
  | 'asset_name'            // Nome do Equipamento
  | 'asset_code'            // Patrimônio / Código QR
  | 'asset_sector'          // Setor / Gerência
  | 'asset_location'        // Comarca / Local
  | 'asset_specs'           // Fabricante, Modelo, Nº Série, Potência
  | 'technician'            // Técnico Responsável
  | 'scheduled_date'        // Data da Ordem de Serviço / Execução
  | 'os_id'                 // Código / ID da Ordem de Serviço
  | 'os_title'              // Título da Ordem de Serviço
  | 'signature'             // Assinatura Digital do Técnico / Cliente
  | 'signed_by'             // Nome de quem assinou
  | 'signed_at'             // Data/Hora da assinatura
  | 'result_status'         // Aprovado / Aprovado com Ressalvas / Não Conforme
  | 'notes'                 // Observações gerais da OS
  | 'fixed_text';           // Texto fixo personalizado

export interface PdfMappingPin {
  id: string;
  page: number; // 1-indexed (1, 2, 3...)
  x: number;    // % de 0 a 100 em relação à largura da página
  y: number;    // % de 0 a 100 em relação à altura da página
  fieldType: PdfPinFieldType;
  targetItemId?: string; // ID do ChecklistTemplateItem quando fieldType é checklist_*
  label?: string; // Título exibido no marcador
  fontSize?: number; // Tamanho da fonte em pt (padrão: 10)
  fontColor?: string; // Cor hex (padrão: '#000000')
  style?: 'text' | 'check_mark' | 'cross_mark' | 'box_checked' | 'badge';
  fixedText?: string;
  width?: number; // % de largura recomendada
  height?: number; // % de altura recomendada
  align?: 'left' | 'center' | 'right'; // Alinhamento do texto na caixa
  bold?: boolean; // Negrito
}

export interface PdfTemplateConfig {
  pdfBase64?: string;     // Dados base64 do PDF original
  pdfName?: string;       // Nome do arquivo PDF original
  pdfSize?: number;       // Tamanho em bytes
  pageCount?: number;     // Número total de páginas
  pins: PdfMappingPin[];  // Lista de marcadores/pinças mapeados
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
  pdfTemplate?: PdfTemplateConfig;
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
  currentSessionId?: string; // ID de sessão único do dispositivo ativo
  authUid?: string; // UID do Firebase Authentication vinculado
  profileId?: string; // perfil de acesso (cadastro de Perfis); "perfil" acima guarda o tipo básico derivado dele
}

// EFETIVO: pessoas importadas por planilha, só para compor o efetivo (NÃO têm login).
// Quem tem login fica em "users" e também conta no efetivo.
export interface WorkforcePerson {
  id: string;            // "wf_" + matrícula
  matricula: string;
  name: string;
  cargo: string;
  unit: string;          // gerência (GMMR, GMEE, GMC, DOM...)
  status: 'Ativo' | 'Inativo';
  source: 'importado';
  createdAt: string;
  updatedAt: string;
  inactivatedAt?: string;
}

// CARGO com o valor da hora (definido pelo Super Administrador; vale para todos do cargo), com histórico
export interface JobRoleRate {
  value: number;         // R$ por hora
  from: string;          // vigência: "AAAA-MM-DD"
  setAt: string;
  setBy: string;
}
export interface JobRole {
  id: string;
  name: string;
  hourlyRate: number;    // valor atual (R$ 0,00 até o Super Administrador preencher)
  rateFrom: string;      // vigência do valor atual ("" = nunca preenchido)
  history: JobRoleRate[];
  archived?: boolean;    // ninguém tem mais este cargo: some das listas (valor e histórico ficam guardados)
  createdAt: string;
  updatedAt: string;
}

// PERFIL DE ACESSO (criado e editado pelo Super Administrador; o nome é livre)
// kind = tipo básico de uso, que o restante do sistema entende:
//   'total'        -> acesso total (administração)
//   'planejamento' -> escritório (planejar, acompanhar)
//   'execucao'     -> campo (app do técnico)
export type ProfileKind = 'total' | 'planejamento' | 'execucao';

export interface AccessProfile {
  id: string;
  name: string;
  description: string;
  kind: ProfileKind;
  unitScope: 'own' | 'selected' | 'all'; // unidades visíveis: a do usuário, as escolhidas ou todas
  units: string[]; // usadas quando unitScope = 'selected'
  permissions: Record<string, boolean>; // id da permissão -> liberada
  system: boolean; // perfis de fábrica: podem ser renomeados, mas não excluídos
  createdAt: string;
  updatedAt: string;
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

export function getSectorGerencia(sector: string): string {
  if (!sector) return 'GMC';
  const sec = sector.toUpperCase();
  if (sec.includes('HVAC') || sec.includes('MEC') || sec.includes('REFR') || sec.includes('AR') || sec.includes('GMMR')) {
    return 'GMMR'; // Mecânica / Refrigeração
  }
  if (sec.includes('ELET') || sec.includes('SUBST') || sec.includes('FORÇA') || sec.includes('GMEE') || sec.includes('ELETRÔNICA')) {
    return 'GMEE'; // Elétrica / Eletrônica
  }
  return 'GMC'; // Civil / Hidráulica / Predial / Geral / Outros (GMC)
}

// Unidade da OS (nome exato de uma gerência cadastrada). Vistoria de endereço = DOM.
// Se o setor não bate com exatamente uma gerência, fica vazio (a correção mostra quantas ficaram assim).
export function resolveOrderUnit(sector: string, addressId: string | undefined, unitNames: string[]): string {
  const names = unitNames.filter((n) => n && n !== 'Todas');
  if (addressId) return names.find((n) => n.trim().toUpperCase() === 'DOM') || 'DOM';
  const s = (sector || '').trim().toUpperCase();
  const exact = names.find((n) => n.trim().toUpperCase() === s);
  if (exact) return exact;
  const matches = names.filter((n) => isSectorInGerencia(sector, n));
  return matches.length === 1 ? matches[0] : '';
}

export function isSectorInGerencia(sector: string, gerencia: string): boolean {
  if (!gerencia || gerencia === 'Todas' || gerencia === 'all') return true;
  if (!sector) return false;

  const s = sector.trim().toUpperCase();
  const g = gerencia.trim().toUpperCase();

  if (s === g) return true;

  // GMMR / Refrigeração
  const isGMMRSector = s.includes('HVAC') || s.includes('MEC') || s.includes('REFR') || s.includes('AR') || s.includes('GMMR');
  const isGMMRGerencia = g.includes('HVAC') || g.includes('MEC') || g.includes('REFR') || g.includes('AR') || g.includes('GMMR') || g.includes('REFRIGERAÇÃO') || g.includes('REFRIGERACAO');
  if (isGMMRSector && isGMMRGerencia) return true;

  // GMEE / Elétrica
  const isGMEESector = s.includes('ELET') || s.includes('SUBST') || s.includes('FORÇA') || s.includes('FORCA') || s.includes('GMEE') || s.includes('ELETRÔNICA') || s.includes('ELETRONICA');
  const isGMEEGerencia = g.includes('ELET') || g.includes('SUBST') || g.includes('FORÇA') || g.includes('FORCA') || g.includes('GMEE') || g.includes('ELETRÔNICA') || g.includes('ELETRONICA') || g.includes('ELÉTRICA') || g.includes('ELETRICA');
  if (isGMEESector && isGMEEGerencia) return true;

  // GMC / Civil / Predial
  const isGMCSector = s.includes('CIVIL') || s.includes('HIDR') || s.includes('PRED') || s.includes('GERAL') || s.includes('GMC');
  const isGMCGerencia = g.includes('CIVIL') || g.includes('HIDR') || g.includes('PRED') || g.includes('GERAL') || g.includes('GMC');
  if (isGMCSector && isGMCGerencia) return true;

  // Custom gerências
  return s.includes(g) || g.includes(s);
}

// ==========================================
// MODELOS DE ETIQUETA E QR CODE (PERSISTÊNCIA EM BANCO)
// ==========================================

export type FieldKey = 'header' | 'code' | 'name' | 'comarca' | 'location' | 'sector' | 'model' | 'serial';

export const DEFAULT_FIELD_ORDER: FieldKey[] = [
  'header',
  'code',
  'name',
  'comarca',
  'location',
  'sector',
  'model',
  'serial'
];

export interface FieldStyle {
  enabled: boolean;
  fontFamily: string;
  fontSizePt: number;
  fontWeight: 'normal' | 'bold' | '900';
  color: string;
  uppercase: boolean;
  wordWrap?: boolean;
}

export interface SheetConfig {
  paperType: 'A4' | 'A3' | 'Custom';
  pageWidthMm: number;
  pageHeightMm: number;
  labelWidthMm: number;
  labelHeightMm: number;
  columns: number;
  rows: number;
  marginTopMm: number;
  marginLeftMm: number;
  gapXMm: number;
  gapYMm: number;
}

export interface PlacardConfig {
  orientation: 'horizontal-left' | 'horizontal-right' | 'vertical-top' | 'vertical-bottom';
  qrScalePercent: number;
  borderStyle: 'none' | 'dashed' | 'dotted' | 'solid-thin' | 'solid-thick' | 'badge' | 'rounded-frame';
  borderColor: string;
  borderRadiusMm: number;
  backgroundColor: string;
  headerCustomText: string;
  fieldOrder?: FieldKey[];
  fields: {
    header: FieldStyle;
    code: FieldStyle;
    name: FieldStyle;
    comarca: FieldStyle;
    location: FieldStyle;
    sector: FieldStyle;
    model: FieldStyle;
    serial: FieldStyle;
  };
}

export interface SavedQrTemplate {
  id: string;
  name: string;
  createdAt: string;
  sheet: SheetConfig;
  placard: PlacardConfig;
}


