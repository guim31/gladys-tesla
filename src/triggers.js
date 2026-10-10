// -----------------------------------------------------------------------------
// Scene triggers fired by the integration (manifest `scene_triggers`).
//
// Each one is a TRANSITION observed between two known values: nothing fires on
// the first value ever seen, so a restart or a reconnection never replays an
// event (the last known values are persisted, see src/store.js).
// -----------------------------------------------------------------------------

export const SCENE_TRIGGERS = {
  CHARGING_STARTED: 'charging_started',
  CHARGING_COMPLETE: 'charging_complete',
  VEHICLE_PLUGGED_IN: 'vehicle_plugged_in',
  VEHICLE_UNPLUGGED: 'vehicle_unplugged',
  GRID_OUTAGE: 'grid_outage',
  GRID_RESTORED: 'grid_restored',
};

export const SCENE_TRIGGER_KEYS = Object.values(SCENE_TRIGGERS);

/**
 * Vehicle triggers between two snapshots (charge state, plug).
 * @returns {string[]} trigger keys
 */
export function vehicleTransitions(previous, next) {
  const events = [];
  const before = previous.chargingState;
  const after = next.chargingState;
  if (before && after && before !== after) {
    // In the order things happen: plugged in, then charging.
    if (before === 'Disconnected') events.push(SCENE_TRIGGERS.VEHICLE_PLUGGED_IN);
    if (after === 'Charging' && before !== 'Starting') events.push(SCENE_TRIGGERS.CHARGING_STARTED);
    if (after === 'Starting') events.push(SCENE_TRIGGERS.CHARGING_STARTED);
    if (after === 'Complete' && before !== 'Disconnected') {
      events.push(SCENE_TRIGGERS.CHARGING_COMPLETE);
    }
    if (after === 'Disconnected') events.push(SCENE_TRIGGERS.VEHICLE_UNPLUGGED);
  }
  return events;
}

/** Energy site triggers (grid presence). */
export function siteTransitions(previous, next) {
  if (typeof previous.gridConnected !== 'boolean' || typeof next.gridConnected !== 'boolean') {
    return [];
  }
  if (previous.gridConnected && !next.gridConnected) return [SCENE_TRIGGERS.GRID_OUTAGE];
  if (!previous.gridConnected && next.gridConnected) return [SCENE_TRIGGERS.GRID_RESTORED];
  return [];
}
