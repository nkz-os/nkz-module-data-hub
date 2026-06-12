import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  DatahubWorkerRequest,
  DatahubWorkerResponse,
} from '../contracts/datahubWorkerV2';

type Posted = { msg: DatahubWorkerResponse; transfer: Transferable[] };

interface FakeSelf {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (msg: unknown, transfer?: Transferable[]) => void;
  location: { origin: string };
}

export async function loadWorker(fetchImpl: typeof fetch) {
  const posted: Posted[] = [];
  const fakeSelf: FakeSelf = {
    onmessage: null,
    postMessage: (msg, transfer) =>
      posted.push({ msg: msg as DatahubWorkerResponse, transfer: transfer ?? [] }),
    location: { origin: 'http://test.local' },
  };
  vi.stubGlobal('self', fakeSelf);
  vi.stubGlobal('fetch', fetchImpl);
  vi.resetModules();
  await import('../datahubWorker'); // assigns fakeSelf.onmessage
  const send = (data: unknown) => fakeSelf.onmessage!({ data } as MessageEvent);
  const expectResponses = async (n: number): Promise<Posted[]> => {
    await vi.waitFor(() => expect(posted.length).toBeGreaterThanOrEqual(n), { timeout: 2000 });
    return posted;
  };
  return { send, expectResponses, posted };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Series payload: `count` points starting at epoch `t0` seconds. */
export function seriesPayload(t0: number, count: number, stepSec: number, value = 20): unknown {
  return {
    timestamps: Array.from({ length: count }, (_, i) => t0 + i * stepSec),
    values: Array.from({ length: count }, (_, i) => value + (i % 7)),
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const T0 = 1_760_000_000;

export function baseRequest(over: Partial<DatahubWorkerRequest> = {}): DatahubWorkerRequest {
  return {
    type: 'PROCESS_SERIES',
    requestId: 'req-1',
    contractVersion: 2.1,
    mode: 'single',
    baseUrl: 'http://bff.test',
    startTime: '2026-06-01T00:00:00Z',
    endTime: '2026-06-02T00:00:00Z',
    resolution: 500,
    series: [{ entityId: 'urn:ngsi-ld:Device:station-1', attribute: 'temp_avg' }],
    policy: {
      maxGapSeconds: 7200,
      downsampleThreshold: 2000,
      viewportWidthPx: 1200,
      preserveExtrema: true,
    },
    ...over,
  };
}

function assertV21Invariants(resp: DatahubWorkerResponse) {
  expect(resp.type).toBe('PROCESS_SERIES_RESULT');
  expect(resp.contractVersion).toBe(2.1);
  for (const s of resp.series) {
    expect(s.ys.length).toBe(s.xs.length);
    for (let i = 0; i < s.xs.length; i++) {
      expect(Number.isFinite(s.xs[i])).toBe(true);
      if (i > 0) expect(s.xs[i]).toBeGreaterThan(s.xs[i - 1]);
      expect(s.ys[i]).not.toBe(Infinity);
      expect(s.ys[i]).not.toBe(-Infinity);
    }
  }
}

describe('V2.1 invariants', () => {
  it('clean single series: monotonic xs, aligned ys, echoed ids, no NaN without gaps', async () => {
    const { send, expectResponses } = await loadWorker(
      vi.fn(async () => jsonResponse(seriesPayload(T0, 50, 3600)))
    );
    send(baseRequest());
    const [r] = await expectResponses(1);
    assertV21Invariants(r.msg);
    expect(r.msg.requestId).toBe('req-1');
    expect(r.msg.series).toHaveLength(1);
    expect(r.msg.series[0].entityId).toBe('urn:ngsi-ld:Device:station-1');
    expect(Array.from(r.msg.series[0].ys).every(Number.isFinite)).toBe(true);
    expect(r.msg.stats.rawPointsFetched).toBe(50);
    expect(r.msg.error).toBeUndefined();
  });

  it('gap > maxGapSeconds -> NaN exactly at injected bridges (acceptance 3)', async () => {
    // Block 1: T0+0h … T0+9h (10 pts).  Block 2: T0+21h … T0+30h (10 pts).
    // Gap between T0+9h and T0+21h = 12h = 43200s >> maxGapSeconds=7200 → 1 bridge injected.
    const payload = {
      timestamps: [
        ...Array.from({ length: 10 }, (_, i) => T0 + i * 3600),
        ...Array.from({ length: 10 }, (_, i) => T0 + 21 * 3600 + i * 3600),
      ],
      values: Array.from({ length: 20 }, () => 21),
    };
    const { send, expectResponses } = await loadWorker(vi.fn(async () => jsonResponse(payload)));
    send(baseRequest());
    const [r] = await expectResponses(1);
    assertV21Invariants(r.msg);
    const s = r.msg.series[0];
    expect(s.stats.gapsInjected).toBe(1);
    const nanCount = Array.from(s.ys).filter((v) => Number.isNaN(v)).length;
    expect(nanCount).toBe(1);
  });

  it('multi-series with disjoint native timestamps -> independent payloads in request order (acceptance 1)', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes('temp_avg')) return jsonResponse(seriesPayload(T0, 24, 3600, 20));
      return jsonResponse(seriesPayload(T0 + 300, 144, 600, 5));
    });
    const { send, expectResponses } = await loadWorker(fetchMock);
    send(
      baseRequest({
        mode: 'multi',
        series: [
          { entityId: 'urn:ngsi-ld:Device:station-1', attribute: 'temp_avg' },
          { entityId: 'urn:ngsi-ld:Device:station-1', attribute: 'wind_speed' },
        ],
      })
    );
    const [r] = await expectResponses(1);
    assertV21Invariants(r.msg);
    expect(r.msg.series.map((s) => s.attribute)).toEqual(['temp_avg', 'wind_speed']);
    expect(r.msg.series[0].xs.length).not.toBe(r.msg.series[1].xs.length);
    expect(r.msg.stats.rawPointsFetched).toBe(24 + 144);
  });
});

