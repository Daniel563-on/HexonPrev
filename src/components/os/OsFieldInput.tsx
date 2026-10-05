import React, { useEffect, useMemo, useState } from 'react';
import { PenTool } from 'lucide-react';
import { Address, OsLocationAnswer, OsTemplateField } from '../../types';
import { OS_EMAIL_OK } from '../../db/firebase';
import SignatureCanvas from '../SignatureCanvas';

// RESPOSTA DE UMA PERGUNTA DO MODELO DE OS (usado em Emitir OS e na execução pelo técnico)
// Texto, número, data, telefone, e-mail, lista, caixas, liga/desliga, sim/não, assinatura e Local (CRAAI › Comarca › Endereço).

export const osInput = 'w-full h-9 px-3 text-xs border border-slate-200 rounded-lg bg-white';
const input = osInput;

// Telefone: (21) 99999-9999
export const maskPhone = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

const uniq = (list: string[]) => Array.from(new Set(list.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));

// Local: CRAAI › Comarca › Endereço, em cascata, a partir do cadastro de Endereços (só os ativos)
export function LocationPicker({
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


const choice = (selected: boolean) =>
  `h-8 px-4 rounded-lg border text-xs font-bold cursor-pointer ${selected ? 'bg-[#3525cd] text-white border-[#3525cd]' : 'border-slate-200 text-slate-700 bg-white'}`;

interface Props {
  field: OsTemplateField;
  value: any;
  onChange: (v: any) => void;
  addresses: Address[];
  signerName?: string;
}

export default function OsFieldInput({ field: f, value: v, onChange, addresses, signerName }: Props) {
  const [signing, setSigning] = useState(false);
  const body = (() => {
      switch (f.type) {
        case 'textarea':
          return <textarea className={`${input} h-24 py-2`} value={v || ''} onChange={(e) => onChange(e.target.value)} />;
        case 'number':
          return <input type="number" className={input} value={v ?? ''} onChange={(e) => onChange(e.target.value)} />;
        case 'date':
          return <input type="date" className={input} value={v || ''} onChange={(e) => onChange(e.target.value)} />;
        case 'phone':
          return <input inputMode="tel" className={input} value={v || ''} onChange={(e) => onChange(maskPhone(e.target.value))} placeholder="(00) 00000-0000" />;
        case 'email':
          return (
            <div>
              <input type="email" className={input} value={v || ''} onChange={(e) => onChange(e.target.value.trim())} placeholder="nome@dominio.com" />
              {v && !OS_EMAIL_OK(String(v)) && <p className="text-[10px] font-bold text-amber-700 mt-1">E-mail incompleto.</p>}
            </div>
          );
        case 'select':
          return (
            <select className={input} value={v || ''} onChange={(e) => onChange(e.target.value)}>
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
                  <input type="checkbox" checked={list.includes(o)} onChange={(e) => onChange(e.target.checked ? [...list, o] : list.filter((x) => x !== o))} />
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
              onClick={() => onChange(!v)}
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
                <button key={o} type="button" onClick={() => onChange(o)} className={choice(v === o)}>
                  {o}
                </button>
              ))}
            </div>
          );
        case 'signature':
          return v ? (
            <div className="flex items-center gap-3">
              <img src={v} alt="Assinatura" className="h-16 border border-slate-200 rounded-lg bg-white" />
              <button type="button" onClick={() => onChange(undefined)} className="text-[10px] font-bold text-indigo-700 underline cursor-pointer">refazer</button>
            </div>
          ) : (
            <button type="button" onClick={() => setSigning(true)} className="h-9 px-4 rounded-lg border border-indigo-300 text-indigo-700 text-xs font-black flex items-center gap-1.5 cursor-pointer">
              <PenTool className="w-3.5 h-3.5" /> Assinar
            </button>
          );
        case 'location':
          return <LocationPicker addresses={addresses} depth={f.locationDepth || 'endereco'} value={v} onChange={(l) => onChange(l)} />;
        default:
          return <input className={input} value={v || ''} onChange={(e) => onChange(e.target.value)} />;
      }
  })();
  return (
    <>
      {body}
      {signing && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-4">
            <p className="text-sm font-black text-slate-900 mb-2">{f.label}</p>
            <SignatureCanvas
              defaultName={signerName}
              onSave={(img) => {
                onChange(img);
                setSigning(false);
              }}
              onCancel={() => setSigning(false)}
            />
          </div>
        </div>
      )}
    </>
  );
}
