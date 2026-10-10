// -----------------------------------------------------------------------------
// The integration's runtime: one object holding the account's cars and energy
// sites, fed by the Teslemetry stream and a few REST reads, publishing to
// Gladys only what changed.
//
// Data paths, cheapest first:
//   1. the stream (free, real time): car field deltas, car online/asleep,
//      Powerwall live status, site info, daily energy totals, credits;
//   2. REST reads at startup (cold read) and as a fallback — a car whose
//      stream is silent while it is online is read every
//      `vehicle_refresh_minutes` (Teslemetry's cache: free while younger than
//      ~20 minutes, up to 2 credits otherwise); while the stream is down, the
//      products list (online/asleep) every 15 minutes and the energy sites
//      every 10 minutes.
// A sleeping car is never read nor woken; only a user command wakes it.
//
// Wall Connectors are read on the home network every 15 s, with or without a
// Teslemetry token: an installation with only chargers configured publishes
// only them.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { vehicleRefreshMs, wallConnectorHosts } from './config.js';
import { ERROR_KINDS, createTeslemetryClient } from './teslemetry/client.js';
import { createTeslemetryStream } from './teslemetry/stream.js';
import {
  STREAMING_FIELDS,
  VEHICLE_FEATURES,
  buildVehicleDevice,
  isPlugged,
  snapshotFromStreamData,
  snapshotFromVehicleData,
  vehicleCommand,
  vehicleIds,
  vehicleStates,
} from './devices/vehicle.js';
import {
  INDEX_TOTALS,
  SITE_FEATURES,
  backupReserveCommand,
  buildEnergySiteDevice,
  energySiteIds,
  energySiteStates,
  isUsefulSite,
  operationModeCommand,
  siteComponents,
  snapshotFromLiveStatus,
  snapshotFromSiteInfo,
} from './devices/energySite.js';
import {
  EVSE_STATES,
  buildWallConnectorDevice,
  sessionState,
  wallConnectorIds,
  wallConnectorStates,
  wallConnectorTemperatureUnit,
} from './devices/wallConnector.js';
import { createWallConnectorClient } from './wallConnector/client.js';
import { createIndexState, currentIndex, recordDailyTotal } from './energyIndex.js';
import { siteTransitions, vehicleTransitions, wallConnectorTransitions } from './triggers.js';
import { vehicleUnits } from './units.js';

const MINUTE = 60 * 1000;
const PRODUCTS_FALLBACK_MS = 15 * MINUTE;
const SITE_FALLBACK_MS = 10 * MINUTE;
const SITE_INFO_FALLBACK_MS = 60 * MINUTE;
const CREDITS_BACKOFF_MS = 60 * MINUTE;
const MAX_STATES_PER_REQUEST = 100;
const WIDGET_NUDGE_MIN_INTERVAL_MS = 10 * 1000;
// Wall Connector: vitals every 15 s, lifetime counters every minute, and
// "unreachable" only after 3 missed reads in a row (a slow answer is common).
export const WALL_CONNECTOR_POLL_MS = 15 * 1000;
const WALL_CONNECTOR_LIFETIME_MS = MINUTE;
const WALL_CONNECTOR_MAX_FAILURES = 3;

// Widget keys (manifest `widgets`), nudged when their computed rows change.
export const WIDGET_KEYS = {
  VEHICLE: 'vehicle',
  ENERGY_FLOW: 'energy_flow',
  WALL_CONNECTOR: 'wall_connector',
};

// Snapshot fields shown by the widgets outside of device-bound tiles.
const VEHICLE_WIDGET_FIELDS = [
  'chargingState',
  'climateOn',
  'locked',
  'sentry',
  'online',
  'chargeLimit',
];
const SITE_WIDGET_FIELDS = [
  'gridConnected',
  'islandStatus',
  'operationMode',
  'backupReserve',
  'stormModeActive',
];
// Snapshot fields the device structure depends on.
const VEHICLE_STRUCTURE_FIELDS = ['distanceUnit', 'temperatureUnit'];

export const STATUS_MESSAGES = {
  noToken: {
    en: 'Enter your Teslemetry access token, or the address of a Wall Connector, to connect.',
    fr: "Saisissez votre jeton d'accès Teslemetry, ou l'adresse d'une Wall Connector, pour vous connecter.",
  },
  wallConnectorsOnly: {
    en: 'No Teslemetry token: only the Wall Connectors are used.',
    fr: 'Pas de jeton Teslemetry : seules les Wall Connector sont utilisées.',
  },
  wallConnectorsUnreachable: {
    en: 'No Wall Connector answers on the home network: check the addresses.',
    fr: 'Aucune Wall Connector ne répond sur le réseau local : vérifiez les adresses.',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'Teslemetry refused the access token: check it in the configuration.',
    fr: "Teslemetry a refusé le jeton d'accès : vérifiez-le dans la configuration.",
  },
  [ERROR_KINDS.SUBSCRIPTION]: {
    en: 'Teslemetry answers that a subscription is required for this account.',
    fr: 'Teslemetry indique qu’un abonnement est nécessaire pour ce compte.',
  },
  [ERROR_KINDS.FORBIDDEN]: {
    en: 'The Teslemetry token lacks a permission (scope): create it with vehicle and energy access.',
    fr: 'Il manque une autorisation au jeton Teslemetry : créez-le avec les accès véhicule et énergie.',
  },
  unreachable: {
    en: 'Teslemetry is unreachable for now, retrying.',
    fr: 'Teslemetry est injoignable pour le moment, nouvel essai en cours.',
  },
};

