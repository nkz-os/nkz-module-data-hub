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

  const VALID_SCOPES = ['timeseries', 'entities', 'export', 'telemetry'] as const;
  type Scope = (typeof VALID_SCOPES)[number];

  const [scopes, setScopes] = useState<Scope[]>(['timeseries']);
  const [expiresDays, setExpiresDays] = useState<number>(365);

  const apiRoot = getBaseUrl().replace(/\/$/, '');
  // For external tools (Power BI, Excel), always show the full API URL.
  // When same-origin, use the base; otherwise use the env-configured API URL.
  const queryUrl = apiRoot
    ? `${apiRoot}/api/timeseries/v2/query`
    : `${(window as any).__ENV__?.VITE_API_URL ?? 'https://nkz.robotika.cloud'}/api/timeseries/v2/query`;
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
      const expires_at = expiresDays > 0
        ? new Date(Date.now() + expiresDays * 86400000).toISOString()
        : undefined;
      const res = await createTenantPat({ name: n, scopes, expires_at });
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
            disabled={creating || scopes.length === 0}
            onClick={() => void onCreate()}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded text-sm text-white"
          >
            {creating ? t('integrations.creating') : t('integrations.create')}
          </button>
        </div>

        {/* Scopes */}
        <fieldset className="text-sm text-slate-400 space-y-1">
          <legend className="text-slate-300 mb-1">
            {t('integrations.scopesLabel', { defaultValue: 'Permisos' })}
          </legend>
          {VALID_SCOPES.map((scope) => (
            <label key={scope} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={scopes.includes(scope)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setScopes([...scopes, scope]);
                  } else {
                    setScopes(scopes.filter((s) => s !== scope));
                  }
                }}
                className="accent-emerald-500"
              />
              <span className="text-slate-300">{scope}</span>
              <span className="text-xs text-slate-500">
                {scope === 'timeseries' && (t('integrations.scopeTimeseriesHint', { defaultValue: 'weather, telemetry data' }))}
                {scope === 'entities' && (t('integrations.scopeEntitiesHint', { defaultValue: 'NGSI-LD entity queries' }))}
                {scope === 'export' && (t('integrations.scopeExportHint', { defaultValue: 'CSV & Parquet export' }))}
                {scope === 'telemetry' && (t('integrations.scopeTelemetryHint', { defaultValue: 'device telemetry' }))}
              </span>
            </label>
          ))}
        </fieldset>

        {/* Expiry */}
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <span className="text-slate-300">{t('integrations.expiresLabel', { defaultValue: 'Expires:' })}</span>
          <select
            value={expiresDays}
            onChange={(e) => setExpiresDays(Number(e.target.value))}
            className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-sm text-slate-300"
          >
            <option value={30}>30 {t('integrations.days', { defaultValue: 'days' })}</option>
            <option value={90}>90 {t('integrations.days', { defaultValue: 'days' })}</option>
            <option value={180}>180 {t('integrations.days', { defaultValue: 'days' })}</option>
            <option value={365}>365 {t('integrations.days', { defaultValue: 'days' })}</option>
            <option value={0}>{t('integrations.noExpiry', { defaultValue: 'No expiry' })}</option>
          </select>
        </label>

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
                  {row.scopes && row.scopes.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {row.scopes.map((s: string) => (
                        <span key={s} className="px-1.5 py-0.5 bg-slate-800 rounded text-xs text-slate-400">
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="text-xs text-slate-500">
                    {row.is_active ? t('integrations.active') : t('integrations.inactive')}
                    {row.expires_at && ` · ${t('integrations.expires', { defaultValue: 'Expires' })} ${new Date(row.expires_at).toLocaleDateString()}`}
                     · {row.id}
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
