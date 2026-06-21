import { useState, useEffect, useCallback } from 'react';

export interface CalibrationPeriod {
  id: string;
  sensor_id: string;
  variable: string;
  slope: number;
  offset_val: number;
  valid_from: string;
  valid_to: string | null;
  sensor_hardware_id: string;
  notes: string | null;
}

interface UseCalibrationReturn {
  periods: CalibrationPeriod[];
  loading: boolean;
  addPeriod: (data: Partial<CalibrationPeriod>) => Promise<boolean>;
  refetch: () => void;
}

const API_BASE = (import.meta as any).env?.VITE_API_URL || 'https://nkz.robotika.cloud';

export function useCalibration(sensorId: string | null): UseCalibrationReturn {
  const [periods, setPeriods] = useState<CalibrationPeriod[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchPeriods = useCallback(async () => {
    if (!sensorId) return;
    setLoading(true);
    try {
      const resp = await fetch(
        `${API_BASE}/api/entities/sensors/${encodeURIComponent(sensorId)}/calibration`,
        { credentials: 'include' }
      );
      if (resp.ok) {
        const data = await resp.json();
        setPeriods(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to fetch calibration periods:', err);
    } finally {
      setLoading(false);
    }
  }, [sensorId]);

  const addPeriod = async (data: Partial<CalibrationPeriod>): Promise<boolean> => {
    if (!sensorId) return false;
    try {
      const resp = await fetch(
        `${API_BASE}/api/entities/sensors/${encodeURIComponent(sensorId)}/calibration`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }
      );
      if (resp.ok) {
        await fetchPeriods();
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to add calibration period:', err);
      return false;
    }
  };

  useEffect(() => { fetchPeriods(); }, [fetchPeriods]);

  return { periods, loading, addPeriod, refetch: fetchPeriods };
}
