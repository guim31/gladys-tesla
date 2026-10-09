// -----------------------------------------------------------------------------
// Unit handling.
//
// The Tesla API always answers distances in miles and temperatures in °C,
// whatever the car's display settings. Gladys converts a feature's value to
// the viewer's preference on the dashboard, but scenes compare the raw value:
// the unit a feature is published in is therefore a user choice (the `units`
// setting), "auto" following the car's own display settings.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_UNITS } from '@gladysassistant/integration-sdk';
import { UNIT_SYSTEMS } from './config.js';

const KM_PER_MILE = 1.609344;

export const milesToKm = (miles) => miles * KM_PER_MILE;
export const celsiusToFahrenheit = (c) => (c * 9) / 5 + 32;
export const fahrenheitToCelsius = (f) => ((f - 32) * 5) / 9;

/** Round to `decimals` places, keeping null/undefined as null. */
export function round(value, decimals = 0) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Units a vehicle is published in.
 * @param {string} system 'auto' | 'metric' | 'imperial'
 * @param {{ distanceUnit?: string, temperatureUnit?: string }} snapshot car display settings
 */
export function vehicleUnits(system, snapshot = {}) {
  if (system === UNIT_SYSTEMS.IMPERIAL) {
    return { distance: DEVICE_FEATURE_UNITS.MILE, temperature: DEVICE_FEATURE_UNITS.FAHRENHEIT };
  }
  if (system === UNIT_SYSTEMS.METRIC) {
    return { distance: DEVICE_FEATURE_UNITS.KM, temperature: DEVICE_FEATURE_UNITS.CELSIUS };
  }
  // auto: the car's settings, metric until they are known. Distance and
  // temperature are independent (a UK car shows miles and °C).
  return {
    distance: snapshot.distanceUnit === 'mi' ? DEVICE_FEATURE_UNITS.MILE : DEVICE_FEATURE_UNITS.KM,
    temperature:
      snapshot.temperatureUnit === 'F'
        ? DEVICE_FEATURE_UNITS.FAHRENHEIT
        : DEVICE_FEATURE_UNITS.CELSIUS,
  };
}

/** A distance read in miles, in the published unit. */
export function distanceIn(unit, miles) {
  if (miles === null || miles === undefined) return null;
  return unit === DEVICE_FEATURE_UNITS.MILE ? miles : milesToKm(miles);
}

/** A temperature read in °C, in the published unit. */
export function temperatureIn(unit, celsius) {
  if (celsius === null || celsius === undefined) return null;
  return unit === DEVICE_FEATURE_UNITS.FAHRENHEIT ? celsiusToFahrenheit(celsius) : celsius;
}

/** A temperature typed by the user in the published unit, back to °C. */
export function temperatureToCelsius(unit, value) {
  return unit === DEVICE_FEATURE_UNITS.FAHRENHEIT ? fahrenheitToCelsius(value) : value;
}
