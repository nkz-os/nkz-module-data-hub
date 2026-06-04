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

/**
 * Parse a single-series payload from the BFF JSON response.
 *
 * Accepts three shapes (the BFF is the source of truth for which shape is sent):
 *   1. { timestamps: [...], values: [...] }             — single attr (canonical)
 *   2. { timestamps: [...], value_0: [...], ... }       — multi attr (align/export)
 *   3. { timestamps: [...], attributes: { attr: [...] } } — reader raw format (fallback)
 *
 * This contract is what the worker depends on. Any BFF change that breaks it
 * will be caught by `parsing.test.ts`.
 */
export function parseSingleSeriesPayload(data: unknown): { xs: Float64Array; ys: Float64Array } {
  const payload = (data ?? {}) as Record<string, unknown>;
  const timestamps = Array.isArray(payload.timestamps) ? payload.timestamps : [];

  // Canonical shapes (BFF single-attr path or aligned multi-series path)
  let rawValues: unknown[];
  if (Array.isArray(payload.values)) {
    rawValues = payload.values;
  } else if (Array.isArray(payload.value_0)) {
    rawValues = payload.value_0;
  } else if (payload.attributes && typeof payload.attributes === 'object') {
    // Fallback: reader raw format { attributes: { attr_name: [...] } }
    const attrs = payload.attributes as Record<string, unknown>;
    const firstKey = Object.keys(attrs)[0];
    rawValues = (firstKey && Array.isArray(attrs[firstKey])) ? attrs[firstKey] as unknown[] : [];
  } else {
    rawValues = [];
  }

  const len = Math.min(timestamps.length, rawValues.length);
  const tmpX = new Float64Array(len);
  const tmpY = new Float64Array(len);
  let w = 0;
  for (let i = 0; i < len; i++) {
    const x = timestampToEpochSeconds(timestamps[i]);
    if (x == null) continue;
    tmpX[w] = x;
    const y = toFiniteNumber(rawValues[i]);
    tmpY[w] = y == null ? Number.NaN : y;
    w += 1;
  }
  return normalizeMonotonic(tmpX.slice(0, w), tmpY.slice(0, w));
}
