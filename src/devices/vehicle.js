// -----------------------------------------------------------------------------
// Device type: TESLA VEHICLE.
//
// One Gladys device per car, keyed on the VIN (the platform id Tesla gives the
// car: it never changes, unlike its name). Values come from two sources, both
// folded into one in-memory "snapshot" in canonical units (miles, °C, kW):
//   - the Teslemetry stream (Fleet Telemetry field deltas, see stream.js);
//   - a `vehicle_data` read (Teslemetry's cache, see client.js).
// The published states are derived from the snapshot, in the unit of the
// feature (see src/units.js).
//
// The car is NEVER woken to read it: an asleep car simply streams nothing and
// its cached `vehicle_data` is its last known state. Only a command the user
// asks for wakes it (Teslemetry wakes the car before relaying the command).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { t } from '../i18n.js';
import { distanceIn, round, temperatureIn, temperatureToCelsius } from '../units.js';

export const VEHICLE_DEVICE_TYPE = 'vehicle';

// Feature keys: part of the external_id, frozen once published.
export const VEHICLE_FEATURES = {
  BATTERY_LEVEL: 'battery-level',
  RANGE: 'range',
  CHARGING_STATE: 'charging-state',
  CHARGE_POWER: 'charge-power',
  CHARGE_LIMIT: 'charge-limit',
  CHARGING: 'charging',
  CHARGE_CURRENT: 'charge-current',
  PLUGGED: 'plugged',
  CLIMATE: 'climate',
  INSIDE_TEMPERATURE: 'inside-temperature',
  OUTSIDE_TEMPERATURE: 'outside-temperature',
  TARGET_TEMPERATURE: 'target-temperature',
  LOCKED: 'locked',
  SENTRY_MODE: 'sentry-mode',
  ODOMETER: 'odometer',
  AWAKE: 'awake',
};

// Charge session states, the Gladys `charging-station/charging-state` enum
// (OCPP 2.x ChargingStateEnumType values, translated by the Gladys front).
export const CHARGING_STATION_STATE = {
  CHARGING: 0,
  EV_CONNECTED: 1,
  PAUSED_BY_VEHICLE: 2,
  PAUSED_BY_CHARGER: 3,
  IDLE: 4,
};

// Tesla charging_state (vehicle_data) / DetailedChargeState (stream, without
// its "DetailedChargeState" prefix) → Gladys charge session state.
const CHARGING_STATE_MAP = {
  Charging: CHARGING_STATION_STATE.CHARGING,
  Starting: CHARGING_STATION_STATE.EV_CONNECTED,
  Calibrating: CHARGING_STATION_STATE.EV_CONNECTED,
  Stopped: CHARGING_STATION_STATE.PAUSED_BY_VEHICLE,
  NoPower: CHARGING_STATION_STATE.PAUSED_BY_CHARGER,
  Complete: CHARGING_STATION_STATE.IDLE,
  Disconnected: CHARGING_STATION_STATE.IDLE,
};

// Bounds Tesla accepts for the commands (cabin temperature in °C).
export const CHARGE_LIMIT_MIN = 50;
export const CHARGE_LIMIT_MAX = 100;
export const CABIN_TEMP_MIN_C = 15;
export const CABIN_TEMP_MAX_C = 28;
const DEFAULT_MAX_CHARGE_CURRENT = 48; // North American Wall Connector

const MODELS = {
  model3: 'Model 3',
  modely: 'Model Y',
  models: 'Model S',
  models2: 'Model S',
  lychee: 'Model S',
  modelx: 'Model X',
  tamarind: 'Model X',
  cybertruck: 'Cybertruck',
};
// Fourth VIN character → model (5YJ3…, 7SAY…, 5YJS…, 7G2C…).
const MODEL_BY_VIN_LETTER = {
  3: 'Model 3',
  Y: 'Model Y',
  S: 'Model S',
  X: 'Model X',
  C: 'Cybertruck',
};

/** "Model 3", "Cybertruck"… from the vehicle config, else the VIN. */
export function vehicleModel(product) {
  const carType = product?.vehicle_config?.car_type;
  if (carType && MODELS[carType]) return MODELS[carType];
  const letter = typeof product?.vin === 'string' ? product.vin.charAt(3).toUpperCase() : '';
  return MODEL_BY_VIN_LETTER[letter] ?? 'Tesla';
}

export function vehicleIds(gladys, vin) {
  return gladys.externalIds(VEHICLE_DEVICE_TYPE, vin);
}

// --- Reading -----------------------------------------------------------------

