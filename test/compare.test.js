import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { compareWithHistory } from "../skill/scripts/compare.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const TEST_HISTORY_DIR = join("output", "test-history-compare");

function makeCombo(overrides = {}) {
  return {
    outbound: { date: "2026-06-05", program: "flyingblue", destination: "LHR", origin: "LAS", airline: "KL", stops: 1, seats_available: 8, mr_cost: 36000, fees_usd: 168.5 },
    return: { date: "2026-06-23", program: "flyingblue", origin: "LHR", destination: "LAS", airline: "KL", stops: 1, seats_available: 8, mr_cost: 36000, fees_usd: 168.5 },
    stay_days: 18,
    total_pts: 144000,
    total_fees: 674,
    score: 211400,
    confirmed: true,
    source_tag: "Both",
    ...overrides,
  };
}

function makeHistoryEntry(overrides = {}) {
  return {
    ts: "2026-04-02T10:00:00Z",
    origin: "LAS",
    dest_out: "LHR",
    dest_ret: "LHR",
    date_out: "2026-06-05",
    date_ret: "2026-06-23",
    program_out: "flyingblue",
    program_ret: "flyingblue",
    total_pts: 144000,
    total_fees: 674,
    score: 211400,
    pax: 2,
    source_tag: "Both",
    confirmed: true,
    ...overrides,
  };
}

function writeHistoryFile(entries, fileName = "2026-04-02-100000.jsonl") {
  mkdirSync(TEST_HISTORY_DIR, { recursive: true });
  const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(join(TEST_HISTORY_DIR, fileName), content, "utf-8");
}

describe("compareWithHistory", () => {
  beforeEach(() => {
    mkdirSync(TEST_HISTORY_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_HISTORY_DIR, { recursive: true, force: true });
  });

  it("detects price drop when same combo has lower score", () => {
    // Previous run: score 211400
    writeHistoryFile([makeHistoryEntry({ score: 211400 })]);

    // Current run: same combo, lower score (better deal)
    const current = [makeCombo({ score: 180000 })];
    const result = compareWithHistory(current, TEST_HISTORY_DIR);

    expect(result.firstRun).toBe(false);
    expect(result.priceDrops).toHaveLength(1);
    expect(result.priceDrops[0].score).toBe(180000);
    expect(result.priceDrops[0].previous_score).toBe(211400);
    expect(result.priceDrops[0].delta).toBe(31400);
    expect(result.newDeals).toHaveLength(0);
    expect(result.gone).toHaveLength(0);
  });

  it("detects new availability when combo not in previous run", () => {
    writeHistoryFile([makeHistoryEntry()]);

    // Current run has original combo + a new one on different dates
    const newCombo = makeCombo({
      outbound: { ...makeCombo().outbound, date: "2026-06-10", program: "virgin" },
      return: { ...makeCombo().return, date: "2026-06-28", program: "virgin" },
    });
    const result = compareWithHistory([makeCombo(), newCombo], TEST_HISTORY_DIR);

    expect(result.firstRun).toBe(false);
    expect(result.newDeals).toHaveLength(1);
    expect(result.newDeals[0].program_out).toBe("virgin");
  });

  it("detects gone combos that were in previous but not current", () => {
    // Previous had two combos
    writeHistoryFile([
      makeHistoryEntry(),
      makeHistoryEntry({ date_out: "2026-06-08", date_ret: "2026-06-26", program_out: "aeroplan", program_ret: "aeroplan" }),
    ]);

    // Current only has the first one
    const result = compareWithHistory([makeCombo()], TEST_HISTORY_DIR);

    expect(result.firstRun).toBe(false);
    expect(result.gone).toHaveLength(1);
    expect(result.gone[0].program_out).toBe("aeroplan");
  });

  it("returns firstRun=true when no history files exist", () => {
    // Empty directory, no files
    const result = compareWithHistory([makeCombo()], TEST_HISTORY_DIR);

    expect(result.firstRun).toBe(true);
    expect(result.newDeals).toHaveLength(0);
    expect(result.priceDrops).toHaveLength(0);
    expect(result.gone).toHaveLength(0);
  });
});
