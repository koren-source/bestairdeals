/**
 * cash-price.js — Google Flights cash price lookup via browse server.
 * Scrapes round-trip cash prices for the top N combos to enable
 * points-vs-cash value comparison.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { MR_VALUE_USD_USD } from './programs.js';

export function getBrowseServer() {
  const candidates = [
    join(process.cwd(), '.gstack/browse.json'),
    ...(process.env.HOME ? [join(process.env.HOME, '.gstack/browse.json')] : []),
  ];
  for (const stateFile of candidates) {
    if (existsSync(stateFile)) {
      try {
        const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
        if (state.port && state.token) return state;
      } catch { /* try next */ }
    }
  }
  return null;
}

async function browseCommand(server, command, args = []) {
  const res = await fetch(`http://127.0.0.1:${server.port}/command`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${server.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ command, args }),
  });
  return res.text();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Look up cash price on Google Flights for a round-trip combo.
 * @param {object} server - browse server connection
 * @param {string} origin - origin IATA (e.g. "LAS")
 * @param {string} dest - destination IATA (e.g. "LHR")
 * @param {string} outDate - outbound date "YYYY-MM-DD"
 * @param {string} retDate - return date "YYYY-MM-DD"
 * @param {number} pax - number of passengers
 * @param {string} cabin - cabin class
 * @returns {number|null} cheapest round-trip cash price for all pax, or null
 */
async function lookupCashPrice(server, origin, dest, outDate, retDate, pax, cabin) {
  const retOrigin = dest;
  const retDest = origin;
  // Google Flights accepts natural language queries
  const q = `flights from ${origin} to ${dest} departing ${outDate} returning ${retDate} ${pax} passengers ${cabin}`;
  const url = `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`;

  await browseCommand(server, 'goto', [url]);
  await sleep(5000);

  const snapshot = await browseCommand(server, 'snapshot', ['-i']);

  // Parse prices from snapshot — Google Flights shows "From NNNN US dollars round trip total"
  const pricePattern = /From (\d[\d,]*) US dollars round trip total/g;
  const prices = [];
  let match;
  while ((match = pricePattern.exec(snapshot)) !== null) {
    prices.push(parseInt(match[1].replace(/,/g, ''), 10));
  }

  if (prices.length === 0) return null;
  return Math.min(...prices);
}

/**
 * Look up cash prices for the top N scored combos.
 * @param {object[]} scoredCombos - scored combos sorted by score ASC
 * @param {object} config - trip config
 * @param {number} [topN=3] - how many combos to price
 * @returns {object[]} combos with cash_price_usd, award_cost_usd, value_ratio, verdict added
 */
export async function addCashPrices(scoredCombos, config, topN = 3) {
  const server = getBrowseServer();
  if (!server) {
    console.warn('[cash-price] No browse server found — skipping cash price lookup');
    return scoredCombos.slice(0, topN).map((c) => ({
      ...c,
      award_cost_usd: +(c.total_pts * MR_VALUE_USD + c.total_fees).toFixed(2),
      cash_price_usd: null,
      value_ratio: null,
      verdict: 'NO_CASH_DATA',
    }));
  }

  const top = scoredCombos.slice(0, topN);
  const results = [];

  for (let i = 0; i < top.length; i++) {
    const combo = top[i];
    const out = combo.outbound;
    const ret = combo.return;
    const award_cost_usd = +(combo.total_pts * MR_VALUE_USD + combo.total_fees).toFixed(2);

    console.log(`[cash-price] (${i + 1}/${topN}) Looking up ${out.origin}->${out.destination} ${out.date} / ${ret.origin}->${ret.destination} ${ret.date}`);

    try {
      // Use outbound origin→dest for the Google Flights search
      const cashPrice = await lookupCashPrice(
        server, out.origin, out.destination, out.date, ret.date, config.pax, config.cabin
      );

      // If return is from a different airport, also check that route
      let returnCashPrice = null;
      if (out.destination !== ret.origin) {
        console.log(`[cash-price]   Cross-airport: also checking ${ret.origin}->${ret.destination}`);
        returnCashPrice = await lookupCashPrice(
          server, out.origin, ret.origin, out.date, ret.date, config.pax, config.cabin
        );
      }

      const bestCash = returnCashPrice != null
        ? Math.min(cashPrice ?? Infinity, returnCashPrice)
        : cashPrice;

      const value_ratio = bestCash != null ? +(bestCash / award_cost_usd).toFixed(2) : null;
      const verdict = value_ratio == null ? 'NO_CASH_DATA'
        : value_ratio >= 1.5 ? 'GREAT_USE'
        : value_ratio >= 1.0 ? 'GOOD_USE'
        : 'JUST_BUY_CASH';

      console.log(`[cash-price]   Cash: $${bestCash ?? '?'} | Award: $${award_cost_usd} | Ratio: ${value_ratio ?? '?'}x | ${verdict}`);

      results.push({
        ...combo,
        award_cost_usd,
        cash_price_usd: bestCash,
        value_ratio,
        verdict,
      });
    } catch (err) {
      console.error(`[cash-price]   ERROR: ${err.message}`);
      results.push({
        ...combo,
        award_cost_usd,
        cash_price_usd: null,
        value_ratio: null,
        verdict: 'LOOKUP_FAILED',
      });
    }
  }

  return results;
}
