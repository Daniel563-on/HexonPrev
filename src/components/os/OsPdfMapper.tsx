import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart, Bold, ChevronLeft, ChevronRight, Copy, FileDown, FileUp, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { OsPdfLayout, OsPdfPin, OsSignatureRole, OsTemplate } from '../../types';
import { OS_PDF_MAX_BYTES, dbDeleteOsPdfLayout, dbGetOsPdfFile, dbGetOsPdfLayout, dbGetOsSignatureImage, dbGetWorkOrder, dbSaveOsPdfLayout } from '../../db/firebase';
import { pdfjsLib } from '../../lib/pdfHelper';
import { downloadBytes, generateOsMappedPdf, osPdfFieldLabel, osPdfFieldOptions } from '../../lib/osPdf';

// PDF MAPEADO DO MODELO DE OS (Fase 5C): sobe o PDF oficial (frente e verso), desenha caixas sobre ele
// e escolhe o que vai em cada uma (pergunta, dado da OS, assinatura, texto fixo). "Testar com uma OS" gera o PDF
// de uma OS real sem salvar. Posições em % da página (não dependem do zoom).

interface Props {
  template: OsTemplate;
  userName: string;
  onClose: () => void;
}

type Drag =
  | { kind: 'draw'; x0: number; y0: number; x: number; y: number }
  | { kind: 'move'; id: string; dx: number; dy: number }
  | { kind: 'resize'; id: string };

const newId = () => Math.random().toString(36).slice(2, 10);
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const r2 = (n: number) => Math.round(n * 100) / 100;

