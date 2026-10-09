import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PackageOpen, Search, Trash2, X, CheckCircle2, XCircle, Clock, Warehouse } from 'lucide-react';
import { Company, HexonUser, Material, ServiceOrder, SupplyRequest, SupplyRequestItem, WorkOrder } from '../../types';
import {
  companyNames,
  dbAckSupplyRequest,
  dbCreateSupplyRequest,
  dbGetCompanies,
  dbGetMyWorkOrders,
  dbGetSupplies,
  dbReceiveSupplyRequest,
  formatSupplyQty,
  parseQty,
  SR_STATUS_LABEL,
  suppliesSyncStatus
} from '../../db/firebase';
import { formatOrderNumber } from '../../utils/orderNumber';
import { useSyncVersion } from '../../utils/useSyncVersion';

// PEDIDO DE INSUMOS (Fase 8C-2) — aba Solicitações do celular, seção "Insumos".
// Só aparece para técnico de empresa marcada no cadastro ("Técnicos pedem insumos").
// O pedido é para uma OS aberta dele (chamado GLPI em andamento, pendente ou contestado, ou preventiva aberta) da empresa
// marcada, com o nº do GLPI (chamado: vem da OS; preventiva: digitado). A lista de insumos é a da gerência + empresa da OS,
// guardada no aparelho em tempo real. Depois de fornecido, "Recebi" põe os insumos na OS.

interface OrderOption {
  key: string;
  kind: 'preventiva' | 'os';
  id: string;
  unit: string;
  company: string;
  label: string;
  glpi: string; // chamado: o da OS; preventiva: vazio (o técnico digita)
}

interface DraftItem extends SupplyRequestItem {
  qtyText: string;
}

// Situações do chamado que aceitam pedido de insumos (as mesmas do pedido de material)
const SR_OS_STATUSES: WorkOrder['status'][] = ['Em andamento', 'Pendente', 'Contestada'];

const STATUS_STYLE: Record<string, string> = {
  Pendente: 'bg-amber-100 text-amber-800',
  Confirmado: 'bg-blue-100 text-blue-800',
  Fornecido: 'bg-violet-100 text-violet-800',
  Recebido: 'bg-emerald-100 text-emerald-800',
  Reprovado: 'bg-rose-100 text-rose-800'
};

