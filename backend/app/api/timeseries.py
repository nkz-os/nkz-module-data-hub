"""
Timeseries BFF: proxy to platform reader v2 (single-source) and Polars merge (multi-source).
- GET /data → transparent proxy to reader v2/entities/<urn>/data (URN resolved by reader).
- POST /align → single-source timescale: passthrough to v2/query; multi-source: scatter-gather + Polars.
- POST /export → fetch Arrow via v2, format as CSV stream or Parquet (MinIO upload).
"""

import asyncio
import io
import os
from typing import Any, Optional
from urllib.parse import quote

import httpx
import pyarrow as pa
import pyarrow.ipc as ipc
import polars as pl
from fastapi import APIRouter, Header, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from app.common.logging_setup import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/datahub", tags=["datahub"])

PLATFORM_API_URL = os.getenv("PLATFORM_API_URL", "").rstrip("/")
ARROW_STREAM_TYPE = "application/vnd.apache.arrow.stream"


def _auth_headers(authorization: Optional[str], x_tenant_id: Optional[str]) -> dict:
    h: dict = {}
    if authorization:
        h["Authorization"] = authorization
    if x_tenant_id:
        h["X-Tenant-ID"] = x_tenant_id
    return h


def _get_adapter_base_url(source: str) -> Optional[str]:
    """Adapter base URL for a given source. timescale uses PLATFORM_API_URL; others from env or http://{source}:8000."""
    s = (source or "timescale").strip().lower()
    if s == "timescale":
        return PLATFORM_API_URL or None
    key = f"TIMESERIES_ADAPTER_{s.upper()}_URL"
    url = (os.getenv(key) or "").rstrip("/")
    if url:
        return url
    return f"http://{source}:8000"


def _short_entity_name(entity_id: str, attribute: str) -> str:
    """Build a CSV-friendly column name from entity_id + attribute.
    urn:ngsi-ld:AgriParcel:parcel_001 + temp_avg -> parcel_001.temp_avg
    """
    short_id = entity_id
    if ":" in entity_id:
        short_id = entity_id.rsplit(":", 1)[-1]
    # Sanitize for CSV (no commas, quotes, or newlines)
    clean = f"{short_id}.{attribute}".replace(",", "_").replace('"', "").replace("\n", "")
    return clean


def _parse_arrow_stream(body: bytes) -> pa.Table:
    """Read Arrow IPC stream from bytes into a single table."""
    return ipc.open_stream(body).read_all()


def _align_multi_source_to_df_sync(
    arrow_bodies: list[bytes],
    start_ts: float,
    end_ts: float,
    resolution: int,
    column_names: list[str] | None = None,
) -> pl.DataFrame:
    """
    CPU-bound: parse Arrow streams, build time grid, join_asof each series (LOCF).
    Run in thread pool via asyncio.to_thread. Returns aligned Polars DataFrame.
    column_names: optional list of meaningful names for each series (e.g. ["parcel_001.temp_avg"]).
    Falls back to value_0, value_1, ... if not provided.
    """
    resolution = max(2, min(resolution, 10000))
    grid_ts = pl.Series(
        "timestamp",
        [start_ts + (end_ts - start_ts) * i / (resolution - 1) for i in range(resolution)],
    )
    grid_df = pl.DataFrame({"timestamp": grid_ts})
    result_df = grid_df
    for idx, body in enumerate(arrow_bodies):
        col_name = column_names[idx] if column_names and idx < len(column_names) else f"value_{idx}"
        try:
            table = _parse_arrow_stream(body)
            df_series = pl.from_arrow(table)
        except Exception:
            result_df = result_df.with_columns(pl.lit(None).cast(pl.Float64).alias(col_name))
            continue
        if df_series.height == 0:
            result_df = result_df.with_columns(pl.lit(None).cast(pl.Float64).alias(col_name))
            continue
        if "timestamp" not in df_series.columns or "value" not in df_series.columns:
            result_df = result_df.with_columns(pl.lit(None).cast(pl.Float64).alias(col_name))
            continue
        df_series = df_series.sort("timestamp")
        joined = result_df.join_asof(
            df_series.select(["timestamp", "value"]),
            left_on="timestamp",
            right_on="timestamp",
            strategy="backward",
        )
        result_df = result_df.with_columns(joined.get_column("value").alias(col_name))
    return result_df


