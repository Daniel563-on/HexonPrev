import React, { useState, useEffect, useMemo } from 'react';
import {
  ClipboardList,
  Wrench,
  AlertTriangle,
  RotateCcw,
  FileCheck,
  FileSignature,
  Download,
  Lock,
  X
} from 'lucide-react';
import { ServiceOrder, Asset, formatDateBR, HexonUser } from '../../types';
import { formatOrderNumber } from '../../utils/orderNumber';
import { dbSaveServiceOrder } from '../../db/firebase';
import SignatureCanvas from '../SignatureCanvas';
import { generateFilledPdf } from '../../lib/pdfGenerator';

export interface OrderDetailsDrawerProps {
  isOpen: boolean;
  order: ServiceOrder | null;
  onClose: () => void;
  onReload: () => void;
  assets: Asset[];
  templates: any[];
  userProfile?: HexonUser | null;
  userHasActionPermission?: (permission: string) => boolean;
  canRevertUnexecutedOrder: (os: ServiceOrder, targetMonthDate?: Date) => boolean;
  currentCalendarDate: Date;
  onOrderUpdated?: (order: ServiceOrder) => void;
  initialOpenSignature?: boolean;
}

export const getProgressPercentage = (os: ServiceOrder) => {
  if (os.status === 'Concluída') return 100;
  if (os.status === 'Planejada') return 0;
  if (os.checklist.length === 0) return 30;
  const completed = os.checklist.filter(c => c.checked).length;
  return Math.round((completed / os.checklist.length) * 100);
};

