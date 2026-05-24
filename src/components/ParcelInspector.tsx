import React from 'react';
import { useParcelCapabilities } from '../hooks/useCapability';
import { useTranslation } from '@nekazari/sdk';

type Props = { parcelId: string; tenantEntitlements: string[]; apiBase?: string };

type AttrValue = {
  type: string;
  value: unknown;
  providedBy?: { value: string };
  license?: { value: string };
  observedAt?: string;
};

export function ParcelInspector({ parcelId, tenantEntitlements, apiBase }: Props) {
  const { t } = useTranslation('datahub');
  const state = useParcelCapabilities(parcelId, apiBase);

  if (state.status === 'loading') return <div aria-busy="true">{t('capability.loading')}</div>;
  if (state.status === 'error') return <div role="alert">{t('capability.error', { message: state.error })}</div>;

  const { capabilities, currentEntities } = state.data;

  // Phase 1: scalar/polygon-aggregated only. Per-zone/raster/H3 land in Phase 3.
  const scalarOnly = capabilities.filter(
    (c) => c.spatial === 'polygon-aggregated' || c.spatial === 'scalar-parcel'
  );

  return (
    <div className="nkz-parcel-inspector p-4 overflow-auto">
      <h2 className="text-lg font-semibold text-slate-200 mb-3">
        {t('capability.inspector_title', { parcelId })}
      </h2>
      <table className="w-full text-sm text-slate-300 border-collapse">
        <thead>
          <tr className="text-left text-slate-400 border-b border-white/10">
            <th className="pb-2 pr-4">{t('capability.catalog_attribute')}</th>
            <th className="pb-2 pr-4">Value</th>
            <th className="pb-2 pr-4">{t('capability.catalog_unit')}</th>
            <th className="pb-2 pr-4">Source</th>
            <th className="pb-2 pr-4">License</th>
            <th className="pb-2">Observed</th>
          </tr>
        </thead>
        <tbody>
          {scalarOnly.map((cap) => {
            const locked = !tenantEntitlements.includes(cap.entitlement);
            const entity = currentEntities[cap.entityType]?.[0];
            const raw = entity
              ? (entity as Record<string, AttrValue>)[cap.attributeName]
              : undefined;

            return (
              <tr
                key={`${cap.entityType}-${cap.attributeName}`}
                className={`border-b border-white/5 hover:bg-white/5 ${locked ? 'nkz-locked opacity-60' : ''}`}
              >
                <td className="py-1.5 pr-4 font-medium">
                  {cap.entityType}.{cap.attributeName}
                </td>
                <td className="py-1.5 pr-4">
                  {locked
                    ? <span className="text-amber-400 text-xs">{t('capability.inspector_entitlement_required')}</span>
                    : raw?.value !== undefined
                      ? String(raw.value)
                      : <span className="text-slate-500">{t('capability.inspector_no_data')}</span>}
                </td>
                <td className="py-1.5 pr-4 text-slate-400">{cap.unitCode ?? '—'}</td>
                <td className="py-1.5 pr-4 text-slate-400">{raw?.providedBy?.value ?? '—'}</td>
                <td className="py-1.5 pr-4 text-slate-400">{raw?.license?.value ?? '—'}</td>
                <td className="py-1.5 text-slate-400 text-xs">{raw?.observedAt ?? '—'}</td>
              </tr>
            );
          })}
          {scalarOnly.length === 0 && (
            <tr>
              <td colSpan={6} className="py-4 text-center text-slate-500">
                {t('capability.inspector_no_data')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
