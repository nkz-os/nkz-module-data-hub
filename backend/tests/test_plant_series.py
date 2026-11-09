"""
Trees (AgriPlant) in DataHub: listed with the leaf-analysis results as attributes,
and their series read from the reader's per-plant route (the results live on the
AgriPlantSample entities, not on the tree).

Run:  cd backend && python -m pytest tests/ -v
"""
import io
from datetime import datetime, timezone

import polars as pl
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch

from app.api import timeseries
from app.api.entities import _ENTITY_TYPES_DEFAULT, _norm_entity

PLANT = "urn:ngsi-ld:AgriPlant:tenant-a:demo-parcel-001:T-1"
BASE = "http://platform.test"
LEAF = ["nitrogen", "phosphorus", "potassium", "calcium", "magnesium", "sulphur", "chloride",
        "iron", "manganese", "zinc", "copper", "boron", "sodium"]
ROWS = {
    "entity_type": "AgriPlantSample", "plant_id": PLANT, "count": 2,
    "data": [
        {"entity_id": "urn:ngsi-ld:AgriPlantSample:tenant-a:a1", "observed_at": "2025-07-15T12:00:00+00:00",
         "nitrogen": 0.018},
        {"entity_id": "urn:ngsi-ld:AgriPlantSample:tenant-a:a2", "observed_at": "2026-07-15T12:00:00+00:00"},
    ],
}


def _epoch(iso: str) -> float:
    return datetime.fromisoformat(iso).astimezone(timezone.utc).timestamp()


class _FakeClient:
    """Stands in for httpx.AsyncClient; records every request."""

    calls: list = []
    reply: dict = {}

    def __init__(self, *a, **kw):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return None

    async def _send(self, method, url, params=None, json=None, headers=None):
        _FakeClient.calls.append({"method": method, "url": url, "params": params, "json": json})
        r = MagicMock()
        r.status_code = 200
        r.json.return_value = _FakeClient.reply
        return r

    async def get(self, url, params=None, headers=None):
        return await self._send("GET", url, params=params, headers=headers)

    async def post(self, url, json=None, headers=None):
        return await self._send("POST", url, json=json, headers=headers)


@pytest.fixture
def fake():
    _FakeClient.calls = []
    _FakeClient.reply = ROWS
    with patch.object(timeseries, "PLATFORM_API_URL", BASE), \
            patch.object(timeseries.httpx, "AsyncClient", _FakeClient):
        yield _FakeClient


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(timeseries.router)
    return TestClient(app)


def _get(client, entity_id, attribute="nitrogen"):
    return client.get(
        f"/api/datahub/timeseries/entities/{entity_id}/data",
        params={"start_time": "2025-01-01T00:00:00Z", "end_time": "2026-12-31T00:00:00Z",
                "attribute": attribute, "resolution": 1000},
        headers={"X-Tenant-ID": "tenant-a"},
    )


def test_agriplant_listed_with_leaf_attributes():
    assert "AgriPlant" in _ENTITY_TYPES_DEFAULT
    tree = {
        "id": PLANT, "type": "AgriPlant",
        "plantCode": {"type": "Property", "value": "T-1"},
        "variety": {"type": "Property", "value": "arbequina"},
        "datePlanted": {"type": "Property", "value": "2000-03-01"},
        "hasAgriParcel": {"type": "Relationship", "object": "urn:ngsi-ld:AgriParcel:demo-parcel-001"},
    }
    rec = _norm_entity(tree, "AgriPlant")
    assert [a["name"] for a in rec["attributes"]] == LEAF
    assert {a["source"] for a in rec["attributes"]} == {"timescale"}


def test_plant_id_routes_to_plant_series(fake, client):
    assert _get(client, PLANT).status_code == 200
    (call,) = fake.calls
    assert call["url"].startswith(f"{BASE}/api/timeseries/type/AgriPlantSample/plant/")
    assert call["url"].endswith("/data") and "/v2/entities/" not in call["url"]
    assert call["params"] == {"from": "2025-01-01T00:00:00Z", "to": "2026-12-31T00:00:00Z",
                              "attrs": "nitrogen", "tissue": "leaf"}


def test_plant_rows_converted_to_series_shape(fake, client):
    body = _get(client, PLANT).json()
    assert body["timestamps"] == [_epoch("2025-07-15T12:00:00+00:00"), _epoch("2026-07-15T12:00:00+00:00")]
    assert body["values"] == [1.8, None]  # lab unit: %


