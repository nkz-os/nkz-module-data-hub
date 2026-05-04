/**
 * PAT management + Power BI / Excel hints (ADR 003). Uses platform /api/tenant/api-keys via cookie auth.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '@nekazari/sdk';
import { SlotShell } from '@nekazari/viewer-kit';
import { Button, Input, Badge, Spinner, Inline, Stack } from '@nekazari/ui-kit';
import type { ChartSeriesDef, GlobalTimeContext } from '../types/dashboard';
import {
  createTenantPat,
  getBaseUrl,
  listTenantPats,
  revokeTenantPat,
  type TenantPatMeta,
} from '../services/datahubApi';

const datahubAccent = { base: '#06B6D4', soft: '#CFFAFE', strong: '#0891B2' };

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
    <SlotShell moduleId="datahub" accent={datahubAccent}>
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-2">{t('integrations.title')}</h3>
        <p className="text-muted-foreground text-sm">{t('integrations.description')}</p>
      </div>

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded p-3" role="alert">
          {error}
        </div>
      )}

      <section className="space-y-3 border border-border rounded-lg p-4 bg-card/50">
        <h4 className="font-medium text-foreground">{t('integrations.createSection')}</h4>
        <Inline gap="md" className="flex-wrap">
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('integrations.namePlaceholder')}
            className="flex-1 min-w-[200px]"
          />
          <Button variant="primary" disabled={creating} onClick={() => void onCreate()}>
            {creating ? t('integrations.creating') : t('integrations.create')}
          </Button>
        </Inline>
        {newToken && (
          <Stack gap="sm" className="mt-3 p-3 bg-warning/10 border border-warning/30 rounded text-sm">
            <span className="text-warning font-medium">{t('integrations.tokenOnce')}</span>
            <code className="block break-all text-foreground bg-background p-2 rounded">{newToken}</code>
            <Button variant="link" size="sm" onClick={() => void copy(newToken)}>
              {t('integrations.copy')}
            </Button>
          </Stack>
        )}
      </section>

      <section className="space-y-2 border border-border rounded-lg p-4 bg-card/50">
        <h4 className="font-medium text-foreground">{t('integrations.listSection')}</h4>
        {loading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('integrations.empty')}</p>
        ) : (
          <Stack gap="sm">
            {items.map((row) => (
              <div
                key={row.id}
                className="flex justify-between items-center gap-2 border border-border rounded px-3 py-2"
              >
                <div>
                  <div className="font-mono text-foreground">{row.name}</div>
                  <div className="text-xs text-muted-foreground">
                    <Badge variant={row.is_active ? 'success' : 'secondary'}>
                      {row.is_active ? t('integrations.active') : t('integrations.inactive')}
                    </Badge> · {row.id}
                  </div>
                </div>
                {row.is_active && (
                  <Button variant="destructive" size="sm" onClick={() => void onRevoke(row.id)}>
                    {t('integrations.revoke')}
                  </Button>
                )}
              </div>
            ))}
          </Stack>
        )}
      </section>

      <section className="space-y-3 border border-border rounded-lg p-4 bg-card/50">
        <h4 className="font-medium text-foreground">{t('integrations.powerBiTitle')}</h4>
        <dl className="text-sm space-y-2 text-muted-foreground">
          <div>
            <dt className="text-muted-foreground">{t('integrations.endpoint')}</dt>
            <dd>
              <code className="text-accent break-all">{queryUrl}</code>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('integrations.method')}</dt>
            <dd>
              <code className="text-foreground">POST</code>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('integrations.header')}</dt>
            <dd>
              <code className="text-foreground break-all">Authorization: Bearer nkz_pat_…</code>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('integrations.bodyExample')}</dt>
            <dd>
              <pre className="mt-1 p-3 bg-background rounded text-xs text-foreground overflow-x-auto">
                {JSON.stringify(exampleBody, null, 2)}
              </pre>
              <Button variant="link" size="sm" onClick={() => void copy(JSON.stringify(exampleBody, null, 2))}>
                {t('integrations.copy')}
              </Button>
            </dd>
          </div>
        </dl>
      </section>
    </div>
    </SlotShell>
  );
};
