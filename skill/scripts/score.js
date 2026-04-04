/**
 * Scoring engine.
 * Ranks combos by total cost: points + fee penalty + stops penalty + cross-airport penalty.
 */

/**
 * Score a combo. Mutates nothing — returns new object with score and flags.
 * @param {object} combo
 * @param {object} config
 * @returns {object} scored combo with score and flags[]
 */
export function scoreCombo(combo, config) {
  const isOneWay = combo.return === null;
  const total_stops = (combo.outbound.stops || 0) + (isOneWay ? 0 : (combo.return.stops || 0));
  const is_cross_airport = !isOneWay && combo.outbound.destination !== combo.return.origin;

  const score = combo.total_pts
    + (combo.total_fees * config.fee_multiplier)
    + (total_stops * config.stops_penalty)
    + (is_cross_airport ? config.cross_airport_penalty : 0);

  const flags = [];

  if (combo.total_fees > config.high_fee_threshold) {
    flags.push("HIGH_FEES");
  }

  if (is_cross_airport) {
    flags.push("DIFFERENT_AIRPORTS");
  }

  // Heuristic: stops=0 from seats_aero likely means "unknown", not nonstop
  if (combo.outbound.stops === 0 && combo.outbound.source === "seats_aero") {
    flags.push("STOPS_UNKNOWN");
  }
  if (!isOneWay && combo.return.stops === 0 && combo.return.source === "seats_aero") {
    flags.push("STOPS_UNKNOWN");
  }

  return { ...combo, score, flags };
}

/**
 * Build a human-readable summary for a combo.
 * @param {object} combo - scored combo
 * @param {number} rank - 1-based rank
 * @param {number} totalCombos - total combos in result set
 * @param {object} programs - PROGRAMS config object
 * @returns {string} summary string
 */
export function buildSummary(combo, rank, totalCombos, programs) {
  const progOut = programs[combo.outbound.program]?.name ?? combo.outbound.program;
  const stopsOut = combo.outbound.stops ?? 0;

  if (combo.return === null) {
    return `${progOut} ${combo.outbound.date}. ${combo.total_pts} MR one-way. $${combo.total_fees} fees. ${stopsOut}-stop. Score: ${combo.score} (rank #${rank} of ${totalCombos}).`;
  }

  const progRet = programs[combo.return.program]?.name ?? combo.return.program;
  const stopsRet = combo.return.stops ?? 0;

  return `${progOut} outbound ${combo.outbound.date} + ${progRet} return ${combo.return.date}. ${combo.total_pts} MR for ${combo.outbound.seats_available !== null ? "confirmed" : "likely"} ${combo.stay_days}-day trip. $${combo.total_fees} fees. ${stopsOut}-stop out, ${stopsRet}-stop back. Score: ${combo.score} (rank #${rank} of ${totalCombos}).`;
}
