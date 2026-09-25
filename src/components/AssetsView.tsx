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
  dbGetAddresses,
  subscribeLocalAssets,
  forceFullAssetResync,
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

  // Filtros da lista (aplicados na hora sobre a cópia local de todos os ativos)
  const [searchText, setSearchText] = useState('');
  const [filterTipoBem, setFilterTipoBem] = useState<'Operando' | 'Em Manutenção' | 'Parado' | 'Todos'>('Todos');
  const [filterGerencia, setFilterGerencia] = useState('Todas');
  const [filterCraai, setFilterCraai] = useState('Todas');
  const [filterUnidade, setFilterUnidade] = useState('Todas');
  const [filterTipoEquipamento, setFilterTipoEquipamento] = useState('Todos');
  const [assetsReady, setAssetsReady] = useState(false);
  const [isResyncing, setIsResyncing] = useState(false);
  const [addressCraais, setAddressCraais] = useState<{ craai: string; comarca: string }[]>([]);

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

  // Cópia local de todos os ativos (sincronizada em tempo real, só o que muda)
  useEffect(() => {
    const unsubscribe = subscribeLocalAssets((list) => {
      setAssets(list);
      setAssetsReady(true);
    });
    dbGetAddresses().then((list) => setAddressCraais(list.map((a) => ({ craai: a.craai, comarca: a.comarca }))));
    return unsubscribe;
  }, []);

  // Listas dos filtros: CRAAI e Comarca do cadastro de Endereços; Tipo com os valores reais dos ativos
  const craaiOptions = React.useMemo(
    () => ['Todas', ...Array.from(new Set<string>(addressCraais.map((a) => a.craai).filter(Boolean))).sort((a, b) => a.localeCompare(b))],
    [addressCraais]
  );
  const availableUnits = React.useMemo(() => {
    const list = addressCraais.filter((a) => filterCraai === 'Todas' || a.craai === filterCraai).map((a) => a.comarca);
    return ['Todas', ...Array.from(new Set<string>(list.filter(Boolean))).sort((a, b) => a.localeCompare(b))];
  }, [addressCraais, filterCraai]);
  const commonEquipmentTypes = React.useMemo(
    () => ['Todos', ...Array.from(new Set<string>(assets.map((a) => String(a.specs?.TIPO || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b))],
    [assets]
  );

  // Lista filtrada na hora: a busca procura em patrimônio, nome, série, sala, fabricante e modelo
  const consultationResults = React.useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const has = (value: any) => String(value || '').toLowerCase().includes(q);
    return assets
      .filter((a) => {
        if (filterTipoBem !== 'Todos' && a.status !== filterTipoBem) return false;
        if (filterGerencia !== 'Todas' && a.sector !== filterGerencia) return false;
        if (filterCraai !== 'Todas' && String(a.specs?.CRAAI || '') !== filterCraai) return false;
        if (filterUnidade !== 'Todas' && String(a.specs?.COMARCA || '') !== filterUnidade) return false;
        if (filterTipoEquipamento !== 'Todos' && String(a.specs?.TIPO || '').trim() !== filterTipoEquipamento) return false;
        if (!q) return true;
        return [
          a.code, a.id, a.name, a.location,
          a.specs?.PATRIMONIO, a.specs?.serialNumber, a.specs?.['Nº DE SÉRIE'],
          a.specs?.setor, a.specs?.SETOR, a.specs?.sala,
          a.specs?.manufacturer, a.specs?.MARCA, a.specs?.model, a.specs?.MODELO, a.specs?.TIPO
        ].some(has);
      })
      .sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
  }, [assets, searchText, filterTipoBem, filterGerencia, filterCraai, filterUnidade, filterTipoEquipamento]);

  const filtersKey = [searchText, filterTipoBem, filterGerencia, filterCraai, filterUnidade, filterTipoEquipamento].join('|');
  const hasActiveFilters = filtersKey !== ['', 'Todos', 'Todas', 'Todas', 'Todas', 'Todos'].join('|');

  const handleClearFilters = () => {
    setSearchText('');
    setFilterTipoBem('Todos');
    setFilterGerencia('Todas');
    setFilterCraai('Todas');
    setFilterUnidade('Todas');
    setFilterTipoEquipamento('Todos');
    setSelectedAsset(null);
  };

  // Recuperação manual: baixa todos os ativos de novo
  const handleFullResync = async () => {
    if (!window.confirm('Baixar novamente todos os ativos do banco? Use só se a lista parecer desatualizada.')) return;
    setIsResyncing(true);
    try {
      await forceFullAssetResync();
    } catch (err: any) {
      alert(`Não foi possível sincronizar: ${err?.message || err}`);
    } finally {
      setIsResyncing(false);
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
            Ativos
          </h1>
          <p className="text-[10px] font-bold text-slate-400 mt-1 flex items-center gap-2">
            {assetsReady
              ? `${assets.length} ativos na cópia local · atualizada em tempo real`
              : 'Preparando a cópia local dos ativos...'}
            {assetsReady && userProfile?.perfil !== 'Profissional' && (
              <button
                type="button"
                onClick={handleFullResync}
                disabled={isResyncing}
                className="text-[#3525cd] hover:underline cursor-pointer disabled:opacity-50"
              >
                {isResyncing ? 'Sincronizando...' : 'Sincronizar tudo'}
              </button>
            )}
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
        <>
          {/* FILTROS (aplicados na hora) */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Buscar patrimônio, nome, série, sala, fabricante, modelo..."
                className="w-full text-sm font-medium py-2.5 pl-10 pr-3 bg-slate-50 border border-gray-300 rounded-xl text-slate-800 placeholder-gray-400 focus:outline-[#3525cd] focus:ring-1 focus:ring-[#3525cd]"
              />
            </div>
            <div className="flex flex-col lg:flex-row lg:items-center gap-2">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 flex-1">
                <select value={filterGerencia} onChange={(e) => setFilterGerencia(e.target.value)} className="text-xs font-bold py-2 px-2.5 bg-white border border-gray-300 rounded-lg text-slate-800 focus:outline-[#3525cd] focus:ring-1 focus:ring-[#3525cd] cursor-pointer">
                  <option value="Todas">Gerência: Todas</option>
                  {managements.map((m) => (
                    <option key={m.id} value={m.name}>{m.name}</option>
                  ))}
                </select>
                <select
                  value={filterCraai}
                  onChange={(e) => {
                    setFilterCraai(e.target.value);
                    setFilterUnidade('Todas');
                  }}
                  className="text-xs font-bold py-2 px-2.5 bg-white border border-gray-300 rounded-lg text-slate-800 focus:outline-[#3525cd] focus:ring-1 focus:ring-[#3525cd] cursor-pointer"
                >
                  {craaiOptions.map((c) => (
                    <option key={c} value={c}>{c === 'Todas' ? 'CRAAI: Todas' : c}</option>
                  ))}
                </select>
                <select value={filterUnidade} onChange={(e) => setFilterUnidade(e.target.value)} className="text-xs font-bold py-2 px-2.5 bg-white border border-gray-300 rounded-lg text-slate-800 focus:outline-[#3525cd] focus:ring-1 focus:ring-[#3525cd] cursor-pointer">
                  {availableUnits.map((u) => (
                    <option key={u} value={u}>{u === 'Todas' ? 'Comarca: Todas' : u}</option>
                  ))}
                </select>
                <select value={filterTipoEquipamento} onChange={(e) => setFilterTipoEquipamento(e.target.value)} className="text-xs font-bold py-2 px-2.5 bg-white border border-gray-300 rounded-lg text-slate-800 focus:outline-[#3525cd] focus:ring-1 focus:ring-[#3525cd] cursor-pointer">
                  {commonEquipmentTypes.map((t) => (
                    <option key={t} value={t}>{t === 'Todos' ? 'Tipo: Todos' : t}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200 shrink-0">
                {(['Todos', 'Operando', 'Em Manutenção', 'Parado'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setFilterTipoBem(option)}
                    className={`py-1 px-2.5 rounded-md text-[11px] font-bold transition-all cursor-pointer whitespace-nowrap ${
                      filterTipoBem === option ? 'bg-[#0b1c30] text-white shadow-xs' : 'text-slate-600 hover:bg-white'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
            {hasActiveFilters && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="text-[11px] font-bold text-slate-500 hover:text-[#3525cd] flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" /> Limpar filtros
                </button>
              </div>
            )}
          </div>

          {/* RESULTADO */}
          {!assetsReady ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-xs font-bold text-slate-400 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Preparando a cópia local dos ativos...
            </div>
          ) : (
            <AssetConsultationTable
              results={consultationResults}
              resetKey={filtersKey}
              onSelectAsset={(asset) => setSelectedAsset(asset)}
              onEditAsset={(asset) => handleOpenEditModal(asset)}
              onDeleteAsset={(asset) => handleDeleteAssetTrigger(asset)}
              userHasActionPermission={userHasActionPermission}
              userProfile={userProfile}
              pageSize={50}
            />
          )}
        </>
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
        assets={consultationResults.slice(0, 30)}
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
