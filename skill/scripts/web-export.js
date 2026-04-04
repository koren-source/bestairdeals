/**
 * web-export.js — Writes search results as data.json for the Vercel static dashboard.
 *
 * Call writeWebData() after a search run to update the web/data.json file
 * that the static index.html reads via fetch.
 *
 * @example
 *   import { writeWebData } from './web-export.js';
 *   writeWebData(scored, nearMisses, config, programs);
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MR_VALUE_USD } from "./programs.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(__dirname, "..", "..", "web");
const DATA_PATH = join(WEB_DIR, "data.json");

/**
 * Write scored combos + config to web/data.json for the static dashboard.
 *
 * @param {object[]} scored - Scored combos sorted by score ASC (lower = better)
 * @param {object[]} nearMisses - Near-miss combos
 * @param {object} config - Trip config from trip.json
 * @param {object} programs - PROGRAMS config object from programs.js
 * @returns {string} File path of the written data.json
 */
export function writeWebData(scored, nearMisses, config, programs) {
  mkdirSync(WEB_DIR, { recursive: true });

  const tsDisplay = new Date().toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  // Slim leg data to only what the dashboard needs
  function slimLeg(leg) {
    return {
      date: leg.date,
      origin: leg.origin,
      destination: leg.destination,
      program: leg.program,
      airline: leg.airline || "",
      stops: leg.stops ?? 0,
      fees_usd: leg.fees_usd ?? 0,
    };
  }

  const dataPayload = {
    scored: scored.map((c, i) => ({
      rank: i + 1,
      confirmed: c.confirmed,
      outbound: slimLeg(c.outbound),
      return: slimLeg(c.return),
      stay_days: c.stay_days,
      total_pts: c.total_pts,
      total_fees: c.total_fees,
      score: c.score,
      flags: c.flags || [],
      source_tag: c.source_tag || null,
      award_cost_usd: c.award_cost_usd ?? +((c.total_pts * MR_VALUE_USD + c.total_fees).toFixed(2)),
      cash_price_usd: c.cash_price_usd ?? null,
      value_ratio: c.value_ratio ?? null,
      verdict: c.verdict ?? null,
    })),
    nearMisses: (nearMisses || []).slice(0, 50).map((nm) => ({
      reason: nm.reason,
      outbound: slimLeg(nm.outbound),
      return: slimLeg(nm.return),
      stay_days: nm.stay_days,
      total_pts: nm.total_pts,
      total_fees: nm.total_fees,
    })),
    config: {
      origin: config.origin,
      destinations: config.destinations,
      cabin: config.cabin,
      pax: config.pax,
      outbound: config.outbound,
      return: config.return,
      trip_length: config.trip_length,
    },
    programs: Object.fromEntries(
      Object.entries(programs).map(([k, v]) => [k, { name: v.name }])
    ),
    timestamp: tsDisplay,
  };

  writeFileSync(DATA_PATH, JSON.stringify(dataPayload), "utf-8");
  console.log(`[web-export] web/data.json written (${scored.length} combos)`);
  return DATA_PATH;
}
