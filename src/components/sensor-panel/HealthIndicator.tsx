import React from 'react';
import { useTranslation } from '@nekazari/sdk';
import { ReliabilityStatus } from '../../hooks/useSensorHealth';

const STATUS_COLORS: Record<ReliabilityStatus, string> = {
  optimal: 'bg-green-500',
  degraded: 'bg-yellow-500',
  error: 'bg-red-500',
  maintenance: 'bg-blue-500',
};

interface Props {
  status: ReliabilityStatus;
  isSilenced?: boolean;
}

export function HealthIndicator({ status, isSilenced }: Props) {
  const { t } = useTranslation('datahub');
  const labelKey = `sensor.health.${status}` as const;
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block w-3 h-3 rounded-full ${STATUS_COLORS[status]}`} />
      <span className="text-sm dh-text-secondary">{t(labelKey)}</span>
      {isSilenced && (
        <span className="text-xs dh-bg-surface-alt dh-text-muted px-1.5 py-0.5 rounded">
          {t('sensor.silenced', { defaultValue: 'Silenciado' })}
        </span>
      )}
    </div>
  );
}
