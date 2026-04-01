# DataHub module — Kubernetes manifests

- **Deployment** and **Service** are in this directory; ArgoCD app **`datahub`** syncs from GitHub repo **`nkz-os/nkz-module-data-hub`**, path **`k8s/`** (see `nkz/gitops/modules/datahub.yaml`).
- **ConfigMap `datahub-api-config`** is **not** in this repo (avoids ArgoCD shared-resource conflict). Platform overlay:
  - **ArgoCD app `datahub-config`** syncs the `nkz` repo, path `gitops/overlays/datahub`, and creates the ConfigMap (`PLATFORM_API_URL`, `TIMESERIES_ADAPTER_*`, etc.).
  - **Standalone:** create the ConfigMap manually with at least `PLATFORM_API_URL`.

## Backend image (GHCR)

- CI: **`.github/workflows/build-push.yml`** builds `./backend/Dockerfile` and pushes to  
  **`ghcr.io/nkz-os/nkz-module-datahub/datahub-backend`** (`:latest` on `main`, plus SHA tags).
- **ArgoCD only applies YAML**; it does not rebuild images. After a new image is pushed, **restart the workload** so nodes pull the new `:latest` digest:

  ```bash
  kubectl rollout restart deployment/datahub-api -n nekazari
  kubectl rollout status deployment/datahub-api -n nekazari
  ```

- **`imagePullPolicy: Always`** is set on the Deployment; a restart is still required for running pods to use the new digest when the tag string stays `latest`.
