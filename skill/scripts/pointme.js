/**
 * pointme.js — Agent B: point.me browser automation
 *
 * Sweeps amex.point.me for all dates in the outbound and return ranges.
 * Each search shows all Amex MR partner results for that date.
 *
 * Uses gstack browse (persistent Chromium daemon) via its HTTP API.
 * The browser must have an active Amex login session (profile="user").
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';
import { PROGRAMS } from './programs.js';
import { getBrowseServer as getGlobalBrowseServer } from './cash-price.js';

const CABIN_MAP = {
  economy: 'economy',
  premium: 'premium',
  business: 'business',
  first: 'first',
};

/**
 * Generate an array of YYYY-MM-DD date strings from start to end (inclusive).
 *
 * @param {string} start - YYYY-MM-DD
 * @param {string} end - YYYY-MM-DD
 * @returns {string[]}
 */
export function generateDateRange(start, end) {
  const dates = [];
  const current = new Date(start + 'T00:00:00');
  const last = new Date(end + 'T00:00:00');

  while (current <= last) {
    const yyyy = current.getFullYear();
    const mm = String(current.getMonth() + 1).padStart(2, '0');
    const dd = String(current.getDate()).padStart(2, '0');
    dates.push(`${yyyy}-${mm}-${dd}`);
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

/**
 * Build the amex.point.me results URL for a one-way search.
 *
 * @param {string} origin
 * @param {string} destination
 * @param {string} date - YYYY-MM-DD
 * @param {string} cabin
 * @returns {string}
 */
function buildPointMeUrl(origin, destination, date, cabin, pax = 1) {
  const classOfService = CABIN_MAP[cabin] || 'economy';
  return `https://amex.point.me/results?departureIata=${origin}&arrivalIata=${destination}&departureDate=${date}&classOfService=${classOfService}&legType=oneWay&passengers=${pax}`;
}

/**
 * Load existing JSONL cache to skip already-searched dates.
 *
 * @param {string} cachePath
 * @returns {Set<string>} Set of cache keys ("direction|origin|dest|date")
 */
function loadCache(cachePath) {
  const cached = new Set();

  if (!existsSync(cachePath)) return cached;

  try {
    const lines = readFileSync(cachePath, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        cached.add(`${record.direction}|${record.origin}|${record.destination}|${record.date}`);
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // Cache read failed, start fresh
  }

  return cached;
}

/**
 * Append records to JSONL cache file incrementally.
 *
 * @param {string} cachePath
 * @param {Object[]} records
 */
function appendToCache(cachePath, records) {
  const dir = dirname(cachePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const lines = records.map((r) => JSON.stringify(r)).join('\n');
  if (lines) appendFileSync(cachePath, lines + '\n', 'utf-8');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── gstack browse HTTP client ───

// Build a reverse lookup: "Flying Blue" → "flyingblue", "Virgin Atlantic" → "virgin", etc.
// point.me shows display names, we need our internal keys.
const PROGRAM_NAME_MAP = {};
for (const [key, prog] of Object.entries(PROGRAMS)) {
  PROGRAM_NAME_MAP[prog.name.toLowerCase()] = key;
  // Also map common short forms
  if (prog.name.includes('(')) {
    const short = prog.name.split('(')[0].trim().toLowerCase();
    PROGRAM_NAME_MAP[short] = key;
  }
}
// Extra aliases point.me might use
PROGRAM_NAME_MAP['aer lingus aerclub'] = 'aerlingus';
PROGRAM_NAME_MAP['aer lingus'] = 'aerlingus';
PROGRAM_NAME_MAP['aerclub'] = 'aerlingus';
PROGRAM_NAME_MAP['aeromexico'] = 'aeromexico';
PROGRAM_NAME_MAP['aeromexico rewards'] = 'aeromexico';
PROGRAM_NAME_MAP['air canada aeroplan'] = 'aeroplan';
PROGRAM_NAME_MAP['air france-klm flying blue'] = 'flyingblue';
PROGRAM_NAME_MAP['air france klm flying blue'] = 'flyingblue';
PROGRAM_NAME_MAP['klm flying blue'] = 'flyingblue';
PROGRAM_NAME_MAP['flyingblue'] = 'flyingblue';
PROGRAM_NAME_MAP['ana mileage club'] = 'ana';
PROGRAM_NAME_MAP['avianca lifemiles'] = 'lifemiles';
PROGRAM_NAME_MAP['british airways avios'] = 'avios';
PROGRAM_NAME_MAP['british airways executive club'] = 'avios';
PROGRAM_NAME_MAP['the british airways club'] = 'avios';
PROGRAM_NAME_MAP['cathay pacific asia miles'] = 'cathay';
PROGRAM_NAME_MAP['asia miles'] = 'cathay';
PROGRAM_NAME_MAP['delta skymiles'] = 'delta';
PROGRAM_NAME_MAP['emirates skywards'] = 'emirates';
PROGRAM_NAME_MAP['etihad guest'] = 'etihad';
PROGRAM_NAME_MAP['iberia plus'] = 'iberia';
PROGRAM_NAME_MAP['iberia avios'] = 'iberia';
PROGRAM_NAME_MAP['club iberia plus'] = 'iberia';
PROGRAM_NAME_MAP['jetblue trueblue'] = 'jetblue';
PROGRAM_NAME_MAP['jetblue'] = 'jetblue';
PROGRAM_NAME_MAP['qantas frequent flyer'] = 'qantas';
PROGRAM_NAME_MAP['qantas'] = 'qantas';
PROGRAM_NAME_MAP['qatar airways privilege club'] = 'qatar';
PROGRAM_NAME_MAP['qatar airways'] = 'qatar';
PROGRAM_NAME_MAP['privilege club'] = 'qatar';
PROGRAM_NAME_MAP['singapore airlines krisflyer'] = 'singapore';
PROGRAM_NAME_MAP['krisflyer'] = 'singapore';
PROGRAM_NAME_MAP['virgin atlantic flying club'] = 'virgin';

/**
 * Resolve the browse server connection info from .gstack/browse.json.
 * Delegates to the shared getBrowseServer in cash-price.js.
 */
function getBrowseServer() {
  const server = getGlobalBrowseServer();
  if (!server) {
    throw new Error('Browse server not running. Start it with: gstack browse --daemon');
  }
  return server;
}

/**
 * Send a command to the gstack browse HTTP server.
 */
async function browseCommand(server, command, args = []) {
  const resp = await fetch(`http://127.0.0.1:${server.port}/command`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${server.token}`,
    },
    body: JSON.stringify({ command, args }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Browse command "${command}" failed (${resp.status}): ${body.slice(0, 300)}`);
  }

  return resp.text();
}

/**
 * Look up a program display name to our internal key.
 * Tries exact match, then progressively fuzzier matches.
 */
function resolveProgram(displayName) {
  if (!displayName) return null;
  const lower = displayName.trim().toLowerCase();

  // Exact match
  if (PROGRAM_NAME_MAP[lower]) return PROGRAM_NAME_MAP[lower];

  // Check if any key is contained in the display name
  for (const [alias, key] of Object.entries(PROGRAM_NAME_MAP)) {
    if (lower.includes(alias) || alias.includes(lower)) return key;
  }

  // Check against program names directly
  for (const [key, prog] of Object.entries(PROGRAMS)) {
    if (lower.includes(prog.name.toLowerCase())) return key;
    if (prog.name.toLowerCase().includes(lower)) return key;
  }

  return null;
}

/**
 * Parse points string like "62,000" or "62000" to integer.
 */
function parsePoints(str) {
  if (!str) return null;
  const cleaned = str.replace(/[^0-9]/g, '');
  const val = parseInt(cleaned, 10);
  return isNaN(val) ? null : val;
}

/**
 * Parse fees string like "$168.50" or "168.50 USD" to float.
 */
function parseFees(str) {
  if (!str) return 0;
  const match = str.match(/[\d,.]+/);
  if (!match) return 0;
  const val = parseFloat(match[0].replace(/,/g, ''));
  return isNaN(val) ? 0 : val;
}

/**
 * Parse stops from text like "Nonstop", "1 stop", "2 stops".
 */
function parseStops(str) {
  if (!str) return 0;
  const lower = str.toLowerCase();
  if (lower.includes('nonstop') || lower.includes('direct')) return 0;
  const match = lower.match(/(\d+)\s*stop/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Navigate to a point.me URL and parse results using gstack browse.
 *
 * Strategy: use the `text` command to get full page text, then parse with regex.
 * point.me renders each result as a button with a predictable text pattern:
 *   "Air France LIVE 4:30 PM – 8:00 AM +1 Air France Business 10h 30m – 1 stop JFK CDG CDG LHR ... 189,000 points +$253.00* FlyingBlue 188,500 points ..."
 *
 * @param {string} url - The amex.point.me results URL
 * @param {string} direction - "outbound" or "return"
 * @param {string} origin
 * @param {string} destination
 * @param {string} date
 * @param {Object} server - Browse server connection { port, token }
 * @returns {Promise<Object[]>} Array of records
 */
async function navigateAndParse(url, direction, origin, destination, date, server) {
  // 1. Navigate to the URL
  await browseCommand(server, 'goto', [url]);

  // 2. Wait for React app to render (8 seconds minimum)
  await sleep(8000);

  // 3. Check for login expiration
  const currentUrl = await browseCommand(server, 'url');
  if (currentUrl.includes('/login') || currentUrl.includes('/auth') || currentUrl.includes('signin')) {
    throw new Error('point.me session expired');
  }

  // 4. Get the snapshot to parse result buttons
  let snapshot = await browseCommand(server, 'snapshot', ['-i']);

  // 5. Handle blank results (no result buttons found)
  if (!snapshot.includes('points')) {
    console.log(`[point.me] No results on first try, waiting 5 more seconds...`);
    await sleep(5000);
    snapshot = await browseCommand(server, 'snapshot', ['-i']);

    if (!snapshot.includes('points')) {
      // Re-navigate once
      console.log(`[point.me] Still blank, re-navigating...`);
      await browseCommand(server, 'goto', [url]);
      await sleep(8000);
      snapshot = await browseCommand(server, 'snapshot', ['-i']);

      if (!snapshot.includes('points')) {
        console.warn(`[point.me] WARN: No results after retry for ${date} ${origin}->${destination}`);
        return [];
      }
    }
  }

  // 6. Parse results from snapshot
  // Each result is a button line like:
  //   @e17 [button] "Air France LIVE 4:30 PM – 8:00 AM +1 Air France Business 10h 30m – 1 stop ... 189,000 points +$253.00* FlyingBlue 188,500 points ..."
  const records = [];
  const buttonLines = snapshot.split('\n').filter(
    (line) => line.includes('[button]') && line.includes('points')
  );

  for (const line of buttonLines) {
    // Extract the quoted text content
    const textMatch = line.match(/"(.+)"/);
    if (!textMatch) continue;
    const text = textMatch[1];

    // Skip non-result buttons (sort buttons like "Fewest points")
    if (text.length < 50) continue;
    if (text.startsWith('point.me') || text.startsWith('Fewest') || text.startsWith('Quickest')) continue;

    // Extract airline name (first word(s) before "LIVE" or time)
    const airlineMatch = text.match(/^(.+?)\s+LIVE\s/);
    const airline = airlineMatch ? airlineMatch[1].trim() : '';

    // Extract cabin class
    const cabinMatch = text.match(/\b(Economy|Premium|Business|First)\b/i);
    const cabin = cabinMatch ? cabinMatch[1] : '';

    // Extract stops
    const stopsMatch = text.match(/(\d+)\s+stop|Nonstop|Direct/i);
    const stops = stopsMatch
      ? (stopsMatch[0].toLowerCase().includes('nonstop') || stopsMatch[0].toLowerCase().includes('direct') ? 0 : parseInt(stopsMatch[1], 10))
      : 0;

    // Extract all "NNN,NNN points" occurrences — first one is typically the Amex MR cost
    const pointsMatches = [...text.matchAll(/([\d,]+)\s+points/gi)];
    if (pointsMatches.length === 0) continue;

    // The first points value is the primary cost
    const primaryPts = parsePoints(pointsMatches[0][1]);
    if (!primaryPts) continue;

    // Extract fees: "+$253.00*" or "+$6.00"
    const feesMatch = text.match(/\+\$([0-9,.]+)/);
    const fees = feesMatch ? parseFees(feesMatch[1]) : 0;

    // Extract loyalty program name — appears right after "NNN,NNN points +$X.XX*"
    // Pattern: "189,000 points +$253.00* FlyingBlue 188,500 points"
    // The program name is between the first "points +$X*" and the second points value
    let programName = '';

    // Try to find program name after fees
    const afterFeesMatch = text.match(/\+\$[\d,.]+\*?\s+(.+?)\s+[\d,]+\s+points/);
    if (afterFeesMatch) {
      programName = afterFeesMatch[1].trim();
    }

    // Also try: program name might appear after "Check program" text
    if (!programName) {
      const checkMatch = text.match(/Check program\s+(.+?)\s+[\d,]+\s+points/);
      if (checkMatch) programName = checkMatch[1].trim();
    }

    // If still no program name, use airline name as fallback
    if (!programName) programName = airline;

    const programKey = resolveProgram(programName) || resolveProgram(airline);
    if (!programKey) {
      console.warn(`[point.me] WARN: Unknown program "${programName}" (airline: "${airline}") — skipping`);
      continue;
    }

    records.push({
      source: 'point_me',
      direction,
      origin,
      destination,
      date,
      program: programKey,
      airline: airline || PROGRAMS[programKey]?.airline || '',
      pts_per_person_ow: primaryPts,
      fees_usd: fees,
      seats_available: null, // point.me doesn't provide seat counts
      stops,
      booking_url: '', // TODO: extract from expanded card view
      cabin: cabin.toLowerCase(),
    });
  }

  console.log(`[point.me] ${date} ${origin}->${destination}: ${records.length} results from ${buttonLines.length} cards`);
  return records;
}

/**
 * Filter records to only include the requested cabin class.
 * point.me shows all cabins regardless of URL param.
 */
function filterByCabin(records, cabin) {
  if (!cabin) return records;
  const target = cabin.toLowerCase();
  // "economy" matches "economy", "premium" matches "premium economy" or "premium"
  return records.filter((r) => {
    if (!r.cabin) return true; // Keep records without cabin info
    if (target === 'economy') return r.cabin === 'economy';
    if (target === 'premium') return r.cabin === 'premium' || r.cabin === 'premium economy';
    return r.cabin === target;
  });
}

/**
 * Search point.me for all dates across all destinations.
 *
 * Sweeps outbound and return date ranges, checking each date for each
 * destination. Results are cached incrementally to JSONL for resumability.
 *
 * @param {Object} config - Trip config from trip.json
 * @param {Object} [options] - Optional callbacks for streaming
 * @param {function} [options.onDateComplete] - Called with records after each date completes
 * @param {function} [options.onProgress] - Called with { agent, pct, dates_completed, dates_total, message }
 * @param {function} [options.shouldAbort] - Returns true to abort search early
 * @returns {Promise<Object[]>} Flat array of availability records
 */
export async function searchPointMe(config, options = {}) {
  const today = new Date().toISOString().split('T')[0];
  const cachePath = `output/.pointme-cache-${today}-${config.cabin}-${config.pax}.jsonl`;
  const cachedKeys = loadCache(cachePath);
  const results = [];

  // Connect to browse server
  const server = getBrowseServer();
  console.log(`[point.me] Connected to browse server on port ${server.port}`);

  // Build search plan: outbound dates + return dates (skip return for one-way)
  const isOneWay = config.tripType === 'oneway';
  const outboundDates = generateDateRange(config.outbound.start, config.outbound.end);
  const returnDates = isOneWay ? [] : generateDateRange(config.return.start, config.return.end);

  const searches = [];

  for (const date of outboundDates) {
    for (const dest of config.destinations) {
      searches.push({
        direction: 'outbound',
        origin: config.origin,
        destination: dest,
        date,
      });
    }
  }

  for (const date of returnDates) {
    for (const dest of config.destinations) {
      searches.push({
        direction: 'return',
        origin: dest,
        destination: config.origin,
        date,
      });
    }
  }

  // Filter out already-cached searches
  const pending = searches.filter(
    (s) => !cachedKeys.has(`${s.direction}|${s.origin}|${s.destination}|${s.date}`)
  );

  console.log(`[point.me] Search plan: ${searches.length} total searches, ${pending.length} pending (${searches.length - pending.length} cached)`);

  if (pending.length === 0) {
    console.log('[point.me] All searches cached, loading from cache');
    if (existsSync(cachePath)) {
      const lines = readFileSync(cachePath, 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          results.push(JSON.parse(line));
        } catch {
          // Skip malformed
        }
      }
    }
    const filtered = filterByCabin(results, config.cabin);
    console.log(`[point.me] Loaded ${results.length} cached records, ${filtered.length} in ${config.cabin}`);
    if (filtered.length === 0 && results.length > 0) {
      console.warn(`[point.me] WARN: No ${config.cabin} results in cache. Returning all ${results.length} results.`);
      return results;
    }
    return filtered;
  }

  // Verify Amex session is active before starting the sweep
  console.log('[point.me] Verifying Amex login session...');
  try {
    await browseCommand(server, 'goto', ['https://amex.point.me']);
    await sleep(5000);
    const landingUrl = await browseCommand(server, 'url');
    if (landingUrl.includes('/login') || landingUrl.includes('/auth') || landingUrl.includes('signin')) {
      throw new Error('point.me session expired — re-authenticate on amex.point.me before running');
    }
    console.log('[point.me] Session active');
  } catch (err) {
    if (err.message.includes('session expired')) throw err;
    console.warn(`[point.me] WARN: Could not verify session: ${err.message} — proceeding anyway`);
  }

  let searchCount = 0;
  let consecutiveEmpty = 0;
  const MAX_CONSECUTIVE_EMPTY = 5; // If 5 searches in a row return nothing, likely blocked

  for (const search of pending) {
    searchCount++;
    // Check abort before each date
    if (options.shouldAbort && options.shouldAbort()) {
      console.log('[point.me] Search aborted');
      break;
    }

    const url = buildPointMeUrl(search.origin, search.destination, search.date, config.cabin, config.pax);

    console.log(`[point.me] (${searchCount}/${pending.length}) ${search.direction} ${search.origin}->${search.destination} ${search.date}`);

    try {
      const rawRecords = await navigateAndParse(
        url,
        search.direction,
        search.origin,
        search.destination,
        search.date,
        server
      );
      // Cache all results (including wrong cabin) for resumability.
      // Cabin filtering happens later so we don't lose data.
      const records = rawRecords;
      const cabinMatches = filterByCabin(rawRecords, config.cabin);
      if (rawRecords.length > 0 && cabinMatches.length === 0) {
        const cabins = [...new Set(rawRecords.map((r) => r.cabin).filter(Boolean))];
        console.log(`[point.me] NOTE: ${search.date} ${search.origin}->${search.destination}: ${rawRecords.length} results but none in ${config.cabin} (found: ${cabins.join(', ')})`);
      }

      if (records.length > 0) {
        results.push(...records);
        appendToCache(cachePath, records);
        consecutiveEmpty = 0;

        // Streaming callbacks
        if (options.onDateComplete) options.onDateComplete(records);
      } else {
        consecutiveEmpty++;
        if (consecutiveEmpty >= MAX_CONSECUTIVE_EMPTY) {
          console.warn(`[point.me] WARN: ${MAX_CONSECUTIVE_EMPTY} consecutive empty results — possible automation block. Backing off 30s...`);
          await sleep(30000);
          consecutiveEmpty = 0; // Reset after backoff, give it another chance
        }
      }
    } catch (err) {
      if (err.message.includes('session expired')) {
        console.error('[point.me] ERROR: Session expired — cannot continue. Re-authenticate on amex.point.me and retry.');
        console.error(`[point.me] Progress saved: ${results.length} records cached. Will resume on next run.`);
        throw err;
      }
      console.warn(`[point.me] WARN: Failed ${search.date} ${search.origin}->${search.destination}: ${err.message}`);
      consecutiveEmpty++;
    }

    // Progress callback
    if (options.onProgress) {
      const pct = Math.round((searchCount / pending.length) * 100);
      options.onProgress({
        agent: 'pointme',
        pct,
        dates_completed: searchCount,
        dates_total: pending.length,
        message: `${search.direction} ${search.origin}->${search.destination} ${search.date}`,
      });
    }

    // 2-second delay between searches
    if (searchCount < pending.length) {
      await sleep(2000);
    }
  }

  // Also load previously cached records not in this run's results
  if (existsSync(cachePath)) {
    const lines = readFileSync(cachePath, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        const key = `${record.direction}|${record.origin}|${record.destination}|${record.date}|${record.program}`;
        const existsInResults = results.some(
          (r) =>
            `${r.direction}|${r.origin}|${r.destination}|${r.date}|${r.program}` === key
        );
        if (!existsInResults) {
          results.push(record);
        }
      } catch {
        // Skip malformed
      }
    }
  }

  // Filter to requested cabin at the end
  const filtered = filterByCabin(results, config.cabin);
  console.log(`[point.me] Sweep complete: ${results.length} total records, ${filtered.length} in ${config.cabin}`);
  if (filtered.length === 0 && results.length > 0) {
    console.warn(`[point.me] WARN: No ${config.cabin} results found. Returning all ${results.length} results (mixed cabin) so combo math can still run.`);
    return results;
  }
  return filtered;
}
