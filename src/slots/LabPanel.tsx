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
import { SlotShell } from '@nekazari/viewer-kit';
import { Spinner, Badge } from '@nekazari/ui-kit';

const datahubAccent = { base: '#06B6D4', soft: '#CFFAFE', strong: '#0891B2' };
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
      <SlotShell moduleId="datahub" accent={datahubAccent}>
        <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center p-8 gap-4">
          <Spinner />
          <p className="text-sm text-muted-foreground">{t('lab.loading')}</p>
        </div>
      </SlotShell>
    );
  }

  if (status === 'unavailable') {
    return (
      <SlotShell moduleId="datahub" accent={datahubAccent}>
        <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center p-8 gap-4">
          <div className="text-4xl opacity-40">&#128300;</div>
          <h3 className="text-lg font-medium text-foreground">
            {t('lab.comingSoonTitle')}
          </h3>
          <p className="text-sm text-muted-foreground max-w-md">
            {t('lab.comingSoonDesc')}
          </p>
          <Badge variant="outline" className="border-accent text-accent">
            {t('lab.comingSoonBadge')}
          </Badge>
        </div>
      </SlotShell>
    );
  }

  return (
    <SlotShell moduleId="datahub" accent={datahubAccent}>
      <div className="w-full h-full min-h-0">
        <iframe
          ref={iframeRef}
          src={JUPYTERLITE_URL}
          className="w-full h-full border-0"
          title="JupyterLite"
          sandbox="allow-scripts allow-same-origin allow-popups"
        />
      </div>
    </SlotShell>
  );
};
