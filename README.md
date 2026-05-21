# NKZ DataHub Module

**DataHub** is a Nekazari platform module that provides a high-performance analytical canvas (Data Canvas) to cross variables from multiple timeseries sources, export time ranges as CSV or Parquet, and run predictive models via the Intelligence module.

|  |  |
|--|--|
| **Module ID** | `datahub` |
| **Repository** | [nkz-os/nkz-module-datahub](https://github.com/nkz-os/nkz-module-datahub) |
| **License** | AGPL-3.0 |

---

## Features

- **Multi-source timeseries**: Query and align series from NGSI-LD (Orion), TimescaleDB (platform), and pluggable adapters.
- **Aligned time grid**: All-Timescale alignment runs in **TimescaleDB** via platform `POST /api/timeseries/v2/query` (BFF is a passthrough). **Polars** is used only when **merging different sources** (e.g. Timescale + another module). Responses use Apache Arrow IPC with **Float64 epoch seconds** for `timestamp` (Web Worker / uPlot contract).
- **Platform telemetry contract** (2026-03): IoT points in Timescale are stored under `telemetry_events.payload.measurements` as a **flat JSON object** (keys = measurement names); the reader uses `->>` with a whitelist. Production index **`ix_telemetry_tenant_device_time`** `(tenant_id, device_id, observed_at DESC)` supports those queries. Details: [`docs/PLATFORM_TIMESERIES_INTEGRATION.md`](docs/PLATFORM_TIMESERIES_INTEGRATION.md).
- **Data Canvas UI** (`/datahub` route): Sidebar **DataTree** lists NGSI-LD entities; **click an entity** to expand attributes; **click an attribute** (or drag it) to add a **uPlot** panel on the tactical grid. Drag-and-drop onto the grid still works. Charts call the BFF with the per-attribute `source` (e.g. `timescale`, `vegetation_health`).
- **Export**: CSV (streaming) or Parquet (upload to MinIO + presigned URL). Route A: proxy to platform; Route B: multi-source gather + align in BFF.
- **Predictions**: SSE stream to Intelligence module for AI-based forecasts.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Nekazari Host (your host domain)                                │
│  Loads MF2 manifest: /modules/datahub/mf-manifest.json from MinIO │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│  API (your API domain)                                           │
│  /api/datahub/* → DataHub BFF (this module)                      │
│  /api/timeseries/* → Platform timeseries-reader (proxy optional)  │
└─────────────────────────────────────────────────────────────────┘
                                    │
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
┌───────────────┐         ┌─────────────────┐         ┌──────────────┐
│  DataHub BFF  │         │ Platform APIs   │         │  MinIO (S3)  │
│  (FastAPI)    │────────▶│ (entities,      │         │  Parquet     │
│  align/export │         │  timeseries)     │         │  exports     │
└───────────────┘         └─────────────────┘         └──────────────┘
```

- **Backend (BFF)**: FastAPI service. Proxies platform timeseries (v2 reader) without in-BFF joins for pure Timescale paths; uses Polars only for **multi-source** merge when needed. Returns Arrow IPC or CSV/Parquet.
- **Frontend**: Module Federation 2.0 bundle (`dist/remoteEntry.js` + `dist/assets/`), `main` route component **DataHubPage** (tree + **DataHubDashboard**), plus **DataHubQuickChart** in `bottom-panel`. Uses host-provided React, `@nekazari/sdk`, `@nekazari/ui-kit`; builds with `@nekazari/module-builder`.

---

## Requirements

- **Node**: 18+ (pnpm recommended)
- **Python**: 3.11+ (backend)
- **Platform**: Nekazari host and API; optional Intelligence module for predictions

---

## Repository structure

```
nkz-module-datahub/
├── backend/                 # BFF (FastAPI)
│   ├── app/
│   │   ├── api/
│   │   │   ├── entities.py   # GET /api/datahub/entities
│   │   │   └── timeseries.py  # align, entity data, export
│   │   └── main.py
│   ├── Dockerfile
│   └── requirements.txt
├── src/
│   ├── components/
│   │   └── DataTree.tsx      # entity / attribute sidebar
│   ├── slots/
│   │   ├── DataHubDashboard.tsx  # grid canvas, workspaces, lab tab
│   │   ├── DataHubQuickChart.tsx # bottom-panel slot
│   │   └── DataHubPanel.tsx      # legacy slot (if still referenced)
│   ├── DataHubPage.tsx       # main route: tree + dashboard
│   ├── services/
│   │   └── datahubApi.ts
│   └── moduleEntry.ts        # window.__NKZ__.register()
├── k8s/
│   ├── backend-deployment.yaml
│   └── configmap.yaml         # env var template (placeholder values)
├── dist/                      # build output (gitignored)
│   ├── mf-manifest.json       # federation manifest
│   ├── remoteEntry.js         # federation remote entry
│   └── assets/                # sync/async chunks
├── package.json
└── README.md
```

---

## API summary (BFF)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (200 OK) |
| GET | `/metrics` | Prometheus placeholder |
| GET | `/api/datahub/entities` | List entities with timeseries (optional `source`, default `timescale`) |
| POST | `/api/datahub/timeseries/align` | Multi-series alignment; body: `{ series: [{ entityId, attribute, source? }], start, end, resolution }`; returns Arrow IPC or JSON |
| GET | `/api/datahub/timeseries/entities/{id}/data` | Proxy to platform timeseries for single entity |
| POST | `/api/datahub/export` | Export aligned data: CSV (streaming) or Parquet (MinIO + presigned URL) |

All `/api/datahub/*` endpoints forward `Authorization` and `X-Tenant-ID` to the platform or adapters.

---

## Environment variables (BFF)

| Variable | Description |
|----------|-------------|
| `PLATFORM_API_URL` | **Base URL of the platform API gateway** (no path suffix). Must serve both **`/ngsi-ld/v1/entities`** (Orion proxy) and **`/api/timeseries/...`** (timeseries-reader proxy). In Kubernetes use the in-cluster gateway, e.g. `http://api-gateway-service:5000`. External URL (e.g. `https://nkz.example.com`) also works but adds latency. Do not set this to `timeseries-reader` alone — entity listing will fail. |
| `TIMESERIES_ADAPTER_<NAME>_URL` | Optional adapter base URL for non-timescale sources (e.g. `TIMESERIES_ADAPTER_CUSTOM_URL`) |
| `S3_ENDPOINT_URL`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | MinIO/S3 for Parquet export. `S3_ACCESS_KEY` and `S3_SECRET_KEY` belong in a Kubernetes Secret, not a ConfigMap. `S3_ENDPOINT_URL` defaults to `http://minio-service:9000`, `S3_BUCKET` defaults to `nekazari-frontend`, `S3_REGION` defaults to `us-east-1`. `S3_EXTERNAL_URL` (optional) provides browser-accessible presigned URLs. |
| `CORS_ORIGINS` | Optional comma-separated list of allowed CORS origins (defaults to localhost dev ports). |
| `DATAHUB_ENTITY_TYPES` | Optional comma-separated list of SDM entity types to expose in the DataHub tree. |
| `CONTEXT_URL` | NGSI-LD `@context` URL. Injected from the platform-level `nekazari-config` ConfigMap (not this module's ConfigMap). |
| `ENTITY_MANAGER_URL` | Optional override for entity-manager service (default: `http://entity-manager-service:5000`). |
| `ORION_URL` | Optional override for Orion-LD endpoint (defaults to `PLATFORM_API_URL`). |

---

## Local development

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
export PLATFORM_API_URL=https://your-api-domain
uvicorn app.main:app --reload --port 8000
```

### Frontend (standalone)

```bash
pnpm install
pnpm run dev
# Vite dev server; full integration requires the host app.
# Proxy targets local BFF (http://localhost:8000) by default. To use a remote API, set:
#   VITE_PROXY_TARGET=https://your-api-domain
```

### Build frontend module

```bash
pnpm run build
# Output: dist/remoteEntry.js, dist/mf-manifest.json, dist/assets/*
```

---

## Deployment

### Backend (Kubernetes)

1. **Build and push image** (from this repo):

   ```bash
   docker build -t ghcr.io/nkz-os/nkz-module-data-hub/datahub-backend:latest ./backend
   docker push ghcr.io/nkz-os/nkz-module-data-hub/datahub-backend:latest
   ```

2. **Apply manifests** (namespace `nekazari`):

   ```bash
   kubectl apply -f k8s/configmap.yaml -n nekazari
   kubectl apply -f k8s/backend-deployment.yaml -n nekazari
   ```

3. **Ingress**: The platform ingress must route `/api/datahub` to `datahub-api-service:8000`. Add a path rule before the generic `/api` catch-all, e.g.:

   ```yaml
   - path: /api/datahub
     pathType: Prefix
     backend:
       service:
         name: datahub-api-service
         port:
           number: 8000
   ```

### Frontend (MinIO — Module Federation 2.0)

1. Build: `pnpm run build` → `dist/` (mf-manifest.json, remoteEntry.js, assets/*)
2. Upload to MinIO from the production server: `mc mirror --overwrite dist/ myminio/nekazari-frontend/modules/datahub/` (use S3 API or `mc`, never write directly to MinIO filesystem).
3. Ensure `marketplace_modules.remote_entry_url` for `datahub` is `/modules/datahub/mf-manifest.json`.

### Marketplace registration

Run the SQL in `k8s/registration.sql` once per environment (or insert/update the `datahub` row in `marketplace_modules`). Tenants then enable the module via the UI (`tenant_installed_modules`).

### Production server checklist

1. **Platform ingress**: Ensure `/api/datahub` is routed to `datahub-api-service:8000`. The main platform repo (`nkz`) already includes this rule in `k8s/core/networking/ingress.yaml`; deploy it with the rest of the platform (e.g. `kubectl apply -f k8s/core/networking/ingress.yaml -n nekazari`).
2. **Backend image**: Build and push from this repo (or use CI). No secrets or hardcoded URLs in the image. The repo ships a ConfigMap with `PLATFORM_API_URL` empty; **override it per environment** (e.g. `kubectl create configmap datahub-api-config -n nekazari --from-literal=PLATFORM_API_URL=https://your-api-domain ...`) so the same manifests work for any domain. For Parquet export to MinIO, add `S3_*` env vars via a Secret.
3. **Frontend bundle**: Sync `dist/` to MinIO at `nekazari-frontend/modules/datahub/` using S3 API (`aws s3 sync dist/ s3://nekazari-frontend/modules/datahub/`). This uploads `mf-manifest.json`, `remoteEntry.js`, and `assets/`. Never write directly to the MinIO filesystem.
4. **Database**: Run `k8s/registration.sql` if the module is not yet in `marketplace_modules`.

---

## References

- **Platform timeseries (v2, telemetry shape, indexes)**: `docs/PLATFORM_TIMESERIES_INTEGRATION.md`
- **Mandate (BFF vs reader, Arrow)**: `docs/MANDATE_TIMESERIES_READER_STRANGLER.md`
- **Arrow IPC spec**: See `NKZ_DATAHUB_ARROW_SPEC.md` (in workspace) for binary format and schema (Float64 timestamp epoch seconds).
- **Adapters**: Optional multi-source adapters and env vars — see `ADAPTER_SPEC.md` in this repo.

---

## License

AGPL-3.0. See [LICENSE](LICENSE) in the repository.
