import { useState } from 'react';

interface Props {
  entityId: string;
  isSilenced: boolean;
  onToggle: (newState: boolean) => void;
}

const API_BASE = (import.meta as any).env?.VITE_API_URL || 'https://nkz.robotika.cloud';

export function SilenceButton({ entityId, isSilenced, onToggle }: Props) {
  const [loading, setLoading] = useState(false);

  const handleToggle = async () => {
    setLoading(true);
    try {
      const resp = await fetch(
        `${API_BASE}/api/entities/sensors/${encodeURIComponent(entityId)}`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isSilenced: !isSilenced }),
        }
      );
      if (resp.ok) {
        onToggle(!isSilenced);
      } else {
        console.error('Failed to toggle silence:', resp.status);
      }
    } catch (err) {
      console.error('Failed to toggle silence:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleToggle}
      disabled={loading}
      className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
        isSilenced
          ? 'bg-green-100 text-green-700 hover:bg-green-200'
          : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
      } disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      {loading ? '...' : isSilenced ? 'Reactivar Alertas' : 'Silenciar Alertas'}
    </button>
  );
}