const norm = (s: string) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export default function TechnicianSupplyRequests({
  userProfile,
  darkMode,
  preventives,
  spCompanies,
  requests
}: {
  userProfile: HexonUser;
  darkMode: boolean;
  preventives: ServiceOrder[]; // preventivas abertas do técnico
  spCompanies: string[];       // empresas do técnico que pedem insumos
  requests: SupplyRequest[];   // pedidos que aparecem para ele (tempo real)
}) {
  const [creating, setCreating] = useState(false);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [orderKey, setOrderKey] = useState('');
  const [glpiText, setGlpiText] = useState('');
  const [catalog, setCatalog] = useState<Material[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalogInfo, setCatalogInfo] = useState<{ total: number; error?: string; code?: string } | null>(null);
  const [companyList, setCompanyList] = useState<Company[]>([]);
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const catalogFor = useRef('');

  const card = darkMode ? 'bg-slate-900/90 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-800';
  const input = `w-full px-3 py-2.5 rounded-xl border text-sm ${darkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-800'}`;

  useEffect(() => {
    dbGetCompanies().then(setCompanyList).catch(() => {});
  }, []);

  // Chamados dele: 1 busca ao abrir o formulário (só os que ainda podem usar insumos)
  useEffect(() => {
    if (!creating) return;
    dbGetMyWorkOrders(userProfile.matricula)
      .then((l) => setWorkOrders(l.filter((o) => SR_OS_STATUSES.includes(o.status))))
      .catch(() => setWorkOrders([]));
  }, [creating, userProfile.matricula]);

  const options: OrderOption[] = useMemo(() => {
    const prev = preventives
      .filter((o) => !!o.company && spCompanies.includes(o.company) && !!o.unit)
      .map((o) => ({
        key: `p:${o.id}`,
        kind: 'preventiva' as const,
        id: o.id,
        unit: o.unit!,
        company: o.company!,
        label: `Preventiva #${formatOrderNumber(o.id)} · ${o.assetName || o.title}`,
        glpi: ''
      }));
    const os = workOrders
      .filter((o) => !!o.company && spCompanies.includes(o.company))
      .map((o) => ({
        key: `o:${o.id}`,
        kind: 'os' as const,
        id: o.id,
        unit: o.unit,
        company: o.company!,
        label: `${o.number}${o.glpi ? ` · GLPI ${o.glpi}` : ''} · ${o.intervencao || 'OS'}`,
        glpi: String(o.glpi || '').replace(/\D/g, '')
      }));
    return [...os, ...prev];
  }, [preventives, workOrders, spCompanies]);

  const order = options.find((o) => o.key === orderKey) || null;
  const glpi = order?.kind === 'os' ? order.glpi : glpiText.replace(/\D/g, '');

  // Lista de insumos da gerência + empresa da OS (cópia do aparelho em tempo real; R$ 0,00 não pode ser usado)
  const supVersion = useSyncVersion('supplies');
  const loadCatalog = (silent: boolean) => {
    if (!order) return;
    const { unit, company } = order;
    const tag = `${unit}|${company}`;
    if (!silent) setLoadingCatalog(true);
    dbGetSupplies([unit], false, company)
      .then((l) => {
        if (catalogFor.current !== tag) return;
        setCatalog(l.filter((m) => m.unit === unit && m.company === company && m.cost > 0));
        const st = suppliesSyncStatus(unit, company);
        setCatalogInfo({ total: l.length, error: st?.error, code: st?.code });
      })
      .catch((err) => {
        if (catalogFor.current !== tag) return;
        setCatalog([]);
        setCatalogInfo({ total: 0, error: String(err?.message || err), code: String(err?.code || '') });
      })
      .finally(() => {
        if (catalogFor.current === tag) setLoadingCatalog(false);
      });
  };
  useEffect(() => {
    catalogFor.current = order ? `${order.unit}|${order.company}` : '';
    setCatalog([]);
    setCatalogInfo(null);
    if (order) loadCatalog(false);
  }, [order?.unit, order?.company]);
  useEffect(() => {
    if (supVersion > 0) loadCatalog(true);
  }, [supVersion]);
  const catalogLine = (() => {
    if (!order || loadingCatalog || !catalogInfo) return null;
    const where = `${order.unit} · ${companyNames([order.company], companyList) || order.company}`;
    if (catalogInfo.error && catalogInfo.code === 'permission-denied')
      return { bad: true, text: `O banco não permitiu ler os insumos da ${where}. Avise o planejador.` };
    const n = catalog.length;
    const noValue = Math.max(0, catalogInfo.total - n);
    const base = `${n} ${n === 1 ? 'insumo disponível' : 'insumos disponíveis'} (${where})${noValue ? ` · ${noValue} sem valor (não aparecem)` : ''}`;
    if (catalogInfo.error) return { bad: true, text: `${base} · não foi possível atualizar a lista: ${catalogInfo.error}` };
    return { bad: n === 0, text: n === 0 && catalogInfo.total === 0 ? `Nenhum insumo cadastrado para ${where}.` : `${base} · atualiza sozinho` };
  })();

  const matches = useMemo(() => {
    const words = norm(search).split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const chosen = new Set(items.map((i) => i.supplyId));
    return catalog
      .filter((m) => !chosen.has(m.id))
      .filter((m) => {
        const hay = norm(`${m.code} ${m.description}`);
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 30);
  }, [search, catalog, items]);

  const reset = () => {
    setCreating(false);
    setOrderKey('');
    setGlpiText('');
    setItems([]);
    setSearch('');
    setNote('');
  };

  const addItem = (m: Material) => {
    setItems([...items, { supplyId: m.id, code: m.code, description: m.description, measureUnit: m.measureUnit, qty: 0, qtyText: '' }]);
    setSearch('');
  };

  const send = async () => {
    setMsg(null);
    if (!order) return setMsg({ ok: false, text: 'Escolha a OS.' });
    if (!glpi) return setMsg({ ok: false, text: order.kind === 'os' ? 'Esta OS não tem o número do GLPI.' : 'Informe o número do GLPI (só números).' });
    if (items.length === 0) return setMsg({ ok: false, text: 'Adicione pelo menos um insumo.' });
    const parsed = items.map((i) => ({ ...i, qty: parseQty(i.qtyText) }));
    const bad = parsed.find((i) => !Number.isFinite(i.qty) || i.qty <= 0);
    if (bad) return setMsg({ ok: false, text: `Informe a quantidade de "${bad.description}".` });
    setBusy('send');
    try {
      const req = await dbCreateSupplyRequest({
        unit: order.unit,
        company: order.company,
        orderKind: order.kind,
        orderId: order.id,
        orderLabel: order.label,
        glpi,
        techMatricula: userProfile.matricula,
        techName: userProfile.name,
        items: parsed.map(({ qtyText: _q, ...it }) => it),
        note
      });
      reset();
      setMsg({ ok: true, text: `Pedido ${req.number} enviado. Você recebe a resposta aqui.` });
    } catch (err: any) {
      setMsg({ ok: false, text: `Não foi possível enviar: ${err?.message || err}` });
    } finally {
      setBusy(null);
    }
  };

  const act = async (r: SupplyRequest, what: 'receive' | 'ack') => {
    setBusy(r.id);
    setMsg(null);
    try {
      if (what === 'receive') await dbReceiveSupplyRequest(r, userProfile.name);
      else await dbAckSupplyRequest(r, userProfile.name);
      if (what === 'receive') setMsg({ ok: true, text: `Insumos do pedido ${r.number} lançados na OS.` });
    } catch (err: any) {
      setMsg({ ok: false, text: `Não foi possível: ${err?.message || err}` });
    } finally {
      setBusy(null);
    }
  };

  const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');

  if (creating) {
    return (
      <div className={`p-4 rounded-2xl border space-y-4 ${card}`}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-black">Novo pedido de insumos</p>
          <button type="button" onClick={reset} className="p-1.5 rounded-lg text-slate-400 cursor-pointer" aria-label="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>

        <label className="block space-y-1">
          <span className="text-[11px] font-bold text-slate-500 uppercase">OS *</span>
          <select
            value={orderKey}
            onChange={(e) => {
              setOrderKey(e.target.value);
              setItems([]);
              setSearch('');
              setGlpiText('');
            }}
            className={input}
          >
            <option value="">Escolha uma OS sua</option>
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          {options.length === 0 && <span className="block text-[11px] text-slate-500">Nenhuma OS aberta sua (de empresa que pede insumos).</span>}
        </label>

        {order && (
          <>
            {order.kind === 'os' ? (
              <p className={`text-xs p-2 rounded-lg ${glpi ? 'bg-indigo-500/10' : 'bg-rose-500/10 text-rose-700 font-bold'}`}>
                {glpi ? (
                  <>
                    GLPI do pedido: <b className="font-mono">{glpi}</b> (da OS)
                  </>
                ) : (
                  'Esta OS não tem o número do GLPI: peça para o planejador informar antes de pedir insumos.'
                )}
              </p>
            ) : (
              <label className="block space-y-1">
                <span className="text-[11px] font-bold text-slate-500 uppercase">Nº do GLPI *</span>
                <input value={glpiText} onChange={(e) => setGlpiText(e.target.value)} inputMode="numeric" placeholder="Só números" className={input} />
              </label>
            )}

            <div className="space-y-1">
              <span className="text-[11px] font-bold text-slate-500 uppercase">Insumos *</span>
              <div className="relative">
                <Search className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={loadingCatalog ? 'Carregando a lista...' : 'Buscar por código ou descrição'}
                  className={`${input} pl-9`}
                  disabled={loadingCatalog}
                />
              </div>
              {matches.length > 0 && (
                <div className={`rounded-xl border max-h-64 overflow-y-auto divide-y ${darkMode ? 'border-slate-700 divide-slate-800' : 'border-slate-200 divide-slate-100'}`}>
                  {matches.map((m) => (
                    <button key={m.id} type="button" onClick={() => addItem(m)} className="w-full text-left px-3 py-2 text-xs cursor-pointer hover:bg-slate-500/10">
                      <span className="font-bold">{m.description}</span>
                      <span className="block text-[10px] text-slate-500">
                        Cód. {m.code} · {m.measureUnit}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {search.trim() && matches.length === 0 && !loadingCatalog && <p className="text-[11px] text-slate-500">Nenhum insumo encontrado.</p>}
              {catalogLine && <p className={`text-[11px] ${catalogLine.bad ? 'font-bold text-rose-600' : 'text-slate-500'}`}>{catalogLine.text}</p>}
            </div>

            {items.length > 0 && (
              <div className="space-y-2">
                {items.map((it, i) => (
                  <div key={it.supplyId} className={`p-3 rounded-xl border flex items-center gap-2 ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold leading-snug">{it.description}</p>
                      <p className="text-[10px] text-slate-500">Cód. {it.code}</p>
                    </div>
                    <input
                      value={it.qtyText}
                      onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, qtyText: e.target.value } : x)))}
                      inputMode="decimal"
                      placeholder="Qtd."
                      aria-label={`Quantidade de ${it.description}`}
                      className={`w-20 px-2 py-2 rounded-lg border text-sm text-right ${darkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-300'}`}
                    />
                    <span className="text-[11px] font-bold text-slate-500 w-8">{it.measureUnit}</span>
                    <button type="button" onClick={() => setItems(items.filter((_, j) => j !== i))} className="p-1.5 text-rose-500 cursor-pointer" aria-label="Remover">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <label className="block space-y-1">
              <span className="text-[11px] font-bold text-slate-500 uppercase">Observação</span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={input} />
            </label>
          </>
        )}

        {msg && <p className={`text-xs font-bold ${msg.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{msg.text}</p>}
        <button
          type="button"
          onClick={send}
          disabled={busy === 'send' || !order || items.length === 0 || !glpi}
          className="w-full h-12 rounded-xl bg-indigo-600 text-white text-sm font-black cursor-pointer disabled:opacity-50"
        >
          {busy === 'send' ? 'Enviando...' : 'Enviar pedido'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => {
          setCreating(true);
          setMsg(null);
        }}
        className="w-full h-12 rounded-xl bg-indigo-600 text-white text-sm font-black flex items-center justify-center gap-2 cursor-pointer"
      >
        <PackageOpen className="w-5 h-5" /> Novo pedido de insumos
      </button>
      {msg && <p className={`text-xs font-bold ${msg.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{msg.text}</p>}

      {requests.length === 0 ? (
        <div className={`p-6 rounded-2xl border text-center text-sm font-bold ${darkMode ? 'bg-slate-900/40 border-slate-800 text-slate-400' : 'bg-white border-slate-200 text-slate-500'}`}>
          Nenhum pedido de insumos em andamento.
        </div>
      ) : (
        requests.map((r) => (
          <div key={r.id} className={`p-4 rounded-2xl border space-y-2 ${card}`}>
            <div className="flex justify-between items-start gap-2">
              <div>
                <span className="font-mono text-sm font-black text-indigo-600">{r.number}</span>
                <p className="text-[11px] text-slate-500">
                  {fmtDate(r.createdAt)} · GLPI <b className="font-mono">{r.glpi}</b>
                </p>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${STATUS_STYLE[r.status] || ''}`}>{SR_STATUS_LABEL[r.status]}</span>
            </div>
            <p className="text-xs font-bold">{r.orderLabel}</p>
            <ul className="space-y-0.5">
              {r.items.map((it) => (
                <li key={it.supplyId} className="text-xs">
                  • {it.description} — {formatSupplyQty(it.qty)} {it.measureUnit}
                  {r.status === 'Fornecido' && it.qtySupplied !== undefined && (
                    <span className={`font-bold ${it.qtySupplied < it.qty ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {' '}
                      · fornecido {formatSupplyQty(it.qtySupplied)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {(r.status === 'Pendente' || r.status === 'Confirmado') && (
              <p className="text-[11px] text-slate-500 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> {r.status === 'Pendente' ? 'Aguardando a confirmação do administrativo.' : 'Confirmado: aguardando o almoxarifado.'}
              </p>
            )}
            {r.status === 'Fornecido' && (
              <div className="space-y-2">
                <p className="text-xs p-2 rounded-lg bg-violet-500/10 flex items-start gap-1.5">
                  <Warehouse className="w-4 h-4 shrink-0 text-violet-600" />
                  <span>
                    Fornecido pelo almoxarifado{r.supply?.note ? ` · ${r.supply.note}` : ''}. Toque em "Recebi" quando estiver com os insumos: eles entram na OS.
                  </span>
                </p>
                <button
                  type="button"
                  onClick={() => act(r, 'receive')}
                  disabled={busy === r.id}
                  className="w-full h-11 rounded-xl bg-emerald-600 text-white text-sm font-black flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" /> {busy === r.id ? 'Salvando...' : 'Recebi'}
                </button>
              </div>
            )}
            {r.status === 'Reprovado' && (
              <div className="space-y-2">
                <p className="text-xs p-2 rounded-lg bg-rose-500/10 text-rose-700 flex items-start gap-1.5">
                  <XCircle className="w-4 h-4 shrink-0" />
                  <span>
                    {r.rejection?.stage === 'almoxarifado' ? 'Recusado pelo almoxarifado' : 'Reprovado'}: {r.rejection?.reason}
                  </span>
                </p>
                <button
                  type="button"
                  onClick={() => act(r, 'ack')}
                  disabled={busy === r.id}
                  className="w-full h-11 rounded-xl border border-slate-300 text-sm font-black cursor-pointer disabled:opacity-50"
                >
                  {busy === r.id ? 'Salvando...' : 'Ciente'}
                </button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
