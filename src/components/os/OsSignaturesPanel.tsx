import React, { useEffect, useState } from 'react';
import { Copy, Link2, Lock, Mail, PenTool, Star } from 'lucide-react';
import { HexonUser, OsSignatureRole, WorkOrder } from '../../types';
import {
  OS_SIGN_COLOR,
  OS_SIGN_LABEL,
  dbCreateOsValidation,
  dbGetOsSignatureImage,
  dbGetOsValidation,
  dbSignAsRole,
  osSignOrder,
  osValidationLink
} from '../../db/firebase';
import OsSignaturePad, { Stroke, renderOsSignature } from './OsSignaturePad';

// ASSINATURAS NA FICHA DA OS: cartões na ordem (Técnico → Cliente → Engenheiro → Gerente), cada um com a sua cor.
// Cadeado até chegar a vez. Engenheiro/Gerente assinam aqui (perfil "Assinar OS como"); o Super Administrador assina qualquer um.
// Bloco do cliente: gerar link de validação, enviar por e-mail, copiar e ver a resposta.

interface Props {
  order: WorkOrder;
  userProfile: HexonUser;
  mySignRole: 'engenheiro' | 'gerente' | 'all' | null;
  canManageClient: boolean;
  onChanged: () => void;
}

const fmtDT = (iso?: string) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');

