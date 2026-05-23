import { render, screen, waitFor } from '@testing-library/react';
import { ParcelInspector } from '../ParcelInspector';
import { describe, it, expect, vi } from 'vitest';

// Minimal stub for useTranslation — returns the key as-is
vi.mock('@nekazari/sdk', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.message) return String(opts.message);
      if (opts?.parcelId) return `Parcel ${opts.parcelId}`;
      return key;
    },
  }),
}));

describe('ParcelInspector', () => {
  it('renders scalar values from currentEntities with provenance', async () => {
    (globalThis as unknown as Record<string, unknown>).fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        parcelId: 'p-1',
        capabilities: [
          {
            moduleId: 'soil',
            moduleVersion: '0.2.0',
            entityType: 'AgriSoilExtended',
            attributeName: 'organicCarbon',
            unitCode: 'P1',
            temporal: 'static',
            spatial: 'polygon-aggregated',
            sources: ['LUCAS'],
            entitlement: 'open',
            sdmStatus: 'draft-proposal',
            sdmProposal: 'SDM-001',
          },
        ],
        currentEntities: {
          AgriSoilExtended: [
            {
              id: 'urn:ngsi-ld:AgriSoilExtended:p-1',
              type: 'AgriSoilExtended',
              organicCarbon: {
                type: 'Property',
                value: 1.8,
                providedBy: { value: 'LUCAS-2018' },
                license: { value: 'JRC-LUCAS-2018' },
              },
            },
          ],
        },
      }),
    });

    render(<ParcelInspector parcelId="p-1" tenantEntitlements={['open']} />);
    await waitFor(() => expect(screen.getByText(/organicCarbon/)).toBeInTheDocument());
    expect(screen.getByText('1.8')).toBeInTheDocument();
    expect(screen.getByText('LUCAS-2018')).toBeInTheDocument();
    expect(screen.getByText('JRC-LUCAS-2018')).toBeInTheDocument();
  });
});
