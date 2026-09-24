import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  CheckCircle2, 
  Clock, 
  MapPin, 
  Building2, 
  Wrench, 
  Calendar, 
  User, 
  Cpu, 
  AlertCircle,
  ExternalLink,
  ChevronRight,
  Sparkles,
  RefreshCw,
  FileCheck
} from 'lucide-react';
import { Asset, MaintenanceLog, ServiceOrder, formatDateBR } from '../types';
import { dbGetSingleAssetPublic, dbGetAssetHistoryPublic, dbGetAssetOrdersPublic } from '../db/firebase';
import { sanitizeTechnicianName, sanitizePublicNotes } from '../utils/lgpdUtils';
import { formatOrderNumber } from '../utils/orderNumber';

interface PublicAssetViewProps {
  assetIdentifier: string; // pode ser o ID único ou o código/patrimônio (ex: "AR-001" ou "168548")
  onGoToLogin?: () => void;
}

export const PublicAssetView: React.FC<PublicAssetViewProps> = ({
  assetIdentifier,
  onGoToLogin
}) => {
  const [asset, setAsset] = useState<Asset | null>(null);
  const [history, setHistory] = useState<MaintenanceLog[]>([]);
  const [linkedOrders, setLinkedOrders] = useState<ServiceOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let active = true;
    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        // Consulta segura e pontual: busca apenas e estritamente o ativo escaneado
        let found = await dbGetSingleAssetPublic(assetIdentifier);

        // Se na primeira tentativa não encontrar imediatamente (devido ao handshake inicial de rede),
        // aguarda 600ms e tenta novamente antes de dar como não localizado
        if (!found) {
          await new Promise((res) => setTimeout(res, 600));
          if (!active) return;
          found = await dbGetSingleAssetPublic(assetIdentifier);
        }

        if (!active) return;

        if (!found) {
          setError('Equipamento não encontrado ou QR Code inválido.');
          setLoading(false);
          return;
        }

        setAsset(found);

        // Busca paralela e estrita apenas dos dados deste ativo (sem baixar banco geral)
        const [hist, orders] = await Promise.all([
          dbGetAssetHistoryPublic(found.id).catch(() => []),
          dbGetAssetOrdersPublic(found.id, found.code).catch(() => [])
        ]);

        if (active) {
          const sortedHist = [...hist].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
          setHistory(sortedHist);
          setLinkedOrders(orders);
          setLoading(false);
        }
      } catch (err: any) {
        console.error('Erro ao carregar consulta pública do ativo:', err);
        if (active) {
          setError('Não foi possível carregar as informações do ativo. Verifique a conexão com a internet.');
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      active = false;
    };
  }, [assetIdentifier, retryCount]);

  // Renderização de carregamento
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 font-sans">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 text-center max-w-sm w-full space-y-4">
          <div className="w-12 h-12 border-3 border-[#3525cd] border-t-transparent rounded-full animate-spin mx-auto" />
          <div>
            <h2 className="text-base font-black text-slate-800">Carregando Ficha do Ativo</h2>
            <p className="text-xs text-slate-500 mt-1">Consultando histórico de preventivas...</p>
          </div>
        </div>
      </div>
    );
  }

  // Renderização de erro / não encontrado
  if (error || !asset) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 font-sans">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 text-center max-w-md w-full space-y-4">
          <div className="w-14 h-14 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mx-auto border border-rose-100">
            <AlertCircle className="w-8 h-8" />
          </div>
          <div>
            <h2 className="text-lg font-black text-slate-800">Ativo Não Localizado</h2>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              {error || 'Não encontramos nenhum equipamento registrado com este código de identificação.'}
            </p>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row gap-2 justify-center">
            <button
              type="button"
              onClick={() => setRetryCount((c) => c + 1)}
              className="px-5 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl font-bold text-xs uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Tentar Novamente
            </button>
            <button
              type="button"
              onClick={() => {
                window.location.href = window.location.origin;
              }}
              className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs uppercase tracking-wider transition-all cursor-pointer"
            >
              Voltar ao Início
            </button>
          </div>
        </div>
      </div>
    );
  }

  const craai = asset.specs?.craai || asset.specs?.CRAAI || '';
  const comarca = asset.specs?.comarca || asset.specs?.COMARCA || '';
  const marca = asset.specs?.manufacturer || asset.specs?.MARCA || '';
  const modelo = asset.specs?.model || asset.specs?.MODELO || '';
  const serialNumber = asset.specs?.serialNumber || asset.specs?.['Nº DE SÉRIE'] || '';
  const tipo = asset.specs?.tipo || asset.specs?.TIPO || '';

  // Última preventiva realizada
  const lastMaintenance = history.length > 0 ? history[0] : null;

  return (
    <div className="min-h-screen bg-slate-100/70 font-sans pb-12">
      {/* Barra de Topo Institucional */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20 shadow-3xs">
        <div className="max-w-2xl mx-auto px-4 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-gradient-to-br from-[#3525cd] to-indigo-800 rounded-xl flex items-center justify-center text-white font-black text-base shadow-xs">
              H
            </div>
            <div>
              <h1 className="text-xs font-black text-slate-900 tracking-tight leading-none uppercase">
                Hexon Manutenção Preventiva
              </h1>
              <span className="text-[10px] font-bold text-slate-450 uppercase tracking-wider">
                Consulta Pública de Equipamento
              </span>
            </div>
          </div>

          {onGoToLogin && (
            <button
              type="button"
              onClick={onGoToLogin}
              className="text-[11px] font-bold text-[#3525cd] hover:text-indigo-900 flex items-center gap-1 cursor-pointer bg-indigo-50/70 hover:bg-indigo-100/80 px-3 py-1.5 rounded-lg border border-indigo-150 transition-all"
            >
              <span>Acesso Técnico</span>
              <ExternalLink className="w-3 h-3" />
            </button>
          )}
        </div>
      </header>

      {/* Conteúdo Principal */}
      <main className="max-w-2xl mx-auto px-4 pt-5 space-y-4">

        {/* Banner de Conformidade LGPD & Autenticidade Pública */}
        <div className="bg-white rounded-2xl border border-indigo-150 p-4 shadow-3xs flex items-start gap-3 bg-gradient-to-r from-indigo-50/50 via-white to-indigo-50/30">
          <div className="w-9 h-9 rounded-xl bg-indigo-100 text-[#3525cd] flex items-center justify-center shrink-0 mt-0.5 border border-indigo-200">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xs font-black text-slate-850 uppercase tracking-wider">
                Ficha Pública Certificada • Conformidade LGPD
              </h2>
              <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                Lei nº 13.709/2018
              </span>
            </div>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              Consulta pública autenticada em tempo real. O histórico de manutenções é auditado e oficial. Dados pessoais de colaboradores e registros internos foram higienizados por pseudonimização.
            </p>
          </div>
        </div>
        
        {/* Cartão de Identificação do Ativo */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="font-mono text-xs font-black bg-[#3525cd] text-white px-2.5 py-0.5 rounded-md shadow-3xs">
                  PAT: {asset.code}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                  {asset.sector}
                </span>
              </div>
              <h2 className="text-base font-black text-slate-850 leading-tight">
                {asset.name}
              </h2>
            </div>

            {/* Status Operacional */}
            <div className="shrink-0">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider ${
                asset.status === 'Operando'
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : asset.status === 'Em Manutenção'
                  ? 'bg-amber-50 text-amber-850 border border-amber-200'
                  : 'bg-rose-50 text-rose-800 border border-rose-200'
              }`}>
                <span className={`w-2 h-2 rounded-full ${
                  asset.status === 'Operando' ? 'bg-emerald-500' : asset.status === 'Em Manutenção' ? 'bg-amber-500' : 'bg-rose-500'
                }`} />
                {asset.status || 'Operando'}
              </span>
            </div>
          </div>

          {/* Localização e Comarca */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-slate-100 text-xs">
            <div className="flex items-start gap-2 bg-slate-50/80 p-2.5 rounded-xl border border-slate-150">
              <MapPin className="w-4 h-4 text-[#3525cd] shrink-0 mt-0.5" />
              <div>
                <span className="text-[9px] font-black text-slate-450 uppercase tracking-wider block">Localização / Sala</span>
                <span className="font-bold text-slate-800">{asset.location || 'Não informada'}</span>
              </div>
            </div>

            <div className="flex items-start gap-2 bg-slate-50/80 p-2.5 rounded-xl border border-slate-150">
              <Building2 className="w-4 h-4 text-[#3525cd] shrink-0 mt-0.5" />
              <div>
                <span className="text-[9px] font-black text-slate-450 uppercase tracking-wider block">Comarca / Regional</span>
                <span className="font-bold text-slate-800">
                  {comarca ? `${comarca}${craai ? ` (${craai})` : ''}` : (craai || 'Regional Sede')}
                </span>
              </div>
            </div>
          </div>

          {/* Ficha Técnica Simplificada */}
          <div className="bg-slate-50/60 p-3 rounded-xl border border-slate-150 grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
            {marca && (
              <div>
                <span className="text-slate-450 font-bold block text-[9px] uppercase">Fabricante</span>
                <span className="font-extrabold text-slate-800">{marca}</span>
              </div>
            )}
            {modelo && (
              <div>
                <span className="text-slate-450 font-bold block text-[9px] uppercase">Modelo</span>
                <span className="font-extrabold text-slate-800">{modelo}</span>
              </div>
            )}
            {serialNumber && (
              <div>
                <span className="text-slate-450 font-bold block text-[9px] uppercase">Nº de Série</span>
                <span className="font-extrabold text-slate-800 font-mono">{serialNumber}</span>
              </div>
            )}
            {tipo && (
              <div>
                <span className="text-slate-450 font-bold block text-[9px] uppercase">Tipo / Categoria</span>
                <span className="font-extrabold text-slate-800">{tipo}</span>
              </div>
            )}
            {asset.periodicities && asset.periodicities.length > 0 && (
              <div className="col-span-2">
                <span className="text-slate-450 font-bold block text-[9px] uppercase">Plano de Manutenção</span>
                <span className="font-extrabold text-[#3525cd]">
                  {asset.periodicities.join(' • ')}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Resumo da Última Manutenção */}
        {lastMaintenance ? (
          <div className="bg-gradient-to-br from-emerald-50/80 to-teal-50/40 rounded-2xl border border-emerald-200/80 p-4 shadow-3xs">
            <div className="flex items-center gap-2 mb-2 text-emerald-800">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
              <h3 className="text-xs font-black uppercase tracking-wider">Última Preventiva Concluída</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <div>
                <span className="text-[9px] font-bold text-emerald-700/80 uppercase block">Data de Execução</span>
                <span className="font-black text-emerald-950 text-sm">
                  {lastMaintenance.date ? formatDateBR(lastMaintenance.date) : 'Concluída'}
                </span>
              </div>
              <div>
                <span className="text-[9px] font-bold text-emerald-700/80 uppercase block">Responsável Técnico</span>
                <span className="font-bold text-emerald-950 flex items-center gap-1 mt-0.5">
                  <User className="w-3.5 h-3.5 text-emerald-700" />
                  {sanitizeTechnicianName(lastMaintenance.technician)}
                </span>
              </div>
              <div>
                <span className="text-[9px] font-bold text-emerald-700/80 uppercase block">Resultado Técnico</span>
                <span className="font-bold text-emerald-800 flex items-center gap-1 mt-0.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  {lastMaintenance.resultStatus || 'Aprovado'}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-amber-50/70 border border-amber-200 p-4 rounded-2xl text-xs text-amber-900 flex items-center gap-3">
            <Clock className="w-5 h-5 text-amber-600 shrink-0" />
            <div>
              <p className="font-black uppercase tracking-wider text-[10px] text-amber-800">Primeira Rodada de Manutenção</p>
              <p className="text-[11px] font-medium text-amber-900/90 mt-0.5">
                Este equipamento está cadastrado e aguardando a realização de sua primeira preventiva programada.
              </p>
            </div>
          </div>
        )}

        {/* Ordens de Serviço Preventivas Vinculadas (se houver em andamento ou agendadas) */}
        {linkedOrders.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-3.5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-indigo-600" />
                <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                  Preventivas Programadas no Sistema ({linkedOrders.length})
                </h3>
              </div>
              <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">
                Ativas
              </span>
            </div>

            <div className="space-y-2.5">
              {linkedOrders.map((ord) => (
                <div
                  key={ord.id}
                  className="p-3 rounded-xl border border-slate-150 bg-slate-50/50 flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono font-black text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">
                        OS #{formatOrderNumber(ord.id)}
                      </span>
                      <span className={`text-[9.5px] font-black uppercase px-2 py-0.5 rounded-full border ${
                        ord.status === 'Concluído'
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                          : ord.status === 'Em Andamento'
                          ? 'bg-blue-50 border-blue-200 text-blue-800'
                          : 'bg-amber-50 border-amber-200 text-amber-800'
                      }`}>
                        {ord.status}
                      </span>
                    </div>
                    <p className="font-bold text-slate-850 mt-1 truncate">
                      {ord.title}
                    </p>
                    {ord.dueDate && (
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        Prazo previsto: <strong>{formatDateBR(ord.dueDate)}</strong>
                      </p>
                    )}
                  </div>

                  <div className="shrink-0 text-right">
                    <span className="text-[10px] font-medium text-slate-500 block">Técnico Encarregado</span>
                    <span className="text-[11px] font-bold text-slate-800">
                      {sanitizeTechnicianName(ord.assignedTechnician)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Histórico Completo de Manutenções */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Wrench className="w-4 h-4 text-[#3525cd]" />
              <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                Histórico de Preventivas ({history.length})
              </h3>
            </div>
            <span className="text-[10px] font-bold text-slate-450 uppercase">
              Ordenado por data
            </span>
          </div>

          {history.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              <Clock className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-xs font-bold text-slate-600">Nenhum registro anterior encontrado</p>
              <p className="text-[11px] text-slate-450 mt-0.5">
                Os registros aparecerão aqui conforme as ordens de serviço forem concluídas e assinadas pelos técnicos.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((log) => (
                <div
                  key={log.id}
                  className="p-3.5 rounded-xl border border-slate-150 hover:border-slate-300 transition-all bg-slate-50/40 space-y-2.5"
                >
                  {/* Linha 1: Título da OS e Data */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="text-xs font-bold text-slate-850">
                        {log.osTitle || 'Manutenção Preventiva Periódica'}
                      </h4>
                      {log.preventiveType && (
                        <span className="text-[9.5px] font-black text-[#3525cd] bg-indigo-50 border border-indigo-150 px-2 py-0.5 rounded-md inline-block mt-1">
                          Ciclo: {log.preventiveType}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] font-black text-slate-700 shrink-0 flex items-center gap-1 bg-white px-2 py-1 rounded-md border border-slate-200">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      {formatDateBR(log.date)}
                    </span>
                  </div>

                  {/* Linha 2: Técnico e Status */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-2 border-t border-slate-150/70">
                    <div className="flex items-center gap-1.5 text-slate-650">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-[11px] font-semibold">
                        Técnico: <strong className="text-slate-800">{sanitizeTechnicianName(log.technician)}</strong>
                      </span>
                    </div>

                    <div className="flex items-center gap-1 text-[11px]">
                      <span className="text-emerald-700 font-black flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        {log.resultStatus || 'Concluído'}
                      </span>
                    </div>
                  </div>

                  {/* Linha 3: Observações se existirem */}
                  {log.notes && (
                    <div className="text-[11px] bg-white p-2 rounded-lg border border-slate-200 text-slate-600 italic">
                      "{sanitizePublicNotes(log.notes)}"
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Rodapé Informativo e Selo de Autenticidade Digital */}
        <footer className="text-center text-[10px] text-slate-500 space-y-2 pt-4 pb-2 border-t border-slate-200">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-600 font-mono text-[10px] font-medium">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>Autenticação Digital: HEXON-{asset.code}-{asset.id.slice(0, 8).toUpperCase()}</span>
          </div>
          <p className="text-slate-450">
            Informações geradas pelo sistema Hexon Manutenção Preventiva.
          </p>
          <p className="text-slate-400 text-[9.5px]">
            © {new Date().getFullYear()} • Ficha Pública Certificada LGPD • Todos os direitos reservados.
          </p>
        </footer>
      </main>
    </div>
  );
};

export default PublicAssetView;
