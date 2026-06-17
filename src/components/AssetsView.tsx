import React, { useState, useEffect } from 'react';
import { 
  Cpu, 
  History, 
  QrCode, 
  Activity, 
  MapPin, 
  Calendar, 
  CalendarCheck,
  Info, 
  CheckSquare, 
  PlusCircle, 
  Plus, 
  ShieldCheck, 
  Search, 
  Scan,
  Printer,
  ChevronRight,
  Upload,
  FileSpreadsheet,
  Download,
  Check,
  AlertCircle,
  Loader2,
  Edit,
  Trash2
} from 'lucide-react';
import * as XLSX from 'xlsx';
import QRCode from 'qrcode';
import { Asset, MaintenanceLog, formatDateBR, HexonUser, ServiceOrder, Management } from '../types';
import { dbGetAssets, dbGetAssetHistory, dbSaveAsset, dbSaveAssetsBulk, dbAutoGeneratePreventiveActivities, dbDeleteAsset, dbDeleteAssetsBySector, dbGetManagements } from '../db/firebase';

interface AssetsViewProps {
  onSelectScannedAsset: (assetId: string) => void;
  scannedAssetId: string | null;
  clearScannedAsset: () => void;
  userProfile?: HexonUser | null;
  orders?: ServiceOrder[];
  userHasActionPermission?: (actionId: string) => boolean;
}

