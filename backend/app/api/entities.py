"""
GET /api/datahub/entities — list entities that have timeseries data.
Proxies to platform NGSI-LD / entity APIs when PLATFORM_API_URL is set.
"""

import os
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Header, Query
from fastapi.responses import JSONResponse

from app.common.logging_setup import get_logger

router = APIRouter(prefix="/api/datahub", tags=["datahub"])

logger = get_logger(__name__)
PLATFORM_API_URL = os.getenv("PLATFORM_API_URL", "").rstrip("/")
CONTEXT_URL = os.getenv("CONTEXT_URL", "").strip()

# Entity types that typically have timeseries; NGSI-LD types
ENTITY_TYPES_WITH_DATA = [
    "AgriParcel",
    "AgriSensor",
    "WeatherObserved",
    "WeatherStation",
    "AgriculturalTractor",
    "LivestockAnimal",
    "AgriculturalMachine",
    "Device",
    "CropHealthAssessment",
    "VegetationIndex",
]


def _get_value(obj: Any) -> Any:
    """Extract value from NGSI-LD property (normalized or simplified)."""
    if obj is None:
        return None
    if isinstance(obj, dict) and "value" in obj:
        return obj["value"]
    return obj


# NGSI-LD system keys that are never timeseries attributes
_NGSI_SYSTEM_KEYS = frozenset({
    "id", "type", "@context", "location", "name", "description",
    "address", "source", "provider", "dateCreated", "dateModified",
    "refAgriParcel", "refDevice", "refWeatherStation",
    "municipalityCode",
})

# timeseries-reader compatibility maps for `source=timescale`.
# Keep these in sync with nkz/services/timeseries-reader/app.py.
_WEATHER_VALID_COLUMNS = frozenset({
    "temp_avg", "temp_min", "temp_max",
    "humidity_avg", "precip_mm",
    "solar_rad_w_m2", "eto_mm",
    "soil_moisture_0_10cm", "wind_speed_ms",
    "pressure_hpa", "wind_direction_deg",
})
_WEATHER_ATTR_MAP = {
    "temperature": "temp_avg",
    "relativeHumidity": "humidity_avg",
    "windSpeed": "wind_speed_ms",
    "windDirection": "wind_direction_deg",
    "atmosphericPressure": "pressure_hpa",
    "precipitation": "precip_mm",
    "et0": "eto_mm",
    "solarRadiation": "solar_rad_w_m2",
    "soilMoisture": "soil_moisture_0_10cm",
}
_TELEMETRY_VALID_ATTRS = frozenset({
    "soilMoisture", "soilTemperature", "airTemperature", "relativeHumidity",
    "atmosphericPressure", "windSpeed", "windDirection", "solarRadiation",
    "rainGauge", "illuminance", "depth", "conductance", "batteryLevel",
    "humidity", "temperature",
    "panelInclination",
    # Crop Health Assessment attributes (via telemetry_events)
    "cwsiValue", "mdsValue", "mdsRatio", "vpdKpa",
    "waterBalanceDeficit", "vigorIndex", "compositeStressIndex",
    "yieldUtilizationPct",
})
_TELEMETRY_UI_ALIASES = {
    "sensorsinsolation": "solarRadiation",
}


def _attr_source(attr_val: Any) -> str | None:
    """Extract the nested source from an NGSI-LD attribute value, if present.

    NGSI-LD attribute-level metadata looks like:
        "ndviMean": { "type": "Property", "value": 0.72, "source": {"type": "Property", "value": "vegetation_health"} }

    Returns the source string (lower-cased) or None if absent.
    """
    if not isinstance(attr_val, dict):
        return None
    raw = attr_val.get("source")
    if raw is None:
        return None
    val = _get_value(raw)
    if isinstance(val, str) and val.strip():
        return val.strip().lower()
    return None


def _canonical_timescale_attr(entity_type: str, attr_name: str) -> str | None:
    """
    Keep only attributes that the platform timeseries-reader can actually query.
    Returns canonical attribute name to expose in DataHub tree, or None to drop it.
    """
    name = (attr_name or "").strip()
    if not name:
        return None

    # Weather-capable entities (including parcels resolved to weather key in v2 reader)
    if entity_type in {"WeatherObserved", "WeatherStation", "AgriParcel"}:
        if name in _WEATHER_VALID_COLUMNS or name in _WEATHER_ATTR_MAP:
            return name
        return None

    # Sensor/device entities read from telemetry_events.measurements
    if entity_type in {"AgriSensor", "Device", "Actuator", "AgriculturalMachine", "AgriculturalTractor", "LivestockAnimal"}:
        if name in _TELEMETRY_VALID_ATTRS:
            return name
        aliased = _TELEMETRY_UI_ALIASES.get(name)
        if aliased and aliased in _TELEMETRY_VALID_ATTRS:
            return aliased
        return None

    # Unknown type on timescale: accept only reader-known attrs.
    if name in _TELEMETRY_VALID_ATTRS or name in _WEATHER_VALID_COLUMNS or name in _WEATHER_ATTR_MAP:
        return name
    aliased = _TELEMETRY_UI_ALIASES.get(name)
    if aliased and aliased in _TELEMETRY_VALID_ATTRS:
        return aliased
    return None


