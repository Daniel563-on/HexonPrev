import { doc, getDoc, setDoc } from './guard';
import { PermissionArea, SystemPermission } from '../types';
import {
  firebaseActive,
  dbInstance,
  isCacheValid,
  updateCacheTimestamp,
  checkQuotaException
} from './core';

// CATÁLOGO DE PERMISSÕES (Hexon 2.0, Fase 2), organizado por área na tela de perfis.
// Os ids antigos continuam os mesmos (as regras do banco usam view_materials, manage_materials, manage_templates,
// view_costs, dispatch_orders e delete_templates). "soon" = módulo ainda em construção: aparece na tela, sem efeito.
// As permissões valem no computador; as que também valem no celular do técnico dizem isso na descrição.
export const DEFAULT_PERMISSIONS: { [key: string]: SystemPermission } = {
  view_service_orders: {
    id: 'view_service_orders',
    name: 'Ver execução das preventivas',
    description: 'Ordens de Serviço › Preventivas: lista para abrir, executar e assinar.',
    category: 'Abas',
    area: 'preventiva',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': true }
  },
  view_pmoc_planning: {
    id: 'view_pmoc_planning',
    name: 'Ver planejamento das preventivas',
    description: 'PMOC › Preventivas: calendário de planejamento e consulta (só olhar).',
    category: 'Abas',
    area: 'preventiva',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': false }
  },
  plan_orders: {
    id: 'plan_orders',
    name: 'Planejar preventivas',
    description: 'Alterar o planejamento: programar lotes, escolher técnico, remarcar, pernoite, equipe habitual e voltar atrasadas para Novo.',
    category: 'Ações',
    area: 'preventiva',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': false }
  },
  execute_order: {
    id: 'execute_order',
    name: 'Executar checklist das preventivas',
    description: 'Computador: iniciar a preventiva e preencher o checklist. No celular, o técnico sempre executa as preventivas atribuídas a ele.',
    category: 'Ações',
    area: 'preventiva',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': true }
  },
  sign_order: {
    id: 'sign_order',
    name: 'Assinar e concluir preventivas',
    description: 'Computador: colher a assinatura e concluir a preventiva. No celular, o técnico sempre conclui as preventivas atribuídas a ele.',
    category: 'Ações',
    area: 'preventiva',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': true }
  },
  preventive_pdf: {
    id: 'preventive_pdf',
    name: 'Baixar PDF da preventiva',
    description: 'Computador e celular: botão PDF da preventiva — o PDF mapeado do modelo ou, se o modelo não tiver, o PDF padrão (checklist, execução e assinatura). Sem valores em R$.',
    category: 'Ações',
    area: 'preventiva',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': true }
  },
  delete_order: {
    id: 'delete_order',
    name: 'Excluir / cancelar preventivas',
    description: 'Excluir preventivas e o histórico delas.',
    category: 'Ações',
    area: 'preventiva',
    roles: { 'Super Administrador': true, 'Administrador': false, 'Profissional': false }
  },
  view_templates: {
    id: 'view_templates',
    name: 'Ver Modelos e Protocolos',
    description: 'PMOC › Modelos e Protocolos: tipos e ciclo, modelos e disparo (só olhar).',
    category: 'Abas',
    area: 'preventiva',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': false }
  },
  manage_templates: {
    id: 'manage_templates',
    name: 'Criar e editar modelos de preventiva',
    description: 'Criar e editar modelos, checklists e periodicidades.',
    category: 'Ações',
    area: 'preventiva',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': false }
  },
  delete_templates: {
    id: 'delete_templates',
    name: 'Excluir modelos de preventiva',
    description: 'Excluir modelos de preventiva e de vistoria.',
    category: 'Ações',
    area: 'preventiva',
    roles: { 'Super Administrador': true, 'Administrador': false, 'Profissional': false }
  },
  dispatch_orders: {
    id: 'dispatch_orders',
    name: 'Disparar preventivas do mês',
    description: 'Gerar as preventivas e vistorias do mês a partir dos modelos, nas gerências do perfil.',
    category: 'Ações',
    area: 'preventiva',
    roles: { 'Super Administrador': true, 'Administrador': false, 'Profissional': false }
  },
  os_view: {
    id: 'os_view',
    name: 'Ver OS',
    description: 'Ordens de Serviço › Corretivas, Layout e Acompanhamento (lista das gerências do perfil).',
    category: 'Abas',
    area: 'os',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': false }
  },
  os_create: {
    id: 'os_create',
    name: 'Emitir OS (GLPI)',
    description: 'Abrir OS de corretiva, layout e acompanhamento, com qualquer modelo, só na gerência da pessoa (Super Administrador e gerência "Todas" escolhem).',
    category: 'Ações',
    area: 'os',
    roles: { 'Super Administrador': true, 'Administrador': false, 'Profissional': false }
  },
  os_assign: {
    id: 'os_assign',
    name: 'Atribuir técnico / equipe nas OS',
    description: 'Escolher quem executa a OS.',
    category: 'Ações',
    area: 'os',
    roles: { 'Super Administrador': true, 'Administrador': false, 'Profissional': false }
  },
  os_edit: {
    id: 'os_edit',
    name: 'Editar OS',
    description: 'Alterar os dados da abertura (inclusive a empresa) enquanto a OS está "Nova". Cada alteração fica na linha do tempo.',
    category: 'Ações',
    area: 'os',
    roles: { 'Super Administrador': true, 'Administrador': false, 'Profissional': false }
  },
  os_cancel: {
    id: 'os_cancel',
    name: 'Cancelar OS',
    description: 'Cancelar uma OS informando o motivo (some do celular do técnico).',
    category: 'Ações',
    area: 'os',
    roles: { 'Super Administrador': true, 'Administrador': false, 'Profissional': false }
  },
  os_client_link: {
    id: 'os_client_link',
    name: 'Enviar link de validação ao cliente',
    description: 'Computador e celular: gerar, copiar e enviar por e-mail o link para o cliente validar ou contestar a OS (quem não tem não vê o link). Assinar no celular do técnico não depende desta permissão.',
    category: 'Ações',
    area: 'os',
    roles: { 'Super Administrador': true, 'Administrador': false, 'Profissional': false }
  },
  os_contest_reply: {
    id: 'os_contest_reply',
    name: 'Responder contestação de OS',
    description: 'Quando o cliente contesta pelo link: informar o que foi resolvido (e acrescentar o que faltou) para o cliente validar de novo. O técnico da OS sempre pode.',
    category: 'Ações',
    area: 'os',
    roles: { 'Super Administrador': true, 'Administrador': false, 'Profissional': false }
  },
  os_templates: {
    id: 'os_templates',
    name: 'Criar e editar modelos de OS',
    description: 'Configurações › Modelos de OS (perguntas de criação e execução, campos do sistema, assinaturas).',
    category: 'Ações',
    area: 'os',
    roles: { 'Super Administrador': true, 'Administrador': false, 'Profissional': false }
  },
  os_export: {
    id: 'os_export',
    name: 'Exportar OS (planilha e backup ZIP)',
    description: 'Computador: ficha da OS em planilha (XLSX), exportar a planilha da lista e o backup das concluídas em ZIP.',
    category: 'Ações',
    area: 'os',
    roles: { 'Super Administrador': true, 'Administrador': false, 'Profissional': false }
  },
  os_pdf: {
    id: 'os_pdf',
    name: 'Baixar PDF da OS',
    description: 'Computador (ficha da OS) e celular do técnico (botão PDF na OS): o PDF mapeado do modelo ou, se o modelo não tiver, o PDF padrão. Sem valores em R$.',
    category: 'Ações',
    area: 'os',
    roles: { 'Super Administrador': true, 'Administrador': false, 'Profissional': false }
  },
  view_solicitations: {
    id: 'view_solicitations',
    name: 'Ver solicitações',
    description: 'Acesso à tela Solicitações.',
    category: 'Abas',
    area: 'solicitacoes',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': true }
  },
  material_requests_view: {
    id: 'material_requests_view',
    name: 'Ver pedidos de material',
    description: 'Solicitações › Material: ver os pedidos de material do MP feitos pelos técnicos (das gerências e empresas do perfil).',
    category: 'Ações',
    area: 'solicitacoes',
    roles: { 'Super Administrador': true, 'Administrador': false, 'Profissional': false }
  },
  material_requests_decide: {
    id: 'material_requests_decide',
    name: 'Aprovar / reprovar pedidos de material',
    description: 'Aprovar (almoxarifado, nº da RM e quantidade fornecida de cada item) ou reprovar (motivo) os pedidos de material do MP.',
    category: 'Ações',
    area: 'solicitacoes',
    roles: { 'Super Administrador': true, 'Administrador': false, 'Profissional': false }
  },
  supply_requests_view: {
    id: 'supply_requests_view',
    name: 'Ver pedidos de insumos',
    description: 'Solicitações › Insumos: ver os pedidos de insumos das gerências do perfil (sem confirmar).',
    category: 'Abas',
    area: 'solicitacoes',
    roles: { 'Super Administrador': true, 'Administrador': false, 'Profissional': false }
  },
  supply_requests_confirm: {
    id: 'supply_requests_confirm',
    name: 'Confirmar pedidos de insumos',
    description: 'Confirmar (vai para o almoxarifado) ou reprovar (motivo) os pedidos de insumos dos técnicos.',
    category: 'Ações',
    area: 'solicitacoes',
    roles: { 'Super Administrador': true, 'Administrador': false, 'Profissional': false }
  },
  supply_requests_supply: {
    id: 'supply_requests_supply',
    name: 'Fornecer insumos (almoxarifado)',
    description: 'Menu Almoxarifado: fornecer os pedidos de insumos confirmados (quantidade de cada item) ou recusar (motivo).',
    category: 'Abas',
    area: 'solicitacoes',
    roles: { 'Super Administrador': true, 'Administrador': false, 'Profissional': false }
  },
  manage_solicitations: {
    id: 'manage_solicitations',
    name: 'Decidir solicitações de corretiva',
    description: 'Decidir as solicitações vindas das preventivas: "Abrir corretiva" (nº do GLPI) ou "Não abrir" (justificativa), e corrigir esses textos.',
    category: 'Ações',
    area: 'solicitacoes',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': false }
  },
  view_assets: {
    id: 'view_assets',
    name: 'Ver ativos',
    description: 'Acesso à Gestão de Ativos.',
    category: 'Abas',
    area: 'cadastros',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': true }
  },
  create_asset: {
    id: 'create_asset',
    name: 'Cadastrar e editar ativos',
    description: 'Cadastrar ativos e atualizar as especificações.',
    category: 'Ações',
    area: 'cadastros',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': false }
  },
  delete_asset: {
    id: 'delete_asset',
    name: 'Excluir ativos',
    description: 'Remover ativos definitivamente.',
    category: 'Ações',
    area: 'cadastros',
    roles: { 'Super Administrador': true, 'Administrador': false, 'Profissional': false }
  },
  import_assets: {
    id: 'import_assets',
    name: 'Importar planilha de ativos',
    description: 'Importação em massa de ativos (XLSX).',
    category: 'Ações',
    area: 'cadastros',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': false }
  },
  view_materials: {
    id: 'view_materials',
    name: 'Ver materiais',
    description: 'Acesso à Gestão de Materiais (gerências do perfil).',
    category: 'Abas',
    area: 'cadastros',
    roles: { 'Super Administrador': true, 'Administrador': false, 'Profissional': false }
  },
  manage_materials: {
    id: 'manage_materials',
    name: 'Cadastrar e importar materiais',
    description: 'Cadastrar, editar, alterar o valor e importar a planilha de materiais das gerências do perfil.',
    category: 'Ações',
    area: 'cadastros',
    roles: { 'Super Administrador': true, 'Administrador': false, 'Profissional': false }
  },
  view_supplies: {
    id: 'view_supplies',
    name: 'Ver insumos',
    description: 'Acesso à Gestão de Insumos (gerências do perfil).',
    category: 'Abas',
    area: 'cadastros',
    roles: { 'Super Administrador': true, 'Administrador': false, 'Profissional': false }
  },
  manage_supplies: {
    id: 'manage_supplies',
    name: 'Cadastrar e importar insumos',
    description: 'Cadastrar, editar, alterar o valor e importar a planilha de insumos das gerências do perfil.',
    category: 'Ações',
    area: 'cadastros',
    roles: { 'Super Administrador': true, 'Administrador': false, 'Profissional': false }
  },
  view_costs: {
    id: 'view_costs',
    name: 'Ver valores em R$',
    description: 'Computador e celular: ver valores em reais (homem-hora, hora extra, pernoite, materiais e insumos) nas telas e relatórios. Sem ela, o técnico não vê o custo da preventiva no celular.',
    category: 'Ações',
    area: 'valores',
    roles: { 'Super Administrador': true, 'Administrador': false, 'Profissional': false }
  }
};

