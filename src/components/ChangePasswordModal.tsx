import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Lock, Eye, EyeOff, CheckCircle2, AlertCircle, X, ShieldCheck } from 'lucide-react';
import { HexonUser } from '../types';
import {
  matriculaToAuthEmail,
  changeOwnFirebasePassword
} from '../db/firebase';

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  userProfile: HexonUser | null;
  onSuccess?: (updatedUser: HexonUser) => void;
}

export default function ChangePasswordModal({
  isOpen,
  onClose,
  userProfile,
  onSuccess
}: ChangePasswordModalProps) {
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');

  const [showSenhaAtual, setShowSenhaAtual] = useState(false);
  const [showNovaSenha, setShowNovaSenha] = useState(false);
  const [showConfirmarSenha, setShowConfirmarSenha] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  if (!isOpen) return null;

  const handleClose = () => {
    if (isLoading) return;
    setSenhaAtual('');
    setNovaSenha('');
    setConfirmarSenha('');
    setErrorMessage(null);
    setIsSuccess(false);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile) return;

    setErrorMessage(null);

    // Validation
    if (!senhaAtual) {
      setErrorMessage('Por favor, informe a senha atual.');
      return;
    }

    if (!novaSenha) {
      setErrorMessage('Por favor, informe a nova senha.');
      return;
    }

    if (novaSenha.length < 6) {
      setErrorMessage('A nova senha deve possuir no mínimo 6 caracteres.');
      return;
    }

    if (senhaAtual === novaSenha) {
      setErrorMessage('A nova senha deve ser diferente da senha atual.');
      return;
    }

    if (novaSenha !== confirmarSenha) {
      setErrorMessage('A confirmação da nova senha não confere.');
      return;
    }

    setIsLoading(true);

    try {
      const r = await changeOwnFirebasePassword(matriculaToAuthEmail(userProfile.matricula), senhaAtual, novaSenha);
      if (r !== 'ok') {
        setErrorMessage(
          r === 'wrong-password' ? 'A senha atual está incorreta.'
          : r === 'weak-password' ? 'A nova senha é fraca demais (mínimo 6 caracteres).'
          : 'Não foi possível alterar a senha. Saia, entre novamente e tente de novo.'
        );
        setIsLoading(false);
        return;
      }
      const { senha: _omit, ...safeUser } = userProfile;

      // Update remembered or session data if present
      try {
        const storedAuth = localStorage.getItem('hexon_auth_user');
        if (storedAuth) {
          const parsed = JSON.parse(storedAuth);
          if (parsed.id === safeUser.id || parsed.matricula === safeUser.matricula) {
            localStorage.setItem('hexon_auth_user', JSON.stringify(safeUser));
          }
        }
      } catch (lsErr) {
        console.warn('Could not update stored session in localStorage', lsErr);
      }

      setIsSuccess(true);
      if (onSuccess) {
        onSuccess(safeUser);
      }

      setTimeout(() => {
        handleClose();
      }, 1600);
    } catch (err: any) {
      console.error('Erro ao atualizar senha:', err);
      setErrorMessage('Falha ao salvar a nova senha. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  const modalContent = (
    <div 
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
      className="fixed inset-0 z-[99999] overflow-y-auto bg-slate-950/70 backdrop-blur-md font-sans p-4 sm:p-6 flex items-center justify-center min-h-screen"
    >
      <div 
        className="relative my-auto bg-white dark:bg-[#0A101D] border border-slate-200 dark:border-slate-800/80 rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 text-left z-10"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-change-password-title"
      >
        {/* Header */}
        <div className="shrink-0 px-5 py-4 border-b border-slate-150 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <h2 id="modal-change-password-title" className="text-base font-extrabold text-slate-900 dark:text-white tracking-tight">
                Alterar Senha
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                Atualize suas credenciais de acesso
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={isLoading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* User Info Badge */}
        {userProfile && (
          <div className="shrink-0 px-5 py-2 bg-slate-50 dark:bg-slate-900/40 border-b border-slate-150 dark:border-slate-800/80 flex items-center justify-between text-[11px]">
            <span className="text-slate-600 dark:text-slate-400 font-semibold truncate">
              Usuário: <strong className="text-slate-900 dark:text-white">{userProfile.name}</strong>
            </span>
            <span className="text-slate-500 dark:text-slate-400 font-mono font-bold bg-white dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 shrink-0">
              Mat: {userProfile.matricula}
            </span>
          </div>
        )}

        {/* Body Form */}
        <form onSubmit={handleSubmit} className="overflow-y-auto p-5 space-y-3.5">
          {errorMessage && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-xl text-xs text-rose-700 dark:text-rose-400 flex items-start gap-2 animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="font-medium leading-relaxed">{errorMessage}</span>
            </div>
          )}

          {isSuccess && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 rounded-xl text-xs text-emerald-700 dark:text-emerald-400 flex items-start gap-2 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="font-bold leading-relaxed">Senha atualizada com sucesso!</span>
            </div>
          )}

          {/* Current Password Field */}
          <div className="space-y-1">
            <label className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Senha Atual
            </label>
            <div className="relative">
              <input
                type={showSenhaAtual ? 'text' : 'password'}
                value={senhaAtual}
                onChange={(e) => setSenhaAtual(e.target.value)}
                placeholder="Digite sua senha atual"
                disabled={isLoading || isSuccess}
                className="w-full px-3.5 py-2 pr-10 rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowSenhaAtual(!showSenhaAtual)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer"
                tabIndex={-1}
              >
                {showSenhaAtual ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* New Password Field */}
          <div className="space-y-1">
            <label className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Nova Senha
            </label>
            <div className="relative">
              <input
                type={showNovaSenha ? 'text' : 'password'}
                value={novaSenha}
                onChange={(e) => setNovaSenha(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                disabled={isLoading || isSuccess}
                className="w-full px-3.5 py-2 pr-10 rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowNovaSenha(!showNovaSenha)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer"
                tabIndex={-1}
              >
                {showNovaSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Confirm Password Field */}
          <div className="space-y-1">
            <label className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Confirmar Nova Senha
            </label>
            <div className="relative">
              <input
                type={showConfirmarSenha ? 'text' : 'password'}
                value={confirmarSenha}
                onChange={(e) => setConfirmarSenha(e.target.value)}
                placeholder="Repita a nova senha"
                disabled={isLoading || isSuccess}
                className="w-full px-3.5 py-2 pr-10 rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowConfirmarSenha(!showConfirmarSenha)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer"
                tabIndex={-1}
              >
                {showConfirmarSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="pt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
            <span>A senha deve possuir pelo menos 6 dígitos.</span>
          </div>

          {/* Action Buttons */}
          <div className="shrink-0 flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={isLoading}
              className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isLoading || isSuccess}
              className="flex-1 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs tracking-wide transition-all shadow-xs disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer active:scale-98"
            >
              {isLoading ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Salvando...</span>
                </>
              ) : (
                <span>Salvar Senha</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(modalContent, document.body)
    : modalContent;
}
