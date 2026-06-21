/**
 * Unit tests for the shared parsing helpers.
 *
 * These tests verify the data-shape contract between the DataHub BFF and the
 * web worker. Any BFF change that alters the JSON shape MUST keep these green.
 */

import { describe, it, expect } from 'vitest';
import { parseSingleSeriesPayload, toFiniteNumber, timestampToEpochSeconds } from '../parsing';

// ── toFiniteNumber ──────────────────────────────────────────────────────────

describe('toFiniteNumber', () => {
  it('returns number for finite numbers', () => {
    expect(toFiniteNumber(42)).toBe(42);
    expect(toFiniteNumber(-3.14)).toBe(-3.14);
  });

  it('returns null for NaN and Infinity', () => {
    expect(toFiniteNumber(NaN)).toBeNull();
    expect(toFiniteNumber(Infinity)).toBeNull();
    expect(toFiniteNumber(-Infinity)).toBeNull();
  });

  it('parses numeric strings', () => {
    expect(toFiniteNumber('42')).toBe(42);
    expect(toFiniteNumber('3.14')).toBe(3.14);
  });

  it('returns null for non-numeric strings', () => {
    expect(toFiniteNumber('hello')).toBeNull();
  });

  it('returns null for null/undefined', () => {
    expect(toFiniteNumber(null)).toBeNull();
    expect(toFiniteNumber(undefined)).toBeNull();
  });
});

// ── timestampToEpochSeconds ─────────────────────────────────────────────────

describe('timestampToEpochSeconds', () => {
  it('normalises millisecond epochs to seconds', () => {
    const ms = 1717459200000; // 2024-06-04T00:00:00.000Z in ms
    expect(timestampToEpochSeconds(ms)).toBeCloseTo(1717459200, 0);
  });

  it('passes through second epochs unchanged', () => {
    expect(timestampToEpochSeconds(1717459200)).toBe(1717459200);
  });

  it('parses ISO-8601 strings', () => {
    const result = timestampToEpochSeconds('2024-06-04T00:00:00Z');
    expect(result).toBeCloseTo(1717459200, 0);
  });

  it('returns null for unparseable strings', () => {
    expect(timestampToEpochSeconds('not a date')).toBeNull();
  });
});

// ── parseSingleSeriesPayload ────────────────────────────────────────────────

