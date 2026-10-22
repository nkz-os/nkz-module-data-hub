import { useState, useEffect, useCallback } from 'react';
import { getBaseUrl } from '../services/datahubApi';

export type ReliabilityStatus = 'optimal' | 'degraded' | 'error' | 'maintenance';

interface SensorHealth {
  reliabilityStatus: ReliabilityStatus;
  isSilenced: boolean;
  loading: boolean;
}

export function useSensorHealth(entityId: string | null): SensorHealth & { refetch: () => void } {
  const [state, setState] = useState<SensorHealth>({
    reliabilityStatus: 'optimal',
    isSilenced: false,
    loading: true,
  });

  const fetchHealth = useCallback(async () => {
    if (!entityId) return;
    try {
      const resp = await fetch(
        `${getBaseUrl()}/ngsi-ld/v1/entities/${encodeURIComponent(entityId)}?attrs=reliabilityStatus,isSilenced&options=keyValues`,
        { credentials: 'include' }
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setState({
        reliabilityStatus: data.reliabilityStatus || 'optimal',
        isSilenced: data.isSilenced || false,
        loading: false,
      });
    } catch (err) {
      console.error('Failed to fetch sensor health:', err);
      setState(prev => ({ ...prev, loading: false }));
    }
  }, [entityId]);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 60000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  return { ...state, refetch: fetchHealth };
}
