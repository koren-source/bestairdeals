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
import { execSync } from 'child_process';
import { PROGRAMS } from './programs.js';

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
function buildPointMeUrl(origin, destination, date, cabin) {
  const classOfService = CABIN_MAP[cabin] || 'economy';
  return `https://amex.point.me/results?departureIata=${origin}&arrivalIata=${destination}&departureDate=${date}&classOfService=${classOfService}&legType=oneWay&passengers=1`;
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

const BROWSE_BINARY = join(process.env.HOME, '.claude/skills/gstack/browse/dist/browse');

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
PROGRAM_NAME_MAP['air france-klm flying blue'] = 'flyingblue';
PROGRAM_NAME_MAP['air france klm flying blue'] = 'flyingblue';
PROGRAM_NAME_MAP['klm flying blue'] = 'flyingblue';
PROGRAM_NAME_MAP['virgin atlantic flying club'] = 'virgin';
PROGRAM_NAME_MAP['british airways avios'] = 'avios';
PROGRAM_NAME_MAP['british airways executive club'] = 'avios';
PROGRAM_NAME_MAP['iberia plus'] = 'iberia';
PROGRAM_NAME_MAP['iberia avios'] = 'iberia';
PROGRAM_NAME_MAP['air canada aeroplan'] = 'aeroplan';
PROGRAM_NAME_MAP['ana mileage club'] = 'ana';
PROGRAM_NAME_MAP['singapore airlines krisflyer'] = 'singapore';
PROGRAM_NAME_MAP['krisflyer'] = 'singapore';
PROGRAM_NAME_MAP['delta skymiles'] = 'delta';
PROGRAM_NAME_MAP['etihad guest'] = 'etihad';
PROGRAM_NAME_MAP['emirates skywards'] = 'emirates';
PROGRAM_NAME_MAP['cathay pacific asia miles'] = 'cathay';
PROGRAM_NAME_MAP['asia miles'] = 'cathay';
PROGRAM_NAME_MAP['avianca lifemiles'] = 'lifemiles';
PROGRAM_NAME_MAP['hawaiian airlines'] = 'hawaiian';
PROGRAM_NAME_MAP['jetblue trueblue'] = 'jetblue';
PROGRAM_NAME_MAP['jetblue'] = 'jetblue';
PROGRAM_NAME_MAP['copa airlines connectmiles'] = 'copa';
PROGRAM_NAME_MAP['connectmiles'] = 'copa';

/**
 * Resolve the browse server connection info from .gstack/browse.json.
 * If no server running, attempt to start one via the browse binary.
 */
function getBrowseServer() {
  // Check multiple locations for browse.json
  const candidates = [
    join(process.cwd(), '.gstack/browse.json'),
    join(process.env.HOME, '.gstack/browse.json'),
  ];

  for (const stateFile of candidates) {
    if (existsSync(stateFile)) {
      try {
        const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
        if (state.port && state.token) {
          return { port: state.port, token: state.token };
        }
      } catch {
        // try next
      }
    }
  }

  // No server found, try to start one
  console.log('[point.me] No browse server found, starting one...');
  try {
    execSync(`${BROWSE_BINARY} status`, { timeout: 15000, stdio: 'pipe' });
    // Re-read state after status command (which auto-starts)
    for (const stateFile of candidates) {
      if (existsSync(stateFile)) {
        try {
          const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
          if (state.port && state.token) {
            return { port: state.port, token: state.token };
          }
        } catch {
          // try next
        }
      }
    }
  } catch (err) {
    throw new Error(`Cannot start browse server: ${err.message}`);
  }

  throw new Error('Browse server state file not found. Run "browse status" to start the server.');
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

  // 4. Extract results via JavaScript evaluation
  // point.me is a React app. Result cards contain program, points, fees, stops, booking link.
  // We use a broad extraction strategy since the exact DOM structure may change.
  const extractScript = `
    (function() {
      var results = [];

      // Strategy 1: Look for result card elements
      // point.me typically renders results as cards/rows with program info
      var cards = document.querySelectorAll('[class*="result"], [class*="card"], [class*="offer"], [class*="flight"], [class*="option"]');

      // If no cards found with common class patterns, try table rows
      if (cards.length === 0) {
        cards = document.querySelectorAll('table tbody tr, [role="row"], [class*="row"]');
      }

      // If still nothing, try looking for any element containing points values
      if (cards.length === 0) {
        // Fallback: find elements that contain comma-separated numbers (like "62,000")
        var allElements = document.querySelectorAll('*');
        var pointsPattern = /\\d{1,3},\\d{3}/;
        for (var i = 0; i < allElements.length; i++) {
          var el = allElements[i];
          if (el.children.length > 2 && pointsPattern.test(el.textContent)) {
            cards = el.children;
            break;
          }
        }
      }

      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var text = card.textContent || '';

        // Skip cards that don't look like flight results
        if (text.length < 20) continue;

        // Extract points (look for comma-separated numbers, e.g., "62,000")
        var ptsMatch = text.match(/(\\d{1,3},\\d{3})\\s*(pts|points|miles)?/i);
        if (!ptsMatch) continue; // Not a result card

        // Extract program name (usually at the top of the card)
        var programEl = card.querySelector('[class*="program"], [class*="partner"], [class*="loyalty"], [class*="airline-name"], [class*="provider"]');
        var programName = programEl ? programEl.textContent.trim() : '';

        // If no dedicated program element, try to extract from the card text
        if (!programName) {
          // Look for known program names in the text
          var knownPrograms = ['Flying Blue', 'Virgin Atlantic', 'British Airways', 'Aeroplan',
            'ANA', 'Singapore', 'KrisFlyer', 'Delta', 'SkyMiles', 'Etihad', 'Emirates',
            'Cathay', 'Asia Miles', 'LifeMiles', 'Avianca', 'Hawaiian', 'JetBlue', 'Copa',
            'Iberia', 'Avios'];
          for (var j = 0; j < knownPrograms.length; j++) {
            if (text.includes(knownPrograms[j])) {
              programName = knownPrograms[j];
              break;
            }
          }
        }

        // Extract fees (look for dollar amounts)
        var feesMatch = text.match(/\\$([\\d,.]+)/);
        var fees = feesMatch ? feesMatch[1] : '0';

        // Extract stops
        var stopsText = '';
        var stopsEl = card.querySelector('[class*="stop"], [class*="segment"]');
        if (stopsEl) {
          stopsText = stopsEl.textContent;
        } else if (text.match(/nonstop|direct|\\d+\\s*stop/i)) {
          stopsText = text.match(/nonstop|direct|\\d+\\s*stops?/i)[0];
        }

        // Extract airline
        var airlineEl = card.querySelector('[class*="airline"], [class*="carrier"], [class*="operator"]');
        var airline = airlineEl ? airlineEl.textContent.trim() : '';

        // Extract booking URL
        var bookingLink = card.querySelector('a[href*="book"], a[href*="redirect"], a[class*="book"], a[class*="cta"]');
        var bookingUrl = bookingLink ? bookingLink.href : '';

        results.push({
          programName: programName,
          points: ptsMatch[1],
          fees: fees,
          stops: stopsText,
          airline: airline,
          bookingUrl: bookingUrl,
          rawText: text.substring(0, 200)
        });
      }

      return JSON.stringify({ count: results.length, results: results, url: window.location.href });
    })()
  `.trim();

  let raw = await browseCommand(server, 'js', [extractScript]);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Sometimes the js command wraps output in quotes or adds extra text
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      console.warn(`[point.me] WARN: Could not parse JS result for ${date} ${origin}->${destination}`);
      return [];
    }
  }

  // 5. Handle blank results
  if (!parsed.results || parsed.results.length === 0) {
    // Scroll down and wait
    console.log(`[point.me] No results on first try, scrolling and retrying...`);
    await browseCommand(server, 'scroll', ['down', '500']);
    await sleep(5000);

    raw = await browseCommand(server, 'js', [extractScript]);
    try {
      parsed = JSON.parse(raw);
    } catch {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { results: [] };
    }

    if (!parsed.results || parsed.results.length === 0) {
      // Re-navigate once
      console.log(`[point.me] Still blank, re-navigating...`);
      await browseCommand(server, 'goto', [url]);
      await sleep(8000);

      raw = await browseCommand(server, 'js', [extractScript]);
      try {
        parsed = JSON.parse(raw);
      } catch {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { results: [] };
      }

      if (!parsed.results || parsed.results.length === 0) {
        console.warn(`[point.me] WARN: No results after retry for ${date} ${origin}->${destination}`);
        return [];
      }
    }
  }

  // 6. Map raw results to our record schema
  const records = [];
  for (const r of parsed.results) {
    const programKey = resolveProgram(r.programName);
    if (!programKey) {
      console.warn(`[point.me] WARN: Unknown program "${r.programName}" — skipping (raw: ${r.rawText?.slice(0, 60)})`);
      continue;
    }

    const pts = parsePoints(r.points);
    if (!pts) continue;

    records.push({
      source: 'point_me',
      direction,
      origin,
      destination,
      date,
      program: programKey,
      airline: r.airline || PROGRAMS[programKey]?.airline || '',
      pts_per_person_ow: pts,
      fees_usd: parseFees(r.fees),
      seats_available: null, // point.me doesn't provide seat counts
      stops: parseStops(r.stops),
      booking_url: r.bookingUrl || '',
    });
  }

  console.log(`[point.me] ${date} ${origin}->${destination}: ${records.length} results from ${parsed.results.length} cards`);
  return records;
}

