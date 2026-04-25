"""
DataHub Module Backend (BFF).

Auth, observability, health and routing entrypoint. Business logic lives in
the per-resource routers under app/api/.
"""

import base64
import json
import os
import time
import uuid

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.entities import router as entities_router
from app.api.timeseries import router as timeseries_router
from app.api.workspaces import router as workspaces_router
from app.common.logging_setup import (
    get_logger,
    request_id_var,
    setup_logging,
    tenant_id_var,
)

setup_logging()
logger = get_logger(__name__)


def _extract_tenant_from_jwt(token: str) -> str | None:
    """Decode JWT payload (no signature verification — gateway validates) to extract tenant_id.

    Padding fix: when the base64-url-encoded payload length is already a
    multiple of 4, do NOT append `=` characters — Python's b64decode is strict
    by default and the previous "+= '=' * (4 - len % 4)" form produced four
    trailing '=' on valid payloads, breaking decoding for tokens that happened
    to land on a boundary.
    """
    try:
        parts = token.split(".")
        if len(parts) < 2:
            return None
        payload_b64 = parts[1]
        missing = (-len(payload_b64)) % 4
        if missing:
            payload_b64 += "=" * missing
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        return payload.get("tenant_id") or payload.get("tenant") or None
    except Exception:
        return None


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Inject X-Request-ID, populate contextvars for the JSON logger, set response header.

    Order matters: this middleware MUST run before any router handler so the
    structured logger picks up `request_id` from contextvars. It also runs
    before CookieAuthMiddleware so the request_id is logged even for auth
    failures. Tenant is filled in by CookieAuthMiddleware once it has the JWT.
    """

    async def dispatch(self, request: Request, call_next):
        incoming = request.headers.get("x-request-id")
        request_id = incoming if incoming else str(uuid.uuid4())
        rid_token = request_id_var.set(request_id)
        # Make the id reachable inside the handler too (some handlers may want it).
        request.state.request_id = request_id
        started = time.perf_counter()
        try:
            response = await call_next(request)
        finally:
            latency_ms = (time.perf_counter() - started) * 1000.0
            # Single access-log line per request, structured.
            try:
                logger.info(
                    "request",
                    extra={
                        "method": request.method,
                        "path": request.url.path,
                        "query": request.url.query or None,
                        "status": getattr(response, "status_code", None) if "response" in dir() else None,
                        "latency_ms": round(latency_ms, 2),
                    },
                )
            except Exception:
                pass
            request_id_var.reset(rid_token)
        response.headers["x-request-id"] = request_id
        return response


class CookieAuthMiddleware(BaseHTTPMiddleware):
    """Inject Authorization and X-Tenant-ID headers from httpOnly cookie JWT.

    Also populates the tenant_id contextvar so structured logs in handlers
    automatically attribute requests to the right tenant.
    """

    async def dispatch(self, request: Request, call_next):
        token = None
        # Work directly with request.scope headers; reading request.headers
        # before mutating can poison Starlette's header cache (issue observed
        # in production: intermittent 401 on api-gateway calls).
        raw_headers = list(request.scope.get("headers") or [])
        auth_header = None
        for k, v in raw_headers:
            if k == b"authorization":
                try:
                    auth_header = v.decode()
                except Exception:
                    auth_header = None
                break

        if not auth_header:
            token = request.cookies.get("nkz_token")
            if token:
                raw_headers = [(k, v) for k, v in raw_headers if k != b"authorization"]
                raw_headers.append((b"authorization", f"Bearer {token}".encode()))
                request.scope["headers"] = raw_headers
        elif auth_header.lower().startswith("bearer "):
            token = auth_header[7:]

        # X-Tenant-ID injection from JWT, plus contextvar population.
        tenant_id: str | None = None
        for k, v in raw_headers:
            if k == b"x-tenant-id":
                try:
                    tenant_id = v.decode()
                except Exception:
                    tenant_id = None
                break

        if tenant_id is None and token:
            tenant_id = _extract_tenant_from_jwt(token)
            if tenant_id:
                raw_headers = list(request.scope.get("headers") or raw_headers)
                raw_headers.append((b"x-tenant-id", tenant_id.encode()))
                request.scope["headers"] = raw_headers

        tid_token = tenant_id_var.set(tenant_id) if tenant_id else None
        try:
            return await call_next(request)
        finally:
            if tid_token is not None:
                tenant_id_var.reset(tid_token)


app = FastAPI(
    title="DataHub BFF",
    description=(
        "Backend For Frontend for nkz-module-datahub. "
        "Proxies / adapts platform APIs; no duplicate domain logic."
    ),
    version="2.1.0",
)

# Order: RequestId first (outermost), then CookieAuth, then CORS, then routers.
app.add_middleware(CookieAuthMiddleware)
app.add_middleware(RequestIdMiddleware)

_cors_origins = [
    o.strip()
    for o in os.getenv(
        "CORS_ORIGINS", "http://localhost:3000,http://localhost:5173"
    ).split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["x-request-id"],
)

app.include_router(entities_router)
app.include_router(timeseries_router)
app.include_router(workspaces_router)


@app.get("/health")
def health():
    """Liveness probe. Always 200 once the process is up — does not check deps."""
    return {"status": "healthy", "service": "datahub-bff"}


@app.get("/health/deep")
async def health_deep():
    """Readiness probe — verifies that the BFF can talk to its critical upstreams.

    Checks (best-effort, 2s timeout each):
      - Orion-LD context broker via PLATFORM_API_URL
      - timeseries-reader (same PLATFORM_API_URL but different path)

    Returns 200 with detail when all healthy. Returns 503 with per-check status
    if any required dependency is unreachable. Postgres is reached only via
    the platform reader, so we do not probe it directly here.
    """
    platform = os.getenv("PLATFORM_API_URL", "").rstrip("/")
    checks: dict[str, dict] = {}
    overall_ok = True

    async def _probe(name: str, url: str) -> None:
        nonlocal overall_ok
        if not url:
            checks[name] = {"status": "skipped", "reason": "PLATFORM_API_URL not set"}
            overall_ok = False
            return
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                r = await client.get(url)
                ok = r.status_code < 500
                checks[name] = {
                    "status": "up" if ok else "down",
                    "http_status": r.status_code,
                }
                if not ok:
                    overall_ok = False
        except Exception as exc:
            checks[name] = {"status": "unreachable", "error": str(exc)}
            overall_ok = False

    # Orion-LD endpoint — the version endpoint is cheap and unauthenticated.
    await _probe("orion_ld", f"{platform}/version" if platform else "")
    # timeseries-reader — the platform reader exposes a /health (or version)
    # endpoint at the same gateway base. We probe a known light path.
    await _probe(
        "timeseries_reader",
        f"{platform}/api/timeseries/v2/health" if platform else "",
    )

    body = {"status": "ok" if overall_ok else "degraded", "checks": checks}
    return JSONResponse(content=body, status_code=200 if overall_ok else 503)


@app.get("/metrics")
def metrics():
    """Placeholder for Prometheus scrape; structured logs feed the observability stack today."""
    return "# DataHub BFF metrics placeholder\n"
