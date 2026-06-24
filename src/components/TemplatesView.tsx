import React, { useState, useEffect, useMemo } from 'react';
import {
  FileText,
  Plus,
  Trash2,
  Check,
  ToggleLeft,
  ToggleRight,
  Settings,
  RefreshCw,
  PlusCircle,
  Clock,
  Layers,
  Sparkles,
  Sliders,
  AlertTriangle,
  History,
  Calendar,
  CheckCircle,
  Activity,
  User,
  Info,
  ShieldAlert,
  Edit2,
  ListChecks,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Wrench,
  Search,
  ArrowLeft,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import { MaintenanceTemplate, ChecklistTemplateItem, TemplateChangeLog, Asset, formatDateBR, Management, ServiceOrder, getSectorGerencia } from '../types';
import { 
  dbGetTemplates, 
  dbSaveTemplate, 
  dbDeleteTemplate, 
  dbAutoGeneratePreventiveActivities,
  dbGetAssets,
  getDatabaseMode,
  AutoGenFilter,
  dbGetManagements,
  dbGetServiceOrders
} from '../db/firebase';

function getYearWeekLocal(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  const tempDate = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = tempDate.getUTCDay() || 7;
  tempDate.setUTCDate(tempDate.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tempDate.getUTCFullYear(),0,1));
  const weekNo = Math.ceil((((tempDate.getTime() - yearStart.getTime()) / 86400000) + 1)/7);
  return `${tempDate.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function getQuarterLocal(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()}-Q${q}`;
}

function getSemesterLocal(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  const s = Math.floor(d.getMonth() / 6) + 1;
  return `${d.getFullYear()}-S${s}`;
}

export function isSamePeriod(dateAStr: string, dateBStr: string, periodicity: string): boolean {
  if (!dateAStr || !dateBStr) return false;
  const p = periodicity || '';
  if (p === 'Semanal') {
    return getYearWeekLocal(dateAStr) === getYearWeekLocal(dateBStr);
  }
  if (p === 'Mensal') {
    return dateAStr.slice(0, 7) === dateBStr.slice(0, 7);
  }
  if (p === 'Trimestral') {
    return getQuarterLocal(dateAStr) === getQuarterLocal(dateBStr);
  }
  if (p === 'Semestral') {
    return getSemesterLocal(dateAStr) === getSemesterLocal(dateBStr);
  }
  if (p === 'Anual') {
    return dateAStr.slice(0, 4) === dateBStr.slice(0, 4);
  }
  return dateAStr === dateBStr;
}

export function alignPeriodDates(baseDateStr: string, periodicity: string): { startDate: string; endDate: string; scheduledDate: string } {
  if (!baseDateStr) {
    const today = new Date().toISOString().slice(0, 10);
    return { startDate: today, endDate: today, scheduledDate: today };
  }
  const d = new Date(baseDateStr + 'T12:00:00');
  const y = d.getFullYear();
  
  const formatDateString = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  if (periodicity === 'Semanal') {
    const day = d.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(d);
    monday.setDate(d.getDate() + diffToMonday);
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);
    
    return {
      startDate: formatDateString(monday),
      endDate: formatDateString(friday),
      scheduledDate: baseDateStr
    };
  } else if (periodicity === 'Mensal') {
    const m = d.getMonth();
    const firstDay = new Date(y, m, 1);
    const lastDay = new Date(y, m + 1, 0);
    
    return {
      startDate: formatDateString(firstDay),
      endDate: formatDateString(lastDay),
      scheduledDate: baseDateStr
    };
  } else if (periodicity === 'Trimestral') {
    const m = d.getMonth();
    const quarter = Math.floor(m / 3);
    const qStartMonth = quarter * 3;
    const qEndMonth = qStartMonth + 2;
    
    const firstDay = new Date(y, qStartMonth, 1);
    const lastDay = new Date(y, qEndMonth + 1, 0);
    
    return {
      startDate: formatDateString(firstDay),
      endDate: formatDateString(lastDay),
      scheduledDate: baseDateStr
    };
  } else if (periodicity === 'Semestral') {
    const m = d.getMonth();
    const semester = Math.floor(m / 6);
    const sStartMonth = semester * 6;
    const sEndMonth = sStartMonth + 5;
    
    const firstDay = new Date(y, sStartMonth, 1);
    const lastDay = new Date(y, sEndMonth + 1, 0);
    
    return {
      startDate: formatDateString(firstDay),
      endDate: formatDateString(lastDay),
      scheduledDate: baseDateStr
    };
  } else if (periodicity === 'Anual') {
    const firstDay = new Date(y, 0, 1);
    const lastDay = new Date(y, 11, 31);
    
    return {
      startDate: formatDateString(firstDay),
      endDate: formatDateString(lastDay),
      scheduledDate: baseDateStr
    };
  }
  
  return {
    startDate: baseDateStr,
    endDate: baseDateStr,
    scheduledDate: baseDateStr
  };
}

interface TemplatesViewProps {
  onTemplatesUpdated?: () => void;
}

