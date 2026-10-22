import React from 'react';
import { useTranslation } from '@nekazari/sdk';
import { CalibrationPeriod } from '../../hooks/useCalibration';

interface Props {
  periods: CalibrationPeriod[];
}

export function CalibrationTimeline({ periods }: Props) {
  const { t } = useTranslation('datahub');
  const sorted = [...periods].sort(
    (a, b) => new Date(b.valid_from).getTime() - new Date(a.valid_from).getTime()
  );

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold dh-text-primary">{t('sensor.calibration.history')}</h4>
      {sorted.length === 0 ? (
        <p className="text-xs dh-text-secondary">{t('sensor.calibration.no_history')}</p>
      ) : (
        <div className="space-y-2">
          {sorted.map(period => (
            <div
              key={period.id}
              className={`border rounded-lg p-3 text-sm ${
                period.valid_to === null
                  ? 'border-teal-300 bg-teal-50/30'
                  : 'dh-border-default dh-bg-surface-alt'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono font-medium dh-text-primary">{period.variable}</span>
                {period.valid_to === null && (
                  <span className="text-xs bg-teal-200/30 text-teal-700 px-2 py-0.5 rounded">
                    {t('sensor.calibration.active')}
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs dh-text-secondary space-y-0.5">
                <p>{t('sensor.calibration.slope')}: <span className="font-mono">{period.slope}</span> | {t('sensor.calibration.offset')}: <span className="font-mono">{period.offset_val}</span></p>
                <p>{t('sensor.calibration.hardware')}: <span className="font-mono">{period.sensor_hardware_id}</span></p>
                <p>{t('sensor.calibration.from')}: {new Date(period.valid_from).toLocaleDateString()}
                  {period.valid_to ? ` — ${new Date(period.valid_to).toLocaleDateString()}` : ''}
                </p>
                {period.notes && <p className="italic">{period.notes}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
