// -----------------------------------------------------------------------------
// Device type: TESLA ENERGY SITE (Powerwall, solar).
//
// One Gladys device per energy site, keyed on its `energy_site_id`. The
// features follow what the site has (`components`): a solar-only site has no
// battery features, a Powerwall without panels no solar ones.
//
// Sign conventions (Tesla `live_status`, kept for Gladys):
//   - `battery_power` > 0 when the battery DISCHARGES, < 0 when it charges.
//     Gladys' `battery-storage` category has no signed power type: it is split
//     into the charge and discharge features, both ≥ 0;
//   - `grid_power` > 0 when importing, < 0 when exporting: exactly the signed
//     `grid-sensor/power` of Gladys, published with symmetric bounds so a
//     gauge centers its needle on zero.
// The house consumption measured by the gateway goes to `energy-sensor`, as
// the Gladys taxonomy asks for an inverter's "load power".
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { t } from '../i18n.js';
import { round } from '../units.js';

export const ENERGY_SITE_DEVICE_TYPE = 'energy-site';

export const SITE_FEATURES = {
  SOLAR_POWER: 'solar-power',
  HOME_POWER: 'home-power',
  GRID_POWER: 'grid-power',
  BATTERY_CHARGE_POWER: 'battery-charge-power',
  BATTERY_DISCHARGE_POWER: 'battery-discharge-power',
  BATTERY_LEVEL: 'battery-level',
  GRID_CONNECTED: 'grid-connected',
  OPERATION_MODE: 'operation-mode',
  HOME_ENERGY: 'home-energy',
  SOLAR_ENERGY: 'solar-energy',
  GRID_IMPORT_ENERGY: 'grid-import-energy',
  GRID_EXPORT_ENERGY: 'grid-export-energy',
  BATTERY_CHARGE_ENERGY: 'battery-charge-energy',
  BATTERY_DISCHARGE_ENERGY: 'battery-discharge-energy',
};

// Index feature → the `energy_totals` field it accumulates (Wh per day).
export const INDEX_TOTALS = {
  [SITE_FEATURES.HOME_ENERGY]: 'total_home_usage',
  [SITE_FEATURES.SOLAR_ENERGY]: 'total_solar_generation',
  [SITE_FEATURES.GRID_IMPORT_ENERGY]: 'grid_energy_imported',
  [SITE_FEATURES.GRID_EXPORT_ENERGY]: 'total_grid_energy_exported',
  [SITE_FEATURES.BATTERY_CHARGE_ENERGY]: 'total_battery_charge',
  [SITE_FEATURES.BATTERY_DISCHARGE_ENERGY]: 'total_battery_discharge',
};

// Operation modes (`default_real_mode`), in the order the Tesla app lists them.
export const OPERATION_MODES = [
  { value: 'self_consumption', text: 'modeSelfConsumption' },
  { value: 'autonomous', text: 'modeAutonomous' },
  { value: 'backup', text: 'modeBackup' },
];

// Display bounds (W). Gladys never clamps a value to them; they place a gauge
// needle. The grid bounds are symmetric because the value is signed.
const POWER_MAX_W = 30000;
const GRID_BOUND_W = 25000;

export function energySiteIds(gladys, siteId) {
  return gladys.externalIds(ENERGY_SITE_DEVICE_TYPE, String(siteId));
}

/**
 * What a site has. `products` carries `components`; `site_info` refines it.
 * A site without the flag is assumed to have the component when its
 * resource type says so (a "battery" site has a Powerwall).
 */
export function siteComponents(product = {}, siteInfo = {}) {
  const components = { ...(product.components ?? {}), ...(siteInfo.components ?? {}) };
  const battery = components.battery ?? product.resource_type === 'battery';
  const solar = components.solar ?? product.resource_type === 'solar';
  return {
    battery: Boolean(battery),
    solar: Boolean(solar),
    grid: components.grid !== false,
    // The house load is only measured with a load meter (or a Powerwall
    // gateway, which carries one).
    load: Boolean(components.load_meter ?? battery),
  };
}

/** Human model name: "Powerwall 2", "Powerwall 3", "Solar"... */
export function siteModel(product = {}, siteInfo = {}) {
  const batteries = siteInfo.components?.batteries;
  const partName = Array.isArray(batteries) ? batteries.find((b) => b.part_name)?.part_name : null;
  if (partName) return partName;
  const components = siteComponents(product, siteInfo);
  if (components.battery) return 'Powerwall';
  if (components.solar) return 'Solar';
  return 'Energy site';
}

