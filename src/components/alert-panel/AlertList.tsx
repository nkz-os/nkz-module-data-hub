import { useState, useEffect } from 'react';

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
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

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

  if (loading) return <div className="text-sm text-gray-500">Cargando alertas...</div>;

  return (
    <div className="space-y-2">
      <h3 className="text-lg font-semibold text-gray-800">Alertas Activas</h3>
      {alerts.length === 0 ? (
        <p className="text-sm text-gray-500">No hay alertas activas</p>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {alerts.map(alert => (
            <div
              key={alert.id}
              className="border border-red-200 bg-red-50 rounded-lg p-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium capitalize text-red-800">
                  {alert.alertType === 'timeout' ? 'Sin Comunicación'
                    : alert.alertType === 'stagnation' ? 'Estancamiento'
                    : alert.alertType === 'out_of_bounds' ? 'Fuera de Rango'
                    : alert.alertType}
                </span>
                <span className="text-xs text-gray-500">
                  {new Date(alert.observedAt).toLocaleString()}
                </span>
              </div>
              <p className="text-sm text-gray-700 mt-1">{alert.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
