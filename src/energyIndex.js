// -----------------------------------------------------------------------------
// Cumulative energy indexes from daily totals.
//
// Gladys' energy module works from cumulative meter indexes (kWh that only
// grow): it turns their deltas into 30-minute consumption and cost. Tesla gives
// no lifetime counter, but Teslemetry streams `energy_totals`: the running
// totals (Wh) of the site-local DAY, re-sent whenever they change. An index is
// rebuilt from them: the finished days are folded into a base, the recent days
// are kept by date (the server finalizes a day after its local midnight, so a
// late correction of yesterday must still land), and the index is the sum.
//
// The published value never decreases: a downward correction would read as a
// meter reset in Gladys (and count nothing), so the index holds its value
// until the totals catch up. The state is plain JSON, persisted in /data.
// -----------------------------------------------------------------------------

// Days kept open for late corrections before being folded into the base.
const OPEN_DAYS = 3;

export function createIndexState() {
  return { base: 0, days: {}, published: null };
}

/**
 * Record the total of a day.
 * @param {{ base: number, days: Record<string, number>, published: number|null }} state mutated
 * @param {string} date site-local day, `YYYY-MM-DD`
 * @param {number} totalWh running total of that day, in Wh
 * @returns {number|null} the index to publish, in kWh (null if unchanged)
 */
export function recordDailyTotal(state, date, totalWh) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !Number.isFinite(totalWh) || totalWh < 0) {
    return null;
  }
  const dates = Object.keys(state.days).sort();
  // A day older than every open one was already folded: ignore it rather than
  // count it twice.
  if (dates.length >= OPEN_DAYS && date < dates[0]) return null;
  state.days[date] = totalWh / 1000;
  const open = Object.keys(state.days).sort();
  while (open.length > OPEN_DAYS) {
    const oldest = open.shift();
    state.base += state.days[oldest];
    delete state.days[oldest];
  }
  const index =
    Math.round((state.base + open.reduce((sum, d) => sum + state.days[d], 0)) * 1000) / 1000;
  if (state.published !== null && index <= state.published) return null;
  state.published = index;
  return index;
}

/** Last published index of a state, for the republication after a restart. */
export function currentIndex(state) {
  return state?.published ?? null;
}