/** A site is worth a device when it measures something. */
export function isUsefulSite(product = {}) {
  const c = siteComponents(product);
  return c.battery || c.solar || c.load;
}

/**
 * The discovery payload of one energy site.
 * @param {object} gladys SDK instance
 * @param {object} product entry of /api/1/products (energy_site_id, site_name, components)
 * @param {{ language: string, siteInfo?: object }} options
 */
export function buildEnergySiteDevice(gladys, product, { language, siteInfo = {} }) {
  const ids = energySiteIds(gladys, product.energy_site_id);
  const components = siteComponents(product, siteInfo);
  const feature = (key, name, category, type, extra) => ({
    name: t(language, name),
    external_id: ids.feature(key),
    category,
    type,
    read_only: true,
    has_feedback: false,
    keep_history: true,
    min: 0,
    max: POWER_MAX_W,
    unit: UNITS.WATT,
    ...extra,
  });
  const index = (key, name, category, type) =>
    feature(key, name, category, type, { unit: UNITS.KILOWATT_HOUR, max: 1000000000 });

  const features = [];
  if (components.solar) {
    features.push(
      feature(
        SITE_FEATURES.SOLAR_POWER,
        'solarPower',
        CATEGORIES.ENERGY_PRODUCTION_SENSOR,
        TYPES.ENERGY_PRODUCTION_SENSOR.POWER,
      ),
    );
  }
  if (components.load) {
    features.push(
      feature(
        SITE_FEATURES.HOME_POWER,
        'homePower',
        CATEGORIES.ENERGY_SENSOR,
        TYPES.ENERGY_SENSOR.POWER,
      ),
    );
  }
  if (components.grid) {
    features.push(
      feature(
        SITE_FEATURES.GRID_POWER,
        'gridPower',
        CATEGORIES.GRID_SENSOR,
        TYPES.GRID_SENSOR.POWER,
        {
          min: -GRID_BOUND_W,
          max: GRID_BOUND_W,
        },
      ),
    );
  }
  if (components.battery) {
    features.push(
      feature(
        SITE_FEATURES.BATTERY_CHARGE_POWER,
        'batteryChargePower',
        CATEGORIES.BATTERY_STORAGE,
        TYPES.BATTERY_STORAGE.CHARGE_POWER,
      ),
      feature(
        SITE_FEATURES.BATTERY_DISCHARGE_POWER,
        'batteryDischargePower',
        CATEGORIES.BATTERY_STORAGE,
        TYPES.BATTERY_STORAGE.DISCHARGE_POWER,
      ),
      feature(
        SITE_FEATURES.BATTERY_LEVEL,
        'siteBatteryLevel',
        CATEGORIES.BATTERY_STORAGE,
        TYPES.BATTERY_STORAGE.BATTERY_LEVEL,
        { unit: UNITS.PERCENT, max: 100 },
      ),
      feature(SITE_FEATURES.GRID_CONNECTED, 'gridConnected', CATEGORIES.INPUT, TYPES.INPUT.BINARY, {
        unit: undefined,
        max: 1,
      }),
      {
        name: t(language, 'operationMode'),
        external_id: ids.feature(SITE_FEATURES.OPERATION_MODE),
        category: CATEGORIES.TEXT,
        type: TYPES.TEXT.SELECT,
        read_only: false,
        has_feedback: true,
        keep_history: false,
        min: 0,
        max: 0,
        supported_options: OPERATION_MODES.map((mode, i) => ({
          value: mode.value,
          label: t(language, mode.text),
          sort_order: i,
        })),
      },
    );
  }
  // Cumulative indexes. The home one is an `energy-sensor/index`: Gladys
  // derives the 30-minute consumption and its cost from it by itself.
  if (components.load) {
    features.push(
      index(
        SITE_FEATURES.HOME_ENERGY,
        'homeEnergy',
        CATEGORIES.ENERGY_SENSOR,
        TYPES.ENERGY_SENSOR.INDEX,
      ),
    );
  }
  if (components.solar) {
    features.push(
      index(
        SITE_FEATURES.SOLAR_ENERGY,
        'solarEnergy',
        CATEGORIES.ENERGY_PRODUCTION_SENSOR,
        TYPES.ENERGY_PRODUCTION_SENSOR.INDEX,
      ),
    );
  }
  if (components.grid) {
    features.push(
      index(
        SITE_FEATURES.GRID_IMPORT_ENERGY,
        'gridImportEnergy',
        CATEGORIES.GRID_SENSOR,
        TYPES.GRID_SENSOR.INPUT_INDEX,
      ),
      index(
        SITE_FEATURES.GRID_EXPORT_ENERGY,
        'gridExportEnergy',
        CATEGORIES.GRID_SENSOR,
        TYPES.GRID_SENSOR.OUTPUT_INDEX,
      ),
    );
  }
  if (components.battery) {
    features.push(
      index(
        SITE_FEATURES.BATTERY_CHARGE_ENERGY,
        'batteryChargeEnergy',
        CATEGORIES.BATTERY_STORAGE,
        TYPES.BATTERY_STORAGE.CHARGE_INDEX,
      ),
      index(
        SITE_FEATURES.BATTERY_DISCHARGE_ENERGY,
        'batteryDischargeEnergy',
        CATEGORIES.BATTERY_STORAGE,
        TYPES.BATTERY_STORAGE.DISCHARGE_INDEX,
      ),
    );
  }
  for (const f of features) {
    if (f.unit === undefined) delete f.unit;
  }
  return {
    name: product.site_name?.trim() || siteInfo.site_name?.trim() || t(language, 'energySite'),
    external_id: ids.device,
    model: siteModel(product, siteInfo),
    features,
  };
}