const num = (value) => {
  if (value === null || value === undefined || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
};
const bool = (value) => {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
};
const stripPrefix = (value, prefix) =>
  typeof value === 'string' && value.startsWith(prefix) ? value.slice(prefix.length) : value;

function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined));
}

/**
 * Snapshot fields from a `vehicle_data` response. A sleeping car answers its
 * last known values: they are still the best we know.
 */
export function snapshotFromVehicleData(data = {}) {
  const charge = data.charge_state ?? {};
  const climate = data.climate_state ?? {};
  const vehicle = data.vehicle_state ?? {};
  const gui = data.gui_settings ?? {};
  const chargingState =
    typeof charge.charging_state === 'string' ? charge.charging_state : undefined;
  return compact({
    online: data.state ? data.state === 'online' : undefined,
    batteryLevel: num(charge.battery_level),
    rangeMiles: num(charge.battery_range),
    chargingState,
    chargePowerKw:
      chargingState === undefined
        ? undefined
        : isCharging(chargingState)
          ? (num(charge.charger_power) ?? 0)
          : 0,
    chargeLimit: num(charge.charge_limit_soc),
    chargeCurrentRequest: num(charge.charge_current_request),
    chargeCurrentMax: num(charge.charge_current_request_max),
    climateOn: bool(climate.is_climate_on),
    insideTempC: num(climate.inside_temp),
    outsideTempC: num(climate.outside_temp),
    targetTempC: num(climate.driver_temp_setting),
    locked: bool(vehicle.locked),
    sentry: bool(vehicle.sentry_mode),
    odometerMiles: num(vehicle.odometer),
    distanceUnit: gui.gui_distance_units
      ? String(gui.gui_distance_units).startsWith('mi')
        ? 'mi'
        : 'km'
      : undefined,
    temperatureUnit:
      gui.gui_temperature_units === 'F' ? 'F' : gui.gui_temperature_units ? 'C' : undefined,
  });
}

const isCharging = (state) => state === 'Charging' || state === 'Starting';

/**
 * Snapshot fields from a stream `data` event. Field names and enum prefixes
 * are those of Tesla Fleet Telemetry; `previous` is the current snapshot, used
 * to gate the charging power (AC/DC power is not reset when a session ends).
 */
export function snapshotFromStreamData(data = {}, previous = {}) {
  const has = (key) => Object.prototype.hasOwnProperty.call(data, key);
  const next = {};
  if (has('BatteryLevel')) next.batteryLevel = num(data.BatteryLevel);
  if (has('RatedRange')) next.rangeMiles = num(data.RatedRange);
  if (has('DetailedChargeState')) {
    const state = stripPrefix(data.DetailedChargeState, 'DetailedChargeState');
    if (typeof state === 'string' && state !== 'Unknown') next.chargingState = state;
  }
  if (has('ACChargingPower')) next.acPowerKw = num(data.ACChargingPower);
  if (has('DCChargingPower')) next.dcPowerKw = num(data.DCChargingPower);
  if (has('ChargeLimitSoc')) next.chargeLimit = num(data.ChargeLimitSoc);
  if (has('ChargeCurrentRequest')) next.chargeCurrentRequest = num(data.ChargeCurrentRequest);
  if (has('ChargeCurrentRequestMax')) next.chargeCurrentMax = num(data.ChargeCurrentRequestMax);
  if (has('HvacPower')) {
    const state = stripPrefix(data.HvacPower, 'HvacPowerState');
    if (typeof state === 'string' && state !== 'Unknown') {
      next.climateOn = state === 'On' || state === 'Precondition';
    }
  }
  if (has('InsideTemp')) next.insideTempC = num(data.InsideTemp);
  if (has('OutsideTemp')) next.outsideTempC = num(data.OutsideTemp);
  if (has('HvacLeftTemperatureRequest')) next.targetTempC = num(data.HvacLeftTemperatureRequest);
  if (has('Locked')) next.locked = bool(data.Locked);
  if (has('SentryMode')) {
    const state = stripPrefix(data.SentryMode, 'SentryModeState');
    if (typeof state === 'string' && state !== 'Unknown') next.sentry = state !== 'Off';
  }
  if (has('Odometer')) next.odometerMiles = num(data.Odometer);
  if (has('SettingDistanceUnit')) {
    const unit = stripPrefix(data.SettingDistanceUnit, 'DistanceUnit');
    if (unit === 'Miles') next.distanceUnit = 'mi';
    if (unit === 'Kilometers') next.distanceUnit = 'km';
  }
  if (has('SettingTemperatureUnit')) {
    const unit = stripPrefix(data.SettingTemperatureUnit, 'TemperatureUnit');
    if (unit === 'Fahrenheit') next.temperatureUnit = 'F';
    if (unit === 'Celsius') next.temperatureUnit = 'C';
  }
  const merged = { ...previous, ...compact(next) };
  if (
    next.chargingState !== undefined ||
    next.acPowerKw !== undefined ||
    next.dcPowerKw !== undefined
  ) {
    // The stream carries AC and DC power separately and never resets them when
    // a session ends: only trust them while the car says it is charging.
    const power = Math.max(merged.acPowerKw ?? 0, merged.dcPowerKw ?? 0);
    merged.chargePowerKw = isCharging(merged.chargingState) ? power : 0;
  }
  // Anything streamed means the car is up.
  return { ...merged, online: true };
}

