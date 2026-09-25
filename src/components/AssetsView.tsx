import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
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
  dbGetAssetsPage,
  dbCountAssets,
  dbFindAssetByPatrimonio,
  dbGetAllAssetsForExport,
  dbGetAssetTypes,
  dbGetAddresses,
  ASSETS_PAGE_SIZE,
  AssetMainFilter,
  AssetPageCriteria,
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
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [history, setHistory] = useState<MaintenanceLog[]>([]);
  // OS completa aberta a partir do histórico do ativo (buscada no banco pelo número, 1 leitura)
  const [historyOrder, setHistoryOrder] = useState<ServiceOrder | null>(null);
  const [historyTemplates, setHistoryTemplates] = useState<MaintenanceTemplate[]>([]);
  const [managements, setManagements] = useState<Management[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showScanSimulator, setShowScanSimulator] = useState(false);
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list');

  // Consulta paginada: 1 filtro principal no banco + Status e Tipo; 50 ativos por página
  const [consultationTab, setConsultationTab] = useState<'consulta' | 'resultado'>('consulta');
  const [searchMain, setSearchMain] = useState<AssetMainFilter>('comarca');
  const [searchValue, setSearchValue] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterTipo, setFilterTipo] = useState('');
  const [pageFilter, setPageFilter] = useState('');
  const [assetTypes, setAssetTypes] = useState<string[]>([]);
  const [craaiOptions, setCraaiOptions] = useState<string[]>([]);
  const [comarcaOptions, setComarcaOptions] = useState<string[]>([]);

  // Resultado: páginas já lidas ficam guardadas (voltar não lê o banco de novo)
  const [hasConsulted, setHasConsulted] = useState(false);
  const [isConsulting, setIsConsulting] = useState(false);
  const [activeCriteria, setActiveCriteria] = useState<AssetPageCriteria | null>(null);
  const [pages, setPages] = useState<Asset[][]>([]);
  const [pageCursors, setPageCursors] = useState<(QueryDocumentSnapshot | null)[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [totalFound, setTotalFound] = useState(0);
  const [isExporting, setIsExporting] = useState(false);

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

  // Listas de CRAAI e Comarca (cadastro de Endereços) e de tipos de equipamento
  useEffect(() => {
    dbGetAddresses().then((list) => {
      setCraaiOptions(Array.from(new Set(list.map((a) => a.craai).filter(Boolean))).sort((a, b) => a.localeCompare(b)));
      setComarcaOptions(Array.from(new Set(list.map((a) => a.comarca).filter(Boolean))).sort((a, b) => a.localeCompare(b)));
    });
    dbGetAssetTypes().then(setAssetTypes);
  }, []);

  const currentPageAssets = pages[pageIndex] || [];
  const totalPages = Math.max(1, Math.ceil(totalFound / ASSETS_PAGE_SIZE));

  // Procurar nesta página (Setor/Sala, Fabricante/Modelo, nome...)
  const consultationResults = React.useMemo(() => {
    const q = pageFilter.trim().toLowerCase();
    if (!q) return currentPageAssets;
    return currentPageAssets.filter((a) =>
      [
        a.code, a.name, a.location,
        a.specs?.setor, a.specs?.SETOR, a.specs?.sala,
        a.specs?.manufacturer, a.specs?.MARCA, a.specs?.FABRICANTE,
        a.specs?.model, a.specs?.MODELO, a.specs?.TIPO
      ].some((v) => String(v || '').toLowerCase().includes(q))
    );
  }, [currentPageAssets, pageFilter]);

  // Mostra um único ativo como resultado (patrimônio, QR Code)
  const showSingleResult = (asset: Asset | null) => {
    setActiveCriteria({ main: 'patrimonio', value: asset?.code || '' });
    setPages([asset ? [asset] : []]);
    setPageCursors([null]);
    setPageIndex(0);
    setTotalFound(asset ? 1 : 0);
    setPageFilter('');
    setHasConsulted(true);
    setConsultationTab('resultado');
  };

  const handleExecuteConsultation = async () => {
    const value = searchValue.trim();
    if (searchMain !== 'todos' && !value) {
      alert('Informe o valor do filtro principal (patrimônio, comarca, CRAAI ou gerência).');
      return;
    }
    setIsConsulting(true);
    setSelectedAsset(null);
    try {
      if (searchMain === 'patrimonio') {
        showSingleResult(await dbFindAssetByPatrimonio(value));
        return;
      }
      const criteria: AssetPageCriteria = {
        main: searchMain,
        value,
        status: filterStatus || undefined,
        tipo: filterTipo || undefined
      };
      const [count, first] = await Promise.all([dbCountAssets(criteria), dbGetAssetsPage(criteria, null)]);
      setActiveCriteria(criteria);
      setPages([first.assets]);
      setPageCursors([first.lastDoc]);
      setPageIndex(0);
      setTotalFound(count);
      setPageFilter('');
      setHasConsulted(true);
      setConsultationTab('resultado');
    } catch (err: any) {
      console.error('Erro na consulta de ativos:', err);
      alert(`Não foi possível consultar. Se for a primeira vez com esse filtro, confira se o índice foi criado no Console.\n\n${err?.message || err}`);
    } finally {
      setIsConsulting(false);
    }
  };

  const handleNextPage = async () => {
    if (!activeCriteria || pageIndex + 1 >= totalPages) return;
    if (pages[pageIndex + 1]) {
      setPageIndex(pageIndex + 1);
      return;
    }
    setIsConsulting(true);
    try {
      const next = await dbGetAssetsPage(activeCriteria, pageCursors[pageIndex]);
      setPages((prev) => [...prev, next.assets]);
      setPageCursors((prev) => [...prev, next.lastDoc]);
      setPageIndex(pageIndex + 1);
    } catch (err: any) {
      alert(`Não foi possível carregar a próxima página: ${err?.message || err}`);
    } finally {
      setIsConsulting(false);
    }
  };

  const handlePrevPage = () => {
    if (pageIndex > 0) setPageIndex(pageIndex - 1);
  };

  // Baixa em Excel TODOS os ativos do filtro (só quando o usuário pede)
  const handleExportExcel = async () => {
    if (!activeCriteria || totalFound === 0) return;
    if (activeCriteria.main !== 'patrimonio' && !window.confirm(`Exportar ${totalFound} ativo(s) para Excel?`)) return;
    setIsExporting(true);
    try {
      const list = activeCriteria.main === 'patrimonio' ? currentPageAssets : await dbGetAllAssetsForExport(activeCriteria);
      const rows = list.map((a) => ({
        'Nº PATRIMONIAL': a.code,
        'EQUIPAMENTO': a.name,
        'GERÊNCIA': a.sector,
        'CRAAI': a.specs?.CRAAI || '',
        'COMARCA': a.specs?.COMARCA || '',
        'LOCALIZAÇÃO': a.location,
        'TIPO': a.specs?.TIPO || '',
        'FABRICANTE': a.specs?.manufacturer || a.specs?.MARCA || '',
        'MODELO': a.specs?.model || a.specs?.MODELO || '',
        'Nº DE SÉRIE': a.specs?.serialNumber || a.specs?.['Nº DE SÉRIE'] || '',
        'STATUS': a.status || ''
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Ativos');
      XLSX.writeFile(wb, `Ativos_Hexon_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (err: any) {
      alert(`Não foi possível exportar: ${err?.message || err}`);
    } finally {
      setIsExporting(false);
    }
  };

  // Atualiza um ativo nas páginas já carregadas (edição) ou tira da lista (exclusão)
  const replaceInPages = (updated: Asset) =>
    setPages((prev) => prev.map((pg) => pg.map((a) => (a.id === updated.id ? updated : a))));
  const removeFromPages = (assetId: string) => {
    setPages((prev) => prev.map((pg) => pg.filter((a) => a.id !== assetId)));
    setTotalFound((t) => Math.max(0, t - 1));
  };

  const handleClearFilters = () => {
    setSearchMain('comarca');
    setSearchValue('');
    setFilterStatus('');
    setFilterTipo('');
    setPageFilter('');
    setActiveCriteria(null);
    setPages([]);
    setPageCursors([]);
    setPageIndex(0);
    setTotalFound(0);
    setHasConsulted(false);
    setSelectedAsset(null);
    setConsultationTab('consulta');
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
    if (!scannedAssetId) return;
    dbFindAssetByPatrimonio(scannedAssetId).then((match) => {
      if (match) {
        showSingleResult(match);
        setSelectedAsset(match);
        setMobileView('detail');
      }
    });
  }, [scannedAssetId]);

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

  // Unified QR scanner and simulator action
  const handleQrCodeDetected = async (decodedText: string) => {
    if (!decodedText || !decodedText.trim()) {
      alert('Código inválido ou em branco.');
      return;
    }

    const normalized = decodedText.trim();
    const cleanValue = parseScannedQrCode(normalized);

    const match = (await dbFindAssetByPatrimonio(cleanValue)) || (await dbFindAssetByPatrimonio(normalized));

    if (match) {
      showSingleResult(match);
      setSelectedAsset(match);
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
    showSingleResult(asset);
    setSelectedAsset(asset);
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
            setConsultationTab('resultado');
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
              {totalFound}
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

            {/* 1. Filtro principal (vai ao banco) */}
            <div className="mb-5">
              <label className="block text-xs font-bold text-slate-700 mb-2">
                Buscar por:
              </label>
              <div className="flex flex-wrap gap-2">
                {([
                  ['comarca', 'Comarca'],
                  ['craai', 'CRAAI'],
                  ['gerencia', 'Gerência'],
                  ['patrimonio', 'Nº Patrimonial'],
                  ['todos', 'Todos os ativos']
                ] as [AssetMainFilter, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setSearchMain(key);
                      setSearchValue('');
                    }}
                    className={`py-2 px-3.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                      searchMain === key
                        ? 'bg-[#0b1c30] text-white border-[#0b1c30] shadow-xs'
                        : 'bg-white text-slate-700 border-gray-200 hover:bg-slate-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Valor do filtro principal */}
              {searchMain !== 'todos' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {searchMain === 'patrimonio' ? 'Nº Patrimonial / Código:' : searchMain === 'comarca' ? 'Comarca:' : searchMain === 'craai' ? 'CRAAI:' : 'Gerência:'}
                  </label>
                  {searchMain === 'patrimonio' ? (
                    <div className="relative">
                      <input
                        type="text"
                        value={searchValue}
                        onChange={(e) => setSearchValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleExecuteConsultation()}
                        placeholder="Ex: 88721"
                        className="w-full text-xs font-medium py-2 px-3 bg-white border border-gray-300 rounded-lg text-slate-800 placeholder-gray-400 focus:outline-[#3525cd] focus:ring-1 focus:ring-[#3525cd] pl-8"
                      />
                      <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-3" />
                    </div>
                  ) : (
                    <select
                      value={searchValue}
                      onChange={(e) => setSearchValue(e.target.value)}
                      className="w-full text-xs font-medium py-2 px-3 bg-white border border-gray-300 rounded-lg text-slate-800 placeholder-gray-400 focus:outline-[#3525cd] focus:ring-1 focus:ring-[#3525cd]"
                    >
                      <option value="">Selecione...</option>
                      {(searchMain === 'comarca' ? comarcaOptions : searchMain === 'craai' ? craaiOptions : managements.map((m) => m.name)).map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Status e Tipo (vão ao banco junto com o filtro principal) */}
              {searchMain !== 'patrimonio' && (
                <>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Status:
                    </label>
                    <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="w-full text-xs font-medium py-2 px-3 bg-white border border-gray-300 rounded-lg text-slate-800 placeholder-gray-400 focus:outline-[#3525cd] focus:ring-1 focus:ring-[#3525cd]">
                      <option value="">Todos</option>
                      <option value="Operando">Operando</option>
                      <option value="Em Manutenção">Em Manutenção</option>
                      <option value="Parado">Parado</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Tipo de Equipamento:
                    </label>
                    <select value={filterTipo} onChange={(e) => setFilterTipo(e.target.value)} className="w-full text-xs font-medium py-2 px-3 bg-white border border-gray-300 rounded-lg text-slate-800 placeholder-gray-400 focus:outline-[#3525cd] focus:ring-1 focus:ring-[#3525cd]">
                      <option value="">Todos</option>
                      {assetTypes.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    {assetTypes.length === 0 && (
                      <p className="text-[10px] text-slate-400 mt-1">A lista de tipos é montada ao importar a planilha de ativos.</p>
                    )}
                  </div>
                </>
              )}
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
              userHasActionPermission={userHasActionPermission}
              userProfile={userProfile}
              totalFound={totalFound}
              pageIndex={pageIndex}
              totalPages={totalPages}
              isLoadingPage={isConsulting}
              isExporting={isExporting}
              pageFilter={pageFilter}
              onPageFilterChange={setPageFilter}
              onPrevPage={handlePrevPage}
              onNextPage={handleNextPage}
              onExportExcel={handleExportExcel}
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
        assets={currentPageAssets}
      />

      {/* EDIT ASSET FORM MODAL (EXTRAÍDO NA ETAPA 3) */}
      <AssetEditModal
        isOpen={!!editingAsset}
        onClose={() => setEditingAsset(null)}
        asset={editingAsset}
        managements={managements}
        onSaveSuccess={(updatedAsset) => {
          replaceInPages(updatedAsset);
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
            handleClearFilters();
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
            removeFromPages(targetAsset.id);
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
          showSingleResult(newAsset);
          setSelectedAsset(newAsset);
        }}
      />

      {/* XLSX IMPORT MODAL (WIZARD - EXTRAÍDO NA ETAPA 2) */}
      <AssetImportWizardModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        assets={[]}
        managements={managements}
        periodicityRules={periodicityRules}
        onUpdatePeriodicityRules={setPeriodicityRules}
        onReloadAssets={() => {
          loadAssetsData();
          dbGetAssetTypes().then(setAssetTypes);
        }}
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
