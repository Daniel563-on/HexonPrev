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
  Plus, 
  ShieldCheck, 
  Search, 
  Scan,
  Printer,
  ChevronRight,
  Upload,
  FileSpreadsheet,
  Check,
  AlertCircle,
  Loader2,
  Edit,
  Trash2,
  Sparkles,
  Filter,
  Layers,
  ChevronLeft,
  Building2,
  Clock,
  RotateCcw
} from 'lucide-react';
import { AssetScannerModal, AssetDeleteModal, AssetSectorDeleteModal } from './assets/AssetActionModals';
import { AssetImportWizardModal } from './assets/AssetImportWizardModal';
import { AssetEditModal, AssetCreateModal } from './assets/AssetFormModals';
import { AssetDetailPanel } from './assets/AssetDetailPanel';
import { AssetConsultationTable } from './assets/AssetConsultationTable';
import OrderDetailsDrawer from './orders/OrderDetailsDrawer';
import { printAssetTag, parseScannedQrCode } from '../utils/qrUtils';
import { Asset, MaintenanceLog, formatDateBR, HexonUser, ServiceOrder, Management, MaintenanceTemplate } from '../types';
import { 
  dbGetAssets, 
  dbSearchAssetsTargeted,
  dbGetAssetHistory, 
  dbDeleteAsset, 
  dbDeleteAssetsBySector, 
  dbGetManagements,
  dbGetPeriodicityRules,
  dbSavePeriodicityRules,
  dbGetCustomDynamicFields,
  dbSaveCustomDynamicFields,
  dbGetServiceOrderById,
  dbGetTemplates
} from '../db/firebase';

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
  // OS completa aberta a partir do histórico do ativo (buscada no banco pelo número, 1 leitura)
  const [historyOrder, setHistoryOrder] = useState<ServiceOrder | null>(null);
  const [historyTemplates, setHistoryTemplates] = useState<MaintenanceTemplate[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSector, setSelectedSector] = useState('Todos');
  const [managements, setManagements] = useState<Management[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showScanSimulator, setShowScanSimulator] = useState(false);
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list');

  // Consultation navigation and filter states (Inspirado no modelo de Consulta Geral do MP)
  const [consultationTab, setConsultationTab] = useState<'consulta' | 'resultado'>('consulta');
  const [filterTipoBem, setFilterTipoBem] = useState<'Ativo' | 'Em Manutenção' | 'Baixado' | 'Todos'>('Todos');
  const [filterPatrimonio, setFilterPatrimonio] = useState('');
  const [filterNumeroAntigo, setFilterNumeroAntigo] = useState('');
  const [filterGerencia, setFilterGerencia] = useState('Todas');
  const [filterUnidade, setFilterUnidade] = useState('Todas');
  const [filterSetor, setFilterSetor] = useState('');
  const [filterTipoEquipamento, setFilterTipoEquipamento] = useState('Todos');
  const [filterFabricanteModelo, setFilterFabricanteModelo] = useState('');
  
  // Consultation results & pagination
  const [hasConsulted, setHasConsulted] = useState(false);
  const [isConsulting, setIsConsulting] = useState(false);
  const [consultationResults, setConsultationResults] = useState<Asset[]>([]);

  // Dynamic custom fields mapped from XLSX columns
  const [customDynamicFields, setCustomDynamicFields] = useState<string[]>([]);

  // XLSX Import state
  const [showImportModal, setShowImportModal] = useState(false);

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

  // Active asset being edited (Extraído na Etapa 3)
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);

  // Sector delete states
  const [showSectorDeleteModal, setShowSectorDeleteModal] = useState(false);

  // Individual asset delete states
  const [showDeleteAssetModal, setShowDeleteAssetModal] = useState(false);
  const [assetToDelete, setAssetToDelete] = useState<Asset | null>(null);

  // Load initial organizational structure without downloading 10,000 assets
  const loadAssetsData = async () => {
    const mList = await dbGetManagements();
    setManagements(mList);
    // Assets remain empty until the user triggers a targeted search/consultation
  };

  // Derived unique units/comarcas for dropdown filter
  const availableUnits = React.useMemo(() => {
    const set = new Set<string>();
    managements.forEach(m => {
      (m.units || []).forEach(u => {
        if (u.name) set.add(u.name);
        if (u.comarca) set.add(u.comarca);
      });
    });
    assets.forEach(a => {
      const c = a.specs?.COMARCA || a.specs?.comarca;
      if (c && typeof c === 'string') set.add(c);
      const cr = a.specs?.CRAAI || a.specs?.craai;
      if (cr && typeof cr === 'string') set.add(cr);
      if (a.location) {
        const firstPart = a.location.split(' - ')[0];
        if (firstPart && firstPart.length > 2) set.add(firstPart.trim());
      }
    });
    return ['Todas', ...Array.from(set).filter(Boolean).sort()];
  }, [managements, assets]);

  const commonEquipmentTypes = [
    'Todos',
    'Ar Condicionado',
    'Bomba Hidráulica',
    'Chiller',
    'Quadro Elétrico',
    'Extintor de Incêndio',
    'Transformador',
    'Gerador',
    'Predial / Civil'
  ];

  // Execute consultation matching all criteria via targeted query (ZERO full-collection reads)
  const handleExecuteConsultation = async () => {
    setIsConsulting(true);
    try {
      const qPatrimonio = filterPatrimonio.trim();
      const qAntigo = filterNumeroAntigo.trim();
      const qSetor = filterSetor.trim();
      const qFabMod = filterFabricanteModelo.trim();
      const qTipo = filterTipoEquipamento;

      // Executa consulta pontual no Firestore: busca apenas os ativos que batem com o filtro
      const targetedResults = await dbSearchAssetsTargeted({
        codeOrPatrimonio: qPatrimonio || qAntigo,
        sector: filterGerencia !== 'Todas' ? filterGerencia : undefined,
        unitOrComarca: filterUnidade !== 'Todas' ? filterUnidade : undefined,
        tipo: qTipo !== 'Todos' ? qTipo : undefined,
        limitResults: 60
      });

      // Refinamento em memória apenas dos resultados pontuais trazidos (se houver filtros adicionais)
      const filtered = targetedResults.filter(asset => {
        // Status
        if (filterTipoBem !== 'Todos') {
          const assetStatus = (asset.specs?.STATUS || asset.specs?.status || 'Ativo').toLowerCase();
          const targetStatus = filterTipoBem.toLowerCase();
          if (targetStatus === 'ativo' && !assetStatus.includes('ativo') && assetStatus !== 'em operação') {
            return false;
          }
          if (targetStatus === 'em manutenção' && !assetStatus.includes('manuten') && !assetStatus.includes('reparo')) {
            return false;
          }
          if (targetStatus === 'baixado' && !assetStatus.includes('baix') && !assetStatus.includes('desativ')) {
            return false;
          }
        }

        // Setor / Sala
        if (qSetor) {
          const loc = String(asset.location || '').toLowerCase();
          const sField = String(asset.specs?.setor || asset.specs?.SETOR || asset.specs?.sala || '').toLowerCase();
          if (!loc.includes(qSetor.toLowerCase()) && !sField.includes(qSetor.toLowerCase())) return false;
        }

        // Fabricante / Modelo
        if (qFabMod) {
          const mfg = String(asset.specs?.manufacturer || asset.specs?.FABRICANTE || '').toLowerCase();
          const mdl = String(asset.specs?.model || asset.specs?.MODELO || '').toLowerCase();
          if (!mfg.includes(qFabMod.toLowerCase()) && !mdl.includes(qFabMod.toLowerCase())) return false;
        }

        return true;
      });

      setConsultationResults(filtered);
      setHasConsulted(true);
      setConsultationTab('resultado');
      setSelectedAsset(null);
    } finally {
      setIsConsulting(false);
    }
  };

  const handleClearFilters = () => {
    setFilterTipoBem('Todos');
    setFilterPatrimonio('');
    setFilterNumeroAntigo('');
    setFilterGerencia('Todas');
    setFilterUnidade('Todas');
    setFilterSetor('');
    setFilterTipoEquipamento('Todos');
    setFilterFabricanteModelo('');
    setConsultationResults([]);
    setHasConsulted(false);
    setSelectedAsset(null);
    setConsultationTab('consulta');
  };

  const handleShowRecentAssets = async () => {
    setIsConsulting(true);
    try {
      const recent = await dbSearchAssetsTargeted({
        limitResults: 25
      });
      setConsultationResults(recent);
      setHasConsulted(true);
      setSelectedAsset(null);
      setConsultationTab('resultado');
    } finally {
      setIsConsulting(false);
    }
  };

  useEffect(() => {
    loadAssetsData();
    dbGetCustomDynamicFields().then(fields => {
      if (fields && fields.length > 0) {
        setCustomDynamicFields(fields);
      }
    });
    dbGetPeriodicityRules().then(rules => {
      if (rules && rules.length > 0) {
        setPeriodicityRules(rules);
      }
    });
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

  // Abre a OS completa de um registro do histórico (qualquer data, mesmo fora das listas)
  const handleViewHistoryOrder = async (orderId: string) => {
    const order = await dbGetServiceOrderById(orderId);
    if (!order) {
      alert(`Ordem de serviço #${orderId} não encontrada no banco de dados.`);
      return;
    }
    if (historyTemplates.length === 0) {
      setHistoryTemplates(await dbGetTemplates().catch(() => []));
    }
    setHistoryOrder(order);
  };

  // Edit and Delete handler functions
  const handleOpenEditModal = (asset: Asset) => {
    if (userHasActionPermission && !userHasActionPermission('create_asset')) {
      alert('Acesso Restrito: Seu perfil de usuário não tem autorização para cadastrar ou editar ativos.');
      return;
    }
    setEditingAsset(asset);
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

  // Unified QR scanner and simulator action
  const handleQrCodeDetected = (decodedText: string) => {
    if (!decodedText || !decodedText.trim()) {
      alert('Código inválido ou em branco.');
      return;
    }

    const normalized = decodedText.trim();
    const cleanValue = parseScannedQrCode(normalized);

    const match = assets.find(
      (a) => a.id.toLowerCase() === cleanValue.toLowerCase() || 
             a.code.toLowerCase() === cleanValue.toLowerCase() || 
             a.id.toLowerCase() === normalized.toLowerCase() || 
             a.code.toLowerCase() === normalized.toLowerCase()
    );

    if (match) {
      setSelectedAsset(match);
      setConsultationResults([match]);
      setHasConsulted(true);
      setConsultationTab('resultado');
      onSelectScannedAsset(match.id);
      setShowScanSimulator(false);
      setMobileView('detail');
      alert(`🔍 QR CODE ENCONTRADO!\nEquipamento: ${match.name}\nAtivo: [${match.code}]`);
    } else {
      alert(`O QR Code escaneado "${decodedText}" não corresponde a nenhum equipamento cadastrado no momento.`);
    }
  };

  // Trigger quick scan from QR image click
  const triggerQuickScan = (asset: Asset) => {
    setSelectedAsset(asset);
    setConsultationResults([asset]);
    setHasConsulted(true);
    setConsultationTab('resultado');
    onSelectScannedAsset(asset.id);
    setMobileView('detail');
  };

  return (
    <div className="font-sans space-y-6">
      
      {/* TOP HEADER: General Asset Management & Consultation Title */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-2 border-b border-gray-200">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-black uppercase text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded border border-indigo-100 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5" />
              Módulo de Patrimônio
            </span>
            <span className="text-xs text-slate-400 font-bold">|</span>
            <span className="text-xs text-slate-500 font-medium">Gestão & Inventário de Bens</span>
          </div>
          <h1 className="text-2xl font-black text-[#0b1c30] tracking-tight flex items-center gap-2">
            Movimentação - Consulta Geral
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Localize e consulte equipamentos por número patrimonial, série, gerência ou unidade.
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
          <button
            type="button"
            id="btn-scan-qr"
            onClick={() => setShowScanSimulator(true)}
            className="flex-1 md:flex-none py-2 px-3.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 rounded-xl text-xs font-black flex items-center justify-center gap-2 transition-all cursor-pointer shadow-2xs"
          >
            <Scan className="w-4 h-4 text-indigo-600" />
            <span>Escanear QR</span>
          </button>

          {(userProfile?.perfil === 'Super Administrador' || !userHasActionPermission || userHasActionPermission('import_assets')) && (
            <button
              type="button"
              id="btn-open-import"
              onClick={() => {
                setShowImportModal(true);
              }}
              className="flex-1 md:flex-none py-2 px-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black flex items-center justify-center gap-2 transition-all cursor-pointer shadow-2xs"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Importar Excel</span>
            </button>
          )}

          {(!userHasActionPermission || userHasActionPermission('create_asset')) && (
            <button
              type="button"
              id="btn-open-add-asset"
              onClick={() => setShowAddModal(true)}
              className="flex-1 md:flex-none py-2 px-4 bg-[#3525cd] hover:bg-[#2a1da6] text-white rounded-xl text-xs font-black flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm hover:shadow"
            >
              <Plus className="w-4 h-4" />
              <span>Novo Bem</span>
            </button>
          )}
        </div>
      </div>

      {/* TOP TAB NAVIGATION: Consultation Mode vs Results */}
      <div className="flex items-center gap-2 border-b border-gray-200">
        <button
          type="button"
          id="tab-consulta"
          onClick={() => setConsultationTab('consulta')}
          className={`pb-3 px-4 text-xs font-black flex items-center gap-2 border-b-2 transition-all cursor-pointer ${
            consultationTab === 'consulta'
              ? 'border-[#3525cd] text-[#3525cd]'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Filter className="w-4 h-4" />
          <span>Consulta</span>
        </button>

        <button
          type="button"
          id="tab-resultado"
          onClick={() => {
            if (!hasConsulted && consultationResults.length === 0) {
              handleExecuteConsultation();
            } else {
              setConsultationTab('resultado');
            }
          }}
          className={`pb-3 px-4 text-xs font-black flex items-center gap-2 border-b-2 transition-all cursor-pointer ${
            consultationTab === 'resultado'
              ? 'border-[#3525cd] text-[#3525cd]'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Resultado da consulta</span>
          {hasConsulted && (
            <span className="ml-1.5 px-2 py-0.5 text-[10px] font-black rounded-full bg-slate-100 text-slate-700">
              {consultationResults.length}
            </span>
          )}
        </button>
      </div>

      {/* CONSULTATION TAB CONTENT */}
      {consultationTab === 'consulta' && (
        <div className="space-y-6">
          {/* Card Detalhamento da Consulta */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h3 className="text-sm font-black text-[#0b1c30] uppercase tracking-wide mb-4 pb-2 border-b border-gray-100 flex items-center gap-2">
              <Filter className="w-4 h-4 text-[#3525cd]" />
              Detalhamento Da Consulta
            </h3>

            {/* Tipo de Bem Selector (Radio Pills) */}
            <div className="mb-6">
              <label className="block text-xs font-bold text-slate-700 mb-2">
                Situação / Tipo do Bem:
              </label>
              <div className="flex flex-wrap gap-2">
                {(['Todos', 'Ativo', 'Em Manutenção', 'Baixado'] as const).map(option => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setFilterTipoBem(option)}
                    className={`py-2 px-3.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                      filterTipoBem === option
                        ? 'bg-[#0b1c30] text-white border-[#0b1c30] shadow-xs'
                        : 'bg-white text-slate-700 border-gray-200 hover:bg-slate-50'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            {/* Grid of Search Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Nº Patrimonial */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Nº Patrimonial / Código:
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={filterPatrimonio}
                    onChange={(e) => setFilterPatrimonio(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleExecuteConsultation()}
                    placeholder="Ex: 88721, REFRIG-001..."
                    className="w-full text-xs font-medium py-2 px-3 pl-8 bg-white border border-gray-300 rounded-lg text-slate-800 placeholder-gray-400 focus:outline-[#3525cd] focus:ring-1 focus:ring-[#3525cd]"
                  />
                  <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-3" />
                </div>
              </div>

              {/* Nº Antigo / Nº Série */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Nº Antigo / Série:
                </label>
                <input
                  type="text"
                  value={filterNumeroAntigo}
                  onChange={(e) => setFilterNumeroAntigo(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleExecuteConsultation()}
                  placeholder="Número antigo ou série..."
                  className="w-full text-xs font-medium py-2 px-3 bg-white border border-gray-300 rounded-lg text-slate-800 placeholder-gray-400 focus:outline-[#3525cd] focus:ring-1 focus:ring-[#3525cd]"
                />
              </div>

              {/* Gerência / Coordenação */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Gerência / Coordenação:
                </label>
                <select
                  value={filterGerencia}
                  onChange={(e) => setFilterGerencia(e.target.value)}
                  className="w-full text-xs font-medium py-2 px-3 bg-white border border-gray-300 rounded-lg text-slate-800 focus:outline-[#3525cd] focus:ring-1 focus:ring-[#3525cd]"
                >
                  <option value="Todas">Todas as Gerências</option>
                  {managements.map(m => (
                    <option key={m.id} value={m.name}>{m.name}</option>
                  ))}
                </select>
              </div>

              {/* Unidade / Comarca */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Unidade / Comarca:
                </label>
                <select
                  value={filterUnidade}
                  onChange={(e) => setFilterUnidade(e.target.value)}
                  className="w-full text-xs font-medium py-2 px-3 bg-white border border-gray-300 rounded-lg text-slate-800 focus:outline-[#3525cd] focus:ring-1 focus:ring-[#3525cd]"
                >
                  {availableUnits.map(u => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>

              {/* Setor / Sala / Centro de Custo */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Setor / Sala / Localização:
                </label>
                <input
                  type="text"
                  value={filterSetor}
                  onChange={(e) => setFilterSetor(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleExecuteConsultation()}
                  placeholder="Ex: Sala 402, Bloco B, CPD..."
                  className="w-full text-xs font-medium py-2 px-3 bg-white border border-gray-300 rounded-lg text-slate-800 placeholder-gray-400 focus:outline-[#3525cd] focus:ring-1 focus:ring-[#3525cd]"
                />
              </div>

              {/* Tipo de Equipamento */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Tipo de Equipamento:
                </label>
                <select
                  value={filterTipoEquipamento}
                  onChange={(e) => setFilterTipoEquipamento(e.target.value)}
                  className="w-full text-xs font-medium py-2 px-3 bg-white border border-gray-300 rounded-lg text-slate-800 focus:outline-[#3525cd] focus:ring-1 focus:ring-[#3525cd]"
                >
                  {commonEquipmentTypes.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              {/* Fabricante / Modelo */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Fabricante / Marca / Modelo:
                </label>
                <input
                  type="text"
                  value={filterFabricanteModelo}
                  onChange={(e) => setFilterFabricanteModelo(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleExecuteConsultation()}
                  placeholder="Ex: Carrier, Daikin, WEG, Schneider..."
                  className="w-full text-xs font-medium py-2 px-3 bg-white border border-gray-300 rounded-lg text-slate-800 placeholder-gray-400 focus:outline-[#3525cd] focus:ring-1 focus:ring-[#3525cd]"
                />
              </div>
            </div>

            {/* Action Buttons Bar */}
            <div className="mt-6 pt-4 border-t border-gray-100 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  id="btn-execute-consultation"
                  onClick={handleExecuteConsultation}
                  disabled={isConsulting}
                  className="py-2.5 px-6 bg-[#3525cd] hover:bg-[#2a1da6] text-white text-xs font-black rounded-xl flex items-center gap-2 transition-all cursor-pointer shadow-sm hover:shadow disabled:opacity-50"
                >
                  {isConsulting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Consultando...</span>
                    </>
                  ) : (
                    <>
                      <Search className="w-4 h-4" />
                      <span>Consultar Ativos</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  id="btn-clear-filters"
                  onClick={handleClearFilters}
                  className="py-2.5 px-4 bg-white border border-gray-300 text-slate-700 hover:bg-slate-50 text-xs font-bold rounded-xl flex items-center gap-2 transition-all cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                  <span>Limpar Filtros</span>
                </button>
              </div>

              <div>
                <button
                  type="button"
                  id="btn-show-recent"
                  onClick={handleShowRecentAssets}
                  className="py-2.5 px-4 bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100 text-xs font-bold rounded-xl flex items-center gap-2 transition-all cursor-pointer"
                >
                  <Clock className="w-3.5 h-3.5 text-slate-500" />
                  <span>Ver 25 Mais Recentes</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* RESULTS TAB CONTENT */}
      {consultationTab === 'resultado' && (
        <div className="space-y-6">
          {selectedAsset ? (
            <AssetDetailPanel
              asset={selectedAsset}
              history={history}
              onBackToList={() => setSelectedAsset(null)}
              onBackToMobileList={() => setMobileView('list')}
              onDeleteAsset={(asset) => handleDeleteAssetTrigger(asset)}
              onQuickScan={(asset) => triggerQuickScan(asset)}
              onEditAsset={(asset) => handleOpenEditModal(asset)}
              onViewOrder={handleViewHistoryOrder}
            />
          ) : (
            <AssetConsultationTable
              results={consultationResults}
              onSelectAsset={(asset) => setSelectedAsset(asset)}
              onEditAsset={(asset) => handleOpenEditModal(asset)}
              onDeleteAsset={(asset) => handleDeleteAssetTrigger(asset)}
              onNewSearch={() => setConsultationTab('consulta')}
              onShowRecent={handleShowRecentAssets}
              userHasActionPermission={userHasActionPermission}
              userProfile={userProfile}
              pageSize={25}
            />
          )}
        </div>
      )}

      {/* OS COMPLETA ABERTA PELO HISTÓRICO DO ATIVO (somente consulta) */}
      <OrderDetailsDrawer
        isOpen={!!historyOrder}
        order={historyOrder}
        onClose={() => setHistoryOrder(null)}
        onReload={() => {}}
        assets={selectedAsset ? [selectedAsset] : []}
        templates={historyTemplates}
        userProfile={userProfile}
        userHasActionPermission={userHasActionPermission}
        canRevertUnexecutedOrder={() => false}
        currentCalendarDate={new Date()}
      />

      {/* SCANNER QR CODE MODAL (EXTRAÍDO NA ETAPA 1) */}
      <AssetScannerModal
        isOpen={showScanSimulator}
        onClose={() => setShowScanSimulator(false)}
        onScanSuccess={handleQrCodeDetected}
        assets={assets}
      />

      {/* EDIT ASSET FORM MODAL (EXTRAÍDO NA ETAPA 3) */}
      <AssetEditModal
        isOpen={!!editingAsset}
        onClose={() => setEditingAsset(null)}
        asset={editingAsset}
        managements={managements}
        onSaveSuccess={(updatedAsset) => {
          setAssets(prev => prev.map(a => a.id === updatedAsset.id ? updatedAsset : a));
          if (selectedAsset?.id === updatedAsset.id) {
            setSelectedAsset(updatedAsset);
          }
        }}
      />

      {/* EXCLUSÃO POR SETOR MODAL (EXTRAÍDO NA ETAPA 1) */}
      <AssetSectorDeleteModal
        isOpen={showSectorDeleteModal}
        onClose={() => setShowSectorDeleteModal(false)}
        managements={managements}
        onConfirmSectorDelete={async (targetSector) => {
          try {
            await dbDeleteAssetsBySector(targetSector);
            const allAssets = await dbGetAssets();
            setAssets(allAssets);
            setSelectedAsset(null);
            setShowSectorDeleteModal(false);
            alert(`Todos os itens do setor "${targetSector}" foram eliminados com sucesso.`);
          } catch (err) {
            console.error(err);
            alert('Erro ao realizar a limpeza do setor.');
          }
        }}
      />

      {/* EXCLUSÃO INDIVIDUAL DE ATIVO MODAL (EXTRAÍDO NA ETAPA 1) */}
      <AssetDeleteModal
        asset={showDeleteAssetModal ? assetToDelete : null}
        onClose={() => {
          setShowDeleteAssetModal(false);
          setAssetToDelete(null);
        }}
        onConfirmDelete={async (targetAsset) => {
          try {
            await dbDeleteAsset(targetAsset.id);
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
      />

      {/* CREATE NEW ASSET FORM MODAL (EXTRAÍDO NA ETAPA 3) */}
      <AssetCreateModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        managements={managements}
        periodicityRules={periodicityRules}
        customDynamicFields={customDynamicFields}
        onCreateSuccess={async (newAsset) => {
          await loadAssetsData();
          setSelectedAsset(newAsset);
        }}
      />

      {/* XLSX IMPORT MODAL (WIZARD - EXTRAÍDO NA ETAPA 2) */}
      <AssetImportWizardModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        assets={assets}
        managements={managements}
        periodicityRules={periodicityRules}
        onUpdatePeriodicityRules={setPeriodicityRules}
        onReloadAssets={loadAssetsData}
        setCustomDynamicFields={setCustomDynamicFields}
        onImportSuccess={(firstAsset) => {
          if (firstAsset) {
            setSelectedAsset(firstAsset);
          }
        }}
      />

    </div>
  );
}
