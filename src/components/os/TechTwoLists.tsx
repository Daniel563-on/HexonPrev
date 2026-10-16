import React from 'react';
import { MapPin } from 'lucide-react';
import { LocalTechOption, localTechGroups, localTechLabel } from '../../lib/localTech';

// DUAS LISTAS DE TÉCNICO (Lote 2): "Técnico da <gerência>" e "ou Técnico local" lado a lado. Escolher numa lista deixa a
// outra vazia (o valor é uma matrícula só). Técnicos locais da comarca da OS aparecem primeiro.
// Sem técnicos locais (ex.: a própria DOM, em que os locais já são os técnicos da gerência), mostra só a 1ª lista.

interface Props {
  unit: string;
  unitTechs: { matricula: string; name: string; perfil?: string; cargo?: string }[]; // perfil "Administrador" = escritório que executa (U3)
  localTechs: LocalTechOption[];
  comarca?: string;
  value: string;
  onChange: (matricula: string) => void;
  unitPlaceholder?: string;
  disabled?: boolean;
  selectClass?: string;
  noneOption?: { label: string; disabled?: boolean }; // U9: "Nenhum técnico (desatribuir)" no Trocar técnico
}

// Valor da opção "Nenhum técnico" (U9)
export const NO_TECH = '__nenhum__';

export default function TechTwoLists({ unit, unitTechs, localTechs, comarca, value, onChange, unitPlaceholder = 'Selecione o técnico...', disabled, selectClass, noneOption }: Props) {
  const isLocal = !!value && localTechs.some((t) => t.matricula === value) && !unitTechs.some((t) => t.matricula === value);
  const cls = selectClass || 'w-full h-9 px-3 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 font-bold';
  const label = 'block text-[11px] font-black text-slate-700 dark:text-slate-200 mb-1';
  const groups = localTechGroups(localTechs, comarca);
  const unitSelect = (
    <select aria-label={`Técnico da ${unit}`} value={isLocal ? '' : value} disabled={disabled} onChange={(ev) => onChange(ev.target.value)} className={`${cls} ${isLocal ? 'text-slate-400' : ''}`}>
      <option value="">{isLocal ? '—' : unitPlaceholder}</option>
      {noneOption && (
        <option value={NO_TECH} disabled={noneOption.disabled}>
          {noneOption.label}
        </option>
      )}
      {unitTechs.map((t) => (
        <option key={t.matricula} value={t.matricula}>
          {t.name} ({t.matricula}){t.perfil === 'Administrador' ? ` · ${t.cargo || 'escritório'} (escritório)` : ''}
        </option>
      ))}
    </select>
  );
  if (localTechs.length === 0) return unitSelect;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
      <label className="block">
        <span className={label}>Técnico da {unit}</span>
        {unitSelect}
        {unitTechs.length === 0 && <span className="block mt-1 text-[10px] text-slate-500">Nenhum técnico ativo da empresa na {unit}.</span>}
      </label>
      <label className="block">
        <span className={`${label} flex items-center gap-1`}>
          <MapPin className="w-3.5 h-3.5 text-emerald-600" />
          ou Técnico local
        </span>
        <select
          aria-label="Técnico local"
          value={isLocal ? value : ''}
          disabled={disabled}
          onChange={(ev) => (ev.target.value || isLocal ? onChange(ev.target.value) : undefined)}
          className={`${cls} ${isLocal ? 'border-emerald-500 ring-2 ring-emerald-100 dark:ring-emerald-900' : ''}`}
        >
          <option value="">{isLocal ? 'Nenhum (tirar o técnico local)' : 'Selecione o técnico local...'}</option>
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.list.map((t) => (
                <option key={t.matricula} value={t.matricula}>
                  {localTechLabel(t)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
    </div>
  );
}
