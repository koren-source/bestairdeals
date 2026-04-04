import { describe, it, expect } from "vitest";
import { buildCombos, buildNearMisses } from "../skill/scripts/combo.js";

const config = {
  pax: 2,
  trip_length: { min: 18, max: 21 },
  fee_multiplier: 100,
  stops_penalty: 5000,
  cross_airport_penalty: 5000,
};

function makeRecord(overrides) {
  return {
    source: "seats_aero",
    direction: "outbound",
    origin: "LAS",
    destination: "LHR",
    date: "2026-06-01",
    program: "flyingblue",
    airline: "KL",
    pts_per_person_ow: 36000,
    mr_cost: 36000,
    fees_usd: 168.5,
    seats_available: 8,
    stops: 1,
    ...overrides,
  };
}

describe("buildCombos", () => {
  it("happy path: 2 outbound x 2 return with valid trip lengths", () => {
    const outbound = [
      makeRecord({ date: "2026-06-01" }),
      makeRecord({ date: "2026-06-03" }),
    ];
    const returns = [
      makeRecord({ direction: "return", origin: "LHR", destination: "LAS", date: "2026-06-20" }),
      makeRecord({ direction: "return", origin: "LHR", destination: "LAS", date: "2026-06-22" }),
    ];

    const combos = buildCombos(outbound, returns, config);

    // Jun 1 -> Jun 20 = 19 days (valid)
    // Jun 1 -> Jun 22 = 21 days (valid)
    // Jun 3 -> Jun 20 = 17 days (invalid, < 18)
    // Jun 3 -> Jun 22 = 19 days (valid)
    expect(combos).toHaveLength(3);
    expect(combos[0].stay_days).toBe(19);
    expect(combos[0].total_pts).toBe((36000 + 36000) * 2);
    expect(combos[0].total_fees).toBe((168.5 + 168.5) * 2);
  });

  it("trip length filtering: 17 excluded, 18 included, 21 included, 22 excluded", () => {
    const out = [makeRecord({ date: "2026-06-01" })];

    const returns = [
      makeRecord({ direction: "return", origin: "LHR", destination: "LAS", date: "2026-06-18" }), // 17 days
      makeRecord({ direction: "return", origin: "LHR", destination: "LAS", date: "2026-06-19" }), // 18 days
      makeRecord({ direction: "return", origin: "LHR", destination: "LAS", date: "2026-06-22" }), // 21 days
      makeRecord({ direction: "return", origin: "LHR", destination: "LAS", date: "2026-06-23" }), // 22 days
    ];

    const combos = buildCombos(out, returns, config);
    const days = combos.map((c) => c.stay_days).sort();
    expect(days).toEqual([18, 21]);
  });

  it("seat filtering: 1 seat excluded when pax=2", () => {
    const out = [makeRecord({ date: "2026-06-01", seats_available: 1 })];
    const ret = [
      makeRecord({ direction: "return", origin: "LHR", destination: "LAS", date: "2026-06-20", seats_available: 8 }),
    ];

    const combos = buildCombos(out, ret, config);
    expect(combos).toHaveLength(0);
  });

  it("cross-destination: outbound LHR, return LGW is valid", () => {
    const out = [makeRecord({ date: "2026-06-01", destination: "LHR" })];
    const ret = [
      makeRecord({ direction: "return", origin: "LGW", destination: "LAS", date: "2026-06-20" }),
    ];

    const combos = buildCombos(out, ret, config);
    expect(combos).toHaveLength(1);
    expect(combos[0].outbound.destination).toBe("LHR");
    expect(combos[0].return.origin).toBe("LGW");
  });

  it("empty inputs: no outbounds, no returns, both empty", () => {
    const ret = [
      makeRecord({ direction: "return", origin: "LHR", destination: "LAS", date: "2026-06-20" }),
    ];

    expect(buildCombos([], ret, config)).toHaveLength(0);
    expect(buildCombos([makeRecord()], [], config)).toHaveLength(0);
    expect(buildCombos([], [], config)).toHaveLength(0);
  });

  it("null fields: record with null mr_cost is skipped", () => {
    const out = [makeRecord({ date: "2026-06-01", mr_cost: null })];
    const ret = [
      makeRecord({ direction: "return", origin: "LHR", destination: "LAS", date: "2026-06-20" }),
    ];

    const combos = buildCombos(out, ret, config);
    expect(combos).toHaveLength(0);
  });

  it("large dataset: 50 outbound x 50 return", () => {
    const outbound = [];
    const returns = [];

    // Generate 50 valid outbound dates: Jun 1 - Jun 30, then Jul 1 - Jul 20
    for (let i = 0; i < 50; i++) {
      const d = new Date(Date.UTC(2026, 5, 1 + i)); // June 1 + i
      const dateStr = d.toISOString().slice(0, 10);
      outbound.push(makeRecord({ date: dateStr }));
    }

    // Generate 50 valid return dates: Jul 1 - Aug 19
    for (let i = 0; i < 50; i++) {
      const d = new Date(Date.UTC(2026, 6, 1 + i)); // July 1 + i
      const dateStr = d.toISOString().slice(0, 10);
      returns.push(
        makeRecord({ direction: "return", origin: "LHR", destination: "LAS", date: dateStr })
      );
    }

    const combos = buildCombos(outbound, returns, config);
    // Every combo should have stay_days between 18 and 21
    for (const c of combos) {
      expect(c.stay_days).toBeGreaterThanOrEqual(18);
      expect(c.stay_days).toBeLessThanOrEqual(21);
    }
    expect(combos.length).toBeGreaterThan(0);
  });

  it("two-tier: seats_available=null means confirmed=false", () => {
    const out = [makeRecord({ date: "2026-06-01", seats_available: null })];
    const ret = [
      makeRecord({ direction: "return", origin: "LHR", destination: "LAS", date: "2026-06-20", seats_available: 8 }),
    ];

    const combos = buildCombos(out, ret, config);
    expect(combos).toHaveLength(1);
    expect(combos[0].confirmed).toBe(false);
  });
});

describe("buildNearMisses", () => {
  it("date near-miss: 17-day stay when min=18", () => {
    const out = [makeRecord({ date: "2026-06-01" })];
    const ret = [
      makeRecord({ direction: "return", origin: "LHR", destination: "LAS", date: "2026-06-18" }), // 17 days = min-1
    ];

    // Provide a qualifying combo for baseline
    const qualifyingCombos = [{ score: 200000 }];
    const nearMisses = buildNearMisses(out, ret, config, qualifyingCombos);

    expect(nearMisses).toHaveLength(1);
    expect(nearMisses[0].stay_days).toBe(17);
    expect(nearMisses[0].reason).toBe("date");
    expect(nearMisses[0].pts_delta).toBeTypeOf("number");
  });

  it("seat near-miss: 1 seat when pax=2", () => {
    const out = [makeRecord({ date: "2026-06-01", seats_available: 1 })];
    const ret = [
      makeRecord({ direction: "return", origin: "LHR", destination: "LAS", date: "2026-06-20", seats_available: 8 }),
    ];

    const qualifyingCombos = [];
    const nearMisses = buildNearMisses(out, ret, config, qualifyingCombos);

    expect(nearMisses).toHaveLength(1);
    expect(nearMisses[0].reason).toBe("seats");
    expect(nearMisses[0].pts_delta).toBeNull();
    expect(nearMisses[0].no_baseline).toBe(true);
  });
});
