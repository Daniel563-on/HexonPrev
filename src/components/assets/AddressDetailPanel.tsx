import React, { useEffect, useState } from 'react';
import { ChevronLeft, MapPin, History, FileSearch, Loader2 } from 'lucide-react';
import { Asset, ServiceOrder, formatDateBR } from '../../types';
import { dbGetAddressVistorias } from '../../db/firebase';
import { formatOrderNumber } from '../../utils/orderNumber';

// FICHA DO ENDEREÇO (IMÓVEL): identificação do local e o histórico das vistorias feitas nele.
// Os dados vêm do cadastro de Endereços; para alterar, use a tela Endereços (Super Administrador).
export interface AddressDetailPanelProps {
  asset: Asset; // item "Imóvel" montado a partir do cadastro de Endereços
  onBackToList: () => void;
  onViewOrder?: (orderId: string) => void;
}

const statusClass: Record<string, string> = {
  Concluída: 'bg-emerald-100 text-emerald-800',
  'Não Executada': 'bg-rose-100 text-rose-800',
  Cancelada: 'bg-slate-200 text-slate-600',
  Atrasada: 'bg-amber-100 text-amber-800'
};

export const AddressDetailPanel: React.FC<AddressDetailPanelProps> = ({ asset, onBackToList, onViewOrder }) => {
  const [vistorias, setVistorias] = useState<ServiceOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    dbGetAddressVistorias(asset.addressId || '')
      .then((list) => alive && setVistorias(list))
      .catch((err) => console.error('Erro ao carregar as vistorias do endereço:', err))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [asset.addressId]);

  const active = asset.status !== 'Baixado';
  const count = (s: ServiceOrder['status']) => vistorias.filter((o) => o.status === s).length;
  const open = vistorias.filter((o) => ['Novo', 'Planejada', 'Em Execução', 'Atrasada'].includes(o.status)).length;
  const pendingRequests = vistorias.filter((o) => o.solicitationStatus === 'Pendente').length;

  return (
    <div className="space-y-4 font-sans">
      <button
        type="button"
        onClick={onBackToList}
        className="text-xs font-bold text-slate-600 hover:text-[#3525cd] flex items-center gap-1 cursor-pointer"
      >
        <ChevronLeft className="w-4 h-4" /> Voltar à lista
      </button>

      {/* Identificação */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2.5 bg-indigo-50 text-[#3525cd] rounded-xl border border-indigo-100">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-indigo-700">Imóvel / Endereço · {asset.sector}</p>
              <h2 className="text-lg font-black text-[#0b1c30]">{asset.name}</h2>
              <p className="text-xs text-slate-500 font-mono font-bold">{asset.code}</p>
            </div>
          </div>
          <span
            className={`self-start px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${
              active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
            }`}
          >
            {active ? 'Ativo' : 'Inativo'}
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-xs">
          <div>
            <p className="text-[10px] font-black uppercase text-slate-400">CRAAI</p>
            <p className="font-bold text-slate-800">{asset.specs?.CRAAI || '-'}</p>
          </div>
          <div>
            <p className="text-[10px] font-black uppercase text-slate-400">Comarca</p>
            <p className="font-bold text-slate-800">{asset.specs?.COMARCA || '-'}</p>
          </div>
          <div>
            <p className="text-[10px] font-black uppercase text-slate-400">Vistorias em aberto</p>
            <p className="font-bold text-slate-800">{loading ? '...' : open}</p>
          </div>
          <div>
            <p className="text-[10px] font-black uppercase text-slate-400">Solicitações pendentes</p>
            <p className={`font-bold ${pendingRequests > 0 ? 'text-rose-700' : 'text-slate-800'}`}>{loading ? '...' : pendingRequests}</p>
          </div>
        </div>
        {!active && (
          <p className="mt-3 text-[11px] font-bold text-slate-500">Endereço inativo: não recebe novas rondas. O histórico continua guardado.</p>
        )}
      </div>

      {/* Histórico das vistorias */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-gray-200 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-black uppercase text-[#0b1c30] flex items-center gap-2">
            <History className="w-4 h-4 text-[#3525cd]" /> Histórico de vistorias
          </h3>
          {!loading && (
            <span className="text-[11px] font-bold text-slate-500">
              {vistorias.length} vistoria(s) · {count('Concluída')} concluída(s) · {count('Não Executada')} não executada(s)
            </span>
          )}
        </div>
        {loading ? (
          <p className="p-8 text-center text-xs font-bold text-slate-400 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando vistorias...
          </p>
        ) : vistorias.length === 0 ? (
          <p className="p-8 text-center text-xs text-slate-400 italic">Nenhuma vistoria registrada para este endereço.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-100 text-[10px] uppercase tracking-wider text-slate-600">
                  <th className="py-2.5 px-4">OS</th>
                  <th className="py-2.5 px-4">Vistoria</th>
                  <th className="py-2.5 px-4">Período</th>
                  <th className="py-2.5 px-4">Técnico</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {vistorias.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono font-bold text-indigo-700 whitespace-nowrap">#{formatOrderNumber(o.id)}</td>
                    <td className="py-2.5 px-4 font-bold text-slate-800">{o.title}</td>
                    <td className="py-2.5 px-4 text-slate-600 whitespace-nowrap">
                      {o.startDate ? formatDateBR(o.startDate) : '-'} a {o.endDate ? formatDateBR(o.endDate) : '-'}
                    </td>
                    <td className="py-2.5 px-4 text-slate-600">{o.assignedTechnician || '-'}</td>
                    <td className="py-2.5 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${statusClass[o.status] || 'bg-indigo-50 text-indigo-700'}`}>
                        {o.status}
                      </span>
                      {o.solicitationStatus === 'Pendente' && (
                        <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-700">Solicitação</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      {onViewOrder && (
                        <button
                          type="button"
                          onClick={() => onViewOrder(o.id)}
                          className="py-1 px-2 bg-indigo-50 border border-indigo-200 text-[10px] font-black text-indigo-700 rounded-lg inline-flex items-center gap-1 cursor-pointer"
                        >
                          <FileSearch className="w-3 h-3" /> VER OS
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
