import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Search } from 'lucide-react';
import { Address, HexonUser, OsSystemField, OsTemplate, OsTemplateField, WorkOrder } from '../../types';
import {
  dbEmitWorkOrder,
  dbGetAddresses,
  dbGetOsTemplates,
  dbGetSingleAssetPublic,
  dbGetUsers,
  stageItems
} from '../../db/firebase';

// EMITIR OS (GLPI): a tela mostra exatamente as perguntas da etapa Criação do modelo escolhido
// (perguntas livres + campos do sistema ligados). A OS nasce "Nova" (em aberto); quem também pode atribuir
// pode já escolher o técnico (casos especiais) e então ela nasce "Em andamento".

interface Props {
  userProfile: HexonUser;
  userProfileId?: string;
  unitOptions: string[]; // gerências que o usuário pode escolher
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

function AddressPicker({ addresses, value, onChange }: { addresses: Address[]; value: string; onChange: (id: string) => void }) {
  const [q, setQ] = useState('');
  const selected = addresses.find((a) => a.id === value);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    const base = addresses.filter((a) => a.active !== false);
    if (!t) return base.slice(0, 30);
    return base.filter((a) => `${a.code} ${a.craai} ${a.comarca} ${a.address}`.toLowerCase().includes(t)).slice(0, 30);
  }, [addresses, q]);
  if (selected) {
    return (
      <div className="flex items-start justify-between gap-2 p-2.5 rounded-lg border border-emerald-200 bg-emerald-50">
        <div className="text-xs min-w-0">
          <p className="font-black text-slate-800">{selected.address}</p>
          <p className="text-[10px] text-slate-600">{selected.code} · CRAAI {selected.craai} · {selected.comarca}</p>
        </div>
        <button type="button" onClick={() => onChange('')} className="text-[10px] font-bold text-indigo-700 underline cursor-pointer shrink-0">trocar</button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input className={`${input} pl-8`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar endereço, comarca, CRAAI ou código..." />
      </div>
      <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100 bg-white">
        {list.length === 0 && <p className="p-2 text-[11px] text-slate-400">Nenhum endereço encontrado.</p>}
        {list.map((a) => (
          <button key={a.id} type="button" onClick={() => onChange(a.id)} className="w-full text-left p-2 hover:bg-indigo-50 cursor-pointer">
            <p className="text-[11px] font-bold text-slate-800">{a.address}</p>
            <p className="text-[10px] text-slate-500">{a.code} · CRAAI {a.craai} · {a.comarca}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function OsEmitForm({ userProfile, userProfileId, unitOptions, canAssign, onEmitted }: Props) {
  const isSuper = userProfile.perfil === 'Super Administrador';
  const [templates, setTemplates] = useState<OsTemplate[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [users, setUsers] = useState<HexonUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [templateId, setTemplateId] = useState('');
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [asset, setAsset] = useState<{ id: string; name: string } | null | 'none'>(null);
  const [assignNow, setAssignNow] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<WorkOrder | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([dbGetOsTemplates(true), dbGetAddresses(), canAssign ? dbGetUsers() : Promise.resolve([] as HexonUser[])])
      .then(([t, a, u]) => {
        if (!alive) return;
        const allowed = t.filter((m) => isSuper || m.allowedProfileIds.length === 0 || (userProfileId && m.allowedProfileIds.includes(userProfileId)));
        setTemplates(allowed);
        setAddresses(a);
        setUsers(u);
        if (allowed.length === 1) setTemplateId(allowed[0].id);
      })
      .catch((err) => alive && setError(`Não foi possível carregar: ${err?.message || err}`))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const template = templates.find((t) => t.id === templateId);
  const items = template ? stageItems(template.fields, template.systemFields, 'criacao') : [];
  const unit: string = answers['sys:gerencia'] || '';
  const technicians = users.filter((u) => u.perfil === 'Profissional' && u.status === 'Ativo' && (!unit || u.gerencia === unit || u.gerencia === 'Todas'));

  const reset = () => {
    setAnswers({});
    setAsset(null);
    setAssignNow('');
  };

  const setA = (key: string, value: any) => setAnswers((prev) => ({ ...prev, [key]: value }));

  const checkAsset = async () => {
    const code = String(answers['sys:ativo'] || '').trim();
    if (!code) return setAsset(null);
    const a = await dbGetSingleAssetPublic(code).catch(() => null);
    setAsset(a && !a.kind ? { id: a.id, name: `${a.code} — ${a.name}` } : 'none');
  };

  const emit = async () => {
    if (!template) return setError('Escolha o modelo.');
    // Obrigatórios
    for (const it of items) {
      const key = it.kind === 'field' ? it.field.id : `sys:${it.sys.key}`;
      const required = it.kind === 'field' ? it.field.required : it.sys.required || ['gerencia', 'enderecoExecucao'].includes(it.sys.key);
      const v = answers[key];
      const empty = v === undefined || v === null || (typeof v === 'string' && !v.trim());
      if (required && empty && !(it.kind === 'field' && it.field.type === 'checkbox')) {
        return setError(`Preencha: ${it.kind === 'field' ? it.field.label : it.sys.label}`);
      }
    }
    const exec = addresses.find((a) => a.id === answers['sys:enderecoExecucao']);
    const req = addresses.find((a) => a.id === answers['sys:enderecoRequerente']);
    if (!exec) return setError('Escolha o endereço de execução.');
    if (!unit) return setError('Escolha a gerência responsável.');
    const tech = technicians.find((t) => t.matricula === assignNow);
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
          answers,
          unit,
          execAddressId: exec.id,
          execAddressText: exec.address,
          craai: exec.craai,
          comarca: exec.comarca,
          reqAddressId: req?.id,
          reqAddressText: req?.address,
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

  const renderField = (f: OsTemplateField) => {
    const v = answers[f.id];
    if (f.type === 'textarea') return <textarea className={`${input} h-24 py-2`} value={v || ''} onChange={(e) => setA(f.id, e.target.value)} />;
    if (f.type === 'number') return <input type="number" className={input} value={v ?? ''} onChange={(e) => setA(f.id, e.target.value)} />;
    if (f.type === 'date') return <input type="date" className={input} value={v || ''} onChange={(e) => setA(f.id, e.target.value)} />;
    if (f.type === 'select')
      return (
        <select className={input} value={v || ''} onChange={(e) => setA(f.id, e.target.value)}>
          <option value="">Selecione...</option>
          {(f.options || []).map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      );
    if (f.type === 'checkbox')
      return (
        <div className="flex gap-2">
          {['Sim', 'Não'].map((o) => (
            <button key={o} type="button" onClick={() => setA(f.id, o)} className={`h-8 px-4 rounded-lg border text-xs font-bold cursor-pointer ${v === o ? 'bg-[#3525cd] text-white border-[#3525cd]' : 'border-slate-200 text-slate-700'}`}>
              {o}
            </button>
          ))}
        </div>
      );
    return <input className={input} value={v || ''} onChange={(e) => setA(f.id, e.target.value)} />;
  };

  const renderSystem = (s: OsSystemField) => {
    const key = `sys:${s.key}`;
    const v = answers[key];
    switch (s.key) {
      case 'gerencia':
        return (
          <select className={input} value={v || ''} onChange={(e) => { setA(key, e.target.value); setAssignNow(''); }}>
            <option value="">Selecione a gerência...</option>
            {unitOptions.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        );
      case 'enderecoExecucao':
      case 'enderecoRequerente':
        return <AddressPicker addresses={addresses} value={v || ''} onChange={(id) => setA(key, id)} />;
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
          Situação: <b>{done.status}</b>
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
        <p className="text-xs text-slate-500">Nenhum modelo de OS disponível para o seu perfil.</p>
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
            const required = it.kind === 'field' ? it.field.required : it.sys.required || ['gerencia', 'enderecoExecucao'].includes(it.sys.key);
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

          {canAssign && (
            <div className="pt-3 border-t border-slate-100">
              <span className={label}>Atribuir agora (casos especiais)</span>
              <select className={input} value={assignNow} onChange={(e) => setAssignNow(e.target.value)} disabled={!unit}>
                <option value="">Deixar em aberto (o Encarregado atribui)</option>
                {technicians.map((t) => (
                  <option key={t.matricula} value={t.matricula}>{t.name} ({t.matricula})</option>
                ))}
              </select>
              {!unit && <p className="text-[10px] text-slate-500 mt-1">Escolha a gerência para ver os técnicos.</p>}
              {assignNow && <p className="text-[10px] font-bold text-amber-700 mt-1">A OS já nasce "Em andamento" e o homem-hora começa a contar.</p>}
            </div>
          )}

          {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
          <div className="flex justify-end">
            <button type="button" onClick={emit} disabled={busy} className="h-10 px-5 rounded-lg bg-[#3525cd] text-white text-xs font-black uppercase tracking-wide cursor-pointer disabled:opacity-50">
              {busy ? 'Emitindo...' : 'Emitir OS'}
            </button>
          </div>
        </div>
      )}
      {!template && error && <p className="text-xs font-bold text-rose-600">{error}</p>}
    </div>
  );
}
