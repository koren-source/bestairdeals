/**
 * Combo math engine.
 * Pairs every outbound record with every return record, filters by trip length
 * and seat availability, calculates totals for N passengers.
 */

function daysBetween(dateA, dateB) {
  const a = new Date(dateA + "T00:00:00Z");
  const b = new Date(dateB + "T00:00:00Z");
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

/**
 * Build all valid outbound x return combos.
 * @param {object[]} outbound - outbound records
 * @param {object[]} returns - return records
 * @param {object} config - trip config (pax, trip_length.min/max)
 * @returns {object[]} combo objects
 */
export function buildCombos(outbound, returns, config) {
  const combos = [];

  for (const out of outbound) {
    if (out.mr_cost == null || out.fees_usd == null) {
      console.warn(`Skipping outbound record with null mr_cost or fees_usd: ${out.date} ${out.program}`);
      continue;
    }

    for (const ret of returns) {
      if (ret.mr_cost == null || ret.fees_usd == null) {
        console.warn(`Skipping return record with null mr_cost or fees_usd: ${ret.date} ${ret.program}`);
        continue;
      }

      const stay_days = daysBetween(out.date, ret.date);

      if (stay_days < config.trip_length.min || stay_days > config.trip_length.max) {
        continue;
      }

      // Two-tier seat check: null = Likely Available (don't filter out)
      const outSeatsOk = out.seats_available === null || out.seats_available >= config.pax;
      const retSeatsOk = ret.seats_available === null || ret.seats_available >= config.pax;

      if (!outSeatsOk || !retSeatsOk) {
        continue;
      }

      const confirmed = out.seats_available !== null && ret.seats_available !== null;
      const total_pts = (out.mr_cost + ret.mr_cost) * config.pax;
      const total_fees = (out.fees_usd + ret.fees_usd) * config.pax;

      // Derive source_tag from outbound and return records
      let source_tag = out.source_tag || null;
      if (out.source_tag && ret.source_tag) {
        source_tag = (out.source_tag === 'Both' || ret.source_tag === 'Both' || out.source_tag !== ret.source_tag)
          ? 'Both'
          : out.source_tag;
      }

      combos.push({
        outbound: out,
        return: ret,
        stay_days,
        total_pts,
        total_fees,
        confirmed,
        source_tag,
      });
    }
  }

  return combos;
}

/**
 * Build near-miss combos that almost qualified.
 * Date near-miss: stay_days within 1 day of min/max but outside range.
 * Seat near-miss: seats < pax but >= 1 on either leg.
 * @param {object[]} outbound
 * @param {object[]} returns
 * @param {object} config
 * @param {object[]} qualifyingCombos - scored qualifying combos (sorted by score ASC)
 * @returns {object[]} near-miss combos, capped at 20
 */
export function buildNearMisses(outbound, returns, config, qualifyingCombos) {
  const nearMisses = [];
  const bestScore = qualifyingCombos.length > 0 ? qualifyingCombos[0].score : null;

  for (const out of outbound) {
    if (out.mr_cost == null || out.fees_usd == null) continue;

    for (const ret of returns) {
      if (ret.mr_cost == null || ret.fees_usd == null) continue;

      const stay_days = daysBetween(out.date, ret.date);
      if (stay_days <= 0) continue;

      let reason = null;

      // Date near-miss: within 1 day of boundary but outside range
      const isDateNearMiss =
        (stay_days === config.trip_length.min - 1 || stay_days === config.trip_length.max + 1);

      // Seat near-miss: seats < pax but >= 1 on either leg (only for non-null seats)
      const outSeatNearMiss = out.seats_available !== null && out.seats_available < config.pax && out.seats_available >= 1;
      const retSeatNearMiss = ret.seats_available !== null && ret.seats_available < config.pax && ret.seats_available >= 1;
      const isSeatNearMiss = outSeatNearMiss || retSeatNearMiss;

      // Must be within valid date range for seat near-miss check
      const inDateRange = stay_days >= config.trip_length.min && stay_days <= config.trip_length.max;

      if (isDateNearMiss && !isSeatNearMiss) {
        // Date near-miss: seats must still be sufficient
        const outSeatsOk = out.seats_available === null || out.seats_available >= config.pax;
        const retSeatsOk = ret.seats_available === null || ret.seats_available >= config.pax;
        if (!outSeatsOk || !retSeatsOk) continue;
        reason = "date";
      } else if (isSeatNearMiss && inDateRange) {
        reason = "seats";
      } else {
        continue;
      }

      const total_pts = (out.mr_cost + ret.mr_cost) * config.pax;
      const total_fees = (out.fees_usd + ret.fees_usd) * config.pax;

      const nearMiss = {
        outbound: out,
        return: ret,
        stay_days,
        total_pts,
        total_fees,
        reason,
      };

      if (bestScore !== null) {
        // Approximate score for the near-miss to compute delta
        const total_stops = (out.stops || 0) + (ret.stops || 0);
        const is_cross = out.destination !== ret.origin;
        const nmScore = total_pts
          + (total_fees * (config.fee_multiplier || 100))
          + (total_stops * (config.stops_penalty || 5000))
          + (is_cross ? (config.cross_airport_penalty || 5000) : 0);
        nearMiss.pts_delta = bestScore - nmScore;
      } else {
        nearMiss.pts_delta = null;
        nearMiss.no_baseline = true;
      }

      nearMisses.push(nearMiss);
    }
  }

  // Sort by pts_delta DESC (biggest savings first) when baseline exists
  if (bestScore !== null) {
    nearMisses.sort((a, b) => (b.pts_delta ?? 0) - (a.pts_delta ?? 0));
  }

  return nearMisses.slice(0, 20);
}
