/**
 * ExportModal — Phase 4. Analytical export (CSV blob or Parquet presigned URL).
 * Uses GlobalTimeContext and panel.series for POST /api/datahub/export.
 */

import React, { useState } from 'react';
import { useTranslation } from '@nekazari/sdk';
import { SlotShell } from '@nekazari/viewer-kit';
import { Button, Select, Spinner } from '@nekazari/ui-kit';
import { X } from 'lucide-react';

const datahubAccent = { base: '#06B6D4', soft: '#CFFAFE', strong: '#0891B2' };
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
      <SlotShell moduleId="datahub" accent={datahubAccent}>
      <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-md mx-4 p-4">
        <div className="flex justify-between items-center mb-4">
          <h2 id="export-modal-title" className="text-sm font-semibold text-foreground">
            {t('exportModal.title')}
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label={t('exportModal.close')}>
            <X size={18} />
          </Button>
        </div>

        {!canExport ? (
          <p className="text-muted-foreground text-sm mb-4">
            {t('exportModal.noSeries')}
          </p>
        ) : (
          <>
            <div className="space-y-4 mb-4">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">{t('exportModal.format')}</label>
                <Select
                  value={format}
                  onChange={(v) => setFormat(v as 'csv' | 'parquet')}
                  options={[
                    { value: 'csv', label: t('exportModal.formatCsv') },
                    { value: 'parquet', label: t('exportModal.formatParquet') },
                  ]}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">{t('exportModal.granularity')}</label>
                <Select
                  value={aggregation}
                  onChange={(v) => setAggregation(v as ExportAggregation)}
                  options={[
                    { value: 'raw', label: t('exportModal.rawHighFreq') },
                    { value: '1 hour', label: t('exportModal.oneHour') },
                    { value: '1 day', label: t('exportModal.oneDay') },
                  ]}
                  className="w-full"
                />
              </div>
            </div>
            {error && (
              <p className="text-destructive text-xs mb-4" role="alert">
                {error}
              </p>
            )}
          </>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('exportModal.cancel')}
          </Button>
          <Button variant="primary" size="sm" onClick={handleExport} disabled={!canExport || loading}>
            {loading ? <><Spinner /> {t('exportModal.exporting')}</> : t('exportModal.export')}
          </Button>
        </div>
      </div>
      </SlotShell>
    </div>
  );
};
