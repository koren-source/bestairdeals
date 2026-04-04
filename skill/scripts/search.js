/**
 * search.js — Orchestrator
 *
 * Runs both agents (Seats.aero API + point.me browser) in parallel,
 * merges and deduplicates results, builds combos, scores, and outputs
 * to Google Sheet (CSV fallback).
 */

import 'dotenv/config';
import { readFileSync } from 'fs';
import { searchSeatsAero } from './seats-aero.js';
import { searchPointMe } from './pointme.js';
import { mergeAndDedup } from './merge.js';
import { buildCombos, buildNearMisses } from './combo.js';
import { scoreCombo, buildSummary } from './score.js';
import { PROGRAMS } from './programs.js';
import { writeToSheet } from './sheets.js';
import { writeHistory } from './history.js';
import { detectBonuses } from './bonus-detect.js';
import { notify, buildNotifyMessage } from './notify.js';
import { addCashPrices, getBrowseServer } from './cash-price.js';
import { writeReport } from './report.js';
import { writeWebData } from './web-export.js';

const VALID_CABINS = ['economy', 'premium', 'business', 'first'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Load and validate trip.json config.
 * Throws on invalid config with a descriptive message.
 *
 * @returns {Object} Validated config
 */
function loadConfig() {
  let raw;
  try {
    raw = readFileSync('trip.json', 'utf-8');
  } catch (err) {
    throw new Error(`Cannot read trip.json: ${err.message}`);
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in trip.json: ${err.message}`);
  }

  // Required fields
  if (!config.origin || typeof config.origin !== 'string') {
    throw new Error('trip.json: "origin" must be a non-empty string');
  }

  if (!Array.isArray(config.destinations) || config.destinations.length === 0) {
    throw new Error('trip.json: "destinations" must be a non-empty array');
  }

  if (!VALID_CABINS.includes(config.cabin)) {
    throw new Error(`trip.json: "cabin" must be one of: ${VALID_CABINS.join(', ')}. Got: "${config.cabin}"`);
  }

  if (typeof config.pax !== 'number' || config.pax < 1) {
    throw new Error('trip.json: "pax" must be a number >= 1');
  }

  // Date validation
  for (const field of ['outbound', 'return']) {
    const range = config[field];
    if (!range || !range.start || !range.end) {
      throw new Error(`trip.json: "${field}" must have "start" and "end" dates`);
    }
    if (!DATE_RE.test(range.start) || !DATE_RE.test(range.end)) {
      throw new Error(`trip.json: "${field}" dates must be YYYY-MM-DD format`);
    }
    if (range.start > range.end) {
      throw new Error(`trip.json: "${field}.start" must be before "${field}.end"`);
    }
  }

  // Trip length
  if (!config.trip_length || typeof config.trip_length.min !== 'number' || typeof config.trip_length.max !== 'number') {
    throw new Error('trip.json: "trip_length" must have numeric "min" and "max"');
  }
  if (config.trip_length.min > config.trip_length.max) {
    throw new Error('trip.json: "trip_length.min" must be <= "trip_length.max"');
  }

  // Defaults for optional scoring params
  config.fee_multiplier = config.fee_multiplier ?? 100;
  config.high_fee_threshold = config.high_fee_threshold ?? 800;
  config.stops_penalty = config.stops_penalty ?? 5000;
  config.cross_airport_penalty = config.cross_airport_penalty ?? 5000;

  return config;
}

/**
 * Run the full search pipeline.
 *
 * When called from cron.js, config and programs are passed in.
 * When called standalone (main), they are loaded internally.
 *
 * @param {object} [extConfig] - pre-loaded config (optional, loads trip.json if omitted)
 * @param {object} [extPrograms] - programs with bonuses already applied (optional)
 * @returns {{ scored, nearMisses, config, localPrograms, filePaths, outbound, returns, totalRecords }}
 */
export async function runSearch(extConfig, extPrograms) {
  // 1. Load and validate config
  const config = extConfig ?? loadConfig();
  console.log(`[search] Trip: ${config.origin} -> ${config.destinations.join(', ')} | ${config.cabin} | ${config.pax} pax`);
  console.log(`[search] Outbound: ${config.outbound.start} to ${config.outbound.end}`);
  console.log(`[search] Return:   ${config.return.start} to ${config.return.end}`);
  console.log(`[search] Stay:     ${config.trip_length.min}-${config.trip_length.max} days`);

  // Preflight: check browse server for cash price lookups
  const browseServer = getBrowseServer();
  if (browseServer) {
    console.log(`[search] ✓ Browse server found (port ${browseServer.port}) — cash prices ENABLED`);
  } else {
    console.warn('[search] ✗ No browse server — cash prices will be SKIPPED');
    console.warn('[search]   Start the browse daemon first if you want Google Flights cash prices');
  }

  // 2. Detect transfer bonuses (runs before Promise.all — shares browser with pointme.js)
  let localPrograms;
  if (extPrograms) {
    localPrograms = extPrograms;
  } else {
    console.log('\n[search] Checking for Amex transfer bonuses...');
    localPrograms = { ...PROGRAMS };
    // Deep copy bonus_ratio so we never mutate the original
    for (const key of Object.keys(localPrograms)) {
      localPrograms[key] = { ...localPrograms[key] };
    }

    try {
      const bonuses = await detectBonuses();

      if (bonuses && bonuses.length > 0) {
        for (const bonus of bonuses) {
          // Validate: ratio between 1.0 and 2.0, program exists
          if (!localPrograms[bonus.program]) {
            console.warn(`[search] WARN: Bonus for unknown program "${bonus.program}" — skipping`);
            continue;
          }
          if (typeof bonus.bonus_ratio !== 'number' || bonus.bonus_ratio < 1.0 || bonus.bonus_ratio > 2.0) {
            console.warn(`[search] WARN: Invalid bonus ratio ${bonus.bonus_ratio} for ${bonus.program} — skipping`);
            continue;
          }

          localPrograms[bonus.program].bonus_ratio = bonus.bonus_ratio;
          console.log(`[search] Applied bonus: ${bonus.program} ${bonus.bonus_ratio}x from ${bonus.source_url || 'unknown source'}`);
        }
      } else {
        console.log('[search] No active transfer bonuses detected');
      }
    } catch (err) {
      console.warn(`[search] WARN: Bonus detection failed: ${err.message} — continuing without bonuses`);
    }
  }

  // 3. Run both agents in parallel
  console.log('\n[search] Launching parallel sweeps...');
  const [seatsResults, pointmeResults] = await Promise.all([
    searchSeatsAero(config, localPrograms).catch((err) => {
      console.error(`[search] ERROR: Seats.aero sweep failed: ${err.message}`);
      return [];
    }),
    searchPointMe(config).catch((err) => {
      console.error(`[search] ERROR: point.me sweep failed: ${err.message}`);
      return [];
    }),
  ]);

  const totalRecords = seatsResults.length + pointmeResults.length;
  console.log(`\n[search] Seats.aero: ${seatsResults.length} records`);
  console.log(`[search] point.me:   ${pointmeResults.length} records`);
  console.log(`[search] Total raw:  ${totalRecords} records`);

  // 4. Both empty = fatal
  if (seatsResults.length === 0 && pointmeResults.length === 0) {
    console.error('\n[search] FATAL: Both agents returned zero results. Nothing to process.');
    process.exit(1);
  }

  // 5. Merge and deduplicate (also applies MR normalization)
  console.log('\n[search] Merging and deduplicating...');
  const merged = mergeAndDedup(seatsResults, pointmeResults, localPrograms);
  console.log(`[search] After merge: ${merged.length} unique records`);

  // 6. Split into outbound and return
  const outbound = merged.filter((r) => r.direction === 'outbound');
  const returns = merged.filter((r) => r.direction === 'return');
  console.log(`[search] Outbound: ${outbound.length} | Return: ${returns.length}`);

  // 7. Build combos
  console.log('\n[search] Building combos...');
  const combos = buildCombos(outbound, returns, config);
  console.log(`[search] Valid combos: ${combos.length}`);

  if (combos.length === 0) {
    console.warn('[search] WARN: No valid combos found. Check dates, trip length, and seat availability.');
  }

  // 8. Score and sort (lower = better)
  const scored = combos.map((c) => scoreCombo(c, config));
  scored.sort((a, b) => a.score - b.score);

  // 9. Set summary on each scored combo
  scored.forEach((c, i) => {
    c.summary = buildSummary(c, i + 1, scored.length, localPrograms);
  });

  // 10. Split into confirmed and likely tiers
  const confirmed = scored.filter((c) => c.confirmed);
  const likely = scored.filter((c) => !c.confirmed);
  console.log(`[search] Confirmed: ${confirmed.length} | Likely: ${likely.length}`);

  // 11. Build near-misses
  const nearMisses = buildNearMisses(outbound, returns, config, scored);
  console.log(`[search] Near-misses: ${nearMisses.length}`);

  // 12. Cash price comparison for top 3
  console.log('\n[search] Looking up cash prices for top 3 deals...');
  let topWithCash = [];
  try {
    topWithCash = await addCashPrices(scored, config, 3);
    console.log('\n[search] === TOP 3 DEALS (Points vs Cash) ===');
    for (let i = 0; i < topWithCash.length; i++) {
      const c = topWithCash[i];
      const progOut = localPrograms[c.outbound.program]?.name ?? c.outbound.program;
      const progRet = localPrograms[c.return.program]?.name ?? c.return.program;
      console.log(`  #${i + 1}: ${progOut} ${c.outbound.date} → ${progRet} ${c.return.date} (${c.stay_days}d)`);
      console.log(`      ${c.total_pts.toLocaleString()} MR + $${c.total_fees.toFixed(2)} fees = $${c.award_cost_usd} award cost`);
      console.log(`      Cash price: ${c.cash_price_usd != null ? '$' + c.cash_price_usd : 'N/A'} | Value: ${c.value_ratio ?? '?'}x | ${c.verdict}`);
      console.log(`      Book outbound: https://amex.point.me/results?departureIata=${c.outbound.origin}&arrivalIata=${c.outbound.destination}&departureDate=${c.outbound.date}&classOfService=${config.cabin}&legType=oneWay&passengers=${config.pax}`);
      console.log(`      Book return:   https://amex.point.me/results?departureIata=${c.return.origin}&arrivalIata=${c.return.destination}&departureDate=${c.return.date}&classOfService=${config.cabin}&legType=oneWay&passengers=${config.pax}`);
      console.log(`      Transfer MR:   https://global.americanexpress.com/rewards/transfer`);
    }
  } catch (err) {
    console.warn(`[search] WARN: Cash price lookup failed: ${err.message}`);
  }

  // 13. Log top 5 deals
  if (scored.length > 0) {
    console.log('\n[search] Top 5 deals:');
    const top5 = scored.slice(0, 5);
    for (let i = 0; i < top5.length; i++) {
      console.log(`  ${top5[i].summary}`);
    }
  }

  // 14. Merge cash prices into scored results
  if (topWithCash.length > 0) {
    for (let i = 0; i < topWithCash.length && i < scored.length; i++) {
      scored[i].award_cost_usd = topWithCash[i].award_cost_usd;
      scored[i].cash_price_usd = topWithCash[i].cash_price_usd;
      scored[i].value_ratio = topWithCash[i].value_ratio;
      scored[i].verdict = topWithCash[i].verdict;
    }
  }

  // 15. Write to sheet (CSV fallback)
  console.log('\n[search] Writing results...');
  let filePaths = {};
  try {
    filePaths = writeToSheet(scored, nearMisses, config);
    console.log(`[search] Results written to: ${filePaths.results || 'unknown'}`);
    if (filePaths.nearMisses) {
      console.log(`[search] Near-misses written to: ${filePaths.nearMisses}`);
    }
    if (filePaths.heatmap) {
      console.log(`[search] Heatmap written to: ${filePaths.heatmap}`);
    }
  } catch (err) {
    console.error(`[search] ERROR: Failed to write results: ${err.message}`);
  }

  // 16. Generate HTML report
  try {
    const reportPath = writeReport(scored, nearMisses, config, localPrograms);
    console.log(`[search] Report written to: ${reportPath}`);
    filePaths.report = reportPath;
  } catch (err) {
    console.warn(`[search] WARN: Failed to write report: ${err.message}`);
  }

  // 17. Update web dashboard data
  try {
    writeWebData(scored, nearMisses, config, localPrograms);
    console.log('[search] Web data updated (web/data.json)');
  } catch (err) {
    console.warn(`[search] WARN: Failed to write web data: ${err.message}`);
  }

  // 18. Write history
  try {
    writeHistory(scored, config);
    console.log('[search] History log updated');
  } catch (err) {
    console.warn(`[search] WARN: Failed to write history: ${err.message}`);
  }

  // 19. Notify
  try {
    const topDeal = scored[0] || null;
    const resultPath = filePaths?.results || 'output/';
    const message = buildNotifyMessage(confirmed, likely, totalRecords, topDeal, resultPath, localPrograms);
    await notify(message, config);
  } catch (err) {
    console.warn(`[search] WARN: Notification failed: ${err.message}`);
  }

  return { scored, nearMisses, config, localPrograms, filePaths, outbound, returns, totalRecords };
}

async function main() {
  const startTime = Date.now();
  console.log('[search] Loading trip.json...');
  const result = await runSearch();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[search] Done in ${elapsed}s`);
}

main().catch((err) => {
  console.error(`[search] FATAL: ${err.message}`);
  process.exit(1);
});
