/**
 * LoadWorkspaceModal — Phase 5. List workspaces from GET /api/datahub/workspaces, select one to apply.
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from '@nekazari/sdk';
import { X } from 'lucide-react';
import { listWorkspaces, type DataHubWorkspaceStored } from '../services/datahubApi';

export interface LoadWorkspaceModalProps {
  onSelect: (workspace: DataHubWorkspaceStored) => void;
  onClose: () => void;
}

export const LoadWorkspaceModal: React.FC<LoadWorkspaceModalProps> = ({ onSelect, onClose }) => {
  const { t } = useTranslation('datahub');
  const [workspaces, setWorkspaces] = useState<DataHubWorkspaceStored[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listWorkspaces()
      .then((list) => {
        if (!cancelled) setWorkspaces(list);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="load-workspace-title"
    >
      <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
        <div className="flex justify-between items-center p-4 border-b border-slate-700">
          <h2 id="load-workspace-title" className="text-sm font-semibold text-slate-200">
            {t('loadWorkspace.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1"
            aria-label={t('loadWorkspace.close')}
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-4 overflow-y-auto flex-1 min-h-0">
          {loading && (
            <p className="text-slate-400 text-sm">{t('loadWorkspace.loading')}</p>
          )}
          {error && (
            <p className="text-red-400 text-sm" role="alert">{error}</p>
          )}
          {!loading && !error && workspaces.length === 0 && (
            <p className="text-slate-400 text-sm">{t('loadWorkspace.empty')}</p>
          )}
          {!loading && workspaces.length > 0 && (
            <ul className="space-y-2">
              {workspaces.map((ws) => (
                <li key={ws.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(ws)}
                    className="w-full text-left px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-slate-200 text-sm transition-colors"
                  >
                    <span className="font-medium">
                      {ws.name?.value ?? ws.id}
                    </span>
                    {ws.layout?.value?.length != null && (
                      <span className="block text-slate-500 text-xs mt-0.5">
                        {t('loadWorkspace.panelsCount', { count: ws.layout.value.length })}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="p-4 border-t border-slate-700">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-slate-300 hover:text-slate-100 border border-slate-600 rounded"
          >
            {t('loadWorkspace.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};
