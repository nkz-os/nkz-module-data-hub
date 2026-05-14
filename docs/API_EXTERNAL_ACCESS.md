---
title: External API Access (PAT)
description: Connect external applications (PowerBI, Tableau, Python, custom apps) to Nekazari via Personal Access Tokens.
sidebar:
  order: 5
---

# External API Access via Personal Access Tokens

External applications can extract tenant data from Nekazari without a browser session by using **Personal Access Tokens (PATs)**. Each PAT has a set of **scopes** that control which data categories it can read.

## Creating a PAT

1. Open **DataHub → Integrations** tab
2. Enter a name for the token
3. Select the required scopes (checkboxes)
4. Choose an expiry (default: 365 days)
5. Click **Create**
6. **Copy the token immediately** — it is shown only once

The token has the format `nkz_pat_<random>` and is used as a Bearer token.

## Scopes

| Scope | Read access |
|-------|------------|
| `timeseries` | Historical weather and telemetry data via `/api/timeseries/*` |
| `entities` | NGSI-LD entity queries via `/ngsi-ld/v1/entities*` and `/ngsi-ld/v1/entityOperations/query` |
| `export` | CSV and Parquet export via `/api/datahub/export` |
| `telemetry` | Latest device telemetry via `/api/devices/*` and `/api/sensors*` |

All scopes are **read-only**. PATs cannot create, update, or delete entities.

## Using the PAT

Set the `Authorization` header on every request:

```
Authorization: Bearer nkz_pat_<your-token>
```

### Pagination limits

- Entity queries via PAT are capped at **500 entities per page**
- If no `limit` is specified, a default of **100** is injected
- Export via PAT is capped at **10,000 rows**

Use the NGSI-LD `Link` response header to iterate through pages.

### Example: Python

```python
import requests

PAT = "nkz_pat_..."
BASE = "https://nkz.robotika.cloud"

headers = {"Authorization": f"Bearer {PAT}"}

# Query entities
r = requests.get(
    f"{BASE}/ngsi-ld/v1/entities",
    params={"type": "AgriParcel", "limit": 100},
    headers=headers,
)
parcels = r.json()

# Query timeseries
r = requests.get(
    f"{BASE}/api/timeseries/v2/entities/urn:ngsi-ld:WeatherObserved:station-1/data",
    params={
        "start_time": "2026-01-01T00:00:00Z",
        "end_time": "2026-01-31T00:00:00Z",
        "attribute": "temperature",
        "resolution": 200,
    },
    headers=headers,
)
data = r.json()

# Export as Parquet
r = requests.post(
    f"{BASE}/api/datahub/export",
    json={
        "start_time": "2026-01-01T00:00:00Z",
        "end_time": "2026-01-31T00:00:00Z",
        "series": [{"entity_id": "urn:ngsi-ld:WeatherObserved:station-1", "attribute": "temperature"}],
        "format": "parquet",
    },
    headers=headers,
)
presigned_url = r.json()["download_url"]
```

### Example: PowerBI / Tableau

1. Create a PAT with `timeseries` and `export` scopes
2. In PowerBI: **Get Data → Web** → enter `https://nkz.robotika.cloud/api/timeseries/v2/query`
3. Set header: `Authorization` = `Bearer nkz_pat_<your-token>`
4. Use the **Advanced** editor to build the POST body

Alternatively, export as Parquet via the `/api/datahub/export` endpoint and use PowerBI's Parquet connector with the presigned URL.

## Revocation

- Revoke a PAT from **DataHub → Integrations** at any time
- Revoked tokens are invalidated within **5 minutes** (Redis cache TTL)
- Expired tokens are rejected automatically

## Security

- Tokens are 256-bit random strings (infeasible to brute-force)
- Only the SHA-256 hash is stored in the database
- All traffic is HTTPS-only
- Tokens are transmitted in the `Authorization` header, never in URLs
- Logs redact PAT tokens automatically
