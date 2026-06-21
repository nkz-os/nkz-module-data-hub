import React from 'react';
import { CalibrationPeriod } from '../../hooks/useCalibration';

interface Props {
  periods: CalibrationPeriod[];
}

export function CalibrationTimeline({ periods }: Props) {
  const sorted = [...periods].sort(
    (a, b) => new Date(b.valid_from).getTime() - new Date(a.valid_from).getTime()
  );

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-gray-800">Histórico de Calibraciones</h4>
      {sorted.length === 0 ? (
        <p className="text-xs text-gray-500">No hay calibraciones registradas</p>
      ) : (
        <div className="space-y-2">
          {sorted.map(period => (
            <div
              key={period.id}
              className={`border rounded-lg p-3 text-sm ${
                period.valid_to === null
                  ? 'border-teal-300 bg-teal-50'
                  : 'border-gray-200 bg-white'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono font-medium">{period.variable}</span>
                {period.valid_to === null && (
                  <span className="text-xs bg-teal-200 text-teal-800 px-2 py-0.5 rounded">
                    Activo
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-gray-600 space-y-0.5">
                <p>Slope: <span className="font-mono">{period.slope}</span> | Offset: <span className="font-mono">{period.offset_val}</span></p>
                <p>Hardware: <span className="font-mono">{period.sensor_hardware_id}</span></p>
                <p>Desde: {new Date(period.valid_from).toLocaleDateString()}
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
