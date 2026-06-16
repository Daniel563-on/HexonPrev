// UserControlView.tsx - Hexon RBAC User & Logs Console
import React, { useState, useEffect } from 'react';
import { 
  dbGetUsers, 
  dbSaveUser, 
  dbDeleteUser, 
  dbGetManagements, 
  dbSaveManagement, 
  dbDeleteManagement, 
  dbAddAuditLog,
  dbGetPermissions,
  dbSavePermissions
} from '../db/firebase';
import { HexonUser, Management, SystemPermission } from '../types';

interface UserControlViewProps {
  currentUserProfile: HexonUser;
  darkMode: boolean;
}

export default function UserControlView({ currentUserProfile, darkMode }: UserControlViewProps) {
  const [activeSubTab, setActiveSubTab] = useState<'users' | 'managements' | 'permissions'>('users');
  
  // Lists state
  const [users, setUsers] = useState<HexonUser[]>([]);
  const [managements, setManagements] = useState<Management[]>([]);
  const [permissionsMatrix, setPermissionsMatrix] = useState<{ [key: string]: SystemPermission }>({});
  const [isSavingPermissions, setIsSavingPermissions] = useState(false);

  const [isLoading, setIsLoading] = useState(false);

  // User form modal state
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<HexonUser | null>(null);
  const [userForm, setUserForm] = useState({
    name: '',
    matricula: '',
    email: '',
    cargo: '',
    gerencia: 'Refrigeração',
    perfil: 'Profissional' as HexonUser['perfil'],
    status: 'Ativo' as HexonUser['status'],
    senha: 'admin'
  });

  // Mgmt Modal state
  const [isMgmtModalOpen, setIsMgmtModalOpen] = useState(false);
  const [mgmtForm, setMgmtForm] = useState({ id: '', name: '', description: '' });

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

  const loadAllData = async () => {
    setIsLoading(true);
    try {
      if (activeSubTab === 'users') {
        const uList = await dbGetUsers();
        setUsers(uList);
        const mList = await dbGetManagements();
        setManagements(mList);
      } else if (activeSubTab === 'managements') {
        const mList = await dbGetManagements();
        setManagements(mList);
      } else if (activeSubTab === 'permissions') {
        const permData = await dbGetPermissions();
        setPermissionsMatrix(permData);
      }
    } catch (e) {
      console.error('Error loading RBAC settings:', e);
    } finally {
      setIsLoading(false);
    }
  };

  // User Management actions
  const handleOpenCreateUser = () => {
    setEditingUser(null);
    setUserForm({
      name: '',
      matricula: '',
      email: '',
      cargo: '',
      gerencia: managements[0]?.name || 'Refrigeração',
      perfil: 'Profissional',
      status: 'Ativo',
      senha: 'admin'
    });
    setIsUserModalOpen(true);
  };

  const handleOpenEditUser = (user: HexonUser) => {
    setEditingUser(user);
    setUserForm({
      name: user.name,
      matricula: user.matricula,
      email: user.email,
      cargo: user.cargo,
      gerencia: user.gerencia,
      perfil: user.perfil,
      status: user.status,
      senha: user.senha || 'admin'
    });
    setIsUserModalOpen(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userForm.name || !userForm.matricula || !userForm.email) {
      alert('Preencha os campos obrigatórios (Nome, Matrícula e E-mail).');
      return;
    }

    try {
      const targetId = editingUser ? editingUser.id : `u_${Date.now()}`;
      const newUser: HexonUser = {
        id: targetId,
        name: userForm.name,
        matricula: userForm.matricula,
        email: userForm.email,
        cargo: userForm.cargo,
        gerencia: userForm.gerencia,
        perfil: userForm.perfil,
        status: userForm.status,
        senha: userForm.senha
      };

      await dbSaveUser(newUser);
      await dbAddAuditLog({
        userMatricula: currentUserProfile.matricula,
        userName: currentUserProfile.name,
        action: editingUser ? 'Atualizou Usuário' : 'Criou Usuário',
        target: `users/${newUser.matricula}`,
        details: `${editingUser ? 'Editou' : 'Registrou'} o colaborador ${newUser.name} (${newUser.perfil})`,
        timestamp: new Date().toISOString()
      });

      setIsUserModalOpen(false);
      loadAllData();
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar os dados do colaborador.');
    }
  };

  const handleDeleteUser = async (userId: string, userName: string) => {
    if (userId === currentUserProfile.id || userId === 'daniel_fab93') {
      alert('Você não pode excluir sua própria conta de administrador em uso.');
      return;
    }

    setGenericConfirm({
      show: true,
      title: 'Excluir Usuário',
      message: `Tem certeza que deseja excluir em definitivo o usuário "${userName}"? Esta ação removerá permanentemente o acesso deste colaborador.`,
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
          loadAllData();
        } catch (err) {
          console.error(err);
        }
      }
    });
  };

  // Gerências
  const handleSaveManagement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mgmtForm.name) return;

    try {
      const item: Management = {
        id: mgmtForm.id || `m_${Date.now()}`,
        name: mgmtForm.name,
        description: mgmtForm.description
      };
      await dbSaveManagement(item);
      await dbAddAuditLog({
        userMatricula: currentUserProfile.matricula,
        userName: currentUserProfile.name,
        action: mgmtForm.id ? 'Atualizou Gerência' : 'Criou Gerência',
        target: `managements/${item.id}`,
        details: `Registrou gerência ${item.name}`,
        timestamp: new Date().toISOString()
      });
      setIsMgmtModalOpen(false);
      loadAllData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteManagement = async (id: string, name: string) => {
    if (name === 'Todas') {
      alert('A gerência de atuação global "Todas" não pode ser excluída.');
      return;
    }
    setGenericConfirm({
      show: true,
      title: 'Excluir Gerência',
      message: `Tem certeza que deseja excluir a gerência "${name}"? Os ativos e preventivas estructurados nesta gerência perderão o setor de atuação.`,
      onConfirm: async () => {
        try {
          await dbDeleteManagement(id);
          loadAllData();
        } catch (err) {
          console.error(err);
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
           u.perfil.toLowerCase().includes(q);
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
            Controle de Acessos e Configurações (RBAC)
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Administre logins de profissionais, gerencie vinculações a gerências setoriais e audite logs operacionais críticos em conformidade jurídica.
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
          {activeSubTab === 'managements' && (
            <button 
              onClick={() => {
                setMgmtForm({ id: '', name: '', description: '' });
                setIsMgmtModalOpen(true);
              }}
              className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[15px]">add_circle</span>
              Nova Gerência
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
          onClick={() => { setActiveSubTab('managements'); setSearchQuery(''); }}
          className={`px-5 py-3 text-xs font-bold text-left border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
            activeSubTab === 'managements' 
              ? 'border-blue-600 text-blue-600' 
              : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
          }`}
        >
          <span className="material-symbols-outlined text-base">corporate_fare</span>
          Gerências
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
          Painel de Permissões
        </button>
      </div>

      {/* SEARCH AND FILTER BAR */}
      {activeSubTab !== 'permissions' && (
        <div className="flex relative">
          <span className={`material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-lg ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>
            search
          </span>
          <input
            type="text"
            placeholder={
              activeSubTab === 'users' ? 'Buscar colaborador por nome, matrícula, e-mail...' : 'Filtre gerências operacionais...'
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
                      <th className="py-3 px-4">Nível de Acesso</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-850 text-xs font-medium">
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-500 italic">
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
                          </td>

                          {/* Perfil */}
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1">
                              <span className={`w-1.5 h-1.5 rounded-full ${
                                u.perfil === 'Super Administrador' ? 'bg-amber-500' :
                                u.perfil === 'Administrador' ? 'bg-indigo-600' : 'bg-blue-500'
                              }`} />
                              <span className="font-bold">{u.perfil}</span>
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

          {/* TAB 2: GERÊNCIAS */}
          {activeSubTab === 'managements' && (
            <div className="max-w-3xl mx-auto">
              
              {/* Gerências */}
              <div className={`p-5 rounded-xl border ${darkMode ? 'bg-[#0a1122]/40 border-slate-800' : 'bg-white border-slate-200'}`}>
                <h3 className={`text-sm font-black uppercase tracking-wider ${darkMode ? 'text-slate-300' : 'text-slate-700'} mb-4 flex items-center gap-2`}>
                  <span className="material-symbols-outlined text-base">domain</span>
                  Gerências Técnicas / Oficinas
                </h3>
                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                  {managements.map((m) => (
                    <div 
                      key={m.id}
                      className={`p-3 rounded-lg border text-xs flex justify-between items-center ${
                        darkMode ? 'bg-slate-900/40 border-slate-800' : 'bg-slate-50/50 border-slate-100'
                      }`}
                    >
                      <div>
                        <span className={`font-bold block ${darkMode ? 'text-slate-200' : 'text-slate-800'}`}>{m.name}</span>
                        <span className="text-slate-550 text-[10.5px] mt-0.5 block">{m.description || 'Sem descrição cadastrada'}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button 
                          onClick={() => {
                            setMgmtForm(m);
                            setIsMgmtModalOpen(true);
                          }}
                          className="p-1 text-slate-500 hover:text-blue-500 transition-colors animate-none"
                        >
                          <span className="material-symbols-outlined text-base">edit</span>
                        </button>
                        <button 
                          onClick={() => handleDeleteManagement(m.id, m.name)}
                          className="p-1 text-slate-500 hover:text-rose-600 transition-colors animate-none"
                        >
                          <span className="material-symbols-outlined text-base">delete</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          )}

          {/* TAB 3: PAINEL DE PERMISSÕES */}
          {activeSubTab === 'permissions' && (
            <div className="max-w-4xl mx-auto space-y-6">
              <div className={`p-4 rounded-xl border flex items-start gap-3 ${darkMode ? 'bg-blue-950/10 border-blue-900/40 text-blue-300' : 'bg-blue-50 border-blue-100 text-blue-800'}`}>
                <span className="material-symbols-outlined shrink-0 text-xl">gavel</span>
                <div className="text-xs space-y-1">
                  <span className="font-bold block">Política de Controle de Acesso (RBAC)</span>
                  <p className="leading-relaxed opacity-90">
                    Este painel centraliza as permissões de conformidade do Hexon. O perfil de <strong>Super Administrador</strong> possui privilégios de acesso irrestritos (root) para salvaguardar a governança. Administradores e Técnicos Profissionais seguem estritamente os parâmetros definidos abaixo, aplicados instantaneamente.
                  </p>
                </div>
              </div>

              <div className={`border rounded-xl overflow-hidden ${darkMode ? 'bg-[#0a1122]/40 border-slate-800' : 'bg-white border-slate-200'}`}>
                <div className="p-4 border-b border-slate-200 dark:border-slate-850 bg-slate-50/50 dark:bg-slate-900/20 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div>
                    <h3 className={`text-xs font-black uppercase tracking-wider ${darkMode ? 'text-slate-350' : 'text-slate-700'}`}>
                      Matriz de Controle de Permissões
                    </h3>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">Defina as visibilidades e ações comerciais de cada nível de usuário</p>
                  </div>
                  <button
                    onClick={handleSavePermissions}
                    disabled={isSavingPermissions}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800/40 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
                  >
                    {isSavingPermissions ? (
                      <>
                        <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <span>Salvando...</span>
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-[15px]">save</span>
                        <span>Salvar Permissões</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className={`border-b border-slate-200 dark:border-slate-800 ${darkMode ? 'bg-slate-900/60 text-slate-400' : 'bg-slate-50 text-slate-500'}`}>
                        <th className="p-4 font-bold text-[11px] uppercase tracking-wider w-1/2">Permissão & Descrição</th>
                        <th className="p-4 font-bold text-[11px] uppercase tracking-wider text-center">Super Admin</th>
                        <th className="p-4 font-bold text-[11px] uppercase tracking-wider text-center">Administrador</th>
                        <th className="p-4 font-bold text-[11px] uppercase tracking-wider text-center">Profissional</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-150 dark:divide-slate-800">
                      {/* CATEGORY: ABAS */}
                      <tr className={`${darkMode ? 'bg-slate-900/30' : 'bg-slate-50/40'}`}>
                        <td colSpan={4} className="px-4 py-2 font-bold text-[11px] tracking-wide text-blue-500 dark:text-blue-450 uppercase">
                          Acesso aos Módulos (Abas)
                        </td>
                      </tr>
                      {(Object.values(permissionsMatrix) as SystemPermission[])
                        .filter(p => p.category === 'Abas')
                        .map(p => renderPermissionRow(p))}

                      {/* CATEGORY: AÇÕES */}
                      <tr className={`${darkMode ? 'bg-slate-900/30' : 'bg-slate-50/40'}`}>
                        <td colSpan={4} className="px-4 py-2 font-bold text-[11px] tracking-wide text-blue-500 dark:text-blue-450 uppercase border-t border-slate-200 dark:border-slate-850">
                          Ações e Operações em Campo
                        </td>
                      </tr>
                      {(Object.values(permissionsMatrix) as SystemPermission[])
                        .filter(p => p.category === 'Ações')
                        .map(p => renderPermissionRow(p))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

        </>
      )}

      {/* MODAL 1: COLLABORATOR USER DETAIL */}
      {isUserModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-101 flex items-center justify-center p-4 overflow-y-auto">
          <div className={`w-full max-w-lg rounded-2xl shadow-xl overflow-hidden animate-fade-in ${darkMode ? 'bg-[#0a1122] border border-slate-800 text-white' : 'bg-white text-slate-900'}`}>
            <div className="px-6 py-4 border-b border-slate-150 dark:border-slate-800 flex justify-between items-center bg-slate-50/40 dark:bg-slate-900/30">
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
            
            <form onSubmit={handleSaveUser} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {/* Full name */}
                <div className="col-span-2">
                  <label className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Nome Completo *</label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Carlos Gabriel Silva"
                    value={userForm.name}
                    onChange={(e) => setUserForm({...userForm, name: e.target.value})}
                    className={`w-full text-xs font-semibold px-3 py-2 border rounded-lg outline-none ${
                      darkMode ? 'bg-[#121b2d] border-slate-800' : 'bg-white border-slate-200'
                    }`}
                  />
                </div>

                {/* Matricula */}
                <div>
                  <label className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Matrícula Corporativa *</label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: 3-0021"
                    disabled={!!editingUser}
                    value={userForm.matricula}
                    onChange={(e) => setUserForm({...userForm, matricula: e.target.value})}
                    className={`w-full text-xs font-semibold px-3 py-2 border rounded-lg outline-none ${
                      editingUser ? 'opacity-50 cursor-not-allowed ' : ''
                    }${darkMode ? 'bg-[#121b2d] border-slate-800' : 'bg-white border-slate-200'}`}
                  />
                </div>

                {/* Password input */}
                <div>
                  <label className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Senha de Acesso *</label>
                  <input
                    type="text"
                    required
                    placeholder="Senha numérica ou alfa"
                    value={userForm.senha}
                    onChange={(e) => setUserForm({...userForm, senha: e.target.value})}
                    className={`w-full text-xs font-semibold px-3 py-2 border rounded-lg outline-none ${
                      darkMode ? 'bg-[#121b2d] border-slate-800' : 'bg-white border-slate-200'
                    }`}
                  />
                </div>

                {/* Contact Email */}
                <div className="col-span-2">
                  <label className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">E-mail Corporativo *</label>
                  <input
                    type="email"
                    required
                    placeholder="Ex: carlos.silva@hexon.com"
                    value={userForm.email}
                    onChange={(e) => setUserForm({...userForm, email: e.target.value})}
                    className={`w-full text-xs font-semibold px-3 py-2 border rounded-lg outline-none ${
                      darkMode ? 'bg-[#121b2d] border-slate-800' : 'bg-white border-slate-200'
                    }`}
                  />
                </div>

                {/* Cargo */}
                <div>
                  <label className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Cargo / Função</label>
                  <input
                    type="text"
                    placeholder="Ex: Técnico Mecânico HVAC"
                    value={userForm.cargo}
                    onChange={(e) => setUserForm({...userForm, cargo: e.target.value})}
                    className={`w-full text-xs font-semibold px-3 py-2 border rounded-lg outline-none ${
                      darkMode ? 'bg-[#121b2d] border-slate-800' : 'bg-white border-slate-200'
                    }`}
                  />
                </div>

                {/* Gerência */}
                <div>
                  <label className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Gerência Vinculada</label>
                  <select
                    value={userForm.gerencia}
                    onChange={(e) => setUserForm({...userForm, gerencia: e.target.value})}
                    className={`w-full text-xs font-semibold px-3 py-2 border rounded-lg outline-none ${
                      darkMode ? 'bg-[#121b2d] border-slate-800' : 'bg-white border-slate-200'
                    }`}
                  >
                    <option value="Todas">Todas (Acesso Global)</option>
                    {managements.map((m) => (
                      <option key={m.id} value={m.name}>{m.name}</option>
                    ))}
                    {managements.length === 0 && (
                      <>
                        <option value="Refrigeração">Refrigeração</option>
                        <option value="Elétrica">Elétrica</option>
                        <option value="Civil">Civil</option>
                      </>
                    )}
                  </select>
                </div>

                {/* Perfil */}
                <div>
                  <label className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Perfil de Acesso (RBAC) *</label>
                  <select
                    value={userForm.perfil}
                    onChange={(e) => setUserForm({...userForm, perfil: e.target.value as HexonUser['perfil']})}
                    className={`w-full text-xs font-semibold px-3 py-2 border rounded-lg outline-none ${
                      darkMode ? 'bg-[#121b2d] border-slate-800' : 'bg-white border-slate-200'
                    }`}
                  >
                    <option value="Profissional">Profissional (Operador em campo)</option>
                    <option value="Administrador">Administrador (Gestor de Gerência)</option>
                    <option value="Super Administrador">Super Administrador (Acesso Global)</option>
                  </select>
                </div>

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

              {/* Action submits */}
              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-850">
                <button
                  type="button"
                  onClick={() => setIsUserModalOpen(false)}
                  className={`px-4 py-2 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                    darkMode ? 'border-slate-800 hover:bg-slate-800/40' : 'border-slate-250 hover:bg-slate-50'
                  }`}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-sm cursor-pointer transition-all"
                >
                  Confirmar Registro
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: ADD/EDIT GERÊNCIA */}
      {isMgmtModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-101 flex items-center justify-center p-4">
          <div className={`w-full max-w-sm rounded-2xl shadow-xl overflow-hidden animate-fade-in ${darkMode ? 'bg-[#0a1122] border border-slate-800 text-white' : 'bg-white text-slate-900'}`}>
            <div className="px-5 py-3.5 border-b border-slate-150 dark:border-slate-800 flex justify-between items-center font-bold text-xs uppercase tracking-wider">
              <span>{mgmtForm.id ? 'Editar Gerência' : 'Cadastrar Nova Gerência'}</span>
              <button onClick={() => setIsMgmtModalOpen(false)} className="text-slate-400 hover:text-white"><span className="material-symbols-outlined text-sm">close</span></button>
            </div>
            <form onSubmit={handleSaveManagement} className="p-5 space-y-3.5">
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Nome da Gerência *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Predial, Hidráulica, TI"
                  value={mgmtForm.name}
                  onChange={(e) => setMgmtForm({ ...mgmtForm, name: e.target.value })}
                  className={`w-full text-xs font-bold px-3 py-2 border rounded-lg ${darkMode ? 'bg-[#121b2d] border-slate-805' : 'bg-white'}`}
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Descrição</label>
                <input
                  type="text"
                  placeholder="Ex: Cabines de média e alta tensão, cabeamentos"
                  value={mgmtForm.description}
                  onChange={(e) => setMgmtForm({ ...mgmtForm, description: e.target.value })}
                  className={`w-full text-xs font-bold px-3 py-2 border rounded-lg ${darkMode ? 'bg-[#121b2d] border-slate-805' : 'bg-white'}`}
                />
              </div>
              <div className="flex justify-end gap-1.5 pt-3 border-t dark:border-slate-850">
                <button type="button" onClick={() => setIsMgmtModalOpen(false)} className="px-3 py-1.5 border hover:bg-slate-50/10 rounded text-xs font-bold">Cancelar</button>
                <button type="submit" className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold shadow-sm">Salvar</button>
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
