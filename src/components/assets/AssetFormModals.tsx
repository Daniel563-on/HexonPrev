import React, { useState, useEffect } from 'react';
import { Edit, PlusCircle } from 'lucide-react';
import { Asset, Management } from '../../types';
import { dbSaveAsset, randomIdToken } from '../../db/firebase';
import { PeriodicityRule } from './AssetImportWizardModal';

// ==========================================
// 1. MODAL DE EDIÇÃO DE ATIVO (AssetEditModal)
// ==========================================

export interface AssetEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  asset: Asset | null;
  managements: Management[];
  onSaveSuccess: (updatedAsset: Asset) => void;
}

export const AssetEditModal: React.FC<AssetEditModalProps> = ({
  isOpen,
  onClose,
  asset,
  managements,
  onSaveSuccess
}) => {
  const [editingCode, setEditingCode] = useState('');
  const [editingName, setEditingName] = useState('');
  const [editingSector, setEditingSector] = useState('Refrigeração');
  const [editingLocation, setEditingLocation] = useState('');
  const [editingManufacturer, setEditingManufacturer] = useState('');
  const [editingModel, setEditingModel] = useState('');
  const [editingSerial, setEditingSerial] = useState('');
  const [editingPower, setEditingPower] = useState('');
  const [editingCapacity, setEditingCapacity] = useState('');
  const [editingVoltage, setEditingVoltage] = useState('');
  const [editingPeriodicities, setEditingPeriodicities] = useState<('Mensal' | 'Trimestral' | 'Semestral' | 'Anual')[]>(['Mensal']);
  const [editingDynamicFormValues, setEditingDynamicFormValues] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen && asset) {
      setEditingCode(asset.code || '');
      setEditingName(asset.name || '');
      const activeManagements = managements.filter(m => m.name !== 'Todas');
      const defaultSec = activeManagements.length > 0 ? activeManagements[0].name : 'Civil';
      setEditingSector(asset.sector || defaultSec);
      setEditingLocation(asset.location || '');
      setEditingManufacturer(asset.specs?.manufacturer || asset.specs?.MARCA || '');
      setEditingModel(asset.specs?.model || asset.specs?.MODELO || '');
      setEditingSerial(asset.specs?.serialNumber || asset.specs?.['Nº DE SÉRIE'] || '');
      setEditingPower(asset.specs?.power || '');
      setEditingCapacity(asset.specs?.capacity || '');
      setEditingVoltage(asset.specs?.voltage || '');
      setEditingPeriodicities(asset.periodicities || []);
      setEditingDynamicFormValues(asset.specs || {});
      setIsSubmitting(false);
    }
  }, [isOpen, asset, managements]);

  if (!isOpen || !asset) return null;

  const handleUpdateAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCode || !editingName || !editingLocation) {
      alert('Por favor, preencha todos os campos obrigatórios (Código, Nome, Localização).');
      return;
    }

    setIsSubmitting(true);
    try {
      const nowString = new Date().toISOString();
      const updatedSpecs = {
        ...editingDynamicFormValues,
        manufacturer: editingManufacturer,
        model: editingModel,
        serialNumber: editingSerial,
        power: editingPower,
        capacity: editingCapacity,
        voltage: editingVoltage,
        STATUS: editingDynamicFormValues['STATUS'] || 'Operando',
        'DATA DE AQUISIÇÃO': editingDynamicFormValues['DATA DE AQUISIÇÃO'] || nowString.split('T')[0],
        'VALOR DE AQUISIÇÃO': editingDynamicFormValues['VALOR DE AQUISIÇÃO'] || '0,00',
        'VALOR LÍQUIDO': editingDynamicFormValues['VALOR LÍQUIDO'] || '0,00'
      };

      const updatedAsset: Asset = {
        id: asset.id,
        code: editingCode.trim().toUpperCase(),
        name: editingName.trim(),
        sector: editingSector,
        location: editingLocation.trim(),
        status: (editingDynamicFormValues['STATUS'] as any) || 'Operando',
        specs: updatedSpecs,
        createdAt: asset.createdAt || nowString,
        updatedAt: nowString,
        periodicities: editingPeriodicities
      };

      await dbSaveAsset(updatedAsset);
      onSaveSuccess(updatedAsset);
      onClose();
      alert('Equipamento atualizado com sucesso no banco de dados!');
    } catch (err) {
      console.error(err);
      alert('Erro ao atualizar equipamento.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 font-sans overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl p-6 max-w-lg w-full border border-gray-200 my-8">
        <div className="flex items-center gap-2 mb-4 justify-between border-b pb-3">
          <h3 className="font-extrabold text-[#0b1c30] text-sm flex items-center gap-2">
            <Edit className="w-4 h-4 text-indigo-600" />
            Editar Especificações do Equipamento
          </h3>
          <button 
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-rose-600 font-extrabold text-sm cursor-pointer"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleUpdateAsset} className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
          
          {/* Group 1: Itens Principais */}
          <div className="p-4 bg-slate-50/50 rounded-xl border border-gray-100 space-y-3">
            <span className="text-[10px] font-black text-[#0b1c30] uppercase tracking-wider block border-b pb-1.5 mb-1">
              1. Itens Principais do Ativo
            </span>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-extrabold text-gray-500 uppercase mb-1">
                  PATRIMÔNIO (Código de Identificação)*
                </label>
                <input
                  type="text"
                  required
                  placeholder="HEX-PAT-2026-01"
                  value={editingCode}
                  onChange={(e) => setEditingCode(e.target.value)}
                  className="w-full text-xs py-1.5 px-3 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono font-bold"
                />
              </div>

              <div>
                <label className="block text-[10px] font-extrabold text-gray-500 uppercase mb-1">
                  Setor Operacional*
                </label>
                <select
                  value={editingSector}
                  onChange={(e) => setEditingSector(e.target.value)}
                  className="w-full text-xs py-1.5 px-3 bg-white border border-gray-200 rounded-lg focus:outline-none font-bold text-slate-800"
                >
                  {managements.length > 0 ? (
                    managements.filter(m => m.name !== 'Todas').map((m) => (
                      <option key={m.id} value={m.name}>{m.name}</option>
                    ))
                  ) : (
                    <>
                      <option value="Refrigeração">Refrigeração</option>
                      <option value="Elétrica">Elétrica</option>
                      <option value="Civil">Civil</option>
                    </>
                  )}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-extrabold text-gray-500 uppercase mb-1">
                  MATERIAL (Nome Descritivo)*
                </label>
                <input
                  type="text"
                  required
                  placeholder="Chiller Carrier Recíproco"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  className="w-full text-xs py-1.5 px-3 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-bold"
                />
              </div>

              <div>
                <label className="block text-[10px] font-extrabold text-gray-500 uppercase mb-1">
                  ENDEREÇO (Localização Física)*
                </label>
                <input
                  type="text"
                  required
                  placeholder="Subsolo - Praça de Máquinas"
                  value={editingLocation}
                  onChange={(e) => setEditingLocation(e.target.value)}
                  className="w-full text-xs py-1.5 px-3 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-extrabold text-gray-500 uppercase mb-1">
                  CRAAI
                </label>
                <input
                  type="text"
                  placeholder="CRAAI Rio de Janeiro"
                  value={editingDynamicFormValues['CRAAI'] || ''}
                  onChange={(e) => setEditingDynamicFormValues({ ...editingDynamicFormValues, CRAAI: e.target.value })}
                  className="w-full text-xs py-1.5 px-3 bg-white border border-gray-200 rounded-lg focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-extrabold text-gray-500 uppercase mb-1">
                  COMARCA
                </label>
                <input
                  type="text"
                  placeholder="Comarca Capital"
                  value={editingDynamicFormValues['COMARCA'] || ''}
                  onChange={(e) => setEditingDynamicFormValues({ ...editingDynamicFormValues, COMARCA: e.target.value })}
                  className="w-full text-xs py-1.5 px-3 bg-white border border-gray-200 rounded-lg focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Maintenance Periodicities selection checkboxes */}
          <div className="p-3.5 bg-blue-50/45 border border-blue-100 rounded-xl space-y-2">
            <span className="text-[10px] font-black text-[#0b1c30] uppercase tracking-widest block">
              Periodicidades Técnicas Aplicáveis*
            </span>
            <p className="text-[9px] text-[#42526e] -mt-1 leading-normal mb-1">
              Selecione os ciclos de preventiva desejados no sistema para este ativo:
            </p>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
              {(['Mensal', 'Trimestral', 'Semestral', 'Anual'] as const).map((period) => (
                <label key={period} className="flex items-center gap-2 cursor-pointer font-bold text-[#0b1c30]">
                  <input
                    type="checkbox"
                    checked={editingPeriodicities.includes(period)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setEditingPeriodicities([...editingPeriodicities, period]);
                      } else {
                        setEditingPeriodicities(editingPeriodicities.filter(p => p !== period));
                      }
                    }}
                    className="w-4 h-4 rounded text-[#3525cd] focus:ring-[#3525cd] border-gray-300 transition-all accent-[#3525cd]"
                  />
                  {period}
                </label>
              ))}
            </div>
          </div>

          {/* Group 2: Especificações Técnicas */}
          <div className="p-4 bg-emerald-50/15 rounded-xl border border-emerald-100/40 space-y-3">
            <span className="text-[10px] font-black text-emerald-800 uppercase tracking-widest block border-b pb-1.5 mb-1">
              2. Especificações Técnicas do Ativo
            </span>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[9px] font-bold text-gray-500 uppercase mb-0.5">MARCA</label>
                <input
                  type="text"
                  placeholder="Carrier / Siemens"
                  value={editingManufacturer}
                  onChange={(e) => setEditingManufacturer(e.target.value)}
                  className="w-full text-xs py-1.5 px-2 bg-white border border-gray-200 rounded"
                />
              </div>

              <div>
                <label className="block text-[9px] font-bold text-gray-500 uppercase mb-0.5">MODELO</label>
                <input
                  type="text"
                  placeholder="TR-30XA"
                  value={editingModel}
                  onChange={(e) => setEditingModel(e.target.value)}
                  className="w-full text-xs py-1.5 px-2 bg-white border border-gray-250 rounded"
                />
              </div>

              <div>
                <label className="block text-[9px] font-bold text-gray-500 uppercase mb-0.5">Nº DE SÉRIE</label>
                <input
                  type="text"
                  placeholder="SN-98273"
                  value={editingSerial}
                  onChange={(e) => setEditingSerial(e.target.value)}
                  className="w-full text-xs py-1.5 px-2 bg-white border border-gray-250 rounded"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-[9px] font-bold text-gray-500 uppercase mb-0.5">STATUS</label>
                <select
                  value={editingDynamicFormValues['STATUS'] || 'Operando'}
                  onChange={(e) => setEditingDynamicFormValues({ ...editingDynamicFormValues, STATUS: e.target.value })}
                  className="w-full text-[11px] py-1.5 px-2 bg-white border border-gray-200 rounded"
                >
                  <option value="Operando">Operando</option>
                  <option value="Parado">Parado</option>
                  <option value="Em Manutenção">Em Manutenção</option>
                </select>
              </div>

              <div>
                <label className="block text-[9px] font-bold text-gray-500 uppercase mb-0.5">DATA DE AQUISIÇÃO</label>
                <input
                  type="date"
                  value={editingDynamicFormValues['DATA DE AQUISIÇÃO'] || ''}
                  onChange={(e) => setEditingDynamicFormValues({ ...editingDynamicFormValues, 'DATA DE AQUISIÇÃO': e.target.value })}
                  className="w-full text-[11px] py-1 px-2 bg-white border border-gray-250 rounded focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-[9px] font-bold text-gray-500 uppercase mb-0.5">VALOR DE AQUISIÇÃO</label>
                <input
                  type="text"
                  placeholder="0,00"
                  value={editingDynamicFormValues['VALOR DE AQUISIÇÃO'] || '0,00'}
                  onChange={(e) => setEditingDynamicFormValues({ ...editingDynamicFormValues, 'VALOR DE AQUISIÇÃO': e.target.value })}
                  className="w-full text-[11px] py-1 px-2 bg-white border border-gray-250 rounded focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[9px] font-bold text-gray-500 uppercase mb-0.5">VALOR LÍQUIDO</label>
                <input
                  type="text"
                  placeholder="0,00"
                  value={editingDynamicFormValues['VALOR LÍQUIDO'] || '0,00'}
                  onChange={(e) => setEditingDynamicFormValues({ ...editingDynamicFormValues, 'VALOR LÍQUIDO': e.target.value })}
                  className="w-full text-[11px] py-1 px-2 bg-white border border-gray-250 rounded focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* SAVE & SUBMIT CONTROLS */}
          <div className="flex items-center gap-2.5 justify-end pt-3 border-t">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 border border-gray-200 hover:bg-gray-55 rounded-lg text-xs leading-none font-bold text-slate-700 hover:text-black transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2.5 bg-[#3525cd] hover:bg-opacity-95 text-white font-extrabold text-xs leading-none rounded-lg shadow-sm transition-all hover:scale-[1.01] cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? 'Salvando...' : 'Salvar Alterações'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};


// ==========================================
// 2. MODAL DE CRIAÇÃO DE ATIVO (AssetCreateModal)
// ==========================================

export interface AssetCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  managements: Management[];
  periodicityRules: PeriodicityRule[];
  customDynamicFields: string[];
  onCreateSuccess: (newAsset: Asset) => void;
}

