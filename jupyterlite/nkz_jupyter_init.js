/**
 * JupyterLite init script — postMessage handshake with DataHub parent (ADR 004).
 *
 * Injected into the JupyterLite build and runs when the Pyodide kernel is ready.
 * Handles:
 *   1. NKZ_AUTH_INJECT (parent → iframe): store token in Python os.environ['NKZ_JWT']
 *   2. NKZ_JUPYTER_READY (iframe → parent): signal that kernel is ready for token injection
 *
 * Token refresh is driven by the SDK (nekazari.py) sending NKZ_TOKEN_REQUEST when needed.
 */
(function () {
  'use strict';

  var origin = window.location.origin;

  window.addEventListener('message', function (event) {
    if (event.origin !== origin) return;
    if (!event.data || typeof event.data !== 'object') return;

    if (event.data.type === 'NKZ_AUTH_INJECT' && typeof event.data.token === 'string') {
      // Store in Pyodide if kernel is loaded; otherwise queue for later
      if (window.pyodide && window.pyodide.runPython) {
        try {
          window.pyodide.runPython(
            "import os; os.environ['NKZ_JWT'] = " + JSON.stringify(event.data.token)
          );
        } catch (e) {
          console.warn('[NKZ] Failed to inject token into Pyodide:', e);
        }
      } else {
        // Queue: Pyodide not ready yet — store and retry when kernel loads
        window.__NKZ_PENDING_TOKEN__ = event.data.token;
      }
    }
  });

  // When Pyodide finishes loading, inject any queued token and signal readiness
  function onKernelReady() {
    if (window.__NKZ_PENDING_TOKEN__ && window.pyodide && window.pyodide.runPython) {
      try {
        window.pyodide.runPython(
          "import os; os.environ['NKZ_JWT'] = " + JSON.stringify(window.__NKZ_PENDING_TOKEN__)
        );
      } catch (e) {
        console.warn('[NKZ] Failed to inject queued token:', e);
      }
      delete window.__NKZ_PENDING_TOKEN__;
    }
    window.parent.postMessage({ type: 'NKZ_JUPYTER_READY' }, origin);
  }

  // Poll for Pyodide readiness (JupyterLite loads it asynchronously)
  var attempts = 0;
  var maxAttempts = 120; // ~60 seconds
  var pollId = setInterval(function () {
    attempts++;
    if (window.pyodide && window.pyodide.runPython) {
      clearInterval(pollId);
      onKernelReady();
    } else if (attempts >= maxAttempts) {
      clearInterval(pollId);
      console.warn('[NKZ] Pyodide did not load within timeout');
      // Still signal ready so parent doesn't hang
      window.parent.postMessage({ type: 'NKZ_JUPYTER_READY' }, origin);
    }
  }, 500);
})();
