import React, { useState } from 'react';
import { 
  AlertTriangle, 
  X, 
  Camera, 
  Trash2, 
  Wrench, 
  CheckCircle2, 
  Loader2 
} from 'lucide-react';
import { Asset, HexonUser, ServiceOrder } from '../../types';
import { dbSaveServiceOrder } from '../../db/firebase';

interface QuickCorrectiveModalProps {
  isOpen: boolean;
  asset: Asset;
  userProfile: HexonUser;
  onClose: () => void;
  onSuccess: (newOrder: ServiceOrder) => void;
  darkMode?: boolean;
}

const PRESET_ISSUES = [
  'Vazamento de Água / Óleo',
  'Ruído Anormal / Vibração Excessiva',
  'Superaquecimento',
  'Falha Elétrica / Desarme de Disjuntor',
  'Parada Total do Equipamento',
  'Filtro Saturado / Obstrução de Fluxo',
  'Dano Físico / Desgaste Acentuado'
];

export default function QuickCorrectiveModal({
  isOpen,
  asset,
  userProfile,
  onClose,
  onSuccess,
  darkMode = false
}: QuickCorrectiveModalProps) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<'Baixa' | 'Média' | 'Alta' | 'Urgente'>('Alta');
  const [description, setDescription] = useState('');
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check size limit: max 4MB
    if (file.size > 4 * 1024 * 1024) {
      setErrorMsg('A foto selecionada é muito pesada. O limite máximo é de 4MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setPhotoBase64(reader.result as string);
      setErrorMsg(null);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMsg('Por favor, informe o motivo ou título do chamado.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const now = new Date();
      const generatedId = `OS-C${Date.now().toString().slice(-6)}`;
      const dateStr = now.toISOString().split('T')[0];

      const newOrder: ServiceOrder = {
        id: generatedId,
        assetId: asset.id,
        assetName: asset.name,
        assetCode: asset.code,
        sector: asset.sector || userProfile.gerencia || 'Geral',
        title: title.trim(),
        description: description.trim() || `Chamado corretivo de campo aberto para o equipamento ${asset.name} (${asset.code}).`,
        priority,
        status: 'Novo',
        scheduledDate: dateStr,
        assignedTechnician: userProfile.name || 'Equipe Técnica',
        checklist: [],
        notes: `Chamado corretivo emergencial registrado via Mobile por ${userProfile.name} (Matrícula: ${userProfile.matricula || 'N/A'}).`,
        signature: null,
        signedBy: null,
        signedAt: null,
        photoEvidence: photoBase64,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      };

      await dbSaveServiceOrder(newOrder);
      onSuccess(newOrder);
    } catch (err: any) {
      console.error('Falha ao salvar chamado corretivo mobile:', err);
      setErrorMsg('Não foi possível gravar o chamado no banco de dados. Tente novamente.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-slate-950/70 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4 font-sans animate-in fade-in duration-200">
      
      {/* Background touch dismiss */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Modal Surface */}
      <div className={`relative w-full max-w-lg rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden z-10 border transition-all ${
        darkMode ? 'bg-[#0E1726] border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
      }`}>

        {/* Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-rose-600 to-amber-600 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm sm:text-base leading-tight">
                Novo Chamado Corretivo
              </h3>
              <p className="text-[11px] text-white/80 font-medium">
                Relato de Campo Imediato
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-black/10 hover:bg-black/20 flex items-center justify-center transition-colors text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Asset summary bar */}
        <div className={`px-4 py-2.5 border-b text-xs flex items-center justify-between gap-2 shrink-0 ${
          darkMode ? 'bg-slate-900/80 border-slate-800 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'
        }`}>
          <div className="flex items-center gap-1.5 truncate">
            <Wrench className="w-3.5 h-3.5 text-rose-500 shrink-0" />
            <span className="font-bold truncate">{asset.name}</span>
            <span className="font-mono text-[10px] text-slate-400 font-bold">({asset.code})</span>
          </div>
          <span className="text-[10px] uppercase font-black px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 shrink-0">
            {asset.sector}
          </span>
        </div>

        {/* Scrollable Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs font-bold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Quick Preset Buttons */}
          <div>
            <label className="block text-[11px] font-black uppercase tracking-wider text-slate-400 mb-1.5">
              Sugestões Rápidas de Ocorrência
            </label>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_ISSUES.map(preset => (
                <button
                  type="button"
                  key={preset}
                  onClick={() => setTitle(preset)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all text-left ${
                    title === preset
                      ? 'bg-rose-600 border-rose-600 text-white shadow-xs'
                      : darkMode
                      ? 'bg-slate-800/80 border-slate-700 text-slate-300 hover:border-slate-600'
                      : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          {/* Title Input */}
          <div>
            <label className="block text-[11px] font-black uppercase tracking-wider text-slate-400 mb-1">
              Título / Motivo Principal *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Motor fazendo ruído metálico grave"
              className={`w-full text-xs p-3 rounded-xl border font-bold transition-colors outline-hidden ${
                darkMode
                  ? 'bg-slate-900 border-slate-700 text-white focus:border-rose-500'
                  : 'bg-slate-50 border-slate-200 text-slate-900 focus:border-rose-500'
              }`}
              required
            />
          </div>

          {/* Priority selector */}
          <div>
            <label className="block text-[11px] font-black uppercase tracking-wider text-slate-400 mb-1.5">
              Gravidade / Prioridade
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {(['Baixa', 'Média', 'Alta', 'Urgente'] as const).map(p => {
                const isSelected = priority === p;
                let activeColor = 'bg-slate-600 text-white';
                if (p === 'Baixa') activeColor = 'bg-blue-600 text-white';
                if (p === 'Média') activeColor = 'bg-amber-600 text-white';
                if (p === 'Alta') activeColor = 'bg-orange-600 text-white';
                if (p === 'Urgente') activeColor = 'bg-rose-600 text-white';

                return (
                  <button
                    type="button"
                    key={p}
                    onClick={() => setPriority(p)}
                    className={`min-h-[44px] py-2 rounded-xl text-xs font-black uppercase tracking-wider border transition-all flex items-center justify-center ${
                      isSelected
                        ? `${activeColor} shadow-md scale-102`
                        : darkMode
                        ? 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-[11px] font-black uppercase tracking-wider text-slate-400 mb-1">
              Descrição Detalhada do Problema
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descreva o que foi observado no local, peças afetadas, vazamentos ou sintomas..."
              className={`w-full text-xs p-3 rounded-xl border transition-colors outline-hidden resize-none ${
                darkMode
                  ? 'bg-slate-900 border-slate-700 text-white focus:border-rose-500'
                  : 'bg-slate-50 border-slate-200 text-slate-900 focus:border-rose-500'
              }`}
            />
          </div>

          {/* Photo Evidence Capture */}
          <div>
            <label className="block text-[11px] font-black uppercase tracking-wider text-slate-400 mb-1.5">
              Evidência Fotográfica (Câmera do Celular)
            </label>
            
            {photoBase64 ? (
              <div className="relative rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 group">
                <img
                  src={photoBase64}
                  alt="Evidência"
                  className="w-full h-44 object-cover"
                />
                <button
                  type="button"
                  onClick={() => setPhotoBase64(null)}
                  className="absolute top-2 right-2 p-2 rounded-xl bg-rose-600 text-white shadow-lg hover:bg-rose-700 transition-colors flex items-center gap-1 text-xs font-bold"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Remover</span>
                </button>
              </div>
            ) : (
              <label className={`w-full min-h-[50px] p-4 rounded-2xl border-2 border-dashed flex items-center justify-center gap-3 cursor-pointer transition-colors ${
                darkMode
                  ? 'border-slate-700 hover:border-rose-500 bg-slate-900/50 hover:bg-slate-900'
                  : 'border-slate-200 hover:border-rose-400 bg-slate-50 hover:bg-rose-50/20'
              }`}>
                <Camera className="w-5 h-5 text-rose-500" />
                <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                  Tirar Foto com a Câmera ou Galeria
                </span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoCapture}
                  className="hidden"
                />
              </label>
            )}
          </div>

          {/* Submit Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full min-h-[50px] rounded-2xl bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-700 hover:to-amber-700 text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg shadow-rose-600/25 active:scale-98 transition-all disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Registrando Chamado...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5" />
                  <span>Registrar Chamado Corretivo</span>
                </>
              )}
            </button>
          </div>

        </form>

      </div>
    </div>
  );
}
