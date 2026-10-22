import { describe, expect, it } from 'vitest';

import {
  cacheKey,
  computeDomains,
  countFinite,
  downsampleAligned,
  downsampleSingle,
  injectGapsSingle,
  lttbIndices,
  minMaxIndicesPerBucket,
  quantile,
  selectEvictions,
  splitSegmentsByGap,
} from '../pipeline';

const f64 = (a: number[]) => new Float64Array(a);

describe('injectGapsSingle', () => {
  it('no gaps -> identity and gapsInjected 0', () => {
    const xs = f64([0, 10, 20]);
    const ys = f64([1, 2, 3]);
    const r = injectGapsSingle(xs, ys, 15);
    expect(r.gapsInjected).toBe(0);
    expect(r.xs).toBe(xs); // same instance, no copy
  });

  it('single gap -> bridge at midpoint with NaN', () => {
    const r = injectGapsSingle(f64([0, 10, 100]), f64([1, 2, 3]), 15);
    expect(r.gapsInjected).toBe(1);
    expect(Array.from(r.xs)).toEqual([0, 10, 55, 100]);
    expect(r.ys[2]).toBeNaN();
    expect(Array.from(r.ys.slice(0, 2))).toEqual([1, 2]);
    expect(r.ys[3]).toBe(3);
  });

  it('multiple gaps -> length n + gaps; NaN only at bridges', () => {
    const r = injectGapsSingle(f64([0, 100, 200, 210]), f64([1, 2, 3, 4]), 50);
    expect(r.gapsInjected).toBe(2);
    expect(r.xs.length).toBe(6);
    const nanIdx = Array.from(r.ys).flatMap((v, i) => (Number.isNaN(v) ? [i] : []));
    expect(nanIdx).toEqual([1, 3]); // bridges at 50 and 150
  });

  it('xs stays strictly increasing after injection', () => {
    const r = injectGapsSingle(f64([0, 100, 200]), f64([1, 2, 3]), 10);
    for (let i = 1; i < r.xs.length; i++) expect(r.xs[i]).toBeGreaterThan(r.xs[i - 1]);
  });

  it('maxGapSeconds <= 0 or n < 2 -> identity', () => {
    const xs = f64([0, 100]);
    expect(injectGapsSingle(xs, f64([1, 2]), 0).gapsInjected).toBe(0);
    expect(injectGapsSingle(f64([5]), f64([1]), 10).xs.length).toBe(1);
  });
});

describe('splitSegmentsByGap', () => {
  it('empty / single point', () => {
    expect(splitSegmentsByGap(f64([]), 10)).toEqual([]);
    expect(splitSegmentsByGap(f64([1]), 10)).toEqual([{ start: 0, end: 0 }]);
  });

  it('no gaps -> one segment', () => {
    expect(splitSegmentsByGap(f64([0, 5, 10]), 10)).toEqual([{ start: 0, end: 2 }]);
  });

  it('k gaps -> k+1 segments with exact boundaries', () => {
    expect(splitSegmentsByGap(f64([0, 5, 100, 105, 300]), 50)).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 3 },
      { start: 4, end: 4 },
    ]);
  });
});

describe('lttbIndices', () => {
  const n = 100;
  const xs = f64(Array.from({ length: n }, (_, i) => i));
  const ys = f64(Array.from({ length: n }, (_, i) => Math.sin(i / 5)));

  it('threshold >= n or < 3 -> identity index list', () => {
    expect(lttbIndices(xs, ys, n)).toHaveLength(n);
    expect(lttbIndices(xs, ys, 2)).toHaveLength(n);
  });

  it('keeps first and last; output strictly increasing; length == threshold', () => {
    const idx = lttbIndices(xs, ys, 10);
    expect(idx).toHaveLength(10);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(n - 1);
    for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThan(idx[i - 1]);
  });
});

describe('minMaxIndicesPerBucket', () => {
  it('narrow spike and valley are selected', () => {
    const ys = f64(Array.from({ length: 100 }, (_, i) => (i === 37 ? 99 : i === 71 ? -99 : 0)));
    const picked = minMaxIndicesPerBucket(ys, 10);
    expect(picked.has(37)).toBe(true);
    expect(picked.has(71)).toBe(true);
  });

  it('NaN ignored; buckets <= 0 -> empty', () => {
    const ys = f64([NaN, 5, NaN, 1]);
    const picked = minMaxIndicesPerBucket(ys, 2);
    expect(picked.has(0)).toBe(false);
    expect(minMaxIndicesPerBucket(ys, 0).size).toBe(0);
  });
});

