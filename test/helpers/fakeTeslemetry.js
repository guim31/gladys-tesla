// -----------------------------------------------------------------------------
// Fake Teslemetry client and stream, answering from test/fixtures/teslemetry/.
// Every call is recorded so the tests can assert what was (not) requested —
// above all that no car is ever woken.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { TeslemetryError } from '../../src/teslemetry/client.js';

const dir = new URL('../fixtures/teslemetry/', import.meta.url);

export function fixture(name) {
  return JSON.parse(readFileSync(new URL(`${name}.json`, dir), 'utf8'));
}

export const VINS = {
  MODEL_3: 'LRW3TEST0FAKE0001',
  MODEL_Y: '7SAYTEST0FAKE0002',
  MODEL_S: '5YJSTEST0FAKE0003',
  MODEL_X: '5YJXTEST0FAKE0004',
};
export const SITES = { POWERWALL_2: 200001, POWERWALL_3: 200002, SOLAR: 200003, EMPTY: 200004 };

const VEHICLE_DATA = {
  [VINS.MODEL_3]: 'vehicle_data_model3',
  [VINS.MODEL_Y]: 'vehicle_data_modely',
  [VINS.MODEL_S]: 'vehicle_data_models',
  [VINS.MODEL_X]: 'vehicle_data_modelx',
};
const SITE_FIXTURES = {
  [SITES.POWERWALL_2]: 'powerwall2',
  [SITES.POWERWALL_3]: 'powerwall3',
  [SITES.SOLAR]: 'solar',
};

/**
 * @param {object} [options]
 * @param {Set<string>} [options.streaming] VINs with a streaming configuration
 * @param {(name: string) => void} [options.fail] throw from a method by name
 */
export function createFakeClient({ products, streaming = new Set(Object.values(VINS)) } = {}) {
  const calls = [];
  const failures = new Map();
  const record = (name, ...args) => {
    calls.push({ name, args });
    const failure = failures.get(name);
    if (failure) throw failure;
  };
  const client = {
    calls,
    /** Make every next call to `name` throw `error` (null to stop). */
    failWith(name, error) {
      if (error) failures.set(name, error);
      else failures.delete(name);
    },
    count: (name) => calls.filter((c) => c.name === name).length,
    async metadata() {
      record('metadata');
      return { scopes: ['vehicle_device_data', 'energy_device_data'], region: 'NA' };
    },
    async products() {
      record('products');
      return structuredClone(products ?? fixture('products').response);
    },
    async vehicleData(vin) {
      record('vehicleData', vin);
      return fixture(VEHICLE_DATA[vin]).response;
    },
    async vehicleCommand(vin, name, body) {
      record('vehicleCommand', vin, name, body);
      return { result: true, reason: '' };
    },
    async streamingConfig(vin) {
      record('streamingConfig', vin);
      if (!streaming.has(vin)) {
        throw new TeslemetryError('not found', { kind: 'not_found', status: 404 });
      }
      return { fields: { BatteryLevel: { interval_seconds: 60 } } };
    },
    async addStreamingFields(vin, fields) {
      record('addStreamingFields', vin, fields);
      return { updated_vehicles: 1 };
    },
    async siteLiveStatus(id) {
      record('siteLiveStatus', id);
      return fixture(`live_status_${SITE_FIXTURES[id]}`).response;
    },
    async siteInfo(id) {
      record('siteInfo', id);
      return fixture(`site_info_${SITE_FIXTURES[id]}`).response;
    },
    async siteCommand(id, name, body) {
      record('siteCommand', id, name, body);
      return { code: 201, message: 'Updated' };
    },
  };
  return client;
}

/** A stream the test drives by hand: `stream.emit(event)`. */
export function createFakeStreamFactory() {
  const factory = (options) => {
    factory.options = options;
    factory.instance = {
      started: false,
      start() {
        this.started = true;
        options.onConnectionChange(true);
      },
      async stop() {
        this.started = false;
        options.onConnectionChange(false);
      },
    };
    return factory.instance;
  };
  factory.emit = (event) => factory.options.onEvent(event);
  factory.disconnect = () => factory.options.onConnectionChange(false);
  return factory;
}

/** In-memory store with the API of src/store.js. */
export function createMemoryStore(initial) {
  let data = structuredClone(initial ?? { version: 1, vehicles: {}, sites: {} });
  return {
    get data() {
      return data;
    },
    async load() {
      return data;
    },
    async flush() {},
    touch() {},
    dump: () => structuredClone(data),
    replace(next) {
      data = structuredClone(next);
    },
  };
}
