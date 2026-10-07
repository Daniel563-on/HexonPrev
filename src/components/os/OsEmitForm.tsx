import React, { useEffect, useState } from 'react';
import { CheckCircle2, Lock } from 'lucide-react';
import { Address, Company, HexonUser, OsFieldWidth, OsLocationAnswer, OsSystemField, OsTemplate, OsTemplateField, WorkOrder } from '../../types';
import {
  OS_EMAIL_OK,
  OS_PHONE_OK,
  companiesOfUnit,
  dbEditWorkOrder,
  dbEmitWorkOrder,
  dbGetCompanies,
  isCompanyVisible,
  osAnswerText,
  dbGetAddresses,
  dbGetOsTemplates,
  dbGetSingleAssetPublic,
  dbGetUsers,
  dbPeekNextOsNumber,
  osFieldVisible,
  stageItems
} from '../../db/firebase';
import OsFieldInput, { LocationPicker, osInput } from './OsFieldInput';

// EMITIR OS (GLPI): a tela mostra exatamente as perguntas da etapa Criação do modelo escolhido
// (perguntas livres + campos do sistema ligados), com as condições ("só quando...") funcionando na hora.
// Gerência: fixa = a de quem abre; Super Administrador e gerência "Todas" escolhem.
// A OS nasce "Nova" (em aberto); quem pode atribuir pode já escolher o técnico e então ela nasce "Em andamento".
// Empresa (etapa especial E4): obrigatória; o técnico da atribuição é da empresa escolhida.
// Modo edição ("editOrder"): mesma tela com os dados da OS "Nova"; gerência, modelo e número não mudam;
// grava só o que mudou e registra cada alteração na linha do tempo.

interface Props {
  userProfile: HexonUser;
  unitOptions: string[]; // gerências para escolher (só Super Administrador / gerência "Todas")
  canAssign: boolean;
  visibleCompanies?: string[] | null; // empresas que vê (null = todas as da gerência)
  onEmitted?: (o: WorkOrder) => void;
  editOrder?: WorkOrder;
  onSaved?: () => void;
  onCancelEdit?: () => void;
}

const input = osInput;
const label = 'block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500';
const todayStr = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// Largura do campo (computador): inteira, metade, um terço — no celular sempre inteira
const SPAN: Record<OsFieldWidth, string> = { full: 'md:col-span-6', half: 'md:col-span-3', third: 'md:col-span-2' };

