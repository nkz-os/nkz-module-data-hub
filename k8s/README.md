# DataHub module — Kubernetes manifests

- **Deployment** and **Service** are in this directory; ArgoCD app **`datahub`** syncs from GitHub repo **`nkz-os/nkz-module-data-hub`**, path **`k8s/`** (see `nkz/gitops/modules/datahub.yaml`).
- **ConfigMap `datahub-api-config`** is **not** in this repo with real values (avoids ArgoCD shared-resource conflict). Two-tier pattern:
  - **Template:** `k8s/configmap.yaml` in this repo documents every env var with empty/placeholder values. Use it as reference.
  - **Production overlay:** ArgoCD app **`datahub-config`** syncs the private `nkz-os/gitops-config` repo, path `overlays/modules/datahub`, and creates the ConfigMap with real values (`PLATFORM_API_URL`, `CORS_ORIGINS`, `TIMESERIES_ADAPTER_*`, `DATAHUB_ENTITY_TYPES`).
  - **Standalone:** copy `configmap.yaml`, fill in your values, and `kubectl apply -f`.

## Backend image (GHCR)

- CI: **`.github/workflows/build-push.yml`** builds `./backend/Dockerfile` and pushes to  
  **`ghcr.io/nkz-os/nkz-module-data-hub/datahub-backend`** (`:latest` on `main`, plus SHA tags; path matches the Git repo so `GITHUB_TOKEN` can publish).
- **ArgoCD only applies YAML**; it does not rebuild images. After a new image is pushed, **restart the workload** so nodes pull the new `:latest` digest:

  ```bash
  kubectl rollout restart deployment/datahub-api -n nekazari
  kubectl rollout status deployment/datahub-api -n nekazari
  ```

- **`imagePullPolicy: Always`** is set on the Deployment; a restart is still required for running pods to use the new digest when the tag string stays `latest`.

## Frontend (Module Federation 2.0 — MinIO)

- CI: **`.github/workflows/build-push.yml`** builds the module (`pnpm run build` → `dist/`) producing:
  - `dist/mf-manifest.json` — federation manifest (shared deps + exposes)
  - `dist/remoteEntry.js` — federation remote entry (loaded by host at runtime)
  - `dist/manifest.json` — NKZ data manifest (api-gateway CSP enforcement)
  - `dist/assets/` — sync/async chunks
- **Upload to MinIO** is manual from the production server. After CI builds the artifact:
  ```bash
  # On the production server:
  mc mirror --overwrite dist/ myminio/nekazari-frontend/modules/datahub/
  ```
  Then clean orphaned assets from previous builds:
  ```bash
  mc mirror --overwrite --remove dist/ myminio/nekazari-frontend/modules/datahub/
  ```
- **Database registration:** `marketplace_modules.remote_entry_url` must point to `/modules/datahub/mf-manifest.json` (not the legacy `nkz-module.js` path).

### Cleaning legacy IIFE artifacts

After confirming the MF2 deploy works, remove old IIFE files from MinIO:
```bash
mc rm myminio/nekazari-frontend/modules/datahub/nkz-module.js
mc rm myminio/nekazari-frontend/modules/datahub/nkz-module.js.bak-*
mc rm myminio/nekazari-frontend/modules/datahub/nkz-module.js.map
mc rm myminio/nekazari-frontend/modules/datahub/style.css
mc rm myminio/nekazari-frontend/modules/datahub/nekazari-module.js
```

## Public repo and credentials (no private fork required)

- **Do not** commit MinIO keys, kubeconfigs, or passwords in this repository. The workflow only references **GitHub Actions secrets** (`MINIO_ENDPOINT_URL`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`); values are configured under **Repository settings → Secrets and variables → Actions** (or org-level secrets). They are **not** visible in logs when masked and are **not** part of the git history.
- A **single public repo** is enough: self-hosters omit those secrets and use the build artifacts; your team adds secrets only on the **`nkz-os` org or this repo** so `main` can push to your MinIO. You do **not** need a separate private clone of the repo just to store secrets.
- **Pull requests from forks** do not receive repository secrets; workflows that need MinIO should keep using branch/PR checks without deploy, or rely on `main` after merge (as in the current workflow).
