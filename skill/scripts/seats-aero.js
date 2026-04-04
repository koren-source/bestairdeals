/**
 * seats-aero.js — Agent A: Seats.aero API client
 *
 * Sweeps all Amex MR transfer partners with Seats.aero slugs across
 * all destinations and date ranges. Returns flat array of availability records.
 */

import { readFileSync } from 'fs';

const BASE_URL = 'https://seats.aero/partnerapi';
const API_KEY_PATH = '/Users/q/.openclaw/workspace/credentials/seats-aero-api-key.txt';
const DELAY_MS = 500;

// Cabin code mapping: Seats.aero uses Y/W/J/F prefix on response fields
const CABIN_PREFIX = {
  economy: 'Y',
  premium: 'W',
  business: 'J',
  first: 'F',
};

function loadApiKey() {
  try {
    return readFileSync(API_KEY_PATH, 'utf-8').trim();
  } catch {
    // Fallback to env var
    const key = process.env.SEATS_AERO_API_KEY;
    if (!key) {
      throw new Error(
        `Seats.aero API key not found at ${API_KEY_PATH} and SEATS_AERO_API_KEY env var is not set`
      );
    }
    return key;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch availability from Seats.aero for a single route/program combo.
 *
 * @param {Object} params
 * @param {string} params.origin
 * @param {string} params.destination
 * @param {string} params.cabin - economy | premium | business | first
 * @param {string} params.startDate - YYYY-MM-DD
 * @param {string} params.endDate - YYYY-MM-DD
 * @param {string} params.slug - Seats.aero program slug
 * @param {string} params.apiKey
 * @returns {Promise<Object[]>} Raw API response data array
 */
async function fetchAvailability({ origin, destination, cabin, startDate, endDate, slug, apiKey }) {
  const url = new URL(`${BASE_URL}/availability`);
  url.searchParams.set('origin_airport', origin);
  url.searchParams.set('destination_airport', destination);
  url.searchParams.set('cabin', cabin);
  url.searchParams.set('start_date', startDate);
  url.searchParams.set('end_date', endDate);
  url.searchParams.set('source', slug);

  const response = await fetch(url.toString(), {
    headers: {
      'Partner-Authorization': apiKey,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    // 404 = no routes tracked (Seats.aero only tracks nonstop), not an error
    if (response.status === 404) return [];
    throw new Error(`Seats.aero ${response.status}: ${body.slice(0, 200)}`);
  }

  const json = await response.json();
  // API returns { data: [...] } or just an array depending on endpoint
  return Array.isArray(json) ? json : json.data ?? [];
}

/**
 * Map a raw Seats.aero result item to the shared record schema.
 *
 * @param {Object} item - Raw API response item
 * @param {string} direction - "outbound" or "return"
 * @param {string} origin - Origin airport code
 * @param {string} destination - Destination airport code
 * @param {string} programKey - Key in PROGRAMS object
 * @param {Object} program - Program config from programs.js
 * @param {string} cabinPrefix - Y/W/J/F
 * @returns {Object|null} Record or null if should be filtered out
 */
function mapRecord(item, direction, origin, destination, programKey, program, cabinPrefix) {
  const available = item[`${cabinPrefix}Available`];
  const mileageCost = item[`${cabinPrefix}MileageCost`];
  const totalTaxes = item[`${cabinPrefix}TotalTaxes`];
  const remainingSeats = item[`${cabinPrefix}RemainingSeats`];
  const airlines = item[`${cabinPrefix}Airlines`];

  // Filter: must be available with non-null/non-zero mileage cost
  if (!available) return null;
  if (mileageCost == null || mileageCost === 0) return null;

  return {
    source: 'seats_aero',
    direction,
    origin,
    destination,
    date: item.Date,
    program: programKey,
    airline: airlines || program.airline,
    pts_per_person_ow: parseInt(mileageCost, 10) || 0,
    fees_usd: (parseFloat(totalTaxes) || 0) / 100, // API returns cents
    seats_available: remainingSeats || 0,
    stops: 0, // Seats.aero doesn't provide stops; flagged STOPS_UNKNOWN in score.js
  };
}

/**
 * Search Seats.aero for all programs with slugs, across all destinations.
 *
 * @param {Object} config - Trip config from trip.json
 * @param {Object} programs - PROGRAMS object from programs.js
 * @returns {Promise<Object[]>} Flat array of availability records
 */
export async function searchSeatsAero(config, programs) {
  const apiKey = loadApiKey();
  const cabinPrefix = CABIN_PREFIX[config.cabin] || 'Y';
  const results = [];

  // Count total calls for logging
  const sluggedPrograms = Object.entries(programs).filter(([, p]) => p.slug != null);
  const totalCalls = sluggedPrograms.length * config.destinations.length * 2;
  let callCount = 0;

  console.log(`[seats-aero] Starting sweep: ${sluggedPrograms.length} programs x ${config.destinations.length} destinations x 2 directions = ${totalCalls} API calls`);

  for (const [programKey, program] of sluggedPrograms) {
    for (const dest of config.destinations) {
      // Outbound: origin -> dest
      try {
        callCount++;
        console.log(`[seats-aero] (${callCount}/${totalCalls}) ${programKey} ${config.origin}->${dest} outbound`);

        const outboundData = await fetchAvailability({
          origin: config.origin,
          destination: dest,
          cabin: config.cabin,
          startDate: config.outbound.start,
          endDate: config.outbound.end,
          slug: program.slug,
          apiKey,
        });

        for (const item of outboundData) {
          const record = mapRecord(item, 'outbound', config.origin, dest, programKey, program, cabinPrefix);
          if (record) results.push(record);
        }
      } catch (err) {
        console.warn(`[seats-aero] WARN: ${programKey} ${config.origin}->${dest} outbound failed: ${err.message}`);
      }

      await sleep(DELAY_MS);

      // Return: dest -> origin
      try {
        callCount++;
        console.log(`[seats-aero] (${callCount}/${totalCalls}) ${programKey} ${dest}->${config.origin} return`);

        const returnData = await fetchAvailability({
          origin: dest,
          destination: config.origin,
          cabin: config.cabin,
          startDate: config.return.start,
          endDate: config.return.end,
          slug: program.slug,
          apiKey,
        });

        for (const item of returnData) {
          const record = mapRecord(item, 'return', dest, config.origin, programKey, program, cabinPrefix);
          if (record) results.push(record);
        }
      } catch (err) {
        console.warn(`[seats-aero] WARN: ${programKey} ${dest}->${config.origin} return failed: ${err.message}`);
      }

      await sleep(DELAY_MS);
    }
  }

  console.log(`[seats-aero] Sweep complete: ${results.length} records found from ${callCount} API calls`);
  return results;
}
