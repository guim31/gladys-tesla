// -----------------------------------------------------------------------------
// Integration configuration: defaults (they MUST match the `default` values of
// the manifest `config_schema`, see test/manifest.test.js) and normalization,
// so the rest of the code never deals with `undefined` or form strings.
// -----------------------------------------------------------------------------

export const UNIT_SYSTEMS = { AUTO: 'auto', METRIC: 'metric', IMPERIAL: 'imperial' };
export const LANGUAGES = ['en', 'fr'];
// Minutes between two fallback vehicle_data reads ('0' = streaming only).
// No faster choice: reading an awake car that often may keep it from falling
// asleep, and drain its battery.
export const VEHICLE_REFRESH_CHOICES = ['0', '30', '60'];

export const DEFAULT_CONFIG = {
  access_token: '',
  units: UNIT_SYSTEMS.AUTO,
  language: 'en',
  vehicle_refresh_minutes: '30',
  home_energy_index: false,
};

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const config = { ...DEFAULT_CONFIG, ...raw };
  return {
    // A pasted token often carries a trailing newline or a "Bearer " prefix.
    access_token: String(config.access_token ?? '')
      .trim()
      .replace(/^bearer\s+/i, ''),
    units: Object.values(UNIT_SYSTEMS).includes(config.units) ? config.units : DEFAULT_CONFIG.units,
    language: LANGUAGES.includes(config.language) ? config.language : DEFAULT_CONFIG.language,
    vehicle_refresh_minutes: normalizeRefresh(config.vehicle_refresh_minutes),
    home_energy_index: config.home_energy_index === true || config.home_energy_index === 'true',
    // Left over from 1.1.0, where the Wall Connector was read here: it now has
    // its own integration (see src/tesla.js).
    wall_connectors_moved: String(raw.wall_connectors ?? '').trim() !== '',
  };
}

// Anything else (an older '15', a typed value) falls back to the default.
function normalizeRefresh(value) {
  const choice = String(value);
  return VEHICLE_REFRESH_CHOICES.includes(choice) ? choice : DEFAULT_CONFIG.vehicle_refresh_minutes;
}

/** Fallback refresh period in milliseconds, 0 when disabled. */
export function vehicleRefreshMs(config) {
  return Number(config.vehicle_refresh_minutes) * 60 * 1000;
}
