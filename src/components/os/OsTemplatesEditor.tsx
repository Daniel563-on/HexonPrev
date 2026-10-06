import React, { useEffect, useState } from 'react';
import OsPdfMapper from './OsPdfMapper';
import { ArrowDown, ArrowUp, Copy, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { HexonUser, OsFieldType, OsFieldWidth, OsSignatureRole, OsStage, OsSystemField, OsTemplate, OsTemplateField } from '../../types';
import {
  OS_LOCKED_SYSTEM,
  OS_SYSTEM_HINT,
  OS_SYSTEM_STAGE,
  OS_CONDITION_TYPES,
  OsStageItem,
  dbDeleteOsTemplate,
  dbGetOsTemplates,
  dbSaveOsTemplate,
  osConditionOptions,
  defaultSystemFields,
  stageItems
} from '../../db/firebase';

// MODELOS DE OS (em Configurações): Criação, Execução, Sistema e Fluxo/assinaturas.
// Quem pode editar e quem pode emitir fica só no Perfil de acesso (Usuários).
// Cada OS guarda uma cópia do modelo na emissão: mudar o modelo vale só para as próximas OS.

type Tab = 'criacao' | 'execucao' | 'sistema' | 'assinaturas' | 'pdf';

// Tipos oferecidos ao criar pergunta (o 'checkbox' antigo é lido como Sim/Não)
const TYPE_LABEL: Record<Exclude<OsFieldType, 'checkbox'>, string> = {
  text: 'Texto curto',
  textarea: 'Texto longo',
  number: 'Número',
  date: 'Data',
  phone: 'Telefone',
  email: 'E-mail',
  select: 'Lista suspensa (uma opção)',
  multiselect: 'Caixas de marcar (várias opções)',
  toggle: 'Liga / desliga',
  yesno: 'Sim / Não',
  signature: 'Assinatura no celular',
  location: 'Local (CRAAI › Comarca › Endereço)'
};
// Largura na tela de Emitir OS (no celular fica sempre inteira)
const WIDTH_LABEL: Record<OsFieldWidth, string> = { full: 'Inteira', half: 'Metade', third: '1/3' };
const widthSelect = (value: OsFieldWidth | undefined, onChange: (w: OsFieldWidth) => void) => (
  <select
    value={value || 'full'}
    onChange={(e) => onChange(e.target.value as OsFieldWidth)}
    title="Largura do campo na tela (no celular fica sempre inteira)"
    className="h-7 px-1.5 text-[10px] font-bold border border-slate-200 rounded-md bg-white cursor-pointer"
  >
    {(Object.keys(WIDTH_LABEL) as OsFieldWidth[]).map((w) => (
      <option key={w} value={w}>{WIDTH_LABEL[w]}</option>
    ))}
  </select>
);

const typeLabel = (f: OsTemplateField) =>
  f.type === 'checkbox' ? TYPE_LABEL.yesno : f.type === 'location' ? (f.locationDepth === 'comarca' ? 'Local (CRAAI › Comarca)' : TYPE_LABEL.location) : TYPE_LABEL[f.type];
const hasOptions = (t: OsFieldType) => t === 'select' || t === 'multiselect';

const SIGN_LABEL: Record<OsSignatureRole, string> = {
  tecnico: 'Técnico',
  cliente: 'Cliente (ou validação por link)',
  engenheiro: 'Engenheiro',
  gerente: 'Gerente'
};
const ALL_SIGNS: OsSignatureRole[] = ['tecnico', 'cliente', 'engenheiro', 'gerente'];

const newId = (p: string) => `${p}_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;

const blankTemplate = (by: string): OsTemplate => {
  const now = new Date().toISOString();
  return {
    id: newId('osmodelo'),
    name: '',
    description: '',
    version: 1,
    fields: [],
    systemFields: defaultSystemFields(),
    signatures: ['tecnico', 'cliente', 'engenheiro', 'gerente'],
    createdAt: now,
    updatedAt: now,
    updatedBy: by
  };
};

const input = 'w-full h-9 px-3 text-xs border border-slate-200 rounded-lg bg-white';
const btnSm = 'h-7 w-7 rounded-md border border-slate-200 flex items-center justify-center cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed bg-white';

export default function OsTemplatesEditor({ userProfile }: { userProfile: HexonUser }) {
  const [templates, setTemplates] = useState<OsTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<OsTemplate | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [tab, setTab] = useState<Tab>('criacao');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<OsTemplate | null>(null);
  const [fieldForm, setFieldForm] = useState<OsTemplateField | null>(null);
  const [mapping, setMapping] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setTemplates(await dbGetOsTemplates(true, userProfile.name));
    } catch (err: any) {
      setError(`Não foi possível carregar os modelos: ${err?.message || err}`);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const open = (t: OsTemplate, fresh: boolean) => {
    setEditing(JSON.parse(JSON.stringify(t)));
    setIsNew(fresh);
    setTab('criacao');
    setError(null);
    setMessage(null);
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) return setError('Informe o nome do modelo.');
    if (templates.some((t) => t.id !== editing.id && t.name.trim().toLowerCase() === editing.name.trim().toLowerCase())) {
      return setError('Já existe um modelo com esse nome.');
    }
    const intervencao = editing.systemFields.find((s) => s.key === 'intervencao');
    if (intervencao?.enabled && (intervencao.options || []).filter((o) => o.trim()).length === 0) {
      return setError('Informe pelo menos uma opção de Intervenção (aba Campos do sistema).');
    }
    const badSelect = editing.fields.find((f) => hasOptions(f.type) && (f.options || []).filter((o) => o.trim()).length === 0);
    if (badSelect) return setError(`A pergunta "${badSelect.label}" é uma lista e precisa de opções.`);
    const badCond = editing.fields.find((f) => f.showIf && !editing.fields.some((p) => p.id === f.showIf!.fieldId && p.stage === f.stage));
    if (badCond) return setError(`A pergunta "${badCond.label}" depende de uma pergunta que não existe mais nesta etapa. Ajuste a condição.`);
    setSaving(true);
    setError(null);
    try {
      const cleaned: OsTemplate = {
        ...editing,
        systemFields: editing.systemFields.map((sf) =>
          sf.options ? { ...sf, label: sf.label.trim() || sf.key, options: sf.options.map((o) => o.trim()).filter(Boolean) } : { ...sf, label: sf.label.trim() || sf.key }
        )
      };
      await dbSaveOsTemplate(cleaned, userProfile.name, isNew);
      setEditing(null);
      setMessage('Modelo salvo. As próximas OS já saem com ele.');
      await load();
    } catch (err: any) {
      setError(`Não foi possível salvar: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setSaving(true);
    try {
      await dbDeleteOsTemplate(toDelete.id);
      setToDelete(null);
      setMessage('Modelo excluído. As OS já emitidas com ele não mudam.');
      await load();
    } catch (err: any) {
      setError(`Não foi possível excluir: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  // ===== Ordem dentro da etapa (perguntas livres e campos do sistema juntos) =====
  const move = (stage: OsStage, index: number, dir: -1 | 1) => {
    if (!editing) return;
    const items = stageItems(editing.fields, editing.systemFields, stage);
    const j = index + dir;
    if (j < 0 || j >= items.length) return;
    [items[index], items[j]] = [items[j], items[index]];
    const orderOf = new Map<string, number>();
    items.forEach((it, i) => orderOf.set(it.kind === 'field' ? `f:${it.field.id}` : `s:${it.sys.key}`, i + 1));
    setEditing({
      ...editing,
      fields: editing.fields.map((f) => (f.stage === stage ? { ...f, order: orderOf.get(`f:${f.id}`) ?? f.order } : f)),
      systemFields: editing.systemFields.map((s) => (OS_SYSTEM_STAGE[s.key] === stage && s.enabled ? { ...s, order: orderOf.get(`s:${s.key}`) ?? s.order } : s))
    });
  };

  const nextOrder = (stage: OsStage) => {
    if (!editing) return 1;
    const items = stageItems(editing.fields, editing.systemFields, stage);
    return items.length ? Math.max(...items.map((i) => i.order)) + 1 : 1;
  };

  const saveField = () => {
    if (!editing || !fieldForm) return;
    if (!fieldForm.label.trim()) return setError('Informe o texto da pergunta.');
    const options = hasOptions(fieldForm.type) ? (fieldForm.options || []).map((o) => o.trim()).filter(Boolean) : undefined;
    if (options && options.length === 0) return setError('Informe as opções da lista.');
    if (fieldForm.showIf && !fieldForm.showIf.value) return setError('Escolha a resposta da condição (ou tire a condição).');
    const clean: OsTemplateField = {
      ...fieldForm,
      label: fieldForm.label.trim(),
      options,
      locationDepth: fieldForm.type === 'location' ? fieldForm.locationDepth || 'endereco' : undefined,
      // Assinatura nunca vale como condição de outra; a própria condição some se a pergunta mudar de etapa
      showIf: fieldForm.showIf || undefined
    };
    const exists = editing.fields.some((f) => f.id === clean.id);
    // Mudou o tipo ou as opções: tira as condições de outras perguntas que não batem mais
    const allowed = OS_CONDITION_TYPES.includes(clean.type) ? osConditionOptions(clean) : [];
    const fields = (exists ? editing.fields.map((f) => (f.id === clean.id ? clean : f)) : [...editing.fields, clean]).map((f) =>
      f.showIf?.fieldId === clean.id && (!allowed.includes(f.showIf.value) || f.stage !== clean.stage) ? { ...f, showIf: undefined } : f
    );
    setEditing({ ...editing, fields });
    setFieldForm(null);
    setError(null);
  };

  const updateSys = (key: OsSystemField['key'], patch: Partial<OsSystemField>) => {
    if (!editing) return;
    setEditing({
      ...editing,
      systemFields: editing.systemFields.map((s) => {
        if (s.key !== key) return s;
        const next = { ...s, ...patch };
        // Ligou de novo: vai para o fim da etapa
        if (patch.enabled && !s.enabled) next.order = nextOrder(OS_SYSTEM_STAGE[key]);
        return next;
      })
    });
  };

  // ===== Telas =====
  if (loading) return <p className="text-xs text-slate-500">Carregando modelos...</p>;

  if (!editing) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500 max-w-2xl">
            O modelo define as perguntas da OS. Mudanças valem para as próximas OS; as já emitidas continuam como foram abertas.
          </p>
          <button
            type="button"
            onClick={() => open(blankTemplate(userProfile.name), true)}
            className="h-9 px-4 rounded-lg bg-[#3525cd] text-white text-xs font-black flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Novo modelo
          </button>
        </div>
        {message && <p className="text-xs font-bold text-emerald-700">{message}</p>}
        {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {templates.map((t) => (
            <div key={t.id} className="p-4 rounded-xl border border-slate-200 bg-white space-y-2">
              <p className="text-sm font-black text-slate-900">{t.name}</p>
              <p className="text-[11px] text-slate-500">
                {t.fields.filter((f) => f.stage === 'criacao').length + t.systemFields.filter((s) => s.enabled && OS_SYSTEM_STAGE[s.key] === 'criacao').length} itens na criação ·{' '}
                {t.fields.filter((f) => f.stage === 'execucao').length} perguntas na execução · versão {t.version}
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => open(t, false)} className="flex-1 h-8 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 text-[11px] font-black cursor-pointer">
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => open({ ...JSON.parse(JSON.stringify(t)), id: newId('osmodelo'), name: `${t.name} (cópia)`, version: 1 }, true)}
                  className="h-8 px-3 rounded-lg border border-slate-200 text-slate-600 text-[11px] font-bold cursor-pointer"
                  title="Duplicar modelo"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => setToDelete(t)} className="h-8 px-3 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 cursor-pointer" title="Excluir modelo">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
          {templates.length === 0 && <p className="text-xs text-slate-500">Nenhum modelo cadastrado.</p>}
        </div>

        {toDelete && (
          <div className="fixed inset-0 z-[1000] bg-slate-900/60 flex items-center justify-center p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white p-5 space-y-3">
              <p className="text-sm font-black text-slate-900">Excluir o modelo "{toDelete.name}"?</p>
              <p className="text-xs text-slate-500">As OS já emitidas com ele não mudam. Não será mais possível emitir OS com este modelo.</p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setToDelete(null)} className="h-8 px-3 rounded-lg border border-slate-200 text-xs font-bold cursor-pointer">Cancelar</button>
                <button type="button" onClick={confirmDelete} disabled={saving} className="h-8 px-3 rounded-lg bg-rose-600 text-white text-xs font-bold cursor-pointer disabled:opacity-50">
                  {saving ? 'Excluindo...' : 'Excluir'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const tabBtn = (key: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={`px-3 py-2 rounded-lg text-[11px] font-black uppercase tracking-wide cursor-pointer ${tab === key ? 'bg-[#3525cd] text-white' : 'text-slate-500 hover:bg-slate-100'}`}
    >
      {label}
    </button>
  );

  const renderStage = (stage: OsStage) => {
    const items: OsStageItem[] = stageItems(editing.fields, editing.systemFields, stage);
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">
            {stage === 'criacao'
              ? 'Perguntas preenchidas por quem emite a OS. Os campos do sistema ligados aparecem aqui junto, na ordem que você escolher.'
              : 'Perguntas que o técnico responde no celular (usadas a partir da Fase 5).'}
          </p>
          <button
            type="button"
            onClick={() => setFieldForm({ id: newId('f'), label: '', type: 'text', required: false, stage, order: nextOrder(stage) })}
            className="h-8 px-3 rounded-lg border border-indigo-300 text-indigo-700 text-[11px] font-black flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Nova pergunta
          </button>
        </div>
        <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 bg-white">
          {items.length === 0 && <p className="p-4 text-xs text-slate-400">Nenhuma pergunta nesta etapa.</p>}
          {items.map((it, i) => (
            <div key={it.kind === 'field' ? it.field.id : it.sys.key} className="p-3 flex items-center gap-3">
              {stage === 'criacao' &&
                widthSelect(it.kind === 'field' ? it.field.width : it.sys.width, (w) =>
                  it.kind === 'field'
                    ? setEditing({ ...editing, fields: editing.fields.map((f) => (f.id === it.field.id ? { ...f, width: w } : f)) })
                    : updateSys(it.sys.key, { width: w })
                )}
              <div className="flex flex-col gap-1">
                <button type="button" className={btnSm} disabled={i === 0} onClick={() => move(stage, i, -1)}><ArrowUp className="w-3.5 h-3.5" /></button>
                <button type="button" className={btnSm} disabled={i === items.length - 1} onClick={() => move(stage, i, 1)}><ArrowDown className="w-3.5 h-3.5" /></button>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-black text-slate-800">
                  {it.kind === 'field' ? it.field.label : it.sys.label}
                  {(it.kind === 'field' ? it.field.required : it.sys.required) && (
                    <span className="ml-2 px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 text-[9px] font-black uppercase">obrigatório</span>
                  )}
                  {it.kind === 'system' && (
                    <span className="ml-2 px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[9px] font-black uppercase">campo do sistema</span>
                  )}
                </p>
                <p className="text-[10px] text-slate-500">
                  {it.kind === 'field'
                    ? `${typeLabel(it.field)}${it.field.options?.length ? ` · ${it.field.options.join(', ')}` : ''}${
                        it.field.showIf ? ` · só quando "${editing.fields.find((f) => f.id === it.field.showIf!.fieldId)?.label || '?'}" = ${it.field.showIf.value}` : ''
                      }`
                    : `${OS_SYSTEM_HINT[it.sys.key]}${it.sys.options?.length ? ` · ${it.sys.options.join(', ')}` : ''}`}
                </p>
              </div>
              {it.kind === 'field' ? (
                <div className="flex gap-1">
                  <button type="button" className={btnSm} title="Editar" onClick={() => setFieldForm({ ...it.field, options: [...(it.field.options || [])] })}><Pencil className="w-3.5 h-3.5" /></button>
                  <button
                    type="button"
                    className={btnSm}
                    title="Duplicar"
                    onClick={() => setEditing({ ...editing, fields: [...editing.fields, { ...it.field, id: newId('f'), label: `${it.field.label} (cópia)`, order: nextOrder(stage) }] })}
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    className={btnSm}
                    title="Excluir"
                    onClick={() =>
                      setEditing({
                        ...editing,
                        fields: editing.fields.filter((f) => f.id !== it.field.id).map((f) => (f.showIf?.fieldId === it.field.id ? { ...f, showIf: undefined } : f))
                      })
                    }
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => setTab('sistema')} className="text-[10px] font-bold text-indigo-700 underline cursor-pointer">configurar</button>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500">Nome do modelo *</span>
            <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={input} placeholder="Ex.: MPRJ OS" />
          </label>
          <label className="block">
            <span className="block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500">Descrição (opcional)</span>
            <input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className={input} />
          </label>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 bg-white border border-slate-200 rounded-xl p-1">
        {tabBtn('criacao', 'Aba 1 — Criação')}
        {tabBtn('execucao', 'Aba 2 — Execução')}
        {tabBtn('sistema', 'Sistema')}
        {tabBtn('assinaturas', 'Fluxo e assinaturas')}
        {tabBtn('pdf', 'PDF mapeado')}
      </div>

      {tab === 'pdf' && (
        <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
          <p className="text-xs text-slate-500">
            Suba o PDF oficial da OS (frente e verso, até 740 KB) e marque onde sai cada informação: perguntas, dados da OS, equipe, materiais e as assinaturas.
            Na ficha da OS, o botão PDF usa este arquivo; sem ele, sai o PDF padrão do sistema. O PDF nunca leva valores em R$.
          </p>
          {isNew ? (
            <p className="text-xs font-bold text-amber-700">Salve o modelo primeiro; depois configure o PDF.</p>
          ) : (
            <button type="button" onClick={() => setMapping(true)} className="h-9 px-4 rounded-lg bg-[#3525cd] text-white text-xs font-black cursor-pointer">
              Configurar PDF mapeado
            </button>
          )}
        </div>
      )}
      {mapping && editing && <OsPdfMapper template={editing} userName={userProfile.name} onClose={() => setMapping(false)} />}

      {tab === 'criacao' && renderStage('criacao')}
      {tab === 'execucao' && renderStage('execucao')}

      {tab === 'sistema' && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">Campos com que o sistema trabalha. Ligue, desligue, renomeie e torne obrigatórios. Gerência e Local da execução ficam sempre ligados: o Hexon precisa deles.</p>
          {(['criacao', 'execucao'] as OsStage[]).map((stage) => (
            <div key={stage} className="rounded-xl border border-slate-200 bg-white">
              <p className="px-4 py-2 border-b border-slate-100 text-[11px] font-black uppercase text-slate-500">
                {stage === 'criacao' ? 'Na criação' : 'Na execução (Fase 5)'}
              </p>
              <div className="divide-y divide-slate-100">
                {editing.systemFields.filter((s) => OS_SYSTEM_STAGE[s.key] === stage).map((s) => {
                  const locked = OS_LOCKED_SYSTEM.includes(s.key);
                  return (
                    <div key={s.key} className="p-3 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] gap-2 items-center">
                      <div className="min-w-0">
                        <p className="text-[11px] font-black text-slate-700 flex items-center gap-1">
                          {locked && <Lock className="w-3 h-3 text-slate-400" />}
                          {OS_SYSTEM_HINT[s.key]}
                        </p>
                        {s.key === 'intervencao' && (
                          <input
                            className={`${input} mt-1`}
                            value={(s.options || []).join(', ')}
                            onChange={(e) => updateSys(s.key, { options: e.target.value.split(',').map((o) => o.trimStart()) })}
                            placeholder="Opções separadas por vírgula: Corretiva, Layout, Acompanhamento, Vistoria"
                          />
                        )}
                      </div>
                      <input className={input} value={s.label} onChange={(e) => updateSys(s.key, { label: e.target.value })} aria-label="Rótulo" />
                      <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700">
                        <input type="checkbox" checked={locked || s.enabled} disabled={locked} onChange={(e) => updateSys(s.key, { enabled: e.target.checked })} />
                        Habilitar
                      </label>
                      <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700">
                        <input
                          type="checkbox"
                          checked={locked || s.required}
                          disabled={locked || !s.enabled || stage === 'execucao' || s.key === 'tecnico' || s.key === 'numeroOs'}
                          onChange={(e) => updateSys(s.key, { required: e.target.checked })}
                        />
                        Obrigatório
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'assinaturas' && (
        <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
          <p className="text-xs text-slate-500">
            Fluxo fixo: Nova (em aberto) → Em andamento (ao atribuir o técnico; o homem-hora começa a contar) → Pendente (pausa com motivo) → Aguardando assinaturas → Concluída. Cancelada a qualquer momento, com motivo.
            Aqui você escolhe quais assinaturas a OS exige e em que ordem (usadas a partir da Fase 5).
          </p>
          <div className="space-y-2">
            {editing.signatures.map((r, i) => (
              <div key={r} className="flex items-center gap-2">
                <button type="button" className={btnSm} disabled={i === 0} onClick={() => {
                  const s = [...editing.signatures];
                  [s[i - 1], s[i]] = [s[i], s[i - 1]];
                  setEditing({ ...editing, signatures: s });
                }}><ArrowUp className="w-3.5 h-3.5" /></button>
                <button type="button" className={btnSm} disabled={i === editing.signatures.length - 1} onClick={() => {
                  const s = [...editing.signatures];
                  [s[i + 1], s[i]] = [s[i], s[i + 1]];
                  setEditing({ ...editing, signatures: s });
                }}><ArrowDown className="w-3.5 h-3.5" /></button>
                <span className="text-xs font-black text-slate-800 flex-1">{i + 1}. {SIGN_LABEL[r]}</span>
                <button type="button" className={btnSm} title="Remover" onClick={() => setEditing({ ...editing, signatures: editing.signatures.filter((x) => x !== r) })}>
                  <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {ALL_SIGNS.filter((r) => !editing.signatures.includes(r)).map((r) => (
              <button key={r} type="button" onClick={() => setEditing({ ...editing, signatures: [...editing.signatures, r] })} className="h-8 px-3 rounded-lg border border-slate-200 text-[11px] font-bold text-slate-700 cursor-pointer">
                + {SIGN_LABEL[r]}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => { setEditing(null); setError(null); }} disabled={saving} className="h-9 px-4 rounded-lg border border-slate-200 text-xs font-bold text-slate-600 cursor-pointer">
          Cancelar
        </button>
        <button type="button" onClick={save} disabled={saving} className="h-9 px-4 rounded-lg bg-[#3525cd] text-white text-xs font-black cursor-pointer disabled:opacity-50">
          {saving ? 'Salvando...' : 'Salvar modelo'}
        </button>
      </div>

      {/* Pergunta: criar / editar */}
      {fieldForm && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-5 space-y-3">
            <p className="text-sm font-black text-slate-900">{editing.fields.some((f) => f.id === fieldForm.id) ? 'Editar pergunta' : 'Nova pergunta'}</p>
            <label className="block">
              <span className="block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500">Pergunta *</span>
              <input className={input} value={fieldForm.label} onChange={(e) => setFieldForm({ ...fieldForm, label: e.target.value })} autoFocus />
            </label>
            <label className="block">
              <span className="block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500">Tipo de resposta</span>
              <select
                className={input}
                value={fieldForm.type === 'checkbox' ? 'yesno' : fieldForm.type}
                onChange={(e) => {
                  const type = e.target.value as OsFieldType;
                  setFieldForm({ ...fieldForm, type, locationDepth: type === 'location' ? fieldForm.locationDepth || 'endereco' : undefined });
                }}
              >
                {(Object.keys(TYPE_LABEL) as (keyof typeof TYPE_LABEL)[]).map((t) => (
                  <option key={t} value={t}>{TYPE_LABEL[t]}</option>
                ))}
              </select>
            </label>
            {hasOptions(fieldForm.type) && (
              <label className="block">
                <span className="block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500">Opções (separadas por vírgula)</span>
                <input
                  className={input}
                  value={(fieldForm.options || []).join(', ')}
                  onChange={(e) => setFieldForm({ ...fieldForm, options: e.target.value.split(',').map((o) => o.trimStart()) })}
                  placeholder="Ex.: ACJ, Split, Bombas, Elevadores, Outros"
                />
              </label>
            )}
            {fieldForm.type === 'location' && (
              <label className="block">
                <span className="block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500">Vai até</span>
                <select className={input} value={fieldForm.locationDepth || 'endereco'} onChange={(e) => setFieldForm({ ...fieldForm, locationDepth: e.target.value as 'comarca' | 'endereco' })}>
                  <option value="comarca">CRAAI › Comarca</option>
                  <option value="endereco">CRAAI › Comarca › Endereço</option>
                </select>
                <span className="block text-[10px] text-slate-500 mt-1">As listas vêm do cadastro de Endereços: escolhido o CRAAI, aparecem só as comarcas dele; escolhida a comarca, só os endereços dela.</span>
              </label>
            )}
            {(fieldForm.type === 'phone' || fieldForm.type === 'email') && (
              <p className="text-[10px] text-slate-500">
                {fieldForm.type === 'phone' ? 'Formato (00) 00000-0000; o sistema confere se tem DDD e número.' : 'O sistema confere se o e-mail está no formato nome@dominio.'}
              </p>
            )}
            <label className="block">
              <span className="block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500">Etapa</span>
              <select
                className={input}
                value={fieldForm.stage}
                onChange={(e) => setFieldForm({ ...fieldForm, stage: e.target.value as OsStage, order: nextOrder(e.target.value as OsStage), showIf: undefined })}
              >
                <option value="criacao">Criação (quem emite)</option>
                <option value="execucao">Execução (técnico)</option>
              </select>
            </label>
            {(() => {
              // Perguntas de resposta fechada da mesma etapa (sem criar volta: A depende de B que depende de A)
              const dependsOn = (f: OsTemplateField, target: string, depth = 0): boolean =>
                !!f.showIf && depth < 10 && (f.showIf.fieldId === target || editing.fields.some((p) => p.id === f.showIf!.fieldId && dependsOn(p, target, depth + 1)));
              const candidates = editing.fields.filter(
                (f) => f.id !== fieldForm.id && f.stage === fieldForm.stage && OS_CONDITION_TYPES.includes(f.type) && !dependsOn(f, fieldForm.id)
              );
              const parent = candidates.find((f) => f.id === fieldForm.showIf?.fieldId);
              return (
                <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 space-y-2">
                  <span className="block text-[10px] font-black uppercase tracking-wider text-slate-500">Mostrar só quando… (opcional)</span>
                  {candidates.length === 0 ? (
                    <p className="text-[10px] text-slate-500">Para usar condição, crie antes nesta etapa uma pergunta de Lista, Caixas de marcar, Sim/Não ou Liga/desliga.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        className={input}
                        value={fieldForm.showIf?.fieldId || ''}
                        onChange={(e) => setFieldForm({ ...fieldForm, showIf: e.target.value ? { fieldId: e.target.value, value: '' } : undefined })}
                      >
                        <option value="">Sempre aparece</option>
                        {candidates.map((f) => (
                          <option key={f.id} value={f.id}>{f.label}</option>
                        ))}
                      </select>
                      {parent && (
                        <select
                          className={input}
                          value={fieldForm.showIf?.value || ''}
                          onChange={(e) => setFieldForm({ ...fieldForm, showIf: { fieldId: parent.id, value: e.target.value } })}
                        >
                          <option value="">for igual a...</option>
                          {osConditionOptions(parent).map((o) => (
                            <option key={o} value={o}>= {o}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                  {fieldForm.showIf && <p className="text-[10px] text-slate-500">Enquanto estiver escondida, a pergunta não é obrigatória.</p>}
                </div>
              );
            })()}
            {fieldForm.stage === 'criacao' && (
              <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                Largura na tela: {widthSelect(fieldForm.width, (w) => setFieldForm({ ...fieldForm, width: w }))}
                <span className="text-[10px] font-normal text-slate-500">(no celular fica sempre inteira)</span>
              </label>
            )}
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
              <input type="checkbox" checked={fieldForm.required} onChange={(e) => setFieldForm({ ...fieldForm, required: e.target.checked })} />
              Resposta obrigatória
            </label>
            {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setFieldForm(null); setError(null); }} className="h-8 px-3 rounded-lg border border-slate-200 text-xs font-bold cursor-pointer">Cancelar</button>
              <button type="button" onClick={saveField} className="h-8 px-3 rounded-lg bg-[#3525cd] text-white text-xs font-bold cursor-pointer">Aplicar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