def _align_multi_source_to_arrow_ipc_sync(
    arrow_bodies: list[bytes],
    start_ts: float,
    end_ts: float,
    resolution: int,
) -> bytes:
    """CPU-bound: align to DataFrame then serialize to Arrow IPC bytes. Run in thread pool."""
    df = _align_multi_source_to_df_sync(arrow_bodies, start_ts, end_ts, resolution)
    out_table = df.to_arrow()
    sink = io.BytesIO()
    with ipc.new_stream(sink, out_table.schema) as writer:
        writer.write_table(out_table)
    return sink.getvalue()


def _batch_to_csv_bytes_sync(batch: pl.DataFrame, include_header: bool) -> bytes:
    """CPU-bound: write a single DataFrame slice to CSV bytes. Run in thread pool."""
    buf = io.BytesIO()
    batch.write_csv(buf, include_header=include_header)
    return buf.getvalue()


async def _stream_polars_csv(df: pl.DataFrame, chunk_rows: int = 10000):
    """
    Async generator: yield CSV chunks via iter_slices to avoid holding the full CSV in RAM.
    First chunk includes header; subsequent chunks do not.
    """
    first = True
    for batch in df.iter_slices(chunk_rows):
        chunk_bytes = await asyncio.to_thread(_batch_to_csv_bytes_sync, batch, include_header=first)
        first = False
        yield chunk_bytes


def _dataframe_to_parquet_minio_sync(df: pl.DataFrame, tenant_id: str) -> str:
    """
    CPU-bound: write DataFrame to SpooledTemporaryFile, upload to MinIO, return presigned URL.
    Run in thread pool. Requires S3_* env vars.
    """
    import tempfile
    import uuid
    spool_max = 25 * 1024 * 1024
    bucket = os.getenv("S3_BUCKET", "nekazari-frontend")
    prefix = "exports/"
    key = f"{prefix}{tenant_id}/{uuid.uuid4().hex}.parquet"
    # Default is in-cluster MinIO service name; set S3_ENDPOINT_URL per environment for other setups
    endpoint = os.getenv("S3_ENDPOINT_URL", "http://minio-service:9000")
    access = os.getenv("S3_ACCESS_KEY")
    secret = os.getenv("S3_SECRET_KEY")
    if not access or not secret:
        raise ValueError("S3_ACCESS_KEY and S3_SECRET_KEY required for Parquet export")
    import boto3
    from botocore.config import Config
    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access,
        aws_secret_access_key=secret,
        config=Config(signature_version="s3v4"),
        region_name=os.getenv("S3_REGION", "us-east-1"),
    )
    with tempfile.SpooledTemporaryFile(max_size=spool_max, mode="wb") as spool:
        df.write_parquet(spool, compression="snappy")
        spool.seek(0)
        client.upload_fileobj(
            spool,
            bucket,
            key,
            ExtraArgs={"ContentType": "application/vnd.apache.parquet"},
        )
    url = client.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=3600,
    )
    # Replace internal K8s hostname with external URL so browsers can resolve it
    external_url = os.getenv("S3_EXTERNAL_URL", "").rstrip("/")
    if external_url and endpoint:
        url = url.replace(endpoint.rstrip("/"), external_url, 1)
    return url


async def _fetch_entity_data_raw(
    client: httpx.AsyncClient,
    base_url: str,
    entity_id: str,
    attribute: str,
    start_time: str,
    end_time: str,
    resolution: int,
    headers: dict,
) -> bytes:
    """Fetch one entity's timeseries as Arrow IPC bytes from platform v2 reader.

    Requests JSON from the reader (api-gateway strips non-standard Accept headers,
    so Arrow negotiation fails) and converts to Arrow IPC locally.
    """
    path = quote(str(entity_id).strip(), safe="")
    url = f"{base_url}/api/timeseries/v2/entities/{path}/data"
    params = {
        "time_from": start_time,
        "time_to": end_time,
        "attrs": attribute,
        "resolution": resolution,
    }
    r = await client.get(url, params=params, headers={**headers, "Accept": "application/json"})
    r.raise_for_status()
    data = r.json()
    return _json_response_to_arrow_ipc(data, attribute)


