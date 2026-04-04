/**
 * Merge and deduplicate results from Seats.aero and point.me.
 * Applies MR normalization after dedup.
 */

function makeKey(record) {
  return `${record.direction}|${record.origin}|${record.destination}|${record.date}|${record.program}`;
}

/**
 * Merge results from both agents. point.me price wins on duplicates.
 * Applies MR normalization (mr_cost = pts_per_person_ow / effective_ratio).
 * @param {object[]} seatsResults - Seats.aero records
 * @param {object[]} pointmeResults - point.me records
 * @param {object} programs - PROGRAMS config
 * @returns {object[]} merged, deduplicated, MR-normalized records
 */
export function mergeAndDedup(seatsResults, pointmeResults, programs) {
  const map = new Map();

  // Insert Seats.aero records first
  for (const record of seatsResults) {
    const key = makeKey(record);
    map.set(key, { ...record, source_tag: "API" });
  }

  // point.me records overwrite (price wins) or insert new
  for (const record of pointmeResults) {
    const key = makeKey(record);
    if (map.has(key)) {
      const existing = map.get(key);
      // [Both]: take point.me price + Seats.aero seat count
      map.set(key, {
        ...record,
        seats_available: existing.seats_available,
        source_tag: "Both",
      });
    } else {
      map.set(key, { ...record, source_tag: "Verified" });
    }
  }

  // If one agent failed entirely, tag everything PARTIAL
  if (seatsResults.length === 0) {
    for (const entry of map.values()) {
      entry.source_tag = "PARTIAL";
    }
  }
  if (pointmeResults.length === 0) {
    for (const entry of map.values()) {
      entry.source_tag = "PARTIAL";
    }
  }

  // Apply MR normalization
  const results = [...map.values()];
  for (const record of results) {
    const prog = programs[record.program];
    const effectiveRatio = prog?.bonus_ratio ?? prog?.ratio ?? 1;
    record.mr_cost = record.pts_per_person_ow / effectiveRatio;
  }

  return results;
}