// Ordem das áreas na tela de perfis
export const PERMISSION_AREAS: { id: PermissionArea; label: string; hint?: string }[] = [
  { id: 'preventiva', label: 'Preventiva / PMOC' },
  { id: 'os', label: 'OS (corretiva, layout e acompanhamento)', hint: 'As marcadas "em construção" passam a valer quando o módulo ficar pronto.' },
  { id: 'solicitacoes', label: 'Solicitações' },
  { id: 'cadastros', label: 'Cadastros' },
  { id: 'valores', label: 'Valores' }
];

// Permissões novas que nasceram de uma antiga: perfis que ainda não as têm gravadas herdam o valor da antiga
// (assim ninguém perde nem ganha acesso na troca)
export const DERIVED_PERMISSIONS: Record<string, string> = {
  view_pmoc_planning: 'view_service_orders',
  plan_orders: 'view_service_orders',
  preventive_pdf: 'execute_order', // ajustes da etapa 8: quem executa o checklist já vem podendo baixar o PDF
  os_pdf: 'os_export'               // o PDF da OS saiu de "Exportar OS": quem exportava continua baixando o PDF
};

let cachePermissions: { [key: string]: SystemPermission } | null = null;
let cachePermissionsFromFirebase = false;

export function clearPermissionsCache(): void {
  cachePermissions = null;
  cachePermissionsFromFirebase = false;
}

