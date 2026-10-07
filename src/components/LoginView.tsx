// LoginView.tsx - tela de login do Hexon
import React, { useState, useEffect } from 'react';
import { dbLoginByMatricula } from '../db/firebase';
import { HexonUser } from '../types';
import { User, Lock, Eye, EyeOff, ArrowRight, AlertCircle, Cloud } from 'lucide-react';
import BrandLogo from './BrandLogo';
import BrandBackground from './BrandBackground';
import { brandTagline, brandTopText, useBranding } from '../db/branding';

interface LoginViewProps {
  onLoginSuccess: (user: HexonUser) => Promise<void> | void;
  darkMode: boolean;
}

export default function LoginView({ onLoginSuccess }: LoginViewProps) {
  const [matricula, setMatricula] = useState('');
  const [senha, setSenha] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isCapsLockOn, setIsCapsLockOn] = useState(false);
  const [rememberMatricula, setRememberMatricula] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load remembered matricula on mount if exists
  useEffect(() => {
    const saved = localStorage.getItem('hexon_remembered_matricula');
    if (saved) {
      setMatricula(saved);
      setRememberMatricula(true);
    } else {
      const optedOut = localStorage.getItem('hexon_remember_matricula_optout');
      if (optedOut === 'true') {
        setRememberMatricula(false);
      }
    }
  }, []);

  const handlePasswordKeyEvents = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (typeof e.getModifierState === 'function') {
      setIsCapsLockOn(e.getModifierState('CapsLock'));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sanitizedMatricula = matricula.trim();

    if (!sanitizedMatricula || !senha) {
      setErrorMessage('Por favor, preencha todos os campos.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const user = await dbLoginByMatricula(sanitizedMatricula, senha);
      if (user) {
        if (rememberMatricula) {
          localStorage.setItem('hexon_remembered_matricula', user.matricula);
          localStorage.removeItem('hexon_remember_matricula_optout');
        } else {
          localStorage.removeItem('hexon_remembered_matricula');
          localStorage.setItem('hexon_remember_matricula_optout', 'true');
        }
        await onLoginSuccess(user);
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

  const branding = useBranding();
  const tagline = brandTagline(branding);
  const topText = brandTopText(branding);
  const inputCls =
    'w-full pl-11 py-3 sm:py-3.5 bg-[#0a1638]/70 border rounded-xl text-sm font-semibold text-white placeholder:text-slate-500 transition-all outline-none focus:bg-[#0c1a42]/80';

  return (
    <div className="min-h-screen w-screen relative flex flex-col justify-center items-center select-none font-sans overflow-x-hidden overflow-y-auto bg-[#050b1f] px-4 py-8 sm:p-6">
      <BrandBackground />

      {/* Texto do canto (só no computador) */}
      {topText && (
        <div className="hidden md:block absolute top-6 right-8 z-10 text-sm font-medium tracking-[0.2em] text-slate-100/90 whitespace-pre-line text-right">
          {topText}
        </div>
      )}

      <div className="w-full max-w-[460px] flex flex-col items-center justify-center z-10">
        {/* MARCA: logo + HEXON + frase */}
        <div className="text-center flex flex-col items-center mb-7 sm:mb-8">
          <div className="relative mb-3 flex items-center justify-center">
            <div className="absolute inset-0 bg-gradient-to-tr from-violet-600/40 to-cyan-400/40 blur-2xl rounded-full scale-125" />
            <BrandLogo
              className="w-32 h-32 md:w-40 md:h-40 relative z-10 drop-shadow-[0_0_22px_rgba(34,211,238,0.55)]"
              fallback={
                <svg viewBox="0 0 100 100" className="w-28 h-28 md:w-32 md:h-32 relative z-10 drop-shadow-[0_0_16px_rgba(34,211,238,0.55)]">
                  <defs>
                    <linearGradient id="hexLoginGrad" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#8B5CF6" />
                      <stop offset="100%" stopColor="#22D3EE" />
                    </linearGradient>
                  </defs>
                  <polygon points="50,6 88,28 88,72 50,94 12,72 12,28" fill="#0B1A3F" stroke="url(#hexLoginGrad)" strokeWidth="5" strokeLinejoin="round" />
                  <polygon points="50,38 60,44 60,56 50,62 40,56 40,44" fill="url(#hexLoginGrad)" />
                </svg>
              }
            />
          </div>

          <h1 className="text-6xl md:text-7xl font-extrabold tracking-[0.22em] pl-[0.22em] font-brand leading-tight bg-gradient-to-b from-white via-slate-100 to-indigo-200 bg-clip-text text-transparent drop-shadow-[0_0_18px_rgba(139,92,246,0.45)]">
            HEXON
          </h1>

          {tagline && (
            <div className="mt-3 flex items-center gap-2 sm:gap-4 w-full justify-center">
              <span className="h-px w-6 sm:w-16 bg-gradient-to-r from-transparent to-violet-400/80 shrink-0" />
              <p className="text-[10px] sm:text-xs italic font-semibold uppercase tracking-[0.16em] sm:tracking-[0.28em] text-slate-100/90 whitespace-pre-line leading-relaxed">
                {tagline}
              </p>
              <span className="h-px w-6 sm:w-16 bg-gradient-to-l from-transparent to-violet-400/80 shrink-0" />
            </div>
          )}
        </div>

        {/* CARTÃO DE ACESSO (vidro com borda neon) */}
        <div className="w-full rounded-[22px] p-6 sm:p-8 bg-[#0c1b44]/55 backdrop-blur-xl border border-cyan-300/40 shadow-[0_0_0_1px_rgba(139,92,246,0.25),0_0_40px_rgba(34,211,238,0.22),inset_0_0_30px_rgba(59,130,246,0.12)] text-left">
          <div className="mb-6">
            <h2 className="flex items-center gap-3 text-lg sm:text-xl font-bold text-white tracking-tight">
              <span className="w-1 h-6 rounded-full bg-gradient-to-b from-violet-400 to-fuchsia-500 -skew-x-12 shadow-[0_0_10px_rgba(168,85,247,0.7)]" />
              Acesso Corporativo
            </h2>
            <p className="text-xs sm:text-sm text-slate-300/90 mt-1.5 leading-relaxed pl-4">
              Insira sua matrícula e senha homologadas para ingressar no sistema.
            </p>
          </div>

          {errorMessage && (
            <div className="mb-5 p-3 bg-rose-500/15 border border-rose-400/40 text-rose-200 text-xs rounded-xl flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-300 shrink-0 mt-0.5" />
              <span className="leading-relaxed font-medium">{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Matrícula */}
            <div className="space-y-2">
              <label htmlFor="matricula-input" className="flex items-center gap-2 text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-200/90">
                <User className="w-3.5 h-3.5 text-slate-300" />
                Matrícula do colaborador
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center pointer-events-none">
                  <User className="w-4 h-4 text-cyan-200/80" />
                </span>
                <input
                  id="matricula-input"
                  type="text"
                  placeholder="1-0002"
                  value={matricula}
                  onChange={(e) => setMatricula(e.target.value)}
                  onBlur={() => setMatricula(prev => prev.trim())}
                  disabled={isLoading}
                  className={`${inputCls} pr-4 border-cyan-400/60 focus:border-cyan-300 focus:shadow-[0_0_0_3px_rgba(34,211,238,0.15),0_0_18px_rgba(34,211,238,0.35)]`}
                />
              </div>
            </div>

            {/* Senha */}
            <div className="space-y-2">
              <label htmlFor="senha-input" className="flex items-center gap-2 text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-200/90">
                <Lock className="w-3.5 h-3.5 text-slate-300" />
                Senha de acesso
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center pointer-events-none">
                  <Lock className="w-4 h-4 text-violet-200/80" />
                </span>
                <input
                  id="senha-input"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  onKeyDown={handlePasswordKeyEvents}
                  onKeyUp={handlePasswordKeyEvents}
                  onBlur={() => setIsCapsLockOn(false)}
                  disabled={isLoading}
                  className={`${inputCls} pr-11 tracking-wide border-violet-400/60 focus:border-violet-300 focus:shadow-[0_0_0_3px_rgba(139,92,246,0.18),0_0_18px_rgba(139,92,246,0.4)]`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-slate-300 hover:text-white focus:outline-none cursor-pointer flex items-center justify-center transition-colors"
                  title={showPassword ? 'Ocultar Senha' : 'Mostrar Senha'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {isCapsLockOn && (
                <div className="flex items-center gap-1.5 text-[11px] text-amber-300 font-medium pt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-pulse shrink-0" />
                  <span>Atenção: <strong>Caps Lock</strong> ativado</span>
                </div>
              )}
            </div>

            {/* Lembrar matrícula */}
            <label className="flex items-center gap-2.5 cursor-pointer select-none group pt-0.5">
              <input
                type="checkbox"
                checked={rememberMatricula}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setRememberMatricula(checked);
                  if (!checked) {
                    localStorage.removeItem('hexon_remembered_matricula');
                    localStorage.setItem('hexon_remember_matricula_optout', 'true');
                  }
                }}
                className="w-4 h-4 rounded cursor-pointer accent-violet-500"
              />
              <span className="text-xs sm:text-sm text-slate-200 group-hover:text-white transition-colors">
                Lembrar matrícula neste dispositivo
              </span>
            </label>

            {/* Entrar */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3.5 sm:py-4 rounded-xl text-sm sm:text-base font-bold text-white bg-gradient-to-r from-violet-600 via-blue-500 to-violet-600 border border-cyan-300/50 shadow-[0_0_24px_rgba(99,102,241,0.55)] hover:brightness-110 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 disabled:pointer-events-none"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Entrando...</span>
                </>
              ) : (
                <>
                  <span>Entrar no Sistema</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </div>

        {/* RODAPÉ */}
        <div className="mt-8 flex flex-col items-center gap-2 text-[10px] tracking-[0.2em] text-slate-300/70 uppercase text-center">
          <Cloud className="w-5 h-5 text-slate-300/80" />
          <span>© 2026 Hexon Maintenance Suite</span>
          <span>Segurança homologada Google Cloud</span>
        </div>
      </div>
    </div>
  );
}