export const AssetCreateModal: React.FC<AssetCreateModalProps> = ({
  isOpen,
  onClose,
  managements,
  periodicityRules,
  customDynamicFields,
  onCreateSuccess
}) => {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  
  const defaultSector = React.useMemo(() => {
    const active = managements.filter(m => m.name !== 'Todas');
    return active.length > 0 ? active[0].name : 'Refrigeração';
  }, [managements]);

  const [sector, setSector] = useState(defaultSector);
  const [location, setLocation] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [serial, setSerial] = useState('');
  const [power, setPower] = useState('');
  const [capacity, setCapacity] = useState('');
  const [voltage, setVoltage] = useState('');
  const [periodicities, setPeriodicities] = useState<('Mensal' | 'Trimestral' | 'Semestral' | 'Anual')[]>(['Mensal']);
  const [dynamicFormValues, setDynamicFormValues] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setCode('');
      setName('');
      setSector(defaultSector);
      setLocation('');
      setManufacturer('');
      setModel('');
      setSerial('');
      setPower('');
      setCapacity('');
      setVoltage('');
      setPeriodicities(['Mensal']);
      setDynamicFormValues({});
      setIsSubmitting(false);
    }
  }, [isOpen, defaultSector]);

  if (!isOpen) return null;

  const handleCreateAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || !name || !location) {
      alert('Por favor, preencha os campos obrigatórios (Código, Nome, Localização).');
      return;
    }

    setIsSubmitting(true);
    try {
      const uniqueId = `as_${sector.toLowerCase().replace('/', '_')}_${Date.now().toString().slice(-4)}_${randomIdToken(4).toLowerCase()}`;
      const statusVal = dynamicFormValues['STATUS'] || 'Operando';
      const acqDateVal = dynamicFormValues['DATA DE AQUISIÇÃO'] || new Date().toISOString().split('T')[0];

      const manualSpecs: any = {
        manufacturer: manufacturer.trim() || '',
        model: model.trim() || '',
        serialNumber: serial.trim() || '',
        installationDate: acqDateVal,
        status: statusVal,
        acquisitionValue: dynamicFormValues['VALOR DE AQUISIÇÃO'] || '',
        netValue: dynamicFormValues['VALOR LÍQUIDO'] || '',
        craai: dynamicFormValues['CRAAI'] || '',
        comarca: dynamicFormValues['COMARCA'] || '',
        material: name.trim(),
        tipo: dynamicFormValues['TIPO'] || '',
        power: power.trim() || undefined,
        capacity: capacity.trim() || undefined,
        voltage: voltage.trim() || undefined,
        warrantyUntil: undefined
      };

      customDynamicFields.forEach((field) => {
        if (dynamicFormValues[field] !== undefined && dynamicFormValues[field].trim() !== '') {
          manualSpecs[field] = dynamicFormValues[field].trim();
        }
      });

      const preparedAsset: Asset = {
        id: uniqueId,
        code: code.trim().toUpperCase(),
        name: name.trim(),
        sector,
        location: location.trim(),
        status: statusVal as any,
        specs: manualSpecs,
        createdAt: new Date().toISOString(),
        periodicities
      };

      await dbSaveAsset(preparedAsset);
      alert('Novo ativo cadastrado com sucesso!');
      onCreateSuccess(preparedAsset);
      onClose();
    } catch (err) {
      console.error(err);
      alert('Erro ao persistir ativo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 font-sans overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl p-6 max-w-lg w-full border border-gray-200 my-8">
        <div className="flex items-center gap-2 mb-4 justify-between border-b pb-3">
          <h3 className="font-extrabold text-[#0b1c30] text-sm flex items-center gap-2">
            <PlusCircle className="w-4 h-4 text-[#3525cd]" />
            Cadastrar Novo Equipamento
          </h3>
          <button 
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-rose-600 font-extrabold text-sm cursor-pointer"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleCreateAsset} className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
          
          {/* Group 1: Itens Principais */}
          <div className="p-4 bg-slate-50/50 rounded-xl border border-gray-100 space-y-3">
            <span className="text-[10px] font-black text-[#0b1c30] uppercase tracking-wider block border-b pb-1.5 mb-1">
              1. Itens Principais do Ativo
            </span>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-extrabold text-gray-500 uppercase mb-1">
                  PATRIMÔNIO (Código de Identificação)*
                </label>
                <input
                  type="text"
                  required
                  placeholder="HEX-PAT-2026-01"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-full text-xs py-1.5 px-3 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-extrabold text-gray-500 uppercase mb-1">
                  Setor Operacional*
                </label>
                <select
                  value={sector}
                  onChange={(e) => setSector(e.target.value)}
                  className="w-full text-xs py-1.5 px-3 bg-white border border-gray-200 rounded-lg focus:outline-none font-bold text-slate-800"
                >
                  {managements.length > 0 ? (
                    managements.filter(m => m.name !== 'Todas').map((m) => (
                      <option key={m.id} value={m.name}>{m.name}</option>
                    ))
                  ) : (
                    <>
                      <option value="Refrigeração">Refrigeração</option>
                      <option value="Elétrica">Elétrica</option>
                      <option value="Civil">Civil</option>
                    </>
                  )}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-extrabold text-gray-500 uppercase mb-1">
                  MATERIAL (Nome Descritivo)*
                </label>
                <input
                  type="text"
                  required
                  placeholder="Chiller Carrier Recíproco"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full text-xs py-1.5 px-3 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-extrabold text-gray-500 uppercase mb-1">
                  ENDEREÇO (Localização Física)*
                </label>
                <input
                  type="text"
                  required
                  placeholder="Subsolo - Praça de Máquinas"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full text-xs py-1.5 px-3 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-extrabold text-gray-500 uppercase mb-1">
                  CRAAI (Se houver)
                </label>
                <input
                  type="text"
                  placeholder="CRAAI Rio de Janeiro"
                  value={dynamicFormValues['CRAAI'] || ''}
                  onChange={(e) => setDynamicFormValues({ ...dynamicFormValues, CRAAI: e.target.value })}
                  className="w-full text-xs py-1.5 px-3 bg-white border border-gray-200 rounded-lg focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-extrabold text-gray-500 uppercase mb-1">
                  COMARCA (Se houver)
                </label>
                <input
                  type="text"
                  placeholder="Comarca Capital"
                  value={dynamicFormValues['COMARCA'] || ''}
                  onChange={(e) => setDynamicFormValues({ ...dynamicFormValues, COMARCA: e.target.value })}
                  className="w-full text-xs py-1.5 px-3 bg-white border border-gray-200 rounded-lg focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-extrabold text-gray-500 uppercase mb-1">
                TIPO (Palavra-chave para Periodicidade)
              </label>
              <input
                type="text"
                placeholder="Ar Condicionado Chiller Gerador"
                value={dynamicFormValues['TIPO'] || ''}
                onChange={(e) => {
                  const val = e.target.value;
                  setDynamicFormValues({ ...dynamicFormValues, TIPO: val });
                  
                  const t = val.toLowerCase().trim();
                  
                  // Check custom rules first
                  if (periodicityRules && periodicityRules.length > 0) {
                    const match = periodicityRules.find(r => {
                      const kw = r.keyword.toLowerCase().trim();
                      return t === kw || t.includes(kw) || kw.includes(t);
                    });
                    if (match && match.selectPeriodicities.length > 0) {
                      setPeriodicities(match.selectPeriodicities);
                      return;
                    }
                  }

                  // Auto calculate corresponding periodic checkboxes under fallback keyword mapping
                  const lower = val.toLowerCase();
                  const detected: ('Mensal' | 'Trimestral' | 'Semestral' | 'Anual')[] = [];
                  if (lower.includes('acj')) {
                    detected.push('Mensal', 'Semestral');
                  } else {
                    if (lower.includes('mensal') || lower.includes('ar') || lower.includes('chiller') || lower.includes('clima')) {
                      detected.push('Mensal');
                    }
                    if (lower.includes('trimestral') || lower.includes('bomba') || lower.includes('hidro')) {
                      detected.push('Trimestral');
                    }
                    if (lower.includes('semestral') || lower.includes('gerador') || lower.includes('subestação')) {
                      detected.push('Semestral');
                    }
                    if (lower.includes('anual') || lower.includes('civil') || lower.includes('extintor')) {
                      detected.push('Anual');
                    }
                  }
                  if (detected.length > 0) {
                    setPeriodicities(detected);
                  }
                }}
                className="w-full text-xs py-1.5 px-3 bg-white border border-gray-200 rounded-lg focus:outline-none"
              />
            </div>
          </div>

          {/* Maintenance Periodicities selection checkboxes */}
          <div className="p-3.5 bg-blue-50/45 border border-blue-100 rounded-xl space-y-2">
            <span className="text-[10px] font-black text-[#0b1c30] uppercase tracking-widest block">
              Periodicidades Técnicas Aplicáveis*
            </span>
            <p className="text-[9px] text-[#42526e] -mt-1 leading-normal mb-1">
              Selecione os ciclos de preventiva desejados no sistema:
            </p>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
              {(['Mensal', 'Trimestral', 'Semestral', 'Anual'] as const).map((period) => (
                <label key={period} className="flex items-center gap-2 cursor-pointer font-bold text-[#0b1c30]">
                  <input
                    type="checkbox"
                    checked={periodicities.includes(period)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setPeriodicities([...periodicities, period]);
                      } else {
                        setPeriodicities(periodicities.filter(p => p !== period));
                      }
                    }}
                    className="w-4 h-4 rounded text-[#3525cd] focus:ring-[#3525cd] border-gray-300 transition-all accent-[#3525cd]"
                  />
                  {period}
                </label>
              ))}
            </div>
          </div>

          {/* Group 2: Especificações Técnicas */}
          <div className="p-4 bg-emerald-50/15 rounded-xl border border-emerald-100/40 space-y-3">
            <span className="text-[10px] font-black text-emerald-800 uppercase tracking-widest block border-b pb-1.5 mb-1">
              2. Especificações Técnicas do Ativo
            </span>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[9px] font-bold text-gray-500 uppercase mb-0.5">MARCA</label>
                <input
                  type="text"
                  placeholder="Carrier / Siemens"
                  value={manufacturer}
                  onChange={(e) => setManufacturer(e.target.value)}
                  className="w-full text-xs py-1.5 px-2 bg-white border border-gray-200 rounded"
                />
              </div>

              <div>
                <label className="block text-[9px] font-bold text-gray-500 uppercase mb-0.5">MODELO</label>
                <input
                  type="text"
                  placeholder="TR-30XA"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full text-xs py-1.5 px-2 bg-white border border-gray-250 rounded"
                />
              </div>

              <div>
                <label className="block text-[9px] font-bold text-gray-500 uppercase mb-0.5">Nº DE SÉRIE</label>
                <input
                  type="text"
                  placeholder="SN-98273"
                  value={serial}
                  onChange={(e) => setSerial(e.target.value)}
                  className="w-full text-xs py-1.5 px-2 bg-white border border-gray-250 rounded"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-[9px] font-bold text-gray-500 uppercase mb-0.5">STATUS</label>
                <select
                  value={dynamicFormValues['STATUS'] || 'Operando'}
                  onChange={(e) => setDynamicFormValues({ ...dynamicFormValues, STATUS: e.target.value })}
                  className="w-full text-[11px] py-1.5 px-2 bg-white border border-gray-200 rounded"
                >
                  <option value="Operando">Operando</option>
                  <option value="Parado">Parado</option>
                  <option value="Em Manutenção">Em Manutenção</option>
                </select>
              </div>

              <div>
                <label className="block text-[9px] font-bold text-gray-500 uppercase mb-0.5">DATA DE AQUISIÇÃO</label>
                <input
                  type="date"
                  value={dynamicFormValues['DATA DE AQUISIÇÃO'] || new Date().toISOString().split('T')[0]}
                  onChange={(e) => setDynamicFormValues({ ...dynamicFormValues, 'DATA DE AQUISIÇÃO': e.target.value })}
                  className="w-full text-[11px] py-1 px-2 bg-white border border-gray-250 rounded focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-[9px] font-bold text-gray-500 uppercase mb-0.5">VALOR DE AQUISIÇÃO</label>
                <input
                  type="text"
                  placeholder="R$ 45.000,00"
                  value={dynamicFormValues['VALOR DE AQUISIÇÃO'] || ''}
                  onChange={(e) => setDynamicFormValues({ ...dynamicFormValues, 'VALOR DE AQUISIÇÃO': e.target.value })}
                  className="w-full text-[11px] py-1.5 px-2 bg-white border border-gray-200 rounded"
                />
              </div>

              <div>
                <label className="block text-[9px] font-bold text-gray-500 uppercase mb-0.5">VALOR LÍQUIDO</label>
                <input
                  type="text"
                  placeholder="R$ 38.500,00"
                  value={dynamicFormValues['VALOR LÍQUIDO'] || ''}
                  onChange={(e) => setDynamicFormValues({ ...dynamicFormValues, 'VALOR LÍQUIDO': e.target.value })}
                  className="w-full text-[11px] py-1.5 px-2 bg-white border border-gray-200 rounded"
                />
              </div>
            </div>

            {/* Optional other design specs */}
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-dashed border-gray-200">
              <div>
                <label className="block text-[8px] font-bold text-gray-400 uppercase mb-0.5">Potência (Opcional)</label>
                <input
                  type="text"
                  placeholder="e.g. 25 HP"
                  value={power}
                  onChange={(e) => setPower(e.target.value)}
                  className="w-full text-[10px] py-1 px-2 bg-white border border-gray-200 rounded"
                />
              </div>

              <div>
                <label className="block text-[8px] font-bold text-gray-400 uppercase mb-0.5">Capacidade (Opcional)</label>
                <input
                  type="text"
                  placeholder="e.g. 150 TR"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  className="w-full text-[10px] py-1 px-2 bg-white border border-gray-200 rounded"
                />
              </div>

              <div>
                <label className="block text-[8px] font-bold text-gray-400 uppercase mb-0.5">Voltagem (Opcional)</label>
                <input
                  type="text"
                  placeholder="e.g. 380V"
                  value={voltage}
                  onChange={(e) => setVoltage(e.target.value)}
                  className="w-full text-[10px] py-1 px-2 bg-white border border-gray-200 rounded"
                />
              </div>
            </div>
          </div>

          {/* Dynamic custom fields section for extraneous excel headers */}
          {customDynamicFields.filter(f => ![
            'CRAAI', 'COMARCA', 'MATERIAL', 'TIPO', 'MARCA', 'MODELO', 'Nº DE SÉRIE', 'STATUS', 'DATA DE AQUISIÇÃO', 'VALOR DE AQUISIÇÃO', 'VALOR LÍQUIDO'
          ].includes(f)).length > 0 && (
            <div className="p-4 bg-indigo-50/25 border border-indigo-100 rounded-xl space-y-3">
              <span className="text-[10px] font-black text-indigo-800 uppercase tracking-widest block">
                Outras Especificações Personalizadas
              </span>
              <div className="grid grid-cols-2 gap-3 text-xs">
                {customDynamicFields.filter(f => ![
                  'CRAAI', 'COMARCA', 'MATERIAL', 'TIPO', 'MARCA', 'MODELO', 'Nº DE SÉRIE', 'STATUS', 'DATA DE AQUISIÇÃO', 'VALOR DE AQUISIÇÃO', 'VALOR LÍQUIDO'
                ].includes(f)).map((field) => (
                  <div key={field}>
                    <label className="block text-[9px] font-bold text-slate-600 uppercase mb-0.5 truncate" title={field}>
                      {field}
                    </label>
                    <input
                      type="text"
                      placeholder={`Inserir ${field}`}
                      value={dynamicFormValues[field] || ''}
                      onChange={(e) => setDynamicFormValues({
                        ...dynamicFormValues,
                        [field]: e.target.value
                      })}
                      className="w-full text-[11px] py-1.5 px-2 bg-white border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 justify-end text-xs pt-3 border-t">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 font-bold disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-[#3525cd] text-white rounded-lg font-bold hover:bg-indigo-700 cursor-pointer shadow disabled:opacity-50"
            >
              {isSubmitting ? 'Cadastrando...' : 'Confirmar Cadastro'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
