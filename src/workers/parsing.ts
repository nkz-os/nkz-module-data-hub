/**
 * Pure parsing helpers shared between the web worker and unit tests.
 * Extracted from datahubWorker.ts so the data-shape contract can be
 * verified independently of the worker runtime.
 */

export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function timestampToEpochSeconds(value: unknown): number | null {
  const normalize = (n: number): number => {
    let v = n;
    while (Math.abs(v) > 1e11) v /= 1000;
    return v;
  };
  if (typeof value === 'number' && Number.isFinite(value)) return normalize(value);
  if (typeof value === 'string') {
    const t = value.trim();
    if (/^\d+(\.\d+)?$/.test(t)) {
      const n = Number.parseFloat(t);
      return Number.isFinite(n) ? normalize(n) : null;
    }
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? ms / 1000 : null;
  }
  return null;
}

function normalizeMonotonic(
  x: Float64Array,
  y: Float64Array
): { xs: Float64Array; ys: Float64Array } {
  if (x.length <= 1) return { xs: x, ys: y };
  const pairs: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < x.length; i++) {
    const xv = x[i];
    if (!Number.isFinite(xv)) continue;
    pairs.push({ x: xv, y: y[i] });
  }
  if (pairs.length <= 1) {
    return {
      xs: new Float64Array(pairs.map((p) => p.x)),
      ys: new Float64Array(pairs.map((p) => p.y)),
    };
  }
  pairs.sort((a, b) => a.x - b.x);
  const nx: number[] = [];
  const ny: number[] = [];
  let i = 0;
  while (i < pairs.length) {
    let j = i + 1;
    let val = pairs[i].y;
    while (j < pairs.length && pairs[j].x === pairs[i].x) {
      // For duplicated timestamps prefer the latest finite value.
      if (Number.isFinite(pairs[j].y)) val = pairs[j].y;
      j += 1;
    }
    nx.push(pairs[i].x);
    ny.push(val);
    i = j;
  }
  return { xs: new Float64Array(nx), ys: new Float64Array(ny) };
}

export interface ParsedSeries {
  xs: Float64Array;
  ys: Float64Array;
  /** Raw (pre-calibration) measurements from the BFF, aligned with xs/ys.
   *  Null when the BFF response contains no raw_values array or when its
   *  length does not match timestamps. */
  rawValues: Float64Array | null;
}

/**
 * Parse a single-series payload from the BFF JSON response.
 *
 * Accepts three shapes (the BFF is the source of truth for which shape is sent):
 *   1. { timestamps: [...], values: [...] }             — single attr (canonical)
 *   2. { timestamps: [...], value_0: [...], ... }       — multi attr (align/export)
 *   3. { timestamps: [...], attributes: { attr: [...] } } — reader raw format (fallback)
 *
 * The BFF may also include a raw_values array (positionally aligned with
 * timestamps and values), which is returned as rawValues in the result.
 *
 * This contract is what the worker depends on. Any BFF change that breaks it
 * will be caught by `parsing.test.ts`.
 */
export function parseSingleSeriesPayload(data: unknown): ParsedSeries {
  const payload = (data ?? {}) as Record<string, unknown>;
  const timestamps = Array.isArray(payload.timestamps) ? payload.timestamps : [];

  // Canonical shapes (BFF single-attr path or aligned multi-series path)
  let seriesValues: unknown[];
  if (Array.isArray(payload.values)) {
    seriesValues = payload.values;
  } else if (Array.isArray(payload.value_0)) {
    seriesValues = payload.value_0;
  } else if (payload.attributes && typeof payload.attributes === 'object') {
    // Fallback: reader raw format { attributes: { attr_name: [...] } }
    const attrs = payload.attributes as Record<string, unknown>;
    const firstKey = Object.keys(attrs)[0];
    seriesValues = (firstKey && Array.isArray(attrs[firstKey])) ? attrs[firstKey] as unknown[] : [];
  } else {
    seriesValues = [];
  }

  // Extract raw_input from payload.raw_values (single attr) or raw_value_0 (multi attr)
  const rawInput: unknown[] = Array.isArray(payload.raw_values) ? payload.raw_values :
    Array.isArray(payload.raw_value_0) ? payload.raw_value_0 as unknown[] :
    [];
  const hasRaw = rawInput.length === timestamps.length;

  const len = Math.min(timestamps.length, seriesValues.length);
  const tmpX = new Float64Array(len);
  const tmpY = new Float64Array(len);
  const tmpRaw = hasRaw ? new Float64Array(len) : null;
  const rawMap = new Map<number, number>();
  let w = 0;
  for (let i = 0; i < len; i++) {
    const x = timestampToEpochSeconds(timestamps[i]);
    if (x == null) continue;
    tmpX[w] = x;
    const y = toFiniteNumber(seriesValues[i]);
    tmpY[w] = y == null ? Number.NaN : y;
    if (hasRaw && tmpRaw) {
      const r = toFiniteNumber(rawInput[i]);
      tmpRaw[w] = r == null ? Number.NaN : r;
      rawMap.set(x, tmpRaw[w]);
    }
    w += 1;
  }

  const trimmedX = tmpX.slice(0, w);
  const trimmedY = tmpY.slice(0, w);
  const normalized = normalizeMonotonic(trimmedX, trimmedY);

  // Realign raw values to the normalized (sorted + deduplicated) xs indices
  let normalizedRaw: Float64Array | null = null;
  if (hasRaw && rawMap.size > 0) {
    normalizedRaw = new Float64Array(normalized.xs.length);
    for (let i = 0; i < normalized.xs.length; i++) {
      const rv = rawMap.get(normalized.xs[i]);
      normalizedRaw[i] = rv !== undefined ? rv : Number.NaN;
    }
  }

  // If rawValues is all-NaN, set to null to avoid unnecessary processing
  if (normalizedRaw) {
    let hasFinite = false;
    for (let i = 0; i < normalizedRaw.length; i++) {
      if (Number.isFinite(normalizedRaw[i])) { hasFinite = true; break; }
    }
    if (!hasFinite) normalizedRaw = null;
  }

  return { xs: normalized.xs, ys: normalized.ys, rawValues: normalizedRaw };
}