def _norm_entity(e: dict, etype: str) -> dict:
    """Normalize an NGSI-LD entity for the DataHub entity tree.

    Returns:
        {
          id, type, name,
          source: str,           # entity-level default source (fallback)
          attributes: [          # all discovered timeseries-capable attributes
            { name: str, source: str }   # source may differ per attribute
          ]
        }

    Discovery rules:
    1. Skip NGSI-LD system keys (id, type, @context, location, etc.)
    2. Skip keys whose value is not a dict (scalars, nulls)
    3. For each remaining NGSI-LD Property, read its nested "source" metadata.
       If absent, fall back to the entity-level source (defaults to "timescale").
    4. Skip attributes whose value is None or clearly non-numeric
       (Relationship, GeoProperty, array of strings without numeric value).

    This makes the entity tree self-describing: any module that PATCHes an
    attribute with source="my_module" onto an entity will automatically appear
    in the DataHub UI without code changes.
    """
    entity_id = e.get("id") or ""
    if isinstance(entity_id, dict):
        entity_id = entity_id.get("value", entity_id) or ""
    entity_id = str(entity_id)

    raw_name = _get_value(e.get("name"))
    name = str(raw_name) if raw_name is not None else "Unknown"

    # Entity-level default source (used when an attribute has no explicit source)
    entity_source_raw = _get_value(e.get("source")) or _get_value(e.get("provider"))
    entity_source = (
        str(entity_source_raw).strip().lower()
        if isinstance(entity_source_raw, str) and entity_source_raw.strip()
        else "timescale"
    )

    attributes: list[dict] = []
    seen_attrs: set[tuple[str, str]] = set()
    for key, val in e.items():
        if key in _NGSI_SYSTEM_KEYS:
            continue
        if not isinstance(val, dict):
            continue
        # Skip Relationships and GeoProperties — they are not timeseries
        prop_type = val.get("type", "")
        if prop_type in ("Relationship", "GeoProperty"):
            continue
        # Skip boolean properties — they are config flags, not timeseries
        raw_val = _get_value(val)
        if isinstance(raw_val, bool):
            continue
        # Accept: numeric values, string-encoded numerics, and None (device
        # provisioned but hasn't sent data yet — attribute exists in timeseries).
        if raw_val is not None and not isinstance(raw_val, (int, float)):
            # Try to parse string numerics (e.g. "23.5")
            if isinstance(raw_val, str):
                try:
                    float(raw_val)
                except (ValueError, TypeError):
                    continue
            else:
                continue

        per_attr_source = _attr_source(val) or entity_source
        canonical_name = key
        # Non-timescale sources (e.g. vegetation_health, carbon) are accepted
        # directly — their adapter knows which attributes it serves.
        if per_attr_source == "timescale":
            canonical_name = _canonical_timescale_attr(etype, key) or ""
            if not canonical_name:
                continue
        item = (canonical_name, per_attr_source)
        if item in seen_attrs:
            continue
        seen_attrs.add(item)
        attributes.append({"name": canonical_name, "source": per_attr_source})

    return {
        "id": entity_id,
        "type": etype,
        "name": name,
        "source": entity_source,
        "attributes": attributes,
    }


async def _fetch_ngsi_entities(
    platform_base: str,
    etype: str,
    authorization: Optional[str],
    x_tenant_id: Optional[str],
) -> list[dict]:
    """Fetch entities by type from platform NGSI-LD."""
    url = f"{platform_base}/ngsi-ld/v1/entities"
    headers = {"Accept": "application/json"}
    if CONTEXT_URL:
        headers["Link"] = (
            f'<{CONTEXT_URL}>; rel="http://www.w3.org/ns/json-ld#context"; type="application/ld+json"'
        )
    if authorization:
        headers["Authorization"] = authorization
    if x_tenant_id:
        headers["X-Tenant-ID"] = x_tenant_id
        headers["NGSILD-Tenant"] = x_tenant_id
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.get(url, params={"type": etype}, headers=headers)
        r.raise_for_status()
        data = r.json()
    return data if isinstance(data, list) else []


@router.get("/entities")
async def get_entities(
    search: Optional[str] = Query(None, description="Filter by name or id"),
    authorization: Optional[str] = Header(None),
    x_tenant_id: Optional[str] = Header(None),
):
    """
    List entities that have timeseries data (parcels, weather stations, sensors, etc.).
    When PLATFORM_API_URL is set, aggregates from platform NGSI-LD; otherwise returns empty list.
    """
    if not PLATFORM_API_URL:
        return {"entities": []}

    all_entities: list[dict] = []
    successful_types = 0
    failures: list[str] = []
    for etype in ENTITY_TYPES_WITH_DATA:
        try:
            raw = await _fetch_ngsi_entities(
                PLATFORM_API_URL, etype, authorization, x_tenant_id
            )
            successful_types += 1
            for e in raw:
                rec = _norm_entity(e, etype)
                if search:
                    q = search.lower()
                    if q not in rec["name"].lower() and q not in rec["id"].lower():
                        continue
                all_entities.append(rec)
        except Exception as ex:
            failures.append(f"{etype}: {ex}")
            logger.warning(
                "entities_skip_type",
                extra={"entity_type": etype, "error": str(ex)},
            )
            continue
    if successful_types == 0 and failures:
        logger.error(
            "entities_all_types_failed",
            extra={"failures": failures[:5], "search": search},
        )
        return JSONResponse(
            content={
                "error": "No se pudo consultar Orion-LD desde DataHub",
                "details": failures[:3],
            },
            status_code=502,
        )
    logger.info(
        "entities_ok",
        extra={
            "count": len(all_entities),
            "successful_types": successful_types,
            "search": search,
        },
    )
    return {"entities": all_entities}
