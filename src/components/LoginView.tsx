// LoginView.tsx - Hexon Preventiva Secure Login Panel
import React, { useState, useEffect } from 'react';
import { dbLoginByMatricula } from '../db/firebase';
import { HexonUser } from '../types';
import { User, Lock, Eye, EyeOff, ArrowRight, AlertCircle } from 'lucide-react';

interface LoginViewProps {
  onLoginSuccess: (user: HexonUser) => void;
  darkMode: boolean;
}

export default function LoginView({ onLoginSuccess }: LoginViewProps) {
  const [matricula, setMatricula] = useState('');
  const [senha, setSenha] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load remembered matricula on mount if exists
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
        localStorage.setItem('hexon_remembered_matricula', user.matricula);
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
      className="min-h-screen w-screen flex flex-col justify-center items-center select-none font-sans overflow-y-auto relative bg-[#060913] p-4 sm:p-6"
      style={{
        backgroundImage: `
          radial-gradient(ellipse at 50% 35%, rgba(99, 102, 241, 0.14) 0%, rgba(30, 27, 75, 0.08) 45%, rgba(6, 9, 19, 0.98) 80%),
          url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='104' viewBox='0 0 60 104'%3E%3Cpath d='M30 0 L60 17.32 L60 52 L30 69.32 L0 52 L0 17.32 Z M30 104 L60 86.68 L60 52 L30 34.68 L0 52 L0 86.68 Z' fill='none' stroke='%234338ca' stroke-width='0.75' stroke-opacity='0.16'/%3E%3C/svg%3E")
        `
      }}
    >
      
      {/* Central Content Container */}
      <div className="w-full max-w-[440px] flex flex-col items-center justify-center space-y-7 z-10">
        
        {/* BRANDING: Hexagon Icon + HEXON + Subtitle */}
        <div className="text-center flex flex-col items-center">
          {/* Glowing Hexagon Icon */}
          <div className="relative mb-3 flex items-center justify-center">
            <div className="absolute inset-0 bg-indigo-500/20 blur-xl rounded-full scale-150" />
            <svg 
              viewBox="0 0 100 100" 
              className="w-14 h-14 relative z-10 filter drop-shadow-[0_0_12px_rgba(99,102,241,0.5)]"
            >
              {/* Outer Hexagon */}
              <polygon
                points="50,6 88,28 88,72 50,94 12,72 12,28"
                fill="#0F172A"
                stroke="#6366F1"
                strokeWidth="4"
                strokeLinejoin="round"
              />
              {/* Inner Accent Hexagon */}
              <polygon
                points="50,22 74,36 74,64 50,78 26,64 26,36"
                fill="none"
                stroke="#818CF8"
                strokeWidth="2.5"
                strokeDasharray="4,3"
                strokeLinejoin="round"
              />
              {/* Core Solid Micro Hexagon */}
              <polygon
                points="50,38 60,44 60,56 50,62 40,56 40,44"
                fill="#6366F1"
                fillOpacity="0.85"
              />
            </svg>
          </div>

          {/* Hexon Brand Title */}
          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-[0.25em] font-sans leading-tight">
            HEXON
          </h1>

          {/* Subtitle - Hexon Preventiva */}
          <p className="text-[10px] sm:text-[11px] font-extrabold text-indigo-400 tracking-[0.25em] uppercase font-sans mt-1">
            HEXON PREVENTIVA
          </p>
        </div>

        {/* CORE LOGIN CARD */}
        <div className="w-full bg-[#0B1325]/90 rounded-2xl p-6 sm:p-8 border border-slate-800/80 shadow-[0_20px_50px_rgba(0,0,0,0.6)] backdrop-blur-md relative text-left">
          
          {/* Card Header */}
          <div className="mb-6">
            <h2 className="text-base sm:text-lg font-bold text-white tracking-tight font-sans">
              Acesso Corporativo
            </h2>
            <p className="text-xs text-slate-400 font-normal mt-1 leading-relaxed">
              Insira sua matrícula e senha homologadas para ingressar no sistema.
            </p>
          </div>

          {/* Alert Error Message */}
          {errorMessage && (
            <div className="mb-5 p-3 bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs rounded-xl flex items-start gap-2.5 shadow-sm animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span className="leading-relaxed font-medium">{errorMessage}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            
            {/* Field 1: Matrícula */}
            <div className="space-y-1.5">
              <label 
                htmlFor="matricula-input" 
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-300 font-sans"
              >
                MATRÍCULA DO COLABORADOR
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 flex items-center justify-center pointer-events-none">
                  <User className="w-4 h-4 text-slate-500" />
                </span>
                <input
                  id="matricula-input"
                  type="text"
                  placeholder="1-0002"
                  value={matricula}
                  onChange={(e) => setMatricula(e.target.value)}
                  disabled={isLoading}
                  className="w-full pl-10 pr-4 py-2.5 sm:py-3 bg-[#EEF2F6] hover:bg-white focus:bg-white border border-transparent focus:border-indigo-400 rounded-xl text-sm font-semibold text-slate-900 placeholder:text-slate-400 transition-all outline-none shadow-xs focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
            </div>

            {/* Field 2: Senha */}
            <div className="space-y-1.5">
              <label 
                htmlFor="senha-input" 
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-300 font-sans"
              >
                SENHA DE ACESSO
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 flex items-center justify-center pointer-events-none">
                  <Lock className="w-4 h-4 text-slate-500" />
                </span>
                <input
                  id="senha-input"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  disabled={isLoading}
                  className="w-full pl-10 pr-10 py-2.5 sm:py-3 bg-[#EEF2F6] hover:bg-white focus:bg-white border border-transparent focus:border-indigo-400 rounded-xl text-sm font-semibold text-slate-900 placeholder:text-slate-400 tracking-wide transition-all outline-none shadow-xs focus:ring-2 focus:ring-indigo-500/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 focus:outline-none cursor-pointer flex items-center justify-center transition-colors"
                  title={showPassword ? 'Ocultar Senha' : 'Mostrar Senha'}
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4 text-slate-500" />
                  ) : (
                    <Eye className="w-4 h-4 text-slate-500" />
                  )}
                </button>
              </div>
            </div>

            {/* Submit Sign In Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 sm:py-3.5 bg-[#6366F1] hover:bg-[#5254DE] active:scale-[0.99] text-white rounded-xl text-xs sm:text-sm font-bold tracking-normal shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 disabled:pointer-events-none"
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
            </div>

          </form>

        </div>

        {/* BOTTOM FOOTER */}
        <div className="text-[10px] font-sans tracking-wider text-slate-500/80 uppercase text-center select-none pt-2">
          © 2026 HEXON MAINTENANCE SUITE • SEGURANÇA HOMOLOGADA GOOGLE CLOUD
        </div>

      </div>

    </div>
  );
}

