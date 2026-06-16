// LoginView.tsx - Hexon Operational OS Secure Login Panel
import React, { useState, useEffect } from 'react';
import { dbLoginByMatricula } from '../db/firebase';
import { HexonUser } from '../types';
import { User, Lock, Eye, EyeOff, ArrowRight, Database } from 'lucide-react';

interface LoginViewProps {
  onLoginSuccess: (user: HexonUser) => void;
  darkMode: boolean;
}

export default function LoginView({ onLoginSuccess, darkMode }: LoginViewProps) {
  const [matricula, setMatricula] = useState('');
  const [senha, setSenha] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load remembered matricula on mount
  useEffect(() => {
    const saved = localStorage.getItem('hexon_remembered_matricula');
    if (saved) {
      setMatricula(saved);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matricula.trim() || !senha) {
      setErrorMessage('Por favor, preencha todos os campos.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const user = await dbLoginByMatricula(matricula, senha);
      if (user) {
        if (rememberMe) {
          localStorage.setItem('hexon_remembered_matricula', user.matricula);
        } else {
          localStorage.removeItem('hexon_remembered_matricula');
        }
        onLoginSuccess(user);
      } else {
        setErrorMessage('Matrícula ou senha de acesso incorretas.');
      }
    } catch (err) {
      console.error(err);
      setErrorMessage('Ocorreu um erro ao processar o login. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div 
      className="min-h-screen w-screen flex flex-col justify-center items-center select-none font-sans overflow-y-auto relative bg-[#040813] select-none p-4 md:p-6"
      style={{
        backgroundImage: `
          radial-gradient(circle at center, rgba(16, 24, 76, 0.45) 0%, rgba(4, 8, 19, 0.95) 75%),
          url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='97' viewBox='0 0 56 97'%3E%3Cpath d='M28 0 L56 16.16 L56 48.5 L28 64.66 L0 48.5 L0 16.16 Z M28 97 L56 80.84 L56 48.5 L28 32.34 L0 48.5 L0 80.84 Z' fill='none' stroke='%233b82f6' stroke-width='0.75' stroke-opacity='0.08'/%3E%3C/svg%3E")
        `
      }}
    >
      
      {/* Container holding Logo Header, Card and Footer */}
      <div className="w-full max-w-[450px] flex flex-col items-center justify-center space-y-6">
        
        {/* TOP BRAND LOGO & HEADER */}
        <div className="text-center space-y-2 flex flex-col items-center">
          {/* Hexagon tech logo */}
          <div className="w-16 h-16 relative flex items-center justify-center select-none mb-1">
            {/* Glowing background */}
            <div className="absolute inset-0 bg-indigo-500/10 rounded-full blur-xl animate-pulse" />
            <svg viewBox="0 0 100 100" className="w-full h-full relative z-10 filter drop-shadow-[0_0_8px_rgba(92,109,253,0.4)]">
              {/* Outer Hexagon */}
              <polygon points="50,5 90,28 90,72 50,95 10,72 10,28" className="fill-transparent stroke-[#4f46e5]/80 stroke-2" />
              {/* Dotted Inner Hexagon */}
              <polygon points="50,13 83,32 83,68 50,87 17,68 17,32" className="fill-transparent stroke-[#5c6dfd] stroke-[1.5] stroke-dasharray-[4,3] opacity-60" style={{ strokeDasharray: '4,3' }} />
              {/* Solid Hexagon Panel */}
              <polygon points="50,22 75,36 75,64 50,78 25,64 25,36" className="fill-[#1e1b4b]/50 stroke-[#818cf8] stroke-[1.5]" />
              {/* Hex Core */}
              <polygon points="50,35 63,42 63,58 50,65 37,58 37,42" className="fill-[#5c6dfd]" />
            </svg>
          </div>

          <h1 className="text-[28px] md:text-[34px] font-black text-white tracking-[0.12em] leading-none select-none font-sans uppercase">
            HEXON - PREVENTIVA
          </h1>
          <p className="text-[9px] font-bold text-[#5c6dfd] tracking-[0.28em] uppercase select-none leading-none font-mono mt-1">
            Plataforma de Engenharia & Manutenção
          </p>
        </div>

        {/* CORE LOGIN CARD */}
        <div className="w-full bg-[#0b1329]/75 backdrop-blur-md rounded-2xl p-6 md:p-8 border border-slate-800/60 shadow-2xl relative text-left">
          
          {/* Card Top Section: Corporate Title + Firebase Badge */}
          <div className="flex items-start justify-between gap-3 mb-6">
            <div className="space-y-1">
              <h2 className="text-base font-black text-white tracking-tight leading-none">
                Acesso Corporativo
              </h2>
              <p className="text-[11px] text-slate-400 font-medium leading-normal pr-2">
                Insira sua matrícula e senha homologadas para ingressar no sistema.
              </p>
            </div>
            
            <div className="shrink-0 flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 text-[#10b981] text-[9px] uppercase font-mono font-bold tracking-widest px-2.5 py-1 rounded">
              <Database className="w-3.5 h-3.5 text-emerald-450 shrink-0" />
              <span>Firebase Real</span>
            </div>
          </div>

          {/* Alert Error Message */}
          {errorMessage && (
            <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs rounded-xl flex items-start gap-2.5 shadow-sm animate-shake">
              <span className="material-symbols-outlined shrink-0 text-rose-400 mt-0.5">error</span>
              <span className="leading-normal">{errorMessage}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Field 1: Matricula */}
            <div className="space-y-2">
              <label htmlFor="matricula-input" className="block text-[10px] font-bold uppercase tracking-widest text-white">
                Matrícula do Colaborador
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 flex items-center justify-center">
                  <User className="w-4 h-4 text-slate-450" />
                </span>
                <input
                  id="matricula-input"
                  type="text"
                  placeholder="1-0002"
                  value={matricula}
                  onChange={(e) => setMatricula(e.target.value)}
                  disabled={isLoading}
                  className="w-full pl-10 pr-4 py-3 bg-white focus:bg-slate-50 border border-transparent rounded-xl text-sm font-semibold text-[#0a1122] transition-all outline-none shadow-sm focus:ring-2 focus:ring-indigo-500/50"
                />
              </div>
            </div>

            {/* Field 2: Password */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="senha-input" className="block text-[10px] font-bold uppercase tracking-widest text-white">
                  Senha de Acesso
                </label>
                <button
                  type="button"
                  onClick={() => alert('Para redefinir sua senha, por favor encaminhe um chamado para o suporte de TI ou procure o Administrador.')}
                  className="text-[9px] font-extrabold uppercase tracking-widest text-[#5c6dfd] hover:underline hover:text-indigo-400 transition-colors cursor-pointer"
                >
                  Esqueci a Senha
                </button>
              </div>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 flex items-center justify-center">
                  <Lock className="w-4 h-4 text-slate-450" />
                </span>
                <input
                  id="senha-input"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="•••••••••"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  disabled={isLoading}
                  className="w-full pl-10 pr-10 py-3 bg-white focus:bg-slate-50 border border-transparent rounded-xl text-sm font-bold text-[#0a1122] tracking-wide transition-all outline-none shadow-sm focus:ring-2 focus:ring-indigo-500/50"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 focus:outline-none cursor-pointer flex items-center justify-center"
                  title={showPassword ? 'Ocultar Senha' : 'Mostrar Senha'}
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Remember session checkbox */}
            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  disabled={isLoading}
                  className="rounded border-slate-750 bg-slate-850/60 text-[#5c6dfd] focus:ring-indigo-500/50 cursor-pointer w-4 h-4"
                />
                <span className="text-[11px] font-medium text-slate-400">
                  Manter conectado nesta sessão
                </span>
              </label>
            </div>

            {/* Submit Sign In Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3.5 bg-[#5c6dfd] hover:bg-[#4859eb] active:scale-[0.99] text-white rounded-xl text-xs font-black tracking-widest uppercase shadow-lg shadow-[#5c6dfd]/15 hover:shadow-[#5c6dfd]/25 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 disabled:pointer-events-none mt-2"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Acessando...</span>
                </>
              ) : (
                <>
                  <span>Entrar no Sistema</span>
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>

          </form>

        </div>

        {/* BOTTOM CRYPTOGRAPHIC SECURE FOOTER */}
        <div className="text-[9px] font-mono tracking-[0.22em] text-slate-500 uppercase text-center select-none pt-4 opacity-75">
          © 2026 HEXON MAINTENANCE SUITE • CONEXÃO SEGURA CRIPTOGRAFADA
        </div>

      </div>

    </div>
  );
}
