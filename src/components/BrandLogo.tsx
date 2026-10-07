import React from 'react';
import { useBranding } from '../db/branding';

// LOGO DO SISTEMA: mostra o logo enviado em Configurações › Sistema; sem logo cadastrado, mostra o desenho antigo (fallback).
// Também mantém o ícone da aba do navegador atualizado.
export default function BrandLogo({ className = '', fallback }: { className?: string; fallback: React.ReactNode }) {
  const { logo } = useBranding();
  if (!logo) return <>{fallback}</>;
  return <img src={logo} alt="Hexon" className={`object-contain select-none ${className}`} draggable={false} />;
}
