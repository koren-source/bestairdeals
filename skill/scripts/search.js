/**
 * search.js — Orchestrator
 *
 * Three composable layers:
 *   searchCore()        — runs both agents, returns raw results
 *   mergeScoreAndSort() — merge, combo math, score (pure, no side effects)
 *   writeOutputs()      — sheets, report, web export, history, notify
 *
 * runSearch() composes all 3 (backwards compatible with cron.js).
 * runSearchStreaming() uses callbacks for SSE streaming.
 */

import 'dotenv/config';
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
import { loadConfig } from './config.js';

// ─── Layer 1: Search Core ───────────────────────────────────────────────

/**
 * Run both agents (Seats.aero + point.me) and return raw results.
 * No side effects, no process.exit(). Callbacks are optional for streaming.
 *
 * @param {object} config - Validated search config
 * @param {object} programs - Programs with bonuses applied
 * @param {object} [callbacks] - Optional streaming callbacks
 * @param {function} [callbacks.onProgress] - Progress updates from agents
 * @param {function} [callbacks.shouldAbort] - Returns true to abort search
 * @returns {{ seatsResults: object[], pointmeResults: object[], totalRecords: number }}
 */
export async function searchCore(config, programs, callbacks = {}) {
  console.log(`[search] Trip: ${config.origin} -> ${config.destinations.join(', ')} | ${config.cabin} | ${config.pax} pax`);
  console.log(`[search] Outbound: ${config.outbound.start} to ${config.outbound.end}`);
  console.log(`[search] Return:   ${config.return.start} to ${config.return.end}`);
  console.log(`[search] Stay:     ${config.trip_length.min}-${config.trip_length.max} days`);

  console.log('\n[search] Launching parallel sweeps...');

  const pointmeOptions = {};
  if (callbacks.onProgress) {
    pointmeOptions.onProgress = callbacks.onProgress;
  }
  if (callbacks.onDateComplete) {
    pointmeOptions.onDateComplete = callbacks.onDateComplete;
  }
  if (callbacks.shouldAbort) {
    pointmeOptions.shouldAbort = callbacks.shouldAbort;
  }

  const [seatsResults, pointmeResults] = await Promise.all([
    searchSeatsAero(config, programs).catch((err) => {
      console.error(`[search] ERROR: Seats.aero sweep failed: ${err.message}`);
      if (callbacks.onError) callbacks.onError({ agent: 'seats_aero', error: err.message });
      return [];
    }),
    searchPointMe(config, pointmeOptions).catch((err) => {
      console.error(`[search] ERROR: point.me sweep failed: ${err.message}`);
      if (callbacks.onError) callbacks.onError({ agent: 'pointme', error: err.message });
      return [];
    }),
  ]);

  const totalRecords = seatsResults.length + pointmeResults.length;
  console.log(`\n[search] Seats.aero: ${seatsResults.length} records`);
  console.log(`[search] point.me:   ${pointmeResults.length} records`);
  console.log(`[search] Total raw:  ${totalRecords} records`);

  if (seatsResults.length === 0 && pointmeResults.length === 0) {
    throw new Error('Both agents returned zero results. Nothing to process.');
  }

  return { seatsResults, pointmeResults, totalRecords };
}

// ─── Layer 2: Merge, Score, Sort ────────────────────────────────────────

/**
 * Merge raw results, build combos, score, and sort. Pure function.
 *
 * @param {object[]} seatsResults
 * @param {object[]} pointmeResults
 * @param {object} config
 * @param {object} programs
 * @returns {{ scored: object[], outbound: object[], returns: object[], nearMisses: object[], totalMerged: number }}
 */
export function mergeScoreAndSort(seatsResults, pointmeResults, config, programs) {
  const merged = mergeAndDedup(seatsResults, pointmeResults, programs);
  console.log(`[search] After merge: ${merged.length} unique records`);

  const outbound = merged.filter((r) => r.direction === 'outbound');
  const returns = merged.filter((r) => r.direction === 'return');
  console.log(`[search] Outbound: ${outbound.length} | Return: ${returns.length}`);

  const combos = buildCombos(outbound, returns, config);
  console.log(`[search] Valid combos: ${combos.length}`);

  if (combos.length === 0) {
    console.warn('[search] WARN: No valid combos found. Check dates, trip length, and seat availability.');
  }

  const scored = combos.map((c) => scoreCombo(c, config));
  scored.sort((a, b) => a.score - b.score);

  scored.forEach((c, i) => {
    c.summary = buildSummary(c, i + 1, scored.length, programs);
  });

  const nearMisses = buildNearMisses(outbound, returns, config, scored);
  console.log(`[search] Near-misses: ${nearMisses.length}`);

  return { scored, outbound, returns, nearMisses, totalMerged: merged.length };
}