async def _fetch_from_timescale(
    series_group: list[dict],
    payload: dict,
    headers: dict,
) -> bytes:
    """
    One Arrow IPC buffer for a group of platform (Timescale) series.
    Single series: GET timeseries-reader /v2/entities/.../data.
    Multiple: POST timeseries-reader /v2/query (SQL align in DB; BFF must not join in Polars).
    """
    base = PLATFORM_API_URL
    if not base:
        raise ValueError("PLATFORM_API_URL not configured")
    start_time = payload["start_time"]
    end_time = payload["end_time"]
    resolution = int(payload.get("resolution", 1000))
    async with httpx.AsyncClient(timeout=60.0) as client:
        if len(series_group) == 1:
            s = series_group[0]
            return await _fetch_entity_data_raw(
                client, base, s["entity_id"], s["attribute"],
                start_time, end_time, resolution, headers,
            )
        url = f"{base}/api/timeseries/v2/query"
        body = {
            "time_from": start_time,
            "time_to": end_time,
            "resolution": min(max(resolution, 100), 10000),
            "series": [
                {"entity_urn": s["entity_id"], "attribute": s["attribute"]}
                for s in series_group
            ],
        }
        r = await client.post(
            url,
            json=body,
            headers={**headers, "Content-Type": "application/json", "Accept": "application/json"},
        )
        r.raise_for_status()
        data = r.json()
        return _json_response_to_arrow_ipc(data)


async def _fetch_from_external_module(
    source: str,
    series_group: list[dict],
    payload: dict,
    authorization: Optional[str],
) -> bytes:
    """
    POST to module internal export-arrow endpoint. Contract: POST /api/internal/timeseries/export-arrow
    with body { series: [{ entity_id, attribute, source? }], start_time, end_time, resolution }.
    """
    base = _get_adapter_base_url(source)
    if not base:
        raise ValueError(f"No adapter URL for source: {source}")
    url = f"{base.rstrip('/')}/api/internal/timeseries/export-arrow"
    body = {
        "series": [{"entity_id": s["entity_id"], "attribute": s["attribute"], "source": s.get("source", source)} for s in series_group],
        "start_time": payload["start_time"],
        "end_time": payload["end_time"],
        "resolution": int(payload.get("resolution", 1000)),
    }
    headers: dict = {"Content-Type": "application/json", "Accept": ARROW_STREAM_TYPE}
    if authorization:
        headers["Authorization"] = authorization
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(url, json=body, headers=headers)
        if r.status_code != 200:
            raise RuntimeError(f"Module {source} returned {r.status_code}: {r.text[:500]}")
        return r.content


def _gather_arrow_to_aligned_df(arrow_bodies: list[bytes]) -> pl.DataFrame:
    """
    Read each Arrow IPC buffer into a DataFrame, outer-join on timestamp, flatten to value_0, value_1, ...
    Each buffer may have columns [timestamp, value] or [timestamp, value_0, value_1, ...].
    """
    if not arrow_bodies:
        raise ValueError("No Arrow buffers to merge")
    dataframes: list[pl.DataFrame] = []
    for raw in arrow_bodies:
        try:
            df = pl.read_ipc(io.BytesIO(raw))
        except Exception as e:
            raise ValueError(f"Invalid Arrow IPC: {e!s}") from e
        if df.height == 0:
            continue
        if "timestamp" not in df.columns:
            raise ValueError("Arrow table must have 'timestamp' column")
        value_cols = [c for c in df.columns if c != "timestamp" and (c == "value" or c.startswith("value_"))]
        if not value_cols:
            raise ValueError("Arrow table must have at least one value column")
        dataframes.append(df.select(["timestamp"] + value_cols))
    if not dataframes:
        raise ValueError("No non-empty DataFrames after parsing")
    global_idx = 0
    base = dataframes[0]
    v0 = [c for c in base.columns if c != "timestamp"]
    base = base.select(["timestamp"] + [pl.col(c).alias(f"value_{global_idx + i}") for i, c in enumerate(v0)])
    global_idx += len(v0)
    for next_df in dataframes[1:]:
        vcols = [c for c in next_df.columns if c != "timestamp"]
        next_renamed = next_df.select(
            ["timestamp"] + [pl.col(c).alias(f"value_{global_idx + i}") for i, c in enumerate(vcols)],
        )
        base = base.join(next_renamed, on="timestamp", how="full", coalesce=True)
        base = base.sort("timestamp")
        global_idx += len(vcols)
    return base.sort("timestamp")