export default function AssetsView({ 
  onSelectScannedAsset, 
  scannedAssetId, 
  clearScannedAsset,
  userProfile,
  orders = [],
  userHasActionPermission
}: AssetsViewProps) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [history, setHistory] = useState<MaintenanceLog[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSector, setSelectedSector] = useState('Todos');
  const [managements, setManagements] = useState<Management[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showScanSimulator, setShowScanSimulator] = useState(false);
  const [simulatedScanCode, setSimulatedScanCode] = useState('');
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list');

  // Form states for new Asset
  const [newAssetCode, setNewAssetCode] = useState('');
  const [newAssetName, setNewAssetName] = useState('');
  const [newAssetSector, setNewAssetSector] = useState('Mecânica/Refrigeração');
  const [newAssetLocation, setNewAssetLocation] = useState('');
  const [newAssetManufacturer, setNewAssetManufacturer] = useState('');
  const [newAssetModel, setNewAssetModel] = useState('');
  const [newAssetSerial, setNewAssetSerial] = useState('');
  const [newAssetPower, setNewAssetPower] = useState('');
  const [newAssetCapacity, setNewAssetCapacity] = useState('');
  const [newAssetVoltage, setNewAssetVoltage] = useState('');
  const [newAssetPeriodicities, setNewAssetPeriodicities] = useState<('Mensal' | 'Trimestral' | 'Semestral' | 'Anual')[]>(['Mensal']);

  // Dynamic custom fields mapped from XLSX columns
  const [customDynamicFields, setCustomDynamicFields] = useState<string[]>([]);
  const [dynamicFormValues, setDynamicFormValues] = useState<Record<string, string>>({});

  // XLSX Import state variables
  const [showImportModal, setShowImportModal] = useState(false);
  const [importStep, setImportStep] = useState(1); // 1: Upload, 2: Map, 3: Done
  const [importRows, setImportRows] = useState<any[]>([]);
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [columnMappings, setColumnMappings] = useState<Record<string, string>>({});
  const [isProcessingImport, setIsProcessingImport] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [totalToImport, setTotalToImport] = useState(0);
  const [importTargetSector, setImportTargetSector] = useState<string>('Refrigeração');

  // Custom rules mappings for spreadsheet TIPO to Periodicities map
  const [periodicityRules, setPeriodicityRules] = useState<Array<{ keyword: string; selectPeriodicities: ('Mensal' | 'Trimestral' | 'Semestral' | 'Anual')[] }>>(() => {
    try {
      const saved = localStorage.getItem('hexon_periodicity_rules');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.warn('Failed to load periodicity rules:', e);
    }
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
  });
  const [newRuleKeyword, setNewRuleKeyword] = useState('');
  const [newRulePeriodicities, setNewRulePeriodicities] = useState<('Mensal' | 'Trimestral' | 'Semestral' | 'Anual')[]>(['Mensal']);

  // Form states for Editing Asset
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingAssetId, setEditingAssetId] = useState('');
  const [editingAssetCode, setEditingAssetCode] = useState('');
  const [editingAssetName, setEditingAssetName] = useState('');
  const [editingAssetSector, setEditingAssetSector] = useState<string>('Refrigeração');
  const [editingAssetLocation, setEditingAssetLocation] = useState('');
  const [editingAssetManufacturer, setEditingAssetManufacturer] = useState('');
  const [editingAssetModel, setEditingAssetModel] = useState('');
  const [editingAssetSerial, setEditingAssetSerial] = useState('');
  const [editingAssetPower, setEditingAssetPower] = useState('');
  const [editingAssetCapacity, setEditingAssetCapacity] = useState('');
  const [editingAssetVoltage, setEditingAssetVoltage] = useState('');
  const [editingAssetPeriodicities, setEditingAssetPeriodicities] = useState<('Mensal' | 'Trimestral' | 'Semestral' | 'Anual')[]>(['Mensal']);
  const [editingDynamicFormValues, setEditingDynamicFormValues] = useState<Record<string, string>>({});

  // Sector delete states
  const [showSectorDeleteModal, setShowSectorDeleteModal] = useState(false);
  const [sectorToDelete, setSectorToDelete] = useState<string>('Refrigeração');
  const [sectorDeleteConfirmText, setSectorDeleteConfirmText] = useState('');

  // Individual asset delete states
  const [showDeleteAssetModal, setShowDeleteAssetModal] = useState(false);
  const [assetToDelete, setAssetToDelete] = useState<Asset | null>(null);

  // Load assets
  const loadAssetsData = async () => {
    const [list, mList] = await Promise.all([
      dbGetAssets(),
      dbGetManagements()
    ]);

    setManagements(mList);
    if (mList.length > 0) {
      const activeManagements = mList.filter(m => m.name !== 'Todas');
      const defaultName = activeManagements.length > 0 ? activeManagements[0].name : mList[0].name;
      if (newAssetSector === 'Mecânica/Refrigeração' || !mList.some(m => m.name === newAssetSector)) {
        setNewAssetSector(defaultName);
      }
      if (editingAssetSector === 'Refrigeração' || editingAssetSector === 'Mecânica/Refrigeração' || !mList.some(m => m.name === editingAssetSector)) {
        setEditingAssetSector(defaultName);
      }
      if (importTargetSector === 'Refrigeração' || importTargetSector === 'Mecânica/Refrigeração' || !mList.some(m => m.name === importTargetSector)) {
        setImportTargetSector(defaultName);
      }
      if (sectorToDelete === 'Refrigeração' || sectorToDelete === 'Mecânica/Refrigeração' || !mList.some(m => m.name === sectorToDelete)) {
        setSectorToDelete(defaultName);
      }
    }

    let filteredList = [...list];

    // FILTER BASED ON RBAC ROLES DEFINITIONS
    if (userProfile) {
      if (userProfile.perfil === 'Profissional') {
        const assignedCodes = orders
          ? orders.filter(o => o.assignedTechnician === userProfile.name).map(o => o.assetCode)
          : [];
        filteredList = filteredList.filter(a => assignedCodes.includes(a.code));
      } else if (userProfile.perfil === 'Administrador' && userProfile.gerencia && userProfile.gerencia !== 'Todas') {
        const isSectorMatch = (assetSector: string, userGerencia: string) => {
          const s = (assetSector || '').toLowerCase();
          const g = (userGerencia || '').toLowerCase();
          if (s === g) return true;
          if (g === 'refrigeração') return s.includes('refr') || s.includes('hvac');
          if (g === 'elétrica') return s.includes('eletri') || s.includes('eletrô');
          if (g === 'civil' || g === 'predial') return s.includes('civil') || s.includes('hidr') || s.includes('predial');
          return s.includes(g) || g.includes(s);
        };
        filteredList = filteredList.filter(a => isSectorMatch(a.sector, userProfile.gerencia));
      }
    }

    setAssets(filteredList);
    
    // Auto-select first asset if none is selected
    if (filteredList.length > 0 && !selectedAsset) {
      setSelectedAsset(filteredList[0]);
    }
  };

  useEffect(() => {
    loadAssetsData();
    const stored = localStorage.getItem('HEXON_CUSTOM_FIELDS');
    if (stored) {
      try {
        setCustomDynamicFields(JSON.parse(stored));
      } catch (e) {
        console.warn('Erro ao carregar campos personalizados salvos:', e);
      }
    }
  }, [userProfile, orders]);

  // Update selected asset and load history when selection shifts
  useEffect(() => {
    if (selectedAsset) {
      dbGetAssetHistory(selectedAsset.id).then((hist) => {
        setHistory(hist);
      });
    }
  }, [selectedAsset]);

  // Handle external QR code scanning triggers from App routing
  useEffect(() => {
    if (scannedAssetId && assets.length > 0) {
      const match = assets.find(a => a.id === scannedAssetId);
      if (match) {
        setSelectedAsset(match);
        setMobileView('detail');
      }
    }
  }, [scannedAssetId, assets]);

  // Edit and Delete handler functions
  const handleOpenEditModal = (asset: Asset) => {
    if (userHasActionPermission && !userHasActionPermission('create_asset')) {
      alert('Acesso Restrito: Seu perfil de usuário não tem autorização para cadastrar ou editar ativos.');
      return;
    }
    setEditingAssetId(asset.id);
    setEditingAssetCode(asset.code);
    setEditingAssetName(asset.name);
    const activeManagements = managements.filter(m => m.name !== 'Todas');
    const defaultSec = activeManagements.length > 0 ? activeManagements[0].name : 'Civil';
    setEditingAssetSector(asset.sector || defaultSec);
    setEditingAssetLocation(asset.location);
    setEditingAssetManufacturer(asset.specs?.manufacturer || asset.specs?.MARCA || '');
    setEditingAssetModel(asset.specs?.model || asset.specs?.MODELO || '');
    setEditingAssetSerial(asset.specs?.serialNumber || asset.specs?.['Nº DE SÉRIE'] || '');
    setEditingAssetPower(asset.specs?.power || '');
    setEditingAssetCapacity(asset.specs?.capacity || '');
    setEditingAssetVoltage(asset.specs?.voltage || '');
    setEditingAssetPeriodicities(asset.periodicities || []);
    setEditingDynamicFormValues(asset.specs || {});
    setShowEditModal(true);
  };

  const handleUpdateAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAssetCode || !editingAssetName || !editingAssetLocation) {
      alert('Por favor, preencha todos os campos obrigatórios (Código, Nome, Localização).');
      return;
    }

    try {
      const nowString = new Date().toISOString();
      const updatedSpecs = {
        ...editingDynamicFormValues,
        manufacturer: editingAssetManufacturer,
        model: editingAssetModel,
        serialNumber: editingAssetSerial,
        power: editingAssetPower,
        capacity: editingAssetCapacity,
        voltage: editingAssetVoltage,
        STATUS: editingDynamicFormValues['STATUS'] || 'Operando',
        'DATA DE AQUISIÇÃO': editingDynamicFormValues['DATA DE AQUISIÇÃO'] || nowString.split('T')[0],
        'VALOR DE AQUISIÇÃO': editingDynamicFormValues['VALOR DE AQUISIÇÃO'] || '0,00',
        'VALOR LÍQUIDO': editingDynamicFormValues['VALOR LÍQUIDO'] || '0,00'
      };

      const updatedAsset: Asset = {
        id: editingAssetId,
        code: editingAssetCode.trim().toUpperCase(),
        name: editingAssetName.trim(),
        sector: editingAssetSector,
        location: editingAssetLocation.trim(),
        status: (editingDynamicFormValues['STATUS'] as any) || 'Operando',
        specs: updatedSpecs,
        createdAt: selectedAsset?.createdAt || nowString,
        updatedAt: nowString,
        periodicities: editingAssetPeriodicities,
        qrCode: selectedAsset?.qrCode
      };

      await dbSaveAsset(updatedAsset);
      
      const allAssets = await dbGetAssets();
      setAssets(allAssets);
      setSelectedAsset(updatedAsset);
      setShowEditModal(false);
      alert('Equipamento atualizado com sucesso no banco de dados!');
    } catch (err) {
      console.error(err);
      alert('Erro ao atualizar equipamento.');
    }
  };

  const handleDeleteAssetTrigger = (asset: Asset) => {
    if (userHasActionPermission && !userHasActionPermission('delete_asset')) {
      alert('Acesso Restrito: Seu perfil de usuário não tem autorização para deletar ativos.');
      return;
    }
    setAssetToDelete(asset);
    setShowDeleteAssetModal(true);
  };

  // Filter assets matching inputs
  const filteredAssets = assets.filter((asset) => {
    const matchesSearch =
      asset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      asset.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      asset.location.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (asset.specs?.COMARCA || asset.specs?.comarca || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesSector = selectedSector === 'Todos' || asset.sector === selectedSector;
    return matchesSearch && matchesSector;
  });

  // Handle asset creation
  const handleCreateAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAssetCode || !newAssetName || !newAssetLocation) {
      alert('Por favor, preencha os campos obrigatórios (Código, Nome, Localização).');
      return;
    }

    const uniqueId = `as_${newAssetSector.toLowerCase()}_${Date.now().toString().slice(-4)}`;
    
    // Generate QR Code offline using the imported qrcode library
    let qrCodeBase64 = '';
    try {
      qrCodeBase64 = await QRCode.toDataURL(`HEXON_PREVENTIVA_ASSET_ID_${uniqueId}`);
    } catch (qrErr) {
      console.warn('Falha ao gerar QR Code base64:', qrErr);
    }

    const statusVal = dynamicFormValues['STATUS'] || 'Operando';
    const acqDateVal = dynamicFormValues['DATA DE AQUISIÇÃO'] || new Date().toISOString().split('T')[0];

    const manualSpecs: any = {
      manufacturer: newAssetManufacturer.trim() || '',
      model: newAssetModel.trim() || '',
      serialNumber: newAssetSerial.trim() || '',
      installationDate: acqDateVal,
      status: statusVal,
      acquisitionValue: dynamicFormValues['VALOR DE AQUISIÇÃO'] || '',
      netValue: dynamicFormValues['VALOR LÍQUIDO'] || '',
      craai: dynamicFormValues['CRAAI'] || '',
      comarca: dynamicFormValues['COMARCA'] || '',
      material: newAssetName.trim(),
      tipo: dynamicFormValues['TIPO'] || '',
      power: newAssetPower.trim() || undefined,
      capacity: newAssetCapacity.trim() || undefined,
      voltage: newAssetVoltage.trim() || undefined,
      warrantyUntil: undefined
    };

    customDynamicFields.forEach((field) => {
      if (dynamicFormValues[field] !== undefined && dynamicFormValues[field].trim() !== '') {
        manualSpecs[field] = dynamicFormValues[field].trim();
      }
    });

    const preparedAsset: Asset = {
      id: uniqueId,
      code: newAssetCode.trim().toUpperCase(),
      name: newAssetName.trim(),
      sector: newAssetSector,
      location: newAssetLocation.trim(),
      status: statusVal as any,
      specs: manualSpecs,
      createdAt: new Date().toISOString(),
      periodicities: newAssetPeriodicities,
      qrCode: qrCodeBase64 || undefined
    };

    try {
      await dbSaveAsset(preparedAsset);
      
      alert('Novo ativo cadastrado com sucesso!');
      setShowAddModal(false);
      
      // Reset form
      setNewAssetCode('');
      setNewAssetName('');
      setNewAssetLocation('');
      setNewAssetManufacturer('');
      setNewAssetModel('');
      setNewAssetSerial('');
      setNewAssetPower('');
      setNewAssetCapacity('');
      setNewAssetVoltage('');
      setNewAssetPeriodicities(['Mensal']);
      setDynamicFormValues({});

      // Reload
      await loadAssetsData();
      // Select the new one immediately
      setSelectedAsset(preparedAsset);
    } catch (err) {
      console.error(err);
      alert('Erro ao persistir ativo.');
    }
  };

  // Process Excel/XLSX file upload
  const handleXLSXFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet) as any[];

        if (rows.length === 0) {
          alert('A planilha importada parece estar sem dados.');
          return;
        }

        setImportRows(rows);
        
        // Track the column headers
        const headers = Object.keys(rows[0]);
        setImportHeaders(headers);

        // Best effort automatic mappings
        const autoMap: Record<string, string> = {};
        headers.forEach((h) => {
          const lower = h.toLowerCase().trim();
          if (lower === 'patrimônio' || lower === 'patrimonio' || lower === 'codigo' || lower === 'código' || lower === 'tag' || lower === 'id' || lower === 'code') {
            autoMap['code'] = h; // PATRIMÔNIO
          } else if (lower === 'endereço' || lower === 'endereco' || lower === 'local' || lower === 'localização' || lower === 'localizacao' || lower === 'location') {
            autoMap['location'] = h; // ENDEREÇO
          } else if (lower === 'craai') {
            autoMap['craai'] = h; // CRAAI
          } else if (lower === 'comarca') {
            autoMap['comarca'] = h; // COMARCA
          } else if (lower === 'material' || lower === 'nome' || lower === 'equipamento' || lower === 'name' || lower === 'asset') {
            autoMap['name'] = h; // MATERIAL
          } else if (lower === 'tipo' || lower === 'type' || lower === 'categoria') {
            autoMap['tipo'] = h; // TIPO
          } else if (lower === 'marca' || lower === 'fabricante' || lower === 'manufacturer' || lower === 'brand') {
            autoMap['manufacturer'] = h; // MARCA
          } else if (lower === 'modelo' || lower === 'model') {
            autoMap['model'] = h; // MODELO
          } else if (lower === 'nº de série' || lower === 'numero de serie' || lower === 'série' || lower === 'serie' || lower === 'serial' || lower === 'n_serie' || lower === 'nº') {
            autoMap['serialNumber'] = h; // Nº DE SÉRIE
          } else if (lower === 'status' || lower === 'estado' || lower === 'situação' || lower === 'situacao') {
            autoMap['status'] = h; // STATUS
          } else if (lower === 'data de aquisição' || lower === 'data de aquisicao' || lower === 'aquisição' || lower === 'aquisicao' || lower === 'compra' || lower === 'data_aquisicao' || lower === 'installationdate') {
            autoMap['installationDate'] = h; // DATA DE AQUISIÇÃO
          } else if (lower === 'valor de aquisição' || lower === 'valor de aquisicao' || lower === 'valor_aquisicao' || lower === 'custo') {
            autoMap['acquisitionValue'] = h; // VALOR DE AQUISIÇÃO
          } else if (lower === 'valor líquido' || lower === 'valor liquido' || lower === 'valor_liquido' || lower === 'liquido') {
            autoMap['netValue'] = h; // VALOR LÍQUIDO
          }
        });

        // Set fallbacks for empty map
        if (!autoMap['code']) autoMap['code'] = headers.find(h => h.toLowerCase().includes('patrimonio') || h.toLowerCase().includes('patrimônio') || h.toLowerCase().includes('codigo') || h.toLowerCase().trim() === 'id') || headers[0] || '';
        if (!autoMap['name']) autoMap['name'] = headers.find(h => h.toLowerCase().includes('material') || h.toLowerCase().includes('nome') || h.toLowerCase().includes('equip')) || headers[1] || '';
        if (!autoMap['location']) autoMap['location'] = headers.find(h => h.toLowerCase().includes('endereco') || h.toLowerCase().includes('endereço') || h.toLowerCase().includes('local')) || headers[2] || '';

        setColumnMappings(autoMap);
        setImportStep(2); // Go to mapping step
      } catch (err) {
        console.error('Erro de análise XLSX:', err);
        alert('Ocorreu um erro ao processar o arquivo XLSX. Verifique se o arquivo está correto.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Bulk import mapped assets and auto generate QRCodes and Preventives
  const handleConfirmXLSXImport = async () => {
    // Validate mappings - patrimonio and material are the minimum core fields
    if (!columnMappings['code'] || !columnMappings['name']) {
      alert('Por favor, selecione as colunas de Patrimônio (Código) e Material (Nome) do Ativo para prosseguir.');
      return;
    }

    setIsProcessingImport(true);
    setImportProgress(0);
    setTotalToImport(importRows.length);

    try {
      const parsedAssets: Asset[] = [];
      const nowString = new Date().toISOString();

      // Core helper function to extract periodicities from TIPO keyword using dynamic mapping rules
      const getPeriodicitiesFromTipo = (tipoVal: string): ('Mensal' | 'Trimestral' | 'Semestral' | 'Anual')[] => {
        const t = (tipoVal || '').toLowerCase().trim();

        // 1. Check custom user rules mappings first (case-insensitive keyword matching)
        if (periodicityRules && periodicityRules.length > 0) {
          const match = periodicityRules.find(r => {
            const kw = r.keyword.toLowerCase().trim();
            // Match any of: keyword is equal, or type column value contains keyword, or keyword contains type column value
            return t === kw || t.includes(kw) || kw.includes(t);
          });
          if (match && match.selectPeriodicities.length > 0) {
            return match.selectPeriodicities;
          }
        }

        // 2. Generic default parsing based on containing terms
        const result: ('Mensal' | 'Trimestral' | 'Semestral' | 'Anual')[] = [];
        if (t.includes('mensal') || t.includes('mensais') || t.includes('mês') || t.includes('mes')) {
          result.push('Mensal');
        }
        if (t.includes('trimestral') || t.includes('trimestrais') || t.includes('3 meses')) {
          result.push('Trimestral');
        }
        if (t.includes('semestral') || t.includes('semestrais') || t.includes('6 meses')) {
          result.push('Semestral');
        }
        if (t.includes('anual') || t.includes('anuais') || t.includes('ano')) {
          result.push('Anual');
        }
        if (result.length > 0) {
          return result;
        }

        // 3. Fallback keywords matching for technical schedule automatic implementation
        if (t.includes('acj')) {
          return ['Mensal', 'Semestral'];
        }
        if (t.includes('arcondicionado') || t.includes('ar condicionado') || t.includes('chiller') || t.includes('split') || t.includes('clima') || t.includes('fancoil') || t.includes('fan coil') || t.includes('hvac') || t.includes('refrigeração') || t.includes('refrigeracao')) {
          return ['Mensal', 'Semestral', 'Anual']; // PMOC standard
        }
        if (t.includes('quadro') || t.includes('eléct') || t.includes('elétr') || t.includes('disjuntor') || t.includes('gerador') || t.includes('nobreak') || t.includes('subestação') || t.includes('transformador')) {
          return ['Mensal', 'Trimestral', 'Anual']; // Electrical standard updated as requested
        }
        if (t.includes('bomba') || t.includes('hidráu') || t.includes('caixa') || t.includes('reservatório') || t.includes('cisterna')) {
          return ['Mensal', 'Semestral']; // Plumbing standard
        }
        if (t.includes('extintor') || t.includes('hidrante') || t.includes('alarme') || t.includes('incêndio')) {
          return ['Mensal', 'Anual']; // Fire/safety standard
        }
        if (t.includes('predial') || t.includes('civil') || t.includes('telhado') || t.includes('porta') || t.includes('pintura')) {
          return ['Semestral', 'Anual']; // Civil architecture standard
        }

        return ['Mensal']; // default fallback
      };

      // Helper to translate Excel Serial number or DD/MM/YYYY into YYYY-MM-DD
      const parseExcelDateValue = (val: any): string => {
        if (val === undefined || val === null || String(val).trim() === '') {
          return nowString.split('T')[0];
        }
        if (val instanceof Date) {
          if (!isNaN(val.getTime())) {
            return val.toISOString().split('T')[0];
          }
        }
        const str = String(val).trim();
        const num = Number(str);
        if (!isNaN(num) && num > 10000 && num < 100000) {
          // Excel serial dates: 25569 is Jan 1, 1970
          const jsDate = new Date(Math.round((num - 25569) * 86400 * 1000));
          if (!isNaN(jsDate.getTime())) {
            return jsDate.toISOString().split('T')[0];
          }
        }
        
        // DD/MM/YYYY
        const ddmmyyyy = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
        if (ddmmyyyy) {
          const day = ddmmyyyy[1].padStart(2, '0');
          const month = ddmmyyyy[2].padStart(2, '0');
          const year = ddmmyyyy[3];
          return `${year}-${month}-${day}`;
        }

        // YYYY-MM-DD
        const yyyymmdd = str.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
        if (yyyymmdd) {
          const year = yyyymmdd[1];
          const month = yyyymmdd[2].padStart(2, '0');
          const day = yyyymmdd[3].padStart(2, '0');
          return `${year}-${month}-${day}`;
        }

        // Native date constructor but safe
        const parsed = new Date(str);
        if (!isNaN(parsed.getTime())) {
          return parsed.toISOString().split('T')[0];
        }

        return str;
      };

      for (let i = 0; i < importRows.length; i++) {
        setImportProgress(i + 1);
        const row = importRows[i];

        const rawCode = String(row[columnMappings['code']] || '').trim();
        const rawName = String(row[columnMappings['name']] || '').trim();
        if (!rawCode || !rawName) continue;

        // Extract location (ENDEREÇO)
        const rawLocation = columnMappings['location'] ? String(row[columnMappings['location']] || '').trim() : 'Ambiente Geral';

        // Extract CRAAI, COMARCA, TIPO, MARCA, MODELO, Nº DE SÉRIE, STATUS, DATA DE AQUISIÇÃO, VALOR DE AQUISIÇÃO, VALOR LÍQUIDO
        const rawCRAAI = columnMappings['craai'] ? String(row[columnMappings['craai']] || '').trim() : 'Não informado';
        const rawComarca = columnMappings['comarca'] ? String(row[columnMappings['comarca']] || '').trim() : 'Não informado';
        const rawTipo = columnMappings['tipo'] ? String(row[columnMappings['tipo']] || '').trim() : 'Outros';
        const rawMarca = columnMappings['manufacturer'] ? String(row[columnMappings['manufacturer']] || '').trim() : 'Não informado';
        const rawModelo = columnMappings['model'] ? String(row[columnMappings['model']] || '').trim() : 'Não informado';
        const rawSerie = columnMappings['serialNumber'] ? String(row[columnMappings['serialNumber']] || '').trim() : 'N/A';
        const rawDataAquisicaoRaw = columnMappings['installationDate'] ? row[columnMappings['installationDate']] : nowString.split('T')[0];
        const rawDataAquisicao = parseExcelDateValue(rawDataAquisicaoRaw);
        const rawValorAquisicao = columnMappings['acquisitionValue'] ? String(row[columnMappings['acquisitionValue']] || '').trim() : '0,00';
        const rawValorLiquido = columnMappings['netValue'] ? String(row[columnMappings['netValue']] || '').trim() : '0,00';

        // Extract status
        let rawStatus: 'Operando' | 'Em Manutenção' | 'Parado' = 'Operando';
        if (columnMappings['status'] && row[columnMappings['status']]) {
          const sVal = String(row[columnMappings['status']]).toLowerCase();
          if (sVal.includes('manuten') || sVal.includes('manutencao')) {
            rawStatus = 'Em Manutenção';
          } else if (sVal.includes('parado') || sVal.includes('inativo')) {
            rawStatus = 'Parado';
          }
        }

        // Determine periodicities from TIPO keyword automatically
        const pArray = getPeriodicitiesFromTipo(rawTipo);

        // Generate ID based on selected target sector
        const formattedSectorName = importTargetSector.toLowerCase().replace('/', '_');
        const uniqueId = `as_${formattedSectorName}_${Date.now().toString().slice(-4)}_${Math.random().toString(36).substring(2, 6)}`;
        
        // Generate QR code base64 completely offline
        let qrCodeB64 = '';
        try {
          qrCodeB64 = await QRCode.toDataURL(`HEXON_PREVENTIVA_ASSET_ID_${uniqueId}`);
        } catch (e) {
          console.warn('QR code generation failed on import row:', rawCode);
        }

        // Prepare specs mapping standard properties as well as user specific fields for total consistency
        const assetSpecs: any = {
          manufacturer: rawMarca,
          model: rawModelo,
          serialNumber: rawSerie,
          installationDate: rawDataAquisicao.split('T')[0],
          
          // User exact spreadsheet columns saved in specs:
          CRAAI: rawCRAAI,
          COMARCA: rawComarca,
          MATERIAL: rawName,
          TIPO: rawTipo,
          MARCA: rawMarca,
          MODELO: rawModelo,
          'Nº DE SÉRIE': rawSerie,
          STATUS: rawStatus,
          'DATA DE AQUISIÇÃO': rawDataAquisicao,
          'VALOR DE AQUISIÇÃO': rawValorAquisicao,
          'VALOR LÍQUIDO': rawValorLiquido
        };

        const newAsset: Asset = {
          id: uniqueId,
          code: rawCode.toUpperCase(),
          name: rawName,
          sector: importTargetSector,
          location: rawLocation,
          status: rawStatus,
          specs: assetSpecs,
          createdAt: nowString,
          periodicities: pArray,
          qrCode: qrCodeB64 || undefined
        };

        parsedAssets.push(newAsset);
      }

      if (parsedAssets.length === 0) {
        alert('Nenhum ativo válido pôde ser extraído da planilha.');
        setIsProcessingImport(false);
        return;
      }

      // Save chunk in database
      await dbSaveAssetsBulk(parsedAssets);

      // Save dynamic custom fields from import headers so manual creation forms follow same format
      const defaultFields = [
        'CRAAI',
        'COMARCA',
        'MATERIAL',
        'TIPO',
        'MARCA',
        'MODELO',
        'Nº DE SÉRIE',
        'STATUS',
        'DATA DE AQUISIÇÃO',
        'VALOR DE AQUISIÇÃO',
        'VALOR LÍQUIDO'
      ];
      localStorage.setItem('HEXON_CUSTOM_FIELDS', JSON.stringify(defaultFields));
      setCustomDynamicFields(defaultFields);

      setImportStep(3); // Success Screen step
      await loadAssetsData();
      
      // Auto select the first newly imported asset physically
      if (parsedAssets.length > 0) {
        setSelectedAsset(parsedAssets[0]);
      }

    } catch (err) {
      console.error('Import error:', err);
      alert('Houve um erro técnico realizando a gravação em lote. Entre em contato com o suporte.');
    } finally {
      setIsProcessingImport(false);
    }
  };

  // Simulated QR scanner action
  const handleSimulateScan = () => {
    if (!simulatedScanCode.trim()) {
      alert('Selecione ou insira um código de ativo para scan.');
      return;
    }

    const match = assets.find(
      (a) => a.code.toLowerCase() === simulatedScanCode.toLowerCase() || a.id === simulatedScanCode
    );

    if (match) {
      setSelectedAsset(match);
      onSelectScannedAsset(match.id);
      setShowScanSimulator(false);
      setSimulatedScanCode('');
      setMobileView('detail');
      alert(`🔍 QR CODE VALIDADO!\nEquipamento: ${match.name}\nExibindo ficha técnica e histórico.`);
    } else {
      alert('Código QR não correspondente no cadastro Hexon.');
    }
  };

  // Trigger quick scan from QR image click
  const triggerQuickScan = (asset: Asset) => {
    setSelectedAsset(asset);
    onSelectScannedAsset(asset.id);
    setMobileView('detail');
  };

  return (
    <div className="font-sans space-y-6">
      
      {/* 1. SECTOR SUMMARY CARDS (RESUMO DO INVENTÁRIO DO LADO DE FORA) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {/* Card Total */}
        <div 
          id="summary-card-total" 
          onClick={() => setSelectedSector('Todos')}
          className={`p-4 rounded-2xl border transition-all duration-150 cursor-pointer flex items-center gap-4 ${
            selectedSector === 'Todos' 
              ? 'bg-[#0b1c30] text-white border-slate-800 shadow-md scale-102 ring-1 ring-indigo-500' 
              : 'bg-white text-slate-800 border-gray-200 shadow-sm hover:shadow-md hover:-translate-y-0.5'
          }`}
        >
          <div className={`p-2.5 rounded-xl shrink-0 ${selectedSector === 'Todos' ? 'bg-white/10 text-white' : 'bg-[#0b1c30]/10 text-[#0b1c30]'}`}>
            <Cpu className="w-5 h-5 text-indigo-300" />
          </div>
          <div className="min-w-0 flex-1">
            <span className={`text-[10px] font-extrabold uppercase tracking-widest block truncate ${selectedSector === 'Todos' ? 'text-gray-300' : 'text-gray-400'}`}>Total do Inventário</span>
            <span className="text-2xl font-black block mt-0.5">{assets.length} <span className="text-xs font-normal opacity-70">ativos</span></span>
          </div>
        </div>

        {/* Dynamic Sector Cards */}
        {managements.filter(m => m.name !== 'Todas').map((m, idx) => {
          // Choose icon and color scheme based on index
          const iconColors = [
            { bg: 'bg-blue-50 text-blue-600', text: 'text-blue-600', icon: Activity },
            { bg: 'bg-emerald-50 text-emerald-600', text: 'text-emerald-600', icon: ShieldCheck },
            { bg: 'bg-amber-50 text-amber-600', text: 'text-amber-600', icon: MapPin },
            { bg: 'bg-purple-50 text-purple-600', text: 'text-purple-600', icon: Calendar },
            { bg: 'bg-rose-50 text-rose-600', text: 'text-rose-600', icon: History }
          ];
          const colorSet = iconColors[idx % iconColors.length];
          const IconComponent = colorSet.icon;
          const isSelected = selectedSector === m.name;
          const assetCount = assets.filter(a => a.sector === m.name).length;

          return (
            <div 
              key={m.id}
              id={`summary-card-${m.id}`}
              onClick={() => setSelectedSector(isSelected ? 'Todos' : m.name)}
              className={`p-4 rounded-2xl border transition-all duration-150 cursor-pointer flex items-center gap-4 ${
                isSelected 
                  ? 'bg-slate-800 text-white border-slate-700 shadow-md scale-102 ring-1 ring-slate-600' 
                  : 'bg-white text-slate-800 border-gray-200 shadow-sm hover:shadow-md hover:-translate-y-0.5'
              }`}
            >
              <div className={`p-2.5 rounded-xl shrink-0 ${isSelected ? 'bg-white/10 text-white' : colorSet.bg}`}>
                <IconComponent className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <span className={`text-[10px] font-extrabold uppercase tracking-widest block truncate ${isSelected ? 'text-gray-200' : 'text-gray-400'}`} title={m.name}>{m.name}</span>
                <span className="text-2xl font-black block mt-0.5">{assetCount} <span className="text-xs font-normal opacity-70">ativos</span></span>
              </div>
            </div>
          );
        })}
      </div>

      {/* OPERATIONS TOOLBAR */}
      <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-sm font-black text-slate-800 uppercase tracking-wider">Ações e Operações do Inventário</h2>
          <p className="text-[10px] text-slate-400 mt-0.5 font-medium">Cadastre novos equipamentos, remova em lote, importe planilhas ou simule a leitura de QR Code.</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <button
            onClick={() => {
              if (userHasActionPermission && !userHasActionPermission('delete_asset')) {
                alert('Acesso Restrito: Seu perfil de usuário não tem autorização para remover ativos em lote.');
                return;
              }
              setShowSectorDeleteModal(true);
            }}
            className="p-2 px-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl hover:bg-rose-100 transition-colors flex items-center gap-1.5 text-xs font-black cursor-pointer shadow-xs"
            title="Limpar todos os ativos por setor"
          >
            <Trash2 className="w-4 h-4 text-rose-600 animate-pulse" />
            Limpar Setor
          </button>

          <button
            onClick={() => {
              if (userHasActionPermission && !userHasActionPermission('import_assets')) {
                alert('Acesso Restrito: Seu perfil de usuário não tem autorização para importar planilhas de ativos.');
                return;
              }
              setImportStep(1);
              setShowImportModal(true);
            }}
            className="p-2 px-3 bg-emerald-50 border border-emerald-100 text-emerald-800 rounded-xl hover:bg-emerald-100 transition-colors flex items-center gap-1.5 text-xs font-black cursor-pointer shadow-xs"
            title="Importar de Planilha .XLSX"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            Planilha Excel
          </button>

          <button
            onClick={() => setShowScanSimulator(true)}
            className="p-2 px-3 bg-indigo-50 border border-indigo-150 text-[#3525cd] rounded-xl hover:bg-indigo-100 transition-colors flex items-center gap-1.5 text-xs font-black cursor-pointer shadow-xs"
            title="Simulador de Scanner"
          >
            <Scan className="w-4 h-4" />
            Escanear QR
          </button>
          
          <button
            onClick={() => {
              if (userHasActionPermission && !userHasActionPermission('create_asset')) {
                alert('Acesso Restrito: Seu perfil de usuário não tem autorização para cadastrar novos ativos.');
                return;
              }
              setShowAddModal(true);
            }}
            className="p-2 px-3.5 bg-[#3525cd] text-white rounded-xl hover:bg-opacity-95 transition-all text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-md"
          >
            <Plus className="w-4 h-4 text-white" />
            Novo Ativo
          </button>
        </div>
      </div>

      {/* 2. MAIN LAYOUT GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* LEFT COLUMN: Assets Catalog List */}
        <div id="assets-catalog-column" className={`lg:col-span-1 bg-white rounded-2xl border border-gray-200 shadow-sm flex flex-col h-[calc(100vh-18rem)] min-h-[500px] overflow-hidden ${
          mobileView === 'list' ? 'flex' : 'hidden lg:flex'
        }`}>
          {/* Header toolbar */}
          <div className="p-4 border-b border-gray-100 space-y-3 shrink-0">
            <div className="flex items-center justify-between gap-1">
              <h3 className="font-extrabold text-[#0b1c30] text-xs uppercase tracking-wider flex items-center gap-1.5 shrink-0">
                <Cpu className="w-4 h-4 text-[#3525cd]" />
                Catálogo de Ativos
              </h3>
            </div>

            {/* Search bar & Sector filter */}
            <div className="space-y-2">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar ativo, código ou local..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full text-xs py-2 bg-gray-50 border border-gray-200 rounded-lg pl-9 pr-3 text-gray-800 font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-1.5 text-xs bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                <span className="text-[9px] text-gray-400 uppercase font-extrabold tracking-wide shrink-0">Filtrar Setor:</span>
                <select
                  value={selectedSector}
                  onChange={(e) => setSelectedSector(e.target.value)}
                  className="w-full text-[11px] py-0.5 px-2 bg-white border border-gray-200 rounded-sm focus:outline-none font-bold text-slate-700"
                >
                  <option value="Todos">Todos os Setores</option>
                  {managements.filter(m => m.name !== 'Todas').map((m) => (
                    <option key={m.id} value={m.name}>{m.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Dynamic Asset Card stack */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50/20">
            {assets.length === 0 ? (
              <div className="p-6 text-center space-y-4">
                <div className="w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center mx-auto text-[#3525cd]">
                  <FileSpreadsheet className="w-6 h-6" />
                </div>
                <h4 className="font-bold text-sm text-[#0b1c30]">Nenhum ativo cadastrado</h4>
                <p className="text-xs text-gray-500 leading-normal">
                  Alimente seu banco de dados enviando uma planilha Excel ou cadastrando um ativo manualmente.
                </p>
                <div className="pt-2 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setImportStep(1);
                      setShowImportModal(true);
                    }}
                    className="w-full py-2 bg-[#3525cd] text-white rounded-lg text-xs font-bold hover:bg-opacity-95 transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Upload className="w-4 h-4" />
                    Carregar Planilha .XLSX
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddModal(true)}
                    className="w-full py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-xs font-bold hover:bg-gray-50 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    Cadastrar Manualmente
                  </button>
                </div>
              </div>
            ) : filteredAssets.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-xs font-semibold">
                Nenhum ativo correspondente para "{searchQuery}".
              </div>
            ) : (
              filteredAssets.map((asset) => {
                const isSelected = selectedAsset?.id === asset.id;
                
                // Color codes visually based on sector
                let accentBorder = 'border-l-indigo-400';
                let sectorBg = 'bg-indigo-50 text-indigo-750';
                if (asset.sector === 'Mecânica/Refrigeração' || asset.sector === 'HVAC') {
                  accentBorder = 'border-l-blue-500';
                  sectorBg = 'bg-blue-50 text-blue-700';
                } else if (asset.sector === 'Elétrica/Eletrônica' || asset.sector === 'Elétrica') {
                  accentBorder = 'border-l-emerald-500';
                  sectorBg = 'bg-emerald-50 text-emerald-700';
                } else if (asset.sector === 'Civil' || asset.sector === 'Hidráulica') {
                  accentBorder = 'border-l-amber-500';
                  sectorBg = 'bg-amber-50 text-amber-700';
                }

                return (
                  <div
                    key={asset.id}
                    onClick={() => {
                      setSelectedAsset(asset);
                      setMobileView('detail');
                    }}
                    className={`p-4.5 rounded-xl border-y border-r border-l-4 transition-all cursor-pointer flex flex-col justify-between relative overflow-hidden group ${accentBorder} ${
                      isSelected
                        ? 'bg-indigo-50/10 border-indigo-200 shadow-md ring-1 ring-[#3525cd]/15'
                        : 'bg-white border-gray-100 shadow-xs hover:border-gray-200 hover:shadow-sm'
                    }`}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0">
                        <span className="text-[9px] font-mono font-bold text-gray-400 block mb-1 tracking-wider uppercase">
                          {asset.code}
                        </span>
                        <h4 className="font-extrabold text-xs text-[#0b1c30] group-hover:text-[#3525cd] transition-colors leading-snug break-words">
                          {asset.name}
                        </h4>
                      </div>

                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded whitespace-nowrap overflow-hidden shrink-0 ${sectorBg}`}>
                        {asset.sector}
                      </span>
                    </div>

                    <div className="flex justify-between items-start mt-4 pt-3 border-t border-gray-100 text-[11px] text-gray-400 gap-3">
                      <span className="flex items-start gap-1 font-bold text-slate-600 min-w-0 flex-1">
                        <MapPin className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5" />
                        <span className="break-words leading-tight" title="Comarca">
                          {asset.specs?.COMARCA || asset.specs?.comarca || asset.location.split(' - ')[0]}
                        </span>
                      </span>

                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[9px] font-black uppercase tracking-wider shrink-0 shadow-xs mt-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        {asset.status || 'Operando'}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
      </div>

      {/* RIGHT TWO COLUMNS: Info Panel (Technical sheet + QR Code + Maintenance history) */}
      <div className={`lg:col-span-2 space-y-6 h-[calc(100vh-13rem)] overflow-y-auto pr-1 ${
        mobileView === 'detail' ? 'block' : 'hidden lg:block'
      }`}>
        
        {selectedAsset ? (
          <>
            {/* Back button for mobile display */}
            <div className="lg:hidden flex items-center justify-start">
              <button 
                onClick={() => setMobileView('list')}
                className="py-2.5 px-4 bg-white border border-gray-200 text-[#0b1c30] text-xs font-black rounded-xl flex items-center gap-2 transition-all cursor-pointer shadow-sm hover:bg-gray-50 active:scale-95"
              >
                <ChevronRight className="w-4 h-4 rotate-180 text-gray-600" />
                VOLTAR AO CATÁLOGO
              </button>
            </div>

            {/* TOP BLOCK: Main Details & QR Scan container */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 relative">
              <div className="flex flex-col md:flex-row justify-between items-start gap-6">
                
                {/* Visual Technical Asset Identity */}
                <div className="flex-1 space-y-4">
                  <div>
                    <div className="flex items-center justify-between gap-4 flex-wrap mb-1.5 w-full">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded border border-indigo-100">
                          {selectedAsset.sector}
                        </span>
                        <span className="text-xs font-mono font-bold text-gray-400 uppercase tracking-widest">
                          REF ATIVO: {selectedAsset.code}
                        </span>
                      </div>
                      
                      {/* EDIT & DELETE INDIVIDUAL ACTIONS */}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleDeleteAssetTrigger(selectedAsset)}
                          className="py-1 px-2 bg-rose-550/10 hover:bg-rose-100 border border-rose-200 hover:border-rose-400 text-[9px] font-black text-rose-700 rounded-lg flex items-center gap-1 transition-all cursor-pointer"
                          title="Excluir este ativo definitivamente"
                        >
                          <Trash2 className="w-2.5 h-2.5 text-rose-600" />
                          EXCLUIR
                        </button>
                      </div>
                    </div>
                    <h2 className="text-2xl font-black text-[#0b1c30] tracking-tight">{selectedAsset.name}</h2>
                    <p className="text-xs text-gray-400 flex items-center gap-1.5 mt-1">
                      <MapPin className="w-3.5 h-3.5 text-slate-400" />
                      {selectedAsset.location}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-2">
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <span className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Fabricante</span>
                      <span className="text-xs font-bold text-[#0b1c30]">{selectedAsset.specs.manufacturer}</span>
                    </div>

                    <div className="p-3 bg-gray-50 rounded-lg">
                      <span className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Modelo / Tipo</span>
                      <span className="text-xs font-bold text-[#0b1c30]">{selectedAsset.specs.model}</span>
                    </div>
                  </div>


                </div>

                {/* QR Code Identification Block */}
                {/* Every asset must possess a QR code for quick access to history and specs */}
                <div className="w-full md:w-auto p-4 border border-indigo-100 bg-indigo-50/20 rounded-xl flex flex-col items-center justify-center shrink-0 text-center gap-2">
                  <div className="bg-white p-2.5 rounded-lg shadow-sm border border-indigo-100 relative group cursor-pointer" title="Clique para simular leitura QR rápido" onClick={() => triggerQuickScan(selectedAsset)}>
                    <img
                      src={selectedAsset.qrCode || `https://api.qrserver.com/v1/create-qr-code/?size=130x130&data=HEXON_PREVENTIVA_ASSET_ID_${selectedAsset.id}`}
                      alt="Asset QR Code"
                      className="w-28 h-28 mix-blend-multiply"
                    />
                    <div className="absolute inset-0 bg-[#3525cd]/80 hover:opacity-100 opacity-0 flex flex-col items-center justify-center text-white text-[10px] font-bold rounded-lg transition-all gap-1 text-center">
                      <Scan className="w-5 h-5 text-white animate-pulse" />
                      LER QR CODE
                    </div>
                  </div>
                  
                  <div>
                    <span className="text-[10px] font-mono font-black text-[#3525cd] block">
                      {selectedAsset.code}
                    </span>
                    <span className="text-[9px] text-gray-400 font-bold uppercase tracking-wider block">
                      Identificação Individual
                    </span>
                  </div>

                  {/* Actions to download or print tag */}
                  <div className="flex gap-1.5 mt-1.5 w-full">
                    <a
                      href={selectedAsset.qrCode || `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=HEXON_PREVENTIVA_ASSET_ID_${selectedAsset.id}`}
                      download={`qrcode_${selectedAsset.code}.png`}
                      className="flex-1 py-1 px-1.5 bg-white hover:bg-slate-50 border border-gray-200 rounded-lg text-[9px] font-black tracking-tight text-gray-700 flex items-center justify-center gap-1 transition-colors cursor-pointer text-center"
                      title="Download da Imagem do QR Code"
                    >
                      <Download className="w-3 h-3 text-gray-500" />
                      BAIXAR
                    </a>
                    
                    <button
                      onClick={() => {
                        const win = window.open();
                        if (win) {
                          win.document.write(`
                            <html>
                              <head>
                                <title>Plaqueta de Ativo - ${selectedAsset.code}</title>
                                <style>
                                  body { font-family: system-ui, -apple-system, sans-serif; text-align: center; padding: 40px; color: #0f172a; }
                                  .card { border: 2.5px solid #0f172a; padding: 24px; border-radius: 12px; max-width: 280px; margin: 0 auto; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); }
                                  h1 { margin: 10px 0 4px 0; font-size: 18px; font-weight: 800; letter-spacing: -0.025em; }
                                  p { margin: 0 0 16px 0; font-size: 11px; color: #475569; font-weight: bold; text-transform: uppercase; }
                                  .code { font-family: monospace; font-size: 13px; font-weight: bold; background: #e2e8f0; padding: 4px 8px; border-radius: 4px; color: #3525cd; display: inline-block; }
                                  .logo { font-size: 9px; font-weight: 900; color: #64748b; letter-spacing: 0.12em; margin-bottom: 18px; }
                                  .qr { width: 170px; height: 170px; margin: 0 auto 12px auto; display: block; }
                                </style>
                              </head>
                              <body>
                                <div class="card">
                                  <div class="logo">HEXON PREVENTIVA</div>
                                  <img class="qr" src="${selectedAsset.qrCode || `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=HEXON_PREVENTIVA_ASSET_ID_${selectedAsset.id}`}" />
                                  <div class="code">${selectedAsset.code}</div>
                                  <h1>${selectedAsset.name}</h1>
                                  <p>${selectedAsset.sector} &bull; ${selectedAsset.location.split(' - ')[0]}</p>
                                </div>
                                <script>window.onload = function() { window.print(); }</script>
                              </body>
                            </html>
                          `);
                          win.document.close();
                        }
                      }}
                      className="py-1 px-1.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg text-[9px] font-black tracking-tight text-[#3525cd] flex items-center justify-center gap-1 transition-colors cursor-pointer"
                      title="Imprimir Plaqueta de Ativo"
                    >
                      <Printer className="w-3 h-3 text-[#3525cd]" />
                      ETIQUETA
                    </button>
                  </div>
                </div>

              </div>

              {/* TECHNICAL SHEET SPEC ATTR GRID */}
              <div className="mt-6 pt-6 border-t border-gray-100">
                <h4 className="font-bold text-[#0b1c30] text-xs uppercase tracking-wider flex items-center gap-1.5 mb-4">
                  <Info className="w-4 h-4 text-[#3525cd]" />
                  Ficha Técnica Completa
                </h4>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                  <div>
                    <span className="text-[10px] text-gray-400 block mb-0.5 font-bold uppercase">Nº de Série</span>
                    <span className="font-bold text-slate-800 font-mono">
                      {selectedAsset.specs.serialNumber || selectedAsset.specs['Nº DE SÉRIE'] || 'N/A'}
                    </span>
                  </div>

                  {selectedAsset.specs.power && (
                    <div>
                      <span className="text-[10px] text-gray-400 block mb-0.5 font-bold uppercase">Potência</span>
                      <span className="font-bold text-slate-800">{selectedAsset.specs.power}</span>
                    </div>
                  )}

                  {selectedAsset.specs.capacity && (
                    <div>
                      <span className="text-[10px] text-gray-400 block mb-0.5 font-bold uppercase">Capacidade</span>
                      <span className="font-bold text-slate-800">{selectedAsset.specs.capacity}</span>
                    </div>
                  )}

                  {/* Dynamic custom fields from spreadsheet mapping */}
                  {Object.keys(selectedAsset.specs).map((key) => {
                    const excludedKeys = [
                      'manufacturer', 
                      'model', 
                      'serialNumber', 
                      'installationDate', 
                      'power', 
                      'capacity', 
                      'voltage', 
                      'warrantyUntil',
                      'STATUS',
                      'status',
                      'Nº DE SÉRIE',
                      'Nº de Série',
                      'Nº de série',
                      'N\u00ba DE S\u00c9RIE',
                      'N\u00ba de S\u00e9rie',
                      'N\u00ba de s\u00e9rie',
                      'N° DE SÉRIE',
                      'N° de Série',
                      'N° de série',
                      'Instalação',
                      'instalacao',
                      'Data de Instalação',
                      'Tensão Elétrica',
                      'tensao eletrica',
                      'Tensão',
                      'Garantia Vigor',
                      'garantia vigor',
                      'Garantia em Vigor',
                      'Número de Série',
                      'numero de serie',
                      'Série',
                    ];
                    // Case insensitive and accents sanitized equality check to prevent duplicates or leaked fields
                    const isExcluded = excludedKeys.some(
                      (excluded) => 
                        key.toLowerCase() === excluded.toLowerCase() ||
                        key.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() === 
                        excluded.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
                    );
                    if (isExcluded) return null;

                    const val = selectedAsset.specs[key];
                    if (val === undefined || val === null || String(val).trim() === '') return null;

                    // Detect and format Date and Currency values to be highly legible
                    let formattedVal = String(val);
                    const normKey = key.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

                    const isDate = normKey.includes('data') || 
                                   normKey.includes('date') || 
                                   normKey.includes('vencimento') || 
                                   normKey.includes('periodo') || 
                                   normKey.includes('garantia') || 
                                   normKey.includes('vigor') || 
                                   normKey.includes('instalac');

                    const isCurrency = normKey.includes('valor') || 
                                       normKey.includes('liquido') || 
                                       normKey.includes('custo') || 
                                       normKey.includes('preco') || 
                                       normKey.includes('price') || 
                                       normKey.includes('valores') ||
                                       normKey.includes('bens');

                    if (isDate) {
                      const strVal = String(val).trim();
                      if (/^\d{2}\/\d{2}\/\d{4}$/.test(strVal)) {
                        formattedVal = strVal;
                      } else {
                        const numVal = Number(strVal);
                        if (!isNaN(numVal) && numVal > 10000 && numVal < 100000) {
                          const dateObj = new Date((numVal - 25569) * 86400 * 1000);
                          if (!isNaN(dateObj.getTime())) {
                            const day = String(dateObj.getUTCDate()).padStart(2, '0');
                            const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
                            const year = dateObj.getUTCFullYear();
                            formattedVal = `${day}/${month}/${year}`;
                          }
                        } else {
                          const isoMatch = strVal.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
                          if (isoMatch) {
                            const dDay = isoMatch[3].padStart(2, '0');
                            const dMonth = isoMatch[2].padStart(2, '0');
                            formattedVal = `${dDay}/${dMonth}/${isoMatch[1]}`;
                          } else {
                            try {
                              const d = new Date(strVal);
                              if (!isNaN(d.getTime())) {
                                const day = String(d.getUTCDate()).padStart(2, '0');
                                const month = String(d.getUTCMonth() + 1).padStart(2, '0');
                                const year = d.getUTCFullYear();
                                if (year > 1900 && year < 2100) {
                                  formattedVal = `${day}/${month}/${year}`;
                                }
                              }
                            } catch (e) {}
                          }
                        }
                      }
                    } else if (isCurrency) {
                      const strVal = String(val).trim();
                      if (!strVal.startsWith('R$')) {
                        let sanitized = strVal;
                        if (sanitized.includes(',') && !sanitized.includes('.')) {
                          sanitized = sanitized.replace(',', '.');
                        } else if (sanitized.includes(',') && sanitized.includes('.')) {
                          sanitized = sanitized.replace(/\./g, '').replace(',', '.');
                        }
                        const cleanNum = parseFloat(sanitized.replace(/[^\d.-]/g, ''));
                        if (!isNaN(cleanNum)) {
                          formattedVal = new Intl.NumberFormat('pt-BR', {
                            style: 'currency',
                            currency: 'BRL'
                          }).format(cleanNum);
                        }
                      }
                    }

                    return (
                      <div key={key} className="border-l-2 border-indigo-100 pl-2">
                        <span className="text-[10px] text-gray-400 block mb-0.5 font-bold uppercase truncate-2-lines">{key}</span>
                        <span className="font-bold text-slate-800 break-words">{formattedVal}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* LOWER BLOCK: MAINTENANCE HISTORY */}
            {/* "onde tudo que for feito em um ativo na preventiva, seja automaticamente inserido no histórico do equipamento" */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <div className="flex justify-between items-center mb-4 pb-3 border-b border-gray-100">
                <h4 className="font-bold text-[#0b1c30] text-xs uppercase tracking-wider flex items-center gap-2">
                  <History className="w-4 h-4 text-[#3525cd]" />
                  Histórico Operacional de Manutenções
                </h4>
                <span className="text-[10px] font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                  {history.length} Eventos Registrados
                </span>
              </div>

              {history.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-xs text-gray-400 font-bold italic">Nenhuma ordem de serviço findada ou preventiva realizada neste ativo.</p>
                  <p className="text-[10px] text-gray-400 mt-1">Sua primeira preventiva concluída alimentará automaticamente este histórico.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {history.map((log, index) => {
                    // Normalize data fields with smart fallbacks for legacy records
                    const hasEnrichedDetails = !!(log.preventiveType || log.resultStatus || log.verifiedItemsText || log.nonConformItemsText || log.correctiveActionsText);
                    const listVerified = log.verifiedItemsText ? log.verifiedItemsText.split(';').map(s => s.trim()).filter(Boolean) : [];
                    const listFailed = log.nonConformItemsText ? log.nonConformItemsText.split(';').map(s => s.trim()).filter(Boolean) : [];
                    
                    return (
                      <div key={log.id} className="p-4 bg-white rounded-xl border border-gray-200 hover:border-indigo-250 relative text-xs shadow-xs space-y-3 transition-all">
                        {/* Connection track indicator */}
                        <div className="absolute left-0 top-4 bottom-4 w-1 bg-indigo-600 rounded-r"></div>

                        {/* Top info row */}
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-gray-100 pb-2 pl-2">
                          <div>
                            <span className="font-extrabold text-[#0b1c30] text-sm block sm:inline">{log.osTitle}</span>
                            <span className="font-mono text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded text-[10px] font-bold ml-0 sm:ml-2">
                              #OS-{log.osId}
                            </span>
                          </div>
                          <span className="font-mono text-gray-400 text-[10px] font-bold">{formatDateBR(log.date)}</span>
                        </div>

                        {/* Diagnostics grid */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pl-2 text-slate-600">
                          <div>
                            <span className="text-[9px] text-gray-400 block font-bold uppercase">Técnico Executor</span>
                            <span className="font-black text-slate-800 text-xs flex items-center gap-1">
                              <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full"></span>
                              {log.technician}
                            </span>
                          </div>

                          <div>
                            <span className="text-[9px] text-gray-400 block font-bold uppercase">Tipo de Intervenção</span>
                            <span className="font-black text-slate-800 text-xs">
                              {log.preventiveType || 'Visita Corretiva'}
                            </span>
                          </div>

                          <div>
                            <span className="text-[9px] text-gray-400 block font-bold uppercase">Conformidade Procedimento</span>
                            <span className="font-black text-emerald-600 text-xs">
                              {log.checkedCount} de {log.checklistCount} concluintes
                            </span>
                          </div>

                          <div>
                            <span className="text-[9px] text-gray-400 block font-bold uppercase">Resultado do Laudo</span>
                            <span className={`inline-block text-[9px] px-2 py-0.5 font-black rounded-full ${
                              log.resultStatus === 'Aprovado' ? 'bg-emerald-100 text-emerald-800' :
                              log.resultStatus === 'Aprovado com Ressalvas' ? 'bg-amber-100 text-amber-800' :
                              log.resultStatus === 'Não Conforme' ? 'bg-rose-100 text-rose-800' :
                              'bg-slate-100 text-slate-600'
                            }`}>
                              {log.resultStatus || 'Concluído'}
                            </span>
                          </div>
                        </div>

                        {/* Custom fields and lists for items checked/failed */}
                        {hasEnrichedDetails && (
                          <div className="pl-2 space-y-3 pt-1 border-t border-slate-50 text-[11px]">
                            
                            {/* Verified items checklist */}
                            {listVerified.length > 0 && (
                              <div>
                                <span className="font-black text-slate-700 block mb-1">✓ Itens Verificados e Conformados ({listVerified.length}):</span>
                                <div className="flex flex-wrap gap-1">
                                  {listVerified.map((v, i) => (
                                    <span key={i} className="bg-slate-50 border border-slate-100 px-2 py-0.5 rounded text-[10px] text-slate-600">
                                      {v}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Non-conforming items list */}
                            {listFailed.length > 0 && (
                              <div className="bg-rose-50/50 p-2.5 rounded-lg border border-rose-100">
                                <span className="font-black text-rose-700 flex items-center gap-1 mb-1">
                                  <AlertCircle className="w-3.5 h-3.5" />
                                  ✗ Itens Não Conformes Reportados ({listFailed.length}):
                                </span>
                                <ul className="list-disc list-inside space-y-0.5 text-[10px] text-rose-900 font-semibold">
                                  {listFailed.map((f, i) => (
                                    <li key={i}>{f}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* Spawned Corrective action notes */}
                            {log.correctiveActionsText && (
                              <div className="bg-blue-50/55 p-2.5 rounded-lg border border-blue-100 font-medium text-[10px] text-blue-900">
                                <span className="font-black text-blue-800 block mb-0.5">⚙️ Desdobramento e Ações Corretivas:</span>
                                {log.correctiveActionsText}
                              </div>
                            )}

                          </div>
                        )}

                        {/* Technician observations */}
                        {log.notes && (
                          <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg text-slate-500 italic pl-3 relative mt-2 text-xs leading-relaxed">
                            <span className="font-bold not-italic text-slate-700 block text-[10px] uppercase mb-0.5">Observações Adicionais:</span>
                            "{log.notes}"
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400 font-sans shadow-sm">
            <Cpu className="w-12 h-12 text-indigo-300 mx-auto mb-4 animate-bounce" />
            <p className="text-sm font-bold text-[#0b1c30]">Nenhum Ativo Selecionado</p>
            <p className="text-xs mt-1">Por favor, escolha um item no catálogo ao lado para visualizar a Ficha Técnica e o Histórico de manutenção.</p>
          </div>
        )}
      </div>
    </div>

      {/* SCAN SIMULATOR DRAWER / MODAL POPUP */}
      {showScanSimulator && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 font-sans">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full border border-gray-200">
            <div className="flex items-center gap-2 mb-4 justify-between border-b pb-3">
              <h3 className="font-extrabold text-[#0b1c30] text-sm flex items-center gap-2">
                <Scan className="w-4 h-4 text-[#3525cd]" />
                Simulador de Leitor de QR Code
              </h3>
              <button 
                onClick={() => setShowScanSimulator(false)}
                className="text-gray-400 hover:text-rose-600 font-extrabold text-sm"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-gray-500 leading-relaxed mb-4">
              Cada equipamento possui uma plaqueta física com QR Code único. Escolha um dos ativos cadastrados no menu abaixo para simular o escaneamento físico com o leitor:
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-extrabold text-gray-400 uppercase tracking-wider mb-1.5">
                  Selecione o Ativo Físicos para Ler
                </label>
                <select
                  value={simulatedScanCode}
                  onChange={(e) => setSimulatedScanCode(e.target.value)}
                  className="w-full py-2 px-3 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:outline-none"
                >
                  <option value="">Selecione um item cadastrado...</option>
                  {assets.map((ast) => (
                    <option key={ast.id} value={ast.code}>
                      [{ast.code}] {ast.name} ({ast.sector})
                    </option>
                  ))}
                </select>
              </div>

              {/* simulated webcam viewfinder box */}
              <div className="border border-dashed border-indigo-200 bg-indigo-50/10 rounded-lg h-36 flex flex-col items-center justify-center p-3 relative overflow-hidden">
                <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-0.5 bg-rose-500 shadow-md animate-bounce"></div>
                <QrCode className="w-12 h-12 text-indigo-400 opacity-60" />
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mt-2">
                  Escaner Ativo...
                </span>
              </div>

              <div className="flex gap-2 justify-end text-xs pt-3">
                <button
                  type="button"
                  onClick={() => setShowScanSimulator(false)}
                  className="px-4 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSimulateScan}
                  disabled={!simulatedScanCode}
                  className="px-4 py-2 bg-[#3525cd] text-white rounded-lg font-bold hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed cursor-pointer"
                >
                  Simular QR Match
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EDIT ASSET FORM MODAL */}
      {showEditModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 font-sans overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-lg w-full border border-gray-200 my-8">
            <div className="flex items-center gap-2 mb-4 justify-between border-b pb-3">
              <h3 className="font-extrabold text-[#0b1c30] text-sm flex items-center gap-2">
                <Edit className="w-4 h-4 text-indigo-600" />
                Editar Especificações do Equipamento
              </h3>
              <button 
                onClick={() => setShowEditModal(false)}
                className="text-gray-400 hover:text-rose-600 font-extrabold text-sm"
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
                      value={editingAssetCode}
                      onChange={(e) => setEditingAssetCode(e.target.value)}
                      className="w-full text-xs py-1.5 px-3 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono font-bold"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-extrabold text-gray-500 uppercase mb-1">
                      Setor Operacional*
                    </label>
                    <select
                      value={editingAssetSector}
                      onChange={(e) => setEditingAssetSector(e.target.value)}
                      className="w-full text-xs py-1.5 px-3 bg-white border border-gray-200 rounded-lg focus:outline-none font-bold text-slate-800"
                    >
                      {managements.length > 0 ? (
                        managements.filter(m => m.name !== 'Todas').map((m) => (
                          <option key={m.id} value={m.name}>{m.name}</option>
                        ))
                      ) : (
                        <>
                          <option value="Mecânica/Refrigeração">Mecânica / Refrigeração</option>
                          <option value="Elétrica/Eletrônica">Elétrica / Eletrônica</option>
                          <option value="Civil">Civil / Predial</option>
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
                      value={editingAssetName}
                      onChange={(e) => setEditingAssetName(e.target.value)}
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
                      value={editingAssetLocation}
                      onChange={(e) => setEditingAssetLocation(e.target.value)}
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
                  {['Mensal', 'Trimestral', 'Semestral', 'Anual'].map((period) => (
                    <label key={period} className="flex items-center gap-2 cursor-pointer font-bold text-[#0b1c30]">
                      <input
                        type="checkbox"
                        checked={editingAssetPeriodicities.includes(period as any)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setEditingAssetPeriodicities([...editingAssetPeriodicities, period as any]);
                          } else {
                            setEditingAssetPeriodicities(editingAssetPeriodicities.filter(p => p !== period));
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
                      value={editingAssetManufacturer}
                      onChange={(e) => setEditingAssetManufacturer(e.target.value)}
                      className="w-full text-xs py-1.5 px-2 bg-white border border-gray-200 rounded"
                    />
                  </div>

                  <div>
                    <label className="block text-[9px] font-bold text-gray-500 uppercase mb-0.5">MODELO</label>
                    <input
                      type="text"
                      placeholder="TR-30XA"
                      value={editingAssetModel}
                      onChange={(e) => setEditingAssetModel(e.target.value)}
                      className="w-full text-xs py-1.5 px-2 bg-white border border-gray-250 rounded"
                    />
                  </div>

                  <div>
                    <label className="block text-[9px] font-bold text-gray-500 uppercase mb-0.5">Nº DE SÉRIE</label>
                    <input
                      type="text"
                      placeholder="SN-98273"
                      value={editingAssetSerial}
                      onChange={(e) => setEditingAssetSerial(e.target.value)}
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
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 border border-gray-200 hover:bg-gray-55 rounded-lg text-xs leading-none font-bold text-slate-700 hover:text-black transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-[#3525cd] hover:bg-opacity-95 text-white font-extrabold text-xs leading-none rounded-lg shadow-sm transition-all hover:scale-[1.01] cursor-pointer"
                >
                  Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EXCLUDE BY SECTOR MODAL */}
      {showSectorDeleteModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 font-sans">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full border border-gray-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-2 mb-3 justify-between border-b pb-3 border-rose-100">
              <h3 className="font-extrabold text-rose-800 text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600" />
                Excluir Itens por Setor
              </h3>
              <button 
                onClick={() => {
                  setShowSectorDeleteModal(false);
                  setSectorDeleteConfirmText('');
                }}
                className="text-gray-400 hover:text-rose-600 font-extrabold text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-xs text-gray-550 leading-normal">
                Esta operação removerá **todos os equipamentos** cadastrados no setor selecionado, tanto localmente quanto do banco de dados na nuvem.
              </p>

              <div>
                <label className="block text-[10px] font-extrabold text-gray-500 uppercase mb-1">
                  Selecione o Setor para Limpar:
                </label>
                <select
                  value={sectorToDelete}
                  onChange={(e) => setSectorToDelete(e.target.value)}
                  className="w-full text-xs py-1.5 px-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-rose-500 font-bold text-slate-800"
                >
                  {managements.length > 0 ? (
                    managements.filter(m => m.name !== 'Todas').map((m) => (
                      <option key={m.id} value={m.name}>{m.name}</option>
                    ))
                  ) : (
                    <>
                      <option value="Mecânica/Refrigeração">Mecânica / Refrigeração</option>
                      <option value="Elétrica/Eletrônica">Elétrica / Eletrônica</option>
                      <option value="Civil">Civil</option>
                    </>
                  )}
                </select>
              </div>

              <div className="bg-rose-50 p-3 rounded-lg border border-rose-100 text-[10px] text-rose-805 space-y-2">
                <span className="font-bold uppercase tracking-wider block">Procedimento de Segurança:</span>
                <p>
                  Para confirmar a remoção completa de todos os ativos do setor, digite <strong className="font-extrabold font-mono select-all text-rose-950">EXCLUIR SETOR</strong> abaixo:
                </p>
                <input
                  type="text"
                  placeholder="EXCLUIR SETOR"
                  value={sectorDeleteConfirmText}
                  onChange={(e) => setSectorDeleteConfirmText(e.target.value)}
                  className="w-full text-xs py-1 px-2.5 bg-white border border-rose-200 rounded focus:outline-none font-bold placeholder:text-rose-350"
                />
              </div>

              <div className="flex gap-2 justify-end pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowSectorDeleteModal(false);
                    setSectorDeleteConfirmText('');
                  }}
                  className="px-3.5 py-1.5 border border-gray-200 hover:bg-gray-50 rounded-lg text-xs font-bold text-gray-700"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={sectorDeleteConfirmText !== 'EXCLUIR SETOR'}
                  onClick={async () => {
                    try {
                      await dbDeleteAssetsBySector(sectorToDelete);
                      const allAssets = await dbGetAssets();
                      setAssets(allAssets);
                      setSelectedAsset(null);
                      setShowSectorDeleteModal(false);
                      setSectorDeleteConfirmText('');
                      alert(`Todos os itens do setor "${sectorToDelete}" foram eliminados com sucesso.`);
                    } catch (err) {
                      console.error(err);
                      alert('Erro ao realizar a limpeza do setor.');
                    }
                  }}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-1 transition-all ${
                    sectorDeleteConfirmText === 'EXCLUIR SETOR'
                      ? 'bg-rose-600 hover:bg-rose-700 cursor-pointer shadow-md'
                      : 'bg-rose-300 cursor-not-allowed opacity-60'
                  }`}
                >
                  Confirmar Exclusão Geral
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EXCLUSÃO INDIVIDUAL DE ATIVO MODAL */}
      {showDeleteAssetModal && assetToDelete && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 font-sans">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full border border-gray-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-2 mb-3 justify-between border-b pb-3 border-rose-100">
              <h3 className="font-extrabold text-rose-800 text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600" />
                Excluir Ativo
              </h3>
              <button 
                onClick={() => {
                  setShowDeleteAssetModal(false);
                  setAssetToDelete(null);
                }}
                className="text-gray-400 hover:text-rose-600 font-extrabold text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-xs text-slate-600 leading-normal">
                Você tem certeza de que deseja excluir permanentemente o ativo <strong className="text-slate-900 font-extrabold">"{assetToDelete.name}" ({assetToDelete.code})</strong>?
              </p>

              <div className="bg-rose-50 p-3 rounded-lg border border-rose-100 text-[10px] text-rose-800 leading-normal space-y-1">
                <span className="font-bold uppercase tracking-wider block">Aviso de Segurança:</span>
                <p>Esta ação é irreversível e excluirá permanentemente o ativo e toda a sua ficha técnica dos servidores.</p>
              </div>

              <div className="flex gap-2 justify-end pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowDeleteAssetModal(false);
                    setAssetToDelete(null);
                  }}
                  className="px-3.5 py-1.5 border border-gray-200 hover:bg-gray-50 rounded-lg text-xs font-bold text-gray-700 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await dbDeleteAsset(assetToDelete.id);
                      const allAssets = await dbGetAssets();
                      setAssets(allAssets);
                      setSelectedAsset(null);
                      setShowDeleteAssetModal(false);
                      setAssetToDelete(null);
                      alert('Equipamento excluído com sucesso do gerenciamento.');
                    } catch (err) {
                      console.error(err);
                      alert('Erro ao excluir o ativo.');
                    }
                  }}
                  className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1 cursor-pointer shadow-md"
                >
                  Confirmar Exclusão
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CREATE NEW ASSET FORM MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 font-sans overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-lg w-full border border-gray-200 my-8">
            <div className="flex items-center gap-2 mb-4 justify-between border-b pb-3">
              <h3 className="font-extrabold text-[#0b1c30] text-sm flex items-center gap-2">
                <PlusCircle className="w-4 h-4 text-[#3525cd]" />
                Cadastrar Novo Equipamento
              </h3>
              <button 
                onClick={() => setShowAddModal(false)}
                className="text-gray-400 hover:text-rose-600 font-extrabold text-sm"
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
                      value={newAssetCode}
                      onChange={(e) => setNewAssetCode(e.target.value)}
                      className="w-full text-xs py-1.5 px-3 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-extrabold text-gray-500 uppercase mb-1">
                      Setor Operacional*
                    </label>
                    <select
                      value={newAssetSector}
                      onChange={(e) => setNewAssetSector(e.target.value)}
                      className="w-full text-xs py-1.5 px-3 bg-white border border-gray-200 rounded-lg focus:outline-none font-bold text-slate-800"
                    >
                      {managements.length > 0 ? (
                        managements.filter(m => m.name !== 'Todas').map((m) => (
                          <option key={m.id} value={m.name}>{m.name}</option>
                        ))
                      ) : (
                        <>
                          <option value="Mecânica/Refrigeração">Mecânica / Refrigeração</option>
                          <option value="Elétrica/Eletrônica">Elétrica / Eletrônica</option>
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
                      value={newAssetName}
                      onChange={(e) => setNewAssetName(e.target.value)}
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
                      value={newAssetLocation}
                      onChange={(e) => setNewAssetLocation(e.target.value)}
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
                          setNewAssetPeriodicities(match.selectPeriodicities);
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
                        setNewAssetPeriodicities(detected);
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
                  {['Mensal', 'Trimestral', 'Semestral', 'Anual'].map((period) => (
                    <label key={period} className="flex items-center gap-2 cursor-pointer font-bold text-[#0b1c30]">
                      <input
                        type="checkbox"
                        checked={newAssetPeriodicities.includes(period as any)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setNewAssetPeriodicities([...newAssetPeriodicities, period as any]);
                          } else {
                            setNewAssetPeriodicities(newAssetPeriodicities.filter(p => p !== period));
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
                      value={newAssetManufacturer}
                      onChange={(e) => setNewAssetManufacturer(e.target.value)}
                      className="w-full text-xs py-1.5 px-2 bg-white border border-gray-200 rounded"
                    />
                  </div>

                  <div>
                    <label className="block text-[9px] font-bold text-gray-500 uppercase mb-0.5">MODELO</label>
                    <input
                      type="text"
                      placeholder="TR-30XA"
                      value={newAssetModel}
                      onChange={(e) => setNewAssetModel(e.target.value)}
                      className="w-full text-xs py-1.5 px-2 bg-white border border-gray-250 rounded"
                    />
                  </div>

                  <div>
                    <label className="block text-[9px] font-bold text-gray-500 uppercase mb-0.5">Nº DE SÉRIE</label>
                    <input
                      type="text"
                      placeholder="SN-98273"
                      value={newAssetSerial}
                      onChange={(e) => setNewAssetSerial(e.target.value)}
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
                      value={newAssetPower}
                      onChange={(e) => setNewAssetPower(e.target.value)}
                      className="w-full text-[10px] py-1 px-2 bg-white border border-gray-200 rounded"
                    />
                  </div>

                  <div>
                    <label className="block text-[8px] font-bold text-gray-400 uppercase mb-0.5">Capacidade (Opcional)</label>
                    <input
                      type="text"
                      placeholder="e.g. 150 TR"
                      value={newAssetCapacity}
                      onChange={(e) => setNewAssetCapacity(e.target.value)}
                      className="w-full text-[10px] py-1 px-2 bg-white border border-gray-200 rounded"
                    />
                  </div>

                  <div>
                    <label className="block text-[8px] font-bold text-gray-400 uppercase mb-0.5">Voltagem (Opcional)</label>
                    <input
                      type="text"
                      placeholder="e.g. 380V"
                      value={newAssetVoltage}
                      onChange={(e) => setNewAssetVoltage(e.target.value)}
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
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#3525cd] text-white rounded-lg font-bold hover:bg-indigo-700 cursor-pointer shadow"
                >
                  Confirmar Cadastro
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* XLSX IMPORT MODAL (WIZARD) */}
      {showImportModal && (
        <div className="fixed inset-0 bg-[#090d16]/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in font-sans leading-normal">
          <div className="bg-white dark:bg-[#0c1322] rounded-2xl w-full max-w-4xl border border-gray-100 max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            
            {/* Modal Header */}
            <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-[#0b1c30] text-sm">Importador de Banco de Ativos</h3>
                  <p className="text-[10px] text-gray-400">Importação em lote com mapeamento de colunas XLS/XLSX/CSV</p>
                </div>
              </div>
              <button 
                onClick={() => {
                  if (!isProcessingImport) setShowImportModal(false);
                }}
                disabled={isProcessingImport}
                className="p-1 px-2.5 bg-gray-100 hover:bg-gray-200 text-gray-500 rounded-full font-bold text-xs cursor-pointer transition-colors disabled:opacity-50"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1 min-h-0">
              
              {/* STEP 1: SELECT FILE */}
              {importStep === 1 && (
                <div className="space-y-6 animate-fade-in py-2">
                  <div className="text-center space-y-1.5">
                    <h4 className="font-bold text-[#0b1c30] text-sm">Selecione ou Arraste o Arquivo da Planilha</h4>
                    <p className="text-[11px] text-gray-500 max-w-lg mx-auto leading-relaxed block">
                      O arquivo deve conter as colunas do seu banco de ativos. Na próxima etapa você poderá mapear os cabeçalhos para os dados correspondentes do sistema.
                    </p>
                  </div>

                  {/* Drop zone container */}
                  <div className="border-2 border-dashed border-gray-250 hover:border-emerald-500 rounded-2xl p-8 bg-gray-50/40 hover:bg-emerald-50/10 text-center transition-all relative group cursor-pointer">
                    <input 
                      type="file" 
                      accept=".xlsx, .xls, .csv" 
                      onChange={handleXLSXFileChange}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    />
                    <div className="space-y-3">
                      <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center mx-auto text-emerald-600 group-hover:scale-110 transition-transform">
                        <Upload className="w-6 h-6" />
                      </div>
                      <div>
                        <span className="text-xs font-black text-slate-700 block">Clique para procurar arquivo</span>
                        <span className="text-[10px] text-gray-400 block mt-0.5">ou arraste e solte o arquivo aqui</span>
                      </div>
                      <span className="inline-block text-[10px] text-emerald-700 px-3 py-1 bg-emerald-50 rounded-full font-bold uppercase tracking-wider">
                        XLSX, XLS, CSV
                      </span>
                    </div>
                  </div>

                  {/* Schema template details */}
                  <div className="p-4 bg-indigo-50/40 border border-indigo-100 rounded-xl space-y-2">
                    <div className="flex items-center gap-2">
                      <Info className="w-4 h-4 text-indigo-600 shrink-0" />
                      <span className="text-xs font-bold text-indigo-950">Como sua planilha deve ser estruturada?</span>
                    </div>
                    <p className="text-[10px] text-indigo-900/80 leading-normal block">
                      O sistema interpreta automaticamente quase qualquer layout. Contudo, para obter os melhores resultados, certifique-se de que a planilha possui cabeçalhos como: <strong className="font-semibold">Código, Nome, Setor (Mecânica/Elétrica, etc.), Localização</strong> nas colunas principais, e os dados logo abaixo.
                    </p>
                  </div>
                </div>
              )}

              {/* STEP 2: COLUMN MAPPING & PREVIEW */}
              {importStep === 2 && (
                <div className="space-y-6 animate-fade-in py-1">
                  
                  {isProcessingImport ? (
                    /* Processing import loader view */
                    <div className="py-12 space-y-4 text-center">
                      <div className="w-12 h-12 rounded-full border-4 border-emerald-100 border-t-emerald-600 animate-spin mx-auto" />
                      <div className="space-y-1">
                        <h4 className="font-bold text-xs text-[#0b1c30]">Processando Banco de Dados</h4>
                        <p className="text-[10px] text-gray-400">
                          Gerando QR Codes off-line e gravando fichas de ativos... ({importProgress} de {totalToImport})
                        </p>
                      </div>
                      
                      {/* High quality progress bar */}
                      <div className="w-full max-w-md mx-auto bg-gray-100 rounded-full h-2 overflow-hidden">
                        <div 
                          className="bg-emerald-500 h-full transition-all duration-155" 
                          style={{ width: `${(importProgress / totalToImport) * 100}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    /* General mapping interface */
                    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                      
                      {/* Left side inputs: Choose excel headers */}
                      <div className="lg:col-span-2 space-y-4 bg-gray-50/35 border border-gray-100 rounded-xl p-4">
                        <span className="text-[10px] font-black tracking-wider text-[#0b1c30] uppercase block border-b pb-2">Mapeamento do Banco de Dados</span>
                        
                        {/* Setor de Destino Geral */}
                        <div className="space-y-1.5 p-3.5 bg-indigo-50/40 border border-indigo-100 rounded-xl my-2">
                          <label className="block text-[10px] font-black text-[#0b1c30] uppercase tracking-wider">
                            SETOR DE DESTINO <span className="text-red-500">*</span>
                          </label>
                          <select 
                            value={importTargetSector} 
                            onChange={(e) => setImportTargetSector(e.target.value)}
                            className="w-full py-1.5 px-2.5 bg-white border border-indigo-200 rounded text-xs focus:ring-1 focus:ring-[#3525cd] focus:outline-none font-bold text-[#0b1c30]"
                          >
                            {managements.length > 0 ? (
                              managements.filter(m => m.name !== 'Todas').map((m) => (
                                <option key={m.id} value={m.name}>{m.name}</option>
                              ))
                            ) : (
                              <>
                                <option value="Mecânica/Refrigeração">Mecânica / Refrigeração</option>
                                <option value="Elétrica/Eletrônica">Elétrica / Eletrônica</option>
                                <option value="Civil">Civil</option>
                              </>
                            )}
                          </select>
                          <p className="text-[9px] text-[#42526e] leading-normal font-medium">
                            Todos os equipamentos da planilha serão catalogados no setor acima e gravados persistentemente no banco de dados do sistema.
                          </p>
                        </div>
                        
                        <div className="space-y-3 text-xs">
                          {/* Section: Itens Principais */}
                          <div className="space-y-2 pb-2">
                            <span className="text-[9px] font-black tracking-widest text-[#3525cd] uppercase block">Itens Principais</span>
                            
                            <div className="space-y-1">
                              <label className="block text-[10px] font-bold text-slate-700">
                                PATRIMÔNIO (Código / Tag) <span className="text-red-500">*</span>
                              </label>
                              <select 
                                value={columnMappings['code'] || ''} 
                                onChange={(e) => setColumnMappings({ ...columnMappings, code: e.target.value })}
                                className="w-full py-1.5 px-2 bg-white border border-gray-250 rounded text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                              >
                                <option value="">-- Selecione a coluna --</option>
                                {importHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                              </select>
                            </div>

                            <div className="space-y-1">
                              <label className="block text-[10px] font-bold text-slate-700">
                                ENDEREÇO (Localização) <span className="text-red-500">*</span>
                              </label>
                              <select 
                                value={columnMappings['location'] || ''} 
                                onChange={(e) => setColumnMappings({ ...columnMappings, location: e.target.value })}
                                className="w-full py-1.5 px-2 bg-white border border-gray-250 rounded text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                              >
                                <option value="">-- Selecione a coluna --</option>
                                {importHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                              </select>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-1">
                                <label className="block text-[10px] font-bold text-slate-600">
                                  CRAAI <span className="text-gray-400 font-normal">(Opcional)</span>
                                </label>
                                <select 
                                  value={columnMappings['craai'] || ''} 
                                  onChange={(e) => setColumnMappings({ ...columnMappings, craai: e.target.value })}
                                  className="w-full py-1.5 px-2 bg-white border border-gray-250 rounded text-xs focus:outline-none text-slate-650"
                                >
                                  <option value="">-- Não importar --</option>
                                  {importHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                                </select>
                              </div>

                              <div className="space-y-1">
                                <label className="block text-[10px] font-bold text-slate-600">
                                  COMARCA <span className="text-gray-400 font-normal">(Opcional)</span>
                                </label>
                                <select 
                                  value={columnMappings['comarca'] || ''} 
                                  onChange={(e) => setColumnMappings({ ...columnMappings, comarca: e.target.value })}
                                  className="w-full py-1.5 px-2 bg-white border border-gray-250 rounded text-xs focus:outline-none text-slate-650"
                                >
                                  <option value="">-- Não importar --</option>
                                  {importHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                                </select>
                              </div>
                            </div>

                            <div className="space-y-1">
                              <label className="block text-[10px] font-bold text-slate-700">
                                MATERIAL (Equipamento / Nome) <span className="text-red-500">*</span>
                              </label>
                              <select 
                                value={columnMappings['name'] || ''} 
                                onChange={(e) => setColumnMappings({ ...columnMappings, name: e.target.value })}
                                className="w-full py-1.5 px-2 bg-white border border-gray-250 rounded text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                              >
                                <option value="">-- Selecione a coluna --</option>
                                {importHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                              </select>
                            </div>

                            <div className="space-y-1 bg-sky-50/50 p-2 border border-sky-100 rounded-lg">
                              <label className="block text-[10px] font-bold text-sky-950 flex justify-between">
                                <span className="flex items-center gap-1">TIPO <span className="text-[9px] text-[#3525cd] font-black">(Frequência da Atividade)</span></span>
                                <span className="text-red-500">*</span>
                              </label>
                              <select 
                                value={columnMappings['tipo'] || ''} 
                                onChange={(e) => setColumnMappings({ ...columnMappings, tipo: e.target.value })}
                                className="w-full py-1.5 px-2 bg-white border border-sky-200 rounded text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none font-bold text-sky-900"
                              >
                                <option value="">-- Selecione a coluna --</option>
                                {importHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                              </select>
                              <p className="text-[8px] text-sky-800 leading-tight">
                                O sistema usará as palavras-chaves nessa coluna para programar os cronogramas automáticos (Mensal, Trimestral, Semestral, Anual).
                              </p>
                            </div>
                          </div>

                          {/* Section: Especificações Técnicas */}
                          <div className="pt-3 border-t border-dashed border-gray-200 space-y-2">
                            <span className="text-[9px] font-black tracking-widest text-emerald-800 uppercase block">Especificações Técnicas</span>
                            
                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-1">
                                <label className="block text-[8px] font-bold text-gray-500 uppercase">MARCA</label>
                                <select 
                                  value={columnMappings['manufacturer'] || ''} 
                                  onChange={(e) => setColumnMappings({ ...columnMappings, manufacturer: e.target.value })}
                                  className="w-full py-1 px-1 bg-white border border-gray-250 rounded text-[10px]"
                                >
                                  <option value="">Não importar</option>
                                  {importHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                                </select>
                              </div>

                              <div className="space-y-1">
                                <label className="block text-[8px] font-bold text-gray-400 uppercase">MODELO</label>
                                <select 
                                  value={columnMappings['model'] || ''} 
                                  onChange={(e) => setColumnMappings({ ...columnMappings, model: e.target.value })}
                                  className="w-full py-1 px-1 bg-white border border-gray-250 rounded text-[10px]"
                                >
                                  <option value="">Não importar</option>
                                  {importHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                                </select>
                              </div>

                              <div className="space-y-1">
                                <label className="block text-[8px] font-bold text-gray-400 uppercase">Nº DE SÉRIE</label>
                                <select 
                                  value={columnMappings['serialNumber'] || ''} 
                                  onChange={(e) => setColumnMappings({ ...columnMappings, serialNumber: e.target.value })}
                                  className="w-full py-1 px-1 bg-white border border-gray-250 rounded text-[10px]"
                                >
                                  <option value="">Não importar</option>
                                  {importHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                                </select>
                              </div>

                              <div className="space-y-1">
                                <label className="block text-[8px] font-bold text-gray-400 uppercase">STATUS</label>
                                <select 
                                  value={columnMappings['status'] || ''} 
                                  onChange={(e) => setColumnMappings({ ...columnMappings, status: e.target.value })}
                                  className="w-full py-1 px-1 bg-white border border-gray-250 rounded text-[10px]"
                                >
                                  <option value="">Não importar</option>
                                  {importHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                                </select>
                              </div>

                              <div className="space-y-1 col-span-2">
                                <label className="block text-[8px] font-bold text-gray-400 uppercase">DATA DE AQUISIÇÃO</label>
                                <select 
                                  value={columnMappings['installationDate'] || ''} 
                                  onChange={(e) => setColumnMappings({ ...columnMappings, installationDate: e.target.value })}
                                  className="w-full py-1 px-1.5 bg-white border border-gray-250 rounded text-[10px]"
                                >
                                  <option value="">Não importar</option>
                                  {importHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                                </select>
                              </div>

                              <div className="space-y-1">
                                <label className="block text-[8px] font-bold text-gray-400 uppercase">VALOR DE AQUIS.</label>
                                <select 
                                  value={columnMappings['acquisitionValue'] || ''} 
                                  onChange={(e) => setColumnMappings({ ...columnMappings, acquisitionValue: e.target.value })}
                                  className="w-full py-1 px-1 bg-white border border-gray-250 rounded text-[10px]"
                                >
                                  <option value="">Não importar</option>
                                  {importHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                                </select>
                              </div>

                              <div className="space-y-1">
                                <label className="block text-[8px] font-bold text-gray-400 uppercase">VALOR LÍQUIDO</label>
                                <select 
                                  value={columnMappings['netValue'] || ''} 
                                  onChange={(e) => setColumnMappings({ ...columnMappings, netValue: e.target.value })}
                                  className="w-full py-1 px-1 bg-white border border-gray-250 rounded text-[10px]"
                                >
                                  <option value="">Não importar</option>
                                  {importHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                                </select>
                              </div>
                            </div>
                          </div>

                        </div>
                      </div>

                      {/* Right side display: Dynamic Periodicity Rules & Info */}
                      <div className="lg:col-span-3 space-y-4">
                        {/* Dynamic Periodicity Mapping Rules list */}
                        <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3 shadow-xs">
                          <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                            <div className="flex items-center gap-1.5">
                              <CalendarCheck className="w-4 h-4 text-indigo-600" />
                              <span className="text-[11px] font-black text-slate-800 uppercase tracking-wider">Regras de Periodicidade por TIPO</span>
                            </div>
                            <span className="text-[9.5px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-bold">Associador Dinâmico</span>
                          </div>

                          <p className="text-[10px] text-slate-500 leading-relaxed">
                            Defina quais periodicidades de preventiva serão vinculadas ao ativo baseando-se nas palavras-chave da coluna <strong>TIPO</strong> de sua planilha (ex: <strong>ACJ</strong> &rarr; Mensal, Semestral):
                          </p>

                          {/* Interactive Rules Mapping Table */}
                          <div className="bg-white border border-slate-250 rounded-xl max-h-[140px] overflow-y-auto divide-y divide-slate-150 p-2 space-y-1.5">
                            {periodicityRules && periodicityRules.length > 0 ? (
                              periodicityRules.map((rule, idx) => (
                                <div key={idx} className="flex justify-between items-center pt-2 first:pt-0">
                                  <div className="space-y-0.5">
                                    <span className="text-[10px] font-bold text-[#0c1322] bg-slate-100 px-1.5 py-0.5 rounded mr-1 shadow-2xs font-mono uppercase">
                                      {rule.keyword}
                                    </span>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {rule.selectPeriodicities.map((p) => (
                                        <span key={p} className="text-[8px] font-bold px-1 py-0.2 bg-emerald-50 text-emerald-700 border border-emerald-150 rounded">
                                          {p}
                                        </span>
                                      ))}
                                      {rule.selectPeriodicities.length === 0 && (
                                        <span className="text-[8px] font-bold italic text-red-500">Nenhuma selecionada</span>
                                      )}
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2">
                                    {/* Quick toggles */}
                                    <div className="flex gap-1">
                                      {['Mensal', 'Trimestral', 'Semestral', 'Anual'].map((p) => {
                                        const isChecked = rule.selectPeriodicities.includes(p as any);
                                        return (
                                          <button
                                            key={p}
                                            type="button"
                                            onClick={() => {
                                              const updated = [...periodicityRules];
                                              const updatedList = isChecked 
                                                ? rule.selectPeriodicities.filter(x => x !== p)
                                                : [...rule.selectPeriodicities, p as any];
                                              
                                              // Order standard
                                              const order = ['Mensal', 'Trimestral', 'Semestral', 'Anual'];
                                              updatedList.sort((a,b) => order.indexOf(a) - order.indexOf(b));
                                              
                                              updated[idx] = { ...rule, selectPeriodicities: updatedList };
                                              setPeriodicityRules(updated);
                                              localStorage.setItem('hexon_periodicity_rules', JSON.stringify(updated));
                                            }}
                                            className={`text-[8.5px] px-1 py-0.5 rounded font-black border transition-all cursor-pointer ${
                                              isChecked 
                                                ? 'bg-indigo-600 text-white border-indigo-600 shadow-3xs' 
                                                : 'bg-white text-slate-400 hover:text-slate-700 border-slate-200'
                                            }`}
                                          >
                                            {p.slice(0, 3)}
                                          </button>
                                        );
                                      })}
                                    </div>

                                    {/* Action deleter */}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const updated = periodicityRules.filter((_, rNo) => rNo !== idx);
                                        setPeriodicityRules(updated);
                                        localStorage.setItem('hexon_periodicity_rules', JSON.stringify(updated));
                                      }}
                                      className="p-1 text-red-400 hover:text-red-700 hover:bg-red-50 rounded-lg cursor-pointer transition-all"
                                      title="Remover Regra de Validação"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="p-3 text-center text-xs text-slate-400 italic">
                                Nenhuma regra customizada cadastrada.
                              </div>
                            )}
                          </div>

                          {/* Add Custom User Rule Inputs */}
                          <div className="bg-indigo-50/40 p-2.5 rounded-lg border border-indigo-100 flex flex-wrap gap-2 items-center">
                            <input
                              type="text"
                              placeholder="ex: ACJ, CHILLER, ELETR"
                              value={newRuleKeyword}
                              onChange={(e) => setNewRuleKeyword(e.target.value)}
                              className="text-[10px] py-1 px-2 border border-slate-300 rounded focus:outline-none placeholder:text-slate-400 font-bold text-slate-800 uppercase flex-1 min-w-[120px]"
                            />

                            <div className="flex gap-1.5 shrink-0">
                              {['Mensal', 'Trimestral', 'Semestral', 'Anual'].map((p) => {
                                const isChecked = newRulePeriodicities.includes(p as any);
                                return (
                                  <label key={p} className="flex items-center gap-0.5 text-[9px] font-black cursor-pointer text-[#0b1c30]">
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => {
                                        if (isChecked) {
                                          setNewRulePeriodicities(newRulePeriodicities.filter(x => x !== p));
                                        } else {
                                          setNewRulePeriodicities([...newRulePeriodicities, p as any]);
                                        }
                                      }}
                                      className="w-3 h-3 rounded text-indigo-600 border-gray-300 cursor-pointer"
                                    />
                                    {p.slice(0, 3)}
                                  </label>
                                );
                              })}
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                if (!newRuleKeyword.trim()) return;
                                const cleanedKeyword = newRuleKeyword.trim().toUpperCase();
                                
                                if (periodicityRules.some(r => r.keyword.toUpperCase() === cleanedKeyword)) {
                                  alert('Essa palavra-chave já possui uma regra associada.');
                                  return;
                                }

                                const updated = [...periodicityRules, {
                                  keyword: cleanedKeyword,
                                  selectPeriodicities: [...newRulePeriodicities]
                                }];
                                setPeriodicityRules(updated);
                                setNewRuleKeyword('');
                                localStorage.setItem('hexon_periodicity_rules', JSON.stringify(updated));
                              }}
                              className="bg-indigo-600 hover:bg-indigo-700 text-white font-black text-[9.5px] py-1 px-3 rounded uppercase transition-colors shrink-0 cursor-pointer shadow-2xs"
                            >
                              Adicionar
                            </button>
                          </div>
                        </div>

                        {/* Tips notification */}
                        <div className="p-3.5 bg-indigo-50/25 border border-indigo-100/30 rounded-xl space-y-1.5 flex items-start gap-2 text-indigo-950">
                          <Check className="w-4 h-4 text-[#3525cd] shrink-0 mt-0.5" />
                          <div className="text-[10px]">
                            <strong className="font-bold">Geração de QR Codes Off-line Ativada: </strong> 
                            O importador criará chaves criptográficas de identificação únicas e renderizará plaquetas base64 offline que serão persistidas no seu banco de dados, poupando dados de tráfego.
                          </div>
                        </div>

                        <div className="p-3.5 bg-emerald-50/30 border border-emerald-100 rounded-xl space-y-1.5 flex items-start gap-2 text-emerald-950">
                          <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                          <div className="text-[10px]">
                            <strong className="font-bold">Ciclo Preventivo Automático Ativado: </strong> 
                            O sistema lerá as periodicidades dadas pelas regras de mapeamento do tipo de ativo e agendará tarefas em lote para cada equipamento automaticamente.
                          </div>
                        </div>
                      </div>

                    </div>
                  )}

                </div>
              )}

              {/* STEP 3: SUCCESS PANEL */}
              {importStep === 3 && (
                <div className="py-8 text-center space-y-4 animate-fade-in">
                  <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto text-3xl">
                    ✓
                  </div>
                  <div className="space-y-1.5">
                    <h3 className="font-black text-sm text-[#0b1c30]">Banco de Ativos Importado com Sucesso!</h3>
                    <p className="text-xs text-gray-500 max-w-md mx-auto leading-relaxed block">
                      Foram criados <strong className="font-semibold text-emerald-600">{importRows.length} novos ativos</strong> no sistema. Todas as fichas, QR Codes criptografados offline e tabelas de agendamento de manutenção estão guardados na memória do console.
                    </p>
                  </div>
                  
                  <div className="max-w-xs mx-auto p-3 bg-gray-50 rounded-lg text-left text-[11px] text-gray-500 space-y-1 shadow-xs">
                    <span className="font-bold uppercase tracking-wider text-[9px] text-gray-400 block mb-1">Status do Processo</span>
                    <div className="flex justify-between">
                      <span>Fichas Criadas:</span>
                      <strong className="text-slate-800 font-bold">{importRows.length}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>QR Codes Persistidos:</span>
                      <strong className="text-slate-800 font-bold">100%</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Cache Ativo:</span>
                      <strong className="text-emerald-600 font-bold">Sim (RAM/LocalStorage)</strong>
                    </div>
                  </div>
                </div>
              )}

            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-between gap-2.5 shrink-0 text-xs">
              
              {importStep === 1 ? (
                <>
                  <button 
                    type="button"
                    onClick={() => setShowImportModal(false)}
                    className="px-4 py-2 border border-gray-250 rounded-lg text-gray-500 hover:bg-gray-100 transition-all font-bold"
                  >
                    Fechar
                  </button>
                  <span className="text-[10px] text-gray-400 self-center font-medium">Fase 1 de 2: Carregar arquivo</span>
                </>
              ) : importStep === 2 ? (
                <>
                  <button 
                    type="button"
                    disabled={isProcessingImport}
                    onClick={() => setImportStep(1)}
                    className="px-4 py-2 border border-gray-250 rounded-lg text-gray-500 hover:bg-gray-100 transition-all font-bold disabled:opacity-50"
                  >
                    Voltar
                  </button>
                  
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-gray-400 font-medium">
                      {!columnMappings['code'] || !columnMappings['name'] 
                        ? 'Selecione no mínimo Código e Nome' 
                        : `Vão ser mapeados ${importRows.length} itens`
                      }
                    </span>
                    <button 
                      type="button"
                      onClick={handleConfirmXLSXImport}
                      disabled={isProcessingImport || !columnMappings['code'] || !columnMappings['name']}
                      className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold transition-all disabled:opacity-50 flex items-center gap-2 cursor-pointer shadow-sm border border-emerald-600"
                    >
                      {isProcessingImport ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin text-white" />
                          Gravando Ativos...
                        </>
                      ) : (
                        'Confirmar Importação de Ativos'
                      )}
                    </button>
                  </div>
                </>
              ) : (
                <button 
                  type="button"
                  onClick={() => {
                    setShowImportModal(false);
                    setImportRows([]);
                    setImportStep(1);
                  }}
                  className="w-full py-2 bg-[#3525cd] text-white rounded-lg text-center font-bold hover:bg-indigo-700 cursor-[#3525cd]"
                >
                  Concluir e Voltar ao Painel
                </button>
              )}

            </div>

          </div>
        </div>
      )}

    </div>
  );
}