// Fleet Telemetry fields the streaming configuration must carry. Added to the
// car's configuration when missing (merged, never replacing the user's).
export const STREAMING_FIELDS = [
  'BatteryLevel',
  'RatedRange',
  'DetailedChargeState',
  'ACChargingPower',
  'DCChargingPower',
  'ChargeLimitSoc',
  'ChargeCurrentRequest',
  'ChargeCurrentRequestMax',
  'HvacPower',
  'InsideTemp',
  'OutsideTemp',
  'HvacLeftTemperatureRequest',
  'Locked',
  'SentryMode',
  'Odometer',
  'SettingDistanceUnit',
  'SettingTemperatureUnit',
];

/** Plugged in: any charge state but "Disconnected". */
export function isPlugged(snapshot) {
  if (!snapshot.chargingState) return null;
  return snapshot.chargingState !== 'Disconnected';
}

// --- Publishing ----------------------------------------------------------------

/**
 * The discovery payload of one car.
 * @param {object} gladys SDK instance
 * @param {object} product entry of /api/1/products (vin, display_name, vehicle_config)
 * @param {{ language: string, units: { distance: string, temperature: string }, snapshot?: object }} options
 */
export function buildVehicleDevice(gladys, product, { language, units, snapshot = {} }) {
  const ids = vehicleIds(gladys, product.vin);
  const model = vehicleModel(product);
  const tempF = units.temperature === UNITS.FAHRENHEIT;
  const cabinMin = tempF ? 59 : CABIN_TEMP_MIN_C;
  const cabinMax = tempF ? 82 : CABIN_TEMP_MAX_C;
  const maxCurrent = Math.max(
    1,
    Math.round(snapshot.chargeCurrentMax ?? DEFAULT_MAX_CHARGE_CURRENT),
  );
  const feature = (key, name, category, type, extra) => ({
    name: t(language, name),
    external_id: ids.feature(key),
    category,
    type,
    read_only: true,
    has_feedback: false,
    keep_history: true,
    min: 0,
    max: 1,
    ...extra,
  });
  const command = { read_only: false, has_feedback: true };
  return {
    name: product.display_name?.trim() || `Tesla ${model}`,
    external_id: ids.device,
    model,
    features: [
      feature(
        VEHICLE_FEATURES.BATTERY_LEVEL,
        'batteryLevel',
        CATEGORIES.ELECTRICAL_VEHICLE_BATTERY,
        TYPES.ELECTRICAL_VEHICLE_BATTERY.BATTERY_LEVEL,
        { unit: UNITS.PERCENT, max: 100 },
      ),
      feature(
        VEHICLE_FEATURES.RANGE,
        'range',
        CATEGORIES.ELECTRICAL_VEHICLE_BATTERY,
        TYPES.ELECTRICAL_VEHICLE_BATTERY.BATTERY_RANGE_ESTIMATE,
        { unit: units.distance, max: 1000 },
      ),
      feature(
        VEHICLE_FEATURES.CHARGING_STATE,
        'chargingState',
        CATEGORIES.CHARGING_STATION,
        TYPES.CHARGING_STATION.CHARGING_STATE,
        { max: 5 },
      ),
      feature(
        VEHICLE_FEATURES.CHARGE_POWER,
        'chargePower',
        CATEGORIES.ELECTRICAL_VEHICLE_CHARGE,
        TYPES.ELECTRICAL_VEHICLE_CHARGE.CHARGE_POWER,
        { unit: UNITS.KILOWATT, max: 350 },
      ),
      feature(
        VEHICLE_FEATURES.CHARGE_LIMIT,
        'chargeLimit',
        CATEGORIES.ELECTRICAL_VEHICLE_CHARGE,
        TYPES.ELECTRICAL_VEHICLE_CHARGE.TARGET_CHARGE_LIMIT,
        { ...command, unit: UNITS.PERCENT, min: CHARGE_LIMIT_MIN, max: CHARGE_LIMIT_MAX },
      ),
      feature(
        VEHICLE_FEATURES.CHARGING,
        'charging',
        CATEGORIES.ELECTRICAL_VEHICLE_CHARGE,
        TYPES.ELECTRICAL_VEHICLE_CHARGE.CHARGE_ON,
        command,
      ),
      feature(
        VEHICLE_FEATURES.CHARGE_CURRENT,
        'chargeCurrent',
        CATEGORIES.ELECTRICAL_VEHICLE_CHARGE,
        TYPES.ELECTRICAL_VEHICLE_CHARGE.TARGET_CURRENT,
        { ...command, unit: UNITS.AMPERE, min: 1, max: maxCurrent },
      ),
      feature(
        VEHICLE_FEATURES.PLUGGED,
        'plugged',
        CATEGORIES.ELECTRICAL_VEHICLE_CHARGE,
        TYPES.ELECTRICAL_VEHICLE_CHARGE.PLUGGED,
      ),
      feature(
        VEHICLE_FEATURES.CLIMATE,
        'climate',
        CATEGORIES.ELECTRICAL_VEHICLE_CLIMATE,
        TYPES.ELECTRICAL_VEHICLE_CLIMATE.CLIMATE_ON,
        command,
      ),
      feature(
        VEHICLE_FEATURES.INSIDE_TEMPERATURE,
        'insideTemp',
        CATEGORIES.ELECTRICAL_VEHICLE_CLIMATE,
        TYPES.ELECTRICAL_VEHICLE_CLIMATE.INDOOR_TEMPERATURE,
        { unit: units.temperature, min: -40, max: tempF ? 185 : 85 },
      ),
      feature(
        VEHICLE_FEATURES.TARGET_TEMPERATURE,
        'targetTemp',
        CATEGORIES.ELECTRICAL_VEHICLE_CLIMATE,
        TYPES.ELECTRICAL_VEHICLE_CLIMATE.TARGET_TEMPERATURE,
        { ...command, unit: units.temperature, min: cabinMin, max: cabinMax },
      ),
      feature(
        VEHICLE_FEATURES.OUTSIDE_TEMPERATURE,
        'outsideTemp',
        CATEGORIES.TEMPERATURE_SENSOR,
        TYPES.SENSOR.DECIMAL,
        { unit: units.temperature, min: -40, max: tempF ? 140 : 60 },
      ),
      feature(
        VEHICLE_FEATURES.LOCKED,
        'locked',
        CATEGORIES.ELECTRICAL_VEHICLE_COMMAND,
        TYPES.ELECTRICAL_VEHICLE_COMMAND.LOCK,
        command,
      ),
      feature(
        VEHICLE_FEATURES.SENTRY_MODE,
        'sentry',
        CATEGORIES.ELECTRICAL_VEHICLE_COMMAND,
        TYPES.ELECTRICAL_VEHICLE_COMMAND.ALARM,
        command,
      ),
      feature(
        VEHICLE_FEATURES.ODOMETER,
        'odometer',
        CATEGORIES.ELECTRICAL_VEHICLE_STATE,
        TYPES.ELECTRICAL_VEHICLE_STATE.ODOMETER,
        { unit: units.distance, max: 2000000 },
      ),
      feature(VEHICLE_FEATURES.AWAKE, 'awake', CATEGORIES.INPUT, TYPES.INPUT.BINARY),
    ],
  };
}

