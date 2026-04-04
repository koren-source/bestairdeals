/**
 * Output writer. Writes ranked combos to CSV (Google Sheets integration is TODO).
 *
 * Three output artifacts:
 * 1. Main results CSV — two-tier: Confirmed Available, then Likely Available
 * 2. Near-misses CSV — date and seat near-misses
 * 3. Heatmap CSV — outbound x return date matrix with min score per cell
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { PROGRAMS } from "./programs.js";

// TODO: Implement Google Sheets API integration via OpenClaw on Mac Mini.
// For now, all output goes to CSV files in output/.

const RESULTS_COLUMNS = [
  "Rank",
  "Tier",
  "Outbound Date",
  "Return Date",
  "Stay Days",
  "Program Out",
  "Program Ret",
  "Airline Out",
  "Airline Ret",
  "Total Points (MR)",
  "Total Fees ($)",
  "Score",
  "Flags",
  "Source Tag",
  "Stops Out",
  "Stops Ret",
  "Summary",
  "Booking Instructions",
];

const NEAR_MISS_COLUMNS = [
  "Type",
  "Outbound Date",
  "Return Date",
  "Stay Days",
  "Program Out",
  "Program Ret",
  "Total Points",
  "Total Fees",
  "Near-Miss Reason",
  "Pts Delta",
  "No Baseline",
];

/**
 * Escape a value for CSV (double-quote if it contains comma, quote, or newline).
 */
function csvEscape(val) {
  const str = val == null ? "" : String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function csvRow(values) {
  return values.map(csvEscape).join(",");
}

/**
 * Build booking instructions for a combo.
 */
function bookingInstructions(combo) {
  const progOut = combo.outbound.program;
  const progRet = combo.return.program;
  const steps = [];

  if (combo.source_tag === "Both" || combo.source_tag === "Verified") {
    steps.push("Book via point.me booking link (real-time availability confirmed).");
  } else {
    steps.push(`Transfer MR to ${PROGRAMS[progOut]?.name ?? progOut} for outbound.`);
    if (progOut !== progRet) {
      steps.push(`Transfer MR to ${PROGRAMS[progRet]?.name ?? progRet} for return.`);
    }
    steps.push("Book directly on airline site.");
  }

  return steps.join(" ");
}

/**
 * Format scored combos into CSV rows.
 */
function formatResultRows(combos, startRank) {
  return combos.map((combo, i) => {
    const rank = startRank + i;
    return csvRow([
      rank,
      combo.confirmed ? "Confirmed" : "Likely",
      combo.outbound.date,
      combo.return.date,
      combo.stay_days,
      PROGRAMS[combo.outbound.program]?.name ?? combo.outbound.program,
      PROGRAMS[combo.return.program]?.name ?? combo.return.program,
      combo.outbound.airline ?? "",
      combo.return.airline ?? "",
      combo.total_pts,
      combo.total_fees.toFixed(2),
      combo.score,
      (combo.flags ?? []).join("; "),
      combo.source_tag ?? "",
      combo.outbound.stops ?? 0,
      combo.return.stops ?? 0,
      combo.summary ?? "",
      bookingInstructions(combo),
    ]);
  });
}

/**
 * Write main results, near-misses, and heatmap to CSV files.
 *
 * @param {object[]} results - scored combos, sorted by score ASC
 * @param {object[]} nearMisses - near-miss combos from buildNearMisses()
 * @param {object} config - trip config
 * @returns {{ results: string, nearMisses: string, heatmap: string }} file paths
 */
export function writeToSheet(results, nearMisses, config) {
  mkdirSync("output", { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const paths = {};

  // --- Main results CSV (two-tier) ---
  const confirmed = results.filter((c) => c.confirmed);
  const likely = results.filter((c) => !c.confirmed);

  const lines = [];
  lines.push(csvRow(RESULTS_COLUMNS));

  if (confirmed.length > 0) {
    lines.push("");
    lines.push("CONFIRMED AVAILABLE");
    lines.push(...formatResultRows(confirmed, 1));
  }

  if (likely.length > 0) {
    lines.push("");
    lines.push("LIKELY AVAILABLE (seats unverified)");
    lines.push(...formatResultRows(likely, confirmed.length + 1));
  }

  const resultsPath = join("output", `results-${ts}.csv`);
  writeFileSync(resultsPath, lines.join("\n") + "\n", "utf-8");
  paths.results = resultsPath;

  // --- Near-misses CSV ---
  if (nearMisses && nearMisses.length > 0) {
    const nmLines = [];
    nmLines.push(csvRow(NEAR_MISS_COLUMNS));

    if (nearMisses[0]?.no_baseline) {
      nmLines.push("No qualifying combos found -- showing closest misses.");
    }

    for (const nm of nearMisses) {
      nmLines.push(
        csvRow([
          nm.reason,
          nm.outbound.date,
          nm.return.date,
          nm.stay_days,
          PROGRAMS[nm.outbound.program]?.name ?? nm.outbound.program,
          PROGRAMS[nm.return.program]?.name ?? nm.return.program,
          nm.total_pts,
          nm.total_fees.toFixed(2),
          nm.reason === "date"
            ? `Stay ${nm.stay_days}d (range ${config.trip_length.min}-${config.trip_length.max}d)`
            : `Seats below ${config.pax} pax requirement`,
          nm.pts_delta != null ? nm.pts_delta : "",
          nm.no_baseline ? "true" : "",
        ])
      );
    }

    const nmPath = join("output", `near-misses-${ts}.csv`);
    writeFileSync(nmPath, nmLines.join("\n") + "\n", "utf-8");
    paths.nearMisses = nmPath;
  }

  // --- Heatmap CSV ---
  const heatmap = buildHeatmap(results);
  if (heatmap) {
    const heatmapPath = join("output", `heatmap-${ts}.csv`);
    writeFileSync(heatmapPath, heatmap, "utf-8");
    paths.heatmap = heatmapPath;
  }

  console.log(`Results written to: ${resultsPath}`);
  return paths;
}

/**
 * Build a heatmap CSV: rows = outbound dates, columns = return dates,
 * cells = min score for that date pair.
 */
function buildHeatmap(results) {
  if (!results.length) return null;

  // Collect unique dates
  const outDates = [...new Set(results.map((c) => c.outbound.date))].sort();
  const retDates = [...new Set(results.map((c) => c.return.date))].sort();

  // Build min-score lookup: "outDate|retDate" -> min score
  const lookup = new Map();
  for (const c of results) {
    const key = `${c.outbound.date}|${c.return.date}`;
    const prev = lookup.get(key);
    if (prev === undefined || c.score < prev) {
      lookup.set(key, c.score);
    }
  }

  // Header row
  const lines = [];
  lines.push(csvRow(["Outbound \\ Return", ...retDates]));

  // Data rows
  for (const outDate of outDates) {
    const cells = retDates.map((retDate) => {
      const val = lookup.get(`${outDate}|${retDate}`);
      return val !== undefined ? val : "";
    });
    lines.push(csvRow([outDate, ...cells]));
  }

  return lines.join("\n") + "\n";
}
