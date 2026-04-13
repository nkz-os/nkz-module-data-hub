/**
 * JupyterLite WASM lab — placeholder until JupyterLite static assets are deployed.
 * TODO: Deploy JupyterLite build to MinIO /jupyterlite/ and add ingress rule, then
 *       restore iframe + postMessage auth handshake (ADR 004).
 */

import React from 'react';
import { useTranslation } from '@nekazari/sdk';

export const LabPanel: React.FC = () => {
  const { t } = useTranslation('datahub');

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center p-8 gap-4">
      <div className="text-4xl opacity-40">&#128300;</div>
      <h3 className="text-lg font-medium text-slate-200">
        {t('lab.comingSoonTitle')}
      </h3>
      <p className="text-sm text-slate-400 max-w-md">
        {t('lab.comingSoonDesc')}
      </p>
      <span className="inline-block px-3 py-1 text-xs font-medium text-emerald-400 bg-emerald-900/30 rounded-full border border-emerald-700/40">
        {t('lab.comingSoonBadge')}
      </span>
    </div>
  );
};
