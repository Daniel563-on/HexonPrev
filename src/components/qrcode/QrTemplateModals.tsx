import React from 'react';
import {
  Save,
  X,
  AlertTriangle,
  Loader2,
  Database,
  Trash2,
  Layers
} from 'lucide-react';
import { SavedQrTemplate } from '../../types';

export interface QrTemplateModalsProps {
  // Modal Salvar Novo Modelo
  showSaveModal: boolean;
  onCloseSaveModal: () => void;
  newTemplateName: string;
  setNewTemplateName: (name: string) => void;
  saveModalError: string;
  setSaveModalError: (err: string) => void;
  isSavingTemplate: boolean;
  onSaveCurrentAsNewTemplate: () => void;

  // Modal Confirmar Exclusão
  templateToDelete: SavedQrTemplate | null;
  onCloseDeleteModal: () => void;
  isDeletingTemplate: boolean;
  onConfirmDeleteTemplate: () => void;
  totalSavedTemplatesCount: number;

  // Modal Gerenciar Todos os Modelos Salvos
  showManageTemplatesModal: boolean;
  onCloseManageTemplatesModal: () => void;
  savedTemplates: SavedQrTemplate[];
  selectedTemplateId: string;
  onLoadTemplate: (id: string, name: string) => void;
  onDeleteTemplateById: (id: string, e?: React.MouseEvent) => void;
}

export default function QrTemplateModals({
  showSaveModal,
  onCloseSaveModal,
  newTemplateName,
  setNewTemplateName,
  saveModalError,
  setSaveModalError,
  isSavingTemplate,
  onSaveCurrentAsNewTemplate,
  templateToDelete,
  onCloseDeleteModal,
  isDeletingTemplate,
  onConfirmDeleteTemplate,
  totalSavedTemplatesCount,
  showManageTemplatesModal,
  onCloseManageTemplatesModal,
  savedTemplates,
  selectedTemplateId,
  onLoadTemplate,
  onDeleteTemplateById
}: QrTemplateModalsProps) {
  return (
    <>
      {/* MODAL: SALVAR NOVO MODELO */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs z-[9999] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Save className="w-5 h-5 text-emerald-600" />
                <h3 className="text-base font-extrabold uppercase tracking-tight">Salvar Modelo de Etiqueta</h3>
              </div>
              <button
                onClick={onCloseSaveModal}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              Todas as margens em milímetros, medidas da folha, formato (A4/A3), bordas, cores e tipografias individuais dos campos serão salvas para você carregar sempre que precisar.
            </p>

            {saveModalError && (
              <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs font-bold text-rose-600 dark:text-rose-400 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{saveModalError}</span>
              </div>
            )}

            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1 font-mono">Nome do Modelo</label>
              <input
                type="text"
                value={newTemplateName}
                onChange={(e) => {
                  setNewTemplateName(e.target.value);
                  if (saveModalError) setSaveModalError('');
                }}
                placeholder="Ex: Plaqueta Metálica Roxa 100x50"
                className="w-full px-3 py-2 text-xs rounded-xl border bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                autoFocus
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={isSavingTemplate}
                onClick={onCloseSaveModal}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isSavingTemplate}
                onClick={onSaveCurrentAsNewTemplate}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-black tracking-wider flex items-center gap-1.5 shadow-sm cursor-pointer disabled:cursor-not-allowed"
              >
                {isSavingTemplate ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Salvando no Banco...
                  </>
                ) : (
                  <>
                    <Database className="w-4 h-4" />
                    Salvar no Banco de Dados
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CONFIRMAR EXCLUSÃO DE MODELO */}
      {templateToDelete && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs z-[9999] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-start gap-3">
              <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900/60 shrink-0">
                <Trash2 className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-extrabold tracking-tight text-slate-900 dark:text-white">Excluir Modelo do Banco</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Tem certeza que deseja excluir o modelo <strong className="text-slate-800 dark:text-slate-200 font-bold">"{templateToDelete.name}"</strong> do banco de dados na nuvem?
                </p>
                {totalSavedTemplatesCount <= 1 && (
                  <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 p-2.5 rounded-xl mt-2">
                    Aviso: Como este é o único modelo cadastrado, o sistema reinicializará os padrões originais de fábrica para que você continue usando o editor normalmente.
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                disabled={isDeletingTemplate}
                onClick={onCloseDeleteModal}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isDeletingTemplate}
                onClick={onConfirmDeleteTemplate}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-xl text-xs font-black tracking-wider flex items-center gap-1.5 shadow-sm cursor-pointer transition-colors active:scale-[0.98] disabled:cursor-not-allowed"
              >
                {isDeletingTemplate ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Excluindo do Banco...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Sim, Excluir do Banco
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: GERENCIAR TODOS OS MODELOS SALVOS */}
      {showManageTemplatesModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs z-[9998] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-xl w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 flex flex-col max-h-[85vh]">
            <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/60">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-white">Gerenciar Modelos Salvos</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Selecione um modelo para carregar no editor ou exclua modelos que não utiliza mais.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onCloseManageTemplatesModal}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 space-y-3">
              {savedTemplates.map((tpl) => {
                const isCurrent = tpl.id === selectedTemplateId;
                const labelCount = tpl.sheet.columns * tpl.sheet.rows;
                return (
                  <div
                    key={tpl.id}
                    className={`pt-3 first:pt-0 flex items-center justify-between gap-3 p-3 rounded-xl transition-all ${
                      isCurrent
                        ? 'bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/80'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 border border-transparent'
                    }`}
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-slate-900 dark:text-white truncate">
                          {tpl.name}
                        </span>
                        {isCurrent && (
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-indigo-600 text-white shrink-0">
                            Ativo
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                        <span>{tpl.sheet.paperType} ({tpl.sheet.pageWidthMm}×{tpl.sheet.pageHeightMm}mm)</span>
                        <span>•</span>
                        <span>{labelCount} etiq./folha ({tpl.sheet.labelWidthMm}×{tpl.sheet.labelHeightMm}mm)</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {!isCurrent && (
                        <button
                          type="button"
                          onClick={() => {
                            onLoadTemplate(tpl.id, tpl.name);
                            onCloseManageTemplatesModal();
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100/60 dark:hover:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 transition-colors cursor-pointer"
                        >
                          Carregar
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteTemplateById(tpl.id, e);
                        }}
                        title="Excluir este modelo"
                        className="p-1.5 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/60 border border-rose-200 dark:border-rose-900/60 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={onCloseManageTemplatesModal}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
