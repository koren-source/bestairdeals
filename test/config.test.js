import { describe, it, expect } from 'vitest';
import { validateConfig, validateSearchParams, expandFlexDates } from '../skill/scripts/config.js';

// --- Helper: valid exact config ---
function validConfig(overrides = {}) {
  return {
    origin: 'LAS',
    destinations: ['LHR', 'LGW'],
    cabin: 'economy',
    pax: 2,
    outbound: { start: '2026-06-01', end: '2026-07-31' },
    return: { start: '2026-06-20', end: '2026-08-21' },
    trip_length: { min: 19, max: 23 },
    ...overrides,
  };
}

describe('validateConfig', () => {
  it('accepts a valid config and applies defaults', () => {
    const cfg = validateConfig(validConfig());
    expect(cfg.origin).toBe('LAS');
    expect(cfg.fee_multiplier).toBe(100);
    expect(cfg.stops_penalty).toBe(5000);
  });

  it('throws on missing origin', () => {
    expect(() => validateConfig(validConfig({ origin: '' }))).toThrow('"origin"');
  });

  it('throws on empty destinations', () => {
    expect(() => validateConfig(validConfig({ destinations: [] }))).toThrow('"destinations"');
  });

  it('throws on invalid cabin', () => {
    expect(() => validateConfig(validConfig({ cabin: 'luxury' }))).toThrow('"cabin"');
  });

  it('throws on pax < 1', () => {
    expect(() => validateConfig(validConfig({ pax: 0 }))).toThrow('"pax"');
  });

  it('throws on bad date format', () => {
    expect(() => validateConfig(validConfig({ outbound: { start: '06-01-2026', end: '2026-07-31' } }))).toThrow('YYYY-MM-DD');
  });

  it('throws on start > end', () => {
    expect(() => validateConfig(validConfig({ outbound: { start: '2026-08-01', end: '2026-06-01' } }))).toThrow('before');
  });

  it('throws on trip_length.min > max', () => {
    expect(() => validateConfig(validConfig({ trip_length: { min: 25, max: 20 } }))).toThrow('<=');
  });

  it('preserves custom scoring params', () => {
    const cfg = validateConfig(validConfig({ fee_multiplier: 200 }));
    expect(cfg.fee_multiplier).toBe(200);
  });
});

describe('validateSearchParams', () => {
  it('validates exact mode params', () => {
    const cfg = validateSearchParams({
      mode: 'exact',
      origin: 'LAS',
      destinations: ['LHR'],
      cabin: 'economy',
      pax: 2,
      outbound: { start: '2026-06-01', end: '2026-07-31' },
      return: { start: '2026-06-20', end: '2026-08-21' },
      trip_length: { min: 19, max: 23 },
    });
    expect(cfg.origin).toBe('LAS');
  });

  it('validates flex mode params and expands dates', () => {
    const cfg = validateSearchParams({
      mode: 'flex',
      origin: 'LAS',
      destinations: ['LHR'],
      cabin: 'economy',
      pax: 2,
      outbound: { month: '2026-06' },
      trip_length: { min: 19, max: 23 },
    });
    expect(cfg.outbound.start).toBe('2026-06-01');
    expect(cfg.outbound.end).toBe('2026-06-30');
    expect(cfg.return.start).toBe('2026-06-20');
  });

  it('throws on invalid mode', () => {
    expect(() => validateSearchParams({ mode: 'yolo' })).toThrow('"mode"');
  });

  it('throws on flex without month', () => {
    expect(() => validateSearchParams({
      mode: 'flex',
      origin: 'LAS',
      destinations: ['LHR'],
      cabin: 'economy',
      pax: 1,
      outbound: {},
      trip_length: { min: 19, max: 23 },
    })).toThrow('month');
  });
});

describe('expandFlexDates', () => {
  it('expands June with 19-23 day trip correctly', () => {
    const result = expandFlexDates('2026-06', { min: 19, max: 23 });
    expect(result.outbound.start).toBe('2026-06-01');
    expect(result.outbound.end).toBe('2026-06-30');
    expect(result.return.start).toBe('2026-06-20');
    expect(result.return.end).toBe('2026-07-23');
  });

  it('handles December year boundary', () => {
    const result = expandFlexDates('2026-12', { min: 7, max: 14 });
    expect(result.outbound.start).toBe('2026-12-01');
    expect(result.outbound.end).toBe('2026-12-31');
    expect(result.return.start).toBe('2026-12-08');
    expect(result.return.end).toBe('2027-01-14');
  });

  it('handles February (28 days)', () => {
    const result = expandFlexDates('2026-02', { min: 5, max: 10 });
    expect(result.outbound.start).toBe('2026-02-01');
    expect(result.outbound.end).toBe('2026-02-28');
  });

  it('throws on invalid month format', () => {
    expect(() => expandFlexDates('June 2026', { min: 5, max: 10 })).toThrow('YYYY-MM');
  });
});