export default function TemplatesView({ onTemplatesUpdated }: TemplatesViewProps) {
  // Navigation states
  const [subTab, setSubTab] = useState<'templates' | 'generation'>('templates');
  const [templates, setTemplates] = useState<MaintenanceTemplate[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [managements, setManagements] = useState<Management[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<MaintenanceTemplate | null>(null);
  const [mobileActiveView, setMobileActiveView] = useState<'list' | 'detail'>('list');
  
  // Left menu filter of templates
  const [templateFilter, setTemplateFilter] = useState<'all' | 'preventive' | 'survey'>('all');
  const [searchQuery, setSearchQuery] = useState('');

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

  // Calendar and safeguards states
  const [existingOrders, setExistingOrders] = useState<ServiceOrder[]>([]);
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('list');
  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().getMonth());
  const [selectedDayDate, setSelectedDayDate] = useState<string | null>(() => new Date().toISOString().slice(0, 10));
  const [calendarSectorFilter, setCalendarSectorFilter] = useState<string>('all');

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
      setFilterRows(filterRows.filter(row => row.id !== id));
    }
  };

  const updateFilterRow = (id: string, field: string, value: string) => {
    setFilterRows(filterRows.map(row => {
      if (row.id === id) {
        return { ...row, [field]: value };
      }
      return row;
    }));
  };

  // Form states for creating a new Template
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateType, setNewTemplateType] = useState<'preventive' | 'survey'>('preventive');
  const [newTemplateTargetSector, setNewTemplateTargetSector] = useState('Refrigeração');
  const [newTemplateAssetType, setNewTemplateAssetType] = useState(''); // E.g. "Chiller", "Ar Condicionado"
  const [newTemplatePeriodicity, setNewTemplatePeriodicity] = useState('Mensal');
  const [newTemplatePeriodicities, setNewTemplatePeriodicities] = useState<string[]>(['Mensal']);
  const [newTemplateInitialTasks, setNewTemplateInitialTasks] = useState<string>('');

  // Editing current active checklist item configuration
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [newCustomTaskText, setNewCustomTaskText] = useState('');
  
  // Custom Changelog reason when saving modifications
  const [changelogReason, setChangelogReason] = useState('');
  const [templateToDeleteId, setTemplateToDeleteId] = useState<string | null>(null);
  const [isEditingTargetSector, setIsEditingTargetSector] = useState(false);
  const [editingTargetSectorValue, setEditingTargetSectorValue] = useState('');
  const [isEditingPeriodicity, setIsEditingPeriodicity] = useState(false);
  const [editingPeriodicityValue, setEditingPeriodicityValue] = useState('');

  // Database mode / logged user details
  const dbMode = getDatabaseMode();
  const currentUserLabel = dbMode.userEmail || 'daniel.torres@hexon.com';

  // Dynamically extract unique asset types (specs.TIPO or specs.tipo) from the loaded assets list
  const existingAssetTypes = useMemo(() => {
    const types = new Set<string>();
    assets.forEach((asset) => {
      const t = asset.specs?.TIPO || asset.specs?.tipo;
      if (t && typeof t === 'string' && t.trim() !== '') {
        types.add(t.trim());
      }
    });
    
    // In case no assets exist yet or have no types filled, provide default fallback types
    if (types.size === 0) {
      types.add('Chiller');
      types.add('Ar Condicionado');
      types.add('Exaustor / Fancoil');
      types.add('Gerador de Energia');
      types.add('Quadro Elétrico');
      types.add('Subestação');
      types.add('Bomba Hidráulica');
    }
    
    return Array.from(types).sort((a, b) => a.localeCompare(b));
  }, [assets]);

  // Dynamically extract unique comarcas from registered assets
  const existingComarcas = useMemo(() => {
    const comarcas = new Set<string>();
    assets.forEach((asset) => {
      const c = asset.specs?.COMARCA || asset.specs?.comarca || (asset.location && asset.location.includes(' - ') ? asset.location.split(' - ')[0] : asset.location);
      if (c && typeof c === 'string' && c.trim() !== '') {
        comarcas.add(c.trim());
      }
    });
    if (comarcas.size === 0) {
      comarcas.add('Comarca Capital');
    }
    return Array.from(comarcas).sort((a, b) => a.localeCompare(b));
  }, [assets]);

  // Dynamically extract unique sectors from assets and template configurations
  const existingSectors = useMemo(() => {
    const sectors = new Set<string>();
    assets.forEach((asset) => {
      if (asset.sector && typeof asset.sector === 'string' && asset.sector.trim() !== '') {
        sectors.add(asset.sector.trim());
      }
    });
    // Add default fallbacks just in case
    if (sectors.size === 0) {
      sectors.add('Refrigeração');
      sectors.add('Elétrica');
      sectors.add('Civil');
    }
    return Array.from(sectors).sort((a, b) => a.localeCompare(b));
  }, [assets]);

  const managementsList = useMemo(() => {
    if (managements.length > 0) {
      return managements.filter(m => m.name !== 'Todas').map(m => m.name);
    }
    return existingSectors;
  }, [managements, existingSectors]);

  // Handle changing asset type link and automatically retrieving and setting its sector
  const handleAssetTypeChange = (type: string) => {
    setNewTemplateAssetType(type);
    if (type) {
      const matchedAsset = assets.find(a => {
        const t = a.specs?.TIPO || a.specs?.tipo;
        return t && typeof t === 'string' && t.trim().toLowerCase() === type.trim().toLowerCase();
      });
      if (matchedAsset && matchedAsset.sector) {
        setNewTemplateTargetSector(matchedAsset.sector);
      }
    }
  };

  const handleOpenAddModal = () => {
    setNewTemplateName('');
    setNewTemplateInitialTasks('');
    setNewTemplateType('preventive');
    
    const firstType = existingAssetTypes[0] || '';
    setNewTemplateAssetType(firstType);
    
    if (firstType) {
      const matchedAsset = assets.find(a => {
        const t = a.specs?.TIPO || a.specs?.tipo;
        return t && typeof t === 'string' && t.trim().toLowerCase() === firstType.trim().toLowerCase();
      });
      if (matchedAsset && matchedAsset.sector) {
        setNewTemplateTargetSector(matchedAsset.sector);
      } else {
        const activeMgmts = managements.filter(m => m.name !== 'Todas');
        setNewTemplateTargetSector(activeMgmts[0]?.name || 'Refrigeração');
      }
    } else {
      const activeMgmts = managements.filter(m => m.name !== 'Todas');
      setNewTemplateTargetSector(activeMgmts[0]?.name || 'Refrigeração');
    }
    
    setNewTemplatePeriodicities(['Mensal']);
    setShowAddModal(true);
  };

  // Load backend configurations
  const loadData = async () => {
    const [tList, aList, mList, oList] = await Promise.all([
      dbGetTemplates(),
      dbGetAssets(),
      dbGetManagements(),
      dbGetServiceOrders()
    ]);
    setTemplates(tList);
    setAssets(aList);
    setManagements(mList);
    setExistingOrders(oList);
    
    // Automatically select the first template if none is currently selected
    if (tList.length > 0 && !selectedTemplate) {
      setSelectedTemplate(tList[0]);
    } else if (tList.length > 0 && selectedTemplate) {
      const reselected = tList.find(t => t.id === selectedTemplate.id);
      if (reselected) {
        setSelectedTemplate(reselected);
      }
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Filter templates list on left sidebar
  const filteredTemplates = templates.filter((t) => {
    const matchesTab = templateFilter === 'all' || t.type === templateFilter;
    const matchesSearch = searchQuery === '' || 
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.targetSectorOrType.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.targetAssetType && t.targetAssetType.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesTab && matchesSearch;
  });

  // Handle template creation
  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTemplateName.trim()) return;

    // Parse tasks list
    const tasksArray = newTemplateInitialTasks
      .split('\n')
      .map(t => t.trim())
      .filter(Boolean);

    const initialChecklistItems: ChecklistTemplateItem[] = tasksArray.map((task, idx) => ({
      id: `ck_init_${Date.now()}_${idx}`,
      task,
      isActive: true,
      defaultChecked: false,
      observationRequired: false,
      criticality: 'Média',
      autoCreateCorrective: false
    }));

    const initialHistory: TemplateChangeLog[] = [{
      version: 1,
      updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
      changeDescription: 'Criação inicial do modelo de checklist.',
      user: currentUserLabel
    }];

    const newTemplate: MaintenanceTemplate = {
      id: `tmp_${newTemplateType === 'preventive' ? 'p' : 's'}_${Date.now().toString().slice(-4)}`,
      name: newTemplateName.trim(),
      type: newTemplateType,
      targetSectorOrType: newTemplateTargetSector.trim(),
      targetAssetType: newTemplateType === 'preventive' ? (newTemplateAssetType.trim() ? newTemplateAssetType.trim() : undefined) : undefined,
      periodicity: newTemplateType === 'preventive' 
        ? (newTemplatePeriodicities.length > 0 ? newTemplatePeriodicities.join(', ') : 'Mensal')
        : 'Semanal',
      checklistItems: initialChecklistItems,
      createdAt: new Date().toISOString(),
      version: 1,
      history: initialHistory
    };

    await dbSaveTemplate(newTemplate);
    setShowAddModal(false);
    
    // Clear and reload
    setNewTemplateName('');
    setNewTemplateInitialTasks('');
    setNewTemplateAssetType('');
    await loadData();
    setSelectedTemplate(newTemplate);
    
    if (onTemplatesUpdated) onTemplatesUpdated();
  };

  // Update template target sector
  const handleUpdateTemplateSector = async (newSector: string) => {
    if (!selectedTemplate || !newSector.trim()) return;

    const newVersion = (selectedTemplate.version || 1) + 1;
    const historyEntry: TemplateChangeLog = {
      version: newVersion,
      updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
      changeDescription: `Setor Alvo alterado de "${selectedTemplate.targetSectorOrType}" para "${newSector.trim()}".`,
      user: currentUserLabel
    };

    const updatedTemplate = {
      ...selectedTemplate,
      version: newVersion,
      targetSectorOrType: newSector.trim(),
      history: [historyEntry, ...(selectedTemplate.history || [])]
    };

    setSelectedTemplate(updatedTemplate);
    await dbSaveTemplate(updatedTemplate);
    setTemplates(templates.map(t => t.id === updatedTemplate.id ? updatedTemplate : t));
    setIsEditingTargetSector(false);

    if (onTemplatesUpdated) onTemplatesUpdated();
  };

  // Update template periodicity
  const handleUpdateTemplatePeriodicity = async (newPeriodicity: string) => {
    if (!selectedTemplate || !newPeriodicity.trim()) return;

    const newVersion = (selectedTemplate.version || 1) + 1;
    const historyEntry: TemplateChangeLog = {
      version: newVersion,
      updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
      changeDescription: `Periodicidade alterada de "${selectedTemplate.periodicity}" para "${newPeriodicity.trim()}".`,
      user: currentUserLabel
    };

    const updatedTemplate = {
      ...selectedTemplate,
      version: newVersion,
      periodicity: newPeriodicity.trim(),
      history: [historyEntry, ...(selectedTemplate.history || [])]
    };

    setSelectedTemplate(updatedTemplate);
    await dbSaveTemplate(updatedTemplate);
    setTemplates(templates.map(t => t.id === updatedTemplate.id ? updatedTemplate : t));
    setIsEditingPeriodicity(false);

    if (onTemplatesUpdated) onTemplatesUpdated();
  };

  // Add individual checklist item
  const handleAddNewItemToSelected = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTemplate || !newCustomTaskText.trim()) return;

    const newItem: ChecklistTemplateItem = {
      id: `ck_item_add_${Date.now()}`,
      task: newCustomTaskText.trim(),
      isActive: true,
      defaultChecked: false,
      observationRequired: false,
      criticality: 'Média',
      autoCreateCorrective: false,
      responseType: 'three_states',
      naObservationRequired: false
    };

    const newVersion = (selectedTemplate.version || 1) + 1;
    const historyEntry: TemplateChangeLog = {
      version: newVersion,
      updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
      changeDescription: `Adicionado item de checklist: "${newCustomTaskText.trim()}".`,
      user: currentUserLabel
    };

    const updatedTemplate: MaintenanceTemplate = {
      ...selectedTemplate,
      version: newVersion,
      checklistItems: [...selectedTemplate.checklistItems, newItem],
      history: [historyEntry, ...(selectedTemplate.history || [])]
    };

    setSelectedTemplate(updatedTemplate);
    await dbSaveTemplate(updatedTemplate);
    setTemplates(templates.map(t => t.id === updatedTemplate.id ? updatedTemplate : t));
    setNewCustomTaskText('');
    
    if (onTemplatesUpdated) onTemplatesUpdated();
  };

  // Toggle checklist item active state
  const handleToggleItemActive = async (itemId: string) => {
    if (!selectedTemplate) return;

    const updatedChecklist = selectedTemplate.checklistItems.map((item) => {
      if (item.id === itemId) {
        return { ...item, isActive: !item.isActive };
      }
      return item;
    });

    const isCurrentlyActive = selectedTemplate.checklistItems.find(i => i.id === itemId)?.isActive;
    const taskName = selectedTemplate.checklistItems.find(i => i.id === itemId)?.task || '';

    const newVersion = (selectedTemplate.version || 1) + 1;
    const historyEntry: TemplateChangeLog = {
      version: newVersion,
      updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
      changeDescription: `${isCurrentlyActive ? 'Desativado' : 'Ativado'} item de checklist: "${taskName}".`,
      user: currentUserLabel
    };

    const updatedTemplate = {
      ...selectedTemplate,
      version: newVersion,
      checklistItems: updatedChecklist,
      history: [historyEntry, ...(selectedTemplate.history || [])]
    };

    setSelectedTemplate(updatedTemplate);
    await dbSaveTemplate(updatedTemplate);
    setTemplates(templates.map(t => t.id === updatedTemplate.id ? updatedTemplate : t));
    
    if (onTemplatesUpdated) onTemplatesUpdated();
  };

  // Update specific checklist item configuration rules (criticality, auto corretiva, etc.)
  const handleUpateItemRules = async (
    itemId: string, 
    fields: Partial<Omit<ChecklistTemplateItem, 'id' | 'task'>>
  ) => {
    if (!selectedTemplate) return;

    const updatedChecklist = selectedTemplate.checklistItems.map((item) => {
      if (item.id === itemId) {
        return { ...item, ...fields };
      }
      return item;
    });

    const taskName = selectedTemplate.checklistItems.find(i => i.id === itemId)?.task || '';
    const fieldKeys = Object.keys(fields).join(', ');

    const newVersion = (selectedTemplate.version || 1) + 1;
    const historyEntry: TemplateChangeLog = {
      version: newVersion,
      updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
      changeDescription: `Regra de verificação alterada para o item "${taskName}" (${fieldKeys}).`,
      user: currentUserLabel
    };

    const updatedTemplate = {
      ...selectedTemplate,
      version: newVersion,
      checklistItems: updatedChecklist,
      history: [historyEntry, ...(selectedTemplate.history || [])]
    };

    setSelectedTemplate(updatedTemplate);
    await dbSaveTemplate(updatedTemplate);
    setTemplates(templates.map(t => t.id === updatedTemplate.id ? updatedTemplate : t));
    
    if (onTemplatesUpdated) onTemplatesUpdated();
  };

  // Delete individual checklist item
  const handleDeleteItem = async (itemId: string) => {
    if (!selectedTemplate) return;

    const taskName = selectedTemplate.checklistItems.find(i => i.id === itemId)?.task || '';
    const updatedChecklist = selectedTemplate.checklistItems.filter(item => item.id !== itemId);
    
    const newVersion = (selectedTemplate.version || 1) + 1;
    const historyEntry: TemplateChangeLog = {
      version: newVersion,
      updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
      changeDescription: `Removido item de checklist: "${taskName}".`,
      user: currentUserLabel
    };

    const updatedTemplate = {
      ...selectedTemplate,
      version: newVersion,
      checklistItems: updatedChecklist,
      history: [historyEntry, ...(selectedTemplate.history || [])]
    };

    setSelectedTemplate(updatedTemplate);
    await dbSaveTemplate(updatedTemplate);
    setTemplates(templates.map(t => t.id === updatedTemplate.id ? updatedTemplate : t));
    
    if (onTemplatesUpdated) onTemplatesUpdated();
  };

  // Move checklist item up or down in order
  const handleMoveItem = async (itemId: string, direction: 'up' | 'down') => {
    if (!selectedTemplate) return;

    const checklist = [...selectedTemplate.checklistItems];
    const index = checklist.findIndex(item => item.id === itemId);
    if (index === -1) return;

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= checklist.length) return;

    // Swap items
    const temp = checklist[index];
    checklist[index] = checklist[targetIndex];
    checklist[targetIndex] = temp;

    const newVersion = (selectedTemplate.version || 1) + 1;
    const historyEntry: TemplateChangeLog = {
      version: newVersion,
      updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
      changeDescription: `Reordenada pergunta: "${temp.task}" para ${direction === 'up' ? 'cima' : 'baixo'}.`,
      user: currentUserLabel
    };

    const updatedTemplate = {
      ...selectedTemplate,
      version: newVersion,
      checklistItems: checklist,
      history: [historyEntry, ...(selectedTemplate.history || [])]
    };

    setSelectedTemplate(updatedTemplate);
    await dbSaveTemplate(updatedTemplate);
    setTemplates(templates.map(t => t.id === updatedTemplate.id ? updatedTemplate : t));
    
    if (onTemplatesUpdated) onTemplatesUpdated();
  };

  // Save manual template configuration header edits and register custom changelog history
  const handleSaveChangelogCommit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTemplate) return;

    const description = changelogReason.trim() || 'Modificação manual de parametrizações do checklist operacional.';
    const newVersion = (selectedTemplate.version || 1) + 1;
    
    const historyEntry: TemplateChangeLog = {
      version: newVersion,
      updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
      changeDescription: description,
      user: currentUserLabel
    };

    const updatedTemplate = {
      ...selectedTemplate,
      version: newVersion,
      history: [historyEntry, ...(selectedTemplate.history || [])]
    };

    setSelectedTemplate(updatedTemplate);
    await dbSaveTemplate(updatedTemplate);
    setTemplates(templates.map(t => t.id === updatedTemplate.id ? updatedTemplate : t));
    setChangelogReason('');
    alert(`Modelo de checklist atualizado para a Versão ${newVersion} com sucesso nos servidores!`);
    
    if (onTemplatesUpdated) onTemplatesUpdated();
  };

  // Delete entire checklist template
  const handleDeleteTemplate = async (templateId: string) => {
    await dbDeleteTemplate(templateId);
    setSelectedTemplate(null);
    setTemplateToDeleteId(null);
    await loadData();
    
    if (onTemplatesUpdated) onTemplatesUpdated();
  };

  const getOffsetDateString = (baseStr: string, offsetDays: number): string => {
    const date = new Date(baseStr + 'T12:00:00');
    date.setDate(date.getDate() + offsetDays);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
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
      
      await loadData();
      if (onTemplatesUpdated) onTemplatesUpdated();
    } catch (err: any) {
      console.error(err);
      alert('Houve um erro técnico processando o seu agendamento programado.');
    } finally {
      setIsGenerating(false);
    }
  };


  // FRONTEND SIMULATOR / DRY-RUN CALCULATOR
  // Renders a preview list of what would be prepared without mutating the DB
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
      // Filter templates to generate
      const targetTemplates = templates.filter((t) => {
        if (row.templateId !== 'all' && t.id !== row.templateId) return false;
        return true;
      });

      for (const t of targetTemplates) {
        // 1. SURVEY / VISTORIA TEMPLATE (Semanal - sem vínculo com ativo, única por comarca)
        if (t.type === 'survey') {
          if (row.sector !== 'all') {
            const tSector = (t.targetSectorOrType || '').toLowerCase().trim();
            if (tSector !== row.sector.toLowerCase().trim()) continue;
          }

          const targetComarcas = existingComarcas.filter((comarca) => {
            if (row.comarca !== 'all' && comarca.toLowerCase().trim() !== row.comarca.toLowerCase().trim()) return false;
            return true;
          });

          for (const comarca of targetComarcas) {
            let i = 0;
            const limit = 100;
            while (i < limit) {
              const dates = alignPeriodDates(row.startDate, 'Semanal');
              const title = `${t.name} - ${comarca}`;

              // Duplication check in existing database orders
              const alreadyExists = existingOrders.some((o) => {
                if (!o.isSurvey || o.surveyLocation !== comarca) return false;
                if (o.title !== title) return false;
                return isSamePeriod(o.startDate || o.scheduledDate, dates.scheduledDate, 'Semanal');
              });

              previewList.push({
                id: idCounter++,
                assetName: 'S/V - Vistoria Periódica',
                assetCode: 'PE-VISTORIA',
                title: title,
                scheduledDate: dates.scheduledDate,
                startDate: dates.startDate,
                endDate: dates.endDate,
                periodicity: 'Semanal',
                type: 'survey',
                management: t.targetSectorOrType || 'Comarcas',
                comarca: comarca,
                alreadyExists: alreadyExists
              });

              i = limit; // Only generate 1 instance per selected period
            }
          }
        }

        // 2. PREVENTIVE TEMPLATE (Sempre vinculada a ativo por tipo/setor, um por equipamento)
        if (t.type === 'preventive') {
          // Find matching assets across the set comarca and sector filter
          const matchingAssets = assets.filter((asset) => {
            const assetComarca = asset.specs?.COMARCA || asset.specs?.comarca || (asset.location && asset.location.includes(' - ') ? asset.location.split(' - ')[0] : asset.location);
            if (row.comarca !== 'all' && assetComarca.toLowerCase().trim() !== row.comarca.toLowerCase().trim()) return false;

            if (row.sector !== 'all' && asset.sector && asset.sector.toLowerCase().trim() !== row.sector.toLowerCase().trim()) return false;

            const tAssetType = (t.targetAssetType || '').toLowerCase().trim();
            const assetTipoSpec = (asset.specs?.TIPO || asset.specs?.tipo || '').toLowerCase().trim();
            const tSector = (t.targetSectorOrType || '').toLowerCase().trim();
            const assetSector = (asset.sector || '').toLowerCase().trim();

            if (tAssetType && assetTipoSpec) {
              return assetTipoSpec.includes(tAssetType) || tAssetType.includes(assetTipoSpec);
            }
            return assetSector === tSector;
          });

          // Determine periodicities in template to iterate
          const tPeriodicities = (t.periodicity || '').split(',').map((p) => p.trim());

          for (const asset of matchingAssets) {
            const activePeriodicities = asset.periodicities || [];
            const commonPeriodicities = activePeriodicities.filter((ap) =>
              tPeriodicities.some((tp) => tp.toLowerCase() === ap.toLowerCase())
            );

            for (const periodicity of commonPeriodicities) {
              let i = 0;
              const limit = 100;
              while (i < limit) {
                const dates = alignPeriodDates(row.startDate, periodicity);
                const title = `Preventiva ${periodicity} - ${asset.name}`;

                // Duplication check in existing database orders
                const alreadyExists = existingOrders.some((o) => {
                  if (o.isSurvey) return false;
                  if (o.assetId !== asset.id) return false;
                  
                  const oPeriodicity = o.periodicity || (o.title.includes('Mensal') ? 'Mensal' : o.title.includes('Semanal') ? 'Semanal' : o.title.includes('Trimestral') ? 'Trimestral' : o.title.includes('Semestral') ? 'Semestral' : o.title.includes('Anual') ? 'Anual' : '');
                  if (oPeriodicity.toLowerCase().trim() !== periodicity.toLowerCase().trim()) return false;

                  return isSamePeriod(o.startDate || o.scheduledDate, dates.scheduledDate, periodicity);
                });

                previewList.push({
                  id: idCounter++,
                  assetName: asset.name,
                  assetCode: asset.code,
                  title: title,
                  scheduledDate: dates.scheduledDate,
                  startDate: dates.startDate,
                  endDate: dates.endDate,
                  periodicity: periodicity,
                  type: 'preventive',
                  management: asset.sector || t.targetSectorOrType || 'Refrigeração',
                  comarca: asset.specs?.COMARCA || asset.specs?.comarca || (asset.location && asset.location.includes(' - ') ? asset.location.split(' - ')[0] : asset.location) || 'Geral',
                  alreadyExists: alreadyExists
                });

                i = limit; // Only generate 1 instance per selected period
              }
            }
          }
        }
      }
    }

    return previewList;
  };

  const simulationRecords = calculateDryRunSimulation();

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
    return Object.values(duplicateRowMap).some(v => v);
  }, [duplicateRowMap]);

  const removeDuplicateFilters = () => {
    const seen = new Set<string>();
    const uniqueRows = filterRows.filter(r => {
      const key = `${r.templateId}-${r.comarca}-${r.sector}-${r.startDate}-${r.endDate}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    setFilterRows(uniqueRows);
  };

  // Month navigation helpers
  const handlePrevMonth = () => {
    setCalendarMonth(prev => {
      if (prev === 0) {
        setCalendarYear(y => y - 1);
        return 11;
      }
      return prev - 1;
    });
  };

  const handleNextMonth = () => {
    setCalendarMonth(prev => {
      if (prev === 11) {
        setCalendarYear(y => y + 1);
        return 0;
      }
      return prev + 1;
    });
  };

  // Generate calendar days
  const calendarDays = useMemo(() => {
    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const firstDayIndex = new Date(calendarYear, calendarMonth, 1).getDay();

    const days: (Date | null)[] = [];
    // Pad previous empty days
    for (let i = 0; i < firstDayIndex; i++) {
      days.push(null);
    }
    // Days of the month
    for (let d = 1; d <= daysInMonth; d++) {
      days.push(new Date(calendarYear, calendarMonth, d));
    }
    return days;
  }, [calendarMonth, calendarYear]);

  // Translate date to standard "YYYY-MM-DD" local format
  const getDayISOStr = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto font-sans text-slate-900 pb-12">
      
      {/* HEADER SECTION */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-6 rounded-2xl border border-gray-200 shadow-sm gap-4">
        <div>
          <h1 className="text-2xl font-black text-[#0b1c30] tracking-tight flex items-center gap-2">
            <Sliders className="w-6 h-6 text-blue-600" />
            Parametrização de Modelos e Protocolos
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Planeje, versione e gerencie procedimentos preventivos de ativos e vistorias semanais sem ativo, emitindo cronogramas em lote automaticamente.
          </p>
        </div>

        {/* Outer Tabs selector */}
        <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-gray-200 self-stretch md:self-auto gap-1">
          <button
            onClick={() => setSubTab('templates')}
            className={`flex-grow md:flex-initial h-9 px-4 rounded-lg text-xs font-black transition-all flex items-center justify-center gap-1.5 border whitespace-nowrap ${subTab === 'templates' ? 'bg-white text-slate-900 shadow-sm border-gray-200' : 'text-slate-500 hover:text-slate-900 border-transparent'}`}
          >
            <ListChecks className="w-4 h-4 text-blue-600 shrink-0" />
            1. Modelos de Checklists
          </button>
          <button
            onClick={() => setSubTab('generation')}
            className={`flex-grow md:flex-initial h-9 px-4 rounded-lg text-xs font-black transition-all flex items-center justify-center gap-1.5 border whitespace-nowrap ${subTab === 'generation' ? 'bg-white text-slate-900 shadow-sm border-gray-200' : 'text-slate-500 hover:text-slate-900 border-transparent'}`}
          >
            <Calendar className="w-4 h-4 text-emerald-600 shrink-0" />
            2. Geração Automática
          </button>
        </div>
      </div>

      {subTab === 'templates' ? (
        /* ======================== TAB 1: DESIGN TEMPLATES ======================== */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full items-start">
          
          {/* LEFT PANELS: Filters and Templates Map */}
          <div className={`lg:col-span-4 space-y-4 ${mobileActiveView === 'list' ? 'block' : 'hidden lg:block'}`}>
            
            {/* Filter controls */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">
                  Filtrar Classificações
                </span>
                <span className="text-[10px] bg-slate-100 py-0.5 px-2 rounded-full font-bold text-slate-600">
                  {filteredTemplates.length} Modelos
                </span>
              </div>
              
              <div className="grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-lg text-[11px] font-extrabold">
                <button
                  onClick={() => setTemplateFilter('all')}
                  className={`py-1.5 rounded-md transition-all text-center ${templateFilter === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'}`}
                >
                  Todos
                </button>
                <button
                  onClick={() => setTemplateFilter('preventive')}
                  className={`py-1.5 rounded-md transition-all text-center ${templateFilter === 'preventive' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'}`}
                >
                  Preventivas
                </button>
                <button
                  onClick={() => setTemplateFilter('survey')}
                  className={`py-1.5 rounded-md transition-all text-center ${templateFilter === 'survey' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'}`}
                >
                  Vistorias
                </button>
              </div>

              {/* Text Search inside side view */}
              <div className="relative">
                <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Pesquisar por nome, setor, tipo..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-gray-250 rounded-lg text-xs font-semibold focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Creator button */}
              <button
                onClick={handleOpenAddModal}
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-black rounded-lg flex items-center justify-center gap-1.5 transition-all shadow-sm"
              >
                <Plus className="w-4 h-4" />
                Criar Novo Modelo
              </button>
            </div>

            {/* Scrollable checklist items */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-xs">
              <div className="p-4 bg-slate-50 border-b border-gray-100 flex justify-between items-center">
                <span className="text-xs font-black text-slate-700 uppercase tracking-tight flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-slate-500" />
                  Modelos Disponíveis
                </span>
              </div>

              <div className="divide-y divide-gray-100 max-h-[500px] overflow-y-auto">
                {filteredTemplates.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-400">
                    Nenhum modelo cadastrado para este critério de filtro.
                  </div>
                ) : (
                  filteredTemplates.map((tmp) => {
                    const isSelected = selectedTemplate?.id === tmp.id;
                    return (
                      <div
                        key={tmp.id}
                        onClick={() => {
                          setSelectedTemplate(tmp);
                          setExpandedItemId(null);
                          setMobileActiveView('detail');
                        }}
                        className={`p-4 transition-all duration-150 cursor-pointer text-left ${isSelected ? 'bg-blue-50/40 border-l-4 border-blue-600' : 'hover:bg-slate-50'}`}
                      >
                        <div className="flex justify-between items-start gap-2">
                          <h3 className="text-xs font-black text-slate-900 leading-snug">{tmp.name}</h3>
                          <span className={`text-[8px] px-1.5 py-0.5 font-bold rounded-full select-none shrink-0 ${tmp.type === 'preventive' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                            {tmp.type === 'preventive' ? 'PREVENTIVA' : 'VISTORIA'}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 mt-2 text-[10px] text-slate-500 font-bold flex-wrap">
                          <span className="bg-slate-100 py-0.5 px-1.5 rounded text-slate-700">
                            {tmp.targetSectorOrType}
                          </span>
                          
                          {tmp.targetAssetType && (
                            <span className="bg-indigo-50 text-[#3525cd] py-0.5 px-1.5 rounded font-black">
                              Tipo: {tmp.targetAssetType}
                            </span>
                          )}

                          <span className="flex items-center gap-0.5 text-slate-600">
                            <Clock className="w-3 h-3" />
                            {tmp.periodicity}
                          </span>
                          
                          <span className="text-blue-600">
                            • {tmp.checklistItems.length} Itens
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

          </div>

          {/* RIGHT PANELS: Visual builder with advanced forms config */}
          <div className={`lg:col-span-8 ${mobileActiveView === 'detail' ? 'block' : 'hidden lg:block'}`}>
            {selectedTemplate ? (
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm flex flex-col">
                
                {/* Visual Metadata Overview */}
                <div className="p-6 bg-slate-50/70 border-b border-gray-100 space-y-4">
                  {/* MOBILE BACK BUTTON */}
                  <div className="lg:hidden">
                    <button
                      type="button"
                      onClick={() => setMobileActiveView('list')}
                      className="inline-flex items-center gap-2 text-xs font-black text-blue-700 bg-blue-100/60 hover:bg-blue-100 border border-blue-200/50 py-2 px-3.5 rounded-xl transition-all active:scale-95 cursor-pointer shadow-2xs"
                    >
                      <ArrowLeft className="w-4 h-4 text-blue-600 shrink-0" />
                      Voltar para lista de modelos
                    </button>
                  </div>

                  <div className="flex justify-between items-start gap-4">
                    <div className="space-y-1">
                      <h2 className="text-xl font-black text-[#0b1c30] tracking-tight">
                        {selectedTemplate.name}
                      </h2>
                    </div>

                    <button
                      onClick={() => setTemplateToDeleteId(selectedTemplate.id)}
                      className="p-2 text-rose-600 hover:bg-rose-50 text-xs font-black rounded-lg border border-rose-200 transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                      Apagar Modelo
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                    <div className="p-3 bg-white rounded-xl border border-gray-200">
                      <span className="text-[9px] font-extrabold text-slate-400 uppercase block">Categoria</span>
                      <span className="text-xs font-black text-slate-800">
                        {selectedTemplate.type === 'preventive' ? 'Manutenção Preventiva' : 'Vistoria Sem Ativo'}
                      </span>
                    </div>

                     <div className="p-3 bg-white rounded-xl border border-gray-200 transition-all hover:bg-slate-50/50 relative group">
                      <div className="flex justify-between items-start">
                        <span className="text-[9px] font-extrabold text-slate-400 uppercase block mb-1">Setor Alvo</span>
                        {!isEditingTargetSector && (
                          <button
                            type="button"
                            onClick={() => {
                              setIsEditingTargetSector(true);
                              setEditingTargetSectorValue(selectedTemplate.targetSectorOrType);
                            }}
                            className="text-indigo-600 hover:text-indigo-800 text-[10px] font-bold flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity cursor-pointer"
                          >
                            <Edit2 className="w-3 h-3" />
                            Editar
                          </button>
                        )}
                      </div>

                      {isEditingTargetSector ? (
                        <div className="mt-1 space-y-2">
                          <select
                            value={editingTargetSectorValue}
                            onChange={(e) => setEditingTargetSectorValue(e.target.value)}
                            className="w-full text-xs py-1.5 px-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none font-bold text-slate-800 cursor-pointer"
                          >
                            <option value="">Selecione a Gerência/Setor...</option>
                            {managementsList.map((sector) => (
                              <option key={sector} value={sector}>
                                {sector}
                              </option>
                            ))}
                            {!managementsList.includes(selectedTemplate.targetSectorOrType) && selectedTemplate.targetSectorOrType && (
                              <option value={selectedTemplate.targetSectorOrType}>
                                {selectedTemplate.targetSectorOrType} (Atual)
                              </option>
                            )}
                          </select>

                          {/* Text input to allow other custom names */}
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={editingTargetSectorValue}
                              onChange={(e) => setEditingTargetSectorValue(e.target.value)}
                              placeholder="Nome de outro setor..."
                              className="w-full text-[10px] py-1 px-1.5 bg-slate-50 border border-gray-200 rounded-lg text-slate-800 uppercase font-bold"
                            />
                          </div>

                          <div className="flex items-center gap-1.5 mt-1.5">
                            <button
                              type="button"
                              onClick={() => handleUpdateTemplateSector(editingTargetSectorValue)}
                              className="text-[10px] font-black text-white bg-emerald-600 hover:bg-emerald-700 py-1 px-2.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                            >
                              <Check className="w-3 h-3" />
                              Salvar
                            </button>
                            <button
                              type="button"
                              onClick={() => setIsEditingTargetSector(false)}
                              className="text-[10px] font-black text-slate-500 hover:bg-slate-100 py-1 px-2 rounded-lg transition-all cursor-pointer"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <span className="text-xs font-black text-slate-800 uppercase tracking-wide">
                            {selectedTemplate.targetSectorOrType}
                          </span>
                          {selectedTemplate.type === 'survey' && (
                            <span className="text-[8px] text-slate-450 block leading-tight font-medium">
                              Vistoria sem vínculo. Altere o Setor Alvo para encaminhar para outra gerência.
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {selectedTemplate.type === 'preventive' && (
                      <div className="p-3 bg-white rounded-xl border border-gray-200">
                        <span className="text-[9px] font-extrabold text-slate-400 uppercase block">Vínculo Dinâmico (TIPO)</span>
                        <span className="text-xs font-black text-[#3525cd] flex items-center gap-1">
                          {selectedTemplate.targetAssetType ? (
                            <>
                              <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                              {selectedTemplate.targetAssetType}
                            </>
                          ) : (
                            <span className="text-amber-600 font-extrabold flex items-center gap-1">
                              <Info className="w-3.5 h-3.5" />
                              Por Setor
                            </span>
                          )}
                        </span>
                      </div>
                    )}

                    <div className="p-3 bg-white rounded-xl border border-gray-200 transition-all hover:bg-slate-50/50 relative group">
                      <div className="flex justify-between items-start">
                        <span className="text-[9px] font-extrabold text-slate-400 uppercase block mb-1">Periodicidade Agendada</span>
                        {!isEditingPeriodicity && (
                          <button
                            type="button"
                            onClick={() => {
                              setIsEditingPeriodicity(true);
                              setEditingPeriodicityValue(selectedTemplate.periodicity);
                            }}
                            className="text-indigo-600 hover:text-indigo-800 text-[10px] font-bold flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity cursor-pointer"
                          >
                            <Edit2 className="w-3 h-3" />
                            Editar
                          </button>
                        )}
                      </div>

                      {isEditingPeriodicity ? (
                        <div className="mt-1 space-y-2">
                          {/* Option Checkboxes */}
                          <div className="flex flex-wrap gap-2.5 p-2 bg-slate-50 rounded-lg border border-slate-150 animate-fadeIn">
                            {['Semanal', 'Mensal', 'Semestral', 'Anual'].map((p) => {
                              // Split by comma and trim to see if checked
                              const currentSelectedList = editingPeriodicityValue.split(',').map(x => x.trim()).filter(Boolean);
                              const isChecked = currentSelectedList.includes(p);
                              return (
                                <label key={p} className="flex items-center gap-1.5 text-[10.5px] font-bold text-slate-700 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => {
                                      let newList;
                                      if (isChecked) {
                                        newList = currentSelectedList.filter(x => x !== p);
                                      } else {
                                        newList = [...currentSelectedList, p];
                                      }
                                      // Sort in standard order if possible
                                      const order = ['Semanal', 'Mensal', 'Semestral', 'Anual'];
                                      newList.sort((a, b) => order.indexOf(a) - order.indexOf(b));
                                      setEditingPeriodicityValue(newList.join(', '));
                                    }}
                                    className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                  />
                                  {p}
                                </label>
                              );
                            })}
                          </div>

                          {/* Manual Input Override */}
                          <div className="space-y-1">
                            <span className="text-[8px] font-extrabold text-slate-400 uppercase block">Edição Direta/Customizada</span>
                            <input
                              type="text"
                              value={editingPeriodicityValue}
                              onChange={(e) => setEditingPeriodicityValue(e.target.value)}
                              placeholder="Outra periodicidade (ex: Trimestral, Bimensal)..."
                              className="w-full text-[10px] py-1 px-1.5 bg-slate-50 border border-gray-250 rounded-lg text-slate-800 font-bold"
                            />
                          </div>

                          {/* Action Buttons */}
                          <div className="flex items-center gap-1.5 mt-1">
                            <button
                              type="button"
                              onClick={() => handleUpdateTemplatePeriodicity(editingPeriodicityValue)}
                              className="text-[10px] font-black text-white bg-emerald-600 hover:bg-emerald-700 py-1 px-2.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                            >
                              <Check className="w-3 h-3" />
                              Salvar
                            </button>
                            <button
                              type="button"
                              onClick={() => setIsEditingPeriodicity(false)}
                              className="text-[10px] font-black text-slate-500 hover:bg-slate-100 py-1 px-2 rounded-lg transition-all cursor-pointer"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <span className="text-xs font-black text-slate-800">
                            {selectedTemplate.periodicity}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Sub-view: Questionnaire List Configuration */}
                <div className="p-6 space-y-6">
                  
                  {/* Section Title */}
                  <div className="flex justify-between items-center">
                    <div>
                      <h3 className="text-xs font-black text-[#0b1c30] uppercase tracking-wider">
                        Perguntas & Regras de Não Conformidade
                      </h3>
                      <p className="text-[10px] text-slate-500">
                        Configure pesos, criticidade, requisitos de preenchimento e abertura imediata de corretivas.
                      </p>
                    </div>
                    <span className="text-xs font-extrabold text-slate-500">
                      Total: {selectedTemplate.checklistItems.length} Itens
                    </span>
                  </div>

                  {/* Checklist Items Interactive Accordions */}
                  <div className="space-y-3">
                    {selectedTemplate.checklistItems.length === 0 ? (
                      <div className="p-12 text-center text-xs text-slate-400 border border-dashed rounded-xl">
                        Ainda não há perguntas cadastradas neste modelo de checklist. Adicione uma no formulário abaixo!
                      </div>
                    ) : (
                      selectedTemplate.checklistItems.map((item, index) => {
                        const isExpanded = expandedItemId === item.id;
                        return (
                          <div
                            key={item.id}
                            className={`border rounded-xl transition-all ${item.isActive ? 'bg-white border-gray-200 shadow-xs' : 'bg-slate-50/70 border-dashed border-slate-200 opacity-60'}`}
                          >
                            
                            {/* Header Slot */}
                            <div className="p-4 flex items-center justify-between gap-4">
                              <div className="flex items-start gap-3 min-w-0 flex-1">
                                <button
                                  type="button"
                                  onClick={() => handleToggleItemActive(item.id)}
                                  className="mt-1 flex-shrink-0"
                                >
                                  {item.isActive ? (
                                    <ToggleLeft className="w-7 h-7 text-emerald-600 cursor-pointer" />
                                  ) : (
                                    <ToggleRight className="w-7 h-7 text-slate-400 cursor-pointer" />
                                  )}
                                </button>

                                <div className="min-w-0">
                                  <p className={`text-xs font-bold ${item.isActive ? 'text-slate-900' : 'text-slate-400 line-through'}`}>
                                    {item.task}
                                  </p>
                                  
                                  {/* Badges indicators */}
                                  <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[9px] font-black">

                                    {/* Tipo de resposta badge */}
                                    <span className={`px-2 py-0.5 rounded-full ${
                                      (item.responseType || 'three_states') === 'three_states' ? 'bg-indigo-50 text-[#3525cd] border border-indigo-100' :
                                      item.responseType === 'text' ? 'bg-indigo-100 text-indigo-700' :
                                      item.responseType === 'number' ? 'bg-cyan-50 text-cyan-700' :
                                      item.responseType === 'boolean' ? 'bg-teal-50 text-teal-700' :
                                      'bg-slate-150 text-slate-700'
                                    }`}>
                                      Resposta: {
                                        (item.responseType || 'three_states') === 'three_states' ? 'Check (Atestado/Não Atestado/N.A.)' :
                                        item.responseType === 'text' ? 'Texto Livre' :
                                        item.responseType === 'number' ? 'Número' :
                                        item.responseType === 'boolean' ? 'Sim/Não' :
                                        'Data'
                                      }
                                    </span>

                                    {item.observationRequired && (
                                      <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                                        Observação Obrigatória
                                      </span>
                                    )}

                                    {item.autoCreateCorrective && (
                                      <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-600 border border-rose-100 uppercase tracking-widest text-[8px]">
                                        Solicitação de Corretiva Aut.
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                {/* Order buttons (Up and Down) */}
                                <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg p-0.5 divide-x divide-slate-150 shrink-0 shadow-3xs">
                                  <button
                                    type="button"
                                    onClick={() => handleMoveItem(item.id, 'up')}
                                    disabled={index === 0}
                                    className={`p-1 transition-all rounded-l ${index === 0 ? 'text-slate-200 cursor-not-allowed bg-slate-50' : 'text-slate-600 hover:text-[#3525cd] hover:bg-white active:scale-90 cursor-pointer'}`}
                                    title="Mover Pergunta para Cima"
                                  >
                                    <ArrowUp className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleMoveItem(item.id, 'down')}
                                    disabled={index === selectedTemplate.checklistItems.length - 1}
                                    className={`p-1 transition-all rounded-r ${index === selectedTemplate.checklistItems.length - 1 ? 'text-slate-200 cursor-not-allowed bg-slate-50' : 'text-slate-600 hover:text-[#3525cd] hover:bg-white active:scale-90 cursor-pointer'}`}
                                    title="Mover Pergunta para Baixo"
                                  >
                                    <ArrowDown className="w-3 h-3" />
                                  </button>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                                  className="p-1 px-2.5 rounded hover:bg-slate-100 text-[10px] text-blue-600 font-bold flex items-center gap-1 cursor-pointer"
                                >
                                  {isExpanded ? (
                                    <>
                                      Fechar <ChevronUp className="w-3.5 h-3.5" />
                                    </>
                                  ) : (
                                    <>
                                      Regras <ChevronDown className="w-3.5 h-3.5" />
                                    </>
                                  )}
                                </button>
                                
                                <button
                                  type="button"
                                  onClick={() => handleDeleteItem(item.id)}
                                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-all cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            {/* Expanded parameters form */}
                            {isExpanded && (
                              <div className="px-4 pb-4 border-t border-slate-100 bg-slate-50/50 p-4 rounded-b-xl space-y-4 text-xs animate-in slide-in-from-top-1 duration-150">


                                {/* Custom Response Types Setting */}
                                <div className="space-y-1.5 pt-1">
                                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase">
                                    Tipo de Resposta do Checklist / Pergunta
                                  </label>
                                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 bg-white p-1.5 rounded-lg border border-gray-200">
                                    {[
                                      { val: 'three_states', label: 'Check (Atestado/Não/N.A.)', desc: 'Atestado, Não Atestado ou Não se Aplica' },
                                      { val: 'text', label: 'Texto Livre', desc: 'Campo de texto descritivo de campo' },
                                      { val: 'number', label: 'Número', desc: 'Valor para medições numéricas' },
                                      { val: 'boolean', label: 'Sim ou Não', desc: 'Alternância simples Sim/Não' },
                                      { val: 'date', label: 'Data', desc: 'Input formatado para data técnica' }
                                    ].map((opt) => {
                                      const activeVal = item.responseType || 'three_states';
                                      const isSel = activeVal === opt.val;
                                      return (
                                        <button
                                          key={opt.val}
                                          type="button"
                                          onClick={() => handleUpateItemRules(item.id, { responseType: opt.val as any })}
                                          className={`py-2 px-1 rounded text-[10px] font-bold text-center transition-all border flex flex-col items-center justify-center cursor-pointer ${
                                            isSel
                                              ? 'bg-[#3525cd] text-white border-[#3525cd] shadow-xs'
                                              : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border-gray-200 hover:text-slate-950'
                                          }`}
                                          title={opt.desc}
                                        >
                                          {opt.label}
                                        </button>
                                      );
                                    })}
                                  </div>
                                  {(item.responseType || 'three_states') === 'three_states' ? (
                                    <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg text-[10px] font-medium leading-normal flex items-start gap-1.5 shadow-3xs mt-1">
                                      <span className="text-[12px] leading-none shrink-0">💡</span>
                                      <span>
                                        <strong>Regra Técnica Base:</strong> Ao selecionar a opção <strong>"Check"</strong>, se o técnico marcar <strong>"Não Atestado"</strong> em campo, o sistema exigirá <strong>obrigatoriamente</strong> um <strong>motivo</strong> descritivo antes de salvar.
                                      </span>
                                    </div>
                                  ) : (
                                    <span className="text-[9px] text-slate-400 block mt-1">
                                      Determina qual componente de entrada será fornecido na vistoria do técnico de campo.
                                    </span>
                                  )}
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                                  
                                  <div className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-gray-200">
                                    <div>
                                      <span className="font-bold block text-[10.5px] text-slate-800">Observação Obrigatória</span>
                                      <span className="text-[9px] text-slate-400">Exigir preenchimento descritivo</span>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleUpateItemRules(item.id, { observationRequired: !item.observationRequired })}
                                      className={`px-2.5 py-1 rounded text-[10px] font-black cursor-pointer ${item.observationRequired ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-600'}`}
                                    >
                                      {item.observationRequired ? 'SIM' : 'NÃO'}
                                    </button>
                                  </div>

                                  <div className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-gray-200">
                                    <div>
                                      <span className="font-bold block text-[10.5px] text-slate-800">Solicitação de Corretiva Aut.</span>
                                      <span className="text-[9px] text-slate-400">Gera OS corretivo imediato</span>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleUpateItemRules(item.id, { autoCreateCorrective: !item.autoCreateCorrective })}
                                      className={`px-2.5 py-1 rounded text-[10px] font-black cursor-pointer ${item.autoCreateCorrective ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-600'}`}
                                    >
                                      {item.autoCreateCorrective ? 'ATIVO' : 'DESL.'}
                                    </button>
                                  </div>

                                </div>
                              </div>
                            )}

                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Add New Check Item inline form */}
                  <form onSubmit={handleAddNewItemToSelected} className="flex gap-2 pt-2 border-t border-slate-100">
                    <input
                      type="text"
                      required
                      placeholder="Adicionar nova pergunta padrão de controle de qualidade física..."
                      value={newCustomTaskText}
                      onChange={(e) => setNewCustomTaskText(e.target.value)}
                      className="flex-1 text-xs py-2.5 px-4 bg-slate-50 border border-slate-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-white transition-all font-semibold"
                    />
                    <button
                      type="submit"
                      className="px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl flex items-center justify-center cursor-pointer transition-all active:scale-95 text-xs font-black gap-1.5 shrink-0"
                    >
                      <Plus className="w-4 h-4" />
                      Inserir Item
                    </button>
                  </form>



                </div>

              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-200 p-16 text-center text-slate-400 flex flex-col items-center justify-center min-h-[450px]">
                <Settings className="w-12 h-12 text-slate-300 mb-3 animate-pulse" />
                <p className="text-xs font-bold text-slate-600">Nenhum Modelo Operacional Selecionado</p>
                <p className="text-[10px] text-slate-400 max-w-sm mt-1 leading-normal">
                  Selecione um dos checklists da lista à esquerda ou clique no botão azul para configurar uma nova ementa de preventiva do zero.
                </p>
              </div>
            )}
          </div>

        </div>
      ) : (
        /* ======================== TAB 2: AUTOMATIC SCHEDULER GENERATOR ======================== */
        <div className="space-y-6">
          
          {/* Main Control Panel Dashboard */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-6 shadow-sm">
            <h2 className="text-lg font-black text-[#0b1c30] flex items-center gap-2">
              <Calendar className="w-5 h-5 text-emerald-600" />
              Geração de Atividades Preventivas Programadas em Lote
            </h2>
            <p className="text-xs text-slate-500 leading-relaxed max-w-4xl">
              Nesta área vocé pode expandir a malha preventiva de todos os seus ativos cadastrados instantaneamente. O motor irá varrer a base de dados de equipamentos, ler suas parametrizações de periodicidade descritas no "Tipo" e emitir as ordens de vistorias correspondentes na fila de execução. 
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
                  const filteredTemplatesForSelect = templates.filter(t => {
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
                                : `Filtrados p/ Gerência (${filteredTemplatesForSelect.length})`
                              }
                            </option>
                            {filteredTemplatesForSelect.map(t => (
                              <option key={t.id} value={t.id}>
                                [{t.type === 'preventive' ? 'PREV' : 'VIST'}] {t.name} {t.targetSectorOrType ? `(${t.targetSectorOrType})` : ''}
                              </option>
                            ))}
                          </select>
                        </div>

                      {/* Comarca Filter */}
                      <div>
                        <label className="block text-[9px] font-black text-[#0b1c30] uppercase mb-1 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                          Comarca
                        </label>
                        <select
                          value={row.comarca}
                          onChange={(e) => updateFilterRow(row.id, 'comarca', e.target.value)}
                          className="w-full text-xs font-extrabold h-[38px] px-3 bg-slate-50 hover:bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer text-slate-800 transition-colors"
                        >
                          <option value="all">Todas as Comarcas ({existingComarcas.length})</option>
                          {existingComarcas.map(c => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </div>

                      {/* Operational Sector Filter */}
                      <div>
                        <label className="block text-[9px] font-black text-[#0b1c30] uppercase mb-1 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                          Gerência / Setor Destinatário
                        </label>
                        <select
                          value={row.sector}
                          onChange={(e) => updateFilterRow(row.id, 'sector', e.target.value)}
                          className="w-full text-xs font-extrabold h-[38px] px-3 bg-slate-50 hover:bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer text-slate-800 transition-colors"
                        >
                          <option value="all">Todas as Gerências ({managementsList.length})</option>
                          {managementsList.map(s => (
                            <option key={s} value={s}>{s}</option>
                          ))}
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
              const isDuplicateSafe = !hasDuplicateRuleError;

              return (
                <div className={`rounded-2xl p-5 border flex flex-col md:flex-row justify-between items-center gap-4 transition-all duration-200 ${
                  hasDuplicateRuleError 
                    ? 'bg-rose-50 border-rose-200 ring-4 ring-rose-500/10' 
                    : countNew === 0
                      ? 'bg-amber-50 border-amber-200 ring-4 ring-amber-500/5'
                      : 'bg-emerald-50 border-emerald-100'
                }`}>
                  <div className="space-y-1 w-full md:w-auto text-left flex-1">
                    <div className="flex items-center gap-1.5">
                      {hasDuplicateRuleError ? (
                        <>
                          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 animate-pulse" />
                          <span className="font-extrabold text-xs text-rose-900 uppercase tracking-wider">Aviso de Regra Redundante ou Duplicada</span>
                        </>
                      ) : countNew === 0 ? (
                        <>
                          <CheckCircle2 className="w-5 h-5 text-amber-600 shrink-0" />
                          <span className="font-extrabold text-xs text-amber-950 uppercase tracking-wider">Cronograma Totalmente Preenchido</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-5 h-5 text-emerald-600 shrink-0" />
                          <span className="font-extrabold text-xs text-emerald-900 uppercase tracking-wider">Simulação Operacional de Cadastro Realizada</span>
                        </>
                      )}
                    </div>
                    
                    {hasDuplicateRuleError ? (
                      <div className="space-y-2">
                        <p className="text-[11px] text-rose-800 leading-normal max-w-2xl">
                          Existem filtros idênticos ou redundantes com exatamente as mesmas regras de modelo, comarca, gerência e datas na grade acima. O motor de agendamentos impede o processamento com regras repetidas para evitar OS redundantes no banco de dados.
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
                        <p className="text-[11px] text-slate-600 leading-normal max-w-2xl">
                          Análise de cobertura para {assets.length} ativos e {templates.length} modelos de conformidade:
                        </p>
                        <div className="flex flex-wrap gap-2 pt-1">
                          <span className="text-[10px] bg-emerald-600 text-white font-black px-2.5 py-1 rounded-md shadow-3xs uppercase tracking-wider">
                            🆕 {countNew} Novas Programações a Agendar
                          </span>
                          {countExists > 0 && (
                            <span className="text-[10px] bg-slate-500 text-white font-black px-2.5 py-1 rounded-md shadow-3xs border border-slate-600/30 uppercase tracking-wider">
                              ✔️ {countExists} Já Programadas (Bloqueadas para evitar duplicidades)
                            </span>
                          )}
                        </div>
                        {countNew === 0 && (
                          <p className="text-[10.5px] text-amber-800 font-extrabold pt-1">
                            ⚠️ Bloqueio Preventivo: Todas as programações deste lote já existem no banco de dados para os respectivos períodos de recorrência.
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
                        ? "Não é possível salvar com regras repetidas na grade" 
                        : countNew === 0 
                          ? "Não há novas programações pendentes para agendar neste período"
                          : "Processar geração de preventivas hoje"
                    }
                  >
                    <RefreshCw className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
                    {isGenerating 
                      ? 'PROCESSANDO OS NO BANCO...' 
                      : hasDuplicateRuleError 
                        ? '🚫 BLOQUEADO: REMOVA DUPLICADOS' 
                        : countNew === 0
                          ? '✔️ CRONOGRAMA EM DIA'
                          : 'GERAR CRONOGRAMA EM LOTE'
                    }
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
                    Selecione um período ou adicione modelos compatíveis com os ativos para que o mapa de preventivas não fique em branco.
                  </div>
                ) : (
                  simulationRecords.slice(0, 15).map((sim, index) => (
                    <div key={index} className={`bg-white rounded-xl border p-4 relative overflow-hidden shadow-xs text-left transition-all ${
                      sim.alreadyExists 
                        ? 'border-dashed border-slate-300 bg-slate-50/50 opacity-70' 
                        : 'border-gray-200'
                    }`}>
                      <span className={`absolute top-0 right-0 px-2 py-0.5 text-[8px] font-black rounded-bl ${
                        sim.alreadyExists
                          ? 'bg-slate-200 text-slate-600 border-l border-b border-slate-300'
                          : sim.type === 'preventive' 
                            ? 'bg-blue-50 text-blue-700 border-l border-b border-blue-100' 
                            : 'bg-purple-50 text-purple-700 border-l border-b border-purple-100'
                      }`}>
                        {sim.alreadyExists ? 'JÁ EXISTE' : sim.type === 'preventive' ? 'ATIVO' : 'VISTORIA'}
                      </span>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-[9px] font-extrabold gap-1">
                          <span className="font-extrabold text-[#3525cd] bg-indigo-50 px-2 py-0.5 rounded shrink-0">ID: #{sim.id}</span>
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

                        <h4 className={`text-xs font-black line-clamp-1 ${sim.alreadyExists ? 'text-slate-400 line-through italic' : 'text-[#0b1c30]'}`}>{sim.title}</h4>
                        
                        {/* Execution Window */}
                        <div className="grid grid-cols-2 gap-1.5 py-1 text-[9px] font-extrabold">
                          <div className={`p-1.5 rounded border flex flex-col ${
                            sim.alreadyExists 
                              ? 'bg-slate-100 text-slate-400 border-slate-200' 
                              : 'bg-emerald-50 text-emerald-800 border-emerald-100/50'
                          }`}>
                            <span className={`text-[7.5px] uppercase ${sim.alreadyExists ? 'text-slate-400' : 'text-emerald-600'}`}>Data de início</span>
                            <span>{formatDateBR(sim.startDate)}</span>
                          </div>
                          <div className={`p-1.5 rounded border flex flex-col ${
                            sim.alreadyExists 
                              ? 'bg-slate-100 text-slate-400 border-slate-200' 
                              : 'bg-rose-50 text-rose-800 border-rose-100/50'
                          }`}>
                            <span className={`text-[7.5px] uppercase ${sim.alreadyExists ? 'text-slate-400' : 'text-rose-600'}`}>Data final</span>
                            <span>{formatDateBR(sim.endDate)}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 pt-1.5 border-t border-slate-50 text-[10px] text-slate-500 font-semibold">
                          <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded font-black shrink-0">
                            {sim.assetCode}
                          </span>
                          <span className="line-clamp-1">
                            {sim.assetName}
                          </span>
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
                  Em conformidade com as diretivas do PMOC (Manual de Operação e Controle) e da regulamentação nacional da Engenharia Predial, vistorias de inspeção em áreas comuns e rotas de segurança devem seguir rígida periodicidade semanal. Por outro lado, para ativos e máquinas rotativas (tais como chillers, condensadores e subestações), as atividades preventivas se estendem às periodicidades mensais, semestrais e anuais com checklists baseados exclusivamente no seu respectivo histórico de vida útil.
                </p>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* NEW TEMPLATE CREATION MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-lg overflow-hidden flex flex-col animate-in zoom-in-95 duration-150">
            <div className="p-6 bg-[#0b1c30] text-white flex justify-between items-center">
              <div>
                <h3 className="font-extrabold text-sm tracking-tight flex items-center gap-1.5">
                  <PlusCircle className="w-5 h-5 text-blue-400" />
                  Cadastrar Novo Modelo de Checklist
                </h3>
                <p className="text-[10px] text-slate-300 mt-0.5">Defina as parametrizações básicas e perguntas iniciais.</p>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-white hover:opacity-80 p-1 bg-white/10 rounded-full transition-all cursor-pointer"
              >
                <Plus className="w-5 h-5 rotate-45" />
              </button>
            </div>

            <form onSubmit={handleCreateTemplate} className="p-6 space-y-4 text-left">
              <div>
                <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">
                  Nome do modelo descritivo*
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Preventiva Trimestral - Geradores de Energia"
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  className="w-full text-xs py-2.5 px-3.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 font-semibold"
                />
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">
                    Tipo de Fluxo*
                  </label>
                  <select
                    value={newTemplateType}
                    onChange={(e) => {
                      const type = e.target.value as 'preventive' | 'survey';
                      setNewTemplateType(type);
                      if (type === 'preventive') {
                        const firstType = existingAssetTypes[0] || '';
                        setNewTemplateAssetType(firstType);
                        if (firstType) {
                          const matchedAsset = assets.find(a => {
                            const t = a.specs?.TIPO || a.specs?.tipo;
                            return t && typeof t === 'string' && t.trim().toLowerCase() === firstType.trim().toLowerCase();
                          });
                          if (matchedAsset && matchedAsset.sector) {
                            setNewTemplateTargetSector(matchedAsset.sector);
                          } else {
                            const activeMgmts = managements.filter(m => m.name !== 'Todas');
                            setNewTemplateTargetSector(activeMgmts[0]?.name || 'Refrigeração');
                          }
                        } else {
                          const activeMgmts = managements.filter(m => m.name !== 'Todas');
                          setNewTemplateTargetSector(activeMgmts[0]?.name || 'Refrigeração');
                        }
                        setNewTemplatePeriodicities(['Mensal']);
                      } else {
                        setNewTemplateTargetSector('Comarcas');
                        setNewTemplateAssetType('');
                        setNewTemplatePeriodicities(['Semanal']);
                      }
                    }}
                    className="w-full text-xs py-2 px-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none font-bold animate-transition"
                  >
                    <option value="preventive">Preventiva (Vinculada a Ativo)</option>
                    <option value="survey">Vistoria (Sem Ativo / Independente)</option>
                  </select>
                </div>

                {newTemplateType === 'preventive' ? (
                  <>
                    {/* PERIODICITIES SELECTION (Mensal, Semestral, Anual checkboxes) */}
                    <div>
                      <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-2">
                        Periodicidade(s) do Checklist (Selecione uma ou mais)*
                      </label>
                      <div className="flex flex-wrap gap-4 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                        {['Mensal', 'Semestral', 'Anual'].map((p) => {
                          const isChecked = newTemplatePeriodicities.includes(p);
                          return (
                            <label key={p} className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  if (isChecked) {
                                    if (newTemplatePeriodicities.length > 1) {
                                      setNewTemplatePeriodicities(newTemplatePeriodicities.filter(item => item !== p));
                                    }
                                  } else {
                                    setNewTemplatePeriodicities([...newTemplatePeriodicities, p]);
                                  }
                                }}
                                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                              />
                              {p}
                            </label>
                          );
                        })}
                      </div>
                      <span className="text-[8px] text-slate-400 mt-1 block">O checklist será instanciado na fila pelas preventivas ativadas.</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* LINKED ASSET TYPE SELECTOR */}
                      <div>
                        <label className="block text-[10px] font-extrabold text-[#3525cd] uppercase mb-1">
                          Vincular por TIPO (Ativos no Banco)*
                        </label>
                        <select
                          value={newTemplateAssetType}
                          onChange={(e) => handleAssetTypeChange(e.target.value)}
                          required
                          className="w-full text-xs py-2 px-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none font-bold"
                        >
                          <option value="">Selecione um Tipo do banco...</option>
                          {existingAssetTypes.map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                        <span className="text-[8px] text-slate-400 mt-1 block">Filtra ativos que contenham esta palavra na especificação TIPO.</span>
                      </div>

                      {/* AUTO-FILLED TARGET SECTOR DISPLAY */}
                      <div>
                        <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">
                          Setor do Ativo (Preenchido Automaticamente)*
                        </label>
                        <input
                          type="text"
                          readOnly
                          disabled
                          value={newTemplateTargetSector}
                          className="w-full text-xs py-2 px-3 bg-slate-100 border border-slate-200 rounded-lg focus:outline-none font-bold text-slate-500 cursor-not-allowed"
                        />
                        <span className="text-[8px] text-slate-400 mt-1 block">Herdado diretamente do cadastro do ativo no banco.</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {/* TARGET SURVEY WORKSPACE LOCATION */}
                    <div>
                      <label className="block text-[10px] font-extrabold text-[#3525cd] uppercase mb-1">
                        Área / Local Principal da Vistoria (Comarcas)*
                      </label>
                      <input
                        type="text"
                        readOnly
                        disabled
                        value="Todas as Comarcas (Automático)"
                        className="w-full text-xs py-2 px-3 bg-slate-100 border border-slate-200 rounded-lg focus:outline-none font-bold text-slate-500 cursor-not-allowed"
                      />
                      <span className="text-[10px] text-slate-500 mt-2 block leading-relaxed">
                        A vistoria semanal será gerada em lote para todas as comarcas cadastradas no banco de dados de ativos:
                        <span className="flex flex-wrap gap-1.5 mt-1.5">
                          {existingComarcas.map((comarca) => (
                            <span key={comarca} className="px-2 py-0.5 bg-blue-50 border border-blue-100 rounded-md font-bold text-[9px] text-blue-700 uppercase">
                              {comarca}
                            </span>
                          ))}
                        </span>
                      </span>
                    </div>

                    {/* ALWAYS SEMANAL BANNER FOR RE-ASSURANCE */}
                    <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-lg flex items-center gap-2 text-[11px] font-medium text-emerald-800">
                      <span className="font-extrabold uppercase text-xs text-emerald-600">Frequência Semanal</span>
                      <span>• Todas as vistorias independentes sem ativos vinculados são semanais por padrão.</span>
                    </div>
                  </>
                )}
              </div>

              <div>
                <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">
                  Perguntas Iniciais do Checklist (Uma por linha)*
                </label>
                <textarea
                  rows={4}
                  required
                  placeholder="Verificação de fiação elétrica&#10;Limpeza e higienização física&#10;Controle térmico de operação"
                  value={newTemplateInitialTasks}
                  onChange={(e) => setNewTemplateInitialTasks(e.target.value)}
                  className="w-full text-xs py-2.5 px-3.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 font-semibold"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-700 text-xs font-black rounded-lg transition-all active:scale-95 cursor-pointer hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-black rounded-lg transition-all active:scale-95 shadow-md cursor-pointer"
                >
                  Criar Modelo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CUSTOM DELETE CONFIRMATION MODAL */}
      {templateToDeleteId && (
        <div className="fixed inset-0 z-50 bg-slate-900/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full border border-gray-150 transform transition-all animate-in fade-in zoom-in-95 duration-150 text-left">
            <div className="flex items-center gap-3 text-rose-600 mb-4">
              <div className="bg-rose-50 p-2.5 rounded-full border border-rose-100">
                <Trash2 className="w-5 h-5 text-rose-600" />
              </div>
              <h3 className="font-extrabold text-[#0b1c30] text-sm tracking-tight uppercase">
                Excluir Modelo?
              </h3>
            </div>
            
            <p className="text-xs text-slate-600 leading-relaxed mb-6 font-medium">
              Tem certeza de que deseja excluir permanentemente este modelo de checklist? As vistorias ou preventivas agendadas por este modelo deixarão de ser geradas automaticamente. Esta ação é irreversível.
            </p>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTemplateToDeleteId(null)}
                className="px-4 py-2 border border-gray-250 text-slate-650 rounded-lg text-[11px] font-black uppercase tracking-wider hover:bg-gray-50 active:scale-95 transition-all duration-150 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={async () => {
                  await handleDeleteTemplate(templateToDeleteId);
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[11px] font-black uppercase tracking-wider active:scale-95 transition-all duration-155 cursor-pointer shadow-sm border border-rose-700"
              >
                Sim, Excluir
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