export default function OsSignaturesPanel({ order: o, userProfile, mySignRole, canManageClient, onChanged }: Props) {
  const [images, setImages] = useState<Partial<Record<OsSignatureRole, string>>>({});
  const [signing, setSigning] = useState<'engenheiro' | 'gerente' | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [days, setDays] = useState(7);
  const [validation, setValidation] = useState<{ status: string; until?: string } | null>(null);
  const order = osSignOrder(o);

  useEffect(() => {
    order.forEach((r) => {
      if (o.signatures?.[r] && o.signatures[r]!.via !== 'link') dbGetOsSignatureImage(o.id, r).then((img) => img && setImages((p) => ({ ...p, [r]: img })));
    });
    if (o.validationToken) {
      dbGetOsValidation(o.validationToken).then((v) => {
        if (!v) return;
        const ms = v.expiresAt?.toMillis ? v.expiresAt.toMillis() : 0;
        setValidation({ status: v.status, until: ms ? new Date(ms).toISOString() : undefined });
      });
    }
  }, [o.id, o.updatedAt]);

  const canSign = (r: OsSignatureRole) =>
    o.status === 'Aguardando assinaturas' && o.nextSigner === r && (r === 'engenheiro' || r === 'gerente') && (mySignRole === 'all' || mySignRole === r);

  const onSigned = async (strokes: Stroke[]) => {
    const role = signing!;
    setSigning(null);
    setBusy(true);
    setMsg(null);
    try {
      const meta = { name: userProfile.name, matricula: userProfile.matricula, cargo: userProfile.cargo || OS_SIGN_LABEL[role], via: 'sistema' as const };
      const at = new Date().toISOString();
      await dbSignAsRole([o], role, meta, { [o.id]: renderOsSignature(strokes, { role, ...meta, at }) }, userProfile.name);
      onChanged();
    } catch (err: any) {
      setMsg(err?.code === 'permission-denied' ? 'O banco recusou: seu perfil não assina esta OS.' : `Não foi possível assinar: ${err?.message || err}`);
    } finally {
      setBusy(false);
    }
  };

  const makeLink = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await dbCreateOsValidation(o, days, userProfile.name);
      onChanged();
    } catch (err: any) {
      setMsg(`Não foi possível gerar o link: ${err?.message || err}`);
    } finally {
      setBusy(false);
    }
  };
  const link = o.validationToken ? osValidationLink(o.validationToken) : '';
  const mailto = link
    ? `mailto:?subject=${encodeURIComponent(`Validação do atendimento — ${o.number}`)}&body=${encodeURIComponent(
        `Olá,\n\nPor favor, confira o atendimento da ${o.number}${o.glpi ? ` (GLPI ${o.glpi})` : ''} e valide ou conteste pelo link:\n${link}\n\nObrigado.`
      )}`
    : '';

  const reached = (r: OsSignatureRole) => !!o.signatures?.[r];

  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {order.map((r, i) => {
          const meta = o.signatures?.[r];
          const color = OS_SIGN_COLOR[r];
          const prev = order[i - 1];
          return (
            <div key={r} className="rounded-xl bg-white border border-slate-200 overflow-hidden flex flex-col" style={{ borderTop: `4px solid ${color}` }}>
              <div className="px-3 py-2 flex items-center justify-between">
                <p className="text-[11px] font-black uppercase tracking-wider" style={{ color }}>{i + 1}. {OS_SIGN_LABEL[r]}</p>
                {meta && <span className="text-[9px] font-black text-emerald-700">ASSINADO</span>}
              </div>
              <div className="px-3 pb-3 flex-1 space-y-1.5 text-[11px] text-slate-700">
                {meta ? (
                  <>
                    {images[r] && <img src={images[r]} alt={`Assinatura ${OS_SIGN_LABEL[r]}`} className="w-full rounded-lg border border-slate-100" />}
                    <p className="font-bold">{meta.name}</p>
                    <p className="text-slate-500">
                      {meta.matricula ? `Mat. ${meta.matricula}` : ''}
                      {meta.cargo ? ` · ${meta.cargo}` : ''}
                    </p>
                    {meta.rating ? (
                      <p className="flex">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <Star key={n} className={`w-3.5 h-3.5 ${n <= meta.rating! ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
                        ))}
                      </p>
                    ) : null}
                    <p className="text-slate-500">{fmtDT(meta.at)} · {meta.via === 'link' ? 'validado pelo link' : meta.via === 'celular' ? 'no celular' : 'no sistema'}</p>
                  </>
                ) : canSign(r) ? (
                  <button type="button" onClick={() => setSigning(r as 'engenheiro' | 'gerente')} disabled={busy} className="w-full h-10 rounded-lg text-white text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50" style={{ background: color }}>
                    <PenTool className="w-4 h-4" /> Assinar
                  </button>
                ) : (
                  <p className="text-slate-400 flex items-start gap-1.5">
                    <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    {o.status === 'Cancelada'
                      ? 'OS cancelada.'
                      : prev && !reached(prev)
                        ? `Aguardando a assinatura do ${OS_SIGN_LABEL[prev].toLowerCase()}.`
                        : r === 'tecnico'
                          ? 'O técnico assina ao concluir a OS.'
                          : r === 'cliente'
                            ? 'O cliente assina no celular do técnico ou pelo link.'
                            : `Só quem tem "Assinar OS como ${OS_SIGN_LABEL[r]}" no perfil.`}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {o.status === 'Aguardando assinaturas' && o.nextSigner === 'cliente' && canManageClient && (
        <div className="p-3 rounded-xl bg-white border border-emerald-200 space-y-2">
          <p className="text-[10px] font-black uppercase tracking-wider text-emerald-700">Validação do cliente por link</p>
          {link ? (
            <>
              <p className="text-[11px] text-slate-600 break-all">{link}</p>
              <p className="text-[11px] text-slate-500">
                {validation?.status === 'pendente' ? `Aguardando resposta do cliente${validation.until ? ` (vale até ${fmtDT(validation.until)})` : ''}.` : validation ? `Respondido: ${validation.status}. Atualize a ficha.` : ''}
              </p>
              <div className="flex flex-wrap gap-2">
                <a href={mailto} className="h-9 px-3 rounded-lg border border-emerald-300 text-emerald-800 text-xs font-black flex items-center gap-1.5">
                  <Mail className="w-4 h-4" /> Enviar por e-mail
                </a>
                <button type="button" onClick={() => navigator.clipboard?.writeText(link).then(() => setMsg('Link copiado.'))} className="h-9 px-3 rounded-lg border border-emerald-300 text-emerald-800 text-xs font-black flex items-center gap-1.5 cursor-pointer">
                  <Copy className="w-4 h-4" /> Copiar link
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-2">
              <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-9 px-2 text-xs border border-emerald-300 rounded-lg bg-white" aria-label="Validade do link">
                {[3, 7, 15, 30, 60].map((d) => (
                  <option key={d} value={d}>Vale {d} dias</option>
                ))}
              </select>
              <button type="button" onClick={makeLink} disabled={busy} className="h-9 px-3 rounded-lg border border-emerald-300 text-emerald-800 text-xs font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
                <Link2 className="w-4 h-4" /> Gerar link para o cliente
              </button>
            </div>
          )}
        </div>
      )}
      {msg && <p className="text-xs font-bold text-slate-700">{msg}</p>}

      {signing && (
        <OsSignaturePad
          role={signing}
          signer={{ name: userProfile.name, matricula: userProfile.matricula, cargo: userProfile.cargo || OS_SIGN_LABEL[signing] }}
          title={`Assinar ${o.number} — ${OS_SIGN_LABEL[signing]}`}
          onConfirm={onSigned}
          onCancel={() => setSigning(null)}
        />
      )}
    </div>
  );
}
