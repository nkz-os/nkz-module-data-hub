"""
PAT proxy: forward /api/tenant/api-keys requests to the platform tenant API.
The frontend cannot call /api/tenant/* directly because it runs on a different
domain (nekazari.robotika.cloud vs nkz.robotika.cloud) and cookie auth requires
same-origin. The BFF proxies these requests through the platform API.
"""

import os
from typing import Optional

import httpx
from fastapi import APIRouter, Header, Request
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/datahub/integrations", tags=["integrations"])
PLATFORM_API_URL = os.getenv("PLATFORM_API_URL", "").rstrip("/")


def _forward_headers(authorization: Optional[str], x_tenant_id: Optional[str]) -> dict:
    h: dict = {}
    if authorization:
        h["Authorization"] = authorization
    if x_tenant_id:
        h["X-Tenant-ID"] = x_tenant_id
    return h


@router.get("/api-keys")
async def list_api_keys(
    authorization: Optional[str] = Header(None),
    x_tenant_id: Optional[str] = Header(None),
):
    """Proxy GET /api/tenant/api-keys to platform."""
    if not PLATFORM_API_URL:
        return JSONResponse(content={"error": "PLATFORM_API_URL not set"}, status_code=503)
    url = f"{PLATFORM_API_URL}/api/tenant/api-keys"
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.get(url, headers=_forward_headers(authorization, x_tenant_id))
    return JSONResponse(
        content=r.json() if r.headers.get("content-type", "").startswith("application/json") else [],
        status_code=r.status_code,
    )


@router.post("/api-keys")
async def create_api_key(
    request: Request,
    authorization: Optional[str] = Header(None),
    x_tenant_id: Optional[str] = Header(None),
):
    """Proxy POST /api/tenant/api-keys to platform."""
    if not PLATFORM_API_URL:
        return JSONResponse(content={"error": "PLATFORM_API_URL not set"}, status_code=503)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(content={"error": "Invalid JSON"}, status_code=400)
    url = f"{PLATFORM_API_URL}/api/tenant/api-keys"
    headers = _forward_headers(authorization, x_tenant_id)
    headers["Content-Type"] = "application/json"
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(url, json=body, headers=headers)
    content = r.text
    try:
        return JSONResponse(content=r.json(), status_code=r.status_code)
    except Exception:
        return JSONResponse(content={"error": content[:500]}, status_code=r.status_code)


@router.delete("/api-keys/{key_id}")
async def revoke_api_key(
    key_id: str,
    authorization: Optional[str] = Header(None),
    x_tenant_id: Optional[str] = Header(None),
):
    """Proxy DELETE /api/tenant/api-keys/{id} to platform."""
    if not PLATFORM_API_URL:
        return JSONResponse(content={"error": "PLATFORM_API_URL not set"}, status_code=503)
    url = f"{PLATFORM_API_URL}/api/tenant/api-keys/{key_id}"
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.delete(url, headers=_forward_headers(authorization, x_tenant_id))
    return JSONResponse(content=None, status_code=r.status_code)