describe('downsampleSingle', () => {
  const n = 5000;
  const xs = f64(Array.from({ length: n }, (_, i) => i * 10));
  const ysFlat = f64(Array.from({ length: n }, () => 1));

  it('n <= threshold -> identity, ratio 1', () => {
    const r = downsampleSingle(f64([0, 1, 2]), f64([1, 2, 3]), 100, 60, true);
    expect(r.downsampleRatio).toBe(1);
    expect(r.xs.length).toBe(3);
  });

  it('reduces points and keeps segment boundaries; ratio == out/in', () => {
    const r = downsampleSingle(xs, ysFlat, 200, 60, false);
    expect(r.xs.length).toBeLessThan(n);
    expect(r.xs[0]).toBe(0);
    expect(r.xs[r.xs.length - 1]).toBe((n - 1) * 10);
    expect(r.downsampleRatio).toBeCloseTo(r.xs.length / n, 10);
  });

  it('preserveExtrema keeps a narrow spike', () => {
    const ys = f64(Array.from({ length: n }, (_, i) => (i === 2500 ? 1000 : Math.sin(i / 50))));
    const withExt = downsampleSingle(xs, ys, 100, 60, true);
    expect(Math.max(...Array.from(withExt.ys).filter(Number.isFinite))).toBe(1000);
    const withoutExt = downsampleSingle(xs, ys, 100, 60, false);
    expect(Math.max(...Array.from(withoutExt.ys).filter(Number.isFinite))).toBeLessThanOrEqual(1000);
  });

  it('fewer than 2 finite samples -> identity', () => {
    const ys = f64(Array.from({ length: n }, () => NaN));
    ys[10] = 5;
    const r = downsampleSingle(xs, ys, 100, 60, true);
    expect(r.downsampleRatio).toBe(1);
    expect(r.xs.length).toBe(n);
  });

  it('output xs strictly increasing', () => {
    const r = downsampleSingle(xs, ysFlat, 200, 60, true);
    for (let i = 1; i < r.xs.length; i++) expect(r.xs[i]).toBeGreaterThan(r.xs[i - 1]);
  });
});

describe('downsampleAligned', () => {
  const f64 = (a: number[]) => new Float64Array(a);

  it('n <= threshold -> identity, rawYs preserved, ratio 1', () => {
    const xs = f64([0, 10, 20]);
    const ys = f64([1, 2, 3]);
    const raw = f64([0.5, 1.5, 2.5]);
    const r = downsampleAligned(xs, ys, raw, 100, 60, false);
    expect(r.downsampleRatio).toBe(1);
    expect(r.xs).toBe(xs);
    expect(r.rawYs).toBe(raw);
  });

  it('rawYs subsampled with same indices as ys', () => {
    const xs = f64(Array.from({ length: 1000 }, (_, i) => i));
    const ys = f64(Array.from({ length: 1000 }, (_, i) => Math.sin(i / 20)));
    const raw = f64(Array.from({ length: 1000 }, (_, i) => i));
    const r = downsampleAligned(xs, ys, raw, 50, 60, false);
    expect(r.xs.length).toBeLessThan(1000);
    expect(r.xs.length).toBe(r.ys.length);
    expect(r.ys.length).toBe(r.rawYs.length);
    for (let i = 0; i < r.ys.length; i++) {
      if (Number.isFinite(r.xs[i])) {
        expect(r.rawYs[i]).toBe(r.xs[i]);
      }
    }
  });

  it('preserveExtrema keeps spike in both ys and rawYs', () => {
    const xs = f64(Array.from({ length: 1000 }, (_, i) => i));
    const ys = f64(Array.from({ length: 1000 }, (_, i) => i === 500 ? 999 : Math.sin(i / 50)));
    const raw = f64(Array.from({ length: 1000 }, (_, i) => i === 500 ? 111 : i));
    const withExt = downsampleAligned(xs, ys, raw, 50, 60, true);
    expect(Math.max(...Array.from(withExt.ys).filter(Number.isFinite))).toBe(999);
    for (let i = 0; i < withExt.ys.length; i++) {
      if (withExt.ys[i] === 999) {
        expect(withExt.rawYs[i]).toBe(111);
      }
    }
  });

  it('output xs strictly increasing; all arrays same length', () => {
    const xs = f64(Array.from({ length: 1000 }, (_, i) => i * 10));
    const ys = f64(Array.from({ length: 1000 }, () => 1));
    const raw = f64(Array.from({ length: 1000 }, () => 0.5));
    const r = downsampleAligned(xs, ys, raw, 100, 60, true);
    expect(r.xs.length).toBe(r.ys.length);
    expect(r.ys.length).toBe(r.rawYs.length);
    for (let i = 1; i < r.xs.length; i++) {
      expect(r.xs[i]).toBeGreaterThan(r.xs[i - 1]);
    }
  });

  it('NaN indices preserved in rawYs at same positions as ys', () => {
    const xs = f64([0, 10, 100, 200, 300]);
    const ys = f64([1, 2, NaN, 4, 5]);
    const raw = f64([0.5, 1.5, NaN, 3.5, 4.5]);
    const r = downsampleAligned(xs, ys, raw, 3, 15, false);
    for (let i = 0; i < r.ys.length; i++) {
      if (Number.isNaN(r.ys[i])) {
        expect(Number.isNaN(r.rawYs[i])).toBe(true);
      }
    }
  });

  it('fewer than 2 finite calibrated points -> identity', () => {
    const xs = f64([0, 10, 20]);
    const ys = f64([NaN, NaN, NaN]);
    const raw = f64([1, 2, 3]);
    const r = downsampleAligned(xs, ys, raw, 2, 60, false);
    expect(r.downsampleRatio).toBe(1);
    expect(r.rawYs.length).toBe(3);
  });
});

