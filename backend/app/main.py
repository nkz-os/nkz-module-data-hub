"""
DataHub Module Backend (BFF).
Health, metrics, and /api/datahub/* (entities; timeseries/export to be added per plan).
"""

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.entities import router as entities_router
from app.api.timeseries import router as timeseries_router
from app.api.workspaces import router as workspaces_router


class CookieAuthMiddleware(BaseHTTPMiddleware):
    """Inject Authorization header from httpOnly cookie when Bearer header is missing."""

    async def dispatch(self, request: Request, call_next):
        if not request.headers.get("authorization"):
            token = request.cookies.get("nkz_token")
            if token:
                # MutableHeaders lets us inject the header for downstream handlers
                request.scope["headers"] = [
                    *[(k, v) for k, v in request.scope["headers"] if k != b"authorization"],
                    (b"authorization", f"Bearer {token}".encode()),
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