def _aligned_df_to_arrow_ipc_bytes(df: pl.DataFrame) -> bytes:
    """Serialize aligned DataFrame (timestamp, value_0, value_1, ...) to Arrow IPC stream bytes."""
    table = df.to_arrow()
    sink = io.BytesIO()
    with ipc.new_stream(sink, table.schema) as writer:
        writer.write_table(table)
    return sink.getvalue()


@router.post("/timeseries/align")
async def proxy_timeseries_align(
    request: Request,
    authorization: Optional[str] = Header(None),
    x_tenant_id: Optional[str] = Header(None),
):
    """
    Hybrid alignment. Body: start_time, end_time, resolution, series: [{ entity_id, attribute, source? }].
    - Route A (single source, timescale): passthrough POST to platform /api/timeseries/v2/query
      (alignment in TimescaleDB). No Polars on this path.
    - Route B (multi-source or non-timescale): fetch per adapter, merge with Polars only for federation.
    """
    try:
        body: Any = await request.json()
    except Exception:
        return JSONResponse(content={"error": "Invalid JSON body"}, status_code=400)

    start_time = body.get("start_time")
    end_time = body.get("end_time")
    resolution = int(body.get("resolution", 1000))
    raw_series = body.get("series") or []
    if not start_time or not end_time:
        return JSONResponse(content={"error": "start_time and end_time required"}, status_code=400)
    if not isinstance(raw_series, list) or len(raw_series) < 2:
        return JSONResponse(content={"error": "series must be an array of at least 2 items"}, status_code=400)

    # Normalize series: { entity_id, attribute, source } with source default "timescale"
    series: list[dict] = []
    for i, item in enumerate(raw_series):
        if not isinstance(item, dict):
            return JSONResponse(content={"error": f"series[{i}] must be an object"}, status_code=400)
        eid = item.get("entity_id")
        attr = item.get("attribute")
        if not eid or not attr:
            return JSONResponse(content={"error": f"series[{i}] must have entity_id and attribute"}, status_code=400)
        source = (item.get("source") or "timescale")
        if hasattr(source, "strip"):
            source = str(source).strip().lower() or "timescale"
        else:
            source = "timescale"
        series.append({"entity_id": str(eid), "attribute": str(attr), "source": source})

    sources = {s["source"] for s in series}
    single_timescale = sources == {"timescale"} and len(sources) == 1

    # Route A: all series from Timescale — single passthrough POST to reader v2/query (no Polars).
    if single_timescale and PLATFORM_API_URL:
        headers = _auth_headers(authorization, x_tenant_id)
        res = min(max(resolution, 100), 10000)
        url = f"{PLATFORM_API_URL}/api/timeseries/v2/query"
        proxy_body = {
            "time_from": start_time,
            "time_to": end_time,
            "resolution": res,
            "series": [
                {"entity_urn": s["entity_id"], "attribute": s["attribute"]}
                for s in series
            ],
        }
        # Request JSON (api-gateway strips Accept header, so Arrow negotiation fails)
        req_headers = {**headers, "Content-Type": "application/json", "Accept": "application/json"}
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                r = await client.post(url, json=proxy_body, headers=req_headers)
        except httpx.HTTPStatusError as e:
            return JSONResponse(
                content={"error": e.response.text or f"Upstream {e.response.status_code}"},
                status_code=e.response.status_code,
            )
        except Exception as e:
            return JSONResponse(content={"error": f"Timeseries align failed: {e!s}"}, status_code=502)
        if r.status_code >= 400:
            try:
                body_err = r.json()
            except Exception:
                body_err = {"error": r.text or f"Upstream {r.status_code}"}
            return JSONResponse(content=body_err, status_code=r.status_code)
        try:
            data = r.json()
        except Exception:
            return JSONResponse(content={"error": "Invalid JSON from timeseries reader"}, status_code=502)
        json_data = _reader_json_to_frontend_json(data)
        if not json_data.get("timestamps"):
            return Response(status_code=204)
        return JSONResponse(content=json_data)

    # Route B: Scatter-Gather by source — group by source, one Arrow buffer per source, then merge with Polars
    resolution = min(max(resolution, 100), 10000)
    headers = _auth_headers(authorization, x_tenant_id)
    resolved_series_align = list(series)

    payload = {"start_time": start_time, "end_time": end_time, "resolution": resolution}
    sources_map: dict[str, list[dict]] = {}
    for s in resolved_series_align:
        src = (s.get("source") or "timescale").strip().lower() or "timescale"
        sources_map.setdefault(src, []).append(s)

    tasks: list[asyncio.Task] = []
    task_sources: list[str] = []
    for source, group in sources_map.items():
        task_sources.append(source)
        if source == "timescale":
            tasks.append(asyncio.create_task(_fetch_from_timescale(group, payload, headers)))
        else:
            tasks.append(
                asyncio.create_task(_fetch_from_external_module(source, group, payload, authorization)),
            )

    results = await asyncio.gather(*tasks, return_exceptions=True)
    arrow_bodies: list[bytes] = []
    for source, res in zip(task_sources, results):
        if isinstance(res, Exception):
            return JSONResponse(
                content={"error": f"Error obteniendo datos de {source}: {res!s}"},
                status_code=502,
            )
        arrow_bodies.append(res)

    if not arrow_bodies:
        return JSONResponse(content={"error": "No se obtuvieron datos de ningún origen"}, status_code=400)

    try:
        aligned_df = await asyncio.to_thread(_gather_arrow_to_aligned_df, arrow_bodies)
        result_bytes = await asyncio.to_thread(_aligned_df_to_arrow_ipc_bytes, aligned_df)
    except ValueError as e:
        return JSONResponse(content={"error": str(e)}, status_code=502)

    # Convert Arrow IPC → JSON for browser
    try:
        json_data = await asyncio.to_thread(_arrow_bytes_to_json, result_bytes)
    except Exception as e:
        return JSONResponse(content={"error": f"Arrow decode failed: {e!s}"}, status_code=502)
    if not json_data.get("timestamps"):
        return Response(status_code=204)
    return JSONResponse(content=json_data)


