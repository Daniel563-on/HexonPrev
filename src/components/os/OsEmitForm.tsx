import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Lock, PenTool } from 'lucide-react';
import { Address, HexonUser, OsLocationAnswer, OsSystemField, OsTemplate, OsTemplateField, WorkOrder } from '../../types';
import {
  OS_EMAIL_OK,
  OS_PHONE_OK,
  dbEmitWorkOrder,
  dbGetAddresses,
  dbGetOsTemplates,
  dbGetSingleAssetPublic,
  dbGetUsers,
  osFieldVisible,
  stageItems
} from '../../db/firebase';
import SignatureCanvas from '../SignatureCanvas';

// EMITIR OS (GLPI): a tela mostra exatamente as perguntas da etapa Criação do modelo escolhido
// (perguntas livres + campos do sistema ligados), com as condições ("só quando...") funcionando na hora.
// Gerência: fixa = a de quem abre; Super Administrador e gerência "Todas" escolhem.
// A OS nasce "Nova" (em aberto); quem pode atribuir pode já escolher o técnico e então ela nasce "Em andamento".

interface Props {
  userProfile: HexonUser;
  unitOptions: string[]; // gerências para escolher (só Super Administrador / gerência "Todas")
  canAssign: boolean;
  onEmitted?: (o: WorkOrder) => void;
}

const input = 'w-full h-9 px-3 text-xs border border-slate-200 rounded-lg bg-white';
const label = 'block text-[10px] font-black uppercase tracking-wider mb-1 text-slate-500';
const todayStr = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// (21) 99999-9999
const maskPhone = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

const uniq = (list: string[]) => Array.from(new Set(list.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));