const binary = (value) => (value === null || value === undefined ? null : value ? 1 : 0);

/**
 * States of one car, from its snapshot.
 * @param {(key: string) => string} unitOf unit of a feature key (the created
 *   device's when it exists, so the values always match the stored unit)
 * @returns {Array<{ key: string, value: number }>} only the known values
 */
export function vehicleStates(snapshot, unitOf) {
  const plugged = isPlugged(snapshot);
  const states = [
    [VEHICLE_FEATURES.BATTERY_LEVEL, round(snapshot.batteryLevel)],
    [
      VEHICLE_FEATURES.RANGE,
      round(distanceIn(unitOf(VEHICLE_FEATURES.RANGE), snapshot.rangeMiles)),
    ],
    [
      VEHICLE_FEATURES.CHARGING_STATE,
      snapshot.chargingState in CHARGING_STATE_MAP
        ? CHARGING_STATE_MAP[snapshot.chargingState]
        : null,
    ],
    [VEHICLE_FEATURES.CHARGE_POWER, round(snapshot.chargePowerKw, 1)],
    [VEHICLE_FEATURES.CHARGE_LIMIT, round(snapshot.chargeLimit)],
    [
      VEHICLE_FEATURES.CHARGING,
      snapshot.chargingState ? binary(isCharging(snapshot.chargingState)) : null,
    ],
    [VEHICLE_FEATURES.CHARGE_CURRENT, round(snapshot.chargeCurrentRequest)],
    [VEHICLE_FEATURES.PLUGGED, binary(plugged)],
    [VEHICLE_FEATURES.CLIMATE, binary(snapshot.climateOn)],
    [
      VEHICLE_FEATURES.INSIDE_TEMPERATURE,
      round(temperatureIn(unitOf(VEHICLE_FEATURES.INSIDE_TEMPERATURE), snapshot.insideTempC), 1),
    ],
    [
      VEHICLE_FEATURES.TARGET_TEMPERATURE,
      round(temperatureIn(unitOf(VEHICLE_FEATURES.TARGET_TEMPERATURE), snapshot.targetTempC), 1),
    ],
    [
      VEHICLE_FEATURES.OUTSIDE_TEMPERATURE,
      round(temperatureIn(unitOf(VEHICLE_FEATURES.OUTSIDE_TEMPERATURE), snapshot.outsideTempC), 1),
    ],
    [VEHICLE_FEATURES.LOCKED, binary(snapshot.locked)],
    [VEHICLE_FEATURES.SENTRY_MODE, binary(snapshot.sentry)],
    [
      VEHICLE_FEATURES.ODOMETER,
      round(distanceIn(unitOf(VEHICLE_FEATURES.ODOMETER), snapshot.odometerMiles)),
    ],
    [VEHICLE_FEATURES.AWAKE, binary(snapshot.online)],
  ];
  return states.filter(([, value]) => value !== null).map(([key, value]) => ({ key, value }));
}