export default function OsEmitForm({ userProfile, unitOptions, canAssign, visibleCompanies = null, onEmitted, editOrder, onSaved, onCancelEdit }: Props) {
  const isEdit = !!editOrder;
  const chooseUnit = !isEdit && (userProfile.perfil === 'Super Administrador' || userProfile.gerencia === 'Todas');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [company, setCompany] = useState<string>(editOrder?.company || '');
  const [templates, setTemplates] = useState<OsTemplate[]>(() =>
    editOrder
      ? [{ id: editOrder.templateId, name: editOrder.templateName, version: editOrder.templateVersion, fields: editOrder.templateFields, systemFields: editOrder.templateSystemFields, signatures: editOrder.templateSignatures } as OsTemplate]
      : []
  );
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [users, setUsers] = useState<HexonUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [templateId, setTemplateId] = useState(editOrder?.templateId || '');
  const [answers, setAnswers] = useState<Record<string, any>>(() => (editOrder ? { ...editOrder.answers } : {}));
  const [asset, setAsset] = useState<{ id: string; name: string } | null | 'none'>(() =>
    editOrder?.assetId ? { id: editOrder.assetId, name: editOrder.assetName || editOrder.assetCode || '' } : editOrder?.assetCode ? 'none' : null
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<WorkOrder | null>(null);

  useEffect(() => {
    let alive = true;
    dbGetCompanies().then((c) => alive && setCompanies(c)).catch(() => {});
    Promise.all([isEdit ? Promise.resolve([] as OsTemplate[]) : dbGetOsTemplates(true), dbGetAddresses(), canAssign ? dbGetUsers() : Promise.resolve([] as HexonUser[])])
      .then(([t, a, u]) => {
        if (!alive) return;
        if (!isEdit) setTemplates(t);
        setAddresses(a);
        setUsers(u);
        if (!isEdit && t.length === 1) setTemplateId(t[0].id);
      })
      .catch((err) => alive && setError(`Não foi possível carregar: ${err?.message || err}`))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const template = templates.find((t) => t.id === templateId);
  const visible = (f: OsTemplateField) => (template ? osFieldVisible(f, template.fields, answers) : true);
  const items = template ? stageItems(template.fields, template.systemFields, 'criacao').filter((it) => it.kind === 'system' || visible(it.field)) : [];
  const unit: string = editOrder ? editOrder.unit : chooseUnit ? answers['sys:gerencia'] || '' : userProfile.gerencia || '';
  // Empresas da gerência (ativas; na edição, também a que a OS já tem) que o perfil vê
  const unitCompanies = unit
    ? companiesOfUnit(companies, unit).filter((c) => (c.active || c.id === editOrder?.company) && isCompanyVisible(c.id, visibleCompanies))
    : [];
  const companyName = (id?: string) => (id ? companies.find((c) => c.id === id)?.name || id : '—');
  // Técnicos da gerência da OS e, em bloco separado, os que atendem todas as gerências (gerência "Todas") — só da empresa da OS
  const activeTechs = users.filter((u) => u.perfil === 'Profissional' && u.status === 'Ativo' && !!company && (u.companies || []).includes(company));
  const unitTechs = unit ? activeTechs.filter((u) => u.gerencia === unit) : [];
  const allUnitsTechs = unit ? activeTechs.filter((u) => u.gerencia === 'Todas') : [];
  const technicians = [...unitTechs, ...allUnitsTechs];
  const assignOn = !!template?.systemFields.find((s) => s.key === 'tecnico' && s.enabled) && canAssign;

  const reset = () => {
    setAnswers({});
    setAsset(null);
    setCompany('');
  };

  const setA = (key: string, value: any) => setAnswers((prev) => ({ ...prev, [key]: value }));

  // Ativo: busca no cadastro da Gestão de Ativos pelo código ou patrimônio (1 a 3 leituras)
  const [assetBusy, setAssetBusy] = useState(false);
  const checkAsset = async () => {
    const code = String(answers['sys:ativo'] || '').trim();
    if (!code) return setAsset(null);
    setAssetBusy(true);
    const a = await dbGetSingleAssetPublic(code).catch(() => null);
    setAssetBusy(false);
    setAsset(a && !a.kind ? { id: a.id, name: `${a.code} — ${a.name}${a.location ? ` · ${a.location}` : ''}` } : 'none');
  };

  // Nº da OS previsto (o definitivo é reservado ao emitir)
  const [nextNumber, setNextNumber] = useState<string | null>(null);
  const showNumber = !!template?.systemFields.find((s) => s.key === 'numeroOs' && s.enabled);
  useEffect(() => {
    if (showNumber && !done) dbPeekNextOsNumber().then(setNextNumber);
  }, [showNumber, done]);

  const isEmpty = (v: any) =>
    v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0);

  const emit = async () => {
    if (!template) return setError('Escolha o modelo.');
    if (!unit) return setError(chooseUnit ? 'Escolha a gerência responsável.' : 'Seu cadastro está sem gerência: peça ao Super Administrador para corrigir.');
    if (!company) return setError('Escolha a empresa.');
    // Obrigatórios e formatos (só das perguntas visíveis)
    for (const it of items) {
      if (it.kind === 'system') {
        if (it.sys.key === 'gerencia' || it.sys.key === 'empresa' || it.sys.key === 'tecnico' || it.sys.key === 'numeroOs') continue;
        if (it.sys.key === 'ativo') {
          if (it.sys.required && !(asset && asset !== 'none')) return setError(`${it.sys.label}: busque e vincule um ativo cadastrado na Gestão de Ativos.`);
          continue;
        }
        const required = it.sys.required || it.sys.key === 'enderecoExecucao';
        const v = answers[`sys:${it.sys.key}`];
        if (it.sys.key === 'enderecoExecucao') {
          if (v?.manual ? !String(v.address || '').trim() : !v?.addressId) return setError(`Preencha: ${it.sys.label} (CRAAI, comarca e endereço)`);
        } else if (required && isEmpty(v)) return setError(`Preencha: ${it.sys.label}`);
        continue;
      }
      const f = it.field;
      const v = answers[f.id];
      if (f.type === 'toggle') continue; // desligado também é resposta
      if (f.type === 'location') {
        const l = v as OsLocationAnswer | undefined;
        const complete = !!l?.craai && !!l?.comarca && (f.locationDepth === 'comarca' || !!l?.addressId);
        if (f.required && !complete) return setError(`Preencha: ${f.label}`);
        if (l?.craai && !complete) return setError(`Complete: ${f.label}`);
        continue;
      }
      if (f.required && isEmpty(v)) return setError(`Preencha: ${f.label}`);
      if (f.type === 'phone' && !isEmpty(v) && !OS_PHONE_OK(String(v))) return setError(`Telefone incompleto: ${f.label}`);
      if (f.type === 'email' && !isEmpty(v) && !OS_EMAIL_OK(String(v))) return setError(`E-mail inválido: ${f.label}`);
    }
    const exec = answers['sys:enderecoExecucao'] as OsLocationAnswer;
    const tech = assignOn ? technicians.find((t) => t.matricula === answers['sys:tecnico']) : undefined;
    // Guarda só as respostas das perguntas que estão aparecendo
    const kept: Record<string, any> = {};
    template.fields.filter((f) => f.stage === 'criacao' && visible(f)).forEach((f) => {
      if (f.type === 'toggle') kept[f.id] = !!answers[f.id];
      else if (!isEmpty(answers[f.id])) kept[f.id] = answers[f.id];
    });
    Object.keys(answers)
      .filter((k) => k.startsWith('sys:') && k !== 'sys:tecnico' && !isEmpty(answers[k]))
      .forEach((k) => (kept[k] = answers[k]));
    kept['sys:gerencia'] = unit;
    kept['sys:empresa'] = companyName(company); // nome guardado nas respostas (ficha e PDF mostram como estava)
    setBusy(true);
    setError(null);
    try {
      const assetCode = String(answers['sys:ativo'] || '').trim();
      let assetInfo: { id: string; name: string } | null = asset && asset !== 'none' ? asset : null;
      if (assetCode && asset === null) {
        const a = await dbGetSingleAssetPublic(assetCode).catch(() => null);
        assetInfo = a && !a.kind ? { id: a.id, name: `${a.code} — ${a.name}` } : null;
      }
      if (editOrder) {
        // Edição: grava só o que mudou e descreve as mudanças para a linha do tempo
        const patch = {
          answers: { ...kept, 'sys:gerencia': editOrder.unit },
          execAddressId: exec.manual ? '' : exec.addressId || '',
          execAddressText: String(exec.address || '').trim(),
          execAddressManual: exec.manual ? true : undefined,
          craai: exec.craai,
          comarca: exec.comarca,
          intervencao: answers['sys:intervencao'] || undefined,
          glpi: answers['sys:glpi'] ? String(answers['sys:glpi']) : undefined,
          assetCode: assetCode || undefined,
          assetId: assetInfo?.id,
          assetName: assetInfo?.name,
          deadline: answers['sys:prazo'] || undefined,
          company
        };
        const sysText = (k: string, v: any): string =>
          v === undefined || v === null || v === ''
            ? ''
            : k === 'enderecoExecucao'
              ? [v.address, v.comarca, v.craai].filter(Boolean).join(' · ')
              : k === 'prazo'
                ? String(v).split('-').reverse().join('/')
                : String(v);
        const changes: string[] = [];
        if ((editOrder.company || '') !== company) changes.push(`Empresa: ${companyName(editOrder.company)} → ${companyName(company)}`);
        stageItems(template.fields, template.systemFields, 'criacao').forEach((it) => {
          if (it.kind === 'system') {
            if (['gerencia', 'empresa', 'tecnico', 'numeroOs'].includes(it.sys.key)) return;
            const b = sysText(it.sys.key, editOrder.answers[`sys:${it.sys.key}`]);
            const a = sysText(it.sys.key, kept[`sys:${it.sys.key}`]);
            if (b !== a) changes.push(`${it.sys.label}: ${b || '—'} → ${a || '—'}`);
          } else {
            const b = osAnswerText(it.field, editOrder.answers[it.field.id]);
            const a = osAnswerText(it.field, kept[it.field.id]);
            if (b !== a) changes.push(`${it.field.label}: ${b || '—'} → ${a || '—'}`);
          }
        });
        if (changes.length === 0) {
          setError('Nada foi alterado.');
          return;
        }
        await dbEditWorkOrder(editOrder, patch, changes, userProfile.name);
        onSaved?.();
        return;
      }
      const order = await dbEmitWorkOrder(
        {
          templateId: template.id,
          templateName: template.name,
          templateVersion: template.version,
          templateFields: template.fields,
          templateSystemFields: template.systemFields,
          templateSignatures: template.signatures,
          answers: kept,
          unit,
          execAddressId: exec.manual ? '' : exec.addressId || '',
          execAddressText: String(exec.address || '').trim(),
          execAddressManual: exec.manual ? true : undefined,
          craai: exec.craai,
          comarca: exec.comarca,
          intervencao: answers['sys:intervencao'] || undefined,
          glpi: answers['sys:glpi'] ? String(answers['sys:glpi']) : undefined,
          assetCode: assetCode || undefined,
          assetId: assetInfo?.id,
          assetName: assetInfo?.name,
          deadline: answers['sys:prazo'] || undefined,
          company,
          createdByName: userProfile.name,
          createdByMatricula: userProfile.matricula
        },
        userProfile.name,
        tech ? { matricula: tech.matricula, name: tech.name } : undefined
      );
      setDone(order);
      reset();
      onEmitted?.(order);
    } catch (err: any) {
      setError(
        err?.code === 'permission-denied'
          ? isEdit
            ? 'O banco recusou: seu perfil não pode editar esta OS (ou ela não está mais "Nova").'
            : 'O banco recusou: seu perfil não tem permissão para emitir OS nesta gerência.'
          : `Não foi possível ${isEdit ? 'salvar' : 'emitir'}: ${err?.message || err}`
      );
    } finally {
      setBusy(false);
    }
  };

  // Empresa (campo do sistema "Empresa" do modelo; sempre obrigatório)
  const companySelect = (
    <div>
      <select
        className={input}
        value={company}
        onChange={(e) => { setCompany(e.target.value); setA('sys:tecnico', ''); }}
        disabled={!unit}
        aria-label="Empresa da OS"
      >
        <option value="">{unit ? 'Selecione a empresa...' : 'Escolha a gerência primeiro'}</option>
        {unitCompanies.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      {unit && unitCompanies.length === 0 && <p className="text-[10px] font-bold text-amber-700 mt-1">Nenhuma empresa ativa nesta gerência (Configurações › Empresas).</p>}
    </div>
  );

  const renderField = (f: OsTemplateField) => (
    <OsFieldInput field={f} value={answers[f.id]} onChange={(v) => setA(f.id, v)} addresses={addresses} signerName={userProfile.name} />
  );

  const renderSystem = (s: OsSystemField) => {
    const key = `sys:${s.key}`;
    const v = answers[key];
    switch (s.key) {
      case 'empresa':
        return companySelect;
      case 'gerencia':
        return chooseUnit ? (
          <select className={input} value={v || ''} onChange={(e) => { setAnswers((prev) => ({ ...prev, [key]: e.target.value, 'sys:tecnico': '' })); setCompany(''); }}>
            <option value="">Selecione a gerência...</option>
            {unitOptions.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        ) : (
          <div className="h-9 px-3 flex items-center gap-2 text-xs font-black text-slate-800 border border-slate-200 rounded-lg bg-slate-50">
            <Lock className="w-3.5 h-3.5 text-slate-400" /> {unit || 'Sem gerência no cadastro'}
          </div>
        );
      case 'tecnico':
        if (!assignOn) return null;
        return (
          <div>
            <select className={input} value={v || ''} onChange={(e) => setA(key, e.target.value)} disabled={!unit || !company}>
              <option value="">Deixar em aberto (o Encarregado atribui)</option>
              {unitTechs.length > 0 && (
                <optgroup label={`Técnicos da ${unit}`}>
                  {unitTechs.map((t) => (
                    <option key={t.matricula} value={t.matricula}>{t.name} ({t.matricula})</option>
                  ))}
                </optgroup>
              )}
              {allUnitsTechs.length > 0 && (
                <optgroup label="Técnicos de todas as gerências">
                  {allUnitsTechs.map((t) => (
                    <option key={t.matricula} value={t.matricula}>{t.name} ({t.matricula})</option>
                  ))}
                </optgroup>
              )}
            </select>
            {!unit && <p className="text-[10px] text-slate-500 mt-1">Escolha a gerência para ver os técnicos.</p>}
            {unit && !company && <p className="text-[10px] text-slate-500 mt-1">Escolha a empresa para ver os técnicos.</p>}
            {unit && company && technicians.length === 0 && <p className="text-[10px] text-slate-500 mt-1">Nenhum técnico ativo da empresa na gerência {unit}.</p>}
            {v && <p className="text-[10px] font-bold text-amber-700 mt-1">A OS já nasce "Em andamento" e o homem-hora começa a contar.</p>}
          </div>
        );
      case 'enderecoExecucao':
        return <LocationPicker addresses={addresses} depth="endereco" value={v} onChange={(l) => setA(key, l)} allowManual />;
      case 'intervencao':
        return (
          <select className={input} value={v || ''} onChange={(e) => setA(key, e.target.value)}>
            <option value="">Selecione...</option>
            {(s.options || []).map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        );
      case 'glpi':
        return <input inputMode="numeric" className={input} value={v || ''} onChange={(e) => setA(key, e.target.value.replace(/\D/g, ''))} placeholder="Nº do chamado" />;
      case 'numeroOs':
        return (
          <div className="h-9 px-3 flex items-center justify-between gap-2 text-xs border border-slate-200 rounded-lg bg-slate-50">
            <span className="font-mono font-black text-indigo-700">{nextNumber || '—'}</span>
            <span className="text-[9px] font-bold uppercase text-slate-400">previsto</span>
          </div>
        );
      case 'ativo':
        if (asset && asset !== 'none') {
          return (
            <div className="min-h-9 px-3 py-1.5 flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50">
              <span className="text-[11px] font-bold text-emerald-800 truncate" title={asset.name}>{asset.name}</span>
              <button type="button" onClick={() => { setA(key, ''); setAsset(null); }} className="text-[10px] font-bold text-indigo-700 underline cursor-pointer shrink-0">trocar</button>
            </div>
          );
        }
        return (
          <div className="space-y-1">
            <div className="flex gap-1.5">
              <input
                className={input}
                value={v || ''}
                onChange={(e) => { setA(key, e.target.value); setAsset(null); }}
                onBlur={checkAsset}
                onKeyDown={(e) => e.key === 'Enter' && checkAsset()}
                placeholder="Código ou patrimônio do ativo"
              />
              <button type="button" onClick={checkAsset} disabled={assetBusy || !String(v || '').trim()} className="h-9 px-3 rounded-lg border border-indigo-300 text-indigo-700 text-[11px] font-black cursor-pointer disabled:opacity-40">
                {assetBusy ? '...' : 'Buscar'}
              </button>
            </div>
            {asset === 'none' && (
              <p className="text-[10px] font-bold text-amber-700">
                {s.required ? 'Não encontrado na Gestão de Ativos. Cadastre o ativo antes de emitir.' : 'Não encontrado na Gestão de Ativos: a OS sai sem ativo vinculado (fica só o código digitado).'}
              </p>
            )}
          </div>
        );
      case 'prazo':
        return <input type="date" min={todayStr()} className={input} value={v || ''} onChange={(e) => setA(key, e.target.value)} />;
      default:
        return null;
    }
  };

  if (loading) return <p className="text-xs text-slate-500">Carregando...</p>;

  if (done) {
    return (
      <div className="max-w-xl mx-auto p-5 rounded-2xl border border-emerald-200 bg-emerald-50 space-y-3">
        <p className="flex items-center gap-2 text-sm font-black text-emerald-900">
          <CheckCircle2 className="w-5 h-5" /> OS emitida: {done.number}
        </p>
        <p className="text-xs text-emerald-900">
          Gerência <b>{done.unit}</b> · Situação: <b>{done.status}</b>
          {done.assignedTechnicianName ? ` · técnico ${done.assignedTechnicianName}` : ' · em aberto (o Encarregado atribui)'}
        </p>
        <button type="button" onClick={() => setDone(null)} className="h-9 px-4 rounded-lg bg-[#3525cd] text-white text-xs font-black cursor-pointer">
          Emitir outra OS
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {isEdit ? null : templates.length === 0 ? (
        <p className="text-xs text-slate-500">Nenhum modelo de OS cadastrado. Peça a quem cuida dos modelos (Configurações › Modelos de OS).</p>
      ) : (
        <label className="block">
          <span className={label}>Modelo *</span>
          <select className={input} value={templateId} onChange={(e) => { setTemplateId(e.target.value); reset(); }}>
            <option value="">Selecione o modelo...</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
      )}

      {template && (
        <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-x-3 gap-y-4">
          {/* OS antiga (modelo copiado antes do campo "Empresa" existir): a empresa aparece aqui no começo */}
          {template && !template.systemFields.some((s) => s.key === 'empresa' && s.enabled) && (
            <div className="min-w-0 md:col-span-3">
              <span className={label}>Empresa *</span>
              {companySelect}
            </div>
          )}
          {items.map((it) => {
            if (it.kind === 'system' && it.sys.key === 'tecnico' && !assignOn) return null;
            if (isEdit && it.kind === 'system' && it.sys.key === 'numeroOs') return null;
            const required =
              it.kind === 'field'
                ? it.field.required && it.field.type !== 'toggle'
                : it.sys.key !== 'tecnico' && (it.sys.required || it.sys.key === 'gerencia' || it.sys.key === 'empresa' || it.sys.key === 'enderecoExecucao');
            return (
              <div key={it.kind === 'field' ? it.field.id : it.sys.key} className={`min-w-0 ${SPAN[(it.kind === 'field' ? it.field.width : it.sys.width) || 'full']}`}>
                <span className={label}>
                  {it.kind === 'field' ? it.field.label : it.sys.label}
                  {required ? ' *' : ''}
                </span>
                {it.kind === 'field' ? renderField(it.field) : renderSystem(it.sys)}
              </div>
            );
          })}
          </div>

          {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
          <div className="flex justify-end gap-2">
            {isEdit && (
              <button type="button" onClick={onCancelEdit} disabled={busy} className="h-10 px-5 rounded-lg border border-slate-300 text-slate-700 text-xs font-black uppercase tracking-wide cursor-pointer">
                Cancelar
              </button>
            )}
            <button type="button" onClick={emit} disabled={busy} className="h-10 px-5 rounded-lg bg-[#3525cd] text-white text-xs font-black uppercase tracking-wide cursor-pointer disabled:opacity-50">
              {isEdit ? (busy ? 'Salvando...' : 'Salvar alterações') : busy ? 'Emitindo...' : 'Emitir OS'}
            </button>
          </div>
        </div>
      )}
      {!template && error && <p className="text-xs font-bold text-rose-600">{error}</p>}

    </div>
  );
}