// Local: CRAAI › Comarca › Endereço, em cascata, a partir do cadastro de Endereços (só os ativos)
function LocationPicker({
  addresses,
  depth,
  value,
  onChange
}: {
  addresses: Address[];
  depth: 'comarca' | 'endereco';
  value?: OsLocationAnswer;
  onChange: (v: OsLocationAnswer | undefined) => void;
}) {
  const active = useMemo(() => addresses.filter((a) => a.active !== false), [addresses]);
  const craais = useMemo(() => uniq(active.map((a) => a.craai)), [active]);
  const craai = value?.craai || '';
  const comarca = value?.comarca || '';
  const comarcas = useMemo(() => uniq(active.filter((a) => a.craai === craai).map((a) => a.comarca)), [active, craai]);
  const places = useMemo(() => active.filter((a) => a.craai === craai && a.comarca === comarca), [active, craai, comarca]);

  // Comarca com um só endereço: já vem escolhido
  useEffect(() => {
    if (depth === 'endereco' && craai && comarca && places.length === 1 && value?.addressId !== places[0].id) {
      onChange({ craai, comarca, addressId: places[0].id, address: places[0].address });
    }
  }, [depth, craai, comarca, places]);

  return (
    <div className={`grid grid-cols-1 ${depth === 'endereco' ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-2`}>
      <select className={input} value={craai} onChange={(e) => onChange(e.target.value ? { craai: e.target.value, comarca: '' } : undefined)}>
        <option value="">CRAAI...</option>
        {craais.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      <select className={input} value={comarca} disabled={!craai} onChange={(e) => onChange({ craai, comarca: e.target.value })}>
        <option value="">{craai ? 'Comarca...' : 'Escolha o CRAAI'}</option>
        {comarcas.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      {depth === 'endereco' && (
        <select
          className={input}
          value={value?.addressId || ''}
          disabled={!comarca}
          onChange={(e) => {
            const a = places.find((p) => p.id === e.target.value);
            onChange(a ? { craai, comarca, addressId: a.id, address: a.address } : { craai, comarca });
          }}
        >
          <option value="">{comarca ? (places.length ? 'Endereço...' : 'Nenhum endereço nesta comarca') : 'Escolha a comarca'}</option>
          {places.map((p) => (
            <option key={p.id} value={p.id}>{p.address} ({p.code})</option>
          ))}
        </select>
      )}
    </div>
  );
}

export default function OsEmitForm({ userProfile, unitOptions, canAssign, onEmitted }: Props) {
  const chooseUnit = userProfile.perfil === 'Super Administrador' || userProfile.gerencia === 'Todas';
  const [templates, setTemplates] = useState<OsTemplate[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [users, setUsers] = useState<HexonUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [templateId, setTemplateId] = useState('');
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [asset, setAsset] = useState<{ id: string; name: string } | null | 'none'>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<WorkOrder | null>(null);
  const [signing, setSigning] = useState<OsTemplateField | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([dbGetOsTemplates(true), dbGetAddresses(), canAssign ? dbGetUsers() : Promise.resolve([] as HexonUser[])])
      .then(([t, a, u]) => {
        if (!alive) return;
        setTemplates(t);
        setAddresses(a);
        setUsers(u);
        if (t.length === 1) setTemplateId(t[0].id);
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
  const unit: string = chooseUnit ? answers['sys:gerencia'] || '' : userProfile.gerencia || '';
  // Técnicos da gerência da OS e, em bloco separado, os que atendem todas as gerências (gerência "Todas")
  const activeTechs = users.filter((u) => u.perfil === 'Profissional' && u.status === 'Ativo');
  const unitTechs = unit ? activeTechs.filter((u) => u.gerencia === unit) : [];
  const allUnitsTechs = unit ? activeTechs.filter((u) => u.gerencia === 'Todas') : [];
  const technicians = [...unitTechs, ...allUnitsTechs];
  const assignOn = !!template?.systemFields.find((s) => s.key === 'tecnico' && s.enabled) && canAssign;

  const reset = () => {
    setAnswers({});
    setAsset(null);
  };

  const setA = (key: string, value: any) => setAnswers((prev) => ({ ...prev, [key]: value }));

  const checkAsset = async () => {
    const code = String(answers['sys:ativo'] || '').trim();
    if (!code) return setAsset(null);
    const a = await dbGetSingleAssetPublic(code).catch(() => null);
    setAsset(a && !a.kind ? { id: a.id, name: `${a.code} — ${a.name}` } : 'none');
  };

  const isEmpty = (v: any) =>
    v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0);

  const emit = async () => {
    if (!template) return setError('Escolha o modelo.');
    if (!unit) return setError(chooseUnit ? 'Escolha a gerência responsável.' : 'Seu cadastro está sem gerência: peça ao Super Administrador para corrigir.');
    // Obrigatórios e formatos (só das perguntas visíveis)
    for (const it of items) {
      if (it.kind === 'system') {
        if (it.sys.key === 'gerencia' || it.sys.key === 'tecnico') continue;
        const required = it.sys.required || it.sys.key === 'enderecoExecucao';
        const v = answers[`sys:${it.sys.key}`];
        if (it.sys.key === 'enderecoExecucao') {
          if (!v?.addressId) return setError(`Preencha: ${it.sys.label} (CRAAI, comarca e endereço)`);
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
    setBusy(true);
    setError(null);
    try {
      const assetCode = String(answers['sys:ativo'] || '').trim();
      let assetInfo: { id: string; name: string } | null = asset && asset !== 'none' ? asset : null;
      if (assetCode && asset === null) {
        const a = await dbGetSingleAssetPublic(assetCode).catch(() => null);
        assetInfo = a && !a.kind ? { id: a.id, name: `${a.code} — ${a.name}` } : null;
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
          execAddressId: exec.addressId || '',
          execAddressText: exec.address || '',
          craai: exec.craai,
          comarca: exec.comarca,
          intervencao: answers['sys:intervencao'] || undefined,
          glpi: answers['sys:glpi'] ? String(answers['sys:glpi']) : undefined,
          assetCode: assetCode || undefined,
          assetId: assetInfo?.id,
          assetName: assetInfo?.name,
          deadline: answers['sys:prazo'] || undefined,
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
      setError(err?.code === 'permission-denied' ? 'O banco recusou: seu perfil não tem permissão para emitir OS nesta gerência.' : `Não foi possível emitir: ${err?.message || err}`);
    } finally {
      setBusy(false);
    }
  };

  const choice = (selected: boolean) =>
    `h-8 px-4 rounded-lg border text-xs font-bold cursor-pointer ${selected ? 'bg-[#3525cd] text-white border-[#3525cd]' : 'border-slate-200 text-slate-700 bg-white'}`;

  const renderField = (f: OsTemplateField) => {
    const v = answers[f.id];
    switch (f.type) {
      case 'textarea':
        return <textarea className={`${input} h-24 py-2`} value={v || ''} onChange={(e) => setA(f.id, e.target.value)} />;
      case 'number':
        return <input type="number" className={input} value={v ?? ''} onChange={(e) => setA(f.id, e.target.value)} />;
      case 'date':
        return <input type="date" className={input} value={v || ''} onChange={(e) => setA(f.id, e.target.value)} />;
      case 'phone':
        return <input inputMode="tel" className={input} value={v || ''} onChange={(e) => setA(f.id, maskPhone(e.target.value))} placeholder="(00) 00000-0000" />;
      case 'email':
        return (
          <div>
            <input type="email" className={input} value={v || ''} onChange={(e) => setA(f.id, e.target.value.trim())} placeholder="nome@dominio.com" />
            {v && !OS_EMAIL_OK(String(v)) && <p className="text-[10px] font-bold text-amber-700 mt-1">E-mail incompleto.</p>}
          </div>
        );
      case 'select':
        return (
          <select className={input} value={v || ''} onChange={(e) => setA(f.id, e.target.value)}>
            <option value="">Selecione...</option>
            {(f.options || []).map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        );
      case 'multiselect': {
        const list: string[] = Array.isArray(v) ? v : [];
        return (
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {(f.options || []).map((o) => (
              <label key={o} className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                <input type="checkbox" checked={list.includes(o)} onChange={(e) => setA(f.id, e.target.checked ? [...list, o] : list.filter((x) => x !== o))} />
                {o}
              </label>
            ))}
          </div>
        );
      }
      case 'toggle':
        return (
          <button
            type="button"
            role="switch"
            aria-checked={!!v}
            onClick={() => setA(f.id, !v)}
            className={`relative h-6 w-11 rounded-full transition-colors cursor-pointer ${v ? 'bg-[#3525cd]' : 'bg-slate-300'}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${v ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        );
      case 'yesno':
      case 'checkbox':
        return (
          <div className="flex gap-2">
            {['Sim', 'Não'].map((o) => (
              <button key={o} type="button" onClick={() => setA(f.id, o)} className={choice(v === o)}>
                {o}
              </button>
            ))}
          </div>
        );
      case 'signature':
        return v ? (
          <div className="flex items-center gap-3">
            <img src={v} alt="Assinatura" className="h-16 border border-slate-200 rounded-lg bg-white" />
            <button type="button" onClick={() => setA(f.id, undefined)} className="text-[10px] font-bold text-indigo-700 underline cursor-pointer">refazer</button>
          </div>
        ) : (
          <button type="button" onClick={() => setSigning(f)} className="h-9 px-4 rounded-lg border border-indigo-300 text-indigo-700 text-xs font-black flex items-center gap-1.5 cursor-pointer">
            <PenTool className="w-3.5 h-3.5" /> Assinar
          </button>
        );
      case 'location':
        return <LocationPicker addresses={addresses} depth={f.locationDepth || 'endereco'} value={v} onChange={(l) => setA(f.id, l)} />;
      default:
        return <input className={input} value={v || ''} onChange={(e) => setA(f.id, e.target.value)} />;
    }
  };

  const renderSystem = (s: OsSystemField) => {
    const key = `sys:${s.key}`;
    const v = answers[key];
    switch (s.key) {
      case 'gerencia':
        return chooseUnit ? (
          <select className={input} value={v || ''} onChange={(e) => setAnswers((prev) => ({ ...prev, [key]: e.target.value, 'sys:tecnico': '' }))}>
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
            <select className={input} value={v || ''} onChange={(e) => setA(key, e.target.value)} disabled={!unit}>
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
            {unit && technicians.length === 0 && <p className="text-[10px] text-slate-500 mt-1">Nenhum técnico ativo na gerência {unit}.</p>}
            {v && <p className="text-[10px] font-bold text-amber-700 mt-1">A OS já nasce "Em andamento" e o homem-hora começa a contar.</p>}
          </div>
        );
      case 'enderecoExecucao':
        return <LocationPicker addresses={addresses} depth="endereco" value={v} onChange={(l) => setA(key, l)} />;
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
      case 'ativo':
        return (
          <div className="space-y-1">
            <input className={input} value={v || ''} onChange={(e) => { setA(key, e.target.value); setAsset(null); }} onBlur={checkAsset} placeholder="Cole o código do ativo" />
            {asset === 'none' && <p className="text-[10px] font-bold text-amber-700">Código não encontrado na Gestão de Ativos: fica guardado só o texto.</p>}
            {asset && asset !== 'none' && <p className="text-[10px] font-bold text-emerald-700">Vinculado a {asset.name}</p>}
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
      <div className="max-w-xl p-5 rounded-2xl border border-emerald-200 bg-emerald-50 space-y-3">
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
    <div className="max-w-3xl space-y-4">
      {templates.length === 0 ? (
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
          {items.map((it) => {
            if (it.kind === 'system' && it.sys.key === 'tecnico' && !assignOn) return null;
            const required =
              it.kind === 'field'
                ? it.field.required && it.field.type !== 'toggle'
                : it.sys.key !== 'tecnico' && (it.sys.required || it.sys.key === 'gerencia' || it.sys.key === 'enderecoExecucao');
            return (
              <div key={it.kind === 'field' ? it.field.id : it.sys.key}>
                <span className={label}>
                  {it.kind === 'field' ? it.field.label : it.sys.label}
                  {required ? ' *' : ''}
                </span>
                {it.kind === 'field' ? renderField(it.field) : renderSystem(it.sys)}
              </div>
            );
          })}

          {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
          <div className="flex justify-end">
            <button type="button" onClick={emit} disabled={busy} className="h-10 px-5 rounded-lg bg-[#3525cd] text-white text-xs font-black uppercase tracking-wide cursor-pointer disabled:opacity-50">
              {busy ? 'Emitindo...' : 'Emitir OS'}
            </button>
          </div>
        </div>
      )}
      {!template && error && <p className="text-xs font-bold text-rose-600">{error}</p>}

      {signing && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-4">
            <p className="text-sm font-black text-slate-900 mb-2">{signing.label}</p>
            <SignatureCanvas
              defaultName={userProfile.name}
              onSave={(img) => {
                setA(signing.id, img);
                setSigning(null);
              }}
              onCancel={() => setSigning(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