export async function dbGetPermissions(): Promise<{ [key: string]: SystemPermission }> {
  let localData: { [key: string]: SystemPermission } | null = null;
  try {
    const saved = localStorage.getItem('hexon_permissions_matrix');
    if (saved) {
      localData = JSON.parse(saved);
    }
  } catch (e) {
    console.warn('Error reading permissions from localStorage:', e);
  }

  // Check if in-memory cache OR local storage cache is valid
  if (cachePermissions !== null && (!firebaseActive || !dbInstance || cachePermissionsFromFirebase)) {
    return { ...cachePermissions };
  }
  if (isCacheValid('permissions') && localData) {
    cachePermissions = { ...DEFAULT_PERMISSIONS, ...localData };
    cachePermissionsFromFirebase = true;
    return { ...cachePermissions };
  }

  if (firebaseActive && dbInstance) {
    try {
      const docRef = doc(dbInstance, 'config', 'permissions');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data && data.permissions) {
          // Merge with default permissions to ensure newly added actions/Tabs are dynamically present even with older db states
          cachePermissions = { ...DEFAULT_PERMISSIONS, ...(data.permissions as { [key: string]: SystemPermission }) };
          cachePermissionsFromFirebase = true;
          updateCacheTimestamp('permissions');
          try {
            localStorage.setItem('hexon_permissions_matrix', JSON.stringify(cachePermissions));
          } catch (lsErr) {
            console.warn('LocalStorage limit storing permissions:', lsErr);
          }
          return { ...cachePermissions };
        }
      } else {
        // Doc doesnt exist, save initial default permissions
        await setDoc(docRef, { permissions: DEFAULT_PERMISSIONS });
        cachePermissions = DEFAULT_PERMISSIONS;
        cachePermissionsFromFirebase = true;
        updateCacheTimestamp('permissions');
        try {
          localStorage.setItem('hexon_permissions_matrix', JSON.stringify(cachePermissions));
        } catch (lsErr) {
          console.warn('LocalStorage limit storing standard permissions:', lsErr);
        }
        return { ...cachePermissions };
      }
    } catch (err: any) {
      console.warn('Could not fetch permissions from Firestore. Using fallback:', err);
      checkQuotaException(err);
    }
  }

  // Merge localData with DEFAULT_PERMISSIONS
  cachePermissions = localData ? { ...DEFAULT_PERMISSIONS, ...localData } : { ...DEFAULT_PERMISSIONS };
  cachePermissionsFromFirebase = false;
  try {
    localStorage.setItem('hexon_permissions_matrix', JSON.stringify(cachePermissions));
  } catch (lsErr) {
    console.warn('Fallback write error for permissions matrix:', lsErr);
  }
  return { ...cachePermissions };
}

