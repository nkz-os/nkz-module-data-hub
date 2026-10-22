import { useEffect, useState } from 'react';

export type CatalogEntry = {
  moduleId: string;
  moduleVersion: string;
  entityType: string;
  attributeName: string;
  unitCode: string | null;
  temporal: string;
  spatial: string;
  sources: string[];
  entitlement: string;
  sdmStatus: string;
  sdmProposal: string | null;
};

export type CapabilityCatalog = Record<string, CatalogEntry[]>;

export type ParcelCapabilities = {
  parcelId: string;
  capabilities: CatalogEntry[];
  currentEntities: Record<string, Array<Record<string, unknown>>>;
};

type State<T> =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ok'; data: T };

function useFetch<T>(url: string): State<T> {
  const [state, setState] = useState<State<T>>({ status: 'loading' });
  useEffect(() => {
    fetch(url, { credentials: 'include' })
      .then(async (r) => {
        if (!r.ok) { setState({ status: 'error', error: `HTTP ${r.status}` }); return; }
        setState({ status: 'ok', data: (await r.json()) as T });
      })
      .catch((e) => setState({ status: 'error', error: String(e) }));
  }, [url]);
  return state;
}

export function useCapabilityCatalog(apiBase = '') {
  return useFetch<CapabilityCatalog>(`${apiBase}/api/capability/catalog`);
}

export function useParcelCapabilities(parcelId: string, apiBase = '') {
  return useFetch<ParcelCapabilities>(`${apiBase}/api/capability/parcel/${encodeURIComponent(parcelId)}`);
}
