/**
 * PAT management + Power BI / Excel hints (ADR 003). Uses platform /api/tenant/api-keys via cookie auth.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '@nekazari/sdk';
import type { ChartSeriesDef, GlobalTimeContext } from '../types/dashboard';
import {
  createTenantPat,
  getBaseUrl,
  listTenantPats,
  revokeTenantPat,
  type TenantPatMeta,
} from '../services/datahubApi';

export interface IntegrationsPanelProps {
  panels: Array<{ series: ChartSeriesDef[] }>;
  timeContext: GlobalTimeContext;
}

function buildExampleQueryBody(
  series: ChartSeriesDef[],
  startTime: string,
  endTime: string,
  resolution: number
): object {
  const s = series.slice(0, 5).map((x) => ({
    entity_urn: x.entityId,
    attribute: x.attribute,
  }));
  return {
    time_from: startTime,
    time_to: endTime,
    resolution,
    series: s.length > 0 ? s : [{ entity_urn: 'urn:ngsi-ld:AgriSensor:tenant:device', attribute: 'airTemperature' }],
  };
}

export const IntegrationsPanel: React.FC<IntegrationsPanelProps> = ({ panels, timeContext }) => {
  const { t } = useTranslation('datahub');
  const [items, setItems] = useState<TenantPatMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);

  const apiRoot = getBaseUrl().replace(/\/$/, '');
  const queryUrl = apiRoot ? `${apiRoot}/api/timeseries/v2/query` : '/api/timeseries/v2/query';
  const firstSeries =
    panels.find((p) => p.series && p.series.length > 0)?.series ?? [];
  const exampleBody = buildExampleQueryBody(
    firstSeries,
    timeContext.startTime,
    timeContext.endTime,
    timeContext.resolution ?? 200
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listTenantPats();
      setItems(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onCreate = async () => {
    const n = name.trim() || t('integrations.defaultTokenName');
    setCreating(true);
    setNewToken(null);
    setError(null);
    try {
      const res = await createTenantPat({ name: n });
      setNewToken(res.token);
      setName('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const onRevoke = async (id: string) => {
    if (!window.confirm(t('integrations.confirmRevoke'))) return;
    try {
      await revokeTenantPat(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 text-slate-200 space-y-8">
      <div>
        <h3 className="text-lg font-semibold text-white mb-2">{t('integrations.title')}</h3>
        <p className="text-slate-400 text-sm">{t('integrations.description')}</p>
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-950/40 border border-red-900 rounded p-3" role="alert">
          {error}
        </div>
      )}

      <section className="space-y-3 border border-slate-800 rounded-lg p-4 bg-slate-900/50">
        <h4 className="font-medium text-slate-300">{t('integrations.createSection')}</h4>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('integrations.namePlaceholder')}
            className="flex-1 min-w-[200px] bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={creating}
            onClick={() => void onCreate()}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded text-sm text-white"
          >
            {creating ? t('integrations.creating') : t('integrations.create')}
          </button>
        </div>
        {newToken && (
          <div className="mt-3 p-3 bg-amber-950/30 border border-amber-800 rounded text-sm">
            <p className="text-amber-200 mb-2 font-medium">{t('integrations.tokenOnce')}</p>
            <code className="block break-all text-amber-100 bg-slate-950 p-2 rounded mb-2">{newToken}</code>
            <button
              type="button"
              onClick={() => void copy(newToken)}
              className="text-xs text-amber-300 underline"
            >
              {t('integrations.copy')}
            </button>
          </div>
        )}
      </section>

      <section className="space-y-2 border border-slate-800 rounded-lg p-4 bg-slate-900/50">
        <h4 className="font-medium text-slate-300">{t('integrations.listSection')}</h4>
        {loading ? (
          <p className="text-slate-500 text-sm">{t('integrations.loading')}</p>
        ) : items.length === 0 ? (
          <p className="text-slate-500 text-sm">{t('integrations.empty')}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {items.map((row) => (
              <li
                key={row.id}
                className="flex justify-between items-center gap-2 border border-slate-800 rounded px-3 py-2"
              >
                <div>
                  <div className="font-mono text-slate-300">{row.name}</div>
                  <div className="text-xs text-slate-500">
                    {row.is_active ? t('integrations.active') : t('integrations.inactive')} · {row.id}
                  </div>
                </div>
                {row.is_active && (
                  <button
                    type="button"
                    onClick={() => void onRevoke(row.id)}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    {t('integrations.revoke')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 border border-slate-800 rounded-lg p-4 bg-slate-900/50">
        <h4 className="font-medium text-slate-300">{t('integrations.powerBiTitle')}</h4>
        <dl className="text-sm space-y-2 text-slate-400">
          <div>
            <dt className="text-slate-500">{t('integrations.endpoint')}</dt>
            <dd>
              <code className="text-emerald-400 break-all">{queryUrl}</code>
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">{t('integrations.method')}</dt>
            <dd>
              <code className="text-slate-300">POST</code>
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">{t('integrations.header')}</dt>
            <dd>
              <code className="text-slate-300 break-all">Authorization: Bearer nkz_pat_…</code>
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">{t('integrations.bodyExample')}</dt>
            <dd>
              <pre className="mt-1 p-3 bg-slate-950 rounded text-xs text-slate-300 overflow-x-auto">
                {JSON.stringify(exampleBody, null, 2)}
              </pre>
              <button
                type="button"
                onClick={() => void copy(JSON.stringify(exampleBody, null, 2))}
                className="text-xs text-emerald-400 underline mt-1"
              >
                {t('integrations.copy')}
              </button>
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
};