describe('parseSingleSeriesPayload', () => {
  // ── Shape 1: { timestamps, values } (canonical BFF single-attr) ──────────

  it('parses canonical { timestamps, values } shape', () => {
    const result = parseSingleSeriesPayload({
      timestamps: [1717459200, 1717459260, 1717459320],
      values: [20.5, 21.0, 19.8],
    });
    expect(result.xs.length).toBe(3);
    expect(result.ys.length).toBe(3);
    expect(result.ys[0]).toBe(20.5);
    expect(result.ys[1]).toBe(21.0);
    expect(result.ys[2]).toBe(19.8);
  });

  // Regression: Bug 2 — BFF parcel weather API returned {values: {"temp_avg": [...]}}
  // before the fix. This shape must NOT be accepted as valid values.
  it('handles dict-shaped values gracefully (returns empty, not crash)', () => {
    const result = parseSingleSeriesPayload({
      timestamps: ['2024-06-04T00:00:00Z'],
      values: { temp_avg: [20.5] },
    });
    // Dict values is not an array → falls through to empty. No crash.
    expect(result.xs).toBeInstanceOf(Float64Array);
    expect(result.ys).toBeInstanceOf(Float64Array);
  });

  // ── Shape 2: { timestamps, value_0, value_1, ... } (multi-attr / align) ──

  it('parses multi-attr { value_0 } shape (align/export path)', () => {
    const result = parseSingleSeriesPayload({
      timestamps: [1717459200, 1717459260],
      value_0: [15.0, 16.5],
      value_1: [30.0, 32.0],
    });
    // Only value_0 is consumed for a single series.
    expect(result.xs.length).toBe(2);
    expect(result.ys[0]).toBe(15.0);
    expect(result.ys[1]).toBe(16.5);
  });

  // ── Shape 3: { timestamps, attributes: { attr: [...] } } (reader raw) ────

  it('falls back to attributes dict (reader raw format)', () => {
    const result = parseSingleSeriesPayload({
      timestamps: ['2024-06-04T00:00:00Z'],
      attributes: { temp_avg: [22.1] },
    });
    expect(result.xs.length).toBe(1);
    expect(result.ys[0]).toBe(22.1);
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it('returns empty arrays for null/undefined data', () => {
    const result = parseSingleSeriesPayload(null);
    expect(result.xs.length).toBe(0);
    expect(result.ys.length).toBe(0);
  });

  it('returns empty for 204-style empty payload', () => {
    const result = parseSingleSeriesPayload({ timestamps: [], values: [] });
    expect(result.xs.length).toBe(0);
    expect(result.ys.length).toBe(0);
  });

  it('handles NaN / null values in series', () => {
    const result = parseSingleSeriesPayload({
      timestamps: [1717459200, 1717459260, 1717459320],
      values: [20.5, null, 19.8],
    });
    expect(result.xs.length).toBe(3);
    expect(result.ys[0]).toBe(20.5);
    expect(Number.isNaN(result.ys[1])).toBe(true);
    expect(result.ys[2]).toBe(19.8);
  });

  it('sorts out-of-order timestamps', () => {
    const result = parseSingleSeriesPayload({
      timestamps: [1717459320, 1717459200, 1717459260],
      values: [19.8, 20.5, 21.0],
    });
    expect(result.xs[0]).toBeLessThan(result.xs[1]);
    expect(result.xs[1]).toBeLessThan(result.xs[2]);
  });

  it('deduplicates timestamps keeping the last finite value', () => {
    const result = parseSingleSeriesPayload({
      timestamps: [1717459200, 1717459200],
      values: [20.5, 21.0],
    });
    expect(result.xs.length).toBe(1);
    expect(result.ys[0]).toBe(21.0); // last finite wins
  });

  // ── raw_values ────────────────────────────────────────────────────────────

  it('parses raw_values when present', () => {
    const result = parseSingleSeriesPayload({
      timestamps: [1717459200, 1717459260, 1717459320],
      values: [20.5, 21.0, 19.8],
      raw_values: [1.0, 2.0, 3.0],
    });
    expect(result.xs.length).toBe(3);
    expect(result.rawValues).toBeInstanceOf(Float64Array);
    expect(result.rawValues!.length).toBe(3);
    expect(result.rawValues![0]).toBe(1.0);
    expect(result.rawValues![1]).toBe(2.0);
    expect(result.rawValues![2]).toBe(3.0);
  });

  it('returns rawValues as null when raw_values absent', () => {
    const result = parseSingleSeriesPayload({
      timestamps: [1717459200, 1717459260, 1717459320],
      values: [20.5, 21.0, 19.8],
    });
    expect(result.rawValues).toBeNull();
  });

  it('returns rawValues as null when raw_values length mismatches', () => {
    const result = parseSingleSeriesPayload({
      timestamps: [1717459200, 1717459260, 1717459320],
      values: [20.5, 21.0, 19.8],
      raw_values: [1.0], // wrong length
    });
    expect(result.rawValues).toBeNull();
  });

  it('handles null/NaN in raw_values', () => {
    const result = parseSingleSeriesPayload({
      timestamps: [1717459200, 1717459260, 1717459320],
      values: [20.5, 21.0, 19.8],
      raw_values: [1.0, null, 3.0],
    });
    expect(result.rawValues![0]).toBe(1.0);
    expect(Number.isNaN(result.rawValues![1])).toBe(true);
    expect(result.rawValues![2]).toBe(3.0);
  });

  it('aligns raw_values correctly after normalization (out-of-order ts)', () => {
    const result = parseSingleSeriesPayload({
      timestamps: [1717459320, 1717459200, 1717459260],
      values: [19.8, 20.5, 21.0],
      raw_values: [3.0, 1.0, 2.0],
    });
    // After sort: xs = [1717459200, 1717459260, 1717459320]
    // raw should follow: [1.0, 2.0, 3.0]
    expect(result.rawValues![0]).toBe(1.0);
    expect(result.rawValues![1]).toBe(2.0);
    expect(result.rawValues![2]).toBe(3.0);
  });

  it('aligns raw_values correctly after dedup of timestamps', () => {
    const result = parseSingleSeriesPayload({
      timestamps: [1717459200, 1717459200, 1717459260],
      values: [20.5, 21.0, 19.8],
      raw_values: [10.0, 11.0, 12.0],
    });
    // After dedup: xs = [1717459200, 1717459260]
    // raw should be [11.0, 12.0] — last raw at duplicated ts wins
    expect(result.xs.length).toBe(2);
    expect(result.rawValues![0]).toBe(11.0);
    expect(result.rawValues![1]).toBe(12.0);
  });
});
