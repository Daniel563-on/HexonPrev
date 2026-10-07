import React, { useEffect, useState } from 'react';
import { AlertTriangle, Calendar, CheckCircle2, FileCheck2, Lock, MapPin, Star, Users, XCircle } from 'lucide-react';
import { OsValidation } from '../types';
import { dbAnswerOsValidation, dbGetOsValidation } from '../db/firebase';
import BrandLogo from './BrandLogo';
import BrandBackground from './BrandBackground';

// PÁGINA DO LINK DE VALIDAÇÃO (sem login): o cliente confere o atendimento e APROVA (nome, matrícula, estrelas)
// ou CONTESTA (motivo). Uma resposta só e dentro do prazo do link (o banco garante). Sem valores.

const card = 'rounded-2xl border border-slate-800 bg-[#0e1a3a]/80 p-4';
const input = 'w-full h-11 px-3 rounded-xl bg-[#08122b] border border-slate-700 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-cyan-400';

export default function PublicOsValidationView({ token }: { token: string }) {
  const [v, setV] = useState<OsValidation | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'aprovar' | 'contestar'>('aprovar');
  const [name, setName] = useState('');
  const [matricula, setMatricula] = useState('');
  const [rating, setRating] = useState(0);
  const [agree, setAgree] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState<'aprovada' | 'contestada' | null>(null);

  useEffect(() => {
    dbGetOsValidation(token)
      .then(setV)
      .catch(() => setV(null))
      .finally(() => setLoading(false));
  }, [token]);

  const expiresMs = v?.expiresAt?.toMillis ? v.expiresAt.toMillis() : v?.expiresAt?.seconds ? v.expiresAt.seconds * 1000 : 0;
  const expired = !!v && expiresMs > 0 && Date.now() > expiresMs;

  const send = async () => {
    if (!name.trim() || !matricula.trim()) return setMsg('Preencha o nome completo e a matrícula.');
    if (mode === 'aprovar') {
      if (!rating) return setMsg('Escolha de 1 a 5 estrelas.');
      if (!agree) return setMsg('Marque a declaração de que verificou o serviço.');
    } else if (reason.trim().length < 5) return setMsg('Explique o motivo da contestação.');
    setBusy(true);
    setMsg(null);
    try {
      await dbAnswerOsValidation(token, mode === 'aprovar', { name, matricula, rating, reason });
      setDone(mode === 'aprovar' ? 'aprovada' : 'contestada');
    } catch {
      setMsg('Não foi possível registrar. O link pode ter expirado ou já ter sido respondido.');
    } finally {
      setBusy(false);
    }
  };

  const shell = (body: React.ReactNode) => (
    <div className="min-h-screen relative overflow-hidden bg-[#050b1f] text-slate-100 font-sans flex justify-center p-3 sm:p-6">
      <BrandBackground cacheOnly />
      <div className="relative z-10 w-full max-w-xl rounded-3xl border border-cyan-300/30 bg-[#0c1b44]/70 backdrop-blur-xl shadow-[0_0_40px_rgba(34,211,238,0.15)] overflow-hidden flex flex-col">
        <header className="relative px-5 py-4 border-b border-slate-800 flex items-center gap-3">
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-violet-500/0 via-cyan-400/70 to-violet-500/0 pointer-events-none" />
          <BrandLogo
            className="w-14 h-14 shrink-0"
            fallback={<div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-violet-600 to-cyan-400 flex items-center justify-center font-black text-white">H</div>}
          />
          <div>
            <p className="text-xl font-extrabold tracking-[0.15em] font-brand text-white leading-none">HEXON</p>
            <p className="text-[11px] text-cyan-200/80">Validação de Ordem de Serviço</p>
          </div>
        </header>
        <main className="p-4 sm:p-5 space-y-4 flex-1">{body}</main>
        <footer className="px-5 py-3 border-t border-slate-800 text-[10px] text-slate-500">HEXON Gestão Operacional • Validação de Serviços</footer>
      </div>
    </div>
  );

  if (loading) return shell(<p className="text-sm text-slate-400">Carregando...</p>);
  if (!v) return shell(<p className="text-sm text-slate-300 flex gap-2"><AlertTriangle className="w-4 h-4 text-amber-400" /> Link inválido. Confira se copiou o endereço completo.</p>);
  if (done || v.status !== 'pendente') {
    const st = done || v.status;
    return shell(
      <div className={`${card} text-center space-y-2`}>
        {st === 'aprovada' ? <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-400" /> : <XCircle className="w-10 h-10 mx-auto text-rose-400" />}
        <p className="text-base font-black">{st === 'aprovada' ? 'Atendimento validado' : 'Contestação registrada'}</p>
        <p className="text-xs text-slate-400">
          {done ? 'Obrigado! A equipe técnica já pode ver a sua resposta.' : 'Este link já foi respondido.'} OS {v.number}.
        </p>
      </div>
    );
  }
  if (expired) return shell(<p className="text-sm text-slate-300 flex gap-2"><Lock className="w-4 h-4 text-amber-400" /> Este link expirou. Peça um novo à equipe técnica.</p>);

  const execDate = new Date(v.executedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  return shell(
    <>
      <div className={`${card} flex gap-2 text-xs text-slate-300`}>
        <FileCheck2 className="w-4 h-4 text-cyan-300 shrink-0" />
        Por favor, confira os dados do atendimento técnico abaixo e confirme a conclusão do serviço — ou conteste, se algo não estiver certo.
      </div>
      <div>
        {v.intervencao && <span className="px-2 py-0.5 rounded-md bg-slate-800 text-[10px] font-black uppercase text-slate-300">{v.intervencao}</span>}
        <p className="text-xl font-black mt-2">{v.glpi ? `GLPI: #${v.glpi}` : v.number}</p>
        <p className="text-[11px] text-slate-500">{v.number}</p>
      </div>
      <div className={`${card} space-y-3`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex gap-2">
            <MapPin className="w-4 h-4 text-cyan-300 shrink-0 mt-0.5" />
            <div>
              <p className="text-[10px] font-black uppercase text-slate-500">Local de execução</p>
              <p className="text-sm font-bold">{v.local}</p>
              <p className="text-[11px] text-slate-400">{v.comarca}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Calendar className="w-4 h-4 text-cyan-300 shrink-0 mt-0.5" />
            <div>
              <p className="text-[10px] font-black uppercase text-slate-500">Data de execução</p>
              <p className="text-sm font-bold">{execDate}</p>
            </div>
          </div>
        </div>
        <div className="flex gap-2 pt-3 border-t border-slate-800">
          <Users className="w-4 h-4 text-cyan-300 shrink-0 mt-0.5" />
          <div>
            <p className="text-[10px] font-black uppercase text-slate-500">Equipe técnica</p>
            <p className="text-xs font-bold uppercase">{(v.team.length ? v.team : [v.technician]).join(', ')}</p>
          </div>
        </div>
        {v.summary && (
          <div className="pt-3 border-t border-slate-800">
            <p className="text-[10px] font-black uppercase text-slate-500 mb-1">Resumo dos serviços realizados</p>
            <p className="text-sm whitespace-pre-wrap rounded-xl bg-[#08122b] border border-slate-800 p-3">{v.summary}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#08122b] border border-slate-800">
        {(['aprovar', 'contestar'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => { setMode(m); setMsg(null); }}
            className={`h-10 rounded-lg text-xs font-black cursor-pointer ${mode === m ? (m === 'aprovar' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white') : 'text-slate-400'}`}
          >
            {m === 'aprovar' ? 'Aprovar atendimento' : 'Contestar atendimento'}
          </button>
        ))}
      </div>

      <div className={`${card} space-y-3`}>
        <p className="text-sm font-black">Identificação do solicitante / recebedor</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-[11px] font-bold text-slate-400 mb-1">Nome completo *</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Carlos Eduardo Silveira" className={input} />
          </label>
          <label className="block">
            <span className="block text-[11px] font-bold text-slate-400 mb-1">Matrícula *</span>
            <input value={matricula} onChange={(e) => setMatricula(e.target.value)} placeholder="Ex: 84920-1" className={input} />
          </label>
        </div>
        {mode === 'aprovar' ? (
          <>
            <div className="pt-2 border-t border-slate-800">
              <p className="text-xs font-bold flex items-center gap-1.5"><Star className="w-4 h-4 text-amber-400 fill-amber-400" /> Pesquisa de satisfação com o serviço executado *</p>
              <div className="flex gap-1 mt-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" onClick={() => setRating(n)} className="p-1 cursor-pointer" aria-label={`${n} estrela(s)`}>
                    <Star className={`w-8 h-8 ${n <= rating ? 'fill-amber-400 text-amber-400' : 'text-slate-600'}`} />
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-start gap-2 text-xs font-bold text-slate-300 pt-2 border-t border-slate-800">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5" />
              Declaro que verifiquei o serviço executado e concordo com o recebimento do atendimento.
            </label>
          </>
        ) : (
          <label className="block">
            <span className="block text-[11px] font-bold text-slate-400 mb-1">Motivo da contestação *</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} placeholder="Explique o que não ficou certo no serviço." className={`${input} h-auto py-2`} />
          </label>
        )}
      </div>

      {msg && <p className="text-xs font-bold text-rose-400">{msg}</p>}
      <button
        type="button"
        onClick={send}
        disabled={busy}
        className={`w-full h-12 rounded-xl text-sm font-black flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 ${mode === 'aprovar' ? 'bg-emerald-500 hover:bg-emerald-600 text-slate-950' : 'bg-rose-600 hover:bg-rose-700 text-white'}`}
      >
        {mode === 'aprovar' ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
        {busy ? 'Enviando...' : mode === 'aprovar' ? 'Aprovar e validar atendimento' : 'Enviar contestação'}
      </button>
      <p className="text-[10px] text-slate-500 text-center flex items-center justify-center gap-1"><Lock className="w-3 h-3" /> Este link só pode ser respondido uma vez.</p>
    </>
  );
}