def _json_response_to_arrow_ipc(data: dict, single_attr: str | None = None) -> bytes:
    """Convert reader JSON response to Arrow IPC stream bytes.

    Reader JSON shapes:
      Single attr:   {timestamps: [...], values: [...]}
      Multi attr:    {timestamps: [...], attributes: {attr: [vals...]}}
    """
    ts_raw = data.get("timestamps") or []
    from datetime import datetime as _dt

    timestamps: list[float] = []
    for t in ts_raw:
        if isinstance(t, (int, float)):
            timestamps.append(float(t))
        elif isinstance(t, str):
            try:
                timestamps.append(_dt.fromisoformat(t.replace("Z", "+00:00")).timestamp())
            except Exception:
                timestamps.append(0.0)
        else:
            timestamps.append(0.0)

    if single_attr:
        vals = data.get("values") or []
        table = pa.table({"timestamp": pa.array(timestamps, type=pa.float64()),
                          "value": pa.array(vals if vals else [], type=pa.float64())})
    elif "values" in data:
        vals = data.get("values") or []
        table = pa.table({"timestamp": pa.array(timestamps, type=pa.float64()),
                          "value": pa.array(vals if vals else [], type=pa.float64())})
    elif "attributes" in data:
        attrs = data["attributes"]
        cols: dict = {"timestamp": pa.array(timestamps, type=pa.float64())}
        for i, (attr, vals) in enumerate(attrs.items()):
            cols[f"value_{i}"] = pa.array(vals if vals else [], type=pa.float64())
        table = pa.table(cols)
    else:
        table = pa.table({"timestamp": pa.array(timestamps, type=pa.float64())})

    sink = io.BytesIO()
    with ipc.new_stream(sink, table.schema) as writer:
        writer.write_table(table)
    return sink.getvalue()


