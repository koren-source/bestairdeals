import { describe, it, expect, afterEach } from "vitest";
import { writeHistory } from "../skill/scripts/history.js";
import { existsSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";

const HISTORY_DIR = join("output", "history");

const MOCK_CONFIG = {
  origin: "LAS",
  pax: 2,
};

function makeScoredCombo(overrides = {}) {
  return {
    outbound: { date: "2026-06-05", destination: "LHR", origin: "LAS", program: "flyingblue", airline: "KL", stops: 1, seats_available: 8, mr_cost: 36000, fees_usd: 168.5 },
    return: { date: "2026-06-23", origin: "LHR", destination: "LAS", program: "flyingblue", airline: "KL", stops: 1, seats_available: 8, mr_cost: 36000, fees_usd: 168.5 },
    stay_days: 18,
    total_pts: 144000,
    total_fees: 674,
    score: 211400,
    confirmed: true,
    source_tag: "Both",
    ...overrides,
  };
}

describe("writeHistory", () => {
  let writtenFile = null;

  afterEach(() => {
    // Clean up only the file we wrote, not the whole directory
    if (writtenFile && existsSync(writtenFile)) {
      rmSync(writtenFile);
    }
  });

  it("creates output/history/ directory", () => {
    writtenFile = writeHistory([makeScoredCombo()], MOCK_CONFIG);
    expect(existsSync(HISTORY_DIR)).toBe(true);
  });

  it("writes valid JSONL where each line is parseable JSON", () => {
    const combos = [makeScoredCombo(), makeScoredCombo({ score: 180000 })];
    writtenFile = writeHistory(combos, MOCK_CONFIG);

    const content = readFileSync(writtenFile, "utf-8").trim();
    const lines = content.split("\n");
    expect(lines).toHaveLength(2);

    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed).toHaveProperty("ts");
      expect(parsed).toHaveProperty("origin", "LAS");
      expect(parsed).toHaveProperty("dest_out", "LHR");
      expect(parsed).toHaveProperty("date_out", "2026-06-05");
      expect(parsed).toHaveProperty("date_ret", "2026-06-23");
      expect(parsed).toHaveProperty("program_out", "flyingblue");
      expect(parsed).toHaveProperty("program_ret", "flyingblue");
      expect(parsed).toHaveProperty("total_pts");
      expect(parsed).toHaveProperty("total_fees");
      expect(parsed).toHaveProperty("score");
      expect(parsed).toHaveProperty("pax", 2);
      expect(parsed).toHaveProperty("source_tag");
      expect(parsed).toHaveProperty("confirmed");
    }
  });

  it("file name matches YYYY-MM-DD-HHmmss.jsonl pattern", () => {
    writtenFile = writeHistory([makeScoredCombo()], MOCK_CONFIG);
    const fileName = writtenFile.split("/").pop();
    // Pattern: 2026-04-03-153000.jsonl
    expect(fileName).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}\.jsonl$/);
  });
});
