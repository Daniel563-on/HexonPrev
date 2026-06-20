import React, { useState, useEffect, useRef } from 'react';
import { 
  Accessibility, 
  Volume2, 
  VolumeX, 
  ZoomIn, 
  ZoomOut, 
  Check, 
  RotateCcw, 
  Eye, 
  X, 
  HelpCircle,
  Sparkles
} from 'lucide-react';
import { ServiceOrder } from '../types';

interface AccessibilityPanelProps {
  fontScale: number;
  setFontScale: React.Dispatch<React.SetStateAction<number>>;
  highContrast: boolean;
  setHighContrast: React.Dispatch<React.SetStateAction<boolean>>;
  daltonism: string;
  setDaltonism: (val: string) => void;
  currentTab: string;
  orders: ServiceOrder[];
}

export default function AccessibilityPanel({
  fontScale,
  setFontScale,
  highContrast,
  setHighContrast,
  daltonism,
  setDaltonism,
  currentTab,
  orders
}: AccessibilityPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close panel on pressing Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleToggle = () => {
    setIsOpen(!isOpen);
  };

  // Adjust font scale methods
  const increaseFont = () => {
    setFontScale(prev => Math.min(1.4, parseFloat((prev + 0.1).toFixed(2))));
  };

  const decreaseFont = () => {
    setFontScale(prev => Math.max(0.8, parseFloat((prev - 0.1).toFixed(2))));
  };

  const resetFont = () => {
    setFontScale(1.0);
  };

  // Speech helper: Text-To-Speech (SpeechSynthesis)
  const speakText = (text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    // Stop speaking if currently active
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'pt-BR';
    utterance.rate = 1.0;

    utterance.onend = () => {
      setIsSpeaking(false);
    };

    utterance.onerror = () => {
      setIsSpeaking(false);
    };

    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  // Cancel any active speaking when tab changes
  useEffect(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  }, [currentTab]);

  // Compile screen summaries for Portugal / Brazil voice synthesiser
  const handleHearScreen = () => {
    let summaryText = '';

    const pendingOrdersCount = orders.filter(o => o.status === 'Novo' || o.status === 'Planejada' || o.status === 'Em Execução').length;
    const completedOrdersCount = orders.filter(o => o.status === 'Concluída').length;

    switch (currentTab) {
      case 'dashboard': {
        const hvacOrders = orders.filter(o => {
          const s = (o.sector || '').toUpperCase();
          return s.includes('HVAC') || s.includes('MEC') || s.includes('REFR') || s.includes('AR');
        });
        const electOrders = orders.filter(o => {
          const s = (o.sector || '').toUpperCase();
          return s.includes('ELET') || s.includes('SUBST') || s.includes('FOR');
        });
        const civilOrders = orders.length - (hvacOrders.length + electOrders.length);

        summaryText = `Você está na seção do Centro de Controle Gerencial das Preventivas Hexon. O painel indica um total de ${orders.length} ordens de serviço preventivas registradas. Destas, ${completedOrdersCount} foram concluídas e as restantes estão em execução técnica ou aguardando planejamento. Na divisão de diretoria, a Gestão de Manutenção Mecânica e Refrigeração conta com ${hvacOrders.length} ordens. A Gestão de Elétrica e Eletrônica conta com ${electOrders.length} ordens, e a Gestão Civil, Predial e Geral conta com ${civilOrders} preventivas ativas.`;
        break;
      }
      case 'service-orders': {
        summaryText = `Você está no módulo de Ordens de Serviço Preventivas. Há um painel de alocação de equipes e programação de preventivas de campo. Atualmente, existem ${pendingOrdersCount} ordens de serviço pendentes de execução. Você pode criar novas ordens de serviço preventiva, planejar suas datas, delegar técnicos e acompanhar a coluna Kanban de ordens planejadas, em execução e concluídas.`;
        break;
      }
      case 'assets': {
        summaryText = `Você está visualizando a aba de Gestão de Ativos Operacionais. Esta tela exibe a árvore de locais de instalação física, bem como os equipamentos cadastrados no sistema, como Chillers, Compressores e Geradores. Cada ativo possui código de identificação QR, etiquetas e o histórico completo de preventivas de campo associadas.`;
        break;
      }
      case 'templates': {
        summaryText = `Você abriu o Módulo de Templates e Lotes Preventivos. Este painel permite criar planos de manutenção recorrentes para ativos específicos, definindo periodicidade como semanal, mensal ou anual. Também viabiliza a geração de preventivas assistidas por algoritmos automatizados em lote de forma sequencial.`;
        break;
      }
      case 'solicitations': {
        summaryText = `Você carregou o canhão do Módulo de Solicitações e Manutenções Corretivas. Nele, gestores podem receber avisos de anomalia, abrir corretivas emergenciais e vincular ordens de serviço de reparação imediata aos ativos em campo.`;
        break;
      }
      case 'user-control': {
        summaryText = `Você está na área de configuração de Controle de Usuários e Permissões do Sistema. É possível gerenciar as permissões e o perfil funcional de cada colaborador da manutenção Hexon.`;
        break;
      }
      default:
        summaryText = `Bem-vindo ao sistema de Manutenção Preventiva Hexon. Use o menu de navegação lateral para interagir com o Dashboard, Ordens de Serviço, Ativos de Campo, Templates e Solicitações Corretivas.`;
    }

    speakText(summaryText);
  };

  return (
    <>
      {/* Hidden Colorblind Correction Filters SVG */}
      <svg className="absolute w-0 h-0 block pointer-events-none select-none invisible" aria-hidden="true">
        <defs>
          <filter id="protanopia-filter">
            <feColorMatrix type="matrix" values="
              0.567, 0.433, 0.000, 0.000, 0.000
              0.558, 0.442, 0.000, 0.000, 0.000
              0.000, 0.242, 0.758, 0.000, 0.000
              0.000, 0.000, 0.000, 1.000, 0.000" />
          </filter>
          <filter id="deuteranopia-filter">
            <feColorMatrix type="matrix" values="
              0.625, 0.375, 0.000, 0.000, 0.000
              0.700, 0.300, 0.000, 0.000, 0.000
              0.000, 0.300, 0.700, 0.000, 0.000
              0.000, 0.000, 0.000, 1.000, 0.000" />
          </filter>
          <filter id="tritanopia-filter">
            <feColorMatrix type="matrix" values="
              0.950, 0.050, 0.000, 0.000, 0.000
              0.000, 0.433, 0.567, 0.000, 0.000
              0.000, 0.475, 0.525, 0.000, 0.000
              0.000, 0.000, 0.000, 1.000, 0.000" />
          </filter>
        </defs>
      </svg>

      {/* Header-Integrated Accessibility Trigger Button & Dropdown */}
      <div className="relative inline-block text-left font-sans z-[50]">
        <button
          ref={triggerRef}
          onClick={handleToggle}
          className={`w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-slate-800/60 transition-all border hover:scale-105 active:scale-95 cursor-pointer relative ${
            isOpen || highContrast || (daltonism && daltonism !== 'none') || fontScale !== 1
              ? 'bg-[#3525cd]/10 text-[#3525cd] dark:text-[#c3c0ff] border-[#3525cd]/30' 
              : 'text-gray-600 dark:text-gray-300 border-gray-100 dark:border-slate-800/60'
          }`}
          aria-haspopup="true"
          aria-expanded={isOpen}
          aria-label="Acessibilidade e Ajustes de Tela"
          title="Painel de Acessibilidade Hexon"
          id="accessibility-header-btn"
        >
          <Accessibility className={`w-5 h-5 ${isOpen ? 'animate-spin-slow' : ''}`} />
          {/* Subtle indicator dot if accessibility is active */}
          {(highContrast || (daltonism && daltonism !== 'none') || fontScale !== 1) && (
            <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-indigo-650 dark:bg-indigo-400 border border-white dark:border-slate-900 rounded-full" />
          )}
        </button>

        {/* Accessibility Flyout Panel */}
        {isOpen && (
          <div
            ref={panelRef}
            className="absolute top-12 right-0 w-80 bg-white dark:bg-[#0b1c30] border border-gray-200 dark:border-slate-800 rounded-2xl shadow-2xl p-5 overflow-hidden animate-in slide-in-from-top-2 duration-200 text-slate-800 dark:text-slate-100 origin-top-right z-50"
            role="dialog"
            aria-modal="true"
            aria-label="Opções de Acessibilidade"
          >
            {/* Header */}
            <div className="flex justify-between items-center pb-3 border-b border-gray-150 dark:border-slate-850">
              <div className="flex items-center gap-2">
                <Accessibility className="w-5 h-5 text-[#3525cd] dark:text-[#c3c0ff]" />
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-white">
                  Acessibilidade
                </h3>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
                aria-label="Fechar painel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content Controls space */}
            <div className="space-y-4 pt-4 text-xs font-sans">
              
              {/* 1. TEXT SCALE (A+/A-) */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-extrabold text-slate-700 dark:text-slate-300">Tamanho da Fonte</span>
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                    {Math.round(fontScale * 100)}%
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={decreaseFont}
                    className="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg flex items-center justify-center gap-1 font-bold border border-transparent dark:border-slate-700 cursor-pointer"
                    title="Diminuir fonte em 10%"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                    <span>A-</span>
                  </button>
                  <button
                    onClick={resetFont}
                    className="py-1.5 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg flex items-center justify-center gap-1 font-bold border border-transparent dark:border-slate-700 cursor-pointer text-slate-500 hover:text-slate-700"
                    title="Restaurar tamanho padrão"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={increaseFont}
                    className="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg flex items-center justify-center gap-1 font-bold border border-transparent dark:border-slate-700 cursor-pointer"
                    title="Aumentar fonte em 10%"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                    <span>A+</span>
                  </button>
                </div>
              </div>

              {/* 2. HIGH CONTRAST */}
              <div className="space-y-2">
                <span className="font-extrabold text-slate-700 dark:text-slate-300 block">Alto Contraste</span>
                <div className="space-y-2">
                  {/* Strict High Contrast Mode (WCAG) */}
                  <label className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-150 dark:border-slate-850 cursor-pointer hover:bg-slate-100 hover:dark:bg-slate-850 transition-colors">
                    <span className="font-bold text-slate-700 dark:text-slate-300">Alto Contraste Extremo</span>
                    <input
                      type="checkbox"
                      checked={highContrast}
                      onChange={(e) => setHighContrast(e.target.checked)}
                      className="w-4 h-4 rounded text-[#3525cd] focus:ring-[#3525cd] focus:ring-offset-0 cursor-pointer"
                    />
                  </label>
                </div>
              </div>

              {/* 3. DALTONISM COLOR FILTERS */}
              <div className="space-y-2">
                <div className="flex items-center gap-1">
                  <Eye className="w-4 h-4 text-slate-400" />
                  <span className="font-extrabold text-slate-700 dark:text-slate-300">Filtros para Daltonismo</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                  {[
                    { value: 'none', label: 'Nenhum' },
                    { value: 'protanopia', label: 'Protanopia (Red)' },
                    { value: 'deuteranopia', label: 'Deuteranopia (Green)' },
                    { value: 'tritanopia', label: 'Tritanopia (Blue)' }
                  ].map((filter) => (
                    <button
                      key={filter.value}
                      onClick={() => setDaltonism(filter.value)}
                      className={`py-1.5 px-2 rounded-lg border text-left font-black transition-all flex items-center justify-between cursor-pointer ${
                        daltonism === filter.value
                          ? 'bg-[#3525cd]/10 border-[#3525cd] text-[#3525cd] dark:text-[#c3c0ff] dark:border-[#9c95ff]'
                          : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 hover:dark:bg-slate-850'
                      }`}
                    >
                      <span className="truncate">{filter.label}</span>
                      {daltonism === filter.value && <Check className="w-3.5 h-3.5 shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* 4. TEXT TO SPEECH (NATIVE NARRATOR) */}
              <div className="space-y-2">
                <span className="font-extrabold text-slate-700 dark:text-slate-300 block">Sintetizador de Voz Nativo</span>
                <button
                  onClick={handleHearScreen}
                  className={`w-full py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 font-black uppercase text-[10px] tracking-wider border transition-all ${
                    isSpeaking 
                      ? 'bg-rose-50 text-rose-600 border-rose-300 hover:bg-rose-100 hover:text-rose-700 dark:bg-rose-950/20 dark:border-rose-900'
                      : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 hover:text-emerald-800 dark:bg-[#10b981]/10 dark:text-[#10b981] dark:border-[#10b981]/20'
                  }`}
                  title={isSpeaking ? 'Parar narração de voz' : 'Narrar dados desta aba em português'}
                >
                  {isSpeaking ? (
                    <>
                      <VolumeX className="w-4 h-4 animate-bounce" />
                      <span>Parar Leitura</span>
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-4 h-4" />
                      <span>Ouvir Resumo da Tela</span>
                    </>
                  )}
                </button>
              </div>

              {/* Tips */}
              <div className="pt-3 border-t border-gray-150 dark:border-slate-850 flex items-start gap-1.5 text-[9px] text-slate-400 leading-relaxed">
                <HelpCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
                <p>
                  <strong>Navegação física por teclado habilitada:</strong> Pressione <strong className="text-slate-500">TAB</strong> para alternar focos no sistema e <strong className="text-slate-500">ENTER</strong> para confirmar.
                </p>
              </div>

            </div>
          </div>
        )}
      </div>
    </>
  );
}
