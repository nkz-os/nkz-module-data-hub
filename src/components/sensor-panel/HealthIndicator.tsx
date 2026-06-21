import { ReliabilityStatus } from '../hooks/useSensorHealth';

const STATUS_COLORS: Record<ReliabilityStatus, string> = {
  optimal: 'bg-green-500',
  degraded: 'bg-yellow-500',
  error: 'bg-red-500',
  maintenance: 'bg-blue-500',
};

const STATUS_LABELS: Record<ReliabilityStatus, string> = {
  optimal: 'Óptimo',
  degraded: 'Degradado',
  error: 'Error',
  maintenance: 'Mantenimiento',
};

interface Props {
  status: ReliabilityStatus;
  isSilenced?: boolean;
}

export function HealthIndicator({ status, isSilenced }: Props) {
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block w-3 h-3 rounded-full ${STATUS_COLORS[status]}`} />
      <span className="text-sm text-gray-600">{STATUS_LABELS[status]}</span>
      {isSilenced && (
        <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
          Silenciado
        </span>
      )}
    </div>
  );
}
