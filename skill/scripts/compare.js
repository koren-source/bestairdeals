/**
 * History comparison engine.
 * Diffs current scored combos against the most recent historical run.
 * Detects new deals, price drops, and gone combos.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Build a match key for a combo history entry.
 * Key: date_out|date_ret|program_out|program_ret
 */
function makeKey(entry) {
  return `${entry.date_out}|${entry.date_ret}|${entry.program_out}|${entry.program_ret}`;
}

/**
 * Compare current combos with the most recent history file.
 *
 * @param {object[]} currentCombos - scored combos from this run (full combo objects)
 * @param {string} historyDir - path to output/history/
 * @returns {{ firstRun: boolean, newDeals: object[], priceDrops: object[], gone: object[] }}
 */
export function compareWithHistory(currentCombos, historyDir) {
  let files;
  try {
    files = readdirSync(historyDir).filter((f) => f.endsWith(".jsonl")).sort();
  } catch {
    return { firstRun: true, newDeals: [], priceDrops: [], gone: [] };
  }

  if (files.length === 0) {
    return { firstRun: true, newDeals: [], priceDrops: [], gone: [] };
  }

  // Most recent file is last (lexicographic sort = chronological for YYYY-MM-DD-HHmmss)
  const latestFile = join(historyDir, files[files.length - 1]);
  const previousEntries = readFileSync(latestFile, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  // Build lookup from previous run
  const prevMap = new Map();
  for (const entry of previousEntries) {
    prevMap.set(makeKey(entry), entry);
  }

  // Normalize current combos to history format for comparison
  const currentEntries = currentCombos.map((combo) => ({
    date_out: combo.outbound.date,
    date_ret: combo.return ? combo.return.date : '',
    program_out: combo.outbound.program,
    program_ret: combo.return ? combo.return.program : '',
    total_pts: combo.total_pts,
    total_fees: combo.total_fees,
    score: combo.score,
    confirmed: combo.confirmed ?? false,
    source_tag: combo.source_tag ?? null,
  }));

  const currentMap = new Map();
  for (const entry of currentEntries) {
    currentMap.set(makeKey(entry), entry);
  }

  const newDeals = [];
  const priceDrops = [];
  const gone = [];

  // New deals + price drops: iterate current
  for (const [key, current] of currentMap) {
    const prev = prevMap.get(key);
    if (!prev) {
      newDeals.push(current);
    } else if (current.score < prev.score) {
      priceDrops.push({
        ...current,
        previous_score: prev.score,
        delta: prev.score - current.score,
      });
    }
  }

  // Gone: in previous but not in current
  for (const [key, prev] of prevMap) {
    if (!currentMap.has(key)) {
      gone.push(prev);
    }
  }

  return { firstRun: false, newDeals, priceDrops, gone };
}