export default function OrderDetailsDrawer({
  isOpen,
  order,
  onClose,
  onReload,
  assets,
  templates,
  userProfile,
  userHasActionPermission,
  canRevertUnexecutedOrder,
  currentCalendarDate,
  onOrderUpdated,
  initialOpenSignature
}: OrderDetailsDrawerProps) {
  const [selectedOrder, setSelectedOrderState] = useState<ServiceOrder | null>(order);
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [failedItemIds, setFailedItemIds] = useState<string[]>([]);
  const [photoEvidenceBase64, setPhotoEvidenceBase64] = useState<string | null>(null);

  useEffect(() => {
    setSelectedOrderState(order);
    setFailedItemIds([]);
    setPhotoEvidenceBase64(order?.photoEvidence || null);
    if (initialOpenSignature) {
      setShowSignaturePad(true);
    }
  }, [order, initialOpenSignature]);

  const setSelectedOrder = (updated: ServiceOrder | null) => {
    setSelectedOrderState(updated);
    if (updated) {
      onOrderUpdated?.(updated);
    }
  };

  const activeLinkedAsset = selectedOrder ? assets.find(a => a.id === selectedOrder.assetId) : null;

  // Strict field technician assignment check:
  // If the user profile is 'Profissional', they can ONLY execute orders explicitly assigned to them.
  const isAssignedToCurrentUser = useMemo(() => {
    if (!userProfile || userProfile.perfil !== 'Profissional') return true;
    if (!selectedOrder) return false;
    const userName = (userProfile.name || '').trim().toLowerCase();
    const userMat = (userProfile.matricula || '').trim().toLowerCase();
    const tech = (selectedOrder.assignedTechnician || '').trim().toLowerCase();
    return Boolean(
      tech &&
      tech !== 'não atribuído' &&
      tech !== 'equipe técnica' &&
      (tech === userName || tech.includes(userName) || userName.includes(tech) || (userMat && tech.includes(userMat)))
    );
  }, [userProfile, selectedOrder]);

  if (!isOpen || !selectedOrder) return null;

  // Change individual checklist compliance status
  const selectItemStatus = async (osId: string, itemId: string, status: 'Atestado' | 'Não Atestado' | 'Não se Aplica') => {
    if (!selectedOrder) return;
    if (selectedOrder.status === 'Concluída' || selectedOrder.status === 'Não Executada') return;

    if (!isAssignedToCurrentUser) {
      alert('Acesso Restrito: Você só pode preencher ou executar ordens de serviço atribuídas diretamente a você.');
      return;
    }

    if (userHasActionPermission && !userHasActionPermission('execute_order')) {
      alert('Acesso Restrito: Seu perfil de usuário não possui as permissões necessárias para preencher ou executar ordens de serviço (atestar itens).');
      return;
    }

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
      status: (selectedOrder.status !== 'Concluída' && selectedOrder.status !== 'Não Executada') ? 'Em Execução' : selectedOrder.status,
      assignedTechnician: selectedOrder.assignedTechnician && selectedOrder.assignedTechnician !== 'Não Atribuído' && selectedOrder.assignedTechnician !== 'Equipe Técnica'
        ? selectedOrder.assignedTechnician
        : (userProfile?.name || selectedOrder.assignedTechnician)
    };

    setSelectedOrder(updatedOrder);
    await dbSaveServiceOrder(updatedOrder);
    onReload();
  };

  // Change custom response type value (text, number, boolean, date)
  const changeCustomResponse = async (itemId: string, value: string, isChecked: boolean, status: 'Atestado' | 'Não Atestado' | 'Não se Aplica' = 'Atestado') => {
    if (!selectedOrder) return;
    if (selectedOrder.status === 'Concluída' || selectedOrder.status === 'Não Executada') return;

    if (!isAssignedToCurrentUser) {
      alert('Acesso Restrito: Você só pode preencher ou executar ordens de serviço atribuídas diretamente a você.');
      return;
    }

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
      status: (selectedOrder.status !== 'Concluída' && selectedOrder.status !== 'Não Executada') ? 'Em Execução' : selectedOrder.status,
      assignedTechnician: selectedOrder.assignedTechnician && selectedOrder.assignedTechnician !== 'Não Atribuído' && selectedOrder.assignedTechnician !== 'Equipe Técnica'
        ? selectedOrder.assignedTechnician
        : (userProfile?.name || selectedOrder.assignedTechnician)
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
    if (!selectedOrder) return;
    if (selectedOrder.status === 'Concluída' || selectedOrder.status === 'Não Executada') return;

    if (!isAssignedToCurrentUser) {
      alert('Acesso Restrito: Você só pode preencher ou alterar observações de ordens de serviço atribuídas diretamente a você.');
      return;
    }

    if (userHasActionPermission && !userHasActionPermission('execute_order')) {
      alert('Acesso Restrito: Seu perfil de usuário não possui as permissões necessárias para preencher observações das ordens de serviço.');
      return;
    }

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
    if (selectedOrder.status === 'Concluída' || selectedOrder.status === 'Não Executada') return;

    if (!isAssignedToCurrentUser) {
      alert('Acesso Restrito: Você só pode preencher ou executar ordens de serviço atribuídas diretamente a você.');
      return;
    }

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
    if (selectedOrder.status === 'Concluída' || selectedOrder.status === 'Não Executada') return;

    if (!isAssignedToCurrentUser) {
      alert('Acesso Restrito: Você só pode alterar observações em ordens de serviço atribuídas diretamente a você.');
      return;
    }

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
    if (!selectedOrder || selectedOrder.status === 'Concluída' || selectedOrder.status === 'Não Executada') return;

    if (!isAssignedToCurrentUser) {
      alert('Acesso Restrito: Você só pode anexar evidências fotográficas em ordens de serviço atribuídas diretamente a você.');
      return;
    }

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
    if (!selectedOrder) return;
    if (selectedOrder.status === 'Concluída') {
      alert('Esta ordem de serviço já foi concluída anteriormente.');
      setShowSignaturePad(false);
      return;
    }

    if (!isAssignedToCurrentUser) {
      alert('Acesso Restrito: Você só pode assinar e concluir ordens de serviço atribuídas diretamente a você.');
      return;
    }

    if (userHasActionPermission && !userHasActionPermission('sign_order')) {
      alert('Acesso Restrito: Seu perfil de usuário não tem autorização para assinar digitalmente e encerrar preventivas.');
      return;
    }

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

  // Helper to determine the comarca of an order
      return (
        <div className="fixed inset-0 z-[75] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 font-sans">
          {/* Overlay dismissal */}
          <div className="absolute inset-0" onClick={onClose}></div>

          {/* Centered Modal Frame */}
          <div className="relative w-full max-w-2xl bg-white max-h-[96vh] sm:max-h-[90vh] rounded-2xl shadow-2xl flex flex-col z-10 border border-gray-200 transform transition-all animate-in fade-in zoom-in-95 duration-150 overflow-hidden">
            
            {/* Header branding */}
            <div className="p-4 sm:p-5 bg-[#0b1c30] text-white flex justify-between items-center shrink-0">
              <div>
                <h3 className="font-extrabold text-sm sm:text-base flex items-center gap-1.5">
                  <ClipboardList className="w-4 h-4 text-indigo-400" />
                  Detalhes da Ordem de Serviço
                </h3>
                <p className="text-[10px] text-gray-400 font-mono">
                  #{formatOrderNumber(selectedOrder.id)} • {selectedOrder.status}
                </p>
              </div>
              
              <button 
                onClick={onClose}
                className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/10 text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable execution items */}
            <div className="flex-1 overflow-y-auto p-3.5 sm:p-5 space-y-4 sm:space-y-6">
              {!isAssignedToCurrentUser && (
                <div className="p-3.5 bg-amber-50 border-2 border-amber-300 rounded-xl flex items-center gap-2.5 text-amber-900 text-xs font-bold shadow-2xs">
                  <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600" />
                  <span>Esta Ordem de Serviço está atribuída ao técnico <strong>{selectedOrder.assignedTechnician || 'Não Atribuído'}</strong>. Modo somente leitura ativo. Você só pode preencher e validar preventivas atribuídas a você.</span>
                </div>
              )}
              
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
              <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-xs leading-snug space-y-2">
                <span className="block text-[10px] font-black text-slate-450 uppercase tracking-widest">
                  Janela de Execução / SLA de Corte
                </span>
                
                {/* Scheduled Allocation (Data ou Período Programado) */}
                {selectedOrder.scheduledDate && (
                  <div className="bg-indigo-50/70 border border-indigo-150 p-2 rounded text-[11px] flex items-center justify-between">
                    <span className="text-[9px] font-black uppercase text-indigo-900 tracking-wider">
                      {selectedOrder.scheduledEndDate ? 'Período Programado' : 'Data Programada'}:
                    </span>
                    <span className="font-extrabold text-[#3525cd]">
                      {selectedOrder.scheduledEndDate 
                        ? `${formatDateBR(selectedOrder.scheduledDate)} até ${formatDateBR(selectedOrder.scheduledEndDate)}`
                        : formatDateBR(selectedOrder.scheduledDate)}
                    </span>
                  </div>
                )}

                {selectedOrder.startDate && selectedOrder.endDate ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-white p-1.5 rounded border border-gray-100 text-[11px]">
                      <p className="text-[8px] text-slate-400 font-extrabold uppercase">Abertura da Janela (SLA)</p>
                      <p className="font-extrabold text-[#0b1c30]">{formatDateBR(selectedOrder.startDate)}</p>
                    </div>
                    <div className="bg-white p-1.5 rounded border border-gray-100 text-[11px]">
                      <p className="text-[8px] text-slate-500 font-extrabold uppercase">Tolerância Máxima (SLA)</p>
                      <p className="font-extrabold text-red-600">{formatDateBR(selectedOrder.endDate)}</p>
                    </div>
                  </div>
                ) : !selectedOrder.scheduledDate ? (
                  <div>
                    <span className="font-bold text-slate-600">Previsão Agendada: </span>
                    <span className="font-extrabold text-slate-400 italic">Não agendado</span>
                  </div>
                ) : null}
                {selectedOrder.status === 'Não Executada' && (() => {
                  const canRevertThis = canRevertUnexecutedOrder(selectedOrder, currentCalendarDate);
                  return (
                    <div className={`mt-2.5 p-3 border rounded-xl font-bold text-[10.5px] space-y-2.5 ${
                      canRevertThis 
                        ? 'bg-amber-50 border-amber-250 text-amber-900' 
                        : 'bg-rose-50 border-rose-200 text-rose-900'
                    }`}>
                      <div className="flex items-start gap-1.5">
                        <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${canRevertThis ? 'text-amber-600' : 'text-rose-600'}`} />
                        <span>
                          {canRevertThis 
                            ? 'Esta preventiva não foi executada na data agendada. Como ainda está dentro do prazo da criação em lote (ex: 01/09 a 30/09), você pode revertê-la para o status "Novo" para realizar um novo agendamento no período permitido.' 
                            : 'Esta preventiva expirou sem execução e o prazo da criação em lote já encerrou. O reagendamento está bloqueado e a ordem permanecerá definitivamente como "Não Executada".'}
                        </span>
                      </div>
                      {canRevertThis && userProfile?.perfil !== 'Profissional' && (
                        <button
                          type="button"
                          onClick={async () => {
                            const updatedOS: ServiceOrder = {
                              ...selectedOrder,
                              status: 'Novo',
                              scheduledDate: '',
                              scheduledEndDate: undefined,
                              assignedTechnician: '',
                              updatedAt: new Date().toISOString()
                            };
                            await dbSaveServiceOrder(updatedOS);
                            setSelectedOrder(updatedOS);
                            onClose();
                            onReload();
                          }}
                          className="w-full py-2 px-3 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer shadow-3xs transition-all active:scale-95"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Reverter Preventiva para "Novo" (Permitir Reagendamento)
                        </button>
                      )}
                    </div>
                  );
                })()}
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
                            status: (selectedOrder.status !== 'Concluída' && selectedOrder.status !== 'Não Executada') ? 'Em Execução' : selectedOrder.status,
                            assignedTechnician: selectedOrder.assignedTechnician && selectedOrder.assignedTechnician !== 'Não Atribuído' && selectedOrder.assignedTechnician !== 'Equipe Técnica'
                              ? selectedOrder.assignedTechnician
                              : (userProfile?.name || selectedOrder.assignedTechnician)
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
                                      status: (selectedOrder.status !== 'Concluída' && selectedOrder.status !== 'Não Executada') ? 'Em Execução' : selectedOrder.status,
                                      assignedTechnician: selectedOrder.assignedTechnician && selectedOrder.assignedTechnician !== 'Não Atribuído' && selectedOrder.assignedTechnician !== 'Equipe Técnica'
                                        ? selectedOrder.assignedTechnician
                                        : (userProfile?.name || selectedOrder.assignedTechnician)
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
                                      status: (selectedOrder.status !== 'Concluída' && selectedOrder.status !== 'Não Executada') ? 'Em Execução' : selectedOrder.status,
                                      assignedTechnician: selectedOrder.assignedTechnician && selectedOrder.assignedTechnician !== 'Não Atribuído' && selectedOrder.assignedTechnician !== 'Equipe Técnica'
                                        ? selectedOrder.assignedTechnician
                                        : (userProfile?.name || selectedOrder.assignedTechnician)
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
                                  className={`flex-1 min-h-[44px] py-2 px-2.5 rounded-lg text-[10.5px] font-black uppercase tracking-wider border transition-all text-center flex items-center justify-center cursor-pointer ${
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
                                  className={`flex-1 min-h-[44px] py-2 px-2.5 rounded-lg text-[10.5px] font-black uppercase tracking-wider border transition-all text-center flex items-center justify-center cursor-pointer ${
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
                                  className={`flex-1 min-h-[44px] py-2 px-2.5 rounded-lg text-[10.5px] font-black uppercase tracking-wider border transition-all text-center flex items-center justify-center cursor-pointer ${
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
            <div className="p-3 sm:p-5 border-t border-gray-100 bg-[#eff4ff]/30 flex flex-wrap sm:flex-nowrap gap-2 sm:gap-3 shrink-0">
              
               {selectedOrder.status === 'Concluída' ? (
                <div className="flex-grow text-center text-[11px] font-bold text-emerald-700 bg-emerald-50 py-3 rounded-xl border border-emerald-200 flex items-center justify-center gap-1">
                  <FileCheck className="w-4 h-4" />
                  ORDEM CONCLUÍDA EM CONFORMIDADE
                </div>
              ) : selectedOrder.status === 'Não Executada' ? (
                <div className="flex-grow text-center text-[11px] font-bold text-rose-700 bg-rose-50 py-3 rounded-xl border border-rose-200 flex items-center justify-center gap-1">
                  <AlertTriangle className="w-4 h-4" />
                  ORDEM EXPIRADA / NÃO REALIZADA NO PRAZO
                </div>
              ) : !isAssignedToCurrentUser ? (
                <div className="flex-grow min-h-[46px] bg-slate-100 text-slate-500 font-bold text-xs py-3 px-4 rounded-xl flex items-center justify-center gap-1.5 border border-slate-300">
                  <Lock className="w-4 h-4 text-slate-400" />
                  SOMENTE O TÉCNICO ATRIBUÍDO PODE VALIDAR A EXECUÇÃO
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
                  className="flex-grow min-h-[46px] bg-[#3525cd] hover:bg-indigo-700 text-white font-black text-xs py-3 px-4 rounded-xl flex items-center justify-center gap-1.5 shadow-md active:scale-98 cursor-pointer"
                >
                  <FileSignature className="w-4 h-4 text-white" />
                  VALIDAR EXECUÇÃO DE OS
                </button>
              )}

              {/* DOWNLOAD FILLED MAPPED PDF IF TEMPLATE HAS PDF */}
              {(() => {
                const assetObj = assets.find(a => a.id === selectedOrder.assetId);
                const matchingTpl = templates.find(t => {
                  if (selectedOrder.templateId && t.id === selectedOrder.templateId) return true;
                  if (assetObj) {
                    const type = assetObj.specs?.TIPO || assetObj.specs?.tipo;
                    if (t.targetAssetType && type && t.targetAssetType.toLowerCase() === type.toLowerCase()) return true;
                    if (t.targetSectorOrType && assetObj.sector && t.targetSectorOrType.toLowerCase() === assetObj.sector.toLowerCase()) return true;
                  }
                  return false;
                });

                if (!matchingTpl?.pdfTemplate?.pdfBase64) return null;

                return (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const { blobUrl } = await generateFilledPdf(
                          matchingTpl.pdfTemplate,
                          selectedOrder,
                          assetObj,
                          matchingTpl
                        );
                        const link = document.createElement('a');
                        link.href = blobUrl;
                        link.download = `Laudo_PDF_${selectedOrder.id}_${matchingTpl.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
                        link.click();
                      } catch (err: any) {
                        alert(`Erro ao gerar PDF preenchido: ${err?.message || err}`);
                      }
                    }}
                    className="px-3 h-11 flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-black transition-all shadow-sm cursor-pointer shrink-0"
                    title="Baixar Documento PDF Oficial Mapeado Preenchido"
                  >
                    <Download className="w-4 h-4" />
                    <span className="hidden sm:inline">Baixar PDF Mapeado</span>
                  </button>
                );
              })()}
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
  );

}
