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

# Entity types to query from Orion-LD. Configurable via env var so new or
# renamed types (e.g. SDM migrations) don't require a rebuild.
_ENTITY_TYPES_DEFAULT = [
    "AgriParcel", "AgriSensor", "WeatherObserved", "WeatherStation",
    "ManufacturingMachine", "AutonomousMobileRobot",
    "LivestockAnimal", "Device", "CropHealthAssessment", "VegetationIndex",
]
_ENTITY_TYPES = [
    t.strip()
    for t in os.getenv("DATAHUB_ENTITY_TYPES", "").split(",")
    if t.strip()
] or _ENTITY_TYPES_DEFAULT

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
    "deltaT": "delta_t",
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
    Normalize an NGSI-LD attribute name for the timeseries-reader.

    Handles both short names (temperature) and SAREF/URI names
    (https://saref.etsi.org/core/Temperature) by extracting the last URI
    segment.

    Previously this function enforced a strict whitelist (_TELEMETRY_VALID_ATTRS
    and _WEATHER_VALID_COLUMNS). That was too restrictive: most entities store
    their timeseries data in TimescaleDB, not as Orion-LD property values, so
    the whitelist check prevented newly-added attributes from appearing in the
    DataHub tree. Now we accept any non-empty attribute name and let the
    timeseries-reader validate availability at query time.

    Returns None only for truly empty/blank names.
    """
    name = (attr_name or "").strip()
    if not name:
        return None

    # Extract short name from full URI (e.g. https://saref.etsi.org/core/Temperature → Temperature)
    short_name = name.rsplit("/", 1)[-1] if "/" in name else name

    # Still apply the attribute mapping for well-known NGSI-LD → timescale column
    # aliases (e.g. temperature → temp_avg, relativeHumidity → humidity_avg).
    # This ensures the timeseries-reader receives the column name it expects.
    attr_lower = short_name.lower()
    _weather_attr_map_lower = {k.lower(): v for k, v in _WEATHER_ATTR_MAP.items()}
    if attr_lower in _weather_attr_map_lower:
        return _weather_attr_map_lower[attr_lower]

    # For all other attributes, return the short name as-is.
    # The timeseries-reader will return empty data if the attribute doesn't exist.
    return short_name


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
    if raw_name is not None and str(raw_name).strip():
        name = str(raw_name).strip()
    else:
        # Fall back to the last segment of the URN (e.g. "station123" from
        # "urn:ngsi-ld:WeatherObserved:tenant:station123")
        name = entity_id.rsplit(":", 1)[-1] if ":" in entity_id else entity_id

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
        # Accept: any Property (numeric, string, null, array, etc.).
        # The timeseries-reader validates availability at query time.
        # Previously we required numeric values here, but most entities have
        # their timeseries data in TimescaleDB, not as Orion-LD property values.
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
    """Fetch entities of a given type from Orion-LD."""
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
    List entities that have timeseries data, queried per type from Orion-LD.
    Entity types are configured via DATAHUB_ENTITY_TYPES env var so new SDM
    types don't require a rebuild. _norm_entity filters which entities have
    plottable attributes.
    """
    if not PLATFORM_API_URL:
        return {"entities": []}

    all_entities: list[dict] = []
    successful_types = 0
    failures: list[str] = []
    for etype in _ENTITY_TYPES:
        try:
            raw = await _fetch_ngsi_entities(
                PLATFORM_API_URL, etype, authorization, x_tenant_id
            )
            successful_types += 1
            for e in raw:
                rec = _norm_entity(e, etype)
                if not rec.get("attributes"):
                    continue
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
            "types_queried": _ENTITY_TYPES,
            "search": search,
        },
    )
    return {"entities": all_entities}
