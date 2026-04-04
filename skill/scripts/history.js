/**
 * Price history writer. Appends scored combos as JSONL for historical comparison.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const HISTORY_DIR = join("output", "history");

/**
 * Write scored combos to a JSONL history file.
 *
 * @param {object[]} scoredCombos - scored combo objects
 * @param {object} config - trip config (origin, pax, etc.)
 * @returns {string} path to the written file
 */
export function writeHistory(scoredCombos, config) {
  mkdirSync(HISTORY_DIR, { recursive: true });

  const now = new Date();
  // Format: YYYY-MM-DD-HHmmss
  const fileName = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.jsonl`;

  const lines = scoredCombos.map((combo) => {
    return JSON.stringify({
      ts: now.toISOString(),
      origin: config.origin,
      dest_out: combo.outbound.destination,
      dest_ret: combo.return ? combo.return.origin : '',
      date_out: combo.outbound.date,
      date_ret: combo.return ? combo.return.date : '',
      program_out: combo.outbound.program,
      program_ret: combo.return ? combo.return.program : '',
      total_pts: combo.total_pts,
      total_fees: combo.total_fees,
      score: combo.score,
      pax: config.pax,
      source_tag: combo.source_tag ?? null,
      confirmed: combo.confirmed ?? false,
    });
  });

  const filePath = join(HISTORY_DIR, fileName);
  writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");
  console.log(`History written: ${filePath} (${scoredCombos.length} combos)`);

  return filePath;
}

function pad(n) {
  return String(n).padStart(2, "0");
}
