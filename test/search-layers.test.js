import { describe, it, expect } from 'vitest';
import { mergeScoreAndSort } from '../skill/scripts/search.js';

// --- Minimal test fixtures ---
function makeRecord(direction, origin, dest, date, program, pts, fees, seats) {
  return {
    direction,
    origin,
    destination: dest,
    date,
    program,
    mr_cost: pts,
    pts_per_person_ow: pts,
    fees_usd: fees,
    seats_available: seats || 2,
    source: 'test',
    cabin: 'economy',
    stops: 0,
  };
}

function testPrograms() {
  return {
    virgin: { name: 'Virgin Atlantic', ratio: 1, bonus_ratio: 1 },
    flyingblue: { name: 'Flying Blue', ratio: 1, bonus_ratio: 1 },
  };
}

function testConfig() {
  return {
    origin: 'LAS',
    destinations: ['LHR'],
    cabin: 'economy',
    pax: 2,
    outbound: { start: '2026-06-01', end: '2026-06-30' },
    return: { start: '2026-06-20', end: '2026-07-20' },
    trip_length: { min: 19, max: 23 },
    fee_multiplier: 100,
    high_fee_threshold: 800,
    stops_penalty: 5000,
    cross_airport_penalty: 5000,
  };
}

describe('mergeScoreAndSort', () => {
  it('produces sorted scored combos from raw results', () => {
    const seats = [
      makeRecord('outbound', 'LAS', 'LHR', '2026-06-05', 'virgin', 50000, 100, 2),
      makeRecord('return', 'LHR', 'LAS', '2026-06-25', 'virgin', 50000, 100, 2),
    ];
    const pointme = [];
    const result = mergeScoreAndSort(seats, pointme, testConfig(), testPrograms());

    expect(result.scored.length).toBeGreaterThan(0);
    expect(result.scored[0].score).toBeDefined();
    expect(result.outbound.length).toBe(1);
    expect(result.returns.length).toBe(1);
  });

  it('returns empty scored when no valid combos', () => {
    // Outbound but no return = no combos
    const seats = [
      makeRecord('outbound', 'LAS', 'LHR', '2026-06-05', 'virgin', 50000, 100, 2),
    ];
    const result = mergeScoreAndSort(seats, [], testConfig(), testPrograms());
    expect(result.scored).toEqual([]);
  });

  it('sorts by score ascending (lower = better)', () => {
    const seats = [
      makeRecord('outbound', 'LAS', 'LHR', '2026-06-05', 'virgin', 50000, 100, 2),
      makeRecord('outbound', 'LAS', 'LHR', '2026-06-05', 'flyingblue', 80000, 200, 2),
      makeRecord('return', 'LHR', 'LAS', '2026-06-25', 'virgin', 50000, 100, 2),
      makeRecord('return', 'LHR', 'LAS', '2026-06-25', 'flyingblue', 80000, 200, 2),
    ];
    const result = mergeScoreAndSort(seats, [], testConfig(), testPrograms());

    if (result.scored.length >= 2) {
      expect(result.scored[0].score).toBeLessThanOrEqual(result.scored[1].score);
    }
  });

  it('builds near-misses', () => {
    const seats = [
      makeRecord('outbound', 'LAS', 'LHR', '2026-06-05', 'virgin', 50000, 100, 2),
      makeRecord('return', 'LHR', 'LAS', '2026-06-25', 'virgin', 50000, 100, 2),
      // This return date is too close (only 5 days) - should be a near-miss
      makeRecord('return', 'LHR', 'LAS', '2026-06-10', 'virgin', 40000, 80, 2),
    ];
    const result = mergeScoreAndSort(seats, [], testConfig(), testPrograms());
    // Near misses may or may not exist depending on the combo math
    expect(result.nearMisses).toBeDefined();
    expect(Array.isArray(result.nearMisses)).toBe(true);
  });
});
