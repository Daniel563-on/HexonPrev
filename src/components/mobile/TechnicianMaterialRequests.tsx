import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PackagePlus, Search, Trash2, X, CheckCircle2, XCircle, Clock, Warehouse } from 'lucide-react';
import { Company, HexonUser, Material, MaterialRequest, MaterialRequestItem, ServiceOrder, WorkOrder } from '../../types';
import {
  companyNames,
  dbAckMaterialRequest,
  dbCreateMaterialRequest,
  dbGetCompanies,
  dbGetMaterials,
  dbGetMyWorkOrders,
  dbPickUpMaterialRequest,
  formatQty,
  materialsSyncStatus,
  MR_STATUS_LABEL,
  parseQty
} from '../../db/firebase';
import { formatOrderNumber } from '../../utils/orderNumber';
import { useSyncVersion } from '../../utils/useSyncVersion';

// PEDIDO DE MATERIAL DO MP (Fase 8B) — aba Solicitações do celular, seção "Material".
// Só aparece para técnico de empresa marcada no cadastro ("Técnicos pedem material do MP").
// O pedido é sempre para uma OS aberta dele (preventiva aberta; OS em andamento, pendente ou contestada) da empresa marcada; a lista de materiais é a da
// gerência + empresa da OS, guardada no aparelho (busca sem gastar leitura). Enviar precisa de internet (número do pedido).

interface OrderOption {
  key: string;
  kind: 'preventiva' | 'os';
  id: string;
  unit: string;
  company: string;
  label: string;
}

interface DraftItem extends MaterialRequestItem {
  qtyText: string;
}

// Situações da OS (corretiva/layout/acompanhamento) que aceitam pedido de material
const MR_OS_STATUSES: WorkOrder['status'][] = ['Em andamento', 'Pendente', 'Contestada'];

const STATUS_STYLE: Record<string, string> = {
  Pendente: 'bg-amber-100 text-amber-800',
  Aprovado: 'bg-blue-100 text-blue-800',
  Reprovado: 'bg-rose-100 text-rose-800',
  Atendido: 'bg-emerald-100 text-emerald-800'
};