export function createTesla({
  gladys,
  store,
  logger = createLogger({ name: 'tesla' }),
  clientFactory = createTeslemetryClient,
  streamFactory = createTeslemetryStream,
  wallClientFactory = createWallConnectorClient,
  now = Date.now,
}) {
  let config = null;
  let client = null;
  let stream = null;
  let ticker = null;
  let streamConnected = false;
  let lastProductsAt = 0;
  let publishedDevicesJson = null;
  let credits = null;
  const vehicles = new Map(); // vin → { product, snapshot, lastStreamAt, lastReadAt, backoffUntil }
  const sites = new Map(); // id → { product, siteInfo, snapshot, lastLiveAt, lastInfoAt }
  const published = new Map(); // feature external_id → serialized value
  const nudges = new Map(); // widget key → { at, timer }
  const streamingChecked = new Set();
  // host → { host, client, serial, version, vitals, energyKwh, reachable, failures, lastLifetimeAt }
  const wallConnectors = new Map();
  let wallTimer = null;

  // --- Helpers ---------------------------------------------------------------

  const persisted = () => store.data;
  const persistedWallConnectors = () => (store.data.wallConnectors ??= {});

  function createdDevice(externalId) {
    return (gladys.devices ?? []).find((device) => device.external_id === externalId);
  }

  // Unit of a feature: the created device's (what Gladys stores the values
  // in), else the one the next discovery would publish.
  function unitResolver(deviceExternalId, built) {
    const created = createdDevice(deviceExternalId);
    return (key) => {
      const externalId = `${deviceExternalId}:${key}`;
      const feature =
        created?.features?.find((f) => f.external_id === externalId) ??
        built.features.find((f) => f.external_id === externalId);
      return feature?.unit;
    };
  }

  function vehicleDevice(vehicle) {
    return buildVehicleDevice(gladys, vehicle.product, {
      language: config.language,
      units: vehicleUnits(config.units, vehicle.snapshot),
    });
  }

  function siteDevice(site) {
    return buildEnergySiteDevice(gladys, site.product, {
      language: config.language,
      siteInfo: site.siteInfo,
      homeEnergyIndex: config.home_energy_index,
    });
  }

  function wallConnectorDevice(wc) {
    const several = [...wallConnectors.values()].filter((w) => w.serial).length > 1;
    return buildWallConnectorDevice(gladys, wc.version ?? { serial_number: wc.serial }, {
      language: config.language,
      temperatureUnit: wallConnectorTemperatureUnit(config.units, wc.vitals),
      // Several chargers: tell them apart by the end of their serial number.
      name: several ? `Tesla Wall Connector ${String(wc.serial).slice(-4)}` : undefined,
    });
  }

  function findWallConnector(deviceExternalId) {
    for (const wc of wallConnectors.values()) {
      if (wc.serial && wallConnectorIds(gladys, wc.serial).device === deviceExternalId) return wc;
    }
    return null;
  }

  function findVehicle(deviceExternalId) {
    for (const vehicle of vehicles.values()) {
      if (vehicleIds(gladys, vehicle.product.vin).device === deviceExternalId) return vehicle;
    }
    return null;
  }

  function findSite(deviceExternalId) {
    for (const site of sites.values()) {
      if (energySiteIds(gladys, site.product.energy_site_id).device === deviceExternalId)
        return site;
    }
    return null;
  }

  async function setStatus(connected, message) {
    try {
      await gladys.setConnectionStatus(connected, message);
    } catch (err) {
      logger.warn(`Could not report the connection status: ${err.message}`);
    }
  }

  async function reportError(err, context) {
    if (err.kind === ERROR_KINDS.AUTH || err.kind === ERROR_KINDS.SUBSCRIPTION) {
      logger.error(`${context}: ${err.message}`);
      await setStatus(false, STATUS_MESSAGES[err.kind]);
    } else if (err.kind === ERROR_KINDS.FORBIDDEN) {
      logger.error(`${context}: ${err.message}`);
    } else {
      logger.warn(`${context}: ${err.message}`);
    }
  }

  // --- Publishing ------------------------------------------------------------

  /**
   * Publish the states whose value changed since the last accepted
   * publication. States of devices the user has not created yet are kept for
   * later: Gladys would drop them (they are re-sent by onDeviceCreated).
   */
  async function publishChanged(deviceExternalId, states, { force = false } = {}) {
    const devicesKnown = Array.isArray(gladys.devices);
    if (devicesKnown && !createdDevice(deviceExternalId)) return 0;
    const changed = [];
    for (const { key, value } of states) {
      const externalId = `${deviceExternalId}:${key}`;
      const serialized = JSON.stringify(value);
      if (!force && published.get(externalId) === serialized) continue;
      changed.push({ externalId, serialized, value });
    }
    for (let i = 0; i < changed.length; i += MAX_STATES_PER_REQUEST) {
      const batch = changed.slice(i, i + MAX_STATES_PER_REQUEST);
      try {
        await gladys.publishStates(
          batch.map(({ externalId, value }) =>
            typeof value === 'object'
              ? { device_feature_external_id: externalId, text: value.text }
              : { device_feature_external_id: externalId, state: value },
          ),
        );
        for (const { externalId, serialized } of batch) published.set(externalId, serialized);
      } catch (err) {
        // Not remembered: the next change (or reconnection) sends it again.
        logger.warn(`Publishing ${batch.length} state(s) failed: ${err.message}`);
      }
    }
    return changed.length;
  }

  async function publishVehicle(vehicle, options) {
    const built = vehicleDevice(vehicle);
    const states = vehicleStates(vehicle.snapshot, unitResolver(built.external_id, built));
    return publishChanged(built.external_id, states, options);
  }

  function siteIndexStates(site) {
    const indexes = persisted().sites[site.product.energy_site_id]?.indexes ?? {};
    return Object.keys(INDEX_TOTALS)
      .map((key) => ({ key, value: currentIndex(indexes[key]) }))
      .filter(({ value }) => value !== null);
  }

  async function publishSite(site, options) {
    const ids = energySiteIds(gladys, site.product.energy_site_id);
    const components = siteComponents(site.product, site.siteInfo);
    const built = siteDevice(site);
    const present = new Set(built.features.map((f) => f.external_id));
    const states = [
      ...energySiteStates(site.snapshot, components),
      ...siteIndexStates(site),
    ].filter(({ key }) => present.has(ids.feature(key)));
    return publishChanged(ids.device, states, options);
  }

  async function publishWallConnector(wc, options) {
    if (!wc.serial) return 0;
    const built = wallConnectorDevice(wc);
    const states = wallConnectorStates(wc, {
      language: config.language,
      temperatureUnit: unitResolver(built.external_id, built)('handle-temperature'),
    });
    return publishChanged(built.external_id, states, options);
  }

  async function publishWallConnectorTransports() {
    const entries = [...wallConnectors.values()]
      .filter((wc) => wc.serial)
      .map((wc) => ({
        external_id: wallConnectorIds(gladys, wc.serial).device,
        transport: wc.reachable === false ? DEVICE_TRANSPORTS.UNREACHABLE : DEVICE_TRANSPORTS.LOCAL,
      }));
    if (entries.length === 0) return;
    try {
      await gladys.publishTransports(entries);
    } catch (err) {
      logger.warn(`Publishing the Wall Connector transports failed: ${err.message}`);
    }
  }

  async function publishAll(options) {
    for (const vehicle of vehicles.values()) await publishVehicle(vehicle, options);
    for (const site of sites.values()) await publishSite(site, options);
    for (const wc of wallConnectors.values()) await publishWallConnector(wc, options);
  }

  function buildDevices() {
    return [
      ...[...vehicles.values()].map(vehicleDevice),
      ...[...sites.values()].map(siteDevice),
      ...[...wallConnectors.values()].filter((wc) => wc.serial).map(wallConnectorDevice),
    ];
  }

  async function publishDevices({ force = false } = {}) {
    const devices = buildDevices();
    const json = JSON.stringify(devices);
    if (!force && json === publishedDevicesJson) return;
    await gladys.publishDiscoveredDevices(devices);
    publishedDevicesJson = json;
  }

  function nudgeWidget(key) {
    const entry = nudges.get(key) ?? { at: 0, timer: null };
    nudges.set(key, entry);
    if (entry.timer) return;
    const wait = entry.at + WIDGET_NUDGE_MIN_INTERVAL_MS - now();
    const fire = () => {
      entry.timer = null;
      entry.at = now();
      try {
        gladys.requestWidgetRefresh(key);
      } catch (err) {
        logger.debug(`Widget nudge skipped: ${err.message}`);
      }
    };
    if (wait <= 0) fire();
    else {
      // Trailing nudge: the last change inside the core's 10 s window still lands.
      entry.timer = setTimeout(fire, wait);
      entry.timer.unref?.();
    }
  }

  function refreshAllWidgets() {
    for (const key of Object.values(WIDGET_KEYS)) nudgeWidget(key);
  }

  async function fireTriggers(keys, data) {
    for (const key of keys) {
      try {
        await gladys.publishSceneEvent(key, data);
        logger.info(`Scene trigger ${key} fired for ${data.device}`);
      } catch (err) {
        logger.warn(`Scene trigger ${key} failed: ${err.message}`);
      }
    }
  }

  // --- Snapshots -------------------------------------------------------------

  async function applyVehicle(vehicle, changes) {
    const previous = vehicle.snapshot;
    const next = { ...previous, ...changes };
    vehicle.snapshot = next;
    const changed = (fields) => fields.some((f) => previous[f] !== next[f]);
    const deviceExternalId = vehicleIds(gladys, vehicle.product.vin).device;

    // Trigger memory survives restarts.
    const memory = persisted().vehicles[vehicle.product.vin] ?? {};
    const transitions = vehicleTransitions({ chargingState: memory.chargingState }, next);
    if (next.chargingState && next.chargingState !== memory.chargingState) {
      persisted().vehicles[vehicle.product.vin] = { ...memory, chargingState: next.chargingState };
      store.touch();
    }

    if (changed(VEHICLE_STRUCTURE_FIELDS))
      await publishDevices().catch((err) => logger.warn(err.message));
    await publishVehicle(vehicle);
    if (transitions.length) {
      await fireTriggers(transitions, {
        device: deviceExternalId,
        battery_level: Number.isFinite(next.batteryLevel) ? Math.round(next.batteryLevel) : null,
      });
    }
    if (changed(VEHICLE_WIDGET_FIELDS)) nudgeWidget(WIDGET_KEYS.VEHICLE);
  }

  async function applySite(site, changes) {
    const previous = site.snapshot;
    const next = { ...previous, ...changes };
    site.snapshot = next;
    const id = site.product.energy_site_id;
    const memory = persisted().sites[id] ?? {};
    const transitions = siteTransitions({ gridConnected: memory.gridConnected }, next);
    if (typeof next.gridConnected === 'boolean' && next.gridConnected !== memory.gridConnected) {
      persisted().sites[id] = { ...memory, gridConnected: next.gridConnected };
      store.touch();
    }
    await publishSite(site);
    if (transitions.length) {
      await fireTriggers(transitions, {
        device: energySiteIds(gladys, id).device,
        intentional: next.islandStatus === 'off_grid_intentional',
        battery_level: Number.isFinite(next.batteryLevel) ? Math.round(next.batteryLevel) : null,
      });
    }
    if (SITE_WIDGET_FIELDS.some((f) => previous[f] !== next[f]))
      nudgeWidget(WIDGET_KEYS.ENERGY_FLOW);
  }

  async function applyEnergyTotals(site, date, totals) {
    const id = site.product.energy_site_id;
    const memory = persisted().sites[id] ?? {};
    const indexes = { ...(memory.indexes ?? {}) };
    const components = siteComponents(site.product, site.siteInfo);
    const states = [];
    for (const [key, field] of Object.entries(INDEX_TOTALS)) {
      const value = Number(totals?.[field]);
      if (!Number.isFinite(value)) continue;
      if (key === SITE_FEATURES.SOLAR_ENERGY && !components.solar) continue;
      if (
        (key === SITE_FEATURES.BATTERY_CHARGE_ENERGY ||
          key === SITE_FEATURES.BATTERY_DISCHARGE_ENERGY) &&
        !components.battery
      ) {
        continue;
      }
      indexes[key] = indexes[key] ?? createIndexState();
      const index = recordDailyTotal(indexes[key], date, value);
      if (index !== null) states.push({ key, value: index });
    }
    persisted().sites[id] = { ...memory, indexes };
    store.touch();
    if (states.length) await publishSite(site);
  }

  // --- REST reads ------------------------------------------------------------

  async function readVehicle(vehicle) {
    vehicle.lastReadAt = now();
    try {
      const data = await client.vehicleData(vehicle.product.vin);
      await applyVehicle(vehicle, snapshotFromVehicleData(data));
    } catch (err) {
      if (err.kind === ERROR_KINDS.OFFLINE) {
        // Asleep with no cache: nothing to read, and certainly not a reason
        // to wake it.
        await applyVehicle(vehicle, { online: false });
        return;
      }
      if (err.kind === ERROR_KINDS.CREDITS) {
        vehicle.backoffUntil = now() + CREDITS_BACKOFF_MS;
        logger.warn('Teslemetry: out of credits, the fallback vehicle reads pause for an hour');
        return;
      }
      await reportError(err, `Reading ${vehicle.product.display_name ?? 'a vehicle'}`);
    }
  }

  async function readSite(site, { info = false } = {}) {
    const id = site.product.energy_site_id;
    try {
      if (info) {
        site.lastInfoAt = now();
        site.siteInfo = (await client.siteInfo(id)) ?? {};
        await applySite(site, snapshotFromSiteInfo(site.siteInfo));
      }
      site.lastLiveAt = now();
      await applySite(site, snapshotFromLiveStatus((await client.siteLiveStatus(id)) ?? {}));
    } catch (err) {
      await reportError(err, `Reading energy site ${site.product.site_name ?? id}`);
    }
  }

  /** Make sure each car streams the fields this integration reads. */
  async function ensureStreamingFields(vehicle) {
    const vin = vehicle.product.vin;
    if (streamingChecked.has(vin)) return;
    streamingChecked.add(vin);
    try {
      const current = await client.streamingConfig(vin);
      const fields = current?.fields ?? current?.response?.fields ?? {};
      const missing = STREAMING_FIELDS.filter((field) => !(field in fields));
      if (missing.length === 0) return;
      await client.addStreamingFields(vin, Object.fromEntries(missing.map((f) => [f, null])));
      logger.info(
        `Streaming enabled for ${missing.length} field(s) on ${vehicle.product.display_name ?? 'a vehicle'}`,
      );
    } catch (err) {
      if (err.kind === ERROR_KINDS.NOT_FOUND) {
        logger.info(
          `${vehicle.product.display_name ?? 'A vehicle'} has no streaming configuration at Teslemetry: ` +
            'cached data only (see the documentation)',
        );
      } else {
        logger.warn(`Could not check the streaming configuration: ${err.message}`);
      }
    }
  }

  /**
   * Read the account: products, then a cold read of each car (cache) and
   * site. New products appear in the Discovery screen.
   */
  async function discover({ coldRead = true } = {}) {
    let products;
    try {
      products = (await client.products()) ?? [];
      lastProductsAt = now();
    } catch (err) {
      await reportError(err, 'Listing the Tesla products');
      if (err.kind === ERROR_KINDS.NETWORK || err.kind === ERROR_KINDS.SERVER) {
        await setStatus(false, STATUS_MESSAGES.unreachable);
      }
      return false;
    }
    const seenVehicles = new Set();
    const seenSites = new Set();
    for (const product of products) {
      if (product.vin) {
        seenVehicles.add(product.vin);
        const existing = vehicles.get(product.vin);
        const vehicle = existing ?? {
          product,
          snapshot: {},
          lastStreamAt: 0,
          lastReadAt: 0,
          backoffUntil: 0,
        };
        vehicle.product = product;
        vehicles.set(product.vin, vehicle);
        const online = product.state ? product.state === 'online' : undefined;
        if (online !== undefined && vehicle.snapshot.online !== online) {
          await applyVehicle(vehicle, { online });
        }
        if (coldRead && !existing) await readVehicle(vehicle);
        await ensureStreamingFields(vehicle);
      } else if (product.energy_site_id !== undefined && isUsefulSite(product)) {
        const id = product.energy_site_id;
        seenSites.add(id);
        const existing = sites.get(id);
        const site = existing ?? {
          product,
          siteInfo: {},
          snapshot: {},
          lastLiveAt: 0,
          lastInfoAt: 0,
        };
        site.product = product;
        sites.set(id, site);
        if (coldRead && !existing) await readSite(site, { info: true });
      }
    }
    for (const vin of vehicles.keys()) if (!seenVehicles.has(vin)) vehicles.delete(vin);
    for (const id of sites.keys()) if (!seenSites.has(id)) sites.delete(id);
    await publishDevices();
    await setStatus(true);
    return true;
  }

  // --- Stream ----------------------------------------------------------------

  async function handleStreamEvent(event) {
    if (event.vin) {
      const vehicle = vehicles.get(event.vin);
      if (!vehicle) return; // a car added since the last discovery: next products refresh
      if (event.data && typeof event.data === 'object') {
        const merged = snapshotFromStreamData(event.data, vehicle.snapshot);
        if (event.isCache) {
          // The connect-time replay of the last known values: it says nothing
          // about the car being awake now.
          merged.online = vehicle.snapshot.online;
        } else {
          vehicle.lastStreamAt = now();
        }
        await applyVehicle(vehicle, merged);
      } else if (typeof event.state === 'string') {
        await applyVehicle(vehicle, { online: event.state === 'online' });
      }
      return;
    }
    if (event.site_id !== undefined) {
      const site = sites.get(Number(event.site_id)) ?? sites.get(String(event.site_id));
      if (!site) return;
      if (event.live_status) {
        site.lastLiveAt = now();
        await applySite(site, snapshotFromLiveStatus(event.live_status));
      } else if (event.site_info) {
        site.siteInfo = { ...site.siteInfo, ...event.site_info };
        site.lastInfoAt = now();
        await applySite(site, snapshotFromSiteInfo(event.site_info));
      } else if (event.totals && event.date) {
        await applyEnergyTotals(site, event.date, event.totals);
      }
      return;
    }
    if (event.credits && typeof event.credits === 'object') {
      credits = { ...event.credits, at: new Date(now()).toISOString() };
      logger.info(
        `Teslemetry credits: ${event.credits.name ?? event.credits.type ?? 'call'} cost ${
          event.credits.cost ?? '?'
        }, balance ${event.credits.balance ?? '?'}`,
      );
    }
  }

  // Stream events are applied one at a time, in arrival order.
  let streamQueue = Promise.resolve();
  function onStreamEvent(event) {
    streamQueue = streamQueue
      .then(() => handleStreamEvent(event))
      .catch((err) => logger.error('Stream event failed', err));
  }

  function startStream() {
    stream = streamFactory({
      token: config.access_token,
      onEvent: onStreamEvent,
      logger,
      onConnectionChange: (value) => {
        streamConnected = value;
        logger.info(value ? 'Teslemetry stream connected' : 'Teslemetry stream disconnected');
      },
    });
    stream.start();
  }

  // --- Wall Connectors (local) ----------------------------------------------

  /** The serial a host had last time (its device survives an offline restart). */
  function rememberedSerial(host) {
    const entry = Object.entries(persistedWallConnectors()).find(([, v]) => v.host === host);
    return entry ? entry[0] : null;
  }

  async function applyWallConnector(wc, { vitals, energyWh, reachable }) {
    const previous = { vitals: wc.vitals, reachable: wc.reachable };
    if (vitals) wc.vitals = vitals;
    if (reachable !== undefined) wc.reachable = reachable;
    const memory = persistedWallConnectors()[wc.serial] ?? {};
    let memoryChanged = memory.host !== wc.host;
    const next = { ...memory, host: wc.host };
    // A lower lifetime reading (a firmware glitch, a replaced charger) goes
    // through as is: Gladys's energy derivation treats it as a meter reset,
    // where holding the old value would freeze the index for good.
    if (Number.isFinite(energyWh) && energyWh > 0) {
      const kwh = Math.round(energyWh) / 1000;
      if (kwh !== memory.energyKwh) memoryChanged = true;
      next.energyKwh = kwh;
    }
    wc.energyKwh = next.energyKwh ?? null;
    // Scene triggers: the charger's own session transitions.
    let transitions = [];
    const session = vitals ? sessionState(vitals) : null;
    if (session) {
      transitions = wallConnectorTransitions(
        { sessionState: memory.chargingState },
        { sessionState: session },
      );
      if (session !== memory.chargingState) {
        next.chargingState = session;
        memoryChanged = true;
      }
    }
    if (memoryChanged) {
      persistedWallConnectors()[wc.serial] = next;
      store.touch();
    }
    await publishWallConnector(wc);
    if (transitions.length) {
      const sessionWh = Number(wc.vitals?.session_energy_wh);
      await fireTriggers(transitions, {
        device: wallConnectorIds(gladys, wc.serial).device,
        session_energy: Number.isFinite(sessionWh) ? Math.round(sessionWh / 10) / 100 : null,
      });
    }
    if (previous.reachable !== wc.reachable) {
      await publishWallConnectorTransports();
      // Without Teslemetry, the chargers are the whole connection status.
      if (!config.access_token) await reportWallConnectorStatus();
    }
    if (
      previous.reachable !== wc.reachable ||
      previous.vitals?.evse_state !== wc.vitals?.evse_state ||
      previous.vitals?.vehicle_connected !== wc.vitals?.vehicle_connected
    ) {
      nudgeWidget(WIDGET_KEYS.WALL_CONNECTOR);
    }
  }

  async function reportWallConnectorStatus() {
    const all = [...wallConnectors.values()];
    if (all.some((wc) => wc.reachable)) await setStatus(true);
    else await setStatus(false, STATUS_MESSAGES.wallConnectorsUnreachable);
  }

  /** One read of a charger: vitals, plus its identity and counters when due. */
  async function pollWallConnector(wc) {
    try {
      if (!wc.version) {
        wc.version = await wc.client.version();
        if (!wc.version?.serial_number) throw new Error('no serial number in /api/1/version');
        const known = wc.serial;
        wc.serial = String(wc.version.serial_number);
        if (known !== wc.serial) logger.info(`Wall Connector found at ${wc.host}`);
      }
      const vitals = await wc.client.vitals();
      let energyWh;
      if (now() - wc.lastLifetimeAt >= WALL_CONNECTOR_LIFETIME_MS) {
        energyWh = Number((await wc.client.lifetime())?.energy_wh);
        wc.lastLifetimeAt = now();
      }
      wc.failures = 0;
      const firstValues = !wc.vitals;
      await applyWallConnector(wc, { vitals, energyWh, reachable: true });
      // The structure follows the grid (°F on a 60 Hz supply in "auto"), and a
      // charger seen for the first time joins the Discovery screen.
      if (firstValues) await publishDevices().catch((err) => logger.warn(err.message));
      return true;
    } catch (err) {
      wc.failures += 1;
      if (wc.failures === 1 || wc.failures === WALL_CONNECTOR_MAX_FAILURES) {
        logger.warn(`Wall Connector ${wc.host}: ${err.message}`);
      }
      if (wc.serial && wc.failures >= WALL_CONNECTOR_MAX_FAILURES && wc.reachable !== false) {
        await applyWallConnector(wc, { reachable: false });
      }
      return false;
    }
  }

  // The chargers are read in parallel, so an unreachable one (10 s timeout)
  // never delays the others; a round still running makes the next one skip.
  let wallPolling = null;
  async function pollWallConnectors() {
    if (wallPolling) return wallPolling;
    wallPolling = Promise.all([...wallConnectors.values()].map(pollWallConnector)).finally(() => {
      wallPolling = null;
    });
    return wallPolling;
  }

  async function startWallConnectors() {
    for (const host of wallConnectorHosts(config)) {
      const serial = rememberedSerial(host);
      wallConnectors.set(host, {
        host,
        client: wallClientFactory({ host }),
        serial,
        version: null,
        vitals: null,
        energyKwh: serial ? (persistedWallConnectors()[serial]?.energyKwh ?? null) : null,
        reachable: undefined,
        failures: 0,
        lastLifetimeAt: 0,
      });
    }
    if (wallConnectors.size === 0) return;
    await pollWallConnectors();
    wallTimer = setInterval(
      () => pollWallConnectors().catch((err) => logger.error('Wall Connector read failed', err)),
      WALL_CONNECTOR_POLL_MS,
    );
    wallTimer.unref?.();
  }

  // --- Fallback ticker -------------------------------------------------------

  async function tick() {
    if (!client) return;
    const t = now();
    if (!streamConnected && t - lastProductsAt >= PRODUCTS_FALLBACK_MS) {
      await discover({ coldRead: true });
    }
    const refreshMs = vehicleRefreshMs(config);
    if (refreshMs > 0) {
      for (const vehicle of vehicles.values()) {
        if (vehicle.snapshot.online === false) continue; // asleep: nothing new, never wake it
        if (t < vehicle.backoffUntil) continue;
        const last = Math.max(vehicle.lastStreamAt, vehicle.lastReadAt);
        if (t - last >= refreshMs) await readVehicle(vehicle);
      }
    }
    if (!streamConnected) {
      for (const site of sites.values()) {
        if (t - site.lastLiveAt >= SITE_FALLBACK_MS) {
          await readSite(site, { info: t - site.lastInfoAt >= SITE_INFO_FALLBACK_MS });
        }
      }
    }
  }

  // --- Public API ------------------------------------------------------------

  async function stop() {
    clearInterval(ticker);
    ticker = null;
    clearInterval(wallTimer);
    wallTimer = null;
    await wallPolling;
    for (const entry of nudges.values()) clearTimeout(entry.timer);
    nudges.clear();
    await stream?.stop();
    stream = null;
    client = null;
    streamConnected = false;
    await streamQueue;
    await store.flush();
  }

  async function start(newConfig) {
    config = newConfig;
    if (!config.access_token) {
      await startWallConnectors();
      await publishDevices({ force: true });
      await publishWallConnectorTransports();
      if (wallConnectors.size === 0) await setStatus(false, STATUS_MESSAGES.noToken);
      else await reportWallConnectorStatus();
      return;
    }
    client = clientFactory({ token: config.access_token });
    // The cars and their stream never wait behind an unreachable charger
    // (10 s timeout): the chargers start alongside.
    const chargers = startWallConnectors().catch((err) =>
      logger.error('Wall Connector start failed', err),
    );
    const ok = await discover();
    startStream();
    ticker = setInterval(() => tick().catch((err) => logger.error('Refresh failed', err)), MINUTE);
    ticker.unref?.();
    await chargers;
    if (ok) logger.info(`Tesla: ${vehicles.size} vehicle(s), ${sites.size} energy site(s)`);
  }

  return {
    start,
    stop,
    tick,
    handleStreamEvent,
    /** Resolves once the queued stream events are applied. */
    drain: () => streamQueue,

    /** New configuration: restart when the token or the chargers changed, else rebuild. */
    async reconfigure(newConfig) {
      const tokenChanged = !config || newConfig.access_token !== config.access_token;
      const hostsChanged =
        !config || wallConnectorHosts(newConfig).join(',') !== wallConnectorHosts(config).join(',');
      if (tokenChanged || hostsChanged) {
        await stop();
        vehicles.clear();
        sites.clear();
        wallConnectors.clear();
        published.clear();
        streamingChecked.clear();
        publishedDevicesJson = null;
        await start(newConfig);
      } else {
        config = newConfig;
        await publishDevices();
        await publishAll();
      }
      refreshAllWidgets();
    },

    /** (Re)connected to Gladys: devices and every state again. */
    async resync() {
      published.clear();
      await publishDevices({ force: true });
      await publishAll({ force: true });
      await publishWallConnectorTransports();
      refreshAllWidgets();
    },

    async scan() {
      for (const wc of wallConnectors.values()) if (!wc.serial) await pollWallConnector(wc);
      if (client) await discover();
      else await publishDevices({ force: true });
    },

    /** Gladys created a device: its states were dropped until now. */
    async deviceCreated(device) {
      for (const key of [...published.keys()]) {
        if (key.startsWith(`${device.external_id}:`)) published.delete(key);
      }
      const vehicle = findVehicle(device.external_id);
      if (vehicle) await publishVehicle(vehicle, { force: true });
      const site = findSite(device.external_id);
      if (site) await publishSite(site, { force: true });
      const wc = findWallConnector(device.external_id);
      if (wc) {
        await publishWallConnector(wc, { force: true });
        await publishWallConnectorTransports();
      }
      refreshAllWidgets();
    },

    /** The core's scheduled poll (not used: no device asks for it). */
    async poll(device) {
      const vehicle = findVehicle(device.external_id);
      if (vehicle) await publishVehicle(vehicle, { force: true });
      const site = findSite(device.external_id);
      if (site) await publishSite(site, { force: true });
      const wc = findWallConnector(device.external_id);
      if (wc) await publishWallConnector(wc, { force: true });
    },

    /**
     * A user command from Gladys (dashboard, scene, widget). With
     * `deadlineMs`, resolve once that delay is over even if Tesla has not
     * answered yet: Gladys acks a device command within 5 s, and waking a
     * sleeping car before the command takes longer. The command goes on, its
     * outcome is published (or logged) when it lands.
     */
    async setValue(device, feature, value, { deadlineMs } = {}) {
      const run = this.runCommand(device, feature, value);
      if (!deadlineMs) return run;
      let timer;
      const late = new Promise((resolve) => {
        timer = setTimeout(() => resolve('late'), deadlineMs);
      });
      const outcome = await Promise.race([run.then(() => 'done'), late]).finally(() =>
        clearTimeout(timer),
      );
      if (outcome === 'late') {
        logger.info('The vehicle is slow to answer (probably waking up): command still running');
        run.catch((err) => logger.error(`Command failed: ${err.message}`));
      }
      return undefined;
    },

    async runCommand(device, feature, value) {
      if (findWallConnector(device.external_id)) {
        throw new Error('The Wall Connector local API is read-only');
      }
      if (!client) throw new Error('Teslemetry is not configured');
      const key = feature.external_id.slice(device.external_id.length + 1);
      const vehicle = findVehicle(device.external_id);
      if (vehicle) {
        const unit = unitResolver(device.external_id, vehicleDevice(vehicle))(key);
        const order = vehicleCommand(key, value, unit, vehicle.snapshot);
        if (!order) throw new Error(`${feature.name ?? key} is read-only`);
        logger.info(`Command ${order.command} → ${vehicle.product.display_name ?? 'vehicle'}`);
        await client.vehicleCommand(vehicle.product.vin, order.command, order.body);
        await applyVehicle(vehicle, { ...order.optimistic, online: true });
        return;
      }
      const site = findSite(device.external_id);
      if (site && key === SITE_FEATURES.OPERATION_MODE) {
        const order = operationModeCommand(String(value));
        logger.info(`Command ${order.command} → ${site.product.site_name ?? 'energy site'}`);
        await client.siteCommand(site.product.energy_site_id, order.command, order.body);
        await applySite(site, { operationMode: String(value) });
        return;
      }
      throw new Error(`No command for ${feature.external_id}`);
    },

    /** Vehicle command by name, for the widget buttons. */
    async vehicleOrder(deviceExternalId, featureKey, value) {
      const vehicle = findVehicle(deviceExternalId);
      if (!vehicle) throw new Error('Unknown vehicle');
      const feature = { external_id: `${deviceExternalId}:${featureKey}` };
      return this.setValue({ external_id: deviceExternalId }, feature, value);
    },

    async setBackupReserve(deviceExternalId, percent) {
      if (!client) throw new Error('Teslemetry is not configured');
      const site = findSite(deviceExternalId);
      if (!site) throw new Error('Choose a Tesla energy site');
      if (!siteComponents(site.product, site.siteInfo).battery) {
        throw new Error('This energy site has no Powerwall');
      }
      const order = backupReserveCommand(percent);
      await client.siteCommand(site.product.energy_site_id, order.command, order.body);
      await applySite(site, { backupReserve: order.body.backup_reserve_percent });
      return order.body.backup_reserve_percent;
    },

    /** Wall Connector test (manifest action): what each configured address answers. */
    async testWallConnectors() {
      const hosts = config ? wallConnectorHosts(config) : [];
      if (hosts.length === 0) {
        return {
          en: 'No Wall Connector address in the configuration.',
          fr: 'Aucune adresse de Wall Connector dans la configuration.',
        };
      }
      const lines = { en: [], fr: [] };
      for (const host of hosts) {
        const probe = wallClientFactory({ host });
        try {
          const version = await probe.version();
          const vitals = await probe.vitals();
          const state = EVSE_STATES[vitals?.evse_state];
          const serial = String(version?.serial_number ?? '?');
          lines.en.push(
            `${host}: Wall Connector …${serial.slice(-4)}, firmware ${version?.firmware_version ?? '?'}, ${state?.en ?? `state ${vitals?.evse_state}`}.`,
          );
          lines.fr.push(
            `${host} : Wall Connector …${serial.slice(-4)}, firmware ${version?.firmware_version ?? '?'}, ${state?.fr ?? `état ${vitals?.evse_state}`}.`,
          );
        } catch (err) {
          lines.en.push(`${host}: no answer (${err.message}).`);
          lines.fr.push(`${host} : pas de réponse (${err.message}).`);
        }
      }
      return { en: lines.en.join('\n'), fr: lines.fr.join('\n') };
    },

    /** Connection test (manifest action): a short human summary. */
    async testConnection() {
      if (!config?.access_token) {
        return wallConnectorHosts(config ?? {}).length
          ? STATUS_MESSAGES.wallConnectorsOnly
          : STATUS_MESSAGES.noToken;
      }
      const probe = client ?? clientFactory({ token: config.access_token });
      try {
        const products = (await probe.products()) ?? [];
        const cars = products.filter((p) => p.vin).length;
        const energy = products.filter(
          (p) => p.energy_site_id !== undefined && isUsefulSite(p),
        ).length;
        const live = streamConnected
          ? { en: 'connected', fr: 'connecté' }
          : { en: 'not connected', fr: 'non connecté' };
        const balance =
          credits?.balance !== undefined
            ? {
                en: ` Credit balance: ${credits.balance}.`,
                fr: ` Solde de crédits : ${credits.balance}.`,
              }
            : { en: '', fr: '' };
        return {
          en: `Connected to Teslemetry: ${cars} vehicle(s), ${energy} energy site(s). Real-time stream ${live.en}.${balance.en}`,
          fr: `Connecté à Teslemetry : ${cars} véhicule(s), ${energy} site(s) d'énergie. Flux temps réel ${live.fr}.${balance.fr}`,
        };
      } catch (err) {
        const message = STATUS_MESSAGES[err.kind] ?? STATUS_MESSAGES.unreachable;
        return message;
      }
    },

    // Read access for the widgets and the scene actions.
    vehicleView(deviceExternalId) {
      const vehicle = findVehicle(deviceExternalId);
      if (!vehicle) return null;
      return {
        device: vehicleDevice(vehicle),
        snapshot: vehicle.snapshot,
        plugged: isPlugged(vehicle.snapshot),
        product: vehicle.product,
      };
    },
    siteView(deviceExternalId) {
      const site = findSite(deviceExternalId);
      if (!site) return null;
      return {
        device: siteDevice(site),
        snapshot: site.snapshot,
        components: siteComponents(site.product, site.siteInfo),
        product: site.product,
      };
    },
    wallConnectorView(deviceExternalId) {
      const wc = findWallConnector(deviceExternalId);
      if (!wc) return null;
      return {
        device: wallConnectorDevice(wc),
        vitals: wc.vitals ?? {},
        reachable: wc.reachable !== false,
        energyKwh: wc.energyKwh,
      };
    },
    pollWallConnectors,
    get streamConnected() {
      return streamConnected;
    },
    get credits() {
      return credits;
    },
    // Exposed for the tests.
    _vehicles: vehicles,
    _sites: sites,
    _published: published,
  };
}

export { VEHICLE_FEATURES };
