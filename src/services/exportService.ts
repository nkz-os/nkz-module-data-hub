/**
 * ExportService — CSV helpers for timeseries data.
 * Provides buildExportData to format series payloads with optional raw and calibration columns.
 */

export interface ExportOptions {
  includeRaw?: boolean;
  includeCalibration?: boolean;
}

/**
 * Build a CSV string from a timeseries data array.
 * When includeRaw is set, appends a value_raw column from point.value_raw.
 * When includeCalibration is set, appends a calibration_period_id column.
 */
export function buildExportData(
  series: any[],
  options: ExportOptions = {},
): string {
  const headers = ['timestamp', 'variable', 'value', 'unit'];
  const rows: string[][] = [];

  if (options.includeRaw) {
    headers.push('value_raw');
  }
  if (options.includeCalibration) {
    headers.push('calibration_period_id');
  }

  for (const point of series) {
    const row = [
      point.timestamp,
      point.variable,
      String(point.value ?? ''),
      point.unit ?? '',
    ];
    if (options.includeRaw) {
      row.push(point.value_raw ?? '');
    }
    if (options.includeCalibration) {
      row.push(point.calibration_period_id ?? '');
    }
    rows.push(row);
  }

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}