describe('transfer + cache (acceptance 4)', () => {
  it('transfer list contains every series buffer', async () => {
    const { send, expectResponses } = await loadWorker(
      vi.fn(async () => jsonResponse(seriesPayload(T0, 30, 3600)))
    );
    send(baseRequest());
    const [r] = await expectResponses(1);
    const expected = r.msg.series.flatMap((s) => [s.xs.buffer, s.ys.buffer]);
    expect(r.transfer).toHaveLength(expected.length);
    for (const buf of expected) expect(r.transfer).toContain(buf);
  });

  it('identical second request served from cache as a CLONE, without refetch', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(seriesPayload(T0, 30, 3600)));
    const { send, expectResponses } = await loadWorker(fetchMock);
    send(baseRequest({ requestId: 'req-1' }));
    await expectResponses(1);
    send(baseRequest({ requestId: 'req-2' }));
    const posted = await expectResponses(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const a = posted[0].msg.series[0];
    const b = posted[1].msg.series[0];
    expect(b.xs).not.toBe(a.xs);
    expect(Array.from(b.xs)).toEqual(Array.from(a.xs));
    expect(b.stats.rawPointsFetched).toBe(a.stats.rawPointsFetched);
  });

  it('forceRefresh bypasses the cache', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(seriesPayload(T0, 30, 3600)));
    const { send, expectResponses } = await loadWorker(fetchMock);
    send(baseRequest({ requestId: 'req-1' }));
    await expectResponses(1);
    send(baseRequest({ requestId: 'req-2', forceRefresh: true }));
    await expectResponses(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('RELEASE_SERIES drops the cached key -> next request refetches', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(seriesPayload(T0, 30, 3600)));
    const { send, expectResponses, posted } = await loadWorker(fetchMock);
    send(baseRequest({ requestId: 'req-1' }));
    await expectResponses(1);
    const key = posted[0].msg.series[0].key;
    send({ type: 'RELEASE_SERIES', keys: [key] });
    send(baseRequest({ requestId: 'req-2' }));
    await expectResponses(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
