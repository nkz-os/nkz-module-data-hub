"""
DataHub Module Backend (BFF).
Health, metrics, and /api/datahub/* (entities; timeseries/export to be added per plan).
"""

import base64
import json
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.entities import router as entities_router
from app.api.timeseries import router as timeseries_router
from app.api.workspaces import router as workspaces_router

logger = logging.getLogger(__name__)


def _extract_tenant_from_jwt(token: str) -> str | None:
    """Decode JWT payload (no signature verification — gateway validates) to extract tenant_id."""
    try:
        parts = token.split(".")
        if len(parts) < 2:
            return None
        payload_b64 = parts[1]
        # Fix base64 padding
        payload_b64 += "=" * (4 - len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        return payload.get("tenant_id") or payload.get("tenant") or None
    except Exception:
        return None


class CookieAuthMiddleware(BaseHTTPMiddleware):
    """Inject Authorization and X-Tenant-ID headers from httpOnly cookie JWT."""

    async def dispatch(self, request: Request, call_next):
        token = None
        auth_header = request.headers.get("authorization")
        if not auth_header:
            token = request.cookies.get("nkz_token")
            if token:
                request.scope["headers"] = [
                    *[(k, v) for k, v in request.scope["headers"] if k != b"authorization"],
                    (b"authorization", f"Bearer {token}".encode()),
                ]
        else:
            # Extract token from existing Authorization header
            if auth_header.lower().startswith("bearer "):
                token = auth_header[7:]

        # Inject X-Tenant-ID if not already present
        has_tenant = any(
            k == b"x-tenant-id" for k, _v in request.scope["headers"]
        )
        if not has_tenant and token:
            tenant_id = _extract_tenant_from_jwt(token)
            if tenant_id:
                request.scope["headers"] = [
                    *request.scope["headers"],
                    (b"x-tenant-id", tenant_id.encode()),
                ]
        return await call_next(request)


app = FastAPI(
    title="DataHub BFF",
    description="Backend For Frontend for NKZ-DataHub module. Proxies/adapts platform APIs; no duplicate domain logic.",
    version="1.0.0",
)

app.add_middleware(CookieAuthMiddleware)
import os
_cors_origins = [o.strip() for o in os.getenv('CORS_ORIGINS', 'http://localhost:3000,http://localhost:5173').split(',') if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(entities_router)
app.include_router(timeseries_router)
app.include_router(workspaces_router)


@app.get("/health")
def health():
    return {"status": "healthy", "service": "datahub-bff"}


@app.get("/metrics")
def metrics():
    return "# DataHub BFF metrics placeholder\n"
