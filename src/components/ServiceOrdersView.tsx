import React, { useState, useEffect } from 'react';
import { 
  ClipboardList, 
  Wrench, 
  Search, 
  SlidersHorizontal, 
  User, 
  Calendar, 
  CheckCircle2, 
  Clock, 
  AlertTriangle, 
  Eye, 
  MoreVertical,
  X,
  FileSignature,
  FileCheck,
  PlusCircle,
  Plus,
  Trash2,
  Paperclip,
  Check,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Flag,
  QrCode,
  Camera,
  Trash
} from 'lucide-react';
import { ServiceOrder, Asset, ChecklistItem, formatDateBR, HexonUser, isSectorInGerencia } from '../types';
import { dbGetServiceOrders, dbSaveServiceOrder, dbGetAssets, dbGetTemplates, dbDeleteServiceOrder, dbGetUsers, dbGetPlanningDeadlines, dbSavePlanningDeadline, PlanningDeadline } from '../db/firebase';
import SignatureCanvas from './SignatureCanvas';
import CameraQrScanner from './CameraQrScanner';

interface ServiceOrdersViewProps {
  orders: ServiceOrder[];
  onReload: () => void;
  openCreateModalDirectly: boolean;
  onCloseDirectCreateModal: () => void;
  highlightOSId?: string | null;
  userProfile?: HexonUser | null;
  userHasActionPermission?: (actionId: string) => boolean;
}

