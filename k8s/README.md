# DataHub module — Kubernetes manifests

- **Deployment** and **Service** are in this directory; ArgoCD app `datahub` syncs from repo `nkz-module-datahub`, path `k8s`.
- **ConfigMap `datahub-api-config`** is **not** in this repo to avoid ArgoCD shared-resource conflict. It is provided by the platform repo overlay:
  - **ArgoCD:** app `datahub-config` syncs `nkz` repo, path `gitops/overlays/datahub` and creates the ConfigMap with production values (`PLATFORM_API_URL`, `TIMESERIES_ADAPTER_*`).
  - **Standalone deploy:** create the ConfigMap manually with at least `PLATFORM_API_URL` and optional `TIMESERIES_ADAPTER_VEGETATION_HEALTH_URL`.