export async function dbSavePermissions(permissions: { [key: string]: SystemPermission }): Promise<void> {
  // Ensure 'Super Administrador' is always true for everything to prevent lockout scenario
  const sanitizedPermissions = { ...permissions };
  Object.keys(sanitizedPermissions).forEach(key => {
    if (sanitizedPermissions[key] && sanitizedPermissions[key].roles) {
      sanitizedPermissions[key].roles['Super Administrador'] = true;
    }
  });

  cachePermissions = sanitizedPermissions;

  try {
    localStorage.setItem('hexon_permissions_matrix', JSON.stringify(cachePermissions));
  } catch (lsErr) {
    console.warn('LocalStorage limit saving permissions:', lsErr);
  }

  if (firebaseActive && dbInstance) {
    try {
      const docRef = doc(dbInstance, 'config', 'permissions');
      await setDoc(docRef, { permissions: sanitizedPermissions });
    } catch (err: any) {
      console.warn('Firestore write config/permissions failed:', err);
      checkQuotaException(err);
    }
  }
}

// 7.1 Regras de Periodicidade Customizadas (persistência em nuvem)
export async function dbGetPeriodicityRules(): Promise<Array<{ keyword: string; selectPeriodicities: ('Mensal' | 'Trimestral' | 'Semestral' | 'Anual')[] }>> {
  if (firebaseActive && dbInstance) {
    try {
      const docRef = doc(dbInstance, 'config', 'periodicity_rules');
      const snap = await getDoc(docRef);
      if (snap.exists() && snap.data()?.rules) {
        return snap.data()!.rules;
      }
    } catch (e) {
      console.warn('Não foi possível ler periodicity_rules do Firestore:', e);
    }
  }
  try {
    const saved = localStorage.getItem('hexon_periodicity_rules');
    if (saved) return JSON.parse(saved);
  } catch {}
  return [
    { keyword: 'ACJ', selectPeriodicities: ['Mensal', 'Semestral'] },
    { keyword: 'QUADRO ELÉTRICO', selectPeriodicities: ['Mensal', 'Trimestral', 'Anual'] },
    { keyword: 'AR CONDICIONADO', selectPeriodicities: ['Mensal', 'Semestral', 'Anual'] },
    { keyword: 'CHILLER', selectPeriodicities: ['Mensal', 'Semestral', 'Anual'] },
    { keyword: 'BOMBA', selectPeriodicities: ['Mensal', 'Semestral'] },
    { keyword: 'EXTINTOR', selectPeriodicities: ['Mensal', 'Anual'] },
    { keyword: 'PREDIAL', selectPeriodicities: ['Semestral', 'Anual'] },
    { keyword: 'CIVIL', selectPeriodicities: ['Semestral', 'Anual'] },
  ];
}

