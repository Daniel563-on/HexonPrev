import { doc, getDoc, setDoc } from 'firebase/firestore';
import { SystemPermission } from '../types';
import {
  firebaseActive,
  dbInstance,
  isCacheValid,
  updateCacheTimestamp,
  checkQuotaException
} from './core';

export const DEFAULT_PERMISSIONS: { [key: string]: SystemPermission } = {
  view_dashboard: {
    id: 'view_dashboard',
    name: 'Visualizar Dashboard',
    description: 'Acesso à aba principal com indicadores de desempenho e gráficos.',
    category: 'Abas',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': true }
  },
  view_service_orders: {
    id: 'view_service_orders',
    name: 'Visualizar Ordens de Serviço',
    description: 'Acesso à listagem e detalhes das Ordens de Serviço (preventivas e corretivas).',
    category: 'Abas',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': true }
  },
  view_assets: {
    id: 'view_assets',
    name: 'Visualizar Ativos',
    description: 'Acesso ao inventário e ficha técnica de ativos e equipamentos.',
    category: 'Abas',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': true }
  },
  view_templates: {
    id: 'view_templates',
    name: 'Visualizar Modelos e Protocolos',
    description: 'Acesso às diretrizes e planos de preventivas cadastradas.',
    category: 'Abas',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': false }
  },
  view_solicitations: {
    id: 'view_solicitations',
    name: 'Visualizar Solicitações',
    description: 'Visualizar chamados e demandas enviadas pelo cliente.',
    category: 'Abas',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': true }
  },
  create_asset: {
    id: 'create_asset',
    name: 'Adicionar e Editar Ativos',
    description: 'Cadastrar novos equipamentos ou atualizar as especificações de ativos existentes.',
    category: 'Ações',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': false }
  },
  delete_asset: {
    id: 'delete_asset',
    name: 'Excluir Ativos',
    description: 'Remover definitivamente ativos do acervo e históricos.',
    category: 'Ações',
    roles: { 'Super Administrador': true, 'Administrador': false, 'Profissional': false }
  },
  import_assets: {
    id: 'import_assets',
    name: 'Importar Planilha XLSX de Ativos',
    description: 'Gerar importação em massa de novos ativos do sistema.',
    category: 'Ações',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': false }
  },
  create_order: {
    id: 'create_order',
    name: 'Abertura de Novas O.S.',
    description: 'Registrar novas preventivas ou corretivas emergenciais de ativos.',
    category: 'Ações',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': false }
  },
  execute_order: {
    id: 'execute_order',
    name: 'Executar Checklists de O.S.',
    description: 'Preencher status das tarefas de manutenção em campo e registrar observações.',
    category: 'Ações',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': true }
  },
  sign_order: {
    id: 'sign_order',
    name: 'Assinar e Encerrar O.S.',
    description: 'Colher assinatura do cliente e validar a entrega de preventivas e corretivas.',
    category: 'Ações',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': true }
  },
  delete_order: {
    id: 'delete_order',
    name: 'Excluir / Cancelar O.S.',
    description: 'Excluir ordens e históricos de intervenção técnica.',
    category: 'Ações',
    roles: { 'Super Administrador': true, 'Administrador': false, 'Profissional': false }
  },
  manage_templates: {
    id: 'manage_templates',
    name: 'Configurar Modelos de Cronograma',
    description: 'Criar e editar roteiros e frequências de preventivas.',
    category: 'Ações',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': false }
  },
  manage_solicitations: {
    id: 'manage_solicitations',
    name: 'Operar Chamados (Abrir/Cancelar)',
    description: 'Permite que usuários confirmem, abram chamados corretivos ou cancelem solicitações de avarias.',
    category: 'Ações',
    roles: { 'Super Administrador': true, 'Administrador': true, 'Profissional': false }
  }
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
