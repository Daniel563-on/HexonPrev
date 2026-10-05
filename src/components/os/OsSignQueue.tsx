import React, { useEffect, useState } from 'react';
import { PenTool, RefreshCw } from 'lucide-react';
import { HexonUser, WorkOrder } from '../../types';
import { OS_SIGN_COLOR, OS_SIGN_LABEL, dbGetSignQueue, dbSignAsRole } from '../../db/firebase';
import OsSignaturePad, { Stroke, renderOsSignature } from './OsSignaturePad';
import { dayBR } from './OsAnswersView';

// "PRECISAM DA MINHA ASSINATURA": OS esperando o engenheiro ou o gerente nas gerências do usuário.
// Marca uma ou várias, desenha a assinatura uma vez e ela vale para todas (cada OS com o carimbo e a hora dela).

interface Props {
  userProfile: HexonUser;
  units: string[];
  mySignRole: 'engenheiro' | 'gerente' | 'all';
  onOpen: (o: WorkOrder) => void;
}

export default function OsSignQueue({ userProfile, units, mySignRole, onOpen }: Props) {
  const [role, setRole] = useState<'engenheiro' | 'gerente'>(mySignRole === 'gerente' ? 'gerente' : 'engenheiro');
  const [list, setList] = useState<WorkOrder[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [signing, setSigning] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => {
    setLoading(true);
    setSel(new Set());
    dbGetSignQueue(units, role, userProfile.name)
      .then(setList)
      .catch((e) => setMsg({ ok: false, text: `Não foi possível carregar: ${e?.message || e}` }))
      .finally(() => setLoading(false));
  };
  useEffect(load, [role, units.join('|')]);

  const toggle = (id: string) =>
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const onSigned = async (strokes: Stroke[]) => {
    setSigning(false);
    const chosen = list.filter((o) => sel.has(o.id));
    const meta = { name: userProfile.name, matricula: userProfile.matricula, cargo: userProfile.cargo || OS_SIGN_LABEL[role], via: 'sistema' as const };
    const images: Record<string, string> = {};
    chosen.forEach((o) => (images[o.id] = renderOsSignature(strokes, { role, ...meta, at: new Date().toISOString() })));
    setLoading(true);
    try {
      const n = await dbSignAsRole(chosen, role, meta, images, userProfile.name);
      setMsg({ ok: true, text: `${n} OS assinada(s).` });
      load();
    } catch (err: any) {
      setMsg({ ok: false, text: err?.code === 'permission-denied' ? 'O banco recusou: seu perfil não assina estas OS.' : `Não foi possível assinar: ${err?.message || err}` });
      setLoading(false);
    }
  };

  const color = OS_SIGN_COLOR[role];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {mySignRole === 'all' && (
            <select value={role} onChange={(e) => setRole(e.target.value as 'engenheiro' | 'gerente')} className="h-8 px-2 text-xs font-bold border border-slate-200 rounded-lg bg-white cursor-pointer" aria-label="Assinar como">
              <option value="engenheiro">Como engenheiro</option>
              <option value="gerente">Como gerente</option>
            </select>
          )}
          <span className="text-[11px] text-slate-500">{list.length} OS aguardando a assinatura do {OS_SIGN_LABEL[role].toLowerCase()}</span>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={load} disabled={loading} className="h-8 px-3 rounded-lg border border-slate-200 text-[11px] font-bold flex items-center gap-1 cursor-pointer disabled:opacity-40 bg-white">
            <RefreshCw className="w-3.5 h-3.5" /> Atualizar
          </button>
          <button type="button" onClick={() => setSigning(true)} disabled={sel.size === 0 || loading} className="h-8 px-3 rounded-lg text-white text-[11px] font-black flex items-center gap-1 cursor-pointer disabled:opacity-40" style={{ background: color }}>
            <PenTool className="w-3.5 h-3.5" /> Assinar selecionadas ({sel.size})
          </button>
        </div>
      </div>
      {msg && <p className={`text-xs font-bold ${msg.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{msg.text}</p>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-xs min-w-[720px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <th className="p-2.5 w-8">
                <input
                  type="checkbox"
                  aria-label="Marcar todas"
                  checked={list.length > 0 && sel.size === list.length}
                  onChange={(e) => setSel(e.target.checked ? new Set(list.map((o) => o.id)) : new Set())}
                />
              </th>
              <th className="p-2.5">Número</th>
              <th className="p-2.5">Tipo</th>
              <th className="p-2.5">Gerência</th>
              <th className="p-2.5">Local</th>
              <th className="p-2.5">Técnico</th>
              <th className="p-2.5">Concluída pelo técnico</th>
            </tr>
          </thead>
          <tbody>
            {list.map((o) => (
              <tr key={o.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="p-2.5">
                  <input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} aria-label={`Marcar ${o.number}`} />
                </td>
                <td className="p-2.5 font-mono font-bold text-indigo-700 cursor-pointer underline" onClick={() => onOpen(o)}>{o.number}</td>
                <td className="p-2.5">{o.intervencao || '—'}</td>
                <td className="p-2.5">{o.unit}</td>
                <td className="p-2.5">{o.execAddressText}</td>
                <td className="p-2.5">{o.assignedTechnicianName || '—'}</td>
                <td className="p-2.5">{dayBR(o.techSignedAt)}</td>
              </tr>
            ))}
            {!loading && list.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-slate-400">Nenhuma OS esperando a sua assinatura.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {signing && (
        <OsSignaturePad
          role={role}
          signer={{ name: userProfile.name, matricula: userProfile.matricula, cargo: userProfile.cargo || OS_SIGN_LABEL[role] }}
          title={`Assinar ${sel.size} OS como ${OS_SIGN_LABEL[role].toLowerCase()}`}
          onConfirm={onSigned}
          onCancel={() => setSigning(false)}
        />
      )}
    </div>
  );
}
