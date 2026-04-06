# DataHub module — Kubernetes manifests

- **Deployment** and **Service** are in this directory; ArgoCD app **`datahub`** syncs from GitHub repo **`nkz-os/nkz-module-data-hub`**, path **`k8s/`** (see `nkz/gitops/modules/datahub.yaml`).
- **ConfigMap `datahub-api-config`** is **not** in this repo (avoids ArgoCD shared-resource conflict). Platform overlay:
  - **ArgoCD app `datahub-config`** syncs the `nkz` repo, path `gitops/overlays/datahub`, and creates the ConfigMap (`PLATFORM_API_URL`, `TIMESERIES_ADAPTER_*`, etc.).
  - **Standalone:** create the ConfigMap manually with at least `PLATFORM_API_URL`.

## Backend image (GHCR)

- CI: **`.github/workflows/build-push.yml`** builds `./backend/Dockerfile` and pushes to  
  **`ghcr.io/nkz-os/nkz-module-data-hub/datahub-backend`** (`:latest` on `main`, plus SHA tags; path matches the Git repo so `GITHUB_TOKEN` can publish).
- **ArgoCD only applies YAML**; it does not rebuild images. After a new image is pushed, **restart the workload** so nodes pull the new `:latest` digest:

  ```bash
  kubectl rollout restart deployment/datahub-api -n nekazari
  kubectl rollout status deployment/datahub-api -n nekazari
  ```

- **`imagePullPolicy: Always`** is set on the Deployment; a restart is still required for running pods to use the new digest when the tag string stays `latest`.

## Frontend IIFE (MinIO)

- CI: **`.github/workflows/build-push.yml`** builds the module bundle (`pnpm run build:module` → `dist/nkz-module.js`) and uploads an artifact.
- **Automatic upload to MinIO** runs on `main` when repository secrets are set (same names as JupyterLite): `MINIO_ENDPOINT_URL`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`. Target: `s3://nekazari-frontend/modules/datahub/nkz-module.js`.
- If secrets are missing, the job still passes; upload the artifact manually or use `mc cp` to `nekazari-frontend/modules/datahub/nkz-module.js`.

## Public repo and credentials (no private fork required)

- **Do not** commit MinIO keys, kubeconfigs, or passwords in this repository. The workflow only references **GitHub Actions secrets** (`MINIO_ENDPOINT_URL`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`); values are configured under **Repository settings → Secrets and variables → Actions** (or org-level secrets). They are **not** visible in logs when masked and are **not** part of the git history.
- A **single public repo** is enough: self-hosters omit those secrets and use the build artifacts; your team adds secrets only on the **`nkz-os` org or this repo** so `main` can push to your MinIO. You do **not** need a separate private clone of the repo just to store secrets.
- **Pull requests from forks** do not receive repository secrets; workflows that need MinIO should keep using branch/PR checks without deploy, or rely on `main` after merge (as in the current workflow).