def _arrow_bytes_to_json(raw: bytes) -> dict:
    """Convert Arrow IPC bytes to lightweight JSON {timestamps: [...], values: [...]}."""
    table = _parse_arrow_stream(raw)
    ts_col = table.column("timestamp")
    timestamps = ts_col.to_pylist()

    # Single value column
    if "value" in table.column_names:
        values = table.column("value").to_pylist()
        return {"timestamps": timestamps, "values": values}

    # Multi-value: value_0, value_1, ...
    value_arrays: dict[str, list] = {}
    idx = 0
    while f"value_{idx}" in table.column_names:
        value_arrays[f"value_{idx}"] = table.column(f"value_{idx}").to_pylist()
        idx += 1
    if not value_arrays and "value" not in table.column_names:
        # Fallback: take first non-timestamp column and normalize it to "values"
        # so the frontend doesn't need to know internal DB column names (temp_avg, etc.)
        for name in table.column_names:
            if name != "timestamp":
                return {"timestamps": timestamps, "values": table.column(name).to_pylist()}
    return {"timestamps": timestamps, **value_arrays}


def _reader_json_to_frontend_json(data: dict, single_attr: str | None = None) -> dict:
    """Convert timeseries-reader JSON to frontend format.

    Reader returns:  {timestamps: [ISO...], attributes: {attr: [vals...]}}
    Frontend wants:  {timestamps: [epoch_secs...], values: [...]}         (single)
                     {timestamps: [epoch_secs...], value_0: [...], ...}   (multi)
    """
    from datetime import datetime as _dt

    raw_ts = data.get("timestamps") or []
    attrs = data.get("attributes") or {}

    # If reader returned epoch floats already (Arrow JSON mode), keep them
    timestamps: list[float] = []
    for t in raw_ts:
        if isinstance(t, (int, float)):
            timestamps.append(float(t))
        elif isinstance(t, str):
            try:
                timestamps.append(_dt.fromisoformat(t.replace("Z", "+00:00")).timestamp())
            except Exception:
                continue
        else:
            continue

    # Single attr requested → {timestamps, values}
    if single_attr:
        vals = attrs.get(single_attr)
        if vals is None:
            # Reader may have resolved the attr name (e.g. temperature → temp_avg)
            for k, v in attrs.items():
                vals = v
                break
        return {"timestamps": timestamps, "values": vals or []}

    attr_keys = list(attrs.keys())
    if len(attr_keys) == 1:
        return {"timestamps": timestamps, "values": attrs[attr_keys[0]]}

    # Multi-attr → value_0, value_1, ...
    result: dict = {"timestamps": timestamps}
    for i, key in enumerate(attr_keys):
        col_name = key if key.startswith("value_") else f"value_{i}"
        result[col_name] = attrs[key]
    return result


