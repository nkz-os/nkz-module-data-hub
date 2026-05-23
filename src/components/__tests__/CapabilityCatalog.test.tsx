import { render, screen, waitFor } from '@testing-library/react';
import { CapabilityCatalog } from '../CapabilityCatalog';
import { describe, it, expect, vi } from 'vitest';

// Minimal stub for useTranslation — returns the key as-is so tests don't depend on locale files
vi.mock('@nekazari/sdk', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.message) return String(opts.message);
      return key;
    },
  }),
}));

describe('CapabilityCatalog', () => {
  it('renders matrix rows per attribute with entitlement lock styling', async () => {
    (globalThis as unknown as Record<string, unknown>).fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        AgriSoilExtended: [
          {
            moduleId: 'soil',
            moduleVersion: '0.2.0',
            entityType: 'AgriSoilExtended',
            attributeName: 'clayContent',
            unitCode: 'P1',
            temporal: 'static',
            spatial: 'polygon-aggregated',
            sources: ['LUCAS'],
            entitlement: 'open',
            sdmStatus: 'draft-proposal',
            sdmProposal: 'SDM-001',
          },
          {
            moduleId: 'soil',
            moduleVersion: '0.2.0',
            entityType: 'AgriSoilExtended',
            attributeName: 'esdbOnly',
            unitCode: null,
            temporal: 'static',
            spatial: 'polygon-aggregated',
            sources: ['ESDB-vector'],
            entitlement: 'esdb-noncommercial',
            sdmStatus: 'draft-proposal',
            sdmProposal: 'SDM-001',
          },
        ],
      }),
    });

    render(<CapabilityCatalog tenantEntitlements={['open']} />);
    await waitFor(() => expect(screen.getByText('clayContent')).toBeInTheDocument());
    expect(screen.getByText('esdbOnly')).toBeInTheDocument();

    // The locked row (esdb-noncommercial) should carry the nkz-locked class
    const lockedRow = screen.getByText('esdbOnly').closest('tr')!;
    expect(lockedRow).toHaveClass('nkz-locked');

    // The open row should NOT be locked
    const openRow = screen.getByText('clayContent').closest('tr')!;
    expect(openRow).not.toHaveClass('nkz-locked');
  });
});