// ─── Layer 3: Write Outputs ─────────────────────────────────────────────

/**
 * Write all outputs: sheets, report, web export, history, notify.
 * All side effects live here.
 *
 * @param {object[]} scored
 * @param {object[]} nearMisses
 * @param {object} config
 * @param {object} programs
 * @param {number} totalRecords
 * @returns {{ filePaths: object }}
 */
export async function writeOutputs(scored, nearMisses, config, programs, totalRecords) {
  // Cash price comparison for top 3
  console.log('\n[search] Looking up cash prices for top 3 deals...');
  let topWithCash = [];
  try {
    topWithCash = await addCashPrices(scored, config, 3);
    console.log('\n[search] === TOP 3 DEALS (Points vs Cash) ===');
    for (let i = 0; i < topWithCash.length; i++) {
      const c = topWithCash[i];
      const progOut = programs[c.outbound.program]?.name ?? c.outbound.program;
      const progRet = programs[c.return.program]?.name ?? c.return.program;
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

  // Log top 5 deals
  if (scored.length > 0) {
    console.log('\n[search] Top 5 deals:');
    const top5 = scored.slice(0, 5);
    for (let i = 0; i < top5.length; i++) {
      console.log(`  ${top5[i].summary}`);
    }
  }

  // Merge cash prices into scored results
  if (topWithCash.length > 0) {
    for (let i = 0; i < topWithCash.length && i < scored.length; i++) {
      scored[i].award_cost_usd = topWithCash[i].award_cost_usd;
      scored[i].cash_price_usd = topWithCash[i].cash_price_usd;
      scored[i].value_ratio = topWithCash[i].value_ratio;
      scored[i].verdict = topWithCash[i].verdict;
    }
  }

  // Write to sheet (CSV fallback)
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

  // Generate HTML report
  try {
    const reportPath = writeReport(scored, nearMisses, config, programs);
    console.log(`[search] Report written to: ${reportPath}`);
    filePaths.report = reportPath;
  } catch (err) {
    console.warn(`[search] WARN: Failed to write report: ${err.message}`);
  }

  // Update web dashboard data
  try {
    writeWebData(scored, nearMisses, config, programs);
    console.log('[search] Web data updated (web/data.json)');
  } catch (err) {
    console.warn(`[search] WARN: Failed to write web data: ${err.message}`);
  }

  // Write history
  try {
    writeHistory(scored, config);
    console.log('[search] History log updated');
  } catch (err) {
    console.warn(`[search] WARN: Failed to write history: ${err.message}`);
  }

  // Notify
  const confirmed = scored.filter((c) => c.confirmed);
  const likely = scored.filter((c) => !c.confirmed);
  try {
    const topDeal = scored[0] || null;
    const resultPath = filePaths?.results || 'output/';
    const message = buildNotifyMessage(confirmed, likely, totalRecords, topDeal, resultPath, programs);
    await notify(message, config);
  } catch (err) {
    console.warn(`[search] WARN: Notification failed: ${err.message}`);
  }

  return { filePaths };
}

// ─── Composed: Full Pipeline ────────────────────────────────────────────

/**
 * Detect transfer bonuses and return programs with bonuses applied.
 */
async function detectAndApplyBonuses(extPrograms) {
  if (extPrograms) return extPrograms;

  console.log('\n[search] Checking for Amex transfer bonuses...');
  const localPrograms = { ...PROGRAMS };
  for (const key of Object.keys(localPrograms)) {
    localPrograms[key] = { ...localPrograms[key] };
  }

  try {
    const bonuses = await detectBonuses();
    if (bonuses && bonuses.length > 0) {
      for (const bonus of bonuses) {
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

  return localPrograms;
}

/**
 * Run the full search pipeline (backwards compatible).
 *
 * @param {object} [extConfig] - pre-loaded config (optional, loads trip.json if omitted)
 * @param {object} [extPrograms] - programs with bonuses already applied (optional)
 * @returns {{ scored, nearMisses, config, localPrograms, filePaths, outbound, returns, totalRecords }}
 */
export async function runSearch(extConfig, extPrograms) {
  const config = extConfig ?? loadConfig();

  // Preflight: browse server is REQUIRED for cash price lookups
  const browseServer = getBrowseServer();
  if (browseServer) {
    console.log(`[search] ✓ Browse server found (port ${browseServer.port}) — cash prices ENABLED`);
  } else {
    throw new Error(
      'Browse server not running. Cash prices require the browse daemon.\n' +
      'Start it with: gstack browse --daemon\n' +
      'Then re-run the search.'
    );
  }

  const localPrograms = await detectAndApplyBonuses(extPrograms);

  // Layer 1: Search
  const { seatsResults, pointmeResults, totalRecords } = await searchCore(config, localPrograms);

  // Layer 2: Merge + Score
  const { scored, outbound, returns, nearMisses } = mergeScoreAndSort(
    seatsResults, pointmeResults, config, localPrograms
  );

  // Layer 3: Outputs
  const { filePaths } = await writeOutputs(scored, nearMisses, config, localPrograms, totalRecords);

  return { scored, nearMisses, config, localPrograms, filePaths, outbound, returns, totalRecords };
}

/**
 * Run search with SSE streaming callbacks.
 * Used by api-server.js for live result streaming.
 *
 * @param {object} config - Validated search config
 * @param {object} programs - Programs with bonuses applied
 * @param {object} callbacks - Streaming callbacks
 * @param {function} callbacks.onProgress - Progress updates
 * @param {function} callbacks.onPartial - Seats.aero results ready (partial combos)
 * @param {function} callbacks.onUpdate - point.me date completed (re-scored combos)
 * @param {function} callbacks.onError - Agent error
 * @param {function} callbacks.shouldAbort - Returns true to abort
 * @returns {{ scored, nearMisses, totalRecords }}
 */
export async function runSearchStreaming(config, programs, callbacks) {
  let accumulatedPointme = [];
  let seatsComplete = false;
  let seatsResults = [];

  const coreCallbacks = {
    onProgress: callbacks.onProgress,
    shouldAbort: callbacks.shouldAbort,
    onError: callbacks.onError,
    onDateComplete: (records) => {
      accumulatedPointme.push(...records);
      if (seatsComplete && callbacks.onUpdate) {
        // Re-merge and re-score with accumulated point.me data
        const { scored } = mergeScoreAndSort(seatsResults, accumulatedPointme, config, programs);
        callbacks.onUpdate(scored, accumulatedPointme.length);
      }
    },
  };

  // Run both agents. Seats.aero resolves first (~30s), point.me streams over ~20min.
  const seatsPromise = searchSeatsAero(config, programs).then((results) => {
    seatsResults = results;
    seatsComplete = true;
    console.log(`[search] Seats.aero complete: ${results.length} records`);

    if (callbacks.onPartial) {
      const { scored } = mergeScoreAndSort(results, accumulatedPointme, config, programs);
      callbacks.onPartial(scored, results.length);
    }
    return results;
  }).catch((err) => {
    console.error(`[search] ERROR: Seats.aero sweep failed: ${err.message}`);
    if (callbacks.onError) callbacks.onError({ agent: 'seats_aero', error: err.message });
    seatsComplete = true;
    return [];
  });

  const pointmePromise = searchPointMe(config, coreCallbacks).catch((err) => {
    console.error(`[search] ERROR: point.me sweep failed: ${err.message}`);
    if (callbacks.onError) callbacks.onError({ agent: 'pointme', error: err.message });
    return [];
  });

  const [finalSeats, finalPointme] = await Promise.all([seatsPromise, pointmePromise]);

  const totalRecords = finalSeats.length + finalPointme.length;
  if (totalRecords === 0) {
    throw new Error('Both agents returned zero results. Nothing to process.');
  }

  // Final merge + score
  const { scored, nearMisses } = mergeScoreAndSort(finalSeats, finalPointme, config, programs);

  return { scored, nearMisses, totalRecords };
}

// ─── CLI Entry Point ────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  console.log('[search] Loading trip.json...');
  const result = await runSearch();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[search] Done in ${elapsed}s`);
}

// Only run main when executed directly (not imported)
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('/search.js') || process.argv[1].endsWith('\\search.js')
);
if (isDirectRun) {
  main().catch((err) => {
    console.error(`[search] FATAL: ${err.message}`);
    process.exit(1);
  });
}
