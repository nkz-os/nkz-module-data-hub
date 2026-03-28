"""
nekazari.py — Micro-SDK for Nekazari platform (JupyterLite WASM + local Jupyter).

Dual-mode authentication:
  - WASM (JupyterLite): JWT injected via postMessage from DataHub parent (NKZ_AUTH_INJECT).
    Token refreshes on demand via NKZ_TOKEN_REQUEST before each request.
  - Local (standard Jupyter): PAT from NKZ_PAT environment variable (long-lived, ADR 003).

See nkz/internal-docs/adr/004-jupyterlite-scientific-lab.md
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any, Optional
from urllib.parse import quote, urlencode

__version__ = "0.1.0"

_DEFAULT_API_URL = ""  # Same-origin in WASM; must be set via NKZ_API_URL for local mode.


def _is_wasm() -> bool:
    return "pyodide" in sys.modules


def _api_url() -> str:
    url = os.environ.get("NKZ_API_URL", _DEFAULT_API_URL).rstrip("/")
    if not url and not _is_wasm():
        raise RuntimeError(
            "NKZ_API_URL not set. In local Jupyter, set NKZ_API_URL='https://nkz.robotika.cloud'"
        )
    return url


async def _request_fresh_token_from_parent() -> None:
    """Ask the DataHub parent frame for a fresh JWT via postMessage (WASM only)."""
    if not _is_wasm():
        return
    from pyodide.ffi import create_proxy  # type: ignore[import-not-found]
    from js import window, Promise  # type: ignore[import-not-found]
    import asyncio

    got_token = asyncio.get_event_loop().create_future()

    def _on_message(event):
        if not hasattr(event, "data"):
            return
        data = event.data.to_py() if hasattr(event.data, "to_py") else event.data
        if isinstance(data, dict) and data.get("type") == "NKZ_AUTH_INJECT":
            token = data.get("token")
            if token and isinstance(token, str):
                os.environ["NKZ_JWT"] = token
                if not got_token.done():
                    got_token.set_result(True)

    proxy = create_proxy(_on_message)
    window.addEventListener("message", proxy)
    try:
        window.parent.postMessage({"type": "NKZ_TOKEN_REQUEST"}, window.location.origin)
        await asyncio.wait_for(got_token, timeout=10.0)
    except asyncio.TimeoutError:
        pass  # Keep existing token; will fail on 401 if truly expired
    finally:
        window.removeEventListener("message", proxy)
        proxy.destroy()


def _get_token() -> str:
    """Return current auth token (JWT in WASM, PAT in local)."""
    jwt = os.environ.get("NKZ_JWT", "").strip()
    if jwt:
        return jwt
    pat = os.environ.get("NKZ_PAT", "").strip()
    if pat:
        return pat
    raise RuntimeError(
        "No authentication configured.\n"
        "  JupyterLite: token is injected automatically from DataHub.\n"
        "  Local Jupyter: set NKZ_PAT='nkz_pat_...' environment variable."
    )


async def _fetch_bytes(
    method: str,
    path: str,
    *,
    params: Optional[dict] = None,
    body: Optional[dict] = None,
    accept: str = "application/vnd.apache.arrow.stream",
) -> bytes:
    """Unified HTTP fetch: pyfetch in WASM, httpx in local."""
    if _is_wasm():
        await _request_fresh_token_from_parent()

    token = _get_token()
    base = _api_url()
    url = f"{base}{path}"
    if params:
        url = f"{url}?{urlencode(params)}"

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": accept,
    }

    if _is_wasm():
        from pyodide.http import pyfetch  # type: ignore[import-not-found]

        fetch_opts: dict[str, Any] = {
            "method": method,
            "headers": headers,
        }
        if body is not None:
            headers["Content-Type"] = "application/json"
            fetch_opts["headers"] = headers
            fetch_opts["body"] = json.dumps(body)

        resp = await pyfetch(url, **fetch_opts)
        if resp.status == 401:
            # Token might have expired between refresh and request — retry once
            await _request_fresh_token_from_parent()
            fetch_opts["headers"]["Authorization"] = f"Bearer {_get_token()}"
            resp = await pyfetch(url, **fetch_opts)
        if resp.status >= 400:
            text = await resp.string()
            raise RuntimeError(f"HTTP {resp.status}: {text[:500]}")
        buf = await resp.bytes()
        return bytes(buf)
    else:
        import httpx

        async with httpx.AsyncClient(timeout=120.0) as client:
            if method == "GET":
                r = await client.get(url, headers=headers)
            else:
                headers["Content-Type"] = "application/json"
                r = await client.post(url, headers=headers, content=json.dumps(body) if body else None)
            if r.status_code >= 400:
                raise RuntimeError(f"HTTP {r.status_code}: {r.text[:500]}")
            return r.content


async def _fetch_json(method: str, path: str, *, params: Optional[dict] = None, body: Optional[dict] = None) -> Any:
    raw = await _fetch_bytes(method, path, params=params, body=body, accept="application/json")
    return json.loads(raw)


# ---------------------------------------------------------------------------
# Public API: timeseries
# ---------------------------------------------------------------------------

class timeseries:
    """Query platform timeseries (weather + IoT telemetry)."""

    @staticmethod
    async def get_dataframe(
        *,
        device_id: Optional[str] = None,
        entity_urn: Optional[str] = None,
        attributes: list[str],
        start_date: str,
        end_date: str,
        resolution: int = 500,
    ):
        """
        Fetch aligned timeseries as a pandas DataFrame (Arrow zero-copy in WASM).

        Parameters
        ----------
        device_id : str, optional
            Short device ID (e.g. "120786a0cf364796"). Mutually exclusive with entity_urn.
        entity_urn : str, optional
            Full NGSI-LD URN (e.g. "urn:ngsi-ld:AgriParcel:..."). Mutually exclusive with device_id.
        attributes : list[str]
            Measurement names (e.g. ["soilMoisture", "airTemperature"]).
        start_date : str
            ISO 8601 start (e.g. "2026-01-01" or "2026-01-01T00:00:00Z").
        end_date : str
            ISO 8601 end.
        resolution : int
            Number of aligned time points (default 500).

        Returns
        -------
        pandas.DataFrame
            Columns: timestamp (epoch seconds float64) + one column per series.
        """
        import pyarrow.ipc as ipc
        import pandas as pd

        urn = entity_urn or device_id
        if not urn:
            raise ValueError("Provide device_id or entity_urn")

        series = [{"entity_urn": urn, "attribute": a} for a in attributes]
        body = {
            "time_from": _normalize_datetime(start_date),
            "time_to": _normalize_datetime(end_date),
            "resolution": resolution,
            "series": series,
        }
        raw = await _fetch_bytes("POST", "/api/timeseries/v2/query", body=body)
        table = ipc.open_stream(raw).read_all()
        return table.to_pandas()

    @staticmethod
    async def query(
        *,
        series: list[dict],
        time_from: str,
        time_to: str,
        resolution: int = 500,
    ):
        """
        Low-level v2/query — pass series dicts directly.

        Parameters
        ----------
        series : list[dict]
            Each dict: {"entity_urn": "...", "attribute": "..."}.
        time_from, time_to : str
            ISO 8601.
        resolution : int

        Returns
        -------
        pandas.DataFrame
        """
        import pyarrow.ipc as ipc

        body = {
            "time_from": _normalize_datetime(time_from),
            "time_to": _normalize_datetime(time_to),
            "resolution": resolution,
            "series": series,
        }
        raw = await _fetch_bytes("POST", "/api/timeseries/v2/query", body=body)
        table = ipc.open_stream(raw).read_all()
        return table.to_pandas()


# ---------------------------------------------------------------------------
# Public API: entities
# ---------------------------------------------------------------------------

class entities:
    """Query NGSI-LD entities via the platform API Gateway."""

    @staticmethod
    async def list(*, type: str = "AgriSensor", limit: int = 100) -> list[dict]:
        """
        List entities of a given type for the current tenant.

        Note: In local/PAT mode, this endpoint may return 401 (PATs are scoped to /api/timeseries).
        """
        params = {"type": type, "limit": limit}
        return await _fetch_json("GET", "/api/entities", params=params)


# ---------------------------------------------------------------------------
# Public API: info
# ---------------------------------------------------------------------------

def info() -> None:
    """Print SDK configuration and auth status."""
    mode = "wasm" if _is_wasm() else "local"
    has_jwt = bool(os.environ.get("NKZ_JWT", "").strip())
    has_pat = bool(os.environ.get("NKZ_PAT", "").strip())
    auth = "jwt" if has_jwt else ("pat" if has_pat else "none")
    api = _api_url() or "(same-origin)"
    print(f"nekazari SDK v{__version__}")
    print(f"  mode:  {mode}")
    print(f"  auth:  {auth}")
    print(f"  api:   {api}")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _normalize_datetime(value: str) -> str:
    """Ensure ISO 8601 with timezone. Bare dates get T00:00:00Z appended."""
    v = value.strip()
    if "T" not in v and len(v) == 10:
        v = f"{v}T00:00:00Z"
    return v
