import React from 'react';
import { useCapabilityCatalog, type CatalogEntry } from '../hooks/useCapability';
import { useTranslation } from '@nekazari/sdk';

type Props = { tenantEntitlements: string[]; apiBase?: string };

export function CapabilityCatalog({ tenantEntitlements, apiBase }: Props) {
  const { t } = useTranslation('datahub');
  const state = useCapabilityCatalog(apiBase);

  if (state.status === 'loading') return <div aria-busy="true">{t('capability.loading')}</div>;
  if (state.status === 'error') return <div role="alert">{t('capability.error', { message: state.error })}</div>;

  const rows: CatalogEntry[] = Object.values(state.data).flat();

  return (
    <div className="nkz-capability-catalog p-4 overflow-auto">
      <h2 className="text-lg font-semibold dh-text-primary mb-3">{t('capability.catalog_title')}</h2>
      <table className="w-full text-sm dh-text-secondary border-collapse">
        <thead>
          <tr className="text-left dh-text-secondary border-b border-white/10">
            <th className="pb-2 pr-4">{t('capability.catalog_module')}</th>
            <th className="pb-2 pr-4">{t('capability.catalog_entity')}</th>
            <th className="pb-2 pr-4">{t('capability.catalog_attribute')}</th>
            <th className="pb-2 pr-4">{t('capability.catalog_unit')}</th>
            <th className="pb-2 pr-4">{t('capability.catalog_temporal')}</th>
            <th className="pb-2 pr-4">{t('capability.catalog_spatial')}</th>
            <th className="pb-2 pr-4">{t('capability.catalog_sources')}</th>
            <th className="pb-2 pr-4">{t('capability.catalog_entitlement')}</th>
            <th className="pb-2">{t('capability.catalog_sdm')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const locked = !tenantEntitlements.includes(r.entitlement);
            return (
              <tr
                key={`${r.entityType}-${r.attributeName}`}
                className={`border-b border-white/5 hover:bg-white/5 ${locked ? 'nkz-locked opacity-60' : ''}`}
              >
                <td className="py-1.5 pr-4 font-mono text-xs">{r.moduleId}@{r.moduleVersion}</td>
                <td className="py-1.5 pr-4">{r.entityType}</td>
                <td className="py-1.5 pr-4 font-medium">{r.attributeName}</td>
                <td className="py-1.5 pr-4 dh-text-secondary">{r.unitCode ?? '—'}</td>
                <td className="py-1.5 pr-4 dh-text-secondary">{r.temporal}</td>
                <td className="py-1.5 pr-4 dh-text-secondary">{r.spatial}</td>
                <td className="py-1.5 pr-4 dh-text-secondary">{r.sources.join(', ')}</td>
                <td className="py-1.5 pr-4">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${locked ? 'bg-amber-900/50 text-amber-300' : 'dh-accent-bg/50 dh-accent-text'}`}>
                    {r.entitlement}{locked ? ' 🔒' : ''}
                  </span>
                </td>
                <td className="py-1.5 dh-text-secondary text-xs">{r.sdmProposal ?? r.sdmStatus}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