export default function ServiceOrdersView({ 
  orders, 
  onReload, 
  openCreateModalDirectly, 
  onCloseDirectCreateModal, 
  highlightOSId,
  userProfile,
  userHasActionPermission
}: ServiceOrdersViewProps) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [deadlines, setDeadlines] = useState<PlanningDeadline[]>([]);
  const [customDates, setCustomDates] = useState<Record<string, string>>({});
  const [hasDismissedTemp, setHasDismissedTemp] = useState(false);
  const [showDeadlineWarnPopup, setShowDeadlineWarnPopup] = useState(false);
  const [warnPopupManagement, setWarnPopupManagement] = useState<string>('');
  const [warnPopupTimeText, setWarnPopupTimeText] = useState<string>('');

  function getCountdownText(expiresAt: string): { text: string; hoursLeft: number; isExpired: boolean } {
    if (!expiresAt || expiresAt === 'none' || expiresAt === '') {
      return { text: 'Sem prazo definido', hoursLeft: 9999, isExpired: false };
    }
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) {
      return { text: 'Prazo Expirado (Acesso Bloqueado)', hoursLeft: 0, isExpired: true };
    }
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    let textStr = '';
    if (days > 0) textStr += `${days} ${days === 1 ? 'dia' : 'dias'} `;
    textStr += `${hours}h ${minutes}m`;
    return { text: textStr, hoursLeft: diff / (1000 * 60 * 60), isExpired: false };
  }

  const loadDeadlines = () => {
    dbGetPlanningDeadlines().then((list) => {
      setDeadlines([...list]);
    });
  };

  useEffect(() => {
    loadDeadlines();
  }, [orders]);

  // Handle countdown updates & alerts
  useEffect(() => {
    if (userProfile?.perfil === 'Administrador' && userProfile.gerencia && userProfile.gerencia !== 'Todas') {
      const runCheck = () => {
        dbGetPlanningDeadlines().then((list) => {
          setDeadlines([...list]);
          const deadline = list.find(d => d.id === userProfile.gerencia);
          if (deadline && deadline.expiresAt) {
            const { isExpired, hoursLeft, text } = getCountdownText(deadline.expiresAt);
            if (!isExpired && hoursLeft <= 24) {
              if (!hasDismissedTemp) {
                setWarnPopupManagement(userProfile.gerencia);
                setWarnPopupTimeText(text);
                setShowDeadlineWarnPopup(true);
              }
            } else {
              // If deadline is reset to >24h, we can allow showing again next time it hits limit
              setHasDismissedTemp(false);
              setShowDeadlineWarnPopup(false);
            }
          } else {
            // No custom deadline is defined, hide any warning alerts
            setShowDeadlineWarnPopup(false);
            setHasDismissedTemp(false);
          }
        });
      };
      
      runCheck();
      const interval = setInterval(runCheck, 10000); // Check every 10 seconds
      return () => clearInterval(interval);
    }
  }, [userProfile, hasDismissedTemp]);

  const [selectedOrder, setSelectedOrder] = useState<ServiceOrder | null>(null);
  const [showDrawer, setShowDrawer] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBulkConfirmModal, setShowBulkConfirmModal] = useState(false);
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [failedItemIds, setFailedItemIds] = useState<string[]>([]);

  // Smart Filter States
  const [smartSearch, setSmartSearch] = useState('');
  const [selectedExecutionDate, setSelectedExecutionDate] = useState<string>('');
  const [showPreventiveScanSimulator, setShowPreventiveScanSimulator] = useState(false);
  const [preventiveScannerTab, setPreventiveScannerTab] = useState<'camera' | 'manual'>('camera');
  const [simulatedPreventiveScanCode, setSimulatedPreventiveScanCode] = useState('');
  const [selectedComarca, setSelectedComarca] = useState('Todas');
  const [selectedPatrimonio, setSelectedPatrimonio] = useState('Todos');
  const [selectedStatus, setSelectedStatus] = useState('Todos');

  // New subTabs & calendar state
  const [users, setUsers] = useState<HexonUser[]>([]);
  const [subTab, setSubTab] = useState<'realizacao' | 'planejamento'>(userProfile?.perfil === 'Profissional' ? 'realizacao' : 'planejamento');
  const [currentCalendarDate, setCurrentCalendarDate] = useState<Date>(new Date());
  const [selectedCalendarDay, setSelectedCalendarDay] = useState<number | null>(null);

  // Planning / scheduling states for 'Novo' preventives
  const [planSearch, setPlanSearch] = useState('');
  const [planSearchType, setPlanSearchType] = useState<'all' | 'id' | 'patrimonio' | 'craai' | 'comarca'>('all');
  const [isBulkScheduling, setIsBulkScheduling] = useState(false);
  const [bulkAssignTech, setBulkAssignTech] = useState<string>('');
  const [planSector, setPlanSector] = useState(userProfile?.perfil === 'Administrador' && userProfile.gerencia !== 'Todas' ? userProfile?.gerencia || 'all' : 'all');
  const [planPriority, setPlanPriority] = useState('all');
  const [planOnlyCompatible, setPlanOnlyCompatible] = useState(true);
  const [planAssignedTechs, setPlanAssignedTechs] = useState<{[key: string]: string}>({});
  const [planActiveTab, setPlanActiveTab] = useState<'novas' | 'agendadas'>('novas');

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [orderIdToDelete, setOrderIdToDelete] = useState<string | null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState<boolean>(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState<boolean>(false);
  const [deplanConfirmOrderId, setDeplanConfirmOrderId] = useState<string | null>(null);

  // Reset pagination to page 1 whenever search, filters, or orders list changes
  useEffect(() => {
    setCurrentPage(1);
  }, [smartSearch, selectedComarca, selectedPatrimonio, selectedStatus, selectedExecutionDate, orders]);

  // Form states for NEW Service Order
  const [osAssetId, setOsAssetId] = useState('');
  const [osTitle, setOsTitle] = useState('');
  const [osDescription, setOsDescription] = useState('');
  const [osPriority, setOsPriority] = useState<'Baixa' | 'Média' | 'Alta' | 'Urgente'>('Média');
  const [osScheduledDate, setOsScheduledDate] = useState('');
  const [osTechnician, setOsTechnician] = useState('Daniel Torres');
  const [osChecklist, setOsChecklist] = useState<string[]>([]);
  const [newChecklistItemText, setNewChecklistItemText] = useState('');

  // Evidência fotográfica mockup state
  const [photoEvidenceBase64, setPhotoEvidenceBase64] = useState<string | null>(null);

  // Load registered assets and templates
  useEffect(() => {
    dbGetAssets().then((list) => {
      setAssets(list);
      if (list.length > 0) {
        setOsAssetId(list[0].id);
      }
    });
    dbGetTemplates().then((tpls) => {
      setTemplates(tpls);
    });
    dbGetUsers().then((uList) => {
      setUsers(uList);
    });
  }, []);

  // Handle direct creation triggers from parent view
  useEffect(() => {
    if (openCreateModalDirectly) {
      setShowAddModal(true);
      onCloseDirectCreateModal();
    }
  }, [openCreateModalDirectly]);

  // Handle auto-expansion/search for a specific OS highlighted from outside (e.g. from Solicitations)
  useEffect(() => {
    if (highlightOSId) {
      const target = orders.find(os => os.id === highlightOSId);
      if (target) {
        setSmartSearch(`#${highlightOSId}`);
        setSelectedOrder(target);
        setPhotoEvidenceBase64(target.photoEvidence);
        setShowDrawer(true);
      }
    }
  }, [highlightOSId, orders]);

  // Handle asset-based checklist template loader
  useEffect(() => {
    if (osAssetId && assets.length > 0) {
      const selectedAssetObj = assets.find(a => a.id === osAssetId);
      if (selectedAssetObj) {
        // Find existing template matching target sector or category
        const matchingTemplate = templates.find(
          t => t.targetSectorOrType?.toLowerCase() === selectedAssetObj.sector?.toLowerCase()
        );
        if (matchingTemplate && matchingTemplate.checklistItems) {
          const loadedTasks = matchingTemplate.checklistItems
            .filter((item: any) => item.isActive !== false)
            .map((item: any) => item.task);
          setOsChecklist(loadedTasks);
        } else {
          // Default to empty checklist to avoid fake items (as requested)
          setOsChecklist([]);
        }
      }
    } else {
      setOsChecklist([]);
    }
  }, [osAssetId, assets, templates]);

  // Change individual checklist compliance status
  const selectItemStatus = async (osId: string, itemId: string, status: 'Atestado' | 'Não Atestado' | 'Não se Aplica') => {
    if (userHasActionPermission && !userHasActionPermission('execute_order')) {
      alert('Acesso Restrito: Seu perfil de usuário não possui as permissões necessárias para preencher ou executar ordens de serviço (atestar itens).');
      return;
    }
    if (!selectedOrder) return;

    // Clear failed warning flag for this item
    setFailedItemIds(prev => prev.filter(id => id !== itemId));

    const updatedChecklist = selectedOrder.checklist.map((item) => {
      if (item.id === itemId) {
        let isChecked = false;
        let obs = item.observations;
        
        if (status === 'Atestado') {
          isChecked = true;
          if (!obs || obs === 'Procedimento não atestado.' || obs === 'Procedimento verificado como não se aplica.') {
            obs = 'Procedimento verificado em conformidade técnico.';
          }
        } else if (status === 'Não Atestado') {
          isChecked = false;
          if (!obs || obs === 'Procedimento verificado em conformidade técnico.' || obs === 'Procedimento verificado como não se aplica.') {
            obs = '';
          }
        } else if (status === 'Não se Aplica') {
          isChecked = true;
          if (!obs || obs === 'Procedimento verificado em conformidade técnico.' || obs === 'Procedimento não atestado.') {
            obs = 'Procedimento verificado como não se aplica.';
          }
        }

        return {
          ...item,
          checked: isChecked,
          checkedAt: new Date().toISOString(),
          statusCheck: status,
          observations: obs
        };
      }
      return item;
    });

    const updatedOrder: ServiceOrder = {
      ...selectedOrder,
      checklist: updatedChecklist,
      status: selectedOrder.status === 'Planejada' ? 'Em Execução' : selectedOrder.status
    };

    setSelectedOrder(updatedOrder);
    await dbSaveServiceOrder(updatedOrder);
    onReload();
  };

  // Change custom response type value (text, number, boolean, date)
  const changeCustomResponse = async (itemId: string, value: string, isChecked: boolean, status: 'Atestado' | 'Não Atestado' | 'Não se Aplica' = 'Atestado') => {
    if (!selectedOrder) return;

    const updatedChecklist = selectedOrder.checklist.map((item) => {
      if (item.id === itemId) {
        return {
          ...item,
          checked: isChecked,
          checkedAt: new Date().toISOString(),
          observations: value,
          statusCheck: status
        };
      }
      return item;
    });

    const updatedOrder: ServiceOrder = {
      ...selectedOrder,
      checklist: updatedChecklist,
      status: selectedOrder.status === 'Planejada' ? 'Em Execução' : selectedOrder.status
    };

    setSelectedOrder(updatedOrder);
    await dbSaveServiceOrder(updatedOrder);
    onReload();
  };

  // Validation function before closing the service order
  const validateServiceOrder = (order: ServiceOrder): string[] => {
    const errors: string[] = [];
    
    order.checklist.forEach((item, index) => {
      const type = item.responseType || 'three_states';
      const questionLabel = item.task || `Item #${index + 1}`;
      
      if (item.autoCreateCorrective) {
        if (!item.autoCorrectiveAnswer) {
          errors.push(`"${questionLabel}": responda Sim ou Não para a solicitação de corretiva.`);
        }
      } else if (type === 'three_states') {
        const currentStatus = item.statusCheck || (item.checked ? 'Atestado' : undefined);
        if (!currentStatus) {
          errors.push(`"${questionLabel}": precisa escolher Atestado, Não Atestado ou Não se Aplica.`);
        } else if (currentStatus === 'Não Atestado') {
          if (!item.observations || item.observations.trim() === '') {
            errors.push(`"${questionLabel}": é obrigatório informar o motivo do não atestado.`);
          }
        }
      } else if (type === 'text') {
        if (!item.observations || item.observations.trim() === '') {
          errors.push(`"${questionLabel}": resposta em texto é obrigatória.`);
        }
      } else if (type === 'number') {
        if (!item.observations || item.observations.trim() === '') {
          errors.push(`"${questionLabel}": medição numérica é obrigatória.`);
        } else {
          const numVal = Number(item.observations.replace(',', '.'));
          if (isNaN(numVal)) {
            errors.push(`"${questionLabel}": deve ser digitado um número válido.`);
          }
        }
      } else if (type === 'boolean') {
        if (!item.observations || (item.observations !== 'Sim' && item.observations !== 'Não')) {
          errors.push(`"${questionLabel}": responda Sim ou Não.`);
        }
      } else if (type === 'date') {
        if (!item.observations || item.observations.trim() === '') {
          errors.push(`"${questionLabel}": o campo de data deve ser preenchido.`);
        }
      }
    });
    
    return errors;
  };

  const getFailedItemIds = (order: ServiceOrder): string[] => {
    const failedIds: string[] = [];
    order.checklist.forEach((item) => {
      const type = item.responseType || 'three_states';
      
      if (item.autoCreateCorrective) {
        if (!item.autoCorrectiveAnswer) {
          failedIds.push(item.id);
        }
      } else if (type === 'three_states') {
        const currentStatus = item.statusCheck || (item.checked ? 'Atestado' : undefined);
        if (!currentStatus) {
          failedIds.push(item.id);
        } else if (currentStatus === 'Não Atestado') {
          if (!item.observations || item.observations.trim() === '') {
            failedIds.push(item.id);
          }
        }
      } else if (type === 'text') {
        if (!item.observations || item.observations.trim() === '') {
          failedIds.push(item.id);
        }
      } else if (type === 'number') {
        if (!item.observations || item.observations.trim() === '') {
          failedIds.push(item.id);
        } else {
          const numVal = Number(item.observations.replace(',', '.'));
          if (isNaN(numVal)) {
            failedIds.push(item.id);
          }
        }
      } else if (type === 'boolean') {
        if (!item.observations || (item.observations !== 'Sim' && item.observations !== 'Não')) {
          failedIds.push(item.id);
        }
      } else if (type === 'date') {
        if (!item.observations || item.observations.trim() === '') {
          failedIds.push(item.id);
        }
      }
    });
    return failedIds;
  };

  // For backward compatibility and single selection
  const toggleChecklistItem = async (osId: string, itemId: string) => {
    if (!selectedOrder) return;

    const item = selectedOrder.checklist.find(i => i.id === itemId);
    if (!item) return;

    const nextStatus = item.statusCheck === 'Atestado' ? 'Não Atestado' : 'Atestado';
    await selectItemStatus(osId, itemId, nextStatus);
  };

  // Change individual checklist comment observations
  const handleChecklistObservationChange = async (itemId: string, val: string) => {
    if (userHasActionPermission && !userHasActionPermission('execute_order')) {
      alert('Acesso Restrito: Seu perfil de usuário não possui as permissões necessárias para preencher observações das ordens de serviço.');
      return;
    }
    if (!selectedOrder) return;

    // Clear failed warning flag for this item if observation value is provided
    if (val.trim() !== '') {
      setFailedItemIds(prev => prev.filter(id => id !== itemId));
    }

    const updatedChecklist = selectedOrder.checklist.map((item) => {
      if (item.id === itemId) {
        return { ...item, observations: val };
      }
      return item;
    });

    const updatedOrder: ServiceOrder = {
      ...selectedOrder,
      checklist: updatedChecklist
    };

    setSelectedOrder(updatedOrder);
    await dbSaveServiceOrder(updatedOrder);
  };

  // Change custom response fields dynamically keeping focus
  const handleCustomFieldChange = (itemId: string, val: string, responseType: string) => {
    if (!selectedOrder) return;

    let isComp = val.trim() !== '';
    if (responseType === 'number') {
      const num = Number(val.replace(',', '.'));
      isComp = val.trim() !== '' && !isNaN(num);
    }

    // Clear failed warning flag for this item if answered
    if (isComp) {
      setFailedItemIds(prev => prev.filter(id => id !== itemId));
    }

    const updatedChecklist = selectedOrder.checklist.map((item) => {
      if (item.id === itemId) {
        return { 
          ...item, 
          observations: val, 
          checked: isComp,
          statusCheck: isComp ? 'Atestado' : undefined
        };
      }
      return item;
    });

    const updatedOrder: ServiceOrder = {
      ...selectedOrder,
      checklist: updatedChecklist
    };

    setSelectedOrder(updatedOrder);
    dbSaveServiceOrder(updatedOrder); // Background async save
  };

  // Change overall technician observation notes in real-time
  const handleNotesChange = async (val: string) => {
    if (!selectedOrder) return;

    const updatedOrder: ServiceOrder = {
      ...selectedOrder,
      notes: val
    };

    setSelectedOrder(updatedOrder);
    await dbSaveServiceOrder(updatedOrder);
    onReload();
  };

  // Drag and drop photo upload mockup simulation
  const handleSimulatedPhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = reader.result as string;
      setPhotoEvidenceBase64(base64);
      if (selectedOrder) {
        const updatedOrder: ServiceOrder = {
          ...selectedOrder,
          photoEvidence: base64
        };
        setSelectedOrder(updatedOrder);
        await dbSaveServiceOrder(updatedOrder);
        onReload();
      }
    };
    reader.readAsDataURL(file);
  };

  // Digital signature confirmation action saves as 'Concluída' and feeds asset history logs
  const handleSignConfirm = async (signatureBase64: string, signeeName: string) => {
    if (userHasActionPermission && !userHasActionPermission('sign_order')) {
      alert('Acesso Restrito: Seu perfil de usuário não tem autorização para assinar digitalmente e encerrar preventivas.');
      return;
    }
    if (!selectedOrder) return;

    const completedOrder: ServiceOrder = {
      ...selectedOrder,
      status: 'Concluída',
      signature: signatureBase64,
      signedBy: signeeName,
      signedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
      updatedAt: new Date().toISOString()
    };

    setSelectedOrder(completedOrder);
    await dbSaveServiceOrder(completedOrder);
    setShowSignaturePad(false);
    onReload();

    alert(`✅ ORDEM DE SERVIÇO CONCLUÍDA!\nA OS #${completedOrder.id} foi assinada digitalmente por ${signeeName}. Os dados foram gravados automaticamente no histórico do ativo: ${completedOrder.assetName}.`);
  };

  // Create new customized Service Order
  const handleCreateOSSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!osTitle || !osDescription || !osScheduledDate) {
      alert('Por favor, preencha todos os campos fundamentais (Título, Escopo e Agendamento).');
      return;
    }

    const selectedAsset = osAssetId ? assets.find(a => a.id === osAssetId) : undefined;

    // Build the dynamic Checklist items
    const checklistItems: ChecklistItem[] = osChecklist.map((task, idx) => ({
      id: `ck_${Date.now()}_${idx}`,
      task: task,
      checked: false,
      checkedAt: null,
      observations: null
    }));

    const newOSId = (28000 + Math.floor(Math.random() * 1000)).toString();

    const newServiceOrder: ServiceOrder = {
      id: newOSId,
      assetId: selectedAsset ? selectedAsset.id : null,
      assetName: selectedAsset ? selectedAsset.name : 'S/V - Vistoria / Serviço Geral',
      assetCode: selectedAsset ? selectedAsset.code : 'VISTORIA',
      sector: selectedAsset ? selectedAsset.sector : 'Vistoria',
      title: osTitle.trim(),
      description: osDescription.trim(),
      priority: osPriority,
      status: 'Planejada',
      scheduledDate: osScheduledDate,
      assignedTechnician: osTechnician,
      checklist: checklistItems,
      notes: '',
      signature: null,
      signedBy: null,
      signedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      photoEvidence: null
    };

    // Validate technician daily availability
    if (osScheduledDate && osTechnician) {
      const proceed = checkTechAssignment(osTechnician, osScheduledDate, newServiceOrder);
      if (!proceed) return;
    }

    try {
      await dbSaveServiceOrder(newServiceOrder);
      alert(`Ordem de serviço #${newOSId} registrada e planejada com checklist de ${checklistItems.length} itens!`);
      setShowAddModal(false);
      
      // Reset form fields
      setOsTitle('');
      setOsDescription('');
      setOsScheduledDate('');
      
      // Reload lists
      onReload();
    } catch (err) {
      console.error(err);
      alert('Erro ao registrar ordem de serviço.');
    }
  };

  // Add customized items to currently editing checklist
  const addCustomChecklistItem = () => {
    if (!newChecklistItemText.trim()) return;
    setOsChecklist([...osChecklist, newChecklistItemText.trim()]);
    setNewChecklistItemText('');
  };

  const removeChecklistItem = (indexToRem: number) => {
    setOsChecklist(osChecklist.filter((_, idx) => idx !== indexToRem));
  };


  // Helper to determine the comarca of an order
  const getOrderComarca = (os: ServiceOrder) => {
    if (os.isSurvey && os.surveyLocation) {
      return os.surveyLocation;
    }
    if (os.assetId && assets.length > 0) {
      const asset = assets.find(a => a.id === os.assetId);
      if (asset) {
        return asset.specs?.COMARCA || asset.specs?.comarca || (asset.location && asset.location.includes(' - ') ? asset.location.split(' - ')[0] : asset.location) || 'Geral';
      }
    }
    if (os.description && os.description.includes('Comarca:')) {
      const match = os.description.match(/Comarca:\s*([^.]+)/);
      if (match) return match[1].trim();
    }
    return 'Geral';
  };

  // Helper to determine the CRAAI of an order
  const getOrderCRAAI = (os: ServiceOrder) => {
    if (os.assetId && assets.length > 0) {
      const asset = assets.find(a => a.id === os.assetId);
      if (asset) {
        return asset.specs?.CRAAI || asset.specs?.craai || os.sector || 'Geral';
      }
    }
    return os.sector || 'Geral';
  };

  // helper to clean automatic description phrases and save massive space
  const cleanDescriptionText = (desc: string | null | undefined): string => {
    if (!desc) return '';
    let cleaned = desc;
    // Strip "Vistoria de rotina programada."
    cleaned = cleaned.replace(/Vistoria de rotina programada\.?/gi, '');
    // Strip "Procedimento autônomo sem vinculação com ativos de engenharia."
    cleaned = cleaned.replace(/Procedimento aut[ôo]nomo sem vincula[çc][ãa]o com ativos de engenharia\.?/gi, '');
    // Strip generic automatic activity messages
    cleaned = cleaned.replace(/Atividade preventiva autom[áa]t[ai]ca?\.?/gi, '');
    cleaned = cleaned.replace(/Atividade preventiva autom[áa]t?a\.?/gi, '');
    cleaned = cleaned.replace(/Vistoria preventiva autom[áa]t[ai]ca?\.?/gi, '');
    cleaned = cleaned.replace(/Execu[çc][ãa]o de rotina programada\.?/gi, '');
    // Strip "Comarca: [Anything]"
    cleaned = cleaned.replace(/Comarca:\s*[^.]+\.?/gi, '');
    
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    // Clean trailing dots or leftover punctuation
    if (/^[.,:\-\s]*$/.test(cleaned)) {
      return '';
    }
    return cleaned;
  };

  // 3 Action Handlers: Visualizar, Executar, Excluir
  const handleViewPreventive = (os: ServiceOrder) => {
    setSelectedOrder(os);
    setPhotoEvidenceBase64(os.photoEvidence);
    setShowDrawer(true);
  };

  const handleExecutePreventive = (os: ServiceOrder) => {
    setSelectedOrder(os);
    setPhotoEvidenceBase64(os.photoEvidence);
    setShowDrawer(true);
    
    // Automatically trigger signature pad / checklist if active
    if (os.status !== 'Concluída' && os.status !== 'Não Executada') {
      if (os.status === 'Planejada') {
        const updated = { ...os, status: 'Em Execução' as const };
        dbSaveServiceOrder(updated).then(() => {
          setSelectedOrder(updated);
          setShowSignaturePad(true);
          onReload();
        });
      } else {
        setShowSignaturePad(true);
      }
    } else {
      alert(`Esta preventiva #${os.id} já está concluída ou bloqueada (${os.status}).`);
    }
  };

  const handleDeletePreventive = (osId: string) => {
    if (userHasActionPermission && !userHasActionPermission('delete_order')) {
      alert('Acesso Restrito: Seu perfil de usuário não tem autorização para excluir preventivas.');
      return;
    }
    setOrderIdToDelete(osId);
  };

  // Generate unique list of comarcas and patrimonios for select dropdowns
  const comarcasList = Array.from(
    new Set(orders.map(os => getOrderComarca(os)).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  const patrimoniosList = Array.from(
    new Set(orders.map(os => os.assetCode).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  // Dynamic filtered orders listings
  const filteredOrders = orders.filter((os) => {
    const osComarca = getOrderComarca(os);
    const osPatrimonio = os.assetCode || '';
    const osId = os.id;

    // 1. Smart search matching
    let matchesSmart = true;
    if (smartSearch.trim() !== '') {
      const q = smartSearch.toLowerCase().trim();
      const cleanQ = q.startsWith('#') ? q.slice(1) : q;
      
      const matchId = osId.toLowerCase().includes(cleanQ);
      const matchPatrimonio = osPatrimonio.toLowerCase().includes(q);
      const matchComarca = osComarca.toLowerCase().includes(q);
      const matchTitle = os.title.toLowerCase().includes(q);
      const matchDesc = os.description.toLowerCase().includes(q);
      const matchTech = os.assignedTechnician.toLowerCase().includes(q);
      
      matchesSmart = matchId || matchPatrimonio || matchComarca || matchTitle || matchDesc || matchTech;
    }

    // 2. Comarca dropdown filter
    const matchesComarca = selectedComarca === 'Todas' || osComarca.toLowerCase().trim() === selectedComarca.toLowerCase().trim();

    // 3. Patrimônio dropdown filter
    const matchesPatrimonio = selectedPatrimonio === 'Todos' || osPatrimonio.toLowerCase().trim() === selectedPatrimonio.toLowerCase().trim();

    // 4. Status filter
    const matchesStatus = selectedStatus === 'Todos' || os.status === selectedStatus;

    // 5. Execution Date filter
    const matchesExecutionDate = !selectedExecutionDate || os.scheduledDate === selectedExecutionDate;

    return matchesSmart && matchesComarca && matchesPatrimonio && matchesStatus && matchesExecutionDate;
  });

  // Pagination calculation variables for 50 items per page
  const itemsPerPage = 50;
  const totalItems = filteredOrders.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
  const sanitizedPage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (sanitizedPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
  const paginatedOrders = filteredOrders.slice(startIndex, endIndex);

  // Bulk Selection and Controls Helpers
  const isAllSelected = paginatedOrders.length > 0 && paginatedOrders.every(os => selectedOrderIds.includes(os.id));
  const toggleSelectOrder = (id: string) => {
    setSelectedOrderIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };
  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedOrderIds(prev => prev.filter(id => !paginatedOrders.some(os => os.id === id)));
    } else {
      const pageIds = paginatedOrders.map(os => os.id);
      setSelectedOrderIds(prev => Array.from(new Set([...prev, ...pageIds])));
    }
  };

  const selectAndOpenOrderDrawer = (os: ServiceOrder) => {
    setSelectedOrder(os);
    setPhotoEvidenceBase64(os.photoEvidence);
    setFailedItemIds([]);
    setShowDrawer(true);
  };

  // Custom progress stepper value generator
  const getProgressPercentage = (os: ServiceOrder) => {
    if (os.status === 'Concluída') return 100;
    if (os.status === 'Planejada') return 0;
    if (os.checklist.length === 0) return 30;
    const completed = os.checklist.filter(c => c.checked).length;
    return Math.round((completed / os.checklist.length) * 100);
  };

  const monthNames = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];

  const handlePrevMonth = () => {
    setCurrentCalendarDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
    setSelectedCalendarDay(null);
  };

  const handleNextMonth = () => {
    setCurrentCalendarDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
    setSelectedCalendarDay(null);
  };

  const getMonthDays = () => {
    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();
    
    const firstDayIndex = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevDaysInMonth = new Date(year, month, 0).getDate();
    
    const days: { dayNum: number; isCurrentMonth: boolean; dateString: string }[] = [];
    
    // Previous Month padding
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const pmDay = prevDaysInMonth - i;
      const prevMonthDate = new Date(year, month - 1, pmDay);
      const dateString = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}-${String(pmDay).padStart(2, '0')}`;
      days.push({ dayNum: pmDay, isCurrentMonth: false, dateString });
    }
    
    // Current Month days
    for (let i = 1; i <= daysInMonth; i++) {
      const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      days.push({ dayNum: i, isCurrentMonth: true, dateString });
    }
    
    // Next Month padding
    const remainingSlots = 42 - days.length; // 6 rows of 7 days = 42 slots
    for (let i = 1; i <= remainingSlots; i++) {
      const nextMonthDate = new Date(year, month + 1, i);
      const dateString = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      days.push({ dayNum: i, isCurrentMonth: false, dateString });
    }
    
    return days;
  };

  const getOrdersForDay = (dayNum: number, isCurrentMonth: boolean) => {
    if (!isCurrentMonth) return [];
    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateStr = `${year}-${pad(month + 1)}-${pad(dayNum)}`;
    return orders.filter(os => os.scheduledDate && os.scheduledDate.startsWith(dateStr) && os.status !== 'Novo');
  };

  const availableProfessionals = users.filter(u => 
    u.perfil === 'Profissional' && 
    (userProfile?.gerencia === 'Todas' || u.gerencia === 'Todas' || u.gerencia === userProfile?.gerencia)
  );

  const normalizeStr = (str: string) => {
    return (str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ç/g, 'c')
      .trim();
  };

  const getAvailableProfessionalsForOS = (os: ServiceOrder) => {
    return users.filter(u => {
      if (u.perfil !== 'Profissional') return false;
      
      const adminGer = normalizeStr(userProfile?.gerencia || '');
      const uGer = normalizeStr(u.gerencia || '');
      const osSec = normalizeStr(os.sector || '');

      // Check manager's own gerencia restriction
      if (adminGer && adminGer !== 'todas') {
        if (uGer !== adminGer && uGer !== 'todas') return false;
      }
      
      // Check service order sector matching
      if (osSec && osSec !== 'all' && osSec !== 'todos') {
        if (osSec !== uGer && uGer !== 'todas') {
          // Fallback matches
          const isMatch = 
            (osSec.includes('refr') && uGer.includes('refr')) ||
            (osSec.includes('elet') && uGer.includes('elet')) ||
            (osSec.includes('civil') && uGer.includes('civil')) ||
            (osSec.includes('hidr') && uGer.includes('hidr')) ||
            (osSec.includes('seg') && uGer.includes('seg'));
          if (!isMatch) return false;
        }
      }
      return true;
    });
  };

  const validateTechnicianAssignment = (techName: string, dateStr: string, currentOS: ServiceOrder): { isValid: boolean; warnings: string[]; errors: string[] } => {
    // Limits have been disabled as per user request (no maximum, unlimited daily allocations allowed)
    return {
      isValid: true,
      warnings: [],
      errors: []
    };
  };

  const checkTechAssignment = (techName: string, dateStr: string, os: ServiceOrder): boolean => {
    const checkObj = validateTechnicianAssignment(techName, dateStr, os);
    if (!checkObj.isValid) {
      alert(`⚠️ IMPOSSÍVEL ATRIBUIR TÉCNICO:\n\n${checkObj.errors.join('\n')}`);
      return false;
    }
    if (checkObj.warnings.length > 0) {
      return window.confirm(`⚠️ ADVERTÊNCIA DE ALOCAÇÃO:\n\n${checkObj.warnings.join('\n')}\n\nDeseja ignorar os avisos de sobrecarga/conflito e programar mesmo assim?`);
    }
    return true;
  };

  const activeLinkedAsset = selectedOrder ? assets.find(a => a.id === selectedOrder.assetId) : null;

  return (
    <div className="space-y-6 font-sans">
      {/* Informação / Alerta de Prazo Crítico Central Popup */}
      {showDeadlineWarnPopup && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/65 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xl max-w-md w-full animate-in zoom-in duration-200 text-left">
            <div className="flex items-center gap-3 text-amber-600 mb-4">
              <div className="bg-amber-105 p-3 rounded-full">
                <AlertTriangle className="w-7 h-7" />
              </div>
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">⚠️ ALERTA DE PRAZO CRÍTICO</h3>
                <span className="text-[10px] bg-amber-100 text-amber-900 px-2 py-0.5 rounded-md font-extrabold uppercase mt-1 inline-block">Gerência {warnPopupManagement}</span>
              </div>
            </div>
            
            <p className="text-xs text-slate-600 leading-relaxed font-semibold">
              Prezado Administrador, o prazo restrito para agendamento e alocação do atual lote de preventivas se encerrará em menos de 24 horas!
            </p>
            
            <div className="my-5 p-3.5 bg-amber-50 rounded-xl border border-amber-200 flex items-center justify-between font-mono">
              <span className="text-[11px] font-black uppercase text-slate-655">Tempo Restante:</span>
              <span className="text-xs font-black uppercase text-amber-850 animate-pulse">{warnPopupTimeText}</span>
            </div>
            
            <p className="text-[10px] text-slate-400 italic leading-relaxed">
              *Nota: Após o encerramento do prazo, todas as preventivas/vistorias com status "Novo" que não forem agendadas serão automaticamente cadastradas como "Não Executada", e o acesso a este calendário será bloqueado.
            </p>
            
            <div className="pt-6 border-t border-slate-150 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setHasDismissedTemp(true);
                  setShowDeadlineWarnPopup(false);
                }}
                className="w-full sm:w-auto px-6 py-2.5 bg-[#3525cd] hover:bg-[#281bbb] text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-md transition-all active:scale-95 cursor-pointer h-[40px] flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4 text-white" />
                Estou Ciente do Prazo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dynamic Countdowns / Status Bar for Administrator */}
      {userProfile?.perfil === 'Administrador' && userProfile.gerencia && userProfile.gerencia !== 'Todas' && (() => {
        const deadline = deadlines.find(d => d.id === userProfile.gerencia);
        if (!deadline || !deadline.expiresAt) return null;
        const { isExpired, text, hoursLeft } = getCountdownText(deadline.expiresAt);
        return (
          <div className={`p-3.5 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all ${
            isExpired 
              ? 'bg-rose-50 border-rose-200 text-rose-900 animate-pulse' 
              : hoursLeft <= 24 
                ? 'bg-amber-50 border-amber-200 text-amber-900 animate-pulse' 
                : 'bg-emerald-50 border-emerald-100 text-emerald-950'
          }`}>
            <div className="flex items-center gap-2.5">
              <div className={`p-2 rounded-lg ${isExpired ? 'bg-rose-105 text-rose-700' : hoursLeft <= 24 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                <Clock className="w-5 h-5 animate-spin" style={{ animationDuration: isExpired ? '0s' : hoursLeft <= 24 ? '3s' : '10s' }} />
              </div>
              <div className="text-left">
                <h4 className="text-[10.5px] font-black uppercase tracking-wider">
                  Tempo Limite para Planejamento de Preventivas ({userProfile.gerencia})
                </h4>
                <p className="text-[11px] opacity-80 mt-0.5 leading-relaxed font-semibold">
                  {isExpired 
                    ? 'Acesso ao planejamento suspenso devido a expiração do prazo de 7 dias.' 
                    : 'A gerência precisa lançar e atribuir todas as preventivas de campo no calendário antes do fim deste prazo.'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 bg-white/60 backdrop-blur-xs px-4 py-2 rounded-lg shadow-3xs border border-white/50 self-end md:self-auto">
              <span className="text-[10px] font-black uppercase tracking-wider opacity-60">Tempo Restante:</span>
              <span className={`text-xs font-mono font-black uppercase ${isExpired ? 'text-rose-600' : hoursLeft <= 24 ? 'text-amber-600' : 'text-[#3525cd]'}`}>
                {text}
              </span>
            </div>
          </div>
        );
      })()}

      {/* Super Admin Deadline Control Center */}
      {userProfile?.perfil === 'Super Administrador' && (
        <div className="bg-slate-50 border border-slate-205 rounded-xl p-5 text-left">
          <div className="flex items-center gap-2 mb-4">
            <ClipboardList className="w-5 h-5 text-indigo-750" />
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">⚙️ Painel de Controle de Prazos das Gerências</h3>
              <p className="text-[10px] text-slate-400 font-bold">Como Super Administrador, você define a data e horário limite para o planejamento das preventivas de cada gerência.</p>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {['GMC', 'GMMR', 'GMEE'].map(mId => {
              const dlObj = deadlines.find(d => d.id === mId);
              const { text, isExpired, hoursLeft } = dlObj ? getCountdownText(dlObj.expiresAt) : { text: 'Nenhum prazo definido', isExpired: false, hoursLeft: 999 };
              const hasValidDeadline = dlObj && dlObj.expiresAt && dlObj.expiresAt !== 'none';
              
              return (
                <div key={mId} className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-3xs flex flex-col justify-between hover:shadow-2xs transition-shadow">
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-black text-slate-800 tracking-wider">Gerência {mId}</span>
                      <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${
                        !hasValidDeadline
                          ? 'bg-slate-100 text-slate-500'
                          : isExpired 
                            ? 'bg-rose-100 text-rose-700' 
                            : hoursLeft <= 24 
                              ? 'bg-amber-100 text-amber-700 animate-pulse' 
                              : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {!hasValidDeadline ? 'Sem Prazo' : isExpired ? 'Expirado' : hoursLeft <= 24 ? 'Crítico (<24h)' : 'Liberado'}
                      </span>
                    </div>
                    
                    <p className="text-[11px] font-mono text-slate-400 mt-1">
                      Limite Atual: <span className="font-extrabold text-slate-700">{hasValidDeadline ? new Date(dlObj.expiresAt).toLocaleString('pt-BR') : 'Sem prazo definido'}</span>
                    </p>
                    <p className="text-[11px] font-bold text-slate-655 mt-1.5 flex items-center gap-1">
                      ⏳ Restam: <strong className="text-[#3525cd] font-black">{hasValidDeadline ? text : 'Sem prazo definido'}</strong>
                    </p>

                    {/* Custom DateTime Selection Input for the Super Admin */}
                    <div className="mt-4 pt-3.5 border-t border-dashed border-slate-150">
                      <label className="block text-[10px] font-black uppercase text-slate-500 mb-1.5">
                        Definir Prazo Limite:
                      </label>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="datetime-local"
                          value={customDates[mId] || ''}
                          onChange={(e) => setCustomDates(prev => ({ ...prev, [mId]: e.target.value }))}
                          className="text-[11px] font-semibold border border-slate-200 rounded-lg px-2.5 py-1 bg-slate-50 focus:bg-white text-slate-800 flex-1 outline-none focus:border-[#3525cd] focus:ring-1 focus:ring-[#3525cd]/20 h-[34px] w-full"
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            const val = customDates[mId];
                            if (!val) {
                              alert('Selecione uma data e hora válidas antes de confirmar.');
                              return;
                            }
                            const isoString = new Date(val).toISOString();
                            // Update React state immediately for snappy UX
                            setDeadlines(prev => {
                              const existing = prev.find(d => d.id === mId);
                              if (existing) {
                                return prev.map(d => d.id === mId ? { ...d, expiresAt: isoString } : d);
                              } else {
                                return [...prev, { id: mId, expiresAt: isoString }];
                              }
                            });
                            await dbSavePlanningDeadline({ id: mId, expiresAt: isoString });
                            alert(`Prazo da gerência ${mId} definido com sucesso para ${new Date(isoString).toLocaleString('pt-BR')}!`);
                            onReload();
                            loadDeadlines();
                          }}
                          className="px-6 bg-[#3525cd] hover:bg-[#281bbb] active:scale-98 text-white text-[10.5px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer flex items-center justify-center shadow-3xs h-[34px] shrink-0 w-full sm:w-auto"
                        >
                          OK
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      
      {/* SECTION: Page Hero Header */}
      <section className="bg-white rounded-xl p-6 md:p-7 border border-slate-200 shadow-sm relative overflow-hidden transition-all duration-200 hover:shadow-md flex items-center justify-between">
        <div className="relative z-10 max-w-4xl border-l-4 border-[#3525cd] pl-4 md:pl-5">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3525cd] animate-pulse"></span>
            <span className="text-[10px] font-black text-[#3525cd] tracking-widest uppercase">
              Cronograma & Execução Técnica
            </span>
          </div>
          <h1 className="text-xl md:text-2xl font-black text-slate-800 tracking-tight leading-snug">
            Ordens de Serviço — <span className="text-[#3525cd]">Preventivas de Campo</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1 max-w-3xl leading-relaxed">
            Consulte os roteiros, checklists operacionais, andamento das execuções e detalhes técnicos por comarca e patrimônio.
          </p>
        </div>

        {/* Backdrop Visual Accent */}
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-[#3525cd]/5 to-transparent pointer-events-none md:block hidden"></div>
      </section>

      {/* SECTION: Sub-Tabs Selector */}
      {userProfile?.perfil !== 'Profissional' && (
        <div className="border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-1">
          <div className="flex bg-slate-100/60 p-1 rounded-xl border border-slate-200/80 gap-1 w-full sm:w-auto md:min-w-[420px]">
            <button
              type="button"
              onClick={() => setSubTab('planejamento')}
              className={`flex-1 py-2 px-3 sm:px-4 rounded-lg text-[11px] md:text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all duration-205 cursor-pointer ${
                subTab === 'planejamento'
                  ? 'bg-[#3525cd] text-white shadow-sm'
                  : 'text-slate-650 hover:bg-slate-200/50 hover:text-slate-800'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Planejamento & Calendário</span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab('realizacao')}
              className={`flex-1 py-2 px-3 sm:px-4 rounded-lg text-[11px] md:text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all duration-205 cursor-pointer ${
                subTab === 'realizacao'
                  ? 'bg-[#3525cd] text-white shadow-sm'
                  : 'text-slate-650 hover:bg-slate-200/50 hover:text-[#0b1c30]'
              }`}
            >
              <Wrench className="w-3.5 h-3.5" />
              <span>Realização & Execução</span>
            </button>
          </div>

          <div className="text-[10px] text-slate-450 font-bold hidden sm:flex items-center gap-1.5 pr-2 uppercase tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
            Interface Administrativa
          </div>
        </div>
      )}

      {subTab === 'planejamento' && userProfile?.perfil !== 'Profissional' ? (() => {
        let isPlanningExpired = false;
        if (userProfile?.perfil === 'Administrador' && userProfile.gerencia && userProfile.gerencia !== 'Todas') {
          const dlObj = deadlines.find(d => d.id === userProfile.gerencia);
          if (dlObj && dlObj.expiresAt && dlObj.expiresAt !== 'none') {
            const countdownHelper = getCountdownText(dlObj.expiresAt);
            isPlanningExpired = countdownHelper.isExpired;
          }
        }

        if (isPlanningExpired) {
          return (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-12 text-center max-w-2xl mx-auto my-12 shadow-sm animate-fadeIn">
              <div className="w-16 h-16 bg-rose-50 border border-rose-200 text-rose-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <AlertTriangle className="w-8 h-8" />
              </div>
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-800 mb-2">
                Acesso Bloqueado: Prazo de Programação Expirado
              </h3>
              <p className="text-xs text-slate-500 font-semibold leading-relaxed max-w-lg mx-auto">
                O prazo de 7 dias úteis/corridos concedido à sua gerência (<strong className="text-slate-800">{userProfile?.gerencia}</strong>) para planejamento e alocação das ordens preventivas no calendário expirou.
              </p>
              <div className="bg-rose-50/50 border border-rose-100 rounded-xl p-4 my-6 text-[11px] text-rose-800 font-bold max-w-md mx-auto leading-relaxed">
                Todas as preventivas/vistorias que aguardavam programação foram finalizadas automaticamente como "Não Executada".
              </div>
              <p className="text-[11.5px] text-slate-400 font-semibold">
                Caso necessite de mais tempo para realizar alterações, solicite ao <strong className="text-slate-705">Super Administrador</strong> a extensão do prazo limite e ajuste do cronograma.
              </p>
            </div>
          );
        }

        return (
          <div className="space-y-6 animate-fadeIn">
          {/* Top Informative Banner with dynamic instructions */}
          <div className="bg-[#3525cd]/5 border border-[#3525cd]/15 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="bg-[#3525cd]/10 p-2 rounded-lg text-[#3525cd]">
                <Calendar className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wider text-[#3525cd]">
                  Painel de Alocação e Programação de Preventivas
                </h4>
                <p className="text-[11px] text-slate-500 font-semibold mt-0.5 leading-relaxed">
                  {selectedCalendarDay === null
                    ? 'Selecione um dia no calendário abaixo para abrir o painel inteligente de programação das novas preventivas.'
                    : `Dia em programação ativa: ${selectedCalendarDay} de ${monthNames[currentCalendarDate.getMonth()]} de ${currentCalendarDate.getFullYear()}.`}
                </p>
              </div>
            </div>
            {selectedCalendarDay !== null && (
              <button
                type="button"
                onClick={() => setSelectedCalendarDay(null)}
                className="text-xs font-bold text-[#3525cd] bg-white hover:bg-slate-50 border border-slate-205 px-3.5 py-1.5 rounded-lg shadow-2xs transition-all cursor-pointer flex items-center gap-1.5"
              >
                <X className="w-3.5 h-3.5" />
                Fechar Painel e Ver Calendário Completo
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* COLUMN 1: Calendar Widget */}
            <div className={`${selectedCalendarDay === null ? 'lg:col-span-12 max-w-4xl mx-auto w-full' : 'lg:col-span-5'} bg-white rounded-xl p-5 border border-slate-200 shadow-sm transition-all duration-300`}>
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-xs font-black text-slate-800 uppercase tracking-widest flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-[#3525cd]" />
                  Calendário de Distribuição
                </h2>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handlePrevMonth}
                    className="p-1 px-2 border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer text-slate-600 transition-colors"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-xs font-black text-slate-800 uppercase min-w-[110px] text-center select-none">
                    {monthNames[currentCalendarDate.getMonth()]} {currentCalendarDate.getFullYear()}
                  </span>
                  <button
                    type="button"
                    onClick={handleNextMonth}
                    className="p-1 px-2 border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer text-slate-600 transition-colors"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Day headers */}
              <div className="grid grid-cols-7 gap-1.5 text-center mb-1.5 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                <div>Dom</div>
                <div>Seg</div>
                <div>Ter</div>
                <div>Qua</div>
                <div>Qui</div>
                <div>Sex</div>
                <div>Sáb</div>
              </div>

              {/* Day grid */}
              <div className="grid grid-cols-7 gap-1.5">
                {getMonthDays().map((day, dIdx) => {
                  const isCurrentDay = day.isCurrentMonth && day.dayNum === new Date().getDate() && currentCalendarDate.getMonth() === new Date().getMonth() && currentCalendarDate.getFullYear() === new Date().getFullYear();
                  const isSelected = day.isCurrentMonth && selectedCalendarDay === day.dayNum;
                  
                  const dayOrders = getOrdersForDay(day.dayNum, day.isCurrentMonth);
                  const totalCount = dayOrders.length;
                  const completedCount = dayOrders.filter(o => o.status === 'Concluída').length;
                  const pendingCount = totalCount - completedCount;

                  return (
                    <button
                      key={dIdx}
                      type="button"
                      onClick={() => {
                        if (day.isCurrentMonth) {
                          setSelectedCalendarDay(day.dayNum);
                        }
                      }}
                      className={`min-h-[64px] border rounded-xl p-1.5 flex flex-col justify-between transition-all duration-200 relative text-left w-full ${
                        day.isCurrentMonth 
                          ? 'bg-white border-slate-200 hover:border-[#3525cd] hover:shadow-xs cursor-pointer' 
                          : 'bg-slate-50/40 border-slate-100 text-slate-350 cursor-not-allowed pointer-events-none'
                      } ${
                        isSelected 
                          ? 'ring-2 ring-[#3525cd] border-[#3525cd] bg-indigo-50/10 shadow-xs' 
                          : ''
                      } ${
                        isCurrentDay ? 'border-[#3525cd] bg-slate-50' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className={`text-[11px] font-black ${day.isCurrentMonth ? (isCurrentDay ? 'text-[#3525cd] bg-indigo-50/80 px-1.5 py-0.5 rounded-md border border-indigo-100' : 'text-slate-800') : 'text-slate-350'}`}>
                          {day.dayNum}
                        </span>
                        {isCurrentDay && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#3525cd]" title="Hoje" />
                        )}
                      </div>
                      
                      {day.isCurrentMonth && totalCount > 0 ? (
                        <div className="flex flex-col gap-0.5 mt-1.5">
                          <span className="bg-[#3525cd]/10 text-[#3525cd] text-[8.5px] font-black rounded px-1 py-0.2 select-none">
                            {totalCount} OS Pl.
                          </span>
                          {pendingCount > 0 ? (
                            <span className="bg-amber-100 text-amber-800 text-[7px] font-black rounded px-1 py-0.1 select-none text-center">
                              {pendingCount} pend
                            </span>
                          ) : (
                            <span className="bg-emerald-100 text-emerald-800 text-[7px] font-black rounded px-1 py-0.1 select-none flex items-center justify-center text-center">
                              ✓ Concl.
                            </span>
                          )}
                        </div>
                      ) : (
                        day.isCurrentMonth && (
                          <span className="text-[7.5px] text-slate-350 font-black italic mt-1 uppercase select-none">
                            Vazio
                          </span>
                        )
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Monthly totals summary section inside calendar widget */}
              <div className="mt-6 pt-4 border-t border-slate-100">
                <h3 className="text-[10px] font-black text-slate-450 uppercase tracking-widest mb-3">
                  Estatísticas de Programação ({monthNames[currentCalendarDate.getMonth()]})
                </h3>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-indigo-50/40 rounded-xl p-2.5 border border-indigo-100/50">
                    <p className="text-[9px] font-black text-slate-450 uppercase tracking-wider leading-tight">Preventivas Planejadas</p>
                    <p className="text-base font-bold text-[#3525cd] mt-0.5">
                      {orders.filter(os => {
                        if (!os.scheduledDate || os.status === 'Novo') return false;
                        const d = new Date(os.scheduledDate);
                        return d.getMonth() === currentCalendarDate.getMonth() && d.getFullYear() === currentCalendarDate.getFullYear();
                      }).length}
                    </p>
                  </div>
                  <div className="bg-emerald-50/40 rounded-xl p-2.5 border border-emerald-100/40">
                    <p className="text-[9px] font-black text-emerald-600 uppercase tracking-wider leading-tight">Preventivas Concluídas</p>
                    <p className="text-base font-bold text-emerald-700 mt-0.5">
                      {orders.filter(os => {
                        if (!os.scheduledDate || os.status !== 'Concluída') return false;
                        const d = new Date(os.scheduledDate);
                        return d.getMonth() === currentCalendarDate.getMonth() && d.getFullYear() === currentCalendarDate.getFullYear();
                      }).length}
                    </p>
                  </div>
                  <div className="bg-yellow-50/40 rounded-xl p-2.5 border border-amber-100/30">
                    <p className="text-[9px] font-black text-slate-450 uppercase tracking-wider leading-tight">Aguardando Programação</p>
                    <p className="text-base font-bold text-amber-700 mt-0.5">
                      {orders.filter(os => os.status === 'Novo' && 
                        (userProfile?.perfil !== 'Administrador' || userProfile?.gerencia === 'Todas' || isSectorInGerencia(os.sector, userProfile?.gerencia))
                      ).length}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* COLUMN 2: Allocation & Interactive Programming Panel (Shown only when a day is selected) */}
            {selectedCalendarDay !== null && (() => {
              const padNum = (n: number) => String(n).padStart(2, '0');
              const selectedDateStr = `${currentCalendarDate.getFullYear()}-${padNum(currentCalendarDate.getMonth() + 1)}-${padNum(selectedCalendarDay)}`;

              // 1. Get already scheduled orders for this specific day
              const dayScheduledOrders = orders.filter(os => {
                if (userProfile?.perfil === 'Administrador' && userProfile.gerencia && userProfile.gerencia !== 'Todas') {
                  if (!isSectorInGerencia(os.sector, userProfile.gerencia)) return false;
                }
                return os.status !== 'Novo' && os.scheduledDate && os.scheduledDate.startsWith(selectedDateStr);
              });

              // 2. Get all 'Novo' preventives awaiting scheduling, filtered by criteria
              const rawNewOrders = orders.filter(os => {
                if (os.status !== 'Novo') return false;
                // Sector restrictions for managers
                if (userProfile?.perfil === 'Administrador' && userProfile.gerencia && userProfile.gerencia !== 'Todas') {
                  return isSectorInGerencia(os.sector, userProfile.gerencia);
                }
                return true;
              });

              // Apply planning filters
              const filteredNewOrders = rawNewOrders.filter(os => {
                // Sector filter (for admins who can see all, e.g. Super Admin)
                if (planSector !== 'all' && os.sector.toLowerCase().trim() !== planSector.toLowerCase().trim()) return false;

                // Date compatibility constraint
                if (planOnlyCompatible) {
                  if (os.startDate && os.endDate) {
                    if (selectedDateStr < os.startDate || selectedDateStr > os.endDate) {
                      return false;
                    }
                  }
                }

                // Search term
                if (planSearch.trim()) {
                  const q = planSearch.toLowerCase().trim();
                  if (planSearchType === 'id') {
                    const cleanId = os.id.toLowerCase().replace(/#/g, '').trim();
                    if (!cleanId.includes(q) && !os.id.toLowerCase().includes(q)) return false;
                  } else if (planSearchType === 'patrimonio') {
                    const cleanCode = (os.assetCode || '').toLowerCase().trim();
                    if (!cleanCode.includes(q)) return false;
                  } else if (planSearchType === 'craai') {
                    const cleanCRAAI = getOrderCRAAI(os).toLowerCase().trim();
                    if (!cleanCRAAI.includes(q)) return false;
                  } else if (planSearchType === 'comarca') {
                    const cleanComarca = getOrderComarca(os).toLowerCase().trim();
                    if (!cleanComarca.includes(q)) return false;
                  } else {
                    const matchTitle = (os.title || '').toLowerCase().includes(q);
                    const matchDesc = (os.description || '').toLowerCase().includes(q);
                    const matchAsset = (os.assetCode || '').toLowerCase().includes(q) || (os.assetName || '').toLowerCase().includes(q);
                    const matchId = os.id.includes(q);
                    const matchCRAAI = getOrderCRAAI(os).toLowerCase().includes(q);
                    const matchComarca = getOrderComarca(os).toLowerCase().includes(q);
                    if (!matchTitle && !matchDesc && !matchAsset && !matchId && !matchCRAAI && !matchComarca) return false;
                  }
                }

                return true;
              });

              return (
                <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col animate-slideIn">
                  {/* Top Header of the Selection Panel */}
                  <div className="bg-slate-50 border-b border-slate-100 p-4 shrink-0 flex items-center justify-between">
                    <div>
                      <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5 mt-0.5">
                        <SlidersHorizontal className="w-4 h-4 text-indigo-600" />
                        Distribuição do Dia: {selectedCalendarDay}/{currentCalendarDate.getMonth() + 1}/{currentCalendarDate.getFullYear()}
                      </h3>
                      <p className="text-[10px] text-slate-500 font-bold mt-1 uppercase tracking-wide">
                        Gerência: {userProfile?.gerencia || 'Todas'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedCalendarDay(null)}
                      className="p-1.5 hover:bg-slate-200 text-slate-500 rounded-lg transition-colors cursor-pointer"
                      title="Fechar"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Selector Tabs: Novas vs Agendadas */}
                  <div className="flex border-b border-slate-100 bg-slate-50/40 p-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setPlanActiveTab('novas')}
                      className={`flex-1 py-2 px-3 text-[11px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                        planActiveTab === 'novas'
                          ? 'bg-white text-[#3525cd] shadow-2xs border border-slate-200/50'
                          : 'text-slate-500 hover:text-slate-850 hover:bg-slate-100/50'
                      }`}
                    >
                      <PlusCircle className="w-3.5 h-3.5" />
                      Novas Preventivas ({filteredNewOrders.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setPlanActiveTab('agendadas')}
                      className={`flex-1 py-2 px-3 text-[11px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                        planActiveTab === 'agendadas'
                          ? 'bg-white text-[#3525cd] shadow-2xs border border-slate-200/50'
                          : 'text-slate-500 hover:text-slate-805 hover:bg-slate-100/50'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Já Agendadas Hoje ({dayScheduledOrders.length})
                    </button>
                  </div>

                  {/* Panel Body */}
                  <div className="p-4 space-y-4 max-h-[640px] overflow-y-auto bg-slate-50/20">
                    
                    {/* Render TAB: Novas Preventivas / Awaiting Planning */}
                    {planActiveTab === 'novas' && (
                      <div className="space-y-4">
                        {/* Interactive Filter Widget block */}
                        <div className="bg-white p-3.5 rounded-xl border border-slate-150 space-y-3 shadow-2xs">
                          <p className="text-[10px] font-black text-slate-450 uppercase tracking-widest">
                            Filtros de Apoio ao Agendamento
                          </p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {/* Smart Filter side-by-side selection layout */}
                            <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200/60">
                              <div className="sm:col-span-1">
                                <label className="text-[9px] font-black text-slate-450 uppercase tracking-wilder block mb-1">
                                  Pesquisar por:
                                </label>
                                <select
                                  value={planSearchType}
                                  onChange={(e) => {
                                    setPlanSearchType(e.target.value as any);
                                    setPlanSearch('');
                                  }}
                                  className="w-full text-xs p-1.5 bg-white border border-slate-250 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-bold text-[#3525cd] h-[34px]"
                                >
                                  <option value="all">🔍 Todos os Campos</option>
                                  <option value="id">🆔 ID único</option>
                                  <option value="patrimonio">🏷️ Patrimônio</option>
                                  <option value="craai">🏢 CRAAI</option>
                                  <option value="comarca">📍 Comarca</option>
                                </select>
                              </div>

                              <div className="sm:col-span-2 relative">
                                <label className="text-[9px] font-black text-slate-450 uppercase tracking-wilder block mb-1">
                                  Texto de Pesquisa Inteligente:
                                </label>
                                <div className="relative">
                                  <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400" />
                                  <input
                                    type="text"
                                    placeholder={
                                      planSearchType === 'id' ? 'Ex: 15' :
                                      planSearchType === 'patrimonio' ? 'Ex: REFR-04' :
                                      planSearchType === 'craai' ? 'Ex: Capital' :
                                      planSearchType === 'comarca' ? 'Ex: Cabo Frio' :
                                      'Digite o termo de busca...'
                                    }
                                    value={planSearch}
                                    onChange={(e) => setPlanSearch(e.target.value)}
                                    className="w-full text-xs pl-8 pr-2.5 py-1.5 bg-white border border-slate-250 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold text-slate-800 h-[34px]"
                                  />
                                </div>
                              </div>
                            </div>



                            {/* Toggle Compatibilidade Checklist */}
                            <div className="md:col-span-2 flex items-center gap-2 bg-indigo-50/40 p-2.5 rounded-lg border border-indigo-100">
                              <input
                                type="checkbox"
                                id="planOnlyCompatible"
                                checked={planOnlyCompatible}
                                onChange={(e) => setPlanOnlyCompatible(e.target.checked)}
                                className="w-3.5 h-3.5 text-[#3525cd] focus:ring-[#3525cd] border-slate-300 rounded cursor-pointer"
                              />
                              <label htmlFor="planOnlyCompatible" className="text-[10px] font-bold text-slate-700 select-none cursor-pointer leading-wide">
                                Filtrar compatíveis com a janela deste dia ({selectedCalendarDay}/{currentCalendarDate.getMonth() + 1})
                              </label>
                            </div>
                          </div>
                        </div>

                        {/* Bulk Scheduling Action Block */}
                        {filteredNewOrders.length > 0 && (
                          <div className="bg-indigo-50/30 p-4 rounded-xl border border-indigo-100 border-l-4 border-l-indigo-600 shadow-3xs flex flex-col gap-3.5 animate-fadeIn">
                            <div className="flex items-start gap-2.5">
                              <div className="p-1.5 bg-indigo-100 text-[#3525cd] rounded-lg shrink-0">
                                <CheckSquare className="w-4 h-4" />
                              </div>
                              <div className="text-left space-y-0.5">
                                <span className="text-[10px] font-black text-[#3525cd] uppercase tracking-widest block">
                                  Agendamento em Lote Ativo ⚡
                                </span>
                                <p className="text-[11px] text-slate-650 font-medium">
                                  Você pode programar de uma só vez as <strong>{filteredNewOrders.length}</strong> preventivas que foram filtradas para este dia.
                                </p>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2.5 border-t border-indigo-100/50 items-end">
                              {/* Option to assign same technician */}
                              <div className="text-left flex flex-col gap-1 w-full">
                                <span className="text-[9px] font-black text-slate-500 uppercase tracking-wider block">
                                  TÉCNICO DOS AGENDAMENTOS (OPCIONAL)
                                </span>
                                <select
                                  value={bulkAssignTech}
                                  onChange={(e) => setBulkAssignTech(e.target.value)}
                                  className="w-full text-xs p-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-bold text-slate-800 shadow-3xs h-[36px]"
                                >
                                  <option value="">⚙️ Automático / Por Atividade</option>
                                  {availableProfessionals.map(u => (
                                    <option key={u.id} value={u.name}>
                                      👤 {u.name} ({u.gerencia || 'Profissional'})
                                    </option>
                                  ))}
                                </select>
                              </div>

                              {/* Action Button */}
                              <div className="w-full">
                                <button
                                  type="button"
                                  disabled={isBulkScheduling}
                                  onClick={() => {
                                    setShowBulkConfirmModal(true);
                                  }}
                                  className={`w-full py-2 px-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-black text-xs uppercase tracking-wider rounded-lg transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer h-[36px] ${
                                    isBulkScheduling ? 'opacity-70 cursor-not-allowed' : ''
                                  }`}
                                >
                                  {isBulkScheduling ? (
                                    <>
                                      <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                                      Processando...
                                    </>
                                  ) : (
                                    <>
                                      <CheckSquare className="w-4 h-4 text-white" />
                                      Programar em Lote
                                    </>
                                  )}
                                </button>
                              </div>

                              {/* Custom Confirmation Modal for Bulk Actions */}
                              {showBulkConfirmModal && (
                                <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs font-sans text-left">
                                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xl max-w-md w-full animate-in zoom-in duration-150">
                                    <div className="flex items-center gap-3 text-emerald-600 mb-4 pb-3 border-b border-slate-100">
                                      <div className="bg-emerald-50 p-2 rounded-full border border-emerald-100">
                                        <CheckSquare className="w-6 h-6 text-emerald-600" />
                                      </div>
                                      <div>
                                        <h2 className="text-xs font-black uppercase tracking-wider text-slate-800">Confirmar Programação em Lote</h2>
                                        <p className="text-[10px] text-emerald-600 font-bold uppercase tracking-wide">Agendamento de Preventivas</p>
                                      </div>
                                    </div>

                                    <div className="space-y-3 mb-6 text-xs text-slate-650 font-semibold leading-relaxed">
                                      <p>
                                        Deseja agendar as <strong className="text-[#3525cd]">{filteredNewOrders.length}</strong> preventivas filtradas para o dia <strong className="text-[#3525cd]">{selectedCalendarDay}/{currentCalendarDate.getMonth() + 1}</strong>?
                                      </p>
                                      <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-[11px]">
                                        <span className="text-[9px] font-black text-gray-400 uppercase tracking-wider block mb-1">Candidato(s) Designado(s)</span>
                                        {bulkAssignTech ? (
                                          <p className="font-bold text-slate-800">
                                            👤 Técnico fixo: <span className="text-[#3525cd]">{bulkAssignTech}</span>
                                          </p>
                                        ) : (
                                          <p className="font-bold text-slate-650">
                                            ⚙️ Automático / Conforme a especialidade do profissional técnico e as regras de cada atividade cadastrada.
                                          </p>
                                        )}
                                      </div>
                                    </div>

                                    <div className="flex gap-2.5 justify-end text-xs">
                                      <button
                                        type="button"
                                        onClick={() => setShowBulkConfirmModal(false)}
                                        className="px-4 py-2 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-55 font-black uppercase text-[10px] tracking-wider cursor-pointer"
                                      >
                                        Cancelar
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isBulkScheduling}
                                        onClick={async () => {
                                          setIsBulkScheduling(true);
                                          setShowBulkConfirmModal(false);
                                          try {
                                            for (const os of filteredNewOrders) {
                                              const matchedTechs = getAvailableProfessionalsForOS(os);
                                              const defaultTech = bulkAssignTech || planAssignedTechs[os.id] || matchedTechs[0]?.name || users.find(u => u.perfil === 'Profissional')?.name || 'Daniel Torres';
                                              
                                              const updatedOS = {
                                                ...os,
                                                status: 'Planejada' as const,
                                                scheduledDate: selectedDateStr,
                                                assignedTechnician: defaultTech,
                                                updatedAt: new Date().toISOString()
                                              };
                                              await dbSaveServiceOrder(updatedOS);
                                            }
                                            onReload();
                                            alert(`⚡ SUCESSO!\nAs ${filteredNewOrders.length} preventivas foram agendadas para o dia ${selectedCalendarDay}/${currentCalendarDate.getMonth() + 1} com sucesso.`);
                                          } catch (err) {
                                            alert(`Erro ao realizar agendamento em lote: ${err}`);
                                          } finally {
                                            setIsBulkScheduling(false);
                                          }
                                        }}
                                        className="px-4 py-2 bg-[#3525cd] hover:bg-[#2010aa] text-white rounded-lg font-black uppercase text-[10px] tracking-wider cursor-pointer shadow-sm transition-all"
                                      >
                                        Confirmar Agenda
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Order cards list */}
                        {filteredNewOrders.length === 0 ? (
                          <div className="text-center py-10 bg-white border border-slate-200 rounded-xl">
                            <AlertTriangle className="w-7 h-7 text-amber-500 mx-auto mb-2" />
                            <p className="text-xs font-bold text-slate-700">Nenhuma preventiva nova encontrada</p>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              Tente flexibilizar os critérios de pesquisa ou desmarcar o filtro de data.
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {filteredNewOrders.map((os) => {
                              // Verify compatibility with selected date
                              let isCompatible = true;
                              if (os.startDate && os.endDate) {
                                isCompatible = (selectedDateStr >= os.startDate && selectedDateStr <= os.endDate);
                              }
                              
                              const assignedTechName = planAssignedTechs[os.id] || '';

                              return (
                                <div 
                                  key={os.id} 
                                  className={`border transition-all duration-250 rounded-xl p-4 bg-white shadow-2xs space-y-3 relative ${
                                    isCompatible 
                                      ? 'border-slate-150 hover:shadow-xs' 
                                      : 'border-slate-200 bg-slate-50/20 opacity-60'
                                  }`}
                                >
                                  {/* OS Card Header */}
                                  <div className="flex flex-wrap items-center justify-between gap-1 border-b border-slate-100 pb-2">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono text-[11px] font-black text-[#3525cd] bg-indigo-50 px-2 py-0.5 rounded-md">
                                        #{os.id}
                                      </span>
                                      <span className="bg-slate-100 text-slate-650 text-[9px] font-black uppercase px-2 py-0.5 rounded border border-slate-200">
                                        {os.sector}
                                      </span>
                                    </div>
                                    <span className="text-[9px] font-extrabold uppercase tracking-widest px-2 py-0.5 bg-amber-55 bg-amber-55/60 text-amber-700 rounded-full border border-amber-205">
                                      Pendente de Agenda
                                    </span>
                                  </div>

                                  {/* Title and Description */}
                                  <div>
                                    <h4 className="text-xs font-extrabold text-slate-800 leading-snug">{os.title}</h4>
                                    <p className="text-[11px] text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                                      {os.description}
                                    </p>
                                  </div>

                                  {/* CRAAI / COMARCA Metadata */}
                                  <div className="grid grid-cols-2 gap-2 bg-slate-55 bg-indigo-50/15 p-2 rounded-lg border border-indigo-100/50 text-[10px]">
                                    <div>
                                      <span className="text-slate-450 font-black uppercase text-[8px] tracking-wider block">CRAAI</span>
                                      <span className="text-slate-800 font-bold uppercase tracking-wide text-[9.5px]" title={getOrderCRAAI(os)}>
                                        {getOrderCRAAI(os)}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-slate-450 font-black uppercase text-[8px] tracking-wider block">Comarca</span>
                                      <span className="text-slate-800 font-bold uppercase tracking-wide text-[9.5px] truncate block" title={getOrderComarca(os)}>
                                        {getOrderComarca(os)}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Allowed Imposed Date Period details */}
                                  <div className="grid grid-cols-2 gap-2 text-[10px] bg-slate-50 p-2.5 rounded-lg border border-slate-150 uppercase tracking-widest text-[9.5px] font-black text-slate-500">
                                    <div>
                                      <span className="text-slate-400 font-extrabold m-0">Início permitido:</span>
                                      <p className="text-slate-800 font-black mt-0.5">{os.startDate ? formatDateBR(os.startDate) : 'S/I'}</p>
                                    </div>
                                    <div>
                                      <span className="text-slate-400 font-extrabold m-0">Vencimento imposto:</span>
                                      <p className="text-slate-800 font-black mt-0.5">{os.endDate ? formatDateBR(os.endDate) : 'S/I'}</p>
                                    </div>
                                  </div>

                                  {/* Date compatibility validation indicator */}
                                  <div className="flex items-center gap-1.5">
                                    {isCompatible ? (
                                      <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-800 text-[10px] font-extrabold px-2.5 py-1 rounded-md border border-emerald-200 uppercase tracking-wide">
                                        <Check className="w-3 h-3 text-emerald-600 font-bold" />
                                        Data selecionada está dentro do prazo
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 bg-rose-50 text-rose-800 text-[10px] font-extrabold px-2.5 py-1 rounded-md border border-rose-200 uppercase tracking-wide">
                                        <AlertTriangle className="w-3 h-3 text-rose-600" />
                                        Incompatível: fora da data limite imposta
                                      </span>
                                    )}
                                  </div>

                                  {/* Interactive Technician Assigning and CTA Scheduling */}
                                  <div className="border-t border-dashed border-slate-200 pt-3.5 space-y-3">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-indigo-50/20 p-2.5 rounded-xl border border-indigo-100/50">
                                      <div className="flex items-center gap-2">
                                        <User className="w-4 h-4 text-[#3525cd]" />
                                        <span className="text-[10px] font-black text-slate-700 uppercase tracking-wide">Atribuir Técnico:</span>
                                      </div>
                                      
                                      <select
                                        value={assignedTechName}
                                        onChange={(e) => {
                                          setPlanAssignedTechs(prev => ({ ...prev, [os.id]: e.target.value }));
                                        }}
                                        className="text-xs py-1 px-2.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-bold text-slate-800 min-w-[200px]"
                                      >
                                        <option value="">Nenhum Responsável</option>
                                        {getAvailableProfessionalsForOS(os).map((t) => (
                                          <option key={t.id} value={t.name}>
                                            {t.name} ({t.cargo || 'Profissional'})
                                          </option>
                                        ))}
                                      </select>
                                    </div>

                                    <button
                                      type="button"
                                      disabled={!isCompatible}
                                      onClick={async () => {
                                        if (!isCompatible) return;

                                        // VALIDATE ALL RULES: Limit OS, overload, regional conflicts
                                        const proceed = checkTechAssignment(assignedTechName, selectedDateStr, os);
                                        if (!proceed) return;

                                        // Update order status, technician, and schedule date
                                        const updatedOS = { 
                                          ...os, 
                                          status: 'Planejada' as const, // Shift to Planejada status
                                          scheduledDate: selectedDateStr,
                                          assignedTechnician: assignedTechName,
                                          updatedAt: new Date().toISOString()
                                        };

                                        try {
                                          await dbSaveServiceOrder(updatedOS);
                                          onReload();
                                        } catch (error) {
                                          alert(`Erro ao salvar Ordem de Serviço: ${error}`);
                                        }
                                      }}
                                      className={`w-full py-2.5 px-4 text-xs font-black uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-2xs ${
                                        isCompatible 
                                          ? 'bg-[#3525cd] hover:bg-[#2010aa] text-white' 
                                          : 'bg-slate-100 border border-slate-200 text-slate-400 cursor-not-allowed'
                                      }`}
                                    >
                                      <Calendar className="w-4 h-4" />
                                      Confirmar e Programar para o Dia {selectedCalendarDay}
                                    </button>
                                  </div>

                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Render TAB: Already programadas / Scheduled for this Day */}
                    {planActiveTab === 'agendadas' && (
                      <div className="space-y-4">
                        <div className="bg-emerald-50 text-emerald-850 p-3 rounded-xl border border-emerald-150 text-[10px] font-bold uppercase tracking-wide leading-relaxed">
                          Abaixo estão listadas as preventivas agendadas para o dia {selectedCalendarDay}/{currentCalendarDate.getMonth() + 1}. Caso necessário, você pode alterar o técnico responsável diretamente.
                        </div>

                        {dayScheduledOrders.length === 0 ? (
                          <div className="text-center py-12 text-slate-400 text-xs italic bg-white border border-dashed border-slate-200 rounded-xl font-medium">
                            Nenhuma preventiva agendada para este dia específico ainda. Acesse a aba de Novas para organizar a programação.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {dayScheduledOrders.map((os) => {
                              const isCompleted = os.status === 'Concluída';
                              return (
                                <div key={os.id} className="border border-slate-200 rounded-xl p-4 bg-white shadow-2xs space-y-3">
                                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono text-xs font-black text-[#3525cd]">#{os.id}</span>
                                      <span className="bg-slate-100 text-slate-705 text-[8.5px] font-black uppercase px-2 py-0.5 rounded">
                                        {os.sector}
                                      </span>
                                    </div>
                                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide ${
                                      isCompleted 
                                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                                        : 'bg-[#3525cd]/5 text-[#3525cd] border border-[#3525cd]/15'
                                    }`}>
                                      {os.status}
                                    </span>
                                  </div>

                                  <div>
                                    <h4 className="text-xs font-black text-slate-800">{os.title}</h4>
                                    <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{os.description}</p>
                                  </div>

                                  {/* CRAAI / COMARCA Metadata */}
                                  <div className="grid grid-cols-2 gap-2 bg-slate-55 bg-indigo-50/15 p-2 rounded-lg border border-indigo-100/50 text-[10px]">
                                    <div>
                                      <span className="text-slate-450 font-black uppercase text-[8px] tracking-wider block">CRAAI</span>
                                      <span className="text-slate-800 font-bold uppercase tracking-wide text-[9.5px]" title={getOrderCRAAI(os)}>
                                        {getOrderCRAAI(os)}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-slate-450 font-black uppercase text-[8px] tracking-wider block">Comarca</span>
                                      <span className="text-slate-800 font-bold uppercase tracking-wide text-[9.5px] truncate block" title={getOrderComarca(os)}>
                                        {getOrderComarca(os)}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Scheduled Date limits information */}
                                  <div className="text-[9.5px] font-black text-slate-500 uppercase tracking-wider flex items-center justify-between bg-slate-50 p-2 rounded">
                                    <span>
                                      Data Alocada: <span className="text-[#3525cd]">{formatDateBR(os.scheduledDate)}</span>
                                    </span>
                                    {os.startDate && os.endDate && (
                                      <span>
                                        Janela: {formatDateBR(os.startDate)} a {formatDateBR(os.endDate)}
                                      </span>
                                    )}
                                  </div>

                                  {/* Technician Reassignment */}
                                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 p-2.5 rounded-lg border border-slate-200/60 mt-2">
                                    <div className="flex items-center gap-2">
                                      <User className="w-3.5 h-3.5 text-[#3525cd]" />
                                      <span className="text-[10px] font-black text-slate-650 uppercase tracking-wider">Técnico Designado:</span>
                                    </div>
                                    
                                    <select
                                      value={os.assignedTechnician || ''}
                                      onChange={async (e) => {
                                        const newTech = e.target.value;
                                        if (newTech) {
                                          const proceed = checkTechAssignment(newTech, os.scheduledDate || '', os);
                                          if (!proceed) return;
                                        }
                                        const updatedOS = { ...os, assignedTechnician: newTech, updatedAt: new Date().toISOString() };
                                        await dbSaveServiceOrder(updatedOS);
                                        onReload();
                                      }}
                                      className="text-xs py-1 px-2.5 bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 font-bold text-slate-800 min-w-[200px] cursor-pointer"
                                    >
                                      <option value="">Sem Técnico Responsável</option>
                                      {getAvailableProfessionalsForOS(os).map((t) => (
                                        <option key={t.id} value={t.name}>
                                          {t.name} ({t.cargo || 'Profissional'})
                                        </option>
                                      ))}
                                    </select>
                                  </div>

                                  {/* Remake Scheduling Option (Returns OS to status === 'Novo' so it can be scheduled elsewhere) */}
                                  <div>
                                    {deplanConfirmOrderId === os.id ? (
                                      <div className="flex flex-col gap-2 p-2 bg-rose-50 rounded-lg border border-rose-100 animate-fadeIn">
                                        <p className="text-[10px] font-bold text-rose-700 uppercase tracking-wide text-center">
                                          Tem certeza que deseja remover da agenda?
                                        </p>
                                        <div className="flex items-center gap-2">
                                          <button
                                            type="button"
                                            onClick={async () => {
                                              const updatedOS = {
                                                ...os,
                                                status: 'Novo' as const,
                                                scheduledDate: '',
                                                assignedTechnician: '',
                                                updatedAt: new Date().toISOString()
                                              };
                                              await dbSaveServiceOrder(updatedOS);
                                              setDeplanConfirmOrderId(null);
                                              onReload();
                                            }}
                                            className="flex-1 py-1.5 text-center bg-rose-600 hover:bg-rose-700 text-white rounded-md text-[9px] font-black uppercase tracking-widest cursor-pointer transition-colors shadow-2xs"
                                          >
                                            Sim, Reverter
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setDeplanConfirmOrderId(null)}
                                            className="flex-1 py-1.5 text-center bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-md text-[9px] font-black uppercase tracking-widest cursor-pointer transition-colors"
                                          >
                                            Cancelar
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => setDeplanConfirmOrderId(os.id)}
                                        className="w-full py-1.5 text-center border border-dashed border-rose-225 hover:bg-[#fff5f5] text-rose-600 rounded-lg text-[9px] font-black uppercase transition-colors tracking-widest cursor-pointer flex items-center justify-center gap-1"
                                      >
                                        <X className="w-3 h-3 text-rose-500" />
                                        Remover da Agenda (Reverter para Novo)
                                      </button>
                                    )}
                                  </div>

                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      ); })() : (
        <>
          {/* SECTION: Smart Search & Filtros Inteligentes */}
          <section className="bg-white rounded-xl p-5 shadow-sm border border-gray-200">
        <div className="flex items-center gap-2 mb-4">
          <SlidersHorizontal className="w-4 h-4 text-indigo-600" />
          <h2 className="text-xs font-black text-slate-800 uppercase tracking-wider">
            Painel de Filtros & Busca Inteligente
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Smart Search */}
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
              Busca Inteligente (ID, Título, Técnico)
            </label>
            <div className="flex gap-2">
              <div className="relative flex-grow">
                <input
                  type="text"
                  value={smartSearch}
                  onChange={(e) => setSmartSearch(e.target.value)}
                  placeholder="Pesquisar ID, Técnico, Titulo..."
                  className="w-full text-xs py-2 pl-8 pr-8 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium text-slate-800"
                />
                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-3" />
                {smartSearch && (
                  <button
                    onClick={() => setSmartSearch('')}
                    className="absolute right-2 top-2.5 p-0.5 text-gray-400 hover:text-rose-600 rounded"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowPreventiveScanSimulator(true)}
                className="px-3 bg-indigo-50 border border-indigo-200 text-[#3525cd] hover:bg-indigo-100 rounded-lg text-xs font-black flex items-center gap-1 hover:shadow-2xs cursor-pointer shrink-0 transition-colors"
                title="Escanear QR Ativo para Localizar Preventiva"
              >
                <QrCode className="w-4 h-4" />
                <span className="hidden sm:inline">Escanear Ativo</span>
              </button>
            </div>
          </div>

          {/* Comarca selector */}
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
              Comarca
            </label>
            <select
              value={selectedComarca}
              onChange={(e) => setSelectedComarca(e.target.value)}
              className="w-full text-xs py-2 px-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold text-slate-800"
            >
              <option value="Todas">Todas as Comarcas</option>
              {comarcasList.map((comarca) => (
                <option key={comarca} value={comarca}>
                  {comarca}
                </option>
              ))}
            </select>
          </div>

          {/* Patrimônio selector */}
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
              Patrimônio (Ativo)
            </label>
            <select
              value={selectedPatrimonio}
              onChange={(e) => setSelectedPatrimonio(e.target.value)}
              className="w-full text-xs py-2 px-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold text-slate-800"
            >
              <option value="Todos">Todos os Patrimônios</option>
              {patrimoniosList.map((pat) => (
                <option key={pat} value={pat}>
                  {pat}
                </option>
              ))}
            </select>
          </div>

          {/* Filter by Execution Date */}
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 flex items-center justify-between">
              <span>Dia Programado</span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const todayStr = (() => {
                      const d = new Date();
                      const year = d.getFullYear();
                      const month = String(d.getMonth() + 1).padStart(2, '0');
                      const day = String(d.getDate()).padStart(2, '0');
                      return `${year}-${month}-${day}`;
                    })();
                    setSelectedExecutionDate(todayStr);
                  }}
                  className={`text-[8.5px] px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
                    selectedExecutionDate === (() => {
                      const d = new Date();
                      const year = d.getFullYear();
                      const month = String(d.getMonth() + 1).padStart(2, '0');
                      const day = String(d.getDate()).padStart(2, '0');
                      return `${year}-${month}-${day}`;
                    })()
                      ? 'bg-indigo-650 text-white font-extrabold'
                      : 'bg-gray-150 text-slate-600 hover:bg-gray-200'
                  }`}
                >
                  Hoje
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedExecutionDate('')}
                  className={`text-[8.5px] px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
                    !selectedExecutionDate
                      ? 'bg-indigo-610 text-white font-extrabold'
                      : 'bg-gray-150 text-slate-600 hover:bg-gray-200'
                  }`}
                >
                  Ver Todos
                </button>
              </div>
            </label>
            <div className="relative">
              <input
                type="date"
                value={selectedExecutionDate}
                onChange={(e) => setSelectedExecutionDate(e.target.value)}
                className="w-full text-xs py-1.5 px-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold text-slate-800"
              />
              {selectedExecutionDate && (
                <button
                  onClick={() => setSelectedExecutionDate('')}
                  className="absolute right-7 top-2 text-gray-400 hover:text-rose-600 cursor-pointer"
                  title="Listar sem data"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Status filtering row & quick clear */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 mt-4 border-t border-gray-100">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Status da OS:</span>
            <div className="flex flex-wrap gap-1.5">
              {['Todos', 'Planejada', 'Em Execução', 'Concluída', 'Não Executada'].map((sts) => {
                const isActive = selectedStatus === sts;
                return (
                  <button
                    key={sts}
                    onClick={() => setSelectedStatus(sts)}
                    className={`px-3 py-1 text-[10px] font-extrabold rounded-lg border transition-all duration-150 cursor-pointer ${
                      isActive
                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm font-black'
                        : 'bg-white border-gray-200 text-slate-600 hover:bg-gray-55'
                    }`}
                  >
                    {sts}
                  </button>
                );
              })}
            </div>
          </div>

          {(smartSearch || selectedComarca !== 'Todas' || selectedPatrimonio !== 'Todos' || selectedStatus !== 'Todos' || selectedExecutionDate !== '') && (
            <button
              onClick={() => {
                setSmartSearch('');
                setSelectedComarca('Todas');
                setSelectedPatrimonio('Todos');
                setSelectedStatus('Todos');
                setSelectedExecutionDate('');
              }}
              className="text-[10px] font-black text-rose-600 hover:text-rose-800 uppercase tracking-wider flex items-center gap-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              Limpar Filtros Ativos
            </button>
          )}
        </div>
      </section>

      {/* SECTION: OS List Cards */}
      <section className="bg-transparent flex flex-col gap-4">
        {paginatedOrders.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="select-all-page"
                checked={isAllSelected}
                onChange={toggleSelectAll}
                className="w-4.5 h-4.5 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 cursor-pointer"
              />
              <label htmlFor="select-all-page" className="text-xs font-black text-slate-705 cursor-pointer select-none">
                Selecionar Todas desta Página ({paginatedOrders.length} {paginatedOrders.length === 1 ? 'preventiva' : 'preventivas'})
              </label>
              {selectedOrderIds.length > 0 && (
                <span className="bg-indigo-50 text-indigo-750 text-[10px] font-black px-2.5 py-0.5 rounded-full border border-indigo-150">
                  {selectedOrderIds.length} selecionada{selectedOrderIds.length > 1 ? 's' : ''}
                </span>
              )}
            </div>

            {selectedOrderIds.length > 0 && (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedOrderIds([])}
                  className="text-[10px] font-black text-slate-500 hover:text-slate-800 uppercase tracking-widest px-2.5 py-1.5 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Limpar Seleção
                </button>
                {userProfile?.perfil !== 'Profissional' && (
                  <button
                    type="button"
                    onClick={() => setShowBulkDeleteModal(true)}
                    className="bg-rose-50 border border-rose-250 text-rose-600 hover:bg-rose-100 hover:text-rose-700 px-3.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 cursor-pointer shadow-3xs transition-all active:scale-[0.98]"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Excluir Selecionadas ({selectedOrderIds.length})
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {paginatedOrders.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 text-center py-16 text-gray-400 font-bold italic">
            Nenhuma ordem de serviço preventiva localizada para os filtros definidos.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {paginatedOrders.map((os) => {
              const isCompleted = os.status === 'Concluída';
              const isDelayed = os.status === 'Atrasada';
              const isInProgress = os.status === 'Em Execução';
              const isNotExecuted = os.status === 'Não Executada';
              const notExecuted = !isCompleted;
              const isSelected = selectedOrderIds.includes(os.id);

              return (
                <div 
                  key={os.id} 
                  onClick={() => handleViewPreventive(os)}
                  className={`group bg-white rounded-xl border p-4 shadow-xs relative flex flex-col justify-between cursor-pointer transition-all duration-200 hover:shadow-md hover:scale-[1.01] overflow-hidden ${
                    isSelected
                      ? 'border-indigo-400 ring-2 ring-indigo-500/20 bg-indigo-50/10 border-l-[6px] border-l-indigo-600'
                      : notExecuted 
                      ? 'border-l-[6px] border-l-rose-500 border-gray-200 bg-rose-50/5 hover:border-l-rose-600 hover:border-indigo-300' 
                      : 'border-l-[6px] border-l-emerald-500 border-gray-200 hover:border-indigo-300'
                  }`}
                >
                  {/* PULSING RED FLAG CONVERSIONS FOR NOT EXECUTED ONES */}
                  {notExecuted && (
                    <div className="absolute top-0 right-0 z-10">
                      <div className="bg-rose-600 text-white text-[9px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-bl-lg flex items-center gap-1 shadow-sm animate-pulse">
                        <Flag className="w-2.5 h-2.5 fill-white text-white" />
                        <span>Pendente</span>
                      </div>
                    </div>
                  )}

                  {isCompleted && (
                    <div className="absolute top-0 right-0 z-10">
                      <div className="bg-emerald-600 text-white text-[9px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-bl-lg flex items-center gap-1 shadow-xs">
                        <CheckCircle2 className="w-2.5 h-2.5 text-white" />
                        <span>Concluído</span>
                      </div>
                    </div>
                  )}

                  <div>
                    {/* Top Row: ID & Category */}
                    <div className="flex items-center gap-2 mb-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleSelectOrder(os.id);
                        }}
                        className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 cursor-pointer"
                      />
                      <span className="font-mono text-[#3525cd] font-black text-xs">
                        #{os.id}
                      </span>
                      <span className="text-[8.5px] font-black uppercase tracking-wider text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                        Preventiva
                      </span>
                    </div>

                    {/* Service Description Title - standardized height limits content overlap */}
                    <h3 className="font-extrabold text-slate-800 group-hover:text-[#3525cd] transition-colors text-[12px] leading-snug break-words pr-16 line-clamp-2 mb-2 min-h-[32px] flex items-center">
                      {os.title}
                    </h3>

                    {/* Periodicity / date parameters */}
                    <div className="mb-3 space-y-1.5">
                      {os.startDate && os.endDate && (
                        <div className="flex items-center gap-1 text-[9px] font-black text-slate-500 bg-slate-50/80 border border-slate-200 px-2 py-1 rounded-lg w-full whitespace-normal leading-tight">
                          <Calendar className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>Janela: {formatDateBR(os.startDate)} até {formatDateBR(os.endDate)}</span>
                        </div>
                      )}
                      
                      {os.scheduledDate ? (
                        <div className="flex items-center gap-1.5 text-[10px] font-black text-indigo-850 bg-indigo-50 border border-indigo-200 px-2.5 py-1.5 rounded-lg w-full whitespace-normal leading-tight shadow-3xs">
                          <Clock className="w-3.5 h-3.5 text-[#3525cd] shrink-0 animate-pulse" />
                          <span>DIA DE EXECUÇÃO DETERMINADO: <strong className="text-[#3525cd] text-[10.5px]">{formatDateBR(os.scheduledDate)}</strong></span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-[9px] font-black text-slate-605 bg-slate-50 border border-slate-150 px-2 py-1 rounded-lg w-full whitespace-normal leading-tight">
                          <Clock className="w-3 h-3 text-slate-500 shrink-0" />
                          <span>Não agendado</span>
                        </div>
                      )}
                    </div>

                    {/* Equipment/Asset Info Box (Patrimônio & Técnico Responsável) */}
                    <div className="bg-slate-50 border border-slate-100 rounded-lg p-2.5 mb-3 space-y-2">
                      <div className="flex items-center gap-1.5">
                        <Wrench className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                        <div className="min-w-0 flex-1 flex items-center justify-between">
                          <span className="text-[7.5px] font-black text-slate-400 uppercase tracking-widest leading-none">Patrimônio</span>
                          <span className="text-[9px] text-[#3525cd] font-black bg-indigo-50 border border-indigo-100 font-mono px-1.5 py-0.5 rounded inline-block">
                            {os.assetCode}
                          </span>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-slate-200/50 flex items-start gap-1.5">
                        <User className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[7.5px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Técnico Responsável</p>
                          <p className="font-extrabold text-slate-700 text-[10.5px] leading-snug break-words whitespace-normal">
                            {os.assignedTechnician || 'Não designado'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Location Specs Row with strict dimension boundaries */}
                    <div className="grid grid-cols-2 gap-2 mb-3.5 text-[9px] font-extrabold text-slate-700">
                      <div className="bg-white p-2 rounded-lg border border-slate-150 flex flex-col min-w-0 shadow-3xs">
                        <span className="text-[7.5px] text-slate-450 font-bold uppercase tracking-wider mb-0.5">CRAAI</span>
                        <span className="text-slate-800 truncate uppercase mt-0.5 text-[9px]" title={getOrderCRAAI(os)}>
                          {getOrderCRAAI(os)}
                        </span>
                      </div>
                      <div className="bg-white p-2 rounded-lg border border-slate-150 flex flex-col min-w-0 shadow-3xs">
                        <span className="text-[7.5px] text-slate-450 font-bold uppercase tracking-wider mb-0.5">Comarca</span>
                        <span className="text-slate-800 truncate uppercase mt-0.5 text-[9px]" title={getOrderComarca(os)}>
                          {getOrderComarca(os)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions & Status Row */}
                  <div className="flex items-center justify-between pt-3 border-t border-gray-150/70" onClick={(e) => e.stopPropagation()}>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[8.5px] font-black uppercase tracking-wider whitespace-nowrap border ${
                      isCompleted 
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                        : isDelayed 
                        ? 'bg-rose-50 text-rose-700 border-rose-200 animate-pulse'
                        : isNotExecuted
                        ? 'bg-slate-100 text-slate-500 border-slate-300 line-through'
                        : isInProgress
                        ? 'bg-amber-50 text-amber-700 border-amber-200 animate-pulse'
                        : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                    }`}>
                      <span className={`w-1 h-1 rounded-full ${
                        isCompleted ? 'bg-emerald-500' : isDelayed ? 'bg-rose-500' : isNotExecuted ? 'bg-slate-400' : isInProgress ? 'bg-amber-500' : 'bg-indigo-500'
                      }`} />
                      {os.status}
                    </span>

                    <div className="flex justify-end items-center gap-1.5">
                      {userProfile?.perfil !== 'Profissional' && (
                        <button 
                          onClick={() => handleDeletePreventive(os.id)}
                          className="inline-flex items-center justify-center p-1.5 rounded-md border border-rose-100 bg-rose-50 hover:bg-rose-150 hover:border-rose-300 text-rose-600 transition-all duration-155 active:scale-95 cursor-pointer shadow-3xs"
                          title="Excluir Preventiva"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Dynamic Pagination Footer */}
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-3.5 flex flex-col sm:flex-row justify-between items-center text-xs font-bold text-gray-500 gap-3 mt-4 shadow-sm shrink-0">
          <div>
            Exibindo {totalItems > 0 ? startIndex + 1 : 0} até {endIndex} de {totalItems} preventivas localizadas (total de {orders.length})
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={sanitizedPage === 1}
              className={`p-1.5 rounded-lg border border-gray-200 bg-white shadow-xs transition-colors cursor-pointer flex items-center justify-center ${
                sanitizedPage === 1 ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-50 text-slate-850'
              }`}
              title="Página Anterior"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-slate-600 font-extrabold px-1.5">
              Página {sanitizedPage} de {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={sanitizedPage === totalPages}
              className={`p-1.5 rounded-lg border border-gray-200 bg-white shadow-xs transition-colors cursor-pointer flex items-center justify-center ${
                sanitizedPage === totalPages ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-50 text-slate-850'
              }`}
              title="Próxima Página"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>

      {/* SLIDING SIDEBAR DETAIL DRAWER (copied exactly from detail panel in mockup) */}
      {showDrawer && selectedOrder && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 font-sans">
          {/* Overlay dismissal */}
          <div className="absolute inset-0" onClick={() => setShowDrawer(false)}></div>

          {/* Centered Modal Frame */}
          <div className="relative w-full max-w-2xl bg-white max-h-[90vh] rounded-2xl shadow-2xl flex flex-col z-10 border border-gray-200 transform transition-all animate-in fade-in zoom-in-95 duration-150 overflow-hidden">
            
            {/* Header branding */}
            <div className="p-5 bg-[#0b1c30] text-white flex justify-between items-center shrink-0">
              <div>
                <h3 className="font-extrabold text-base flex items-center gap-1.5">
                  <ClipboardList className="w-4 h-4 text-indigo-400" />
                  Detalhes da Ordem de Serviço
                </h3>
                <p className="text-[10px] text-gray-400 font-mono">
                  #{selectedOrder.id} • {selectedOrder.status}
                </p>
              </div>
              
              <button 
                onClick={() => setShowDrawer(false)}
                className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/10 text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable execution items */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              
              {/* 1. DADOS COMPLETOS DO ATIVO VINCULADO */}
              <div>
                <p className="text-[9.5px] font-black text-slate-400 uppercase tracking-widest mb-2.5">
                  Ficha Técnica do Ativo Vinculado
                </p>
                {activeLinkedAsset ? (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3 shadow-2xs">
                    <div className="flex items-start justify-between border-b border-slate-200 pb-2.5">
                      <div className="space-y-0.5">
                        <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#3525cd]/15 text-[#3525cd] border border-[#3525cd]/20">
                          Ativo Vinculado
                        </span>
                        <h4 className="text-[13px] font-extrabold text-slate-900 flex items-center gap-1.5 pt-1">
                          <Wrench className="w-3.5 h-3.5 text-[#3525cd]" />
                          {activeLinkedAsset.name}
                        </h4>
                        <p className="text-[10px] text-slate-500 font-semibold">
                          Código QR: <span className="font-mono font-bold text-[#3525cd]">{activeLinkedAsset.code}</span>
                        </p>
                      </div>

                      <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase px-2.5 py-1 rounded-full border ${
                        activeLinkedAsset.status === 'Operando' 
                          ? 'bg-emerald-50 border-emerald-250 text-emerald-800' 
                          : activeLinkedAsset.status === 'Em Manutenção' 
                            ? 'bg-amber-50 border-amber-250 text-amber-800' 
                            : 'bg-rose-50 border-rose-250 text-rose-850'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          activeLinkedAsset.status === 'Operando' 
                            ? 'bg-emerald-500' 
                            : activeLinkedAsset.status === 'Em Manutenção' 
                              ? 'bg-amber-550' 
                              : 'bg-rose-500'
                        }`} />
                        {activeLinkedAsset.status}
                      </span>
                    </div>

                    {/* Specs Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11.5px] text-slate-700">
                      {/* CRAAI */}
                      <div className="bg-white p-3 rounded-lg border border-slate-150 shadow-3xs flex flex-col min-w-0">
                        <p className="text-[8.5px] text-slate-450 font-bold uppercase tracking-wider mb-0.5">CRAAI</p>
                        <p className="font-extrabold text-slate-800 break-words whitespace-normal leading-normal">
                          {activeLinkedAsset.specs?.CRAAI || activeLinkedAsset.specs?.craai || activeLinkedAsset.sector || 'Não informado'}
                        </p>
                      </div>

                      {/* Comarca */}
                      <div className="bg-white p-3 rounded-lg border border-slate-150 shadow-3xs flex flex-col min-w-0">
                        <p className="text-[8.5px] text-slate-450 font-bold uppercase tracking-wider mb-0.5">Comarca</p>
                        <p className="font-extrabold text-slate-800 break-words whitespace-normal leading-normal">
                          {activeLinkedAsset.specs?.COMARCA || activeLinkedAsset.specs?.comarca || activeLinkedAsset.location || 'Não informado'}
                        </p>
                      </div>

                      {/* Modelo */}
                      <div className="bg-white p-3 rounded-lg border border-slate-150 shadow-3xs flex flex-col min-w-0">
                        <p className="text-[8.5px] text-slate-450 font-bold uppercase tracking-wider mb-0.5">Modelo</p>
                        <p className="font-extrabold text-slate-800 break-words whitespace-normal leading-normal">
                          {activeLinkedAsset.specs?.MODELO || activeLinkedAsset.specs?.model || activeLinkedAsset.specs?.['Modelo / Tipo'] || activeLinkedAsset.specs?.['Modelo'] || 'Não informado'}
                        </p>
                      </div>

                      {/* Nº de Série */}
                      <div className="bg-white p-3 rounded-lg border border-slate-150 shadow-3xs flex flex-col min-w-0">
                        <p className="text-[8.5px] text-slate-450 font-bold uppercase tracking-wider mb-0.5">Nº de Série</p>
                        <p className="font-extrabold text-slate-800 break-words whitespace-normal leading-normal font-mono">
                          {activeLinkedAsset.specs?.['Nº DE SÉRIE'] || activeLinkedAsset.specs?.['Nº de Série'] || activeLinkedAsset.specs?.['NUMERO DE SÉRIE'] || activeLinkedAsset.specs?.['Número de Série'] || activeLinkedAsset.specs?.serialNumber || activeLinkedAsset.specs?.serial || 'Não informado'}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-slate-50 border border-slate-150 rounded-xl p-3.5 shadow-2xs">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-slate-500 shrink-0" />
                      <div>
                        <p className="text-xs font-bold text-slate-705">Ativo de snapshot</p>
                        <p className="text-[10px] text-slate-500">
                          Código: <span className="font-bold text-indigo-700">{selectedOrder.assetCode}</span> ({selectedOrder.assetName})
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Período de Execução (Corte de SLA) */}
              <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-xs leading-snug">
                <span className="block text-[10px] font-black text-slate-450 uppercase tracking-widest mb-1.5">
                  Janela de Execução / SLA de Corte
                </span>
                {selectedOrder.startDate && selectedOrder.endDate ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-white p-1.5 rounded border border-gray-100 text-[11px]">
                      <p className="text-[8px] text-slate-400 font-extrabold uppercase">Abertura da Janela</p>
                      <p className="font-extrabold text-[#0b1c30]">{formatDateBR(selectedOrder.startDate)}</p>
                    </div>
                    <div className="bg-white p-1.5 rounded border border-gray-100 text-[11px]">
                      <p className="text-[8px] text-slate-500 font-extrabold uppercase">Tolerância Máxima</p>
                      <p className="font-extrabold text-red-600">{formatDateBR(selectedOrder.endDate)}</p>
                    </div>
                  </div>
                ) : (
                  <div>
                    <span className="font-bold text-slate-600">Previsão Agendada: </span>
                    <span className="font-extrabold text-slate-800">{formatDateBR(selectedOrder.scheduledDate)}</span>
                  </div>
                )}
                {selectedOrder.status === 'Não Executada' && (
                  <div className="mt-2.5 p-2 bg-rose-50 border border-rose-200 text-rose-800 rounded font-bold text-[10.5px] flex items-start gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <span>Esta preventiva expirou sem receber a assinatura de conclusão e foi bloqueada pelo corte.</span>
                  </div>
                )}
              </div>

              {/* STICKY TOP STATUS DE EXECUÇÃO */}
              <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-md pb-4 pt-4 border-b border-gray-150 -mx-5 px-5 shadow-xs space-y-2.5">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest leading-none">
                  Progresso da Execução de OS
                </p>
                
                {/* Visual dynamic state indicators */}
                <div className="flex items-center gap-1.5">
                  <div className={`flex-1 h-2 rounded-full ${getProgressPercentage(selectedOrder) >= 25 ? 'bg-[#3525cd]' : 'bg-gray-100'}`}></div>
                  <div className={`flex-1 h-2 rounded-full ${getProgressPercentage(selectedOrder) >= 50 ? 'bg-[#3525cd]' : 'bg-gray-100'}`}></div>
                  <div className={`flex-1 h-2 rounded-full ${getProgressPercentage(selectedOrder) >= 75 ? 'bg-[#3525cd]' : 'bg-gray-100'}`}></div>
                  <div className={`flex-1 h-2 rounded-full ${getProgressPercentage(selectedOrder) >= 100 ? 'bg-[#3525cd]' : 'bg-gray-100'}`}></div>
                </div>

                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-850">
                    Fase Atual: Checklist Técnico
                  </span>
                  <span className="font-black text-indigo-700 bg-indigo-50 border border-indigo-150 px-2 py-0.5 rounded-md">
                    Concluído: {getProgressPercentage(selectedOrder)}%
                  </span>
                </div>
              </div>

              {/* Dynamic technical item checklist checklist */}
              <div className="space-y-3">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                  Checklist de Verificação Técnica
                </p>

                {selectedOrder.status === 'Concluída' || selectedOrder.status === 'Não Executada' ? (
                  /* Completed locked list with custom responseTypes */
                  <div className="space-y-2.5">
                    {selectedOrder.checklist.map((item) => {
                      const type = item.responseType || 'three_states';
                      
                      if (item.autoCreateCorrective) {
                        const answer = item.autoCorrectiveAnswer || 'Não';
                        const isSim = answer === 'Sim';
                        const bgClass = isSim ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-slate-50 border-slate-200 text-slate-850';
                        const labelText = isSim ? 'Solicitado Sim' : 'Não Solicitado';
                        const dotColor = isSim ? 'bg-rose-500 animate-pulse' : 'bg-slate-400';
                        
                        return (
                          <div key={item.id} className={`p-3.5 rounded-xl border flex flex-col gap-2 text-xs ${bgClass}`}>
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="material-symbols-outlined text-rose-500 font-extrabold text-base shrink-0">notification_important</span>
                                <p className="font-extrabold text-slate-900 truncate" title={item.task}>{item.task}</p>
                              </div>
                              <span className="shrink-0 inline-flex items-center gap-1 text-[9px] font-black uppercase px-2 py-0.5 rounded-md border border-current">
                                <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                                {labelText}
                              </span>
                            </div>
                            {item.observations && (
                              <p className="text-[10px] opacity-90 italic font-medium bg-white/70 p-1.5 rounded border border-current/10 mt-1">
                                Obs: {item.observations}
                              </p>
                            )}
                          </div>
                        );
                      }
                      
                      if (type === 'three_states') {
                        const itemStatusCheck = item.statusCheck || (item.checked ? 'Atestado' : 'Não Atestado');
                        let bgClass = 'bg-emerald-50/60 border-emerald-150 text-emerald-800';
                        let labelText = 'Atestado';
                        let dotColor = 'bg-emerald-500';
                        
                        if (itemStatusCheck === 'Não Atestado') {
                          bgClass = 'bg-rose-50/60 border-rose-150 text-rose-800';
                          labelText = 'Não atestado';
                          dotColor = 'bg-rose-500';
                        } else if (itemStatusCheck === 'Não se Aplica') {
                          bgClass = 'bg-slate-50 border-slate-150 text-slate-800';
                          labelText = 'Não se aplica';
                          dotColor = 'bg-slate-500';
                        }

                        return (
                          <div key={item.id} className={`p-3 rounded-lg border flex flex-col gap-1.5 text-xs ${bgClass}`}>
                            <div className="flex items-start justify-between gap-4">
                              <p className="font-bold">{item.task}</p>
                              <span className="shrink-0 inline-flex items-center gap-1 text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded-md border border-current">
                                <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                                {labelText}
                              </span>
                            </div>
                            {item.observations && (
                              <p className="text-[10px] opacity-80 italic font-medium">
                                Obs: {item.observations}
                              </p>
                            )}
                          </div>
                        );
                      } else if (type === 'text') {
                        return (
                          <div key={item.id} className="p-3 rounded-lg border border-blue-150 bg-blue-50/40 text-blue-900 flex flex-col gap-1.5 text-xs">
                            <div className="flex items-start justify-between gap-4">
                              <p className="font-bold">{item.task}</p>
                              <span className="shrink-0 text-[9px] font-black uppercase px-2 py-0.5 rounded-md bg-blue-100 text-blue-800 border border-blue-200">
                                Texto
                              </span>
                            </div>
                            <p className="font-sans text-[11px] bg-white/80 p-2 rounded border border-blue-100 mt-1 italic">
                              "{item.observations || '(Resposta em branco)'}"
                            </p>
                          </div>
                        );
                      } else if (type === 'number') {
                        return (
                          <div key={item.id} className="p-3 rounded-lg border border-sky-150 bg-sky-50/40 text-sky-900 flex flex-col gap-1.5 text-xs">
                            <div className="flex items-start justify-between gap-4">
                              <p className="font-bold">{item.task}</p>
                              <span className="shrink-0 text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-sky-100 text-sky-800 border border-sky-200">
                                Medição
                              </span>
                            </div>
                            <p className="font-mono text-xs font-bold bg-white/85 p-2 rounded border border-sky-100 mt-1">
                              Valor técnico: {item.observations || '(Não aferido)'}
                            </p>
                          </div>
                        );
                      } else if (type === 'boolean') {
                        const isTrue = item.observations === 'Sim';
                        const bgCol = isTrue ? 'bg-emerald-50 border-emerald-150 text-emerald-905' : 'bg-rose-50 border-rose-150 text-rose-905';
                        const badgeCol = isTrue ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-rose-100 text-rose-800 border-rose-200';
                        return (
                          <div key={item.id} className={`p-3 rounded-lg border flex flex-col gap-1.5 text-xs ${bgCol}`}>
                            <div className="flex items-start justify-between gap-4">
                              <p className="font-bold">{item.task}</p>
                              <span className={`shrink-0 text-[10px] font-black uppercase px-2.5 py-0.5 rounded-md border ${badgeCol}`}>
                                {item.observations || 'Não Respondido'}
                              </span>
                            </div>
                          </div>
                        );
                      } else {
                        // Date type
                        return (
                          <div key={item.id} className="p-3 rounded-lg border border-amber-150 bg-amber-50/40 text-amber-900 flex flex-col gap-1.5 text-xs">
                            <div className="flex items-start justify-between gap-4">
                              <p className="font-bold">{item.task}</p>
                              <span className="shrink-0 text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-200">
                                Data
                              </span>
                            </div>
                            <p className="font-semibold text-xs bg-white/80 p-2 rounded border border-amber-100 mt-1 font-mono">
                              Registrado em: {item.observations ? item.observations.split('-').reverse().join('/') : '(Não informada)'}
                            </p>
                          </div>
                        );
                      }
                    })}
                  </div>
                ) : (
                  /* Active checklist dynamic response picker block */
                  <div className="space-y-3">
                    {/* Bulk Actions Assistant Bar */}
                    <div className="flex items-center justify-between bg-[#eff4ff]/65 p-3 rounded-xl border border-blue-100 shadow-sm">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="material-symbols-outlined text-blue-600 font-extrabold text-sm shrink-0">offline_pin</span>
                        <div className="text-left">
                          <p className="text-[10.5px] font-black text-slate-800 leading-none">Atesto em Lote</p>
                          <p className="text-[9px] text-slate-500 font-medium">Preencher todo o checklist em conformidade</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!selectedOrder) return;
                          const updatedChecklist = selectedOrder.checklist.map((item) => {
                            const type = item.responseType || 'three_states';
                            if (type === 'three_states') {
                              return {
                                ...item,
                                checked: true,
                                checkedAt: new Date().toISOString(),
                                statusCheck: 'Atestado' as const,
                                observations: 'Procedimento verificado em conformidade técnico.'
                              };
                            } else if (type === 'boolean') {
                              return {
                                ...item,
                                checked: true,
                                checkedAt: new Date().toISOString(),
                                observations: 'Sim',
                                statusCheck: 'Atestado' as const
                              };
                            }
                            return item;
                          });
                          
                          const updatedOrder: ServiceOrder = {
                            ...selectedOrder,
                            checklist: updatedChecklist,
                            status: selectedOrder.status === 'Planejada' ? 'Em Execução' : selectedOrder.status
                          };
                          
                          setSelectedOrder(updatedOrder);
                          await dbSaveServiceOrder(updatedOrder);
                          onReload();
                        }}
                        className="px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-emerald-805 bg-emerald-50 hover:bg-emerald-100 border border-emerald-250 rounded-lg shadow-xs active:scale-95 transition-all cursor-pointer flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[13px] font-black">done_all</span>
                        Atestar Tudo
                      </button>
                    </div>

                    {selectedOrder.checklist.map((item) => {
                      const type = item.responseType || 'three_states';
                      const isFailed = failedItemIds.includes(item.id);
                      
                      if (item.autoCreateCorrective) {
                        const currentAnswer = item.autoCorrectiveAnswer;
                        return (
                          <div 
                            key={item.id} 
                            id={`checklist_item_${item.id}`}
                            className={`p-4 rounded-xl border transition-all duration-300 space-y-3 text-xs ${
                              isFailed 
                                ? 'border-rose-500 bg-rose-50/15 shadow-sm ring-2 ring-rose-200/50 animate-pulse' 
                                : 'border-slate-150 bg-white shadow-xs'
                            }`}
                          >
                            {isFailed && (
                              <div className="flex items-center gap-1.5 text-rose-800 font-extrabold text-[9.5px] uppercase tracking-wider bg-rose-100/60 border border-rose-200 p-2 rounded-lg">
                                <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                <span>Por favor, escolha uma opção (Sim ou Não)</span>
                              </div>
                            )}

                            <div>
                              <div className="flex items-center gap-1.5 text-slate-805 mb-2.5">
                                <span className="material-symbols-outlined text-rose-500 font-extrabold text-base shrink-0">notification_important</span>
                                <h4 className="font-extrabold text-slate-900 text-[11.5px] leading-tight select-none">
                                  {item.task}
                                </h4>
                              </div>
                              
                              <p className="text-[10.5px] text-slate-500 font-semibold mb-3 leading-snug">
                                Solicitar a abertura automática de ordem de serviço corretiva para este ativo?
                              </p>

                              {/* Sim / Não buttons */}
                              <div className="flex gap-2.5">
                                <button
                                  type="button"
                                  onClick={async () => {
                                    if (!selectedOrder) return;
                                    setFailedItemIds(prev => prev.filter(id => id !== item.id));
                                    const updatedChecklist = selectedOrder.checklist.map(c => {
                                      if (c.id === item.id) {
                                        return {
                                          ...c,
                                          checked: true,
                                          checkedAt: new Date().toISOString(),
                                          autoCorrectiveAnswer: 'Sim' as const,
                                          statusCheck: 'Não Atestado' as const, // Backward compatibility for older UI mappings
                                        };
                                      }
                                      return c;
                                    });
                                    const updatedOrder: ServiceOrder = {
                                      ...selectedOrder,
                                      checklist: updatedChecklist,
                                      status: selectedOrder.status === 'Planejada' ? 'Em Execução' : selectedOrder.status
                                    };
                                    setSelectedOrder(updatedOrder);
                                    await dbSaveServiceOrder(updatedOrder);
                                    onReload();
                                  }}
                                  className={`flex-1 py-2 px-3 rounded-lg text-[11px] font-black uppercase tracking-wider border transition-all text-center cursor-pointer ${
                                    currentAnswer === 'Sim'
                                      ? 'bg-rose-600 border-rose-700 text-white shadow-sm scale-102 font-black'
                                      : 'bg-rose-50/40 border-rose-100/50 text-rose-850 hover:bg-rose-100'
                                  }`}
                                >
                                  Sim
                                </button>

                                <button
                                  type="button"
                                  onClick={async () => {
                                    if (!selectedOrder) return;
                                    setFailedItemIds(prev => prev.filter(id => id !== item.id));
                                    const updatedChecklist = selectedOrder.checklist.map(c => {
                                      if (c.id === item.id) {
                                        return {
                                          ...c,
                                          checked: true,
                                          checkedAt: new Date().toISOString(),
                                          autoCorrectiveAnswer: 'Não' as const,
                                          statusCheck: 'Atestado' as const, // Backward compatibility
                                        };
                                      }
                                      return c;
                                    });
                                    const updatedOrder: ServiceOrder = {
                                      ...selectedOrder,
                                      checklist: updatedChecklist,
                                      status: selectedOrder.status === 'Planejada' ? 'Em Execução' : selectedOrder.status
                                    };
                                    setSelectedOrder(updatedOrder);
                                    await dbSaveServiceOrder(updatedOrder);
                                    onReload();
                                  }}
                                  className={`flex-1 py-2 px-3 rounded-lg text-[11px] font-black uppercase tracking-wider border transition-all text-center cursor-pointer ${
                                    currentAnswer === 'Não'
                                      ? 'bg-slate-700 border-slate-800 text-white shadow-sm scale-102 font-black'
                                      : 'bg-slate-100/60 border-slate-200 text-slate-705 hover:bg-slate-200/50'
                                  }`}
                                >
                                  Não
                                </button>
                              </div>
                            </div>

                            {/* Observations input fields */}
                            <div className="pt-2.5 border-t border-gray-100 flex flex-col gap-1">
                              <span className="block text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">
                                Relato Técnico / Observações da Avaria (Opcional)
                              </span>
                              <textarea
                                value={item.observations || ''}
                                rows={2}
                                onChange={(e) => handleChecklistObservationChange(item.id, e.target.value)}
                                placeholder="Informe observações ou detalhes das falhas encontradas..."
                                className="w-full text-xs p-2 bg-slate-50 border border-slate-250 rounded-lg text-slate-800 font-semibold focus:ring-1 focus:ring-slate-400 focus:outline-none focus:bg-white placeholder:text-gray-400 focus:border-slate-350"
                              />
                            </div>
                          </div>
                        );
                      }

                      if (type === 'three_states') {
                        const currentStatus = item.statusCheck || (item.checked ? 'Atestado' : undefined);
                        
                        return (
                          <div 
                            key={item.id} 
                            id={`checklist_item_${item.id}`}
                            className={`p-3.5 rounded-xl border transition-all duration-300 space-y-3 text-xs ${
                              isFailed 
                                ? 'border-rose-500 bg-rose-50/15 shadow-sm ring-2 ring-rose-200/50 animate-pulse' 
                                : 'border-gray-150 bg-white shadow-xs'
                            }`}
                          >
                            {isFailed && (
                              <div className="flex items-center gap-1.5 text-rose-800 font-extrabold text-[9.5px] uppercase tracking-wider bg-rose-100/60 border border-rose-200 p-2 rounded-lg">
                                <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                <span>Tarefa obrigatória pendente ou incompleta</span>
                              </div>
                            )}

                            <div>
                              <h4 className="font-extrabold text-slate-800 text-[11.5px] leading-tight mb-2.5">
                                {item.task}
                              </h4>
                              
                              {/* Three compliance interactive buttons */}
                              <div className="flex gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => selectItemStatus(selectedOrder.id, item.id, 'Atestado')}
                                  className={`flex-1 py-2 px-2.5 rounded-lg text-[10.5px] font-black uppercase tracking-wider border transition-all text-center cursor-pointer ${
                                    currentStatus === 'Atestado'
                                      ? 'bg-emerald-600 border-emerald-700 text-white shadow-sm scale-102 font-black'
                                      : 'bg-emerald-50/45 border-emerald-100/50 text-emerald-850 hover:bg-emerald-55'
                                  }`}
                                >
                                  Atestado
                                </button>

                                <button
                                  type="button"
                                  onClick={() => selectItemStatus(selectedOrder.id, item.id, 'Não Atestado')}
                                  className={`flex-1 py-2 px-2.5 rounded-lg text-[10.5px] font-black uppercase tracking-wider border transition-all text-center cursor-pointer ${
                                    currentStatus === 'Não Atestado'
                                      ? 'bg-rose-600 border-rose-700 text-white shadow-sm scale-102 font-black'
                                      : 'bg-rose-50/45 border-rose-100/50 text-rose-850 hover:bg-rose-55'
                                  }`}
                                >
                                  Não atestado
                                </button>

                                <button
                                  type="button"
                                  onClick={() => selectItemStatus(selectedOrder.id, item.id, 'Não se Aplica')}
                                  className={`flex-1 py-2 px-2.5 rounded-lg text-[10.5px] font-black uppercase tracking-wider border transition-all text-center cursor-pointer ${
                                    currentStatus === 'Não se Aplica'
                                      ? 'bg-slate-600 border-slate-700 text-white shadow-sm scale-102 font-black'
                                      : 'bg-slate-100/60 border-slate-200 text-slate-700 hover:bg-slate-200/50'
                                  }`}
                                >
                                  Não se aplica
                                </button>
                              </div>
                            </div>

                            {/* Non-conformance reason input details */}
                            {currentStatus === 'Não Atestado' && (
                              <div className="pt-2.5 border-t border-gray-100 flex flex-col gap-1">
                                <span className="block text-[9px] font-black text-rose-600 uppercase tracking-wider">
                                  Motivo do não atestado *
                                </span>
                                <textarea
                                  value={item.observations || ''}
                                  rows={2}
                                  onChange={(e) => handleChecklistObservationChange(item.id, e.target.value)}
                                  placeholder="Informe o motivo de forma clara..."
                                  className="w-full text-xs p-2 bg-rose-50/20 border border-rose-200 rounded-lg text-rose-900 font-medium focus:ring-1 focus:ring-rose-400 focus:outline-none"
                                />
                              </div>
                            )}

                            {/* Standard observations input details if attested or optional non-applicable */}
                            {currentStatus && currentStatus !== 'Não Atestado' && (
                              <div className="pt-2 border-t border-gray-100 flex flex-col gap-1">
                                <span className="block text-[9px] font-black text-gray-400 uppercase tracking-wider">
                                  Observação Adicional (Opcional)
                                </span>
                                <input
                                  type="text"
                                  value={item.observations && !item.observations.startsWith('Procedimento verificado') ? item.observations : ''}
                                  onChange={(e) => handleChecklistObservationChange(item.id, e.target.value)}
                                  placeholder="Ex: Medições realizadas, marcas observadas"
                                  className="w-full py-1.5 px-2 text-slate-700 bg-slate-50 border border-slate-200 rounded-lg focus:ring-1 focus:outline-none focus:ring-indigo-500"
                                />
                              </div>
                            )}
                          </div>
                        );
                      } else if (type === 'text') {
                        return (
                          <div 
                            key={item.id} 
                            id={`checklist_item_${item.id}`}
                            className={`p-3.5 rounded-xl border transition-all duration-300 space-y-2.5 text-xs ${
                              isFailed 
                                ? 'border-rose-500 bg-rose-50/15 shadow-sm ring-2 ring-rose-200/50 animate-pulse' 
                                : 'border-gray-150 bg-white shadow-xs'
                            }`}
                          >
                            {isFailed && (
                              <div className="flex items-center gap-1.5 text-rose-800 font-extrabold text-[9.5px] uppercase tracking-wider bg-rose-100/60 border border-rose-200 p-2 rounded-lg">
                                <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                <span>Resposta por extenso obrigatória</span>
                              </div>
                            )}

                            <div className="flex justify-between items-start gap-2">
                              <h4 className="font-extrabold text-slate-800 text-[11.5px] leading-tight">
                                {item.task}
                              </h4>
                              <span className="shrink-0 text-[8px] font-black tracking-wider bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-100">
                                Texto Livre
                              </span>
                            </div>
                            <textarea
                              value={item.observations || ''}
                              rows={2}
                              onChange={(e) => handleCustomFieldChange(item.id, e.target.value, 'text')}
                              placeholder="Digite aqui a resposta técnica detalhada..."
                              className="w-full text-xs p-2 bg-slate-50 border border-gray-200 rounded-lg text-slate-800 focus:ring-1 focus:ring-indigo-400 focus:outline-none placeholder:text-gray-400 leading-relaxed font-sans"
                            />
                          </div>
                        );
                      } else if (type === 'number') {
                        return (
                          <div 
                            key={item.id} 
                            id={`checklist_item_${item.id}`}
                            className={`p-3.5 rounded-xl border transition-all duration-300 space-y-2.5 text-xs ${
                              isFailed 
                                ? 'border-rose-500 bg-rose-50/15 shadow-sm ring-2 ring-rose-200/50 animate-pulse' 
                                : 'border-gray-150 bg-white shadow-xs'
                            }`}
                          >
                            {isFailed && (
                              <div className="flex items-center gap-1.5 text-rose-800 font-extrabold text-[9.5px] uppercase tracking-wider bg-rose-100/60 border border-rose-200 p-2 rounded-lg">
                                <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                <span>Valor numérico obrigatório</span>
                              </div>
                            )}

                            <div className="flex justify-between items-start gap-2">
                              <h4 className="font-extrabold text-slate-800 text-[11.5px] leading-tight">
                                {item.task}
                              </h4>
                              <span className="shrink-0 text-[8px] font-black tracking-wider bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded border border-sky-100">
                                Valor Numérico
                              </span>
                            </div>
                            <input
                              type="text"
                              value={item.observations || ''}
                              onChange={(e) => handleCustomFieldChange(item.id, e.target.value, 'number')}
                              placeholder="Digite o valor aferido (ex: 22.4, 380, etc.)"
                              className="w-full text-xs py-2 px-3 bg-slate-50 border border-gray-200 rounded-lg text-slate-800 font-mono focus:ring-1 focus:ring-indigo-400 focus:outline-none placeholder:text-gray-400"
                            />
                          </div>
                        );
                      } else if (type === 'boolean') {
                        return (
                          <div 
                            key={item.id} 
                            id={`checklist_item_${item.id}`}
                            className={`p-3.5 rounded-xl border transition-all duration-300 space-y-3 text-xs ${
                              isFailed 
                                ? 'border-rose-500 bg-rose-50/15 shadow-sm ring-2 ring-rose-200/50 animate-pulse' 
                                : 'border-gray-150 bg-white shadow-xs'
                            }`}
                          >
                            {isFailed && (
                              <div className="flex items-center gap-1.5 text-rose-800 font-extrabold text-[9.5px] uppercase tracking-wider bg-rose-100/60 border border-rose-200 p-2 rounded-lg">
                                <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                <span>Escolha Sim ou Não</span>
                              </div>
                            )}

                            <div className="flex justify-between items-start gap-2">
                              <h4 className="font-extrabold text-slate-800 text-[11.5px] leading-tight">
                                {item.task}
                              </h4>
                              <span className="shrink-0 text-[8px] font-black tracking-wider bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-100">
                                Opção Sim/Não
                              </span>
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => handleCustomFieldChange(item.id, 'Sim', 'boolean')}
                                className={`flex-1 py-1.5 px-3 rounded-lg text-[10.5px] font-bold uppercase transition-all text-center cursor-pointer border ${
                                  item.observations === 'Sim'
                                    ? 'bg-emerald-600 border-emerald-700 text-white shadow-xs'
                                    : 'bg-slate-50 hover:bg-slate-100/60 text-slate-700 border-gray-200'
                                }`}
                              >
                                Sim
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCustomFieldChange(item.id, 'Não', 'boolean')}
                                className={`flex-1 py-1.5 px-3 rounded-lg text-[10.5px] font-bold uppercase transition-all text-center cursor-pointer border ${
                                  item.observations === 'Não'
                                    ? 'bg-rose-600 border-rose-700 text-white shadow-xs'
                                    : 'bg-slate-50 hover:bg-slate-100/60 text-slate-700 border-gray-200'
                                }`}
                              >
                                Não
                              </button>
                            </div>
                          </div>
                        );
                      } else {
                        // Date type
                        return (
                          <div 
                            key={item.id} 
                            id={`checklist_item_${item.id}`}
                            className={`p-3.5 rounded-xl border transition-all duration-300 space-y-2.5 text-xs ${
                              isFailed 
                                ? 'border-rose-500 bg-rose-50/15 shadow-sm ring-2 ring-rose-200/50 animate-pulse' 
                                : 'border-gray-150 bg-white shadow-xs'
                            }`}
                          >
                            {isFailed && (
                              <div className="flex items-center gap-1.5 text-rose-800 font-extrabold text-[9.5px] uppercase tracking-wider bg-rose-100/60 border border-rose-200 p-2 rounded-lg">
                                <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                <span>Informar uma data é obrigatório</span>
                              </div>
                            )}

                            <div className="flex justify-between items-start gap-2">
                              <h4 className="font-extrabold text-slate-800 text-[11.5px] leading-tight">
                                {item.task}
                              </h4>
                              <span className="shrink-0 text-[8px] font-black tracking-wider bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded border border-amber-100">
                                Registro de Data
                              </span>
                            </div>
                            <input
                              type="date"
                              value={item.observations || ''}
                              onChange={(e) => handleCustomFieldChange(item.id, e.target.value, 'date')}
                              className="w-full text-xs py-2 px-3 bg-slate-50 border border-gray-200 rounded-lg text-slate-800 focus:ring-1 focus:ring-indigo-400 focus:outline-none"
                            />
                          </div>
                        );
                      }
                    })}
                  </div>
                )}
              </div>

              {/* Technician Notes Card - Fully Editable Free Textarea */}
              <div className="space-y-2">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                  Notas de Observação de Campo
                </p>

                <textarea
                  value={selectedOrder.notes || ''}
                  onChange={(e) => handleNotesChange(e.target.value)}
                  placeholder="Insira as ocorrências, observações gerais ou recomendações técnicas da preventiva..."
                  className="w-full text-xs p-3 bg-indigo-50/20 rounded-lg border-l-4 border-[#3525cd] text-slate-700 font-medium focus:ring-1 focus:ring-indigo-500 focus:outline-none min-h-[90px] leading-relaxed resize-y"
                  disabled={selectedOrder.status === 'Concluída'}
                />

                <div className="flex items-center gap-2.5 pt-2">
                  <div className="w-8 h-8 rounded-full bg-violet-100 text-violet-700 font-semibold text-xs flex items-center justify-center">
                    {selectedOrder.assignedTechnician.split(' ').map(n=>n[0]).join('')}
                  </div>
                  <div>
                    <h5 className="text-xs font-bold text-slate-800 leading-tight">{selectedOrder.assignedTechnician}</h5>
                    <p className="text-[10px] text-gray-400 font-bold uppercase overflow-hidden tracking-wider">Técnico Operador</p>
                  </div>
                </div>
              </div>

              {/* Display closed digital signature badge if completed */}
              {selectedOrder.status === 'Concluída' && selectedOrder.signature && (
                <div className="space-y-2 p-4 bg-emerald-50/30 rounded-lg border border-emerald-200">
                  <p className="text-[10px] text-emerald-800 font-extrabold uppercase">
                    Laudo Selado e Assinado
                  </p>
                  
                  <div className="flex justify-between items-end gap-4 mt-2">
                    <div>
                      <p className="text-xs font-bold text-slate-800 leading-tight">Assinante: {selectedOrder.signedBy}</p>
                      <p className="text-[10px] text-gray-400">Data de Encerramento: {formatDateBR(selectedOrder.signedAt)}</p>
                    </div>

                    <img 
                      src={selectedOrder.signature} 
                      alt="Assinatura técnica digital" 
                      className="max-h-16 border rounded bg-white p-1 max-w-[120px] mix-blend-multiply"
                    />
                  </div>
                </div>
              )}

            </div>

            {/* Sticky footer actions validation panel */}
            <div className="p-5 border-t border-gray-100 bg-[#eff4ff]/30 flex gap-3 shrink-0">
              
               {selectedOrder.status === 'Concluída' ? (
                <div className="flex-grow text-center text-[11px] font-bold text-emerald-700 bg-emerald-50 py-3.5 rounded-lg border border-emerald-200 flex items-center justify-center gap-1">
                  <FileCheck className="w-4 h-4" />
                  ORDEM CONCLUÍDA EM CONFORMIDADE
                </div>
              ) : selectedOrder.status === 'Não Executada' ? (
                <div className="flex-grow text-center text-[11px] font-bold text-rose-700 bg-rose-50 py-3.5 rounded-lg border border-rose-200 flex items-center justify-center gap-1">
                  <AlertTriangle className="w-4 h-4" />
                  ORDEM EXPIRADA / NÃO REALIZADA NO PRAZO
                </div>
              ) : (
                /* Primary completion CTA triggers signature box after checking validator rules */
                <button 
                  onClick={() => {
                    const errors = validateServiceOrder(selectedOrder);
                    const failedIds = getFailedItemIds(selectedOrder);
                    setFailedItemIds(failedIds);

                    if (errors.length > 0) {
                      if (failedIds.length > 0) {
                        const firstId = failedIds[0];
                        setTimeout(() => {
                          const element = document.getElementById(`checklist_item_${firstId}`);
                          if (element) {
                            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          }
                        }, 100);
                      }
                      alert(`⚠️ FALTA PREENCHER ITENS OBRIGATÓRIOS:\n\n${errors.join('\n')}`);
                      return;
                    }
                    setShowSignaturePad(true);
                  }}
                  className="flex-grow bg-[#3525cd] hover:bg-indigo-700 text-white font-bold text-xs py-3.5 rounded-lg flex items-center justify-center gap-1.5 shadow-md active:scale-95 cursor-pointer"
                >
                  <FileSignature className="w-4 h-4 text-white" />
                  VALIDAR EXECUÇÃO DE OS
                </button>
              )}

              <button 
                onClick={() => window.print()}
                className="w-12 h-11 flex items-center justify-center bg-white border border-gray-200 hover:bg-gray-50 rounded-lg text-slate-500 transition-colors cursor-pointer"
                title="Imprimir Ficha Técnica"
              >
                <span className="material-symbols-outlined text-lg">print</span>
              </button>
            </div>

            {/* FLOATING SIGNATURE PAD INNER DRAWER POPUP */}
            {showSignaturePad && (
              <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-20 p-4">
                <SignatureCanvas 
                  onSave={handleSignConfirm}
                  onCancel={() => setShowSignaturePad(false)}
                  defaultName={userProfile?.name}
                />
              </div>
            )}
            
          </div>
        </div>
      )}

      {/* CREATE NEW SERVICE ORDER MODAL FORM */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-lg w-full border border-gray-200 my-8">
            <div className="flex justify-between items-center pb-3 border-b border-gray-100 mb-4">
              <h3 className="font-extrabold text-[#0b1c30] text-sm flex items-center gap-1.5">
                <PlusCircle className="w-5 h-5 text-[#3525cd]" />
                Abrir Nova Ordem de Serviço Preventiva
              </h3>
              <button 
                onClick={() => setShowAddModal(false)}
                className="text-gray-400 hover:text-rose-600 font-extrabold text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateOSSubmit} className="space-y-4">
              {/* Every preventive order can originate from a selected asset or be a general survey */}
              <div>
                <label className="block text-[10px] font-extrabold text-gray-500 uppercase tracking-wider mb-1">
                  Ativo de Origem (Opcional)
                </label>
                <select
                  value={osAssetId}
                  onChange={(e) => setOsAssetId(e.target.value)}
                  className="w-full text-xs py-2 px-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold text-slate-800"
                >
                  <option value="">-- Sem vínculo (Vistoria oú Serviço Geral) --</option>
                  {assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      [{asset.code}] {asset.name} ({asset.sector})
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-500 mt-1">
                  * Selecione um ativo para carregar automaticamente o checklist do modelo preventiva, ou deixe vazio para vistorias em geral.
                </p>
              </div>

              <div>
                <label className="block text-[10px] font-extrabold text-gray-500 uppercase tracking-wider mb-1">
                  Título do Serviço*
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Preventiva Geral de Compressor"
                  value={osTitle}
                  onChange={(e) => setOsTitle(e.target.value)}
                  className="w-full text-xs py-2 px-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
                />
              </div>

              <div>
                <label className="block text-[10px] font-extrabold text-gray-500 uppercase tracking-wider mb-1">
                  Escopo descritivo do trabalho*
                </label>
                <textarea
                  required
                  rows={2}
                  placeholder="Ex: Efetuar reaperto de conexões, drenagem de óleo e higienização geral das colunas de resfriamento."
                  value={osDescription}
                  onChange={(e) => setOsDescription(e.target.value)}
                  className="w-full text-xs py-2 px-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-extrabold text-gray-500 uppercase tracking-wider mb-1">
                    Prioridade
                  </label>
                  <select
                    value={osPriority}
                    onChange={(e) => setOsPriority(e.target.value as any)}
                    className="w-full text-xs py-2 px-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none"
                  >
                    <option value="Baixa">Baixa</option>
                    <option value="Média">Média</option>
                    <option value="Alta">Alta</option>
                    <option value="Urgente">Urgente</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold text-gray-500 uppercase tracking-wider mb-1">
                    Agendamento*
                  </label>
                  <input
                    type="date"
                    required
                    value={osScheduledDate}
                    onChange={(e) => setOsScheduledDate(e.target.value)}
                    className="w-full text-xs py-2 px-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#3525cd]"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold text-gray-500 uppercase tracking-wider mb-1">
                    Técnico Nome
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Nome do Técnico Executor"
                    value={osTechnician}
                    onChange={(e) => setOsTechnician(e.target.value)}
                    className="w-full text-xs py-2 px-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#3525cd]"
                  />
                </div>
              </div>

              {/* Dynamic Checklist Customizer Layout */}
              {/* "a preventiva tem checklists dinâmicos para garantir a conformidade" */}
              <div className="p-4 bg-indigo-50/20 border border-indigo-100 rounded-xl space-y-3">
                <div className="flex justify-between items-center border-b border-indigo-100/60 pb-1.5">
                  <span className="text-[10px] font-black text-[#3525cd] uppercase tracking-wider block">
                    Checklist de Conformidade ({osChecklist.length} Tarefas dadas)
                  </span>
                </div>

                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {osChecklist.map((task, idx) => (
                    <div key={idx} className="flex justify-between items-center text-[11px] bg-white p-2 rounded border border-slate-100 font-semibold group">
                      <span className="text-slate-700 truncate">{task}</span>
                      <button 
                        type="button" 
                        onClick={() => removeChecklistItem(idx)}
                        className="text-stone-400 hover:text-rose-600 ml-2"
                        title="Remover item"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>

                {/* checklist item creator injector */}
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="Adicionar tarefa personalizada à preventiva..."
                    value={newChecklistItemText}
                    onChange={(e) => setNewChecklistItemText(e.target.value)}
                    className="flex-1 text-[11px] py-1.5 px-2 bg-white border border-gray-200 rounded focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={addCustomChecklistItem}
                    className="bg-[#3525cd]/15 text-[#3525cd] text-xs font-bold px-3 py-1.5 rounded hover:bg-[#3525cd]/25 cursor-pointer flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Inserir
                  </button>
                </div>
              </div>

              <div className="flex gap-2 justify-end text-xs pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#3525cd] text-white rounded-lg font-bold hover:bg-indigo-700 cursor-pointer shadow"
                >
                  Planejar & Automatizar OS
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EXCLUDE CONFIRMATION MODAL */}
      {orderIdToDelete && (
        <div className="fixed inset-0 z-50 bg-slate-900/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full border border-gray-150 transform transition-all animate-in fade-in zoom-in-95 duration-150 text-left">
            <div className="flex items-center gap-3 text-rose-600 mb-4">
              <div className="bg-rose-50 p-2.5 rounded-full border border-rose-100">
                <Trash2 className="w-5 h-5 text-rose-600" />
              </div>
              <h3 className="font-extrabold text-[#0b1c30] text-sm tracking-tight uppercase">
                Excluir Preventiva?
              </h3>
            </div>
            
            <p className="text-xs text-slate-600 leading-relaxed mb-6 font-medium">
              Você está prestes a excluir permanentemente a preventiva <strong className="font-black text-rose-700">#{orderIdToDelete}</strong>. Essa ação não pode ser desfeita e removerá todos os dados do cronograma. Deseja continuar?
            </p>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOrderIdToDelete(null)}
                className="px-4 py-2 border border-gray-250 text-slate-600 rounded-lg text-[11px] font-black uppercase tracking-wider hover:bg-gray-50 active:scale-95 transition-all duration-150 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={async () => {
                  const id = orderIdToDelete;
                  setOrderIdToDelete(null);
                  try {
                    await dbDeleteServiceOrder(id);
                    // Remove from list if currently selected
                    setSelectedOrderIds(prev => prev.filter(item => item !== id));
                    onReload();
                    if (selectedOrder && selectedOrder.id === id) {
                      setShowDrawer(false);
                      setSelectedOrder(null);
                    }
                  } catch (err) {
                    console.error('Failed to delete preventive:', err);
                    alert('Erro ao excluir preventiva.');
                  }
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[11px] font-black uppercase tracking-wider active:scale-95 transition-all duration-150 cursor-pointer shadow-sm border border-rose-700"
              >
                Sim, Excluir
              </button>
            </div>
          </div>
        </div>
      )}

        </>
      )}

      {/* BULK EXCLUDE CONFIRMATION MODAL */}
      {showBulkDeleteModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full border border-gray-150 transform transition-all animate-in fade-in zoom-in-95 duration-150 text-left">
            <div className="flex items-center gap-3 text-rose-600 mb-4">
              <div className="bg-rose-50 p-2.5 rounded-full border border-rose-100">
                <Trash2 className="w-5 h-5 text-rose-600" />
              </div>
              <h3 className="font-extrabold text-[#0b1c30] text-sm tracking-tight uppercase">
                Excluir em Lote?
              </h3>
            </div>
            
            <p className="text-xs text-slate-600 leading-relaxed mb-6 font-medium">
              Você está prestes a excluir permanentemente <strong className="font-black text-rose-700">{selectedOrderIds.length}</strong> preventivas selecionadas. Essa ação não pode ser desfeita e removerá os dados do cronograma correspondentes. Deseja continuar?
            </p>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={isBulkDeleting}
                onClick={() => setShowBulkDeleteModal(false)}
                className="px-4 py-2 border border-gray-250 text-slate-600 rounded-lg text-[11px] font-black uppercase tracking-wider hover:bg-gray-50 active:scale-95 transition-all duration-150 cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isBulkDeleting}
                onClick={async () => {
                  setIsBulkDeleting(true);
                  try {
                    await Promise.all(selectedOrderIds.map(id => dbDeleteServiceOrder(id)));
                    setSelectedOrderIds([]);
                    setShowBulkDeleteModal(false);
                    onReload();
                  } catch (err) {
                    console.error('Failed to perform bulk delete:', err);
                    alert('Erro ao excluir preventivas em lote.');
                    setShowBulkDeleteModal(false);
                  } finally {
                    setIsBulkDeleting(false);
                  }
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[11px] font-black uppercase tracking-wider active:scale-95 transition-all duration-150 cursor-pointer shadow-sm border border-rose-700 disabled:opacity-55"
              >
                {isBulkDeleting ? 'Excluindo...' : 'Sim, Excluir Todas'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SCAN SIMULATOR MODAL FOR SERVICE ORDERS / PREVENTIVES */}
      {showPreventiveScanSimulator && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 font-sans text-left">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full border border-gray-200">
            <div className="flex items-center gap-2 mb-4 justify-between border-b pb-3">
              <h3 className="font-extrabold text-[#0b1c30] text-sm flex items-center gap-2">
                <QrCode className="w-4 h-4 text-[#3525cd]" />
                Encontrar Preventiva via QR Code
              </h3>
              <button 
                onClick={() => {
                  setShowPreventiveScanSimulator(false);
                  setSimulatedPreventiveScanCode('');
                }}
                className="text-gray-400 hover:text-rose-600 font-extrabold text-sm"
              >
                ✕
              </button>
            </div>

            {/* TAB TOGGLES */}
            <div className="flex bg-slate-100 p-1 rounded-lg mb-4">
              <button
                type="button"
                onClick={() => setPreventiveScannerTab('camera')}
                className={`flex-1 text-center py-1.5 text-xs font-black rounded-md transition-all cursor-pointer ${
                  preventiveScannerTab === 'camera'
                    ? 'bg-white text-[#3525cd] shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Câmera ao Vivo
              </button>
              <button
                type="button"
                onClick={() => setPreventiveScannerTab('manual')}
                className={`flex-1 text-center py-1.5 text-xs font-black rounded-md transition-all cursor-pointer ${
                  preventiveScannerTab === 'manual'
                    ? 'bg-white text-[#3525cd] shadow-xs'
                    : 'text-slate-550 hover:text-slate-800'
                }`}
              >
                Simulador Manual
              </button>
            </div>

            {preventiveScannerTab === 'camera' ? (
              <div className="py-2">
                <CameraQrScanner 
                  onScanSuccess={(decodedText) => {
                    const normalized = decodedText.trim();
                    const cleanValue = normalized.replace('HEXON_PREVENTIVA_ASSET_ID_', '');
                    
                    const matchingAsset = assets.find(
                      a => a.id === cleanValue || 
                           a.code.toLowerCase() === cleanValue.toLowerCase() || 
                           a.id === normalized || 
                           a.code.toLowerCase() === normalized.toLowerCase()
                    );
                    
                    const codeToSet = matchingAsset ? matchingAsset.code : cleanValue;
                    setSmartSearch(codeToSet);
                    setShowPreventiveScanSimulator(false);
                    setSimulatedPreventiveScanCode('');
                    alert(`🔍 LEITURA REALIZADA COM SUCESSO!\nIdentificado Ativo: ${matchingAsset ? matchingAsset.name : codeToSet}\nFiltrando fila de preventivas para o patrimônio.`);
                  }}
                  onClose={() => setPreventiveScannerTab('manual')}
                />
                <p className="text-[10px] text-gray-400 text-center mt-3 font-semibold leading-relaxed">
                  Dica: Para ler, use a câmera traseira para escanear a etiqueta QR correspondente no equipamento.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-gray-550 leading-relaxed font-semibold">
                  Selecione o equipamento ou digite o patrimônio/código manualmente para simular a leitura do QR Code fixado no bem:
                </p>

                <div>
                  <label className="block text-[10px] font-extrabold text-gray-400 uppercase tracking-wider mb-1.5">
                    Selecione o Patrimônio do Ativo
                  </label>
                  <select
                    value={simulatedPreventiveScanCode}
                    onChange={(e) => setSimulatedPreventiveScanCode(e.target.value)}
                    className="w-full py-2 px-3 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-bold"
                  >
                    <option value="">Selecione para simular...</option>
                    {assets.map((ast) => (
                      <option key={ast.id} value={ast.code}>
                        [{ast.code}] {ast.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold text-gray-400 uppercase tracking-wider mb-1.5">
                    Ou digite o Patrimônio manualmente
                  </label>
                  <input
                    type="text"
                    placeholder="EX: 168548 ou GMC-01"
                    value={simulatedPreventiveScanCode}
                    onChange={(e) => setSimulatedPreventiveScanCode(e.target.value)}
                    className="w-full py-2 px-3 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-bold placeholder-slate-400"
                  />
                </div>

                <div className="flex gap-2 justify-end text-xs pt-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowPreventiveScanSimulator(false);
                      setSimulatedPreventiveScanCode('');
                    }}
                    className="px-4 py-2 border border-slate-200 rounded-lg text-gray-650 hover:bg-slate-50 font-black uppercase text-[10px] tracking-wider"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!simulatedPreventiveScanCode.trim()) {
                        alert('Selecione ou insira um código para escanear.');
                        return;
                      }
                      
                      setSmartSearch(simulatedPreventiveScanCode.trim());
                      setShowPreventiveScanSimulator(false);
                      setSimulatedPreventiveScanCode('');
                      alert(`🔍 LEITURA REALIZADA COM SUCESSO!\nFiltrando preventivas para o Equipamento de Patrimônio: ${simulatedPreventiveScanCode}`);
                    }}
                    disabled={!simulatedPreventiveScanCode}
                    className="px-4 py-2 bg-[#3525cd] text-white rounded-lg font-black hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed cursor-pointer uppercase text-[10px] tracking-wider transition-colors"
                  >
                    Simular QR Match
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
