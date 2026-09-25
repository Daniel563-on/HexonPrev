import React, { useState, useEffect } from 'react';
import { 
  FileSpreadsheet, 
  Upload, 
  Info, 
  Loader2, 
  CalendarCheck, 
  Trash2, 
  Check, 
  CheckSquare 
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Asset, Management } from '../../types';
import { dbSaveAssetsBulk, dbSavePeriodicityRules, dbFindAssetsByCodes } from '../../db/firebase';

export interface PeriodicityRule {
  keyword: string;
  selectPeriodicities: ('Mensal' | 'Trimestral' | 'Semestral' | 'Anual')[];
}

export interface AssetImportWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  assets: Asset[];
  managements: Management[];
  periodicityRules: PeriodicityRule[];
  onUpdatePeriodicityRules: (rules: PeriodicityRule[]) => void;
  onImportSuccess: (firstImportedAsset?: Asset) => void;
  onReloadAssets: () => Promise<void>;
  setCustomDynamicFields: (fields: string[]) => void;
}

export const AssetImportWizardModal: React.FC<AssetImportWizardModalProps> = ({
  isOpen,
  onClose,
  assets,
  managements,
  periodicityRules,
  onUpdatePeriodicityRules,
  onImportSuccess,
  onReloadAssets,
  setCustomDynamicFields
}) => {
  const [importStep, setImportStep] = useState<number>(1); // 1: Upload, 2: Map, 3: Done
  const [importRows, setImportRows] = useState<any[]>([]);
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [columnMappings, setColumnMappings] = useState<Record<string, string>>({});
  const [isProcessingImport, setIsProcessingImport] = useState<boolean>(false);
  const [importProgress, setImportProgress] = useState<number>(0);
  const [totalToImport, setTotalToImport] = useState<number>(0);
  
  const defaultSector = React.useMemo(() => {
    const valid = managements.filter(m => m.name !== 'Todas');
    return valid.length > 0 ? valid[0].name : 'Refrigeração';
  }, [managements]);

  const [importTargetSector, setImportTargetSector] = useState<string>(defaultSector);
  
  const [importStats, setImportStats] = useState<{
    totalProcessed: number;
    newCount: number;
    updatedCount: number;
    unchangedCount: number;
  }>({
    totalProcessed: 0,
    newCount: 0,
    updatedCount: 0,
    unchangedCount: 0
  });

  const [newRuleKeyword, setNewRuleKeyword] = useState<string>('');
  const [newRulePeriodicities, setNewRulePeriodicities] = useState<('Mensal' | 'Trimestral' | 'Semestral' | 'Anual')[]>(['Mensal']);

  useEffect(() => {
    if (isOpen) {
      setImportStep(1);
      setImportRows([]);
      setImportHeaders([]);
      setColumnMappings({});
      setIsProcessingImport(false);
      setImportProgress(0);
      setTotalToImport(0);
      setImportTargetSector(defaultSector);
    }
  }, [isOpen, defaultSector]);

  if (!isOpen) return null;

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
          } else if (lower === 'material' || lower === 'equipamento' || lower === 'ativo' || lower === 'nome' || lower === 'name' || lower === 'descrição' || lower === 'descricao') {
            autoMap['name'] = h; // MATERIAL
          } else if (lower === 'tipo' || lower === 'categoria' || lower === 'type' || lower === 'classificação' || lower === 'classificacao') {
            autoMap['tipo'] = h; // TIPO
          } else if (lower === 'marca' || lower === 'fabricante' || lower === 'manufacturer') {
            autoMap['manufacturer'] = h; // MARCA
          } else if (lower === 'modelo' || lower === 'model') {
            autoMap['model'] = h; // MODELO
          } else if (lower === 'nº de série' || lower === 'numero de serie' || lower === 'n de serie' || lower === 'serie' || lower === 'serial' || lower === 'serialnumber') {
            autoMap['serialNumber'] = h; // Nº DE SÉRIE
          } else if (lower === 'status' || lower === 'situação' || lower === 'situacao') {
            autoMap['status'] = h; // STATUS
          } else if (lower.includes('aquisição') || lower.includes('aquisicao') || lower.includes('data')) {
            if (lower.includes('valor')) {
              autoMap['acquisitionValue'] = h; // VALOR DE AQUISIÇÃO
            } else {
              autoMap['installationDate'] = h; // DATA DE AQUISIÇÃO
            }
          } else if (lower.includes('líquido') || lower.includes('liquido') || lower.includes('residual')) {
            autoMap['netValue'] = h; // VALOR LÍQUIDO
          }
        });

        setColumnMappings(autoMap);
        setImportStep(2); // Jump directly to field mapping step
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
          return ['Mensal', 'Trimestral', 'Anual']; // Electrical standard
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

      // Busca no banco os ativos que já existem com os patrimônios da planilha (atualiza em vez de duplicar)
      const sheetCodes = importRows
        .map((row) => String(row[columnMappings['code']] || '').trim().toUpperCase())
        .filter(Boolean);
      const alreadySaved = await dbFindAssetsByCodes(sheetCodes);
      const existingMap = new Map<string, Asset>();
      for (const a of [...assets, ...alreadySaved]) {
        if (a.code) {
          existingMap.set(a.code.toUpperCase().trim(), a);
        }
      }

      let newCount = 0;
      let updatedCount = 0;
      let unchangedCount = 0;

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

        const rawCodeUpper = rawCode.toUpperCase();
        const existing = existingMap.get(rawCodeUpper);

        if (existing) {
          // Asset with this patrimônio already exists.
          // Compare fields to detect if anything actually changed before saving.
          const existingSpecs: Record<string, any> = (existing.specs as any) || {};
          const targetPeriodicities = pArray.length > 0 ? pArray : (existing.periodicities || []);

          const nameChanged = (existing.name || '').trim() !== rawName;
          const sectorChanged = (existing.sector || '').trim() !== importTargetSector.trim();
          const locationChanged = (existing.location || '').trim() !== rawLocation;
          const statusChanged = existing.status !== rawStatus;

          const specManufacturerChanged = (existingSpecs.manufacturer || '').trim() !== rawMarca;
          const specModelChanged = (existingSpecs.model || '').trim() !== rawModelo;
          const specSerialChanged = (existingSpecs.serialNumber || '').trim() !== rawSerie;
          const specInstallDateChanged = (existingSpecs.installationDate || '').trim() !== rawDataAquisicao.split('T')[0];
          const specCRAAIChanged = (existingSpecs.CRAAI || '').trim() !== rawCRAAI;
          const specComarcaChanged = (existingSpecs.COMARCA || '').trim() !== rawComarca;
          const specTipoChanged = (existingSpecs.TIPO || '').trim() !== rawTipo;
          const specValorAqChanged = (existingSpecs['VALOR DE AQUISIÇÃO'] || '').trim() !== rawValorAquisicao;
          const specValorLiqChanged = (existingSpecs['VALOR LÍQUIDO'] || '').trim() !== rawValorLiquido;

          // Check if periodicities changed
          const existingPStr = (existing.periodicities || []).slice().sort().join(',');
          const newPStr = targetPeriodicities.slice().sort().join(',');
          const periodicitiesChanged = existingPStr !== newPStr;

          const hasAnyChange =
            nameChanged ||
            sectorChanged ||
            locationChanged ||
            statusChanged ||
            specManufacturerChanged ||
            specModelChanged ||
            specSerialChanged ||
            specInstallDateChanged ||
            specCRAAIChanged ||
            specComarcaChanged ||
            specTipoChanged ||
            specValorAqChanged ||
            specValorLiqChanged ||
            periodicitiesChanged;

          if (!hasAnyChange) {
            unchangedCount++;
            continue;
          }

          // Asset has changed fields: update only the delta
          updatedCount++;
          const assetSpecs: any = {
            ...existing.specs,
            manufacturer: rawMarca,
            model: rawModelo,
            serialNumber: rawSerie,
            installationDate: rawDataAquisicao.split('T')[0],
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

          const updatedAsset: Asset = {
            ...existing,
            name: rawName,
            sector: importTargetSector,
            location: rawLocation,
            status: rawStatus,
            specs: assetSpecs,
            periodicities: targetPeriodicities,
            updatedAt: nowString
          };

          parsedAssets.push(updatedAsset);
        } else {
          // Generate ID based on selected target sector for a new asset
          newCount++;
          const formattedSectorName = importTargetSector.toLowerCase().replace('/', '_');
          const uniqueId = `as_${formattedSectorName}_${Date.now().toString().slice(-4)}_${Math.random().toString(36).substring(2, 6)}`;

          const assetSpecs: any = {
            manufacturer: rawMarca,
            model: rawModelo,
            serialNumber: rawSerie,
            installationDate: rawDataAquisicao.split('T')[0],
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
            code: rawCodeUpper,
            name: rawName,
            sector: importTargetSector,
            location: rawLocation,
            status: rawStatus,
            specs: assetSpecs,
            createdAt: nowString,
            periodicities: pArray
          };

          parsedAssets.push(newAsset);
          existingMap.set(rawCodeUpper, newAsset); // patrimônio repetido na planilha atualiza o mesmo ativo
        }
      }

      setImportStats({
        totalProcessed: importRows.length,
        newCount,
        updatedCount,
        unchangedCount
      });

      if (parsedAssets.length === 0) {
        if (unchangedCount > 0) {
          setImportStep(3);
          setIsProcessingImport(false);
          return;
        }
        alert('Nenhum ativo válido pôde ser extraído da planilha.');
        setIsProcessingImport(false);
        return;
      }

      // Save only new or modified assets in database
      await dbSaveAssetsBulk(parsedAssets);

      // Save dynamic custom fields from import headers
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

      setImportStep(3);
      await onReloadAssets();
      
      if (parsedAssets.length > 0) {
        onImportSuccess(parsedAssets[0]);
      }

    } catch (err) {
      console.error('Import error:', err);
      alert('Houve um erro técnico realizando a gravação em lote. Entre em contato com o suporte.');
    } finally {
      setIsProcessingImport(false);
    }
  };

  const updateAndPersistRules = (updated: PeriodicityRule[]) => {
    onUpdatePeriodicityRules(updated);
    localStorage.setItem('hexon_periodicity_rules', JSON.stringify(updated));
    dbSavePeriodicityRules(updated).catch(e => console.warn('Erro ao salvar regras no banco:', e));
  };

  return (
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
            type="button"
            onClick={() => {
              if (!isProcessingImport) onClose();
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
                      style={{ width: `${(importProgress / Math.max(1, totalToImport)) * 100}%` }}
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
                            <option value="Refrigeração">Refrigeração</option>
                            <option value="Elétrica">Elétrica</option>
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
                                  {(['Mensal', 'Trimestral', 'Semestral', 'Anual'] as const).map((p) => {
                                    const isChecked = rule.selectPeriodicities.includes(p);
                                    return (
                                      <button
                                        key={p}
                                        type="button"
                                        onClick={() => {
                                          const updated = [...periodicityRules];
                                          const updatedList = isChecked 
                                            ? rule.selectPeriodicities.filter(x => x !== p)
                                            : [...rule.selectPeriodicities, p];
                                          
                                          const order = ['Mensal', 'Trimestral', 'Semestral', 'Anual'];
                                          updatedList.sort((a,b) => order.indexOf(a) - order.indexOf(b));
                                          
                                          updated[idx] = { ...rule, selectPeriodicities: updatedList };
                                          updateAndPersistRules(updated);
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
                                    updateAndPersistRules(updated);
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
                          {(['Mensal', 'Trimestral', 'Semestral', 'Anual'] as const).map((p) => {
                            const isChecked = newRulePeriodicities.includes(p);
                            return (
                              <label key={p} className="flex items-center gap-0.5 text-[9px] font-black cursor-pointer text-[#0b1c30]">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => {
                                    if (isChecked) {
                                      setNewRulePeriodicities(newRulePeriodicities.filter(x => x !== p));
                                    } else {
                                      setNewRulePeriodicities([...newRulePeriodicities, p]);
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
                            updateAndPersistRules(updated);
                            setNewRuleKeyword('');
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
                <h3 className="font-black text-sm text-[#0b1c30]">Sincronização de Ativos Concluída!</h3>
                <p className="text-xs text-gray-500 max-w-md mx-auto leading-relaxed block">
                  A planilha foi comparada com a base de dados. Somente novos ativos e alterações reais foram gravados, economizando operações de banco.
                </p>
              </div>
              
              <div className="max-w-xs mx-auto p-3 bg-gray-50 rounded-lg text-left text-[11px] text-gray-500 space-y-1.5 shadow-xs border border-gray-200/60">
                <span className="font-bold uppercase tracking-wider text-[9px] text-gray-400 block mb-1">Resumo Diferencial</span>
                <div className="flex justify-between">
                  <span>Total Analisado na Planilha:</span>
                  <strong className="text-slate-800 font-bold">{importStats.totalProcessed}</strong>
                </div>
                <div className="flex justify-between text-emerald-700">
                  <span>Novos Ativos Inseridos:</span>
                  <strong className="font-bold">+{importStats.newCount}</strong>
                </div>
                <div className="flex justify-between text-blue-700">
                  <span>Ativos com Dados Atualizados:</span>
                  <strong className="font-bold">{importStats.updatedCount}</strong>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>Idênticos (Sem regravação):</span>
                  <strong className="font-bold">{importStats.unchangedCount}</strong>
                </div>
                <div className="pt-1.5 border-t border-gray-200 flex justify-between text-[10px]">
                  <span className="text-slate-400">Gravações no Banco:</span>
                  <strong className="text-emerald-600 font-bold">{importStats.newCount + importStats.updatedCount} ({importStats.unchangedCount} poupadas)</strong>
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
                onClick={onClose}
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
                onClose();
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
  );
};

export default AssetImportWizardModal;
