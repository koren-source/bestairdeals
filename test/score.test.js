import { describe, it, expect } from "vitest";
import { scoreCombo, buildSummary } from "../skill/scripts/score.js";
import { PROGRAMS } from "../skill/scripts/programs.js";

function makeCombo(overrides = {}) {
  return {
    outbound: {
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
      ...(overrides.outbound || {}),
    },
    return: {
      source: "seats_aero",
      direction: "return",
      origin: "LHR",
      destination: "LAS",
      date: "2026-06-20",
      program: "flyingblue",
      airline: "KL",
      pts_per_person_ow: 23000,
      mr_cost: 23000,
      fees_usd: 0,
      seats_available: 8,
      stops: 0,
      ...(overrides.return || {}),
    },
    stay_days: overrides.stay_days ?? 19,
    total_pts: overrides.total_pts ?? 118000,
    total_fees: overrides.total_fees ?? 337,
    confirmed: overrides.confirmed ?? true,
  };
}

const defaultConfig = {
  fee_multiplier: 100,
  high_fee_threshold: 800,
  stops_penalty: 5000,
  cross_airport_penalty: 5000,
};

describe("scoreCombo", () => {
  it("basic: 118000 pts + $337 fees at multiplier 100", () => {
    const combo = makeCombo();
    const scored = scoreCombo(combo, defaultConfig);
    // 118000 + (337 * 100) + (1 stop * 5000) + 0 cross = 118000 + 33700 + 5000 = 156700
    expect(scored.score).toBe(118000 + 33700 + 5000);
  });

  it("HIGH_FEES: $900 triggers flag, $700 does not", () => {
    const highFee = scoreCombo(makeCombo({ total_fees: 900 }), defaultConfig);
    expect(highFee.flags).toContain("HIGH_FEES");

    const lowFee = scoreCombo(makeCombo({ total_fees: 700 }), defaultConfig);
    expect(lowFee.flags).not.toContain("HIGH_FEES");
  });

  it("custom fee_multiplier: 70 instead of 100", () => {
    const combo = makeCombo({ total_pts: 118000, total_fees: 337 });
    const scored = scoreCombo(combo, { ...defaultConfig, fee_multiplier: 70 });
    // 118000 + (337 * 70) + (1 * 5000) = 118000 + 23590 + 5000 = 146590
    expect(scored.score).toBe(118000 + 23590 + 5000);
  });

  it("zero fees: score = just pts + stops penalty", () => {
    const combo = makeCombo({ total_pts: 118000, total_fees: 0 });
    const scored = scoreCombo(combo, defaultConfig);
    // 118000 + 0 + 5000 (1 stop outbound) = 123000
    expect(scored.score).toBe(118000 + 5000);
  });

  it("stops penalty: 1-stop out + 0-stop return at 5000/stop adds 5000", () => {
    const combo = makeCombo({
      outbound: { stops: 1 },
      return: { stops: 0 },
    });
    const scored = scoreCombo(combo, defaultConfig);
    const baseScore = combo.total_pts + combo.total_fees * defaultConfig.fee_multiplier;
    expect(scored.score).toBe(baseScore + 5000);
  });

  it("DIFFERENT_AIRPORTS: outbound dest LHR, return origin LGW", () => {
    const combo = makeCombo({
      outbound: { destination: "LHR" },
      return: { origin: "LGW" },
    });
    const scored = scoreCombo(combo, defaultConfig);
    expect(scored.flags).toContain("DIFFERENT_AIRPORTS");
    // Score includes cross-airport penalty
    const baseScore = combo.total_pts + combo.total_fees * defaultConfig.fee_multiplier + 5000; // 1 stop
    expect(scored.score).toBe(baseScore + defaultConfig.cross_airport_penalty);
  });

  it("custom stops_penalty: 10000 instead of 5000", () => {
    const combo = makeCombo({
      outbound: { stops: 2 },
      return: { stops: 1 },
    });
    const cfg = { ...defaultConfig, stops_penalty: 10000 };
    const scored = scoreCombo(combo, cfg);
    // 3 total stops * 10000 = 30000 penalty
    const baseScore = combo.total_pts + combo.total_fees * cfg.fee_multiplier;
    expect(scored.score).toBe(baseScore + 30000);
  });

  it("STOPS_UNKNOWN flag: stops=0 and source=seats_aero", () => {
    const combo = makeCombo({
      outbound: { stops: 0, source: "seats_aero" },
      return: { stops: 1, source: "point_me" },
    });
    const scored = scoreCombo(combo, defaultConfig);
    expect(scored.flags).toContain("STOPS_UNKNOWN");
  });

  it("buildSummary: returns formatted string with correct values", () => {
    const combo = makeCombo();
    const scored = scoreCombo(combo, defaultConfig);
    const summary = buildSummary(scored, 1, 50, PROGRAMS);

    expect(summary).toContain("Flying Blue outbound 2026-06-01");
    expect(summary).toContain("Flying Blue return 2026-06-20");
    expect(summary).toContain("118000 MR");
    expect(summary).toContain("$337 fees");
    expect(summary).toContain("1-stop out");
    expect(summary).toContain("0-stop back");
    expect(summary).toContain("19-day trip");
    expect(summary).toContain(`rank #1 of 50`);
  });
});