export async function dbSavePeriodicityRules(rules: Array<{ keyword: string; selectPeriodicities: ('Mensal' | 'Trimestral' | 'Semestral' | 'Anual')[] }>): Promise<void> {
  try {
    localStorage.setItem('hexon_periodicity_rules', JSON.stringify(rules));
  } catch {}
  if (firebaseActive && dbInstance) {
    try {
      const docRef = doc(dbInstance, 'config', 'periodicity_rules');
      await setDoc(docRef, { rules });
    } catch (e) {
      console.warn('Não foi possível salvar periodicity_rules no Firestore:', e);
    }
  }
}

// 7.2 Campos Personalizados Dinâmicos de Ativos (persistência em nuvem)
export async function dbGetCustomDynamicFields(): Promise<string[]> {
  if (firebaseActive && dbInstance) {
    try {
      const docRef = doc(dbInstance, 'config', 'custom_fields');
      const snap = await getDoc(docRef);
      if (snap.exists() && snap.data()?.fields) {
        return snap.data()!.fields;
      }
    } catch (e) {
      console.warn('Não foi possível ler custom_fields do Firestore:', e);
    }
  }
  try {
    const saved = localStorage.getItem('HEXON_CUSTOM_FIELDS');
    if (saved) return JSON.parse(saved);
  } catch {}
  return [
    'STATUS',
    'DATA DE AQUISIÇÃO',
    'VALOR DE AQUISIÇÃO',
    'VALOR LÍQUIDO'
  ];
}

export async function dbSaveCustomDynamicFields(fields: string[]): Promise<void> {
  try {
    localStorage.setItem('HEXON_CUSTOM_FIELDS', JSON.stringify(fields));
  } catch {}
  if (firebaseActive && dbInstance) {
    try {
      const docRef = doc(dbInstance, 'config', 'custom_fields');
      await setDoc(docRef, { fields });
    } catch (e) {
      console.warn('Não foi possível salvar custom_fields no Firestore:', e);
    }
  }
}