/**
 * Search point.me for all dates across all destinations.
 *
 * Sweeps outbound and return date ranges, checking each date for each
 * destination. Results are cached incrementally to JSONL for resumability.
 *
 * @param {Object} config - Trip config from trip.json
 * @returns {Promise<Object[]>} Flat array of availability records
 */
export async function searchPointMe(config) {
  const today = new Date().toISOString().split('T')[0];
  const cachePath = `output/.pointme-cache-${today}.jsonl`;
  const cachedKeys = loadCache(cachePath);
  const results = [];

  // Connect to browse server
  const server = getBrowseServer();
  console.log(`[point.me] Connected to browse server on port ${server.port}`);

  // Build search plan: outbound dates + return dates
  const outboundDates = generateDateRange(config.outbound.start, config.outbound.end);
  const returnDates = generateDateRange(config.return.start, config.return.end);

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
    return results;
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
    const url = buildPointMeUrl(search.origin, search.destination, search.date, config.cabin);

    console.log(`[point.me] (${searchCount}/${pending.length}) ${search.direction} ${search.origin}->${search.destination} ${search.date}`);

    try {
      const records = await navigateAndParse(
        url,
        search.direction,
        search.origin,
        search.destination,
        search.date,
        server
      );

      if (records.length > 0) {
        results.push(...records);
        appendToCache(cachePath, records);
        consecutiveEmpty = 0;
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

  console.log(`[point.me] Sweep complete: ${results.length} total records`);
  return results;
}
