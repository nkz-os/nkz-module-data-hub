/**
 * JupyterLite WASM lab embedded via iframe with postMessage auth handshake (ADR 004).
 * Token refresh: SDK sends NKZ_TOKEN_REQUEST, parent responds with NKZ_AUTH_INJECT.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '@nekazari/sdk';

const JUPYTERLITE_PATH = '/jupyterlite/lab/index.html';

export const LabPanel: React.FC = () => {
  const { t } = useTranslation('datahub');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);

  const injectToken = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;

    const keycloak = (window as any).__keycloakRef?.current;
    if (!keycloak?.token) return;

    // Refresh token if it expires within 30 seconds
    const doInject = () => {
      iframe.contentWindow?.postMessage(
        { type: 'NKZ_AUTH_INJECT', token: keycloak.token },
        window.location.origin
      );
    };

    if (keycloak.updateToken) {
      keycloak.updateToken(30).then(doInject).catch(doInject);
    } else {
      doInject();
    }
  }, []);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (!e.data || typeof e.data !== 'object') return;

      if (e.data.type === 'NKZ_JUPYTER_READY') {
        setReady(true);
        injectToken();
      } else if (e.data.type === 'NKZ_TOKEN_REQUEST') {
        injectToken();
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [injectToken]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {!ready && (
        <div className="flex items-center justify-center p-8 text-slate-400 text-sm gap-2">
          <div className="animate-spin h-4 w-4 border-2 border-slate-500 border-t-emerald-400 rounded-full" />
          {t('lab.loading')}
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={JUPYTERLITE_PATH}
        sandbox="allow-scripts allow-same-origin allow-downloads allow-popups"
        className={`flex-1 w-full border-0 ${ready ? '' : 'opacity-0 h-0'}`}
        title="Nekazari Scientific Lab"
      />
    </div>
  );
};
