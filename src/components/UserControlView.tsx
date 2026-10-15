// UserControlView.tsx - Hexon RBAC User & Logs Console
import React, { useState, useEffect } from 'react';
import { 
  dbGetUsers, 
  dbSaveUser, 
  dbDeleteUser, 
  dbGetManagements, 
  dbAddAuditLog,
  dbGetPermissions,
  dbSavePermissions,
  createAuthAccountForUser,
  matriculaToAuthEmail,
  dbLinkAuthUid,
  adminResetUserPassword,
  dbGetProfiles,
  resolveUserProfile,
  legacyPerfilOf,
  SYSTEM_PROFILE_IDS,
  dbGetJobRoles,
  dbRemoveImportedPersonForUser,
  dbGetCompanies,
  companiesOfUnit,
  companyNames,
  dbGetAddresses
} from '../db/firebase';
import { AccessProfile, Company, HexonUser, JobRole, Management, SystemPermission } from '../types';
import { LOCAL_TECH_UNIT } from '../lib/localTech';
import ProfilesTab from './users/ProfilesTab';
import { dbBumpDataVersion } from '../db/appControl';
import WorkforceTab from './users/WorkforceTab';

interface UserControlViewProps {
  currentUserProfile: HexonUser;
  darkMode: boolean;
}