// --- Commands ------------------------------------------------------------------

/**
 * Translate a Gladys command into a Teslemetry command, plus the snapshot
 * change it implies (applied once Tesla confirmed, so the dashboard does not
 * wait for the stream to echo it).
 * @returns {{ command: string, body?: object, optimistic: object }}
 */
export function vehicleCommand(featureKey, value, unit) {
  const on = Number(value) === 1;
  switch (featureKey) {
    case VEHICLE_FEATURES.CHARGING:
      return on
        ? { command: 'charge_start', optimistic: { chargingState: 'Starting' } }
        : { command: 'charge_stop', optimistic: { chargingState: 'Stopped', chargePowerKw: 0 } };
    case VEHICLE_FEATURES.CHARGE_LIMIT: {
      const percent = clamp(Math.round(Number(value)), CHARGE_LIMIT_MIN, CHARGE_LIMIT_MAX);
      return {
        command: 'set_charge_limit',
        body: { percent },
        optimistic: { chargeLimit: percent },
      };
    }
    case VEHICLE_FEATURES.CHARGE_CURRENT: {
      const amps = Math.max(1, Math.round(Number(value)));
      return {
        command: 'set_charging_amps',
        body: { charging_amps: amps },
        optimistic: { chargeCurrentRequest: amps },
      };
    }
    case VEHICLE_FEATURES.CLIMATE:
      return on
        ? { command: 'auto_conditioning_start', optimistic: { climateOn: true } }
        : { command: 'auto_conditioning_stop', optimistic: { climateOn: false } };
    case VEHICLE_FEATURES.TARGET_TEMPERATURE: {
      // Tesla takes °C, with half-degree steps.
      const celsius = clamp(
        Math.round(temperatureToCelsius(unit, Number(value)) * 2) / 2,
        CABIN_TEMP_MIN_C,
        CABIN_TEMP_MAX_C,
      );
      return {
        command: 'set_temps',
        body: { driver_temp: celsius, passenger_temp: celsius },
        optimistic: { targetTempC: celsius },
      };
    }
    case VEHICLE_FEATURES.LOCKED:
      return on
        ? { command: 'door_lock', optimistic: { locked: true } }
        : { command: 'door_unlock', optimistic: { locked: false } };
    case VEHICLE_FEATURES.SENTRY_MODE:
      return { command: 'set_sentry_mode', body: { on }, optimistic: { sentry: on } };
    default:
      return null;
  }
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) throw new Error('Not a number');
  return Math.min(max, Math.max(min, value));
}
