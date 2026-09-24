import React, { useState, useMemo, useEffect } from 'react';
import {
  Calendar,
  Sliders,
  AlertTriangle,
  Trash2,
  Plus,
  CheckCircle2,
  Sparkles,
  RefreshCw,
  Activity,
  ShieldAlert
} from 'lucide-react';
import {
  MaintenanceTemplate,
  Asset,
  ServiceOrder,
  Management,
  formatDateBR
} from '../../types';
import { formatOrderNumber } from '../../utils/orderNumber';
import { dbAutoGeneratePreventiveActivities, dbGetDispatchedIds, buildPreventiveOrderId } from '../../db/firebase';
import {
  getPeriodKey,
  getAssetComarcaClean,
  isAssetCompatibleWithTemplate,
  alignPeriodDates,
  defaultScopeInfo
} from '../../utils/templateScheduler';

export interface TemplateGeneratorTabProps {
  templates: MaintenanceTemplate[];
  assets: Asset[];
  existingComarcas: string[];
  existingSectors: string[];
  managements: Management[];
  onRefreshData: () => Promise<void>;
  onTemplatesUpdated?: () => void;
}

export default function TemplateGeneratorTab({
  templates,
  assets,
  existingComarcas,
  existingSectors,
  managements,
  onRefreshData,
  onTemplatesUpdated
}: TemplateGeneratorTabProps) {
  // Generation Tool states (support multiple identical filter lines)
  const [filterRows, setFilterRows] = useState<Array<{
    id: string;
    templateId: string;
    comarca: string;
    sector: string;
    startDate: string;
    endDate: string;
  }>>(() => [
    {
      id: 'init_row_' + Date.now(),
      templateId: 'all',
      comarca: 'all',
      sector: 'all',
      startDate: new Date().toISOString().slice(0, 10),
      endDate: (() => {
        const d = new Date();
        d.setDate(d.getDate() + 30); // Default to 30 days ahead
        return d.toISOString().slice(0, 10);
      })()
    }
  ]);

  const [isGenerating, setIsGenerating] = useState(false);
  const [generationSummaryMsg, setGenerationSummaryMsg] = useState<string | null>(null);

  const addFilterRow = () => {
    setFilterRows([
      ...filterRows,
      {
        id: 'row_' + Math.random().toString(36).substring(2, 9),
        templateId: 'all',
        comarca: 'all',
        sector: 'all',
        startDate: new Date().toISOString().slice(0, 10),
        endDate: (() => {
          const d = new Date();
          d.setDate(d.getDate() + 30);
          return d.toISOString().slice(0, 10);
        })()
      }
    ]);
  };

  const removeFilterRow = (id: string) => {
    if (filterRows.length > 1) {
      setFilterRows(filterRows.filter((row) => row.id !== id));
    }
  };

  const updateFilterRow = (id: string, field: string, value: string) => {
    setFilterRows(
      filterRows.map((row) => {
        if (row.id === id) {
          return { ...row, [field]: value };
        }
        return row;
      })
    );
  };

  // Trigger programmed activities generation
  const handleExecuteGeneration = async () => {
    setIsGenerating(true);
    setGenerationSummaryMsg(null);
    try {
      const added = await dbAutoGeneratePreventiveActivities(filterRows);

      setGenerationSummaryMsg(
        `Sucesso! Foram programadas e inseridas no banco de dados ${added} novas ordens de serviço preventivas/inspeções com base no lote de ${filterRows.length} linhas de filtros configurados.`
      );

      await onRefreshData();
      setDispatchRefreshToken((n) => n + 1);
      if (onTemplatesUpdated) onTemplatesUpdated();
    } catch (err: any) {
      console.error(err);
      alert(err?.message || 'Houve um erro técnico processando o seu agendamento programado.');
      // Parte das ordens pode ter sido gravada: atualiza a lista mesmo com erro
      await onRefreshData().catch(() => {});
      setDispatchRefreshToken((n) => n + 1);
    } finally {
      setIsGenerating(false);
    }
  };

  // 1. OS já disparadas: lidas do registro do disparo (poucos documentos), sem baixar as ordens.
  //    O número da OS é fixo (ativo + periodicidade + início do período), então basta conferir o número.
  const [dispatchedIds, setDispatchedIds] = useState<Set<string>>(new Set());
  const [dispatchRefreshToken, setDispatchRefreshToken] = useState(0);
  const periodStartDates = useMemo(() => {
    const periodicities = new Set<string>(['Semanal']);
    templates.forEach((t) => (t.periodicity || '').split(',').forEach((p) => p.trim() && periodicities.add(p.trim())));
    const dates = new Set<string>();
    filterRows.forEach((row) => periodicities.forEach((p) => dates.add(alignPeriodDates(row.startDate, p).startDate)));
    return Array.from(dates).sort();
  }, [filterRows, templates]);
  const periodStartDatesKey = periodStartDates.join(',');
  useEffect(() => {
    let active = true;
    dbGetDispatchedIds(periodStartDates).then((ids) => {
      if (active) setDispatchedIds(ids);
    });
    return () => {
      active = false;
    };
  }, [periodStartDatesKey, dispatchRefreshToken]);

  // 2. High performance assets grouped by comarca
  const assetsByComarca = useMemo(() => {
    const map = new Map<string, Asset[]>();
    for (let i = 0; i < assets.length; i++) {
      const a = assets[i];
      const c = getAssetComarcaClean(a).toLowerCase();
      let list = map.get(c);
      if (!list) {
        list = [];
        map.set(c, list);
      }
      list.push(a);
    }
    return map;
  }, [assets]);

  const checkPreventiveAlreadyExists = (assetId: string, periodicity: string, startDateStr: string): boolean => {
    const dates = alignPeriodDates(startDateStr, periodicity);
    return dispatchedIds.has(buildPreventiveOrderId(assetId, periodicity, dates.startDate));
  };

  const checkSurveyAlreadyExists = (comarcaName: string, templateId: string, startDateStr: string): boolean => {
    const dates = alignPeriodDates(startDateStr, 'Semanal');
    return dispatchedIds.has(buildPreventiveOrderId(`VST_${templateId}_${comarcaName}`, 'Semanal', dates.startDate));
  };

  // Helper to compute available Comarcas and Gerências for a filter row:
  const getRowScopeInfo = (row: {
    id: string;
    templateId: string;
    comarca: string;
    sector: string;
    startDate: string;
    endDate: string;
  }) => {
    const targetTemplates = templates.filter((t) => {
      if (row.templateId !== 'all' && t.id !== row.templateId) return false;
      return true;
    });

    // Calculate pending counts per comarca
    const comarcaStats: Record<string, number> = {};

    for (let i = 0; i < existingComarcas.length; i++) {
      const comarcaName = existingComarcas[i];
      const comarcaLower = comarcaName.toLowerCase().trim();
      let pendingForComarca = 0;

      for (let j = 0; j < targetTemplates.length; j++) {
        const t = targetTemplates[j];
        if (t.type === 'survey') {
          if (row.sector !== 'all') {
            const tSector = (t.targetSectorOrType || '').toLowerCase().trim();
            if (tSector !== row.sector.toLowerCase().trim()) continue;
          }
          const already = checkSurveyAlreadyExists(comarcaName, t.id, row.startDate);
          if (!already) {
            pendingForComarca++;
          }
        } else if (t.type === 'preventive') {
          const comarcaAssets = assetsByComarca.get(comarcaLower) || [];
          if (comarcaAssets.length === 0) continue;

          const tPeriodicities = (t.periodicity || '').split(',').map((p) => p.trim());
          for (let k = 0; k < comarcaAssets.length; k++) {
            const a = comarcaAssets[k];
            if (row.sector !== 'all' && a.sector && a.sector.toLowerCase().trim() !== row.sector.toLowerCase().trim())
              continue;
            if (!isAssetCompatibleWithTemplate(a, t)) continue;

            const commonPeriodicities = (a.periodicities || []).filter((ap) =>
              tPeriodicities.some((tp) => tp.toLowerCase() === ap.toLowerCase())
            );
            for (let pIdx = 0; pIdx < commonPeriodicities.length; pIdx++) {
              const p = commonPeriodicities[pIdx];
              const already = checkPreventiveAlreadyExists(a.id, p, row.startDate);
              if (!already) {
                pendingForComarca++;
              }
            }
          }
        }
      }

      if (pendingForComarca > 0) {
        comarcaStats[comarcaName] = pendingForComarca;
      }
    }

    const eligibleComarcas = Object.entries(comarcaStats)
      .map(([comarca, pendingCount]) => ({
        comarca,
        pendingCount
      }))
      .sort((a, b) => a.comarca.localeCompare(b.comarca));

    const totalComarcaPending = eligibleComarcas.reduce((acc, curr) => acc + curr.pendingCount, 0);

    // Calculate pending counts per sector/gerência
    const sectorStats: Record<string, number> = {};

    for (let j = 0; j < targetTemplates.length; j++) {
      const t = targetTemplates[j];
      if (t.type === 'survey') {
        const sectorName = t.targetSectorOrType || 'GMMR';
        for (let i = 0; i < existingComarcas.length; i++) {
          const comarcaName = existingComarcas[i];
          if (row.comarca !== 'all' && comarcaName.toLowerCase().trim() !== row.comarca.toLowerCase().trim()) continue;

          const already = checkSurveyAlreadyExists(comarcaName, t.id, row.startDate);
          if (!already) {
            sectorStats[sectorName] = (sectorStats[sectorName] || 0) + 1;
          }
        }
      } else if (t.type === 'preventive') {
        const tPeriodicities = (t.periodicity || '').split(',').map((p) => p.trim());
        const candidateAssets =
          row.comarca === 'all' ? assets : assetsByComarca.get(row.comarca.toLowerCase().trim()) || [];

        for (let k = 0; k < candidateAssets.length; k++) {
          const asset = candidateAssets[k];
          if (!isAssetCompatibleWithTemplate(asset, t)) continue;

          const sectorName = asset.sector || t.targetSectorOrType || 'GMMR';
          const commonPeriodicities = (asset.periodicities || []).filter((ap) =>
            tPeriodicities.some((tp) => tp.toLowerCase() === ap.toLowerCase())
          );
          for (let pIdx = 0; pIdx < commonPeriodicities.length; pIdx++) {
            const p = commonPeriodicities[pIdx];
            const already = checkPreventiveAlreadyExists(asset.id, p, row.startDate);
            if (!already) {
              sectorStats[sectorName] = (sectorStats[sectorName] || 0) + 1;
            }
          }
        }
      }
    }

    const eligibleSectors = Object.entries(sectorStats)
      .map(([sector, pendingCount]) => ({
        sector,
        pendingCount
      }))
      .sort((a, b) => a.sector.localeCompare(b.sector));

    const totalSectorPending = eligibleSectors.reduce((acc, curr) => acc + curr.pendingCount, 0);

    return {
      eligibleComarcas,
      totalComarcaPending,
      eligibleSectors,
      totalSectorPending
    };
  };

  // Precompute rowScopeMap using useMemo so it never re-runs during render
  const rowScopeMap = useMemo(() => {
    const map = new Map<
      string,
      {
        eligibleComarcas: { comarca: string; pendingCount: number }[];
        totalComarcaPending: number;
        eligibleSectors: { sector: string; pendingCount: number }[];
        totalSectorPending: number;
      }
    >();

    for (let i = 0; i < filterRows.length; i++) {
      const row = filterRows[i];
      map.set(row.id, getRowScopeInfo(row));
    }
    return map;
  }, [filterRows, templates, assets, dispatchedIds, assetsByComarca, existingComarcas]);

  // FRONTEND SIMULATOR / DRY-RUN CALCULATOR
  const calculateDryRunSimulation = () => {
    const previewList: {
      id: number;
      assetName: string;
      assetCode: string;
      title: string;
      periodicity: string;
      scheduledDate: string;
      startDate: string;
      endDate: string;
      type: 'preventive' | 'survey';
      management?: string;
      comarca?: string;
      alreadyExists?: boolean;
    }[] = [];

    let idCounter = 1;

    for (const row of filterRows) {
      if (row.comarca === 'none' || row.sector === 'none') continue;

      // Filter templates to generate
      const targetTemplates = templates.filter((t) => {
        if (row.templateId !== 'all' && t.id !== row.templateId) return false;
        return true;
      });

      for (const t of targetTemplates) {
        if (t.type === 'survey') {
          if (row.sector !== 'all') {
            const tSector = (t.targetSectorOrType || '').toLowerCase().trim();
            const rowSector = row.sector.toLowerCase().trim();
            if (tSector !== rowSector) continue;
          }

          const targetComarcas =
            row.comarca === 'all'
              ? existingComarcas
              : existingComarcas.filter((c) => c.toLowerCase().trim() === row.comarca.toLowerCase().trim());

          for (const comarca of targetComarcas) {
            const alreadyExists = checkSurveyAlreadyExists(comarca, t.id, row.startDate);
            const dates = alignPeriodDates(row.startDate, 'Semanal');

            previewList.push({
              id: idCounter++,
              assetName: `Área Geral / Predial (${comarca})`,
              assetCode: 'VISTORIA-PREDIAL',
              title: `${t.name} - ${comarca}`,
              periodicity: 'Semanal',
              scheduledDate: dates.scheduledDate,
              startDate: dates.startDate,
              endDate: dates.endDate,
              type: 'survey',
              management: t.targetSectorOrType || 'GMMR',
              comarca: comarca,
              alreadyExists: alreadyExists
            });
          }
        } else if (t.type === 'preventive') {
          const candidateAssets =
            row.comarca === 'all' ? assets : assetsByComarca.get(row.comarca.toLowerCase().trim()) || [];

          const matchingAssets = candidateAssets.filter((asset) => {
            const assetComarca = getAssetComarcaClean(asset);
            if (row.comarca !== 'all' && assetComarca.toLowerCase().trim() !== row.comarca.toLowerCase().trim())
              return false;
            if (row.sector !== 'all' && asset.sector && asset.sector.toLowerCase().trim() !== row.sector.toLowerCase().trim())
              return false;
            return isAssetCompatibleWithTemplate(asset, t);
          });

          const templatePeriodicities = (t.periodicity || '').split(',').map((p) => p.trim());

          for (const asset of matchingAssets) {
            const commonPeriodicities = (asset.periodicities || []).filter((ap) =>
              templatePeriodicities.some((tp) => tp.toLowerCase() === ap.toLowerCase())
            );

            for (const periodicity of commonPeriodicities) {
              const alreadyExists = checkPreventiveAlreadyExists(asset.id, periodicity, row.startDate);
              const dates = alignPeriodDates(row.startDate, periodicity);

              previewList.push({
                id: idCounter++,
                assetName: asset.name,
                assetCode: asset.code,
                title: `${t.name} (${periodicity}) - ${asset.code}`,
                periodicity: periodicity,
                scheduledDate: dates.scheduledDate,
                startDate: dates.startDate,
                endDate: dates.endDate,
                type: 'preventive',
                management: asset.sector || t.targetSectorOrType || 'Refrigeração',
                comarca: getAssetComarcaClean(asset) || 'Geral',
                alreadyExists: alreadyExists
              });
            }
          }
        }
      }
    }

    return previewList;
  };

  const simulationRecords = useMemo(() => {
    return calculateDryRunSimulation();
  }, [filterRows, templates, assets, dispatchedIds, rowScopeMap, assetsByComarca, existingComarcas]);

  // Check for duplicate rows in filterRows
  const duplicateRowMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (let i = 0; i < filterRows.length; i++) {
      const r1 = filterRows[i];
      const isDup = filterRows.some((r2, idx) => {
        if (idx === i) return false;
        return (
          r1.templateId === r2.templateId &&
          r1.comarca === r2.comarca &&
          r1.sector === r2.sector &&
          r1.startDate === r2.startDate &&
          r1.endDate === r2.endDate
        );
      });
      if (isDup) {
        map[r1.id] = true;
      }
    }
    return map;
  }, [filterRows]);

  const hasDuplicateRuleError = useMemo(() => {
    return Object.values(duplicateRowMap).some((v) => v);
  }, [duplicateRowMap]);

  const removeDuplicateFilters = () => {
    const seen = new Set<string>();
    const uniqueRows = filterRows.filter((r) => {
      const key = `${r.templateId}-${r.comarca}-${r.sector}-${r.startDate}-${r.endDate}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    setFilterRows(uniqueRows);
  };

  return (
    <div className="space-y-6">
      {/* Main Control Panel Dashboard */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-6 shadow-sm">
        <h2 className="text-lg font-black text-[#0b1c30] flex items-center gap-2">
          <Calendar className="w-5 h-5 text-emerald-600" />
          Geração de Atividades Preventivas Programadas em Lote
        </h2>
        <p className="text-xs text-slate-500 leading-relaxed max-w-4xl">
          Nesta área você pode expandir a malha preventiva de todos os seus ativos cadastrados instantaneamente. O
          motor irá varrer a base de dados de equipamentos, ler suas parametrizações de periodicidade descritas no "Tipo"
          e emitir as ordens de vistorias correspondentes na fila de execução.
        </p>

        {/* Dynamic list of filter rows */}
        <div className="space-y-4">
          <div className="flex justify-between items-center bg-slate-100 p-3.5 rounded-xl border border-gray-200">
            <span className="text-xs font-black text-[#0b1c30] flex items-center gap-1.5">
              <Sliders className="w-4 h-4 text-emerald-600 animate-pulse" />
              Grade de Lote Preventiva / Filtros Ativos
            </span>
            <span className="text-[10px] bg-emerald-100 text-emerald-800 py-0.5 px-2 rounded-full font-bold">
              {filterRows.length} {filterRows.length === 1 ? 'Filtro cadastrado' : 'Filtros cadastrados'}
            </span>
          </div>

          <div className="space-y-3">
            {filterRows.map((row, index) => {
              const filteredTemplatesForSelect = templates.filter((t) => {
                if (row.sector === 'all') return true;
                const tSector = (t.targetSectorOrType || '').toLowerCase().trim();
                const rowSector = row.sector.toLowerCase().trim();
                return tSector === rowSector || t.id === row.templateId;
              });

              const isDuplicated = duplicateRowMap[row.id];
              return (
                <div
                  key={row.id}
                  className={`relative bg-white rounded-xl border p-4 shadow-2xs space-y-4 md:space-y-0 md:flex md:items-end md:gap-3 transition-all duration-200 ${
                    isDuplicated
                      ? 'border-rose-400 bg-rose-50/70 shadow-rose-100 ring-4 ring-rose-500/10'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {isDuplicated && (
                    <div className="absolute -top-2.5 left-4 bg-rose-600 text-white text-[8px] font-black tracking-widest uppercase px-2 py-0.5 rounded-full shadow-sm flex items-center gap-1 animate-pulse z-10">
                      <AlertTriangle className="w-2.5 h-2.5" />
                      Regra de Filtro Repetida Detectada (Conflito de Lote)
                    </div>
                  )}
                  {(() => {
                    const scopeInfo = rowScopeMap.get(row.id) || defaultScopeInfo;
                    const isComarcaInScope =
                      row.comarca === 'all' ||
                      scopeInfo.eligibleComarcas.some(
                        (c) => c.comarca.toLowerCase().trim() === row.comarca.toLowerCase().trim()
                      );
                    const selectedComarcaValue = isComarcaInScope
                      ? row.comarca
                      : scopeInfo.eligibleComarcas.length > 0
                      ? 'all'
                      : 'none';

                    const isSectorInScope =
                      row.sector === 'all' ||
                      scopeInfo.eligibleSectors.some(
                        (s) => s.sector.toLowerCase().trim() === row.sector.toLowerCase().trim()
                      );
                    const selectedSectorValue = isSectorInScope
                      ? row.sector
                      : scopeInfo.eligibleSectors.length > 0
                      ? 'all'
                      : 'none';

                    return (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 flex-1 text-left">
                        {/* Modelo de Checklist Filter */}
                        <div>
                          <label className="block text-[9px] font-black text-[#0b1c30] uppercase mb-1 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            Filtro #{index + 1} - Modelo
                          </label>
                          <select
                            value={row.templateId}
                            onChange={(e) => updateFilterRow(row.id, 'templateId', e.target.value)}
                            className="w-full text-xs font-extrabold h-[38px] px-3 bg-slate-50 hover:bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer text-slate-800 transition-colors"
                          >
                            <option value="all">
                              {row.sector === 'all'
                                ? `Todos os Modelos (${templates.length})`
                                : `Filtrados p/ Gerência (${filteredTemplatesForSelect.length})`}
                            </option>
                            {filteredTemplatesForSelect.map((t) => (
                              <option key={t.id} value={t.id}>
                                [{t.type === 'preventive' ? 'PREV' : 'VIST'}] {t.name}{' '}
                                {t.targetSectorOrType ? `(${t.targetSectorOrType})` : ''}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Comarca Filter - DYNAMIC & ONLY SHOWS ELIGIBLE COMARCAS */}
                        <div>
                          <label className="block text-[9px] font-black text-[#0b1c30] uppercase mb-1 flex items-center justify-between">
                            <span className="flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                              Comarca
                            </span>
                            {scopeInfo.eligibleComarcas.length > 0 ? (
                              <span className="text-[8.5px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                                {scopeInfo.eligibleComarcas.length} aptas ({scopeInfo.totalComarcaPending})
                              </span>
                            ) : (
                              <span className="text-[8.5px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                0 aptas
                              </span>
                            )}
                          </label>
                          <select
                            value={selectedComarcaValue}
                            onChange={(e) => updateFilterRow(row.id, 'comarca', e.target.value)}
                            disabled={scopeInfo.eligibleComarcas.length === 0}
                            className="w-full text-xs font-extrabold h-[38px] px-3 bg-slate-50 hover:bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer text-slate-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {scopeInfo.eligibleComarcas.length === 0 ? (
                              <option value="none">Nenhuma comarca com preventivas pendentes</option>
                            ) : (
                              <>
                                <option value="all">
                                  Todas as Comarcas Aptas ({scopeInfo.totalComarcaPending} preventivas a gerar)
                                </option>
                                {scopeInfo.eligibleComarcas.map((c) => (
                                  <option key={c.comarca} value={c.comarca}>
                                    {c.comarca} ({c.pendingCount} {c.pendingCount === 1 ? 'preventiva' : 'preventivas'})
                                  </option>
                                ))}
                              </>
                            )}
                          </select>
                        </div>

                        {/* Operational Sector Filter - DYNAMIC */}
                        <div>
                          <label className="block text-[9px] font-black text-[#0b1c30] uppercase mb-1 flex items-center justify-between">
                            <span className="flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                              Gerência / Setor
                            </span>
                            {scopeInfo.eligibleSectors.length > 0 ? (
                              <span className="text-[8.5px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
                                {scopeInfo.eligibleSectors.length} aptas
                              </span>
                            ) : (
                              <span className="text-[8.5px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                0 aptas
                              </span>
                            )}
                          </label>
                          <select
                            value={selectedSectorValue}
                            onChange={(e) => updateFilterRow(row.id, 'sector', e.target.value)}
                            disabled={scopeInfo.eligibleSectors.length === 0}
                            className="w-full text-xs font-extrabold h-[38px] px-3 bg-slate-50 hover:bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer text-slate-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {scopeInfo.eligibleSectors.length === 0 ? (
                              <option value="none">Nenhuma gerência vinculada pendente</option>
                            ) : (
                              <>
                                <option value="all">
                                  Todas as Gerências Aptas ({scopeInfo.totalSectorPending} preventivas)
                                </option>
                                {scopeInfo.eligibleSectors.map((s) => (
                                  <option key={s.sector} value={s.sector}>
                                    {s.sector} ({s.pendingCount} {s.pendingCount === 1 ? 'preventiva' : 'preventivas'})
                                  </option>
                                ))}
                              </>
                            )}
                          </select>
                        </div>

                        {/* Specific Start Date */}
                        <div>
                          <label className="block text-[9px] font-black text-rose-500 uppercase mb-1 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
                            Início
                          </label>
                          <input
                            type="date"
                            value={row.startDate}
                            onChange={(e) => updateFilterRow(row.id, 'startDate', e.target.value)}
                            className="w-full text-xs font-extrabold h-[38px] px-3 bg-slate-50 hover:bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 text-slate-800 transition-colors"
                          />
                        </div>

                        {/* Specific End Date */}
                        <div>
                          <label className="block text-[9px] font-black text-rose-500 uppercase mb-1 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
                            Limite de Corte
                          </label>
                          <input
                            type="date"
                            value={row.endDate}
                            onChange={(e) => updateFilterRow(row.id, 'endDate', e.target.value)}
                            className="w-full text-xs font-extrabold h-[38px] px-3 bg-slate-50 hover:bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 text-slate-800 transition-colors"
                          />
                        </div>
                      </div>
                    );
                  })()}

                  {/* Actions for this row */}
                  <div className="flex justify-end gap-1 shrink-0 md:self-end">
                    {filterRows.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => removeFilterRow(row.id)}
                        title="Remover esta linha de filtro"
                        className="h-[38px] w-[38px] text-rose-600 hover:bg-rose-50 border border-gray-200 hover:border-rose-200 rounded-lg transition-all cursor-pointer flex items-center justify-center shadow-3xs"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled
                        title="Deve conter ao menos uma linha de filtro"
                        className="h-[38px] w-[38px] text-slate-300 border border-slate-100 rounded-lg cursor-not-allowed opacity-50 flex items-center justify-center bg-slate-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Add row button */}
          <div className="flex justify-start">
            <button
              type="button"
              onClick={addFilterRow}
              className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-[#0b1c30] border border-gray-300 hover:border-gray-400 rounded-lg text-xs font-black flex items-center gap-1.5 transition-all shadow-3xs active:scale-95 cursor-pointer"
            >
              <Plus className="w-4 h-4 text-emerald-600" />
              Acrescentar Mais Linhas de Filtros
            </button>
          </div>
        </div>

        {/* Live simulation banner with duplicates validation safeguard */}
        {(() => {
          const countNew = simulationRecords.filter((s) => !s.alreadyExists).length;
          const countExists = simulationRecords.filter((s) => s.alreadyExists).length;

          return (
            <div
              className={`rounded-2xl p-5 border flex flex-col md:flex-row justify-between items-center gap-4 transition-all duration-200 ${
                hasDuplicateRuleError
                  ? 'bg-rose-50 border-rose-200 ring-4 ring-rose-500/10'
                  : countNew === 0
                  ? countExists > 0
                    ? 'bg-amber-50 border-amber-200 ring-4 ring-amber-500/5'
                    : 'bg-slate-50 border-slate-200'
                  : 'bg-emerald-50 border-emerald-100'
              }`}
            >
              <div className="space-y-1 w-full md:w-auto text-left flex-1">
                <div className="flex items-center gap-1.5">
                  {hasDuplicateRuleError ? (
                    <>
                      <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 animate-pulse" />
                      <span className="font-extrabold text-xs text-rose-900 uppercase tracking-wider">
                        Aviso de Regra Redundante ou Duplicada
                      </span>
                    </>
                  ) : countNew === 0 ? (
                    countExists > 0 ? (
                      <>
                        <CheckCircle2 className="w-5 h-5 text-amber-600 shrink-0" />
                        <span className="font-extrabold text-xs text-amber-950 uppercase tracking-wider">
                          Cronograma Totalmente Preenchido
                        </span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-5 h-5 text-slate-500 shrink-0" />
                        <span className="font-extrabold text-xs text-slate-700 uppercase tracking-wider">
                          Nenhuma Atividade Compatível Pendente
                        </span>
                      </>
                    )
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5 text-emerald-600 shrink-0" />
                      <span className="font-extrabold text-xs text-emerald-900 uppercase tracking-wider">
                        Simulação Operacional de Cadastro Realizada
                      </span>
                    </>
                  )}
                </div>

                {hasDuplicateRuleError ? (
                  <div className="space-y-2">
                    <p className="text-[11px] text-rose-800 leading-normal max-w-2xl">
                      Existem filtros idênticos ou redundantes com exatamente as mesmas regras de modelo, comarca,
                      gerência e datas na grade acima. O motor de agendamentos impede o processamento com regras
                      repetidas para evitar OS redundantes no banco de dados.
                    </p>
                    <button
                      type="button"
                      onClick={removeDuplicateFilters}
                      className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[10px] font-black flex items-center gap-1.5 transition-all shadow-xs active:scale-95 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Corrigir Agora: Remover Filtros Repetidos
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="flex flex-wrap gap-2 pt-0.5">
                      <span className="text-[10px] bg-emerald-600 text-white font-black px-2.5 py-1 rounded-md shadow-3xs uppercase tracking-wider">
                        🆕 {countNew} Novas Programações a Agendar
                      </span>
                      {countExists > 0 && (
                        <span className="text-[10px] bg-slate-500 text-white font-black px-2.5 py-1 rounded-md shadow-3xs border border-slate-600/30 uppercase tracking-wider">
                          ✔️ {countExists} Já Programadas (Bloqueadas para evitar duplicidades)
                        </span>
                      )}
                    </div>
                    {countNew === 0 && countExists > 0 && (
                      <p className="text-[10.5px] text-amber-800 font-extrabold pt-1">
                        ⚠️ Bloqueio Preventivo: Todas as programações deste lote já existem no banco de dados para os
                        respectivos períodos de recorrência.
                      </p>
                    )}
                    {countNew === 0 && countExists === 0 && (
                      <p className="text-[10.5px] text-slate-600 font-medium pt-1">
                        ℹ️ Não há ativos compatíveis com este modelo ou todas as programações já foram concluídas para o
                        período selecionado.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <button
                onClick={() => handleExecuteGeneration()}
                disabled={isGenerating || hasDuplicateRuleError || countNew === 0}
                className={`w-full md:w-auto px-6 py-3 text-white rounded-xl text-xs font-black flex items-center justify-center gap-2 transition-all cursor-pointer shrink-0 shadow-md active:scale-95 whitespace-nowrap h-[44px] ${
                  hasDuplicateRuleError
                    ? 'bg-rose-400 border border-rose-505 cursor-not-allowed opacity-[0.65]'
                    : countNew === 0
                    ? 'bg-slate-400 border border-slate-450 cursor-not-allowed opacity-[0.8]'
                    : 'bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50'
                }`}
                title={
                  hasDuplicateRuleError
                    ? 'Não é possível salvar com regras repetidas na grade'
                    : countNew === 0
                    ? 'Não há novas programações pendentes para agendar neste período'
                    : 'Processar geração de preventivas hoje'
                }
              >
                <RefreshCw className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
                {isGenerating
                  ? 'PROCESSANDO OS NO BANCO...'
                  : hasDuplicateRuleError
                  ? '🚫 BLOQUEADO: REMOVA DUPLICADOS'
                  : countNew === 0
                  ? countExists > 0
                    ? '✔️ CRONOGRAMA EM DIA'
                    : 'SEM ATIVIDADES PENDENTES'
                  : 'GERAR CRONOGRAMA EM LOTE'}
              </button>
            </div>
          );
        })()}

        {/* Response alert box */}
        {generationSummaryMsg && (
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl text-blue-900 text-xs flex items-start gap-2.5 animate-in fade-in duration-150">
            <CheckCircle2 className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-extrabold block">Atividades Criadas com Sucesso!</span>
              <p className="text-[11px] text-blue-800 leading-relaxed font-semibold">{generationSummaryMsg}</p>
            </div>
          </div>
        )}
      </div>

      {/* VISUAL LAYOUT & SIMULATION PREVIEW */}
      <div className="space-y-4">
        <div className="bg-white p-4 rounded-2xl border border-gray-200 text-left">
          <span className="text-xs font-black text-[#0b1c30] uppercase tracking-wide flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-indigo-500" />
            Visualização Prévia do Lote de Programações ({simulationRecords.length})
          </span>
          <p className="text-[10px] text-slate-400 mt-1">
            Veja a listagem das atividades preventivas e vistorias que serão geradas para o lote selecionado.
          </p>
        </div>

        {/* DETAILED CARD GRID/LIST MODE (ORIGINAL PREVIEW) */}
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {simulationRecords.length === 0 ? (
              <div className="md:col-span-3 p-12 text-center text-slate-400 bg-white border border-dashed rounded-2xl">
                Selecione um período ou adicione modelos compatíveis com os ativos para que o mapa de preventivas não fique
                em branco.
              </div>
            ) : (
              simulationRecords.slice(0, 15).map((sim, index) => (
                <div
                  key={index}
                  className={`bg-white rounded-xl border p-4 relative overflow-hidden shadow-xs text-left transition-all ${
                    sim.alreadyExists ? 'border-dashed border-slate-300 bg-slate-50/50 opacity-70' : 'border-gray-200'
                  }`}
                >
                  <span
                    className={`absolute top-0 right-0 px-2 py-0.5 text-[8px] font-black rounded-bl ${
                      sim.alreadyExists
                        ? 'bg-slate-200 text-slate-600 border-l border-b border-slate-300'
                        : sim.type === 'preventive'
                        ? 'bg-blue-50 text-blue-700 border-l border-b border-blue-100'
                        : 'bg-purple-50 text-purple-700 border-l border-b border-purple-100'
                    }`}
                  >
                    {sim.alreadyExists ? 'JÁ EXISTE' : sim.type === 'preventive' ? 'ATIVO' : 'VISTORIA'}
                  </span>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[9px] font-extrabold gap-1">
                      <span className="font-extrabold text-[#3525cd] bg-indigo-50 px-2 py-0.5 rounded shrink-0">
                        ID: #{formatOrderNumber(sim.id)}
                      </span>
                      {sim.alreadyExists ? (
                        <span className="px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded text-[8px] font-bold border border-slate-200 truncate">
                          EXECUTANDO ✔️
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded text-[8px] font-bold border border-emerald-200 truncate">
                          NOVO 🆕
                        </span>
                      )}
                      <span className="px-1.5 py-0.5 bg-slate-100 text-slate-400 rounded text-[8px] shrink-0">
                        {sim.periodicity}
                      </span>
                    </div>

                    <h4
                      className={`text-xs font-black line-clamp-1 ${
                        sim.alreadyExists ? 'text-slate-400 line-through italic' : 'text-[#0b1c30]'
                      }`}
                    >
                      {sim.title}
                    </h4>

                    {/* Execution Window */}
                    <div className="grid grid-cols-2 gap-1.5 py-1 text-[9px] font-extrabold">
                      <div
                        className={`p-1.5 rounded border flex flex-col ${
                          sim.alreadyExists
                            ? 'bg-slate-100 text-slate-400 border-slate-200'
                            : 'bg-emerald-50 text-emerald-800 border-emerald-100/50'
                        }`}
                      >
                        <span
                          className={`text-[7.5px] uppercase ${
                            sim.alreadyExists ? 'text-slate-400' : 'text-emerald-600'
                          }`}
                        >
                          Data de início
                        </span>
                        <span>{formatDateBR(sim.startDate)}</span>
                      </div>
                      <div
                        className={`p-1.5 rounded border flex flex-col ${
                          sim.alreadyExists
                            ? 'bg-slate-100 text-slate-400 border-slate-200'
                            : 'bg-rose-50 text-rose-800 border-rose-100/50'
                        }`}
                      >
                        <span
                          className={`text-[7.5px] uppercase ${
                            sim.alreadyExists ? 'text-slate-400' : 'text-rose-600'
                          }`}
                        >
                          Data final
                        </span>
                        <span>{formatDateBR(sim.endDate)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-1.5 border-t border-slate-50 text-[10px] text-slate-500 font-semibold">
                      <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded font-black shrink-0">
                        {sim.assetCode}
                      </span>
                      <span className="line-clamp-1">{sim.assetName}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {simulationRecords.length > 15 && (
            <div className="text-center py-2 text-[11px] text-slate-500 font-bold">
              Exibindo as primeiras 15 de {simulationRecords.length} atividades pré-calculadas no planejamento.
            </div>
          )}
        </div>
      </div>

      {/* REGULATORY CORNER INFO */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-slate-300">
        <div className="flex gap-3 text-slate-100 items-start">
          <ShieldAlert className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <span className="font-extrabold text-sm block">Normativas de Periodicidade de Engenharia</span>
            <p className="text-xs text-slate-400 leading-normal max-w-4xl">
              Em conformidade com as diretivas do PMOC (Manual de Operação e Controle) e da regulamentação nacional da
              Engenharia Predial, vistorias de inspeção em áreas comuns e rotas de segurança devem seguir rígida
              periodicidade semanal. Por outro lado, para ativos e máquinas rotativas (tais como chillers, condensadores e
              subestações), as atividades preventivas se estendem às periodicidades mensais, semestrais e anuais com
              checklists baseados exclusivamente no seu respectivo histórico de vida útil.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
