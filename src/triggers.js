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
  WALL_CONNECTOR_PLUGGED: 'wall_connector_plugged',
  WALL_CONNECTOR_UNPLUGGED: 'wall_connector_unplugged',
  WALL_CONNECTOR_CHARGING_STARTED: 'wall_connector_charging_started',
  WALL_CONNECTOR_CHARGING_FINISHED: 'wall_connector_charging_finished',
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
    if (after === 'Charging' && before !== 'Starting') events.push(SCENE_TRIGGERS.CHARGING_STARTED);
    if (after === 'Starting') events.push(SCENE_TRIGGERS.CHARGING_STARTED);
    if (after === 'Complete' && before !== 'Disconnected') {
      events.push(SCENE_TRIGGERS.CHARGING_COMPLETE);
    }
    if (before === 'Disconnected') events.push(SCENE_TRIGGERS.VEHICLE_PLUGGED_IN);
    if (after === 'Disconnected') events.push(SCENE_TRIGGERS.VEHICLE_UNPLUGGED);
  }
  return events;
}

/**
 * Wall Connector triggers between two charge session states (see
 * `sessionState` in src/devices/wallConnector.js), in the order things happen:
 * plugged in, then charging.
 * @returns {string[]} trigger keys
 */
export function wallConnectorTransitions(previous, next) {
  const before = previous.sessionState;
  const after = next.sessionState;
  const events = [];
  if (!before || !after || before === after) return events;
  if (before === 'Disconnected') events.push(SCENE_TRIGGERS.WALL_CONNECTOR_PLUGGED);
  if (after === 'Charging') events.push(SCENE_TRIGGERS.WALL_CONNECTOR_CHARGING_STARTED);
  if (after === 'Complete' && before !== 'Disconnected') {
    events.push(SCENE_TRIGGERS.WALL_CONNECTOR_CHARGING_FINISHED);
  }
  if (after === 'Disconnected') events.push(SCENE_TRIGGERS.WALL_CONNECTOR_UNPLUGGED);
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