const num = (value) => {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

/** Snapshot fields from a `live_status` document (REST or stream). */
export function snapshotFromLiveStatus(live = {}) {
  const snapshot = {
    solarW: num(live.solar_power),
    batteryW: num(live.battery_power),
    gridW: num(live.grid_power),
    loadW: num(live.load_power),
    batteryLevel: num(live.percentage_charged),
  };
  if (typeof live.grid_status === 'string') {
    // "Active" = grid up; "Inactive" = outage or intentional islanding.
    snapshot.gridConnected = live.grid_status === 'Active';
  }
  if (typeof live.island_status === 'string') snapshot.islandStatus = live.island_status;
  if (typeof live.storm_mode_active === 'boolean')
    snapshot.stormModeActive = live.storm_mode_active;
  return Object.fromEntries(Object.entries(snapshot).filter(([, v]) => v !== undefined));
}

/** Snapshot fields from a `site_info` document (REST or stream). */
export function snapshotFromSiteInfo(info = {}) {
  const snapshot = {};
  const reserve = num(info.backup_reserve_percent);
  if (reserve !== undefined) snapshot.backupReserve = reserve;
  if (typeof info.default_real_mode === 'string') snapshot.operationMode = info.default_real_mode;
  return snapshot;
}

/**
 * Instant states of one site.
 * @returns {Array<{ key: string, value: number|{ text: string } }>}
 */
export function energySiteStates(snapshot, components) {
  const states = [];
  const push = (key, value) => {
    if (value !== null && value !== undefined) states.push({ key, value });
  };
  if (components.solar) push(SITE_FEATURES.SOLAR_POWER, round(Math.max(0, snapshot.solarW ?? NaN)));
  if (components.load) push(SITE_FEATURES.HOME_POWER, round(Math.max(0, snapshot.loadW ?? NaN)));
  if (components.grid) push(SITE_FEATURES.GRID_POWER, round(snapshot.gridW));
  if (components.battery) {
    const battery = snapshot.batteryW;
    if (Number.isFinite(battery)) {
      push(SITE_FEATURES.BATTERY_CHARGE_POWER, round(Math.max(0, -battery)));
      push(SITE_FEATURES.BATTERY_DISCHARGE_POWER, round(Math.max(0, battery)));
    }
    push(SITE_FEATURES.BATTERY_LEVEL, round(snapshot.batteryLevel, 1));
    if (typeof snapshot.gridConnected === 'boolean') {
      push(SITE_FEATURES.GRID_CONNECTED, snapshot.gridConnected ? 1 : 0);
    }
    if (OPERATION_MODES.some((mode) => mode.value === snapshot.operationMode)) {
      push(SITE_FEATURES.OPERATION_MODE, { text: snapshot.operationMode });
    }
  }
  return states;
}

/** Operation mode command (`text/select` value) → Teslemetry command. */
export function operationModeCommand(value) {
  if (!OPERATION_MODES.some((mode) => mode.value === value)) {
    throw new Error(`Unknown operation mode: ${value}`);
  }
  return { command: 'operation', body: { default_real_mode: value } };
}

/** Backup reserve command, 0–100 %. */
export function backupReserveCommand(percent) {
  const value = Math.round(Number(percent));
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error('The backup reserve is a percentage between 0 and 100');
  }
  return { command: 'backup', body: { backup_reserve_percent: value } };
}