describe('quantile / computeDomains', () => {
  it('quantile interpolates; single element; empty -> NaN', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5);
    expect(quantile([7], 0.99)).toBe(7);
    expect(quantile([], 0.5)).toBeNaN();
  });

  it('domains: P01/P99 on y, min/max on x, NaN-y ignored', () => {
    const xs = f64([0, 1, 2, 3]);
    const ys = f64([10, NaN, 20, 30]);
    const d = computeDomains(xs, ys);
    expect(d.domainX).toEqual([0, 3]);
    expect(d.domainY![0]).toBeGreaterThanOrEqual(10);
    expect(d.domainY![1]).toBeLessThanOrEqual(30);
  });

  it('empty -> null domains; all-NaN y -> domainY null', () => {
    expect(computeDomains(f64([]), f64([]))).toEqual({ domainX: null, domainY: null });
    expect(computeDomains(f64([1]), f64([NaN])).domainY).toBeNull();
  });
});

describe('countFinite', () => {
  it('counts finite only', () => {
    expect(countFinite(f64([1, NaN, Infinity, -2]))).toBe(2);
  });
});

describe('cacheKey', () => {
  it('exact format with default source', () => {
    expect(
      cacheKey({ entityId: 'e1', attribute: 'temp_avg' }, '2026-01-01', '2026-01-02', 500)
    ).toBe('timescale|e1|temp_avg|2026-01-01|2026-01-02|500');
  });

  it('policy variant appends gap/threshold/extrema discriminators', () => {
    expect(
      cacheKey({ entityId: 'e1', attribute: 'temp_avg' }, '2026-01-01', '2026-01-02', 500, {
        maxGapSeconds: 7200,
        downsampleThreshold: 2000,
        preserveExtrema: true,
      })
    ).toBe('timescale|e1|temp_avg|2026-01-01|2026-01-02|500|g7200|t2000|e1');
  });
});

describe('selectEvictions', () => {
  const e = (key: string, bytes: number, lastAccess: number) => ({ key, bytes, lastAccess });

  it('under budget -> nothing evicted', () => {
    expect(selectEvictions([e('a', 10, 1)], 100)).toEqual([]);
  });

  it('evicts least-recently-used first, just enough to fit', () => {
    const out = selectEvictions([e('new', 60, 30), e('old', 60, 10), e('mid', 60, 20)], 130);
    expect(out).toEqual(['old']); // 180 - 60 = 120 <= 130
  });

  it('evicts multiple when needed, in LRU order', () => {
    const out = selectEvictions([e('c', 50, 3), e('a', 50, 1), e('b', 50, 2)], 60);
    expect(out).toEqual(['a', 'b']);
  });
});

describe('gap bridges survive downsampling (regression)', () => {
  it('bridge inside a segment (maxGap < gap < 2*maxGap) is retained', () => {
    // step 60s, maxGap 100s, one hole of 150s (100 < 150 < 200).
    // The hole's two half-intervals (75s each) are both < maxGap, so
    // splitSegmentsByGap does NOT split → the NaN bridge sits inside a single
    // segment and is at the mercy of LTTB. Neither LTTB (it substitutes NaN→avgY
    // when scoring area, pipeline.ts:93) nor minMaxIndicesPerBucket (it skips
    // non-finite, pipeline.ts:123) deliberately preserves the bridge — survival
    // is pure bucket-boundary luck. gapIdx=1237/threshold=200 is a configuration
    // where LTTB drops it; the original gapIdx=1500 accidentally aligned the NaN
    // with a sampled bucket boundary and masked the bug.
    const xsArr: number[] = [];
    for (let i = 0; i < 3000; i++) xsArr.push(i * 60);
    for (let i = 1237; i < 3000; i++) xsArr[i] += 90; // interval 1236->1237 becomes 150s
    const xs = f64(xsArr);
    const ys = f64(xsArr.map(() => 1));
    const injected = injectGapsSingle(xs, ys, 100);
    expect(injected.gapsInjected).toBe(1);
    const out = downsampleSingle(injected.xs, injected.ys, 200, 100, true);
    const nanCount = Array.from(out.ys).filter((v) => Number.isNaN(v)).length;
    expect(nanCount).toBe(1); // the visual break must survive (acceptance 3)
  });
});
