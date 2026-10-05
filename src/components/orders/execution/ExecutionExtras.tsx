import React, { useEffect, useMemo, useState } from 'react';
import { Material, OrderParticipant, UsedMaterial } from '../../../types';
import { dbGetMaterials, dbGetUnitPeople } from '../../../db/firebase';

// MATERIAIS USADOS E PARTICIPANTES (Etapa 6.2)
// - Materiais: só os da gerência com valor cadastrado (R$ 0,00 não pode ser usado); o técnico não vê valor.
//   Uma linha por material (repetido: ajusta a quantidade na mesma linha); quantidade com casas decimais.
// - Participantes: pessoas ativas da mesma gerência; quem executa entra sempre.
// Tudo fica no rascunho do aparelho e vai para o banco junto com a conclusão.

interface Props {
  unit: string;
  editable: boolean;
  executor: OrderParticipant | null;
  materials: UsedMaterial[];
  participants: OrderParticipant[];
  onChange: (next: { materialsUsed?: UsedMaterial[]; participants?: OrderParticipant[] }) => void;
  hideParticipants?: boolean; // OS (Hexon 2.0): a equipe tem um bloco próprio
}

const fmtQty = (n: number) => (Number.isFinite(n) ? String(n).replace('.', ',') : '');

export default function ExecutionExtras({ unit, editable, executor, materials, participants, onChange, hideParticipants }: Props) {
  const [catalog, setCatalog] = useState<Material[]>([]);
  const [people, setPeople] = useState<OrderParticipant[]>([]);
  const [matSearch, setMatSearch] = useState('');
  const [personSearch, setPersonSearch] = useState('');
  const [qtyText, setQtyText] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!editable || !unit) return;
    dbGetMaterials([unit]).then((list) => setCatalog(list.filter((m) => m.unit === unit && m.cost > 0)));
    dbGetUnitPeople(unit).then(setPeople);
  }, [editable, unit]);

  // Texto da quantidade (mantém "2," enquanto digita)
  useEffect(() => {
    setQtyText((prev) => {
      const next: Record<string, string> = {};
      materials.forEach((m) => (next[m.id] = prev[m.id] ?? fmtQty(m.qty)));
      return next;
    });
  }, [materials]);

  const matResults = useMemo(() => {
    const q = matSearch.trim().toLowerCase();
    if (!q) return [];
    return catalog.filter((m) => `${m.code} ${m.description}`.toLowerCase().includes(q)).slice(0, 8);
  }, [catalog, matSearch]);

  const personResults = useMemo(() => {
    const q = personSearch.trim().toLowerCase();
    if (!q) return [];
    const taken = new Set([executor?.matricula, ...participants.map((p) => p.matricula)]);
    return people.filter((p) => !taken.has(p.matricula) && `${p.name} ${p.matricula}`.toLowerCase().includes(q)).slice(0, 8);
  }, [people, personSearch, participants, executor]);

  const addMaterial = (m: Material) => {
    setMatSearch('');
    if (materials.some((x) => x.id === m.id)) {
      setMsg(`"${m.description}" já está na lista: ajuste a quantidade na linha dele.`);
      return;
    }
    setMsg(null);
    onChange({ materialsUsed: [...materials, { id: m.id, code: m.code, description: m.description, measureUnit: m.measureUnit, qty: 0 }] });
  };

  const setQty = (id: string, text: string) => {
    setQtyText((prev) => ({ ...prev, [id]: text }));
    const n = Number(text.trim().replace(',', '.'));
    onChange({ materialsUsed: materials.map((m) => (m.id === id ? { ...m, qty: Number.isFinite(n) ? n : 0 } : m)) });
  };

  const field = 'h-9 px-3 text-xs border border-slate-200 rounded-lg bg-white font-semibold w-full';
  const label = 'text-[10px] font-black text-gray-400 uppercase tracking-widest';

  return (
    <div className="space-y-5">
      {/* MATERIAIS */}
      <div className="space-y-2">
        <p className={label}>Materiais utilizados</p>
        {materials.length === 0 && <p className="text-[11px] text-slate-400">Nenhum material informado.</p>}
        {materials.map((m) => (
          <div key={m.id} className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 bg-white text-xs">
            <div className="min-w-0 flex-1">
              <p className="font-bold text-slate-800 truncate">{m.description}</p>
              <p className="text-[10px] text-slate-500">{m.code}</p>
            </div>
            {editable ? (
              <>
                <input
                  inputMode="decimal"
                  value={qtyText[m.id] ?? fmtQty(m.qty)}
                  onChange={(e) => setQty(m.id, e.target.value.replace(/[^0-9,.]/g, ''))}
                  placeholder="Qtd."
                  className="h-8 w-20 px-2 text-xs border border-slate-200 rounded-lg text-right font-bold"
                />
                <span className="text-[10px] font-bold text-slate-500 w-8">{m.measureUnit}</span>
                <button type="button" onClick={() => onChange({ materialsUsed: materials.filter((x) => x.id !== m.id) })} className="h-8 px-2 rounded-lg border border-rose-200 text-rose-600 text-[10px] font-bold cursor-pointer">Tirar</button>
              </>
            ) : (
              <span className="font-bold text-slate-700">{fmtQty(m.qty)} {m.measureUnit}</span>
            )}
          </div>
        ))}
        {editable && (
          <div className="relative">
            <input value={matSearch} onChange={(e) => setMatSearch(e.target.value)} placeholder="Adicionar material: buscar por código ou descrição..." className={field} />
            {matResults.length > 0 && (
              <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                {matResults.map((m) => (
                  <button key={m.id} type="button" onClick={() => addMaterial(m)} className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 cursor-pointer">
                    <span className="font-bold text-slate-800">{m.description}</span>
                    <span className="text-slate-500"> • {m.code} • {m.measureUnit}</span>
                  </button>
                ))}
              </div>
            )}
            {matSearch.trim() && matResults.length === 0 && <p className="text-[11px] font-bold text-rose-600 mt-1">Nenhum material encontrado na {unit} com "{matSearch.trim()}".</p>}
          </div>
        )}
        {msg && <p className="text-[11px] font-bold text-amber-700">{msg}</p>}
      </div>

      {/* PARTICIPANTES */}
      {!hideParticipants && (
      <div className="space-y-2">
        <p className={label}>Participantes</p>
        <div className="flex flex-wrap gap-1.5">
          {executor && (
            <span className="px-2.5 py-1 rounded-full bg-indigo-50 border border-indigo-200 text-[11px] font-bold text-indigo-800">
              {executor.name} (executor)
            </span>
          )}
          {participants.filter((p) => p.matricula !== executor?.matricula).map((p) => (
            <span key={p.matricula} className="px-2.5 py-1 rounded-full bg-slate-50 border border-slate-200 text-[11px] font-bold text-slate-700 flex items-center gap-1">
              {p.name}
              {editable && (
                <button type="button" onClick={() => onChange({ participants: participants.filter((x) => x.matricula !== p.matricula) })} className="text-rose-500 cursor-pointer" title="Tirar">×</button>
              )}
            </span>
          ))}
        </div>
        {editable && (
          <div className="relative">
            <input value={personSearch} onChange={(e) => setPersonSearch(e.target.value)} placeholder="Adicionar participante da gerência: nome ou matrícula..." className={field} />
            {personResults.length > 0 && (
              <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                {personResults.map((p) => (
                  <button key={p.matricula} type="button" onClick={() => { setPersonSearch(''); onChange({ participants: [...participants, p] }); }} className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 cursor-pointer">
                    <span className="font-bold text-slate-800">{p.name}</span>
                    <span className="text-slate-500"> • {p.matricula}{p.cargo ? ` • ${p.cargo}` : ''}</span>
                  </button>
                ))}
              </div>
            )}
            {personSearch.trim() && personResults.length === 0 && (
              <p className="text-[11px] font-bold text-rose-600 mt-1">Nenhuma pessoa encontrada na {unit} com "{personSearch.trim()}".</p>
            )}
            <p className="text-[10px] text-slate-400 mt-1">Só entra quem for escolhido na lista (pessoas ativas da {unit}).</p>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
