import React from 'react';
import { useLoginBackground } from '../db/branding';

// FUNDO DA MARCA (login, carregamento e manutenção): a imagem enviada em Configurações › Sistema
// ou, sem imagem, o fundo desenhado (azul-marinho, colmeia de hexágonos e luzes neon ciano/violeta).
// cacheOnly: só usa a cópia do aparelho (não baixa do banco) — para as telas rápidas fora do login.
const HEX_GRID =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='97' viewBox='0 0 56 97'%3E%3Cpath d='M28 0 L56 16.17 L56 48.5 L28 64.67 L0 48.5 L0 16.17 Z M28 97 L56 80.83 L56 48.5 L28 32.33 L0 48.5 L0 80.83 Z' fill='none' stroke='%2367e8f9' stroke-width='0.8' stroke-opacity='0.22'/%3E%3C/svg%3E\")";

export default function BrandBackground({ cacheOnly = false }: { cacheOnly?: boolean }) {
  const image = useLoginBackground(cacheOnly);

  if (image) {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <img src={image} alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
        {/* véu leve para o texto continuar legível sobre qualquer imagem */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_45%,rgba(5,11,31,0.15)_0%,rgba(5,11,31,0.55)_75%)]" />
      </div>
    );
  }

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none bg-[#050b1f]" aria-hidden>
      {/* luzes de fundo */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: [
            'radial-gradient(ellipse 60% 45% at 50% 28%, rgba(37,99,235,0.38) 0%, transparent 70%)',
            'radial-gradient(ellipse 45% 40% at 8% 85%, rgba(139,92,246,0.38) 0%, transparent 70%)',
            'radial-gradient(ellipse 45% 45% at 95% 60%, rgba(34,211,238,0.22) 0%, transparent 70%)',
            'radial-gradient(ellipse 70% 25% at 50% 105%, rgba(168,85,247,0.35) 0%, transparent 70%)',
            'linear-gradient(180deg, #071330 0%, #050b1f 70%)'
          ].join(',')
        }}
      />
      {/* colmeia de hexágonos, mais forte nas laterais */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: HEX_GRID,
          WebkitMaskImage: 'radial-gradient(ellipse 55% 60% at 50% 45%, transparent 35%, black 85%)',
          maskImage: 'radial-gradient(ellipse 55% 60% at 50% 45%, transparent 35%, black 85%)'
        }}
      />
      {/* linhas neon em diagonal */}
      <div className="absolute -left-[10%] top-[18%] w-[45%] h-[2px] rotate-[-38deg] bg-gradient-to-r from-transparent via-cyan-300 to-transparent opacity-70 shadow-[0_0_18px_4px_rgba(34,211,238,0.45)]" />
      <div className="absolute -left-[12%] top-[62%] w-[40%] h-[2px] rotate-[38deg] bg-gradient-to-r from-transparent via-violet-400 to-transparent opacity-70 shadow-[0_0_18px_4px_rgba(139,92,246,0.5)]" />
      <div className="absolute -right-[10%] top-[16%] w-[45%] h-[2px] rotate-[38deg] bg-gradient-to-r from-transparent via-violet-400 to-transparent opacity-70 shadow-[0_0_18px_4px_rgba(139,92,246,0.5)]" />
      <div className="absolute -right-[12%] top-[66%] w-[40%] h-[2px] rotate-[-38deg] bg-gradient-to-r from-transparent via-cyan-300 to-transparent opacity-70 shadow-[0_0_18px_4px_rgba(34,211,238,0.45)]" />
      {/* brilho do "chão" */}
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-violet-600/25 via-blue-600/10 to-transparent" />
    </div>
  );
}
