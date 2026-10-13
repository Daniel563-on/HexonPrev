import React, { useMemo, useState } from 'react';
import { FileText, ImagePlus, Paperclip, Trash2, X } from 'lucide-react';
import { Company, HexonUser, Notice, NoticeAudience, NoticeKind } from '../../types';
import { NOTICE_ALL_UNITS, NOTICE_FILE_MAX, NOTICE_FOREVER, NoticeFile, dbSaveNotice } from '../../db/notices';
import { NOTICE_KINDS } from './NoticeCard';

// QUADRO DE AVISOS: publicar ou editar um aviso. A foto é reduzida no aparelho (lado maior até 1600 px, JPEG)
// para caber num documento do banco (até ~900 KB). Fase 7D: também um PDF (até 900 KB), guardado à parte.

const MAX_IMG = 900 * 1024;
async function compressImage(file: File): Promise<{ bytes: Uint8Array; mime: string; url: string }> {
  const img = await createImageBitmap(file);
  let side = 1600;
  let quality = 0.82;
  for (let i = 0; i < 6; i++) {
    const scale = Math.min(1, side / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
    if (blob && blob.size <= MAX_IMG)
      return {
        bytes: new Uint8Array(await blob.arrayBuffer()),
        mime: 'image/jpeg',
        url: URL.createObjectURL(blob)
      };
    side = Math.round(side * 0.8);
    quality = Math.max(0.6, quality - 0.06);
  }
  throw new Error('a foto ficou grande demais mesmo reduzida');
}

export default function NoticeForm(props: {
  notice: Notice | null; // null = novo
  user: HexonUser;
  unitOptions: string[]; // gerências em que a pessoa pode publicar
  canAllUnits: boolean; // vê todas as gerências: pode publicar para "todas"
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notice, user, unitOptions, canAllUnits, companies } = props;
  const [title, setTitle] = useState(notice?.title || '');
  const [text, setText] = useState(notice?.text || '');
  const [kind, setKind] = useState<NoticeKind>(notice?.kind || 'info');
  const [allUnits, setAllUnits] = useState(notice ? notice.units.includes(NOTICE_ALL_UNITS) : false);
  const [units, setUnits] = useState<string[]>(notice ? notice.units.filter((u) => u !== NOTICE_ALL_UNITS) : unitOptions.length === 1 ? unitOptions : []);
  const [cos, setCos] = useState<string[]>(notice?.companies || []);
  const [audience, setAudience] = useState<NoticeAudience>(notice?.audience || 'todos');
  const [pinned, setPinned] = useState(!!notice?.pinned);
  const today = new Date().toLocaleDateString('en-CA');
  // Reabrir um encerrado: a data antiga já passou, começa sem data
  const [until, setUntil] = useState(notice && notice.until !== NOTICE_FOREVER && notice.until >= today ? notice.until : '');
  const [image, setImage] = useState<{ bytes: Uint8Array; mime: string; url: string } | null | undefined>(undefined);
  const [pdf, setPdf] = useState<NoticeFile | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  // Empresas das gerências escolhidas
  const coOptions = useMemo(
    () => companies.filter((c) => c.active !== false && (allUnits || c.units.some((u) => units.includes(u)))).sort((a, b) => a.name.localeCompare(b.name)),
    [companies, allUnits, units.join('|')]
  );
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const pickImage = async (file?: File) => {
    if (!file) return;
    setMsg('');
    try {
      setImage(await compressImage(file));
    } catch (err: any) {
      setMsg(`Não foi possível usar a foto: ${err?.message || err}`);
    }
  };

  const pickPdf = async (file?: File) => {
    if (!file) return;
    setMsg('');
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) return setMsg('Escolha um arquivo PDF.');
    if (file.size > NOTICE_FILE_MAX) return setMsg(`O PDF tem ${Math.round(file.size / 1024)} KB: o limite é 900 KB.`);
    setPdf({ bytes: new Uint8Array(await file.arrayBuffer()), name: file.name });
  };

  const save = async () => {
    const chosen = allUnits ? [NOTICE_ALL_UNITS] : units;
    if (!title.trim() || !text.trim()) return setMsg('Preencha o título e o texto.');
    if (chosen.length === 0) return setMsg('Escolha pelo menos uma gerência.');
    if (until && until < today) return setMsg('A data "mostrar até" já passou.');
    setBusy(true);
    setMsg('');
    const now = new Date().toISOString();
    const by = { matricula: user.matricula, name: user.name };
    const data: Notice = {
      id: notice?.id || '',
      title: title.trim(),
      text: text.trim(),
      kind,
      pinned,
      units: chosen,
      companies: cos.filter((c) => coOptions.some((o) => o.id === c)),
      audience,
      until: until || NOTICE_FOREVER,
      hasImage: notice?.hasImage,
      hasFile: notice?.hasFile,
      fileName: notice?.fileName,
      createdAt: notice?.createdAt || now,
      createdBy: notice?.createdBy || by,
      updatedAt: now,
      ...(notice ? { updatedBy: by } : {})
    };
    try {
      await dbSaveNotice(data, image === undefined ? undefined : image ? { bytes: image.bytes, mime: image.mime } : null, pdf);
      props.onSaved();
    } catch (err: any) {
      setMsg(err?.code === 'permission-denied' ? 'O banco recusou: seu perfil não publica avisos para essas gerências.' : `Não foi possível gravar: ${err?.message || err}`);
      setBusy(false);
    }
  };

  const label = 'block text-[11px] font-black uppercase tracking-wider text-slate-500 mb-1';
  const input = 'w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900';
  const chip = (on: boolean) =>
    `px-3 py-1.5 rounded-lg border text-xs font-bold cursor-pointer ${on ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`;
  const hasPhoto = image ? true : image === null ? false : !!notice?.hasImage;
  const pdfName = pdf ? pdf.name : pdf === null ? '' : notice?.hasFile ? notice.fileName || 'PDF atual' : '';

  return (
    <div className="fixed inset-0 z-[1500] bg-slate-900/70 flex items-start md:items-center justify-center p-2 md:p-4">
      <div className="w-full max-w-2xl max-h-full flex flex-col bg-slate-50 dark:bg-[#08122b] rounded-2xl shadow-2xl overflow-hidden">
        <div
          className="shrink-0 px-4 py-3 bg-white dark:bg-[#0b1220] border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2"
          style={{ borderTop: `4px solid ${NOTICE_KINDS[kind].color}` }}
        >
          <p className="text-sm font-black text-slate-900 dark:text-white">{notice ? 'Editar aviso' : 'Novo aviso'}</p>
          <button type="button" onClick={props.onClose} className="h-8 w-8 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center cursor-pointer" title="Fechar">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          <div>
            <span className={label}>Tipo</span>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(NOTICE_KINDS) as NoticeKind[]).map((k) => (
                <button key={k} type="button" onClick={() => setKind(k)} className={chip(kind === k)}>
                  {NOTICE_KINDS[k].label}
                </button>
              ))}
            </div>
            {kind === 'urgente' && <p className="text-[11px] text-rose-600 mt-1">Urgente: cada pessoa toca em "Li e estou ciente" e você vê quem já leu.</p>}
          </div>
          <label className="block">
            <span className={label}>Título *</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} className={input} placeholder="Ex.: Treinamento de NR-10 na sexta" />
          </label>
          <label className="block">
            <span className={label}>Texto *</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} rows={6} className={input} />
          </label>
          <div>
            <span className={label}>Gerências *</span>
            <div className="flex flex-wrap gap-2">
              {canAllUnits && (
                <button type="button" onClick={() => setAllUnits(!allUnits)} className={chip(allUnits)}>
                  Todas as gerências
                </button>
              )}
              {!allUnits &&
                unitOptions.map((u) => (
                  <button key={u} type="button" onClick={() => setUnits(toggle(units, u))} className={chip(units.includes(u))}>
                    {u}
                  </button>
                ))}
            </div>
          </div>
          {coOptions.length > 0 && (
            <div>
              <span className={label}>Empresas (nenhuma marcada = todas)</span>
              <div className="flex flex-wrap gap-2">
                {coOptions.map((c) => (
                  <button key={c.id} type="button" onClick={() => setCos(toggle(cos, c.id))} className={chip(cos.includes(c.id))}>
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <span className={label}>Quem vê</span>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['todos', 'Todos'],
                  ['tecnicos', 'Só técnicos (celular)'],
                  ['escritorio', 'Só escritório']
                ] as [NoticeAudience, string][]
              ).map(([v, l]) => (
                <button key={v} type="button" onClick={() => setAudience(v)} className={chip(audience === v)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
              <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="w-4 h-4" />
              Fixar no topo
            </label>
            <label className="block">
              <span className={label}>Mostrar até (opcional)</span>
              <input type="date" value={until} min={today} onChange={(e) => setUntil(e.target.value)} className={input} />
            </label>
          </div>
          <div>
            <span className={label}>Foto (opcional)</span>
            {hasPhoto ? (
              <div className="flex items-center gap-3">
                {image?.url ? <img src={image.url} alt="" className="h-20 rounded-lg border border-slate-200" /> : <span className="text-xs text-slate-500">Foto atual</span>}
                <button
                  type="button"
                  onClick={() => setImage(null)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-rose-200 text-rose-700 text-xs font-bold cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Tirar a foto
                </button>
              </div>
            ) : (
              <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 text-xs font-bold text-slate-600 dark:text-slate-300 cursor-pointer">
                <ImagePlus className="w-4 h-4" />
                Escolher foto (JPG ou PNG)
                <input type="file" accept="image/*" className="hidden" onChange={(e) => pickImage(e.target.files?.[0])} />
              </label>
            )}
          </div>
          <div>
            <span className={label}>PDF (opcional, até 900 KB)</span>
            {pdfName ? (
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 min-w-0">
                  <FileText className="w-4 h-4 text-red-600 shrink-0" />
                  <span className="truncate">{pdfName}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setPdf(null)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-rose-200 text-rose-700 text-xs font-bold cursor-pointer shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Tirar o PDF
                </button>
              </div>
            ) : (
              <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 text-xs font-bold text-slate-600 dark:text-slate-300 cursor-pointer">
                <Paperclip className="w-4 h-4" />
                Anexar PDF
                <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => pickPdf(e.target.files?.[0])} />
              </label>
            )}
          </div>
        </div>
        <div className="shrink-0 px-4 py-3 bg-white dark:bg-[#0b1220] border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-end gap-2">
          {msg && <p className="flex-1 min-w-[160px] text-xs font-bold text-rose-600">{msg}</p>}
          <button type="button" onClick={props.onClose} className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-bold cursor-pointer">
            Cancelar
          </button>
          <button type="button" onClick={save} disabled={busy} className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-black cursor-pointer disabled:opacity-60">
            {busy ? 'Gravando…' : notice ? 'Gravar alterações' : 'Publicar aviso'}
          </button>
        </div>
      </div>
    </div>
  );
}