def test_other_ids_unchanged(fake, client):
    fake.reply = {"timestamps": [], "attributes": {}}
    device = "urn:ngsi-ld:Device:tenant-a:d1"
    assert _get(client, device, "soilMoisture").status_code == 200
    (call,) = fake.calls
    assert "/api/timeseries/v2/entities/" in call["url"] and "/plant/" not in call["url"]


@pytest.mark.asyncio
async def test_export_reads_plant_series(fake):
    raw = await timeseries._fetch_entity_data_raw(
        _FakeClient(), BASE, PLANT, "nitrogen", "2025-01-01T00:00:00Z", "2026-12-31T00:00:00Z", 1000, {})
    df = pl.read_ipc(io.BytesIO(raw))
    assert df["value"].to_list() == [1.8, None]
    assert "/plant/" in fake.calls[0]["url"]


def test_align_with_plant_fetches_each_series(fake, client):
    def reply_for(url):
        return ROWS if "/plant/" in url else {
            "timestamps": ["2025-07-15T12:00:00+00:00"], "attributes": {"soilMoisture": [0.31]}}

    async def _send(self, method, url, params=None, json=None, headers=None):
        _FakeClient.calls.append({"method": method, "url": url, "params": params, "json": json})
        r = MagicMock()
        r.status_code = 200
        r.json.return_value = reply_for(url)
        return r

    with patch.object(_FakeClient, "_send", _send):
        r = client.post("/api/datahub/timeseries/align", json={
            "start_time": "2025-01-01T00:00:00Z", "end_time": "2026-12-31T00:00:00Z", "resolution": 1000,
            "series": [{"entity_id": PLANT, "attribute": "nitrogen"},
                       {"entity_id": "urn:ngsi-ld:Device:tenant-a:d1", "attribute": "soilMoisture"}],
        }, headers={"X-Tenant-ID": "tenant-a"})
    assert r.status_code == 200, r.text
    assert not any(c["url"].endswith("/v2/query") for c in fake.calls)
    body = r.json()
    assert body["value_0"] == [1.8, None] and body["value_1"] == [0.31, None]


def test_plant_upstream_error_keeps_status(fake, client):
    async def _send(self, method, url, params=None, json=None, headers=None):
        r = MagicMock()
        r.status_code = 502
        r.text = "Plant samples unavailable"
        return r

    with patch.object(_FakeClient, "_send", _send):
        r = _get(client, PLANT)
    assert r.status_code == 502 and "unavailable" in r.json()["error"]


def test_same_day_replicates_averaged(fake, client):
    day = "2026-07-15T12:00:00+00:00"
    fake.reply = {"data": [
        {"entity_id": "s1", "observed_at": day, "plantTissue": "leaf", "nitrogen": 0.018},
        {"entity_id": "s2", "observed_at": day, "plantTissue": "leaf", "nitrogen": 0.020},
        {"entity_id": "s3", "observed_at": day, "plantTissue": "leaf"},
    ]}
    body = _get(client, PLANT).json()
    assert body["timestamps"] == [_epoch(day)]
    assert body["values"] == [pytest.approx(1.9)]


@pytest.mark.asyncio
async def test_entities_listing_pages_orion():
    from app.api import entities

    pages = [[{"id": f"urn:ngsi-ld:AgriPlant:tenant-a:p:{i}"} for i in range(1000)],
             [{"id": "urn:ngsi-ld:AgriPlant:tenant-a:p:last"}]]
    seen = []

    class _Client(_FakeClient):
        async def get(self, url, params=None, headers=None):
            seen.append(dict(params))
            r = MagicMock()
            r.status_code = 200
            r.raise_for_status = MagicMock()
            r.json.return_value = pages[len(seen) - 1]
            return r

    with patch.object(entities.httpx, "AsyncClient", _Client):
        out = await entities._fetch_ngsi_entities(BASE, "AgriPlant", None, "tenant-a")
    assert len(out) == 1001
    assert [(p["limit"], p["offset"]) for p in seen] == [(1000, 0), (1000, 1000)]


def test_micronutrients_stay_in_mg_per_kg(fake, client):
    fake.reply = {"data": [{"entity_id": "s1", "observed_at": "2026-07-15T12:00:00+00:00", "iron": 85}]}
    assert _get(client, PLANT, "iron").json()["values"] == [85]
