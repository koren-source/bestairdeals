/**
 * config.js — Shared config validation and flex date expansion.
 * Used by search.js (loadConfig) and api-server.js (validateSearchParams).
 */

import { readFileSync } from 'fs';

const VALID_CABINS = ['economy', 'premium', 'business', 'first'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

/**
 * Validate the core trip config fields shared by all search modes.
 * Throws on invalid config with a descriptive message.
 *
 * @param {Object} config - Parsed config object
 * @returns {Object} Config with defaults applied
 */
export function validateConfig(config) {
  if (!config.origin || typeof config.origin !== 'string') {
    throw new Error('config: "origin" must be a non-empty string');
  }

  if (!Array.isArray(config.destinations) || config.destinations.length === 0) {
    throw new Error('config: "destinations" must be a non-empty array');
  }

  if (!VALID_CABINS.includes(config.cabin)) {
    throw new Error(`config: "cabin" must be one of: ${VALID_CABINS.join(', ')}. Got: "${config.cabin}"`);
  }

  if (typeof config.pax !== 'number' || config.pax < 1) {
    throw new Error('config: "pax" must be a number >= 1');
  }

  // Date validation
  for (const field of ['outbound', 'return']) {
    const range = config[field];
    if (!range || !range.start || !range.end) {
      throw new Error(`config: "${field}" must have "start" and "end" dates`);
    }
    if (!DATE_RE.test(range.start) || !DATE_RE.test(range.end)) {
      throw new Error(`config: "${field}" dates must be YYYY-MM-DD format`);
    }
    if (range.start > range.end) {
      throw new Error(`config: "${field}.start" must be before "${field}.end"`);
    }
  }

  // Trip length
  if (!config.trip_length || typeof config.trip_length.min !== 'number' || typeof config.trip_length.max !== 'number') {
    throw new Error('config: "trip_length" must have numeric "min" and "max"');
  }
  if (config.trip_length.min > config.trip_length.max) {
    throw new Error('config: "trip_length.min" must be <= "trip_length.max"');
  }

  // Defaults for optional scoring params
  config.fee_multiplier = config.fee_multiplier ?? 100;
  config.high_fee_threshold = config.high_fee_threshold ?? 800;
  config.stops_penalty = config.stops_penalty ?? 5000;
  config.cross_airport_penalty = config.cross_airport_penalty ?? 5000;

  return config;
}

/**
 * Validate search params from the API (includes mode validation).
 * For exact mode, validates date ranges directly.
 * For flex mode, expands dates and merges into config.
 *
 * @param {Object} params - Request body from POST /search
 * @returns {Object} Validated config ready for search pipeline
 */
export function validateSearchParams(params) {
  const { mode } = params;

  if (!mode || !['exact', 'flex'].includes(mode)) {
    throw new Error('config: "mode" must be "exact" or "flex"');
  }

  if (mode === 'flex') {
    if (!params.outbound?.month || !MONTH_RE.test(params.outbound.month)) {
      throw new Error('config: flex mode requires "outbound.month" in YYYY-MM format');
    }
    if (!params.trip_length || typeof params.trip_length.min !== 'number' || typeof params.trip_length.max !== 'number') {
      throw new Error('config: flex mode requires "trip_length.min" and "trip_length.max"');
    }

    // Expand flex dates into standard date ranges
    const expanded = expandFlexDates(params.outbound.month, params.trip_length);
    const config = {
      origin: params.origin,
      destinations: params.destinations,
      cabin: params.cabin,
      pax: params.pax,
      outbound: expanded.outbound,
      return: expanded.return,
      trip_length: params.trip_length,
    };
    return validateConfig(config);
  }

  // Exact mode: params already have outbound/return date ranges
  const config = {
    origin: params.origin,
    destinations: params.destinations,
    cabin: params.cabin,
    pax: params.pax,
    outbound: params.outbound,
    return: params.return,
    trip_length: params.trip_length,
  };
  return validateConfig(config);
}

/**
 * Expand a flex month + trip length into outbound/return date windows.
 *
 * @param {string} month - "YYYY-MM" format
 * @param {{ min: number, max: number }} tripLength
 * @returns {{ outbound: { start, end }, return: { start, end } }}
 */
export function expandFlexDates(month, tripLength) {
  if (!MONTH_RE.test(month)) {
    throw new Error(`Invalid month format: "${month}". Expected YYYY-MM.`);
  }

  const [year, mon] = month.split('-').map(Number);

  // Outbound window: first to last day of the month
  const outStart = new Date(year, mon - 1, 1);
  const outEnd = new Date(year, mon, 0); // Last day of month

  // Return window: outbound.start + min_days to outbound.end + max_days
  const retStart = new Date(outStart);
  retStart.setDate(retStart.getDate() + tripLength.min);

  const retEnd = new Date(outEnd);
  retEnd.setDate(retEnd.getDate() + tripLength.max);

  const fmt = (d) => d.toISOString().split('T')[0];

  return {
    outbound: { start: fmt(outStart), end: fmt(outEnd) },
    return: { start: fmt(retStart), end: fmt(retEnd) },
  };
}

/**
 * Load and validate trip.json from disk.
 * @returns {Object} Validated config
 */
export function loadConfig() {
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

  return validateConfig(config);
}
