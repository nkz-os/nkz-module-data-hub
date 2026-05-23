import { renderHook, waitFor } from '@testing-library/react';
import { useCapabilityCatalog, useParcelCapabilities } from '../useCapability';
import { describe, it, expect, vi } from 'vitest';

describe('useCapability hooks', () => {
  it('useCapabilityCatalog fetches and returns grouped capabilities', async () => {
    (globalThis as unknown as Record<string, unknown>).fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        AgriSoilExtended: [{ attributeName: 'clayContent', entitlement: 'open' }],
      }),
    });
    const { result } = renderHook(() => useCapabilityCatalog());
    await waitFor(() => expect(result.current.status).toBe('ok'));
    if (result.current.status === 'ok') {
      expect((result.current.data.AgriSoilExtended as Array<{ attributeName: string }>)[0].attributeName).toBe('clayContent');
    }
  });

  it('useParcelCapabilities fetches per-parcel aggregation', async () => {
    (globalThis as unknown as Record<string, unknown>).fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ parcelId: 'p-1', capabilities: [], currentEntities: {} }),
    });
    const { result } = renderHook(() => useParcelCapabilities('p-1'));
    await waitFor(() => expect(result.current.status).toBe('ok'));
    if (result.current.status === 'ok') {
      expect(result.current.data.parcelId).toBe('p-1');
    }
  });
});