export default function OsPdfMapper({ template, userName, onClose }: Props) {
  const [layout, setLayout] = useState<OsPdfLayout | null>(null);
  const [pdfB64, setPdfB64] = useState<string | null>(null);
  const [pdfChanged, setPdfChanged] = useState(false);
  const [pdfName, setPdfName] = useState('');
  const [pdfSize, setPdfSize] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [pins, setPins] = useState<OsPdfPin[]>([]);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [sel, setSel] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testNumber, setTestNumber] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [dirty, setDirty] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const docRef = useRef<any>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const options = useMemo(() => osPdfFieldOptions(template.fields), [template]);
  const groups = useMemo(() => Array.from(new Set(options.map((o) => o.group))), [options]);

  // Carrega o que já está salvo
  useEffect(() => {
    (async () => {
      try {
        const l = await dbGetOsPdfLayout(template.id);
        if (l) {
          setLayout(l);
          setPins(l.pins || []);
          setPdfName(l.pdfName);
          setPdfSize(l.pdfSize);
          setPageCount(l.pageCount);
          setPdfB64(await dbGetOsPdfFile(l));
        }
      } catch (err: any) {
        setMsg({ ok: false, text: `Não foi possível carregar o PDF: ${err?.message || err}` });
      } finally {
        setLoading(false);
      }
    })();
  }, [template.id]);

  // Abre o PDF para desenhar as páginas
  useEffect(() => {
    if (!pdfB64) {
      docRef.current = null;
      return;
    }
    let alive = true;
    (async () => {
      try {
        const bin = atob(pdfB64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const d = await pdfjsLib.getDocument({ data: bytes }).promise;
        if (!alive) return;
        docRef.current = d;
        setPageCount(d.numPages);
        setPage((p) => Math.min(p, d.numPages));
        render(Math.min(page, d.numPages));
      } catch (err: any) {
        setMsg({ ok: false, text: `Não foi possível abrir o PDF: ${err?.message || err}` });
      }
    })();
    return () => {
      alive = false;
    };
  }, [pdfB64]);

  const render = async (n = page) => {
    const d = docRef.current;
    const c = canvasRef.current;
    if (!d || !c) return;
    const p = await d.getPage(n);
    const base = p.getViewport({ scale: 1 });
    const vp = p.getViewport({ scale: (760 / base.width) * zoom });
    c.width = vp.width;
    c.height = vp.height;
    c.style.width = `${vp.width}px`;
    c.style.height = `${vp.height}px`;
    await p.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
  };
  useEffect(() => {
    render();
  }, [page, zoom]);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return setMsg({ ok: false, text: 'Escolha um arquivo PDF.' });
    if (file.size > OS_PDF_MAX_BYTES) return setMsg({ ok: false, text: `O PDF tem ${Math.round(file.size / 1024)} KB; o máximo é ${Math.round(OS_PDF_MAX_BYTES / 1024)} KB.` });
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || '');
      setPdfB64(url.split(',')[1] || '');
      setPdfChanged(true);
      setPdfName(file.name);
      setPdfSize(file.size);
      setPage(1);
      setDirty(true);
      setMsg({ ok: true, text: layout ? 'PDF trocado: confira se as caixas continuam no lugar e salve.' : 'PDF carregado: desenhe as caixas arrastando sobre a página.' });
    };
    reader.readAsDataURL(file);
  };

  // ===== Caixas =====
  const pos = (e: React.PointerEvent) => {
    const r = overlayRef.current!.getBoundingClientRect();
    return { x: clamp(((e.clientX - r.left) / r.width) * 100, 0, 100), y: clamp(((e.clientY - r.top) / r.height) * 100, 0, 100) };
  };
  const patchPin = (id: string, p: Partial<OsPdfPin>) => {
    setPins((prev) => prev.map((x) => (x.id === id ? { ...x, ...p } : x)));
    setDirty(true);
  };
  const selected = pins.find((p) => p.id === sel) || null;

  const onDown = (e: React.PointerEvent) => {
    if (e.target !== overlayRef.current) return;
    const p = pos(e);
    overlayRef.current!.setPointerCapture(e.pointerId);
    setSel(null);
    setDrag({ kind: 'draw', x0: p.x, y0: p.y, x: p.x, y: p.y });
  };
  const onPinDown = (e: React.PointerEvent, pin: OsPdfPin, resize = false) => {
    e.stopPropagation();
    overlayRef.current!.setPointerCapture(e.pointerId);
    setSel(pin.id);
    const p = pos(e);
    setDrag(resize ? { kind: 'resize', id: pin.id } : { kind: 'move', id: pin.id, dx: p.x - pin.x, dy: p.y - pin.y });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = pos(e);
    if (drag.kind === 'draw') setDrag({ ...drag, x: p.x, y: p.y });
    else if (drag.kind === 'move') {
      const pin = pins.find((x) => x.id === drag.id)!;
      patchPin(drag.id, { x: r2(clamp(p.x - drag.dx, 0, 100 - pin.w)), y: r2(clamp(p.y - drag.dy, 0, 100 - pin.h)) });
    } else {
      const pin = pins.find((x) => x.id === drag.id)!;
      patchPin(drag.id, { w: r2(clamp(p.x - pin.x, 1, 100 - pin.x)), h: r2(clamp(p.y - pin.y, 0.8, 100 - pin.y)) });
    }
  };
  const onUp = () => {
    if (drag?.kind === 'draw') {
      const x = Math.min(drag.x0, drag.x);
      const y = Math.min(drag.y0, drag.y);
      const w = Math.abs(drag.x - drag.x0);
      const h = Math.abs(drag.y - drag.y0);
      if (w > 1 && h > 0.6) {
        const pin: OsPdfPin = { id: newId(), page, x: r2(x), y: r2(y), w: r2(w), h: r2(h), field: 'sys:numero', fontSize: 10, align: 'left', valign: 'middle' };
        setPins((prev) => [...prev, pin]);
        setSel(pin.id);
        setDirty(true);
      }
    }
    setDrag(null);
  };

  const duplicate = () => {
    if (!selected) return;
    const copy = { ...selected, id: newId(), y: r2(clamp(selected.y + selected.h + 0.5, 0, 100 - selected.h)) };
    setPins((prev) => [...prev, copy]);
    setSel(copy.id);
    setDirty(true);
  };
  const remove = () => {
    if (!selected) return;
    setPins((prev) => prev.filter((p) => p.id !== selected.id));
    setSel(null);
    setDirty(true);
  };

  // ===== Salvar / testar / remover =====
  const save = async () => {
    if (!pdfB64) return setMsg({ ok: false, text: 'Suba o PDF oficial primeiro.' });
    setBusy(true);
    setMsg(null);
    try {
      const saved = await dbSaveOsPdfLayout(
        { templateId: template.id, pdfName, pdfSize, pageCount, version: layout?.version || 0, pins, updatedAt: '', updatedBy: '' },
        userName,
        pdfChanged ? pdfB64 : undefined
      );
      setLayout(saved);
      setPdfChanged(false);
      setDirty(false);
      setMsg({ ok: true, text: `PDF salvo (${pins.length} caixa(s)).` });
    } catch (err: any) {
      setMsg({ ok: false, text: err?.code === 'permission-denied' ? 'O banco recusou: seu perfil não edita modelos de OS.' : `Não foi possível salvar: ${err?.message || err}` });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (!pdfB64) return setMsg({ ok: false, text: 'Suba o PDF oficial primeiro.' });
    const t = testNumber.trim().toUpperCase();
    if (!t) return setMsg({ ok: false, text: 'Digite o número de uma OS para testar (ex.: OS-2026000001).' });
    const id = t.startsWith('OS-') ? t : `OS-${t.replace(/\D/g, '')}`;
    setBusy(true);
    setMsg(null);
    try {
      const o = await dbGetWorkOrder(id);
      if (!o) throw new Error(`a OS ${id} não foi encontrada (ou é de uma gerência que você não vê).`);
      const signatures: Partial<Record<OsSignatureRole, string>> = {};
      await Promise.all(
        (Object.keys(o.signatures || {}) as OsSignatureRole[]).map(async (r) => {
          const img = await dbGetOsSignatureImage(o.id, r);
          if (img) signatures[r] = img;
        })
      );
      downloadBytes(await generateOsMappedPdf(pdfB64, pins, { order: o, signatures }), `Teste_${o.number}.pdf`);
      setMsg({ ok: true, text: `PDF de teste da ${o.number} baixado${o.templateId !== template.id ? ' (atenção: essa OS é de outro modelo; as perguntas deste modelo podem sair em branco)' : ''}.` });
    } catch (err: any) {
      setMsg({ ok: false, text: `Não foi possível testar: ${err?.message || err}` });
    } finally {
      setBusy(false);
    }
  };

  const removeAll = async () => {
    setBusy(true);
    try {
      if (layout) await dbDeleteOsPdfLayout(template.id);
      setLayout(null);
      setPdfB64(null);
      setPins([]);
      setPageCount(0);
      setPdfName('');
      setConfirmRemove(false);
      setDirty(false);
      setMsg({ ok: true, text: 'PDF removido: as OS deste modelo passam a sair no PDF padrão.' });
    } catch (err: any) {
      setMsg({ ok: false, text: `Não foi possível remover: ${err?.message || err}` });
    } finally {
      setBusy(false);
    }
  };

  const pagePins = pins.filter((p) => p.page === page);
  const lostPins = pins.filter((p) => p.page > pageCount);
  const btnBase = 'h-8 px-3 rounded-lg border text-[11px] font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-40';
  const btn = `${btnBase} border-slate-200 bg-white`;
  const btnOn = (on: boolean) => `${btnBase} ${on ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white'}`;
  const draft = drag?.kind === 'draw' ? { x: Math.min(drag.x0, drag.x), y: Math.min(drag.y0, drag.y), w: Math.abs(drag.x - drag.x0), h: Math.abs(drag.y - drag.y0) } : null;

  return (
    <div className="fixed inset-0 z-[1200] bg-slate-900/70 flex items-center justify-center p-2">
      <div className="w-full h-full max-w-[1400px] bg-slate-50 rounded-2xl overflow-hidden flex flex-col">
        <div className="px-4 py-2.5 bg-white border-b border-slate-200 flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black text-slate-900 truncate">PDF mapeado — {template.name}</p>
            <p className="text-[11px] text-slate-500 truncate">
              {pdfB64 ? `${pdfName || 'PDF'} · ${Math.round(pdfSize / 1024)} KB · ${pageCount} página(s) · ${pins.length} caixa(s)` : 'Nenhum PDF: as OS deste modelo saem no PDF padrão.'}
            </p>
          </div>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} aria-label="Arquivo PDF" />
          <button type="button" className={btn} onClick={() => fileRef.current?.click()} disabled={busy}>
            <FileUp className="w-3.5 h-3.5" /> {pdfB64 ? 'Trocar PDF' : 'Subir PDF oficial'}
          </button>
          <input value={testNumber} onChange={(e) => setTestNumber(e.target.value)} placeholder="Nº da OS para testar" className="h-8 w-44 px-2 text-[11px] border border-slate-200 rounded-lg" />
          <button type="button" className={btn} onClick={test} disabled={busy || !pdfB64}>
            <FileDown className="w-3.5 h-3.5" /> Testar com uma OS
          </button>
          {(layout || pdfB64) &&
            (confirmRemove ? (
              <>
                <button type="button" className={`${btn} border-rose-300 text-rose-700`} onClick={removeAll} disabled={busy}>Confirmar: remover PDF</button>
                <button type="button" className={btn} onClick={() => setConfirmRemove(false)}>Voltar</button>
              </>
            ) : (
              <button type="button" className={`${btn} text-rose-700`} onClick={() => setConfirmRemove(true)} disabled={busy}>
                <Trash2 className="w-3.5 h-3.5" /> Remover PDF
              </button>
            ))}
          <button type="button" onClick={save} disabled={busy || !pdfB64 || !dirty} className="h-8 px-4 rounded-lg bg-[#3525cd] text-white text-[11px] font-black cursor-pointer disabled:opacity-40">
            {busy ? 'Aguarde...' : dirty ? 'Salvar PDF' : 'Salvo'}
          </button>
          <button type="button" onClick={onClose} className="h-8 w-8 rounded-lg border border-slate-200 bg-white flex items-center justify-center cursor-pointer" title="Fechar">
            <X className="w-4 h-4" />
          </button>
        </div>
        {msg && <p className={`px-4 py-1.5 text-[11px] font-bold ${msg.ok ? 'text-emerald-700 bg-emerald-50' : 'text-rose-700 bg-rose-50'}`}>{msg.text}{dirty && msg.ok ? ' (não salvo)' : ''}</p>}

        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          {/* Página */}
          <div className="flex-1 min-h-0 overflow-auto p-4 bg-slate-200/60">
            {loading ? (
              <p className="text-xs text-slate-500">Carregando...</p>
            ) : !pdfB64 ? (
              <div className="max-w-md mx-auto mt-10 p-6 rounded-2xl bg-white border border-slate-200 text-center space-y-3">
                <p className="text-sm font-black text-slate-800">Suba o PDF oficial da OS</p>
                <p className="text-xs text-slate-500">Até {Math.round(OS_PDF_MAX_BYTES / 1024)} KB, com frente e verso se tiver. Depois desenhe uma caixa (arrastando) onde cada informação deve sair.</p>
                <button type="button" onClick={() => fileRef.current?.click()} className="h-10 px-4 rounded-xl bg-[#3525cd] text-white text-xs font-black cursor-pointer">Escolher PDF</button>
              </div>
            ) : (
              <div className="relative inline-block shadow-xl bg-white select-none">
                <canvas ref={canvasRef} className="block" />
                <div
                  ref={overlayRef}
                  className="absolute inset-0 cursor-crosshair touch-none"
                  onPointerDown={onDown}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  onPointerCancel={onUp}
                  aria-label="Área do PDF"
                >
                  {pagePins.map((p) => {
                    const isSel = p.id === sel;
                    return (
                      <div
                        key={p.id}
                        onPointerDown={(e) => onPinDown(e, p)}
                        className={`absolute border ${isSel ? 'border-[#3525cd] bg-indigo-500/15 z-10' : 'border-indigo-400/80 bg-indigo-200/25'} cursor-move overflow-hidden flex flex-col ${(p.valign || (p.field.startsWith('sig:') ? 'middle' : 'top')) === 'middle' ? 'justify-center' : p.valign === 'bottom' ? 'justify-end' : 'justify-start'}`}
                        style={{ left: `${p.x}%`, top: `${p.y}%`, width: `${p.w}%`, height: `${p.h}%` }}
                        title={osPdfFieldLabel(p.field, template.fields)}
                      >
                        <span className={`block px-0.5 text-[9px] leading-tight text-indigo-900 truncate ${p.bold ? 'font-black' : 'font-semibold'}`} style={{ textAlign: p.align || 'left' }}>
                          {p.field === 'fixed' ? p.fixedText || 'Texto fixo' : osPdfFieldLabel(p.field, template.fields)}
                        </span>
                        {isSel && <span onPointerDown={(e) => onPinDown(e, p, true)} className="absolute right-0 bottom-0 w-3 h-3 bg-[#3525cd] cursor-nwse-resize" title="Arraste para mudar o tamanho" />}
                      </div>
                    );
                  })}
                  {draft && <div className="absolute border-2 border-dashed border-[#3525cd] bg-indigo-400/10" style={{ left: `${draft.x}%`, top: `${draft.y}%`, width: `${draft.w}%`, height: `${draft.h}%` }} />}
                </div>
              </div>
            )}
          </div>

          {/* Painel */}
          <div className="w-full md:w-80 shrink-0 border-t md:border-t-0 md:border-l border-slate-200 bg-white overflow-y-auto p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <button type="button" className={btn} onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} aria-label="Página anterior"><ChevronLeft className="w-3.5 h-3.5" /></button>
                <span className="text-[11px] font-black text-slate-700 px-1">Página {pageCount ? page : 0} de {pageCount}{page === 2 ? ' (verso)' : ''}</span>
                <button type="button" className={btn} onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount} aria-label="Próxima página"><ChevronRight className="w-3.5 h-3.5" /></button>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" className={btn} onClick={() => setZoom((z) => Math.max(0.5, r2(z - 0.25)))} aria-label="Diminuir"><ZoomOut className="w-3.5 h-3.5" /></button>
                <span className="text-[10px] font-bold text-slate-500 w-9 text-center">{Math.round(zoom * 100)}%</span>
                <button type="button" className={btn} onClick={() => setZoom((z) => Math.min(3, r2(z + 0.25)))} aria-label="Aumentar"><ZoomIn className="w-3.5 h-3.5" /></button>
              </div>
            </div>
            <p className="text-[11px] text-slate-500">Arraste sobre a página para criar uma caixa. Clique numa caixa para escolher o que sai nela; arraste para mover e use o canto azul para mudar o tamanho. Texto maior que a caixa diminui a letra sozinho.</p>
            {lostPins.length > 0 && <p className="text-[11px] font-bold text-amber-700">{lostPins.length} caixa(s) estão numa página que este PDF não tem.</p>}

            {selected ? (
              <div className="p-3 rounded-xl border border-indigo-200 bg-indigo-50/40 space-y-2">
                <p className="text-[10px] font-black uppercase tracking-wider text-indigo-700">Caixa selecionada</p>
                <label className="block">
                  <span className="block text-[10px] font-black uppercase text-slate-500 mb-1">O que sai aqui</span>
                  <select value={selected.field} onChange={(e) => patchPin(selected.id, { field: e.target.value })} className="w-full h-9 px-2 text-xs border border-slate-200 rounded-lg bg-white" aria-label="Campo da caixa">
                    {groups.map((g) => (
                      <optgroup key={g} label={g}>
                        {options.filter((o) => o.group === g).map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </optgroup>
                    ))}
                    {!options.some((o) => o.value === selected.field) && <option value={selected.field}>Pergunta removida do modelo</option>}
                  </select>
                </label>
                {selected.field === 'fixed' && (
                  <label className="block">
                    <span className="block text-[10px] font-black uppercase text-slate-500 mb-1">Texto</span>
                    <input value={selected.fixedText || ''} onChange={(e) => patchPin(selected.id, { fixedText: e.target.value })} className="w-full h-9 px-2 text-xs border border-slate-200 rounded-lg" aria-label="Texto fixo" />
                  </label>
                )}
                {!selected.field.startsWith('sig:') && (
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-[11px] font-bold text-slate-600">
                      Letra
                      <input type="number" min={5} max={30} step={0.5} value={selected.fontSize} onChange={(e) => patchPin(selected.id, { fontSize: clamp(Number(e.target.value) || 10, 5, 30) })} className="w-16 h-8 px-2 text-xs border border-slate-200 rounded-lg" aria-label="Tamanho da letra" />
                    </label>
                    <button type="button" onClick={() => patchPin(selected.id, { bold: !selected.bold })} className={btnOn(!!selected.bold)} title="Negrito"><Bold className="w-3.5 h-3.5" /></button>
                  </div>
                )}
                <div className="flex gap-1">
                  {(['left', 'center', 'right'] as const).map((a) => (
                    <button key={a} type="button" onClick={() => patchPin(selected.id, { align: a })} className={btnOn((selected.align || 'left') === a)} title={a === 'left' ? 'Esquerda' : a === 'center' ? 'Centro' : 'Direita'}>
                      {a === 'left' ? <AlignLeft className="w-3.5 h-3.5" /> : a === 'center' ? <AlignCenter className="w-3.5 h-3.5" /> : <AlignRight className="w-3.5 h-3.5" />}
                    </button>
                  ))}
                  <span className="w-2" />
                  {(['top', 'middle', 'bottom'] as const).map((a) => (
                    <button key={a} type="button" onClick={() => patchPin(selected.id, { valign: a })} className={btnOn((selected.valign || (selected.field.startsWith('sig:') ? 'middle' : 'top')) === a)} title={a === 'top' ? 'Em cima' : a === 'middle' ? 'Ao meio' : 'Embaixo'}>
                      {a === 'top' ? <AlignVerticalJustifyStart className="w-3.5 h-3.5" /> : a === 'middle' ? <AlignVerticalJustifyCenter className="w-3.5 h-3.5" /> : <AlignVerticalJustifyEnd className="w-3.5 h-3.5" />}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 pt-1">
                  <button type="button" className={btn} onClick={duplicate}><Copy className="w-3.5 h-3.5" /> Duplicar</button>
                  <button type="button" className={`${btn} text-rose-700`} onClick={remove}><Trash2 className="w-3.5 h-3.5" /> Tirar caixa</button>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-slate-400">Nenhuma caixa selecionada.</p>
            )}

            <div className="space-y-1">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Caixas desta página ({pagePins.length})</p>
              {pagePins.map((p) => (
                <button key={p.id} type="button" onClick={() => setSel(p.id)} className={`w-full text-left px-2 py-1.5 rounded-lg text-[11px] cursor-pointer ${p.id === sel ? 'bg-indigo-100 text-indigo-900 font-black' : 'hover:bg-slate-100 text-slate-700'}`}>
                  {p.field === 'fixed' ? `Texto: ${p.fixedText || '—'}` : osPdfFieldLabel(p.field, template.fields)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