@router.get("/timeseries/entities/{entity_id}/data")
async def proxy_timeseries_data(
    entity_id: str,
    request: Request,
    authorization: Optional[str] = Header(None),
    x_tenant_id: Optional[str] = Header(None),
):
    """
    Fetch timeseries from platform reader and return as lightweight JSON.
    BFF fetches Arrow IPC from the reader (efficient internal transfer) and converts
    to JSON {timestamps: [...], values: [...]} for the browser (no heavy Arrow lib needed).
    """
    if not PLATFORM_API_URL:
        logger.warning(
            "timeseries_data_no_platform",
            extra={"entity_id": entity_id},
        )
        return JSONResponse(
            content={"error": "PLATFORM_API_URL not configured"},
            status_code=503,
        )

    headers = _auth_headers(authorization, x_tenant_id)
    path = quote(str(entity_id).strip(), safe="")
    url = f"{PLATFORM_API_URL}/api/timeseries/v2/entities/{path}/data"
    qp = dict(request.query_params)
    if "start_time" in qp and "time_from" not in qp:
        qp["time_from"] = qp["start_time"]
    if "end_time" in qp and "time_to" not in qp:
        qp["time_to"] = qp["end_time"]
    if "attribute" in qp and "attrs" not in qp:
        qp["attrs"] = qp["attribute"]
    for redundant in ("start_time", "end_time", "attribute", "format"):
        qp.pop(redundant, None)

    # Request JSON from reader (api-gateway strips Accept header, so Arrow negotiation fails).
    req_headers = {**headers, "Accept": "application/json"}
    async with httpx.AsyncClient(timeout=60.0) as client:
        r = await client.get(url, params=qp, headers=req_headers)
        if r.status_code >= 400:
            try:
                body = r.json()
            except Exception:
                body = {"error": r.text or f"Upstream {r.status_code}"}
            logger.warning(
                "timeseries_data_upstream_error",
                extra={
                    "entity_id": entity_id,
                    "attribute": qp.get("attrs"),
                    "time_from": qp.get("time_from"),
                    "time_to": qp.get("time_to"),
                    "upstream_status": r.status_code,
                },
            )
            return JSONResponse(content=body, status_code=r.status_code)

        try:
            data = r.json()
        except Exception:
            logger.error(
                "timeseries_data_invalid_json",
                extra={"entity_id": entity_id, "attribute": qp.get("attrs")},
            )
            return JSONResponse(
                content={"error": "Invalid JSON response from timeseries reader"},
                status_code=502,
            )
        json_data = _reader_json_to_frontend_json(data, qp.get("attrs"))
        ts = json_data.get("timestamps") or []
        vals = json_data.get("values") or []
        logger.info(
            "timeseries_data_ok",
            extra={
                "entity_id": entity_id,
                "attribute": qp.get("attrs"),
                "time_from": qp.get("time_from"),
                "time_to": qp.get("time_to"),
                "resolution": qp.get("resolution"),
                "ts_len": len(ts),
                "vals_len": len(vals),
                "status": 204 if not ts else 200,
            },
        )
        if not ts:
            return Response(status_code=204)
        return JSONResponse(content=json_data)


def _resolution_from_aggregation(start_ts: float, end_ts: float, aggregation: str) -> int:
    """Compute resolution (number of points) from aggregation and time range."""
    delta = end_ts - start_ts
    if delta <= 0:
        return 1000
    agg = (aggregation or "1 hour").strip().lower()
    if agg == "raw":
        return min(10000, max(1000, int(delta / 60)))
    if agg == "1 day":
        return min(10000, max(100, int(delta / 86400)))
    if agg == "1 hour":
        return min(10000, max(100, int(delta / 3600)))
    return min(10000, max(100, int(delta / 3600)))


