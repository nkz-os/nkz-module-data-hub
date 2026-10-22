import React, { useState } from 'react';
import { useTranslation } from '@nekazari/sdk';
import { useCalibration } from '../../hooks/useCalibration';
import { CalibrationTimeline } from './CalibrationTimeline';
import { CalibrationForm } from './CalibrationForm';
import { Settings, ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  sensorId: string | null;
}

export function CalibrationPanel({ sensorId }: Props) {
  const { t } = useTranslation('datahub');
  const { periods, loading, addPeriod } = useCalibration(sensorId);
  const [expanded, setExpanded] = useState(false);

  if (!sensorId) return null;

  return (
    <div className="border dh-border-default rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-4 py-3 dh-bg-surface hover:dh-bg-surface-alt text-sm font-semibold dh-text-primary transition-colors"
      >
        <span className="flex items-center gap-2">
          <Settings className="w-4 h-4 dh-accent-text" />
          {t('sensor.calibration.title')}
        </span>
        {expanded ? <ChevronUp className="w-4 h-4 dh-text-secondary" /> : <ChevronDown className="w-4 h-4 dh-text-secondary" />}
      </button>

      {expanded && (
        <div className="p-4 space-y-4 border-t dh-border-default">
          {loading ? (
            <p className="text-sm dh-text-secondary">{t('sensor.calibration.loading')}</p>
          ) : (
            <>
              <CalibrationTimeline periods={periods} />
              <div className="border-t dh-border-default pt-4">
                <CalibrationForm onAdd={addPeriod} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
