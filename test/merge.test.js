import { describe, it, expect } from "vitest";
import { mergeAndDedup } from "../skill/scripts/merge.js";
import { PROGRAMS } from "../skill/scripts/programs.js";

function makeRecord(overrides = {}) {
  return {
    source: "seats_aero",
    direction: "outbound",
    origin: "LAS",
    destination: "LHR",
    date: "2026-06-01",
    program: "flyingblue",
    airline: "KL",
    pts_per_person_ow: 36000,
    fees_usd: 168.5,
    seats_available: 8,
    stops: 1,
    ...overrides,
  };
}

describe("mergeAndDedup", () => {
  it("both sources, same key: [Both] tag, point.me price wins", () => {
    const seatsRec = makeRecord({ pts_per_person_ow: 40000, fees_usd: 200, seats_available: 8 });
    const pointmeRec = makeRecord({ source: "point_me", pts_per_person_ow: 36000, fees_usd: 168.5, seats_available: null });

    const merged = mergeAndDedup([seatsRec], [pointmeRec], PROGRAMS);

    expect(merged).toHaveLength(1);
    expect(merged[0].source_tag).toBe("Both");
    // point.me price wins
    expect(merged[0].pts_per_person_ow).toBe(36000);
    expect(merged[0].fees_usd).toBe(168.5);
    // Seats.aero seat count preserved
    expect(merged[0].seats_available).toBe(8);
  });

  it("API-only record gets [API] tag", () => {
    const seatsRec = makeRecord();
    const merged = mergeAndDedup([seatsRec], [], PROGRAMS);

    // With pointme empty, everything becomes PARTIAL
    // This test checks a non-empty pointme scenario
    const merged2 = mergeAndDedup(
      [seatsRec],
      [makeRecord({ source: "point_me", date: "2026-06-05" })], // different key
      PROGRAMS
    );
    const apiOnly = merged2.find((r) => r.date === "2026-06-01");
    expect(apiOnly.source_tag).toBe("API");
  });

  it("Verified-only record gets [Verified] tag", () => {
    const pointmeRec = makeRecord({ source: "point_me", date: "2026-06-10" });
    const seatsRec = makeRecord({ date: "2026-06-01" }); // different key

    const merged = mergeAndDedup([seatsRec], [pointmeRec], PROGRAMS);
    const verifiedOnly = merged.find((r) => r.date === "2026-06-10");
    expect(verifiedOnly.source_tag).toBe("Verified");
  });

  it("one agent empty: all records tagged [PARTIAL]", () => {
    const seatsRecs = [makeRecord(), makeRecord({ date: "2026-06-05" })];

    const merged = mergeAndDedup(seatsRecs, [], PROGRAMS);
    for (const r of merged) {
      expect(r.source_tag).toBe("PARTIAL");
    }

    const merged2 = mergeAndDedup([], [makeRecord({ source: "point_me" })], PROGRAMS);
    for (const r of merged2) {
      expect(r.source_tag).toBe("PARTIAL");
    }
  });

  it("MR normalization: JetBlue 80000 pts at 0.8 ratio = mr_cost 100000", () => {
    const jbRec = makeRecord({
      program: "jetblue",
      airline: "B6",
      pts_per_person_ow: 80000,
      source: "point_me",
    });

    // Need a seats record so pointme isn't the only source (otherwise PARTIAL)
    const seatsRec = makeRecord({ date: "2026-06-05" });

    const merged = mergeAndDedup([seatsRec], [jbRec], PROGRAMS);
    const jb = merged.find((r) => r.program === "jetblue");

    expect(jb.mr_cost).toBe(100000); // 80000 / 0.8
  });

  it("[Both] result takes point.me price + Seats.aero seat count", () => {
    const seatsRec = makeRecord({
      pts_per_person_ow: 45000,
      fees_usd: 250,
      seats_available: 4,
    });
    const pointmeRec = makeRecord({
      source: "point_me",
      pts_per_person_ow: 36000,
      fees_usd: 168.5,
      seats_available: null,
    });

    const merged = mergeAndDedup([seatsRec], [pointmeRec], PROGRAMS);

    expect(merged).toHaveLength(1);
    expect(merged[0].pts_per_person_ow).toBe(36000); // point.me price
    expect(merged[0].fees_usd).toBe(168.5); // point.me fees
    expect(merged[0].seats_available).toBe(4); // seats.aero seats
    expect(merged[0].source_tag).toBe("Both");
  });
});
