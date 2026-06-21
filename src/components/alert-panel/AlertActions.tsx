import { useState } from 'react';

interface Props {
  alertId: string;
  onResolved: (alertId: string) => void;
}

const API_BASE = (import.meta as any).env?.VITE_API_URL || 'https://nkz.robotika.cloud';

export function AlertActions({ alertId, onResolved }: Props) {
  const [loading, setLoading] = useState(false);

  const handleResolve = async () => {
    setLoading(true);
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
      if (resp.ok) onResolved(alertId);
    } catch (err) {
      console.error('Failed to resolve alert:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleResolve}
      disabled={loading}
      className="text-xs px-2 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
    >
      {loading ? '...' : 'Resolver'}
    </button>
  );
}
