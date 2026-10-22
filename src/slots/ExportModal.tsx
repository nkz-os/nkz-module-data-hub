/**
 * ExportModal — Phase 4. Analytical export (CSV blob or Parquet presigned URL).
 * Uses GlobalTimeContext and panel.series for POST /api/datahub/export.
 */

import React, { useState } from 'react';
import { useTranslation } from '@nekazari/sdk';
import { X } from 'lucide-react';
import type { DashboardPanel, GlobalTimeContext } from '../types/dashboard';
import {
  requestExport,
  type ExportAggregation,
} from '../services/datahubApi';

export interface ExportModalProps {
  panel: DashboardPanel;
  timeContext: GlobalTimeContext;
  onClose: () => void;
}

function triggerCsvDownload(blob: Blob, startTime: string, endTime: string): void {
  const start = startTime.slice(0, 10);
  const end = endTime.slice(0, 10);
  const name = `datahub-export-${start}_${end}.csv`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export const ExportModal: React.FC<ExportModalProps> = ({
  panel,
  timeContext,
  onClose,
}) => {
  const { t } = useTranslation('datahub');
  const [format, setFormat] = useState<'csv' | 'parquet'>('csv');
  const [aggregation, setAggregation] = useState<ExportAggregation>('1 hour');
  const [includeRaw, setIncludeRaw] = useState(false);
  const [includeCalibration, setIncludeCalibration] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canExport = panel.series.length > 0;

  const handleExport = async () => {
    if (!canExport) return;
    setLoading(true);
    setError(null);
    try {
      const payload = {
        start_time: timeContext.startTime,
        end_time: timeContext.endTime,
        series: panel.series.map((s) => ({
          entity_id: s.entityId,
          attribute: s.attribute,
        })),
        format,
        aggregation,
        ...(includeRaw && { include_raw: true }),
        ...(includeCalibration && { include_calibration: true }),
      };
      const result = await requestExport(payload);
      if (result.format === 'csv') {
        triggerCsvDownload(result.blob, timeContext.startTime, timeContext.endTime);
      } else {
        window.open(result.data.download_url, '_blank');
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
    >
      <div className="dh-bg-surface border dh-border-default rounded-lg shadow-xl w-full max-w-md mx-4 p-4">
        <div className="flex justify-between items-center mb-4">
          <h2 id="export-modal-title" className="text-sm font-semibold dh-text-primary">
            {t('exportModal.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="dh-text-secondary hover:dh-text-primary p-1"
            aria-label={t('exportModal.close')}
          >
            <X size={18} />
          </button>
        </div>

        {!canExport ? (
          <p className="dh-text-secondary text-sm mb-4">
            {t('exportModal.noSeries')}
          </p>
        ) : (
          <>
            <div className="space-y-4 mb-4">
              <div>
                <label className="block text-xs dh-text-secondary mb-1">{t('exportModal.format')}</label>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as 'csv' | 'parquet')}
                  className="w-full dh-bg-surface-alt border dh-border-light rounded px-3 py-2 text-sm dh-text-primary"
                >
                  <option value="csv">{t('exportModal.formatCsv')}</option>
                  <option value="parquet">{t('exportModal.formatParquet')}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs dh-text-secondary mb-1">{t('exportModal.granularity')}</label>
                <select
                  value={aggregation}
                  onChange={(e) => setAggregation(e.target.value as ExportAggregation)}
                  className="w-full dh-bg-surface-alt border dh-border-light rounded px-3 py-2 text-sm dh-text-primary"
                >
                  <option value="raw">{t('exportModal.rawHighFreq')}</option>
                  <option value="1 hour">{t('exportModal.oneHour')}</option>
                  <option value="1 day">{t('exportModal.oneDay')}</option>
                </select>
              </div>
              {format === 'csv' && (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer dh-text-primary">
                    <input
                      type="checkbox"
                      checked={includeRaw}
                      onChange={(e) => setIncludeRaw(e.target.checked)}
                      className="rounded dh-border-light"
                    />
                    {t('exportModal.includeRaw')}
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer dh-text-primary">
                    <input
                      type="checkbox"
                      checked={includeCalibration}
                      onChange={(e) => setIncludeCalibration(e.target.checked)}
                      className="rounded dh-border-light"
                    />
                    {t('exportModal.includeCalibration')}
                  </label>
                </div>
              )}
            </div>
            {error && (
              <p className="text-red-400 text-xs mb-4" role="alert">
                {error}
              </p>
            )}
          </>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm dh-text-secondary hover:dh-text-primary border dh-border-light rounded"
          >
            {t('exportModal.cancel')}
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={!canExport || loading}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? t('exportModal.exporting') : t('exportModal.export')}
          </button>
        </div>
      </div>
    </div>
  );
};
