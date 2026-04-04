/**
 * Daily cron orchestrator.
 * Runs the full search pipeline, compares with history, and sends a daily brief.
 * Always notifies — success brief OR failure alert. Never exits silently.
 *
 * Usage: node skill/scripts/cron.js
 */

import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { buildCombos, buildNearMisses } from "./combo.js";
import { scoreCombo, buildSummary } from "./score.js";
import { PROGRAMS } from "./programs.js";
import { writeToSheet } from "./sheets.js";
import { writeHistory } from "./history.js";
import { compareWithHistory } from "./compare.js";
import { notify, buildNotifyMessage } from "./notify.js";
import { detectBonuses } from "./bonus-detect.js";
import { getBrowseServer } from "./cash-price.js";

const BROWSE_BIN = join(process.env.HOME ?? "", ".claude/skills/gstack/browse/dist/browse");
const BROWSE_STARTUP_TIMEOUT_MS = 30_000;
const BROWSE_POLL_INTERVAL_MS = 500;

/**
 * Start the browse daemon if it isn't already running.
 * Returns the child process (or null if it was already up).
 */
function startBrowseDaemon() {
  if (getBrowseServer()) {
    console.log("[cron] Browse server already running");
    return null;
  }

  if (!existsSync(BROWSE_BIN)) {
    throw new Error(
      `Browse binary not found at ${BROWSE_BIN}. Install gstack or start the daemon manually.`
    );
  }

  console.log("[cron] Starting browse daemon...");
  const child = spawn(BROWSE_BIN, ["--headless"], {
    stdio: "ignore",
    detached: true,
  });
  child.unref();
  return child;
}

/**
 * Wait for browse.json to appear (daemon ready).
 */
async function waitForBrowseServer() {
  const deadline = Date.now() + BROWSE_STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (getBrowseServer()) {
      console.log("[cron] Browse server is ready");
      return;
    }
    await new Promise((r) => setTimeout(r, BROWSE_POLL_INTERVAL_MS));
  }
  throw new Error(
    `Browse daemon did not start within ${BROWSE_STARTUP_TIMEOUT_MS / 1000}s`
  );
}

/**
 * Kill the browse daemon we started.
 */
function stopBrowseDaemon(child) {
  if (!child) return;
  try {
    process.kill(-child.pid, "SIGTERM");
    console.log("[cron] Browse daemon stopped");
  } catch {
    // already exited
  }
}

async function main() {
  const startTime = Date.now();
  console.log(`[cron] Starting daily search — ${new Date().toISOString()}`);

  let config;
  try {
    config = JSON.parse(readFileSync("trip.json", "utf-8"));
  } catch (err) {
    console.error(`[cron] Failed to read trip.json: ${err.message}`);
    await notify(`bestairdeals CRON FAILURE: Could not read trip.json — ${err.message}`, {});
    process.exit(1);
  }

  // 0. Ensure browse daemon is running (required for cash prices)
  let browseChild = null;
  try {
    browseChild = startBrowseDaemon();
    if (browseChild) await waitForBrowseServer();
  } catch (err) {
    console.error(`[cron] Browse daemon failed: ${err.message}`);
    await notify(`bestairdeals CRON FAILURE: ${err.message}`, config);
    process.exit(1);
  }

  try {
    // 1. Detect transfer bonuses (runs before search, shares browser with pointme)
    const bonuses = await detectBonuses();
    const programs = { ...PROGRAMS };
    for (const b of bonuses) {
      if (programs[b.program] && b.bonus_ratio >= 1.0 && b.bonus_ratio <= 2.0) {
        programs[b.program] = { ...programs[b.program], bonus_ratio: b.bonus_ratio };
        console.log(`[cron] Applied bonus: ${b.program} ${b.bonus_ratio}x from ${b.source_url}`);
      }
    }

    // 2. Run search
    let outbound = [];
    let returns = [];
    let totalRecords = 0;

    try {
      const { runSearch } = await import("./search.js");
      const searchResult = await runSearch(config, programs);
      outbound = searchResult.outbound;
      returns = searchResult.returns;
      totalRecords = searchResult.totalRecords;
    } catch (err) {
      console.error(`[cron] Search failed: ${err.message}`);
      throw err;
    }

    // 3. Combo math + scoring
    const combos = buildCombos(outbound, returns, config);
    const scored = combos
      .map((c) => scoreCombo(c, config))
      .sort((a, b) => a.score - b.score);

    // Add summaries
    scored.forEach((c, i) => {
      c.summary = buildSummary(c, i + 1, scored.length, programs);
    });

    // Near-misses
    const nearMisses = buildNearMisses(outbound, returns, config, scored);

    // 4. Write outputs
    const paths = writeToSheet(scored, nearMisses, config);
    const historyPath = writeHistory(scored, config);

    // 5. Compare with history
    const historyDir = "output/history";
    const diff = compareWithHistory(scored, historyDir);

    // 6. Build and send daily brief
    const confirmed = scored.filter((c) => c.confirmed);
    const likely = scored.filter((c) => !c.confirmed);
    const topDeal = scored[0] ?? null;

    let brief = buildNotifyMessage(confirmed, likely, totalRecords, topDeal, paths.results, programs);

    if (!diff.firstRun) {
      brief += `\n\nVs. last run: ${diff.newDeals.length} new deals, ${diff.priceDrops.length} price drops, ${diff.gone.length} gone.`;

      if (diff.priceDrops.length > 0) {
        const best = diff.priceDrops.sort((a, b) => b.delta - a.delta)[0];
        brief += `\nBiggest drop: ${best.program_out}+${best.program_ret} ${best.date_out}-${best.date_ret} — score ${best.previous_score} -> ${best.score} (delta ${best.delta})`;
      }
    } else {
      brief += "\n\nFirst run — no historical comparison available.";
    }

    await notify(brief, config);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[cron] Complete — ${scored.length} combos, ${duration}s elapsed`);
  } catch (err) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`[cron] FAILED after ${duration}s: ${err.message}`);

    // Always notify on failure
    await notify(
      `bestairdeals CRON FAILURE after ${duration}s: ${err.message}`,
      config
    );

    process.exit(1);
  } finally {
    stopBrowseDaemon(browseChild);
  }
}

main();