export default function UserControlView({ currentUserProfile, darkMode }: UserControlViewProps) {
  const [activeSubTab, setActiveSubTab] = useState<'users' | 'permissions' | 'workforce'>('users');
  
  // Lists state
  const [users, setUsers] = useState<HexonUser[]>([]);
  const [managements, setManagements] = useState<Management[]>([]);
  const [permissionsMatrix, setPermissionsMatrix] = useState<{ [key: string]: SystemPermission }>({});
  const [isSavingPermissions, setIsSavingPermissions] = useState(false);
  const [profiles, setProfiles] = useState<AccessProfile[]>([]);
  const [jobRoles, setJobRoles] = useState<JobRole[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]); // empresas contratadas (etapa especial E1)
  const [comarcas, setComarcas] = useState<{ craai: string; comarca: string }[]>([]); // técnico local (Lote 2): da lista de endereços
  const activeJobRoles = jobRoles.filter((r) => !r.archived); // cargos que existem hoje no sistema
  const [customCargo, setCustomCargo] = useState(false); // digitando um cargo novo no cadastro do usuário
  const [saveNotice, setSaveNotice] = useState<string | null>(null); // aviso após salvar (a janela de alerta é bloqueada no preview)

  const [isLoading, setIsLoading] = useState(false);

  // User form modal state
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<HexonUser | null>(null);
  const [userModalError, setUserModalError] = useState<string | null>(null);
  const [isSavingUser, setIsSavingUser] = useState(false);
  const [userForm, setUserForm] = useState({
    name: '',
    matricula: '',
    email: '',
    cargo: '',
    gerencia: '',
    perfil: 'Profissional' as HexonUser['perfil'],
    profileId: SYSTEM_PROFILE_IDS.execucao as string,
    status: 'Ativo' as HexonUser['status'],
    senha: '123456',
    companies: [] as string[],
    localTech: false,
    localComarca: ''
  });
  // Técnico (perfil escolhido) e técnico local (Lote 2): a gerência fica DOM travada
  const formIsTech = legacyPerfilOf(profiles.find((pr) => pr.id === userForm.profileId)?.kind || 'execucao') === 'Profissional';
  const localLocked = formIsTech && userForm.localTech;
  const hasLocalUnit = managements.some((m) => m.name === LOCAL_TECH_UNIT);

  // Filter query state
  const [searchQuery, setSearchQuery] = useState('');

  // Reusable custom confirmation modal state for iFrame sandbox compatibility
  const [genericConfirm, setGenericConfirm] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ show: false, title: '', message: '', onConfirm: () => {} });

  // Load All configurations on mount
  useEffect(() => {
    loadAllData();
  }, [activeSubTab]);

  const loadAllData = async (force: boolean = false) => {
    setIsLoading(true);
    try {
      if (activeSubTab === 'users' || activeSubTab === 'permissions' || activeSubTab === 'workforce') {
        const uList = await dbGetUsers(force);
        setUsers(uList);
        const mList = await dbGetManagements();
        setManagements(mList);
        setProfiles(await dbGetProfiles(force, true));
        if (activeSubTab === 'users') setJobRoles(await dbGetJobRoles(force));
        if (activeSubTab === 'users') setCompanies(await dbGetCompanies(force).catch(() => []));
        if (activeSubTab === 'users') {
          // Comarcas da lista de endereços (ativos), agrupadas pela CRAAI: "Comarca onde atua" do técnico local
          const addrs = await dbGetAddresses().catch(() => []);
          const seen = new Map<string, { craai: string; comarca: string }>();
          addrs.filter((a) => a.active !== false && a.comarca).forEach((a) => seen.set(a.comarca.trim(), { craai: (a.craai || '').trim(), comarca: a.comarca.trim() }));
          setComarcas(Array.from(seen.values()).sort((a, b) => a.craai.localeCompare(b.craai) || a.comarca.localeCompare(b.comarca)));
        }
      }
    } catch (e) {
      console.error('Error loading RBAC settings:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const getNextSuggestedMatricula = (currentUsers: HexonUser[]): string => {
    let maxNum = 0;
    currentUsers.forEach(u => {
      const match = (u.matricula || '').match(/(\d+)$/);
      if (match) {
        const val = parseInt(match[1], 10);
        if (val > maxNum) maxNum = val;
      }
    });
    return `1-${String(maxNum + 1).padStart(4, '0')}`;
  };

  // User Management actions
  const handleOpenCreateUser = () => {
    setEditingUser(null);
    setUserModalError(null);
    const suggested = getNextSuggestedMatricula(users);
    setUserForm({
      name: '',
      matricula: suggested,
      email: '',
      cargo: '',
      gerencia: managements[0]?.name || '',
      perfil: 'Profissional',
      profileId: SYSTEM_PROFILE_IDS.execucao,
      status: 'Ativo',
      senha: '123456',
      companies: [],
      localTech: false,
      localComarca: ''
    });
    setCustomCargo(false);
    setIsUserModalOpen(true);
  };

  const handleOpenEditUser = (user: HexonUser) => {
    setEditingUser(user);
    setUserModalError(null);
    setUserForm({
      name: user.name,
      matricula: user.matricula,
      email: user.email,
      cargo: user.cargo,
      gerencia: user.gerencia,
      perfil: user.perfil,
      profileId: resolveUserProfile(user, profiles)?.id || SYSTEM_PROFILE_IDS.execucao,
      status: user.status,
      // If password is encrypted hash, keep empty in form unless admin enters a new one
      senha: user.senha?.startsWith('hexon_sha256:') ? '' : (user.senha || ''),
      companies: [...(user.companies || [])],
      localTech: user.localTech === true,
      localComarca: user.localComarca || ''
    });
    setCustomCargo(false);
    setIsUserModalOpen(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserModalError(null);

    const sanitizedMatricula = userForm.matricula.trim();
    if (!userForm.name.trim() || !sanitizedMatricula || !userForm.email.trim()) {
      setUserModalError('Preencha os campos obrigatórios (Nome, Matrícula e E-mail).');
      return;
    }

    if (!editingUser && (userForm.senha || '123456').length < 6) {
      setUserModalError('A senha inicial deve ter no mínimo 6 caracteres.');
      return;
    }

    // Trava de Matrícula Única: impede que outro usuário já possua a mesma matrícula
    const duplicate = users.find(
      u => u.matricula.trim().toLowerCase() === sanitizedMatricula.toLowerCase() && u.id !== editingUser?.id
    );
    if (duplicate) {
      setUserModalError(`A matrícula "${sanitizedMatricula}" já pertence ao colaborador "${duplicate.name}". Defina uma matrícula exclusiva.`);
      return;
    }

    // Técnico (Lote 2): sem "Todas"; técnico local = gerência DOM + comarca onde atua (obrigatória)
    const isTechForm = legacyPerfilOf(profiles.find((pr) => pr.id === userForm.profileId)?.kind || 'execucao') === 'Profissional';
    const localTech = isTechForm && userForm.localTech;
    if (isTechForm && !localTech && userForm.gerencia === 'Todas') {
      setUserModalError('Técnico não tem mais a gerência "Todas": escolha a gerência dele ou marque "Técnico local".');
      return;
    }
    if (localTech && userForm.gerencia !== LOCAL_TECH_UNIT) {
      setUserModalError(`Técnico local fica na gerência ${LOCAL_TECH_UNIT}: cadastre a gerência ${LOCAL_TECH_UNIT} em Configurações › Gerências.`);
      return;
    }
    if (localTech && !userForm.localComarca.trim()) {
      setUserModalError('Escolha a comarca onde o técnico local atua.');
      return;
    }

    // Empresa(s): só as que atuam na gerência do usuário; técnico = exatamente 1
    const formCompanies = userForm.companies.filter((id) => companiesOfUnit(companies, userForm.gerencia).some((c) => c.id === id));
    const formKind = profiles.find((pr) => pr.id === userForm.profileId)?.kind || 'execucao';
    if (companies.length > 0 && legacyPerfilOf(formKind) === 'Profissional' && formCompanies.length !== 1) {
      setUserModalError('Técnico precisa de exatamente 1 empresa (campo Empresa).');
      return;
    }
    // A5-B: quem ficou inativo junto com a empresa só volta ativo numa empresa ativa (é cadastrado na empresa nova)
    if (userForm.status === 'Ativo' && formCompanies.length > 0 && formCompanies.every((id) => companies.find((c) => c.id === id)?.active === false)) {
      setUserModalError('A empresa marcada está inativa: marque uma empresa ativa ou deixe o usuário inativo.');
      return;
    }

    setIsSavingUser(true);
    try {
      const targetId = editingUser ? editingUser.id : `u_${Date.now()}`;
      const finalSenha = editingUser ? '' : (userForm.senha || '123456');

      const newUser: HexonUser = {
        id: targetId,
        name: userForm.name.trim(),
        matricula: sanitizedMatricula,
        email: userForm.email.trim(),
        cargo: userForm.cargo.trim(),
        gerencia: userForm.gerencia,
        perfil: legacyPerfilOf(profiles.find((pr) => pr.id === userForm.profileId)?.kind || 'execucao'),
        profileId: userForm.profileId,
        status: userForm.status,
        senha: finalSenha,
        companies: formCompanies,
        localTech: localTech ? true : undefined,
        localComarca: localTech ? userForm.localComarca.trim() : undefined
      };

      await dbSaveUser(newUser);

      // Usuário do sistema tem prioridade: quem estava importado com a mesma matrícula sai do efetivo importado
      const replaced = await dbRemoveImportedPersonForUser(newUser).catch(() => null);
      setSaveNotice(
        replaced
          ? `Aviso: ${replaced.name} (matrícula ${replaced.matricula}) estava no efetivo importado e foi substituído por este usuário do sistema.`
          : null
      );

      if (!editingUser) {
        const result = await createAuthAccountForUser(matriculaToAuthEmail(newUser.matricula), finalSenha);
        if (result.uid) {
          await dbLinkAuthUid(newUser.id, result.uid);
        } else {
          const motivo = result.error === 'auth/email-already-in-use'
            ? `Já existe uma conta de acesso para ${matriculaToAuthEmail(newUser.matricula)}. Apague-a no Firebase Console (Authentication > Usuários) e use "Recriar acesso".`
            : `Motivo: ${result.error}. Use "Recriar acesso" depois.`;
          setEditingUser(newUser);
          setUserModalError(`Colaborador salvo, mas a conta de acesso NÃO foi criada. ${motivo}`);
          await loadAllData(true);
          setIsSavingUser(false);
          return;
        }
      }

      if (currentUserProfile.id === newUser.id) {
        const cached = localStorage.getItem('hexon_cached_user');
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            localStorage.setItem('hexon_cached_user', JSON.stringify({ ...parsed, ...newUser }));
          } catch {}
        }
      }

      await dbAddAuditLog({
        userMatricula: currentUserProfile.matricula,
        userName: currentUserProfile.name,
        action: editingUser ? 'Atualizou Usuário' : 'Criou Usuário',
        target: `users/${newUser.id}`,
        details: `${editingUser ? 'Editou' : 'Registrou'} o colaborador ${newUser.name} (Matrícula: ${newUser.matricula}, Perfil: ${newUser.perfil})`,
        timestamp: new Date().toISOString()
      });

      setIsUserModalOpen(false);
      dbBumpDataVersion(); // outros aparelhos abertos relêem os cadastros
      await loadAllData(true);
    } catch (err: any) {
      console.error(err);
      setUserModalError(err.message || 'Erro ao salvar os dados do colaborador no banco de dados.');
    } finally {
      setIsSavingUser(false);
    }
  };

  const handleRecreateAccess = (u: HexonUser) => {
    setGenericConfirm({
      show: true,
      title: 'Redefinir Senha',
      message: `Redefinir a senha de ${u.name} (matrícula ${u.matricula}) para a senha provisória 123456? As sessões abertas deste colaborador serão encerradas.`,
      onConfirm: async () => {
        const result = await adminResetUserPassword(u.id);
        if (!result.ok) {
          alert(result.error === 'functions/permission-denied'
            ? 'Erro: apenas Super Administrador pode redefinir senhas.'
            : `Erro ao redefinir a senha: ${result.error}`);
          return;
        }
        alert(`✅ Senha de ${u.name} redefinida. Senha provisória: 123456`);
        await loadAllData(true);
      }
    });
  };

  const handleDeleteUser = async (userId: string, userName: string) => {
    if (userId === currentUserProfile.id || userId === 'daniel_fab93') {
      alert('Você não pode excluir sua própria conta de administrador em uso.');
      return;
    }

    setGenericConfirm({
      show: true,
      title: 'Excluir Usuário',
      message: `Tem certeza que deseja excluir em definitivo o usuário "${userName}"? Esta ação removerá permanentemente o acesso deste colaborador do banco de dados.`,
      onConfirm: async () => {
        try {
          await dbDeleteUser(userId);
          await dbAddAuditLog({
            userMatricula: currentUserProfile.matricula,
            userName: currentUserProfile.name,
            action: 'Excluiu Usuário',
            target: `users/${userId}`,
            details: `Excluiu permanentemente o usuário ${userName}`,
            timestamp: new Date().toISOString()
          });
          dbBumpDataVersion();
          await loadAllData(true);
        } catch (err: any) {
          console.error('Erro ao excluir usuário:', err);
          alert(`Não foi possível excluir o usuário: ${err.message || 'Erro no banco de dados'}`);
        }
      }
    });
  };

  // Permissions Management handlers
  const handleTogglePermission = (permissionId: string, role: 'Administrador' | 'Profissional') => {
    setPermissionsMatrix(prev => {
      const target = prev[permissionId];
      if (!target) return prev;
      return {
        ...prev,
        [permissionId]: {
          ...target,
          roles: {
            ...target.roles,
            [role]: !target.roles[role]
          }
        }
      };
    });
  };

  const handleSavePermissions = async () => {
    setIsSavingPermissions(true);
    try {
      await dbSavePermissions(permissionsMatrix);
      await dbAddAuditLog({
        userMatricula: currentUserProfile.matricula,
        userName: currentUserProfile.name,
        action: 'Atualizou Permissões',
        target: 'config/permissions',
        details: 'Configurou a matriz de controle de acessos (RBAC)',
        timestamp: new Date().toISOString()
      });
      dbBumpDataVersion();
      alert('Permissões de acesso salvas com sucesso!');
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar as permissões.');
    } finally {
      setIsSavingPermissions(false);
    }
  };

  const renderPermissionRow = (p: SystemPermission) => {
    return (
      <tr key={p.id} className="hover:bg-slate-500/5 transition-colors border-b border-slate-100 dark:border-slate-800">
        <td className="p-4">
          <span className={`font-bold block ${darkMode ? 'text-slate-200' : 'text-slate-850'}`}>{p.name}</span>
          <span className="text-[10.5px] text-slate-400 dark:text-slate-500 block mt-0.5 leading-relaxed">{p.description}</span>
        </td>
        <td className="p-4 text-center">
          <div className="flex justify-center">
            <span className="material-symbols-outlined text-emerald-500 text-lg" title="Acesso garantido ao root">check_circle</span>
          </div>
        </td>
        <td className="p-4 text-center">
          <div className="flex justify-center">
            <input 
              type="checkbox"
              checked={p.roles['Administrador']}
              onChange={() => handleTogglePermission(p.id, 'Administrador')}
              className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500 dark:bg-slate-900 dark:border-slate-700 cursor-pointer"
            />
          </div>
        </td>
        <td className="p-4 text-center">
          <div className="flex justify-center">
            <input 
              type="checkbox"
              checked={p.roles['Profissional']}
              onChange={() => handleTogglePermission(p.id, 'Profissional')}
              className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500 dark:bg-slate-900 dark:border-slate-700 cursor-pointer"
            />
          </div>
        </td>
      </tr>
    );
  };

  // Search filtering
  const filteredUsers = users.filter(u => {
    const q = searchQuery.toLowerCase();
    return u.name.toLowerCase().includes(q) || 
           u.matricula.toLowerCase().includes(q) || 
           u.email.toLowerCase().includes(q) || 
           u.cargo.toLowerCase().includes(q) || 
           (resolveUserProfile(u, profiles)?.name || u.perfil).toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6 font-sans">
      
      {/* Header section with profile scope */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-4 border-slate-200 dark:border-slate-800">
        <div>
          <span className="px-2.5 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 rounded font-mono text-[10px] font-black uppercase tracking-wider">
            Nível: Super Administrador
          </span>
          <h2 className={`text-2xl font-black tracking-tight ${darkMode ? 'text-white' : 'text-slate-900'} mt-1`}>
            Usuários e Permissões
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Cadastro de usuários, perfis de acesso e efetivo, válidos para todo o sistema. As gerências ficam em Configurações › Gerências.
          </p>
        </div>

        {/* Action controls */}
        <div className="flex items-center gap-2">
          {activeSubTab === 'users' && (
            <button 
              onClick={handleOpenCreateUser}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
            >
              <span className="material-symbols-outlined text-[15px]">person_add</span>
              Novo Colaborador
            </button>
          )}
        </div>
      </div>

      {/* Sub Tabs Toggle navigation */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-1">
        <button
          onClick={() => { setActiveSubTab('users'); setSearchQuery(''); }}
          className={`px-5 py-3 text-xs font-bold text-left border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
            activeSubTab === 'users' 
              ? 'border-blue-600 text-blue-600' 
              : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
          }`}
        >
          <span className="material-symbols-outlined text-base">manage_accounts</span>
          Colaboradores e Perfis ({users.length})
        </button>
        <button
          onClick={() => { setActiveSubTab('permissions'); setSearchQuery(''); }}
          className={`px-5 py-3 text-xs font-bold text-left border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
            activeSubTab === 'permissions' 
              ? 'border-blue-600 text-blue-600' 
              : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
          }`}
        >
          <span className="material-symbols-outlined text-base">shield_lock</span>
          Perfis de Acesso
        </button>
        <button
          onClick={() => { setActiveSubTab('workforce'); setSearchQuery(''); }}
          className={`px-5 py-3 text-xs font-bold text-left border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
            activeSubTab === 'workforce' 
              ? 'border-blue-600 text-blue-600' 
              : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
          }`}
        >
          <span className="material-symbols-outlined text-base">groups</span>
          Efetivo
        </button>
      </div>

      {/* SEARCH AND FILTER BAR */}
      {saveNotice && activeSubTab === 'users' && (
        <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-xs font-bold flex items-start justify-between gap-3">
          <span>{saveNotice}</span>
          <button type="button" onClick={() => setSaveNotice(null)} className="cursor-pointer text-amber-700">✕</button>
        </div>
      )}

      {activeSubTab !== 'permissions' && activeSubTab !== 'workforce' && (
        <div className="flex relative">
          <span className={`material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-lg ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>
            search
          </span>
          <input
            type="text"
            placeholder={
              'Buscar colaborador por nome, matrícula, e-mail...'
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`w-full pl-10 pr-4 py-2.5 rounded-xl border text-xs font-medium outline-none transition-all ${
              darkMode 
                ? 'bg-[#0b1220] border-slate-800 text-slate-200 focus:border-blue-600' 
                : 'bg-white border-slate-200 text-slate-800 focus:border-blue-500'
            }`}
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="py-12 text-center">
          <svg className="animate-spin h-8 w-8 text-blue-600 mx-auto" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="text-slate-500 text-xs mt-2 block">Sincronizando cache de segurança corporativa...</span>
        </div>
      ) : (
        <>
          {/* TAB 1: GESTÃO DE USUÁRIOS */}
          {activeSubTab === 'users' && (
            <div className={`border rounded-xl overflow-hidden ${darkMode ? 'bg-[#0a1122]/40 border-slate-800' : 'bg-white border-slate-200'}`}>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className={`border-b text-[10px] font-black uppercase tracking-wider ${darkMode ? 'border-slate-850 bg-[#0e1628]/60 text-slate-400' : 'border-slate-100 bg-slate-50/70 text-slate-500'}`}>
                      <th className="py-3 px-4">Nome / Cargo</th>
                      <th className="py-3 px-4">Matrícula / E-mail</th>
                      <th className="py-3 px-4">Gerência</th>
                      <th className="py-3 px-4">Empresa</th>
                      <th className="py-3 px-4">Nível de Acesso</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-850 text-xs font-medium">
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-500 italic">
                          Nenhum colaborador localizado com os termos informados.
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((u) => (
                        <tr 
                          key={u.id}
                          className={`hover:bg-slate-50/40 dark:hover:bg-[#121c32]/25 duration-100 ${
                            u.status === 'Inativo' ? 'opacity-55' : ''
                          }`}
                        >
                          {/* Name / Cargo */}
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2.5">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-[11px] ${
                                u.perfil === 'Super Administrador' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' :
                                u.perfil === 'Administrador' ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300' :
                                'bg-slate-100 text-slate-700 dark:bg-slate-855 dark:text-slate-300'
                              }`}>
                                {u.name.split(' ').map(n => n[0]).slice(0, 2).join('')}
                              </div>
                              <div>
                                <span className={`font-bold block ${darkMode ? 'text-slate-200' : 'text-slate-900'}`}>{u.name}</span>
                                <span className="text-[10px] text-slate-500 block font-normal">{u.cargo || 'Não especificado'}</span>
                              </div>
                            </div>
                          </td>

                          {/* Matricula / Email */}
                          <td className="py-3 px-4">
                            <div>
                              <span className="font-mono text-[11px] font-bold block">{u.matricula}</span>
                              <span className="text-[10.5px] text-slate-500 block font-normal">{u.email}</span>
                            </div>
                          </td>

                          {/* Gerência */}
                          <td className="py-3 px-4">
                            <span className={`px-2 py-0.5 rounded font-bold text-[10.5px] ${
                              u.gerencia === 'Todas' ? 'bg-amber-500/10 text-amber-600' : 'bg-slate-500/10 text-slate-500'
                            }`}>
                              {u.gerencia}
                            </span>
                            {u.localTech && u.perfil === 'Profissional' && (
                              <span className="ml-1 px-2 py-0.5 rounded font-bold text-[10.5px] bg-emerald-500/10 text-emerald-700" title={u.localComarca ? `Atua em ${u.localComarca}` : undefined}>
                                técnico local{u.localComarca ? ` · ${u.localComarca}` : ''}
                              </span>
                            )}
                          </td>

                          {/* Empresa */}
                          <td className="py-3 px-4 text-[10.5px] font-bold text-slate-600">
                            {(u.companies || []).length ? companyNames(u.companies, companies) : <span className="text-slate-400 font-normal">—</span>}
                          </td>

                          {/* Perfil */}
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1">
                              <span className={`w-1.5 h-1.5 rounded-full ${
                                u.perfil === 'Super Administrador' ? 'bg-amber-500' :
                                u.perfil === 'Administrador' ? 'bg-indigo-600' : 'bg-blue-500'
                              }`} />
                              <span className="font-bold">{resolveUserProfile(u, profiles)?.name || u.perfil}</span>
                            </div>
                          </td>

                          {/* Status */}
                          <td className="py-3 px-4">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold ${
                              u.status === 'Ativo' 
                                ? 'bg-[#e2f9ec] text-[#1aa253] dark:bg-[#1aa253]/15 dark:text-[#42f58d]' 
                                : 'bg-rose-50 text-rose-700 dark:bg-rose-950/20 dark:text-rose-400'
                            }`}>
                              <span className={`w-1 h-1 rounded-full ${u.status === 'Ativo' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                              {u.status}
                            </span>
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button 
                                onClick={() => handleOpenEditUser(u)}
                                className={`p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-blue-600 transition-colors cursor-pointer`}
                                title="Editar Colaborador"
                              >
                                <span className="material-symbols-outlined text-[17px]">edit</span>
                              </button>
                              <button 
                                onClick={() => handleRecreateAccess(u)}
                                className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-amber-600 transition-colors cursor-pointer"
                                title="Redefinir senha (provisória 123456)"
                              >
                                <span className="material-symbols-outlined text-[17px]">lock_reset</span>
                              </button>
                              <button 
                                onClick={() => handleDeleteUser(u.id, u.name)}
                                className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                                title="Excluir Colaborador"
                              >
                                <span className="material-symbols-outlined text-[17px]">delete</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 4: EFETIVO */}
          {activeSubTab === 'workforce' && (
            <WorkforceTab
              users={users}
              managements={managements}
              profiles={profiles}
              currentUserName={currentUserProfile.name}
              darkMode={darkMode}
            />
          )}

          {/* TAB 3: PERFIS DE ACESSO */}
          {activeSubTab === 'permissions' && (
            <ProfilesTab
              profiles={profiles}
              managements={managements}
              users={users}
              darkMode={darkMode}
              onChanged={() => { dbBumpDataVersion(); loadAllData(true); }}
            />
          )}

        </>
      )}

      {/* MODAL 1: COLLABORATOR USER DETAIL */}
      {isUserModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-101 flex items-center justify-center p-4">
          <div className={`w-full max-w-lg max-h-full flex flex-col rounded-2xl shadow-xl overflow-hidden animate-fade-in ${darkMode ? 'bg-[#0a1122] border border-slate-800 text-white' : 'bg-white text-slate-900'}`}>
            <div className="shrink-0 px-6 py-4 border-b border-slate-150 dark:border-slate-800 flex justify-between items-center bg-slate-50/40 dark:bg-slate-900/30">
              <h4 className="font-black text-sm uppercase tracking-wider flex items-center gap-2">
                <span className="material-symbols-outlined text-lg text-blue-500">account_circle</span>
                {editingUser ? 'Editar Conta de Colaborador' : 'Registrar Novo Colaborador'}
              </h4>
              <button 
                onClick={() => setIsUserModalOpen(false)}
                className="p-1 rounded-full text-slate-400 hover:bg-slate-500/10 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            
            <form onSubmit={handleSaveUser} className="flex-1 min-h-0 flex flex-col">
              {/* Só o meio rola: título e botões ficam sempre na tela */}
              <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">

              <div className="grid grid-cols-2 gap-4">
                {/* Full name */}
                <div className="col-span-2">
                  <label className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Nome Completo *</label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Carlos Gabriel Silva"
                    value={userForm.name}
                    onChange={(e) => {
                      setUserForm({...userForm, name: e.target.value});
                      if (userModalError) setUserModalError(null);
                    }}
                    className={`w-full text-xs font-semibold px-3 py-2 border rounded-lg outline-none ${
                      darkMode ? 'bg-[#121b2d] border-slate-800 focus:border-blue-500' : 'bg-white border-slate-200 focus:border-blue-500'
                    }`}
                  />
                </div>

                {/* Matricula */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Matrícula Corporativa *</label>
                    {!editingUser && userForm.matricula.trim() && (
                      users.some(u => u.matricula.trim().toLowerCase() === userForm.matricula.trim().toLowerCase()) ? (
                        <span className="text-[10px] font-bold text-rose-500 flex items-center gap-1">
                          <span className="material-symbols-outlined text-xs">error</span> Em uso
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold text-emerald-500 flex items-center gap-1">
                          <span className="material-symbols-outlined text-xs">check_circle</span> Liberada
                        </span>
                      )
                    )}
                  </div>
                  <input
                    type="text"
                    required
                    placeholder="Ex: 1-0003"
                    disabled={!!editingUser}
                    value={userForm.matricula}
                    onChange={(e) => {
                      setUserForm({...userForm, matricula: e.target.value});
                      if (userModalError) setUserModalError(null);
                    }}
                    className={`w-full text-xs font-semibold px-3 py-2 border rounded-lg outline-none transition-colors ${
                      !editingUser && userForm.matricula.trim() && users.some(u => u.matricula.trim().toLowerCase() === userForm.matricula.trim().toLowerCase())
                        ? 'border-rose-500 bg-rose-500/5 focus:border-rose-500'
                        : darkMode ? 'bg-[#121b2d] border-slate-800 focus:border-blue-500' : 'bg-white border-slate-200 focus:border-blue-500'
                    } ${editingUser ? 'opacity-50 cursor-not-allowed ' : ''}`}
                  />
                  {!editingUser && userForm.matricula.trim() && users.some(u => u.matricula.trim().toLowerCase() === userForm.matricula.trim().toLowerCase()) && (
                    <p className="text-[10px] text-rose-500 font-medium mt-1">
                      Esta matrícula já está em uso. Defina uma matrícula única.
                    </p>
                  )}
                </div>

                {/* Password input */}
                {!editingUser ? (
                  <div>
                    <label className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                      Senha de Acesso *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Senha inicial de acesso"
                      value={userForm.senha}
                      onChange={(e) => {
                        setUserForm({...userForm, senha: e.target.value});
                        if (userModalError) setUserModalError(null);
                      }}
                      className={`w-full text-xs font-semibold px-3 py-2 border rounded-lg outline-none ${
                        darkMode ? 'bg-[#121b2d] border-slate-800 focus:border-blue-500' : 'bg-white border-slate-200 focus:border-blue-500'
                      }`}
                    />
                  </div>
                ) : (
                  <p className="text-[10.5px] text-slate-500">Para redefinir a senha deste colaborador, use o botão de cadeado (Recriar acesso) na lista.</p>
                )}

                {/* Contact Email */}
                <div className="col-span-2">
                  <label className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">E-mail Corporativo *</label>
                  <input
                    type="email"
                    required
                    placeholder="Ex: carlos.silva@hexon.com"
                    value={userForm.email}
                    onChange={(e) => {
                      setUserForm({...userForm, email: e.target.value});
                      if (userModalError) setUserModalError(null);
                    }}
                    className={`w-full text-xs font-semibold px-3 py-2 border rounded-lg outline-none ${
                      darkMode ? 'bg-[#121b2d] border-slate-800 focus:border-blue-500' : 'bg-white border-slate-200 focus:border-blue-500'
                    }`}
                  />
                </div>

                {/* Cargo */}
                <div>
                  <label className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Cargo / Função</label>
                  {activeJobRoles.length > 0 && !customCargo ? (
                    // Só os cargos que existem hoje no sistema (aba Efetivo > Cargos); "Outro" permite digitar um cargo novo
                    <select
                      value={userForm.cargo}
                      onChange={(e) => {
                        if (e.target.value === '__outro__') {
                          setCustomCargo(true);
                          setUserForm({ ...userForm, cargo: '' });
                        } else {
                          setUserForm({ ...userForm, cargo: e.target.value });
                        }
                      }}
                      className={`w-full text-xs font-semibold px-3 py-2 border rounded-lg outline-none ${
                        darkMode ? 'bg-[#121b2d] border-slate-800' : 'bg-white border-slate-200'
                      }`}
                    >
                      <option value="">Selecione o cargo...</option>
                      {userForm.cargo && !activeJobRoles.some((r) => r.name === userForm.cargo) && (
                        <option value={userForm.cargo}>{userForm.cargo}</option>
                      )}
                      {activeJobRoles.map((r) => (
                        <option key={r.id} value={r.name}>{r.name}</option>
                      ))}
                      <option value="__outro__">+ Outro cargo (digitar)</option>
                    </select>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Ex: Técnico"
                        value={userForm.cargo}
                        onChange={(e) => setUserForm({...userForm, cargo: e.target.value})}
                        className={`w-full text-xs font-semibold px-3 py-2 border rounded-lg outline-none ${
                          darkMode ? 'bg-[#121b2d] border-slate-800' : 'bg-white border-slate-200'
                        }`}
                      />
                      {activeJobRoles.length > 0 && (
                        <button
                          type="button"
                          onClick={() => { setCustomCargo(false); setUserForm({ ...userForm, cargo: '' }); }}
                          className="px-2 text-[10px] font-bold text-slate-500 border border-slate-200 rounded-lg cursor-pointer shrink-0"
                          title="Voltar para a lista de cargos"
                        >
                          Lista
                        </button>
                      )}
                    </div>
                  )}
                  {customCargo && (
                    <p className="text-[10px] text-slate-500 mt-1">Cargo novo: depois vá em Efetivo &gt; Cargos, clique em "Atualizar cargos" e informe o valor da hora.</p>
                  )}
                </div>

                {/* Perfil */}
                <div>
                  <label className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Perfil de Acesso (RBAC) *</label>
                  <select
                    value={userForm.profileId}
                    onChange={(e) => setUserForm({...userForm, profileId: e.target.value})}
                    className={`w-full text-xs font-semibold px-3 py-2 border rounded-lg outline-none ${
                      darkMode ? 'bg-[#121b2d] border-slate-800' : 'bg-white border-slate-200'
                    }`}
                  >
                    {profiles.map((pr) => (
                      <option key={pr.id} value={pr.id}>{pr.name}</option>
                    ))}
                  </select>
                </div>

                {/* Técnico local (Lote 2): gerência DOM travada + comarca onde atua */}
                {formIsTech && (
                  <div className="col-span-2">
                    <label className={`flex items-start gap-2 p-3 rounded-xl border cursor-pointer ${userForm.localTech ? 'border-emerald-400 bg-emerald-500/5' : darkMode ? 'border-slate-800' : 'border-slate-200'}`}>
                      <input
                        type="checkbox"
                        aria-label="Técnico local"
                        checked={userForm.localTech}
                        disabled={!hasLocalUnit && !userForm.localTech}
                        onChange={(e) =>
                          setUserForm({
                            ...userForm,
                            localTech: e.target.checked,
                            gerencia: e.target.checked ? LOCAL_TECH_UNIT : userForm.gerencia,
                            localComarca: e.target.checked ? userForm.localComarca : '',
                            companies: e.target.checked ? userForm.companies.filter((id) => companiesOfUnit(companies, LOCAL_TECH_UNIT).some((c) => c.id === id)) : userForm.companies
                          })
                        }
                        className="mt-0.5 w-4 h-4 cursor-pointer"
                      />
                      <span>
                        <span className="block text-xs font-black">Técnico local</span>
                        <span className="block text-[10.5px] text-slate-500">
                          {hasLocalUnit
                            ? `Fica na ${LOCAL_TECH_UNIT} e pode receber chamados e preventivas de todas as gerências (só o que for atribuído a ele).`
                            : `Cadastre a gerência ${LOCAL_TECH_UNIT} em Configurações › Gerências para usar.`}
                        </span>
                      </span>
                    </label>
                  </div>
                )}

                {/* Gerência */}
                <div>
                  <label className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Gerência Vinculada</label>
                  <select
                    aria-label="Gerência vinculada"
                    value={userForm.gerencia}
                    disabled={localLocked}
                    onChange={(e) => setUserForm({...userForm, gerencia: e.target.value})}
                    className={`w-full text-xs font-semibold px-3 py-2 border rounded-lg outline-none ${
                      darkMode ? 'bg-[#121b2d] border-slate-800' : 'bg-white border-slate-200'
                    } ${localLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    {(!formIsTech || userForm.gerencia === 'Todas') && (
                      <option value="Todas" disabled={formIsTech}>{formIsTech ? 'Todas — não vale mais para técnico' : 'Todas (Acesso Global)'}</option>
                    )}
                    {managements.filter((m) => m.name !== 'Todas').map((m) => (
                      <option key={m.id} value={m.name}>{m.name}</option>
                    ))}
                    {managements.length === 0 && (
                      <>
                        <option value="" disabled>Cadastre as gerências primeiro (Configurações › Gerências)</option>
                      </>
                    )}
                  </select>
                  {localLocked && <p className="text-[10px] text-slate-500 mt-1">Fixa em {LOCAL_TECH_UNIT} enquanto "Técnico local" estiver marcado.</p>}
                  {formIsTech && !localLocked && <p className="text-[10px] text-slate-500 mt-1">Técnico não tem a opção "Todas" (técnico de várias gerências = "Técnico local").</p>}
                </div>

                {/* Empresa(s) */}
                <div>
                  <label className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Empresa(s)</label>
                  {companiesOfUnit(companies, userForm.gerencia).filter((c) => c.active || userForm.companies.includes(c.id)).length === 0 ? (
                    <p className="text-[10.5px] text-slate-500">{companies.length === 0 ? 'Nenhuma empresa cadastrada (Configurações › Empresas).' : 'Nenhuma empresa atua nesta gerência.'}</p>
                  ) : (
                    <div className="flex flex-wrap gap-x-3 gap-y-1.5" aria-label="Empresas do usuário">
                      {companiesOfUnit(companies, userForm.gerencia)
                        .filter((c) => c.active || userForm.companies.includes(c.id))
                        .map((c) => (
                          <label key={c.id} className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer">
                            <input
                              type="checkbox"
                              checked={userForm.companies.includes(c.id)}
                              onChange={(e) =>
                                setUserForm({ ...userForm, companies: e.target.checked ? [...userForm.companies, c.id] : userForm.companies.filter((x) => x !== c.id) })
                              }
                            />
                            {c.name}
                            {!c.active && <span className="text-[9px] text-rose-600">(inativa)</span>}
                          </label>
                        ))}
                    </div>
                  )}
                  <p className="text-[10px] text-slate-500 mt-1">Técnico: exatamente 1. Planejador: uma ou várias. Engenheiro, gerente e quem abre chamado: nenhuma (o perfil define se vê todas).</p>
                </div>


                {/* Comarca onde atua (técnico local; obrigatória; da lista de endereços) */}
                {formIsTech && userForm.localTech && (
                  <div className="col-span-2">
                    <label className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Comarca onde atua *</label>
                    <select
                      aria-label="Comarca onde atua"
                      value={userForm.localComarca}
                      onChange={(e) => setUserForm({ ...userForm, localComarca: e.target.value })}
                      className={`w-full text-xs font-semibold px-3 py-2 border rounded-lg outline-none ${darkMode ? 'bg-[#121b2d] border-slate-800' : 'bg-white border-slate-200'}`}
                    >
                      <option value="">Escolha a comarca...</option>
                      {userForm.localComarca && !comarcas.some((c) => c.comarca === userForm.localComarca) && <option value={userForm.localComarca}>{userForm.localComarca}</option>}
                      {Array.from(new Set(comarcas.map((c) => c.craai))).map((craai) => (
                        <optgroup key={craai || '-'} label={craai || 'Sem CRAAI'}>
                          {comarcas.filter((c) => c.craai === craai).map((c) => (
                            <option key={c.comarca} value={c.comarca}>{c.comarca}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <p className="text-[10px] text-slate-500 mt-1">
                      {comarcas.length === 0 ? 'Nenhum endereço cadastrado (Gestão de Ativos › Endereços).' : 'Da lista de endereços. Nas listas de atribuição, quem atua na comarca da OS aparece primeiro.'}
                    </p>
                  </div>
                )}

                {/* Status */}
                <div>
                  <label className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Status da Conta</label>
                  <select
                    value={userForm.status}
                    onChange={(e) => setUserForm({...userForm, status: e.target.value as HexonUser['status']})}
                    className={`w-full text-xs font-semibold px-3 py-2 border rounded-lg outline-none ${
                      darkMode ? 'bg-[#121b2d] border-slate-800' : 'bg-white border-slate-200'
                    }`}
                  >
                    <option value="Ativo">Ativo (Acesso Liberado)</option>
                    <option value="Inativo">Inativo (Acesso Bloqueado)</option>
                  </select>
                </div>

              </div>

              </div>

              {/* Action submits */}
              <div className="shrink-0 flex flex-wrap items-center justify-end gap-2 px-6 py-3 border-t border-slate-100 dark:border-slate-850">
                {/* Error Message Alert */}
                {userModalError && (
                  <div className="flex-1 min-w-[180px] text-rose-500 dark:text-rose-300 text-xs flex items-start gap-1.5 animate-in fade-in">
                    <span className="material-symbols-outlined text-base shrink-0">error</span>
                    <div className="flex-1 font-medium leading-relaxed">{userModalError}</div>
                  </div>
                )}
                <button
                  type="button"
                  disabled={isSavingUser}
                  onClick={() => setIsUserModalOpen(false)}
                  className={`px-4 py-2 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                    darkMode ? 'border-slate-800 hover:bg-slate-800/40' : 'border-slate-250 hover:bg-slate-50'
                  }`}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingUser}
                  className={`px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-sm cursor-pointer transition-all flex items-center gap-1.5 ${
                    isSavingUser ? 'opacity-60 cursor-not-allowed' : ''
                  }`}
                >
                  {isSavingUser ? (
                    <>
                      <span className="material-symbols-outlined text-xs animate-spin">sync</span>
                      Gravando no Banco...
                    </>
                  ) : (
                    editingUser ? 'Salvar Alterações' : 'Confirmar Registro'
                  )}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* REUSABLE CUSTOM DIALOG MODAL (Prevents window.confirm iFrame restriction crashes in modern browsers) */}
      {genericConfirm.show && (
        <div className="fixed inset-0 z-200 flex items-center justify-center bg-black/60 backdrop-blur-xs font-sans p-4">
          <div className={`w-full max-w-sm rounded-2xl shadow-2xl p-6 border border-gray-200 dark:border-slate-800 text-center animate-fade-in ${darkMode ? 'bg-[#0b1c30] text-slate-100' : 'bg-white text-slate-900'}`}>
            <div className="w-12 h-12 bg-amber-500/10 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-4 border border-amber-550/10 animate-bounce">
              <span className="material-symbols-outlined text-2xl">warning</span>
            </div>
            <h3 className="text-base font-black leading-tight">{genericConfirm.title}</h3>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-2.5 leading-relaxed">{genericConfirm.message}</p>
            <div className="mt-6 flex gap-3 justify-center">
              <button
                onClick={() => setGenericConfirm({ ...genericConfirm, show: false })}
                className="flex-1 px-4 py-2.5 border border-gray-350 dark:border-slate-800 rounded-xl text-xs font-bold text-gray-650 dark:text-slate-350 hover:bg-gray-50 dark:hover:bg-slate-850 transition-all cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  setGenericConfirm(prev => ({ ...prev, show: false }));
                  genericConfirm.onConfirm();
                }}
                className="flex-1 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-md transition-all cursor-pointer"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
