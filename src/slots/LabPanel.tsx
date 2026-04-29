/**
 * JupyterLite WASM lab — embeds the JupyterLite distribution served from MinIO.
 *
 * Auth handshake: when the JupyterLite iframe loads, it receives the Keycloak
 * JWT via postMessage (ADR 004). The nkz_jupyter_init.js injected into the
 * built JupyterLite distribution listens for NKZ_AUTH_INJECTION messages.
 *
 * Deploy: push to main triggers .github/workflows/jupyterlite-build.yml which
 * builds jupyterlite/dist/ and syncs to s3://nekazari-frontend/jupyterlite/.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@nekazari/sdk';

const JUPYTERLITE_URL = '/jupyterlite/lab/index.html';

export const LabPanel: React.FC = () => {
  const { t } = useTranslation('datahub');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');

  useEffect(() => {
    // Check if JupyterLite is reachable
    const ac = new AbortController();
    fetch(JUPYTERLITE_URL, { method: 'HEAD', signal: ac.signal })
      .then((r) => {
        if (r.ok) setStatus('ready');
        else setStatus('unavailable');
      })
      .catch(() => setStatus('unavailable'));

    return () => ac.abort();
  }, []);

  // Inject JWT into JupyterLite iframe after load
  useEffect(() => {
    if (status !== 'ready') return;
    const iframe = iframeRef.current;
    if (!iframe) return;

    const onLoad = () => {
      try {
        const ctx = (window as any).__nekazariAuthContext;
        const token = ctx?.token; // available if host exposes it
        if (token) {
          iframe.contentWindow?.postMessage(
            JSON.stringify({ type: 'NKZ_AUTH_INJECTION', token }),
            '*'
          );
        }
      } catch { /* cross-origin guard */ }
    };

    iframe.addEventListener('load', onLoad);
    return () => iframe.removeEventListener('load', onLoad);
  }, [status]);

  if (status === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center p-8 gap-4">
        <div className="animate-spin w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full" />
        <p className="text-sm text-slate-400">{t('lab.loading')}</p>
      </div>
    );
  }

  if (status === 'unavailable') {
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
  }

  return (
    <div className="w-full h-full min-h-0">
      <iframe
        ref={iframeRef}
        src={JUPYTERLITE_URL}
        className="w-full h-full border-0"
        title="JupyterLite"
        sandbox="allow-scripts allow-same-origin allow-popups"
      />
    </div>
  );
};