const norm = (s: string) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export default function TechnicianMaterialRequests({
  userProfile,
  darkMode,
  preventives,
  mpCompanies,
  requests
}: {
  userProfile: HexonUser;
  darkMode: boolean;
  preventives: ServiceOrder[]; // preventivas abertas do técnico
  mpCompanies: string[];       // empresas do técnico que pedem material do MP
  requests: MaterialRequest[]; // pedidos que aparecem para ele (tempo real)
}) {
  const [creating, setCreating] = useState(false);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [orderKey, setOrderKey] = useState('');
  const [catalog, setCatalog] = useState<Material[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const card = darkMode ? 'bg-slate-900/90 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-800';
  const input = `w-full px-3 py-2.5 rounded-xl border text-sm ${darkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-800'}`;

  // Corretivas dele: 1 busca ao abrir o formulário. Só as que ainda podem usar material (a regra do banco confere o mesmo);
  // "Aguardando assinaturas" fica de fora: o técnico já executou e assinou
  useEffect(() => {
    if (!creating) return;
    dbGetMyWorkOrders(userProfile.matricula)
      .then((l) => setWorkOrders(l.filter((o) => MR_OS_STATUSES.includes(o.status))))
      .catch(() => setWorkOrders([]));
  }, [creating, userProfile.matricula]);

  const options: OrderOption[] = useMemo(() => {
    const prev = preventives
      .filter((o) => !!o.company && mpCompanies.includes(o.company) && !!o.unit)
      .map((o) => ({
        key: `p:${o.id}`,
        kind: 'preventiva' as const,
        id: o.id,
        unit: o.unit!,
        company: o.company!,
        label: `Preventiva #${formatOrderNumber(o.id)} · ${o.assetName || o.title}`
      }));
    const os = workOrders
      .filter((o) => !!o.company && mpCompanies.includes(o.company))
      .map((o) => ({
        key: `o:${o.id}`,
        kind: 'os' as const,
        id: o.id,
        unit: o.unit,
        company: o.company!,
        label: `${o.number}${o.glpi ? ` · GLPI ${o.glpi}` : ''} · ${o.intervencao || 'OS'}`
      }));
    return [...os, ...prev];
  }, [preventives, workOrders, mpCompanies]);

  const order = options.find((o) => o.key === orderKey) || null;

  // Lista de materiais da gerência + empresa da OS (cópia do aparelho em tempo real; R$ 0,00 não pode ser usado).
  // Material cadastrado ou alterado com o formulário aberto aparece sozinho (matVersion: relê da memória, sem ler o banco).
  const matVersion = useSyncVersion('materials');
  const [catalogInfo, setCatalogInfo] = useState<{ total: number; error?: string; code?: string } | null>(null);
  const [companyList, setCompanyList] = useState<Company[]>([]);
  const catalogFor = useRef('');
  useEffect(() => {
    dbGetCompanies().then(setCompanyList).catch(() => {});
  }, []);
  const loadCatalog = (silent: boolean) => {
    if (!order) return;
    const { unit, company } = order;
    const tag = `${unit}|${company}`;
    if (!silent) setLoadingCatalog(true);
    dbGetMaterials([unit], false, company)
      .then((l) => {
        if (catalogFor.current !== tag) return;
        setCatalog(l.filter((m) => m.unit === unit && m.company === company && m.cost > 0));
        const st = materialsSyncStatus(unit, company);
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
    if (matVersion > 0) loadCatalog(true);
  }, [matVersion]);
  const catalogLine = (() => {
    if (!order || loadingCatalog || !catalogInfo) return null;
    const where = `${order.unit} · ${companyNames([order.company], companyList) || order.company}`;
    if (catalogInfo.error && catalogInfo.code === 'permission-denied')
      return { bad: true, text: `O banco não permitiu ler os materiais da ${where}. Avise o planejador.` };
    const n = catalog.length;
    const noValue = Math.max(0, catalogInfo.total - n);
    const base = `${n} ${n === 1 ? 'material disponível' : 'materiais disponíveis'} (${where})${noValue ? ` · ${noValue} sem valor (não aparecem)` : ''}`;
    if (catalogInfo.error) return { bad: true, text: `${base} · não foi possível atualizar a lista: ${catalogInfo.error}` };
    return { bad: n === 0, text: n === 0 && catalogInfo.total === 0 ? `Nenhum material cadastrado para ${where}.` : `${base} · atualiza sozinho` };
  })();

  const matches = useMemo(() => {
    const words = norm(search).split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const chosen = new Set(items.map((i) => i.materialId));
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
    setItems([]);
    setSearch('');
    setNote('');
  };

  const addItem = (m: Material) => {
    setItems([...items, { materialId: m.id, code: m.code, description: m.description, measureUnit: m.measureUnit, qty: 0, qtyText: '' }]);
    setSearch('');
  };

  const send = async () => {
    setMsg(null);
    if (!order) return setMsg({ ok: false, text: 'Escolha a OS.' });
    if (items.length === 0) return setMsg({ ok: false, text: 'Adicione pelo menos um material.' });
    const parsed = items.map((i) => ({ ...i, qty: parseQty(i.qtyText) }));
    const bad = parsed.find((i) => !Number.isFinite(i.qty) || i.qty <= 0);
    if (bad) return setMsg({ ok: false, text: `Informe a quantidade de "${bad.description}".` });
    setBusy('send');
    try {
      const req = await dbCreateMaterialRequest({
        unit: order.unit,
        company: order.company,
        orderKind: order.kind,
        orderId: order.id,
        orderLabel: order.label,
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

  const act = async (r: MaterialRequest, what: 'pickup' | 'ack') => {
    setBusy(r.id);
    setMsg(null);
    try {
      if (what === 'pickup') await dbPickUpMaterialRequest(r, userProfile.name);
      else await dbAckMaterialRequest(r, userProfile.name);
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
          <p className="text-sm font-black">Novo pedido de material</p>
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
          {options.length === 0 && <span className="block text-[11px] text-slate-500">Nenhuma OS aberta sua (de empresa que pede material do MP).</span>}
        </label>

        {order && (
          <>
            <div className="space-y-1">
              <span className="text-[11px] font-bold text-slate-500 uppercase">Materiais *</span>
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
              {search.trim() && matches.length === 0 && !loadingCatalog && <p className="text-[11px] text-slate-500">Nenhum material encontrado.</p>}
              {catalogLine && <p className={`text-[11px] ${catalogLine.bad ? 'font-bold text-rose-600' : 'text-slate-500'}`}>{catalogLine.text}</p>}
            </div>

            {items.length > 0 && (
              <div className="space-y-2">
                {items.map((it, i) => (
                  <div key={it.materialId} className={`p-3 rounded-xl border flex items-center gap-2 ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
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
          disabled={busy === 'send' || !order || items.length === 0}
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
        <PackagePlus className="w-5 h-5" /> Novo pedido de material
      </button>
      {msg && <p className={`text-xs font-bold ${msg.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{msg.text}</p>}

      {requests.length === 0 ? (
        <div className={`p-6 rounded-2xl border text-center text-sm font-bold ${darkMode ? 'bg-slate-900/40 border-slate-800 text-slate-400' : 'bg-white border-slate-200 text-slate-500'}`}>
          Nenhum pedido de material em andamento.
        </div>
      ) : (
        requests.map((r) => (
          <div key={r.id} className={`p-4 rounded-2xl border space-y-2 ${card}`}>
            <div className="flex justify-between items-start gap-2">
              <div>
                <span className="font-mono text-sm font-black text-indigo-600">{r.number}</span>
                <p className="text-[11px] text-slate-500">{fmtDate(r.createdAt)}</p>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${STATUS_STYLE[r.status] || ''}`}>{MR_STATUS_LABEL[r.status]}</span>
            </div>
            <p className="text-xs font-bold">{r.orderLabel}</p>
            <ul className="space-y-0.5">
              {r.items.map((it) => (
                <li key={it.materialId} className="text-xs">
                  • {it.description} — {formatQty(it.qty)} {it.measureUnit}
                  {r.status === 'Aprovado' && it.qtySupplied !== undefined && (
                    <span className={`font-bold ${it.qtySupplied < it.qty ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {' '}
                      · fornecido {formatQty(it.qtySupplied)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {r.status === 'Pendente' && (
              <p className="text-[11px] text-slate-500 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> Aguardando aprovação.
              </p>
            )}
            {r.status === 'Aprovado' && (
              <div className="space-y-2">
                <p className="text-xs p-2 rounded-lg bg-blue-500/10 flex items-start gap-1.5">
                  <Warehouse className="w-4 h-4 shrink-0 text-blue-600" />
                  <span>
                    Retirar no <b>{r.decision?.warehouse}</b> · RM <b>{r.decision?.rm}</b>
                  </span>
                </p>
                <button
                  type="button"
                  onClick={() => act(r, 'pickup')}
                  disabled={busy === r.id}
                  className="w-full h-11 rounded-xl bg-emerald-600 text-white text-sm font-black flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" /> {busy === r.id ? 'Salvando...' : 'Retirei'}
                </button>
              </div>
            )}
            {r.status === 'Reprovado' && (
              <div className="space-y-2">
                <p className="text-xs p-2 rounded-lg bg-rose-500/10 text-rose-700 flex items-start gap-1.5">
                  <XCircle className="w-4 h-4 shrink-0" />
                  <span>Reprovado: {r.decision?.reason}</span>
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