@router.post("/export")
async def proxy_export(
    request: Request,
    authorization: Optional[str] = Header(None),
    x_tenant_id: Optional[str] = Header(None),
):
    """
    Export timeseries as CSV or Parquet.
    Body: start_time, end_time, series: [{ entity_id, attribute, source? }], format, aggregation.
    - Single-source timescale: fetch aligned Arrow via v2/query, then format in BFF.
    - Multi-source: scatter-gather per adapter, Polars merge, then format.
    URN resolution is handled by the reader (Strangler Fig); BFF passes URNs directly.
    """
    try:
        body: Any = await request.json()
    except Exception:
        return JSONResponse(content={"error": "Invalid JSON body"}, status_code=400)

    start_time = body.get("start_time")
    end_time = body.get("end_time")
    raw_series = body.get("series") or []
    fmt = (body.get("format") or "csv").strip().lower()
    aggregation = (body.get("aggregation") or "1 hour").strip().lower()
    if fmt not in ("csv", "parquet"):
        return JSONResponse(content={"error": "format must be csv or parquet"}, status_code=400)
    if not start_time or not end_time:
        return JSONResponse(content={"error": "start_time and end_time required"}, status_code=400)
    if not isinstance(raw_series, list) or len(raw_series) == 0:
        return JSONResponse(content={"error": "series must be a non-empty array"}, status_code=400)

    series: list[dict] = []
    for i, item in enumerate(raw_series):
        if not isinstance(item, dict):
            return JSONResponse(content={"error": f"series[{i}] must be an object"}, status_code=400)
        eid = item.get("entity_id")
        attr = item.get("attribute")
        if not eid or not attr:
            return JSONResponse(content={"error": f"series[{i}] must have entity_id and attribute"}, status_code=400)
        source = (item.get("source") or "timescale")
        if hasattr(source, "strip"):
            source = str(source).strip().lower() or "timescale"
        else:
            source = "timescale"
        series.append({"entity_id": str(eid), "attribute": str(attr), "source": source})

    try:
        from datetime import datetime
        start_dt = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
        end_dt = datetime.fromisoformat(end_time.replace("Z", "+00:00"))
    except Exception:
        return JSONResponse(content={"error": "Invalid start_time or end_time format"}, status_code=400)
    start_ts = start_dt.timestamp()
    end_ts = end_dt.timestamp()
    if start_ts >= end_ts:
        return JSONResponse(content={"error": "start_time must be before end_time"}, status_code=400)
    resolution = _resolution_from_aggregation(start_ts, end_ts, aggregation)
    headers = _auth_headers(authorization, x_tenant_id)

    # Group by source and fetch Arrow buffers
    sources_map: dict[str, list[dict]] = {}
    for s in series:
        src = (s.get("source") or "timescale").strip().lower() or "timescale"
        sources_map.setdefault(src, []).append(s)

    payload = {"start_time": start_time, "end_time": end_time, "resolution": resolution}
    tasks: list[asyncio.Task] = []
    task_sources: list[str] = []
    for source, group in sources_map.items():
        task_sources.append(source)
        if source == "timescale":
            tasks.append(asyncio.create_task(_fetch_from_timescale(group, payload, headers)))
        else:
            tasks.append(
                asyncio.create_task(_fetch_from_external_module(source, group, payload, authorization)),
            )

    results = await asyncio.gather(*tasks, return_exceptions=True)
    arrow_bodies: list[bytes] = []
    for source, res in zip(task_sources, results):
        if isinstance(res, Exception):
            return JSONResponse(
                content={"error": f"Error fetching data from {source}: {res!s}"},
                status_code=502,
            )
        arrow_bodies.append(res)

    if not arrow_bodies:
        return JSONResponse(content={"error": "No data retrieved from any source"}, status_code=400)

    # Single Arrow buffer from one source: parse directly. Multiple: merge with Polars.
    col_names = [_short_entity_name(s["entity_id"], s["attribute"]) for s in series]
    if len(arrow_bodies) == 1:
        try:
            df = await asyncio.to_thread(lambda: pl.read_ipc(io.BytesIO(arrow_bodies[0])))
            # Rename value_N columns to meaningful names
            renames = {}
            for idx, name in enumerate(col_names):
                old = f"value_{idx}"
                if old in df.columns:
                    renames[old] = name
                elif "value" in df.columns and idx == 0:
                    renames["value"] = name
            if renames:
                df = df.rename(renames)
        except Exception as e:
            return JSONResponse(content={"error": f"Arrow parse failed: {e!s}"}, status_code=502)
    else:
        try:
            aligned_df = await asyncio.to_thread(_gather_arrow_to_aligned_df, arrow_bodies)
            # Rename value_N to meaningful names
            renames = {}
            for idx, name in enumerate(col_names):
                old = f"value_{idx}"
                if old in aligned_df.columns:
                    renames[old] = name
            df = aligned_df.rename(renames) if renames else aligned_df
        except ValueError as e:
            return JSONResponse(content={"error": str(e)}, status_code=502)

    if fmt == "csv":
        return StreamingResponse(
            _stream_polars_csv(df),
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="export.csv"'},
        )
    else:
        tenant_id = (x_tenant_id or "default").strip() or "default"
        try:
            download_url = await asyncio.to_thread(_dataframe_to_parquet_minio_sync, df, tenant_id)
        except ValueError as e:
            return JSONResponse(content={"error": str(e)}, status_code=503)
        return JSONResponse(
            content={"download_url": download_url, "expires_in": 3600, "format": "parquet"},
        )
