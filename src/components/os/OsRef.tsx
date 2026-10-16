import React from 'react';

// U4: a GLPI em destaque e o Nº da OS pequeno ao lado (tabelas, cartões, fichas)
export default function OsRef({ o, size = 'md', className = '' }: { o: { glpi?: string; number: string }; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const big = size === 'lg' ? 'text-xl' : size === 'sm' ? 'text-sm' : 'text-base';
  return (
    <span className={`inline-flex items-baseline gap-1.5 flex-wrap ${className}`}>
      <span className={`font-mono ${big} font-black text-indigo-700 dark:text-indigo-300 whitespace-nowrap`}>GLPI {o.glpi || '—'}</span>
      <span className="font-mono text-[10px] font-bold text-slate-400 whitespace-nowrap">{o.number}</span>
    </span>
  );
}
