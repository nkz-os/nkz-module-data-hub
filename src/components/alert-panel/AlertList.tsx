import React, { useState, useEffect } from 'react';
import { useTranslation } from '@nekazari/sdk';

interface Alert {
  id: string;
  alertType: string;
  description: string;
  severity: string;
  observedAt: string;
  status: string;
}

interface Props {
  tenantId: string;
  sensorId?: string;
}

const API_BASE = (import.meta as any).env?.VITE_API_URL || 'https://nkz.robotika.cloud';

export function AlertList({ tenantId, sensorId }: Props) {
  const { t } = useTranslation('datahub');
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);

    const params = new URLSearchParams({
      type: 'Alert',
      options: 'keyValues',
      attrs: 'alertType,description,severity,observedAt,status',
      q: `status==active${sensorId ? `;refSourceSensor=="${sensorId}"` : ''}`,
      limit: '100',
    });

    fetch(`${API_BASE}/ngsi-ld/v1/entities?${params}`, {
      credentials: 'include',
    })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setAlerts(data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [tenantId, sensorId]);

  const handleResolve = async (alertId: string) => {
    setResolvingIds(prev => new Set([...prev, alertId]));
    try {
      const resp = await fetch(
        `${API_BASE}/ngsi-ld/v1/entities/${encodeURIComponent(alertId)}/attrs`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: { type: 'Property', value: 'resolved' },
            resolvedAt: { type: 'Property', value: new Date().toISOString() },
          }),
        }
      );
      if (resp.ok || resp.status === 204) {
        setAlerts(prev => prev.filter(a => a.id !== alertId));
      }
    } catch (err) {
      console.error('Failed to resolve alert:', err);
    } finally {
      setResolvingIds(prev => { const next = new Set(prev); next.delete(alertId); return next; });
    }
  };

  if (loading) return <div className="text-sm dh-text-secondary">{t('sensor.alerts.loading')}</div>;

  const alertTypeLabel = (type: string) => {
    switch (type) {
      case 'timeout': return t('sensor.alerts.type_timeout');
      case 'stagnation': return t('sensor.alerts.type_stagnation');
      case 'out_of_bounds': return t('sensor.alerts.type_out_of_bounds');
      default: return type;
    }
  };

  return (
    <div className="space-y-2">
      {alerts.length === 0 ? (
        <p className="text-sm dh-text-secondary">{t('sensor.alerts.empty')}</p>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {alerts.map(alert => (
            <div
              key={alert.id}
              className="border border-red-200 bg-red-50 rounded-lg p-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium capitalize text-red-800">
                  {alertTypeLabel(alert.alertType)}
                </span>
                <span className="text-xs dh-text-muted">
                  {new Date(alert.observedAt).toLocaleString()}
                </span>
              </div>
              <p className="text-sm dh-text-secondary mt-1">{alert.description}</p>
              <div className="mt-2 flex justify-end">
                <button
                  onClick={() => handleResolve(alert.id)}
                  disabled={resolvingIds.has(alert.id)}
                  className="text-xs px-2 py-1 bg-white/50 border border-gray-300 rounded hover:bg-white disabled:opacity-50"
                >
                  {resolvingIds.has(alert.id) ? '...' : 'Resolver'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
