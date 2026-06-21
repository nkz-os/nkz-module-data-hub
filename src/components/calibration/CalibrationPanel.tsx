import React, { useState } from 'react';
import { useCalibration } from '../../hooks/useCalibration';
import { CalibrationTimeline } from './CalibrationTimeline';
import { CalibrationForm } from './CalibrationForm';
import { Settings, ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  sensorId: string | null;
}

export function CalibrationPanel({ sensorId }: Props) {
  const { periods, loading, addPeriod } = useCalibration(sensorId);
  const [expanded, setExpanded] = useState(false);

  if (!sensorId) return null;

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-4 py-3 bg-gray-50 hover:bg-gray-100 text-sm font-semibold text-gray-800"
      >
        <span className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-teal-600" />
          Calibración del Sensor
        </span>
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {expanded && (
        <div className="p-4 space-y-4 border-t border-gray-200">
          {loading ? (
            <p className="text-sm text-gray-500">Cargando...</p>
          ) : (
            <>
              <CalibrationTimeline periods={periods} />
              <div className="border-t border-gray-200 pt-4">
                <CalibrationForm onAdd={addPeriod} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
