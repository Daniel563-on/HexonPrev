import React, { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { dbGetManagements } from '../../db/firebase';

// U6: opções de uma pergunta "Lista por gerência" (ex.: Categoria) — cada gerência tem a sua lista.
// Na emissão aparece só a lista da gerência da OS; gerência sem lista não emite OS.

export default function UnitListEditor({ value, onChange }: { value: Record<string, string[]>; onChange: (v: Record<string, string[]>) => void }) {
  const [units, setUnits] = useState<string[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    dbGetManagements()
      .then((list) => setUnits(list.map((m) => m.name).filter((n) => n && n !== 'Todas').sort((a, b) => a.localeCompare(b, 'pt-BR'))))
      .catch(() => setUnits([]));
  }, []);

  const add = (unit: string) => {
    const text = (draft[unit] || '').trim();
    if (!text) return;
    const list = value[unit] || [];
    if (!list.some((o) => o.toLowerCase() === text.toLowerCase())) onChange({ ...value, [unit]: [...list, text] });
    setDraft((d) => ({ ...d, [unit]: '' }));
  };
  const remove = (unit: string, opt: string) => onChange({ ...value, [unit]: (value[unit] || []).filter((o) => o !== opt) });

  if (units === null) return <p className="text-[11px] text-slate-500">Carregando as gerências…</p>;
  if (units.length === 0) return <p className="text-[11px] font-bold text-rose-600">Nenhuma gerência cadastrada (Configurações › Gerências).</p>;
  return (
    <div className="space-y-2">
      <span className="block text-[10px] font-black uppercase tracking-wider text-slate-500">Opções de cada gerência</span>
      <p className="text-[10px] text-slate-500">Na emissão aparece só a lista da gerência da OS. Gerência sem lista não consegue emitir OS com este modelo.</p>
      {units.map((u) => {
        const list = value[u] || [];
        return (
          <div key={u} className="p-2 rounded-lg border border-slate-200 bg-white space-y-1.5" aria-label={`Opções da ${u}`}>
            <p className="text-[11px] font-black text-slate-800 flex items-center justify-between gap-2">
              {u}
              <span className={`text-[10px] font-bold ${list.length ? 'text-slate-500' : 'text-rose-600'}`}>{list.length ? `${list.length} opção(ões)` : 'sem lista — não emite'}</span>
            </p>
            {list.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {list.map((o) => (
                  <span key={o} className="px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-[11px] font-bold text-indigo-800 flex items-center gap-1">
                    {o}
                    <button type="button" onClick={() => remove(u, o)} className="text-rose-500 cursor-pointer" title={`Tirar ${o}`} aria-label={`Tirar ${o} da ${u}`}>
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-1.5">
              <input
                value={draft[u] || ''}
                onChange={(e) => setDraft((d) => ({ ...d, [u]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    add(u);
                  }
                }}
                placeholder="Nova opção (ex.: Split)"
                aria-label={`Nova opção da ${u}`}
                className="flex-1 min-w-0 h-8 px-2 text-xs border border-slate-200 rounded-lg bg-white"
              />
              <button type="button" onClick={() => add(u)} className="h-8 px-2.5 rounded-lg border border-indigo-300 text-indigo-700 text-[11px] font-black flex items-center gap-1 cursor-pointer" aria-label={`Incluir opção na ${u}`}>
                <Plus className="w-3.5 h-3.5" /> Incluir
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
