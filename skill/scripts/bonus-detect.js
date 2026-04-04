/**
 * Amex MR transfer bonus detection.
 * Detects active transfer bonuses to airline partners.
 *
 * Two planned detection methods:
 * 1. Scrape Amex transfer page (needs browser automation)
 * 2. RSS feed monitoring (see rss-monitor.js)
 *
 * For v1: returns empty array. Set bonus_ratio manually in programs.js.
 */

import { checkBonusFeeds } from "./rss-monitor.js";

/**
 * Detect active Amex MR transfer bonuses.
 *
 * @returns {Promise<Array<{ program: string, bonus_ratio: number, source_url: string, expires: string|null }>>}
 */
export async function detectBonuses() {
  const bonuses = [];

  // Method 1: Scrape Amex transfer page
  // TODO: Implement browser automation to check https://global.americanexpress.com/rewards/points-for-travel
  // This requires an active Amex session via OpenClaw browser.
  // For now, this is a stub.
  const amexBonuses = await scrapeAmexTransferPage();
  bonuses.push(...amexBonuses);

  // Method 2: RSS feed monitoring
  const rssBonuses = await checkBonusFeeds();
  bonuses.push(...rssBonuses);

  if (bonuses.length === 0) {
    console.log(
      "Bonus detection: no automated sources configured. Set bonus_ratio manually in programs.js."
    );
  }

  return bonuses;
}

/**
 * Scrape the Amex transfer partners page for active bonus promotions.
 * TODO: Implement with OpenClaw browser automation.
 *
 * @returns {Promise<Array<{ program: string, bonus_ratio: number, source_url: string, expires: string|null }>>}
 */
async function scrapeAmexTransferPage() {
  // TODO: Navigate to Amex transfer page, parse bonus indicators.
  // Expected output: [{ program: "virgin", bonus_ratio: 1.3, source_url: "https://...", expires: "2026-05-01" }]
  return [];
}
