// -----------------------------------------------------------------------------
// The runtime (src/tesla.js) against fake Gladys and fake Teslemetry: what is
// read, what is published, what fires — and above all what is NOT done
// (waking a car, re-sending unchanged states, firing on a first value).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLogger, validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createTesla } from '../src/tesla.js';
import { normalizeConfig } from '../src/config.js';
import { createWidgets } from '../src/widgets.js';
import { createSceneActions } from '../src/scenes.js';
import { SseParser } from '../src/teslemetry/stream.js';
import { TeslemetryError } from '../src/teslemetry/client.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import {
  SITES,
  VINS,
  createFakeClient,
  createFakeStreamFactory,
  createMemoryStore,
} from './helpers/fakeTeslemetry.js';

const silent = createLogger({ level: 'silent' });
const MINUTE = 60 * 1000;

function streamEvents() {
  const raw = readFileSync(new URL('./fixtures/teslemetry/stream.sse', import.meta.url), 'utf8');
  const events = [];
  new SseParser((data) => events.push(JSON.parse(data))).push(raw);
  return events;
}

async function setup({ config = {}, store = createMemoryStore(), client, created = true } = {}) {
  const gladys = createFakeGladys();
  const fakeClient = client ?? createFakeClient();
  const streamFactory = createFakeStreamFactory();
  const clock = { t: Date.parse('2026-10-01T22:00:00Z') };
  const tesla = createTesla({
    gladys,
    store,
    logger: silent,
    clientFactory: () => fakeClient,
    streamFactory,
    now: () => clock.t,
  });
  await tesla.start(normalizeConfig({ access_token: 'test-token', ...config }));
  if (created) {
    gladys.createAll();
    for (const device of gladys.devices) await tesla.deviceCreated(device);
  }
  return { gladys, tesla, client: fakeClient, stream: streamFactory, clock, store };
}

const vehicleId = (vin) => `ext:tesla:vehicle:${vin}`;
const siteId = (id) => `ext:tesla:energy-site:${id}`;

test('discovery: every car and useful site, cold reads from the cache, no car woken', async () => {
  const { gladys, tesla, client } = await setup({ created: false });
  assert.equal(gladys.discovered.length, 7);
  assert.equal(client.count('vehicleData'), 4, 'one cold read per car (free cached data)');
  assert.equal(client.count('vehicleCommand'), 0, 'reading never sends a command (no wake_up)');
  assert.ok(!client.calls.some((c) => /wake/.test(JSON.stringify(c.args))));
  assert.equal(client.count('siteLiveStatus'), 3);
  assert.deepEqual(gladys.connectionStatuses.at(-1), { connected: true, message: undefined });
  // Nothing is published for devices the user has not created: Gladys would
  // drop the states (and count them against the 300/min budget).
  assert.equal(gladys.published.length, 0);
  await tesla.stop();
});

test('creating a device publishes all its states; nothing is re-sent unchanged', async () => {
  const { gladys, tesla, stream } = await setup();
  const modelY = vehicleId(VINS.MODEL_Y);
  assert.equal(gladys.last(`${modelY}:battery-level`), 54);
  assert.equal(gladys.last(`${modelY}:range`), 167, 'miles: the car displays miles');
  const before = gladys.published.length;
  // The stream's connect-time snapshot repeats what the cold read gave.
  await tesla.handleStreamEvent({ vin: VINS.MODEL_Y, state: 'online' });
  assert.equal(gladys.published.length, before);
  stream.emit({ vin: VINS.MODEL_Y, data: { BatteryLevel: 54.2 } });
  await tesla.drain();
  assert.equal(gladys.published.length, before, '54.2 % rounds to the published 54 %');
  stream.emit({ vin: VINS.MODEL_Y, data: { BatteryLevel: 61 } });
  await tesla.drain();
  assert.equal(gladys.published.length, before + 1);
  assert.equal(gladys.last(`${modelY}:battery-level`), 61);
  await tesla.stop();
});

test('a charge session from the stream fires its scene triggers once', async () => {
  const { gladys, tesla } = await setup();
  for (const event of streamEvents()) await tesla.handleStreamEvent(event);
  const modelY = vehicleId(VINS.MODEL_Y);
  assert.equal(gladys.last(`${modelY}:battery-level`), 80);
  assert.equal(gladys.last(`${modelY}:charging-state`), 4, 'complete: idle');
  assert.equal(gladys.last(`${modelY}:charge-power`), 0);
  assert.equal(gladys.last(`${modelY}:range`), 246);
  const complete = gladys.sceneEvents.filter((e) => e.key === 'charging_complete');
  assert.deepEqual(complete, [
    { key: 'charging_complete', data: { device: modelY, battery_level: 80 } },
  ]);
  // The cold read already said "Charging": the stream's Charging is no news.
  assert.equal(gladys.sceneEvents.filter((e) => e.key === 'charging_started').length, 0);
  await tesla.stop();
});

test('triggers never fire on a first value, nor again after a restart', async () => {
  const store = createMemoryStore();
  const first = await setup({ store });
  assert.equal(first.gladys.sceneEvents.length, 0, 'the cold read is a first value');
  await first.tesla.handleStreamEvent({
    vin: VINS.MODEL_3,
    data: { DetailedChargeState: 'DetailedChargeStateCharging' },
  });
  assert.deepEqual(
    first.gladys.sceneEvents.map((e) => e.key),
    ['charging_started'],
    'Stopped → Charging',
  );
  await first.tesla.stop();
  // Restart: the cold read (Stopped, from the fixture) is a real change since
  // the persisted Charging; the replayed Charging after it is one too. What
  // must not happen is a second "started" for the state already notified.
  const second = await setup({ store });
  await second.tesla.handleStreamEvent({
    vin: VINS.MODEL_3,
    data: { DetailedChargeState: 'DetailedChargeStateStopped' },
  });
  assert.deepEqual(
    second.gladys.sceneEvents.map((e) => e.key),
    [],
  );
  await second.tesla.stop();
});

test('a cached stream replay does not wake a sleeping car up in Gladys', async () => {
  const { gladys, tesla } = await setup();
  const modelS = vehicleId(VINS.MODEL_S);
  assert.equal(gladys.last(`${modelS}:awake`), 0);
  await tesla.handleStreamEvent({ vin: VINS.MODEL_S, isCache: true, data: { BatteryLevel: 70 } });
  assert.equal(gladys.last(`${modelS}:battery-level`), 70);
  assert.equal(gladys.last(`${modelS}:awake`), 0);
  await tesla.handleStreamEvent({ vin: VINS.MODEL_S, data: { BatteryLevel: 69 } });
  assert.equal(gladys.last(`${modelS}:awake`), 1, 'a live delta means the car is up');
  await tesla.stop();
});

test('plug and unplug', async () => {
  const { gladys, tesla } = await setup();
  await tesla.handleStreamEvent({
    vin: VINS.MODEL_3,
    data: { DetailedChargeState: 'DetailedChargeStateDisconnected' },
  });
  await tesla.handleStreamEvent({
    vin: VINS.MODEL_3,
    data: { DetailedChargeState: 'DetailedChargeStateStopped' },
  });
  assert.deepEqual(
    gladys.sceneEvents.map((e) => e.key),
    ['vehicle_unplugged', 'vehicle_plugged_in'],
  );
  assert.equal(gladys.last(`${vehicleId(VINS.MODEL_3)}:plugged`), 1);
  await tesla.stop();
});

test('grid outage and restore on a Powerwall', async () => {
  const { gladys, tesla } = await setup();
  const site = SITES.POWERWALL_2;
  await tesla.handleStreamEvent({
    site_id: site,
    live_status: {
      grid_status: 'Inactive',
      island_status: 'off_grid_unintentional',
      percentage_charged: 80.1,
    },
  });
  await tesla.handleStreamEvent({ site_id: String(site), live_status: { grid_status: 'Active' } });
  assert.deepEqual(gladys.sceneEvents, [
    { key: 'grid_outage', data: { device: siteId(site), intentional: false, battery_level: 80 } },
    { key: 'grid_restored', data: { device: siteId(site), intentional: false, battery_level: 80 } },
  ]);
  assert.equal(gladys.last(`${siteId(site)}:grid-connected`), 1);
  await tesla.stop();
});

test('daily energy totals become cumulative kWh indexes, persisted', async () => {
  const store = createMemoryStore();
  const config = { home_energy_index: true };
  const { gladys, tesla } = await setup({ store, config });
  const site = siteId(SITES.POWERWALL_2);
  for (const event of streamEvents()) await tesla.handleStreamEvent(event);
  assert.equal(gladys.last(`${site}:home-energy`), 19.92); // 18.9 + 1.02 kWh
  assert.equal(gladys.last(`${site}:grid-import-energy`), 2.59);
  assert.equal(gladys.last(`${site}:solar-energy`), 31.25);
  assert.equal(gladys.last(`${site}:battery-discharge-energy`), 7.01);
  assert.equal(store.data.sites[SITES.POWERWALL_2].indexes['home-energy'].published, 19.92);
  await tesla.stop();
  // After a restart the index goes on from where it was, it does not restart at 0.
  const again = await setup({ store, config });
  assert.equal(again.gladys.last(`${site}:home-energy`), 19.92);
  await again.tesla.handleStreamEvent({
    site_id: SITES.POWERWALL_2,
    date: '2026-10-02',
    totals: { total_home_usage: 2020 },
  });
  assert.equal(again.gladys.last(`${site}:home-energy`), 20.92);
  await again.tesla.stop();
});

test('the home index is not published unless enabled, but keeps counting', async () => {
  const store = createMemoryStore();
  const { gladys, tesla } = await setup({ store });
  const site = siteId(SITES.POWERWALL_2);
  for (const event of streamEvents()) await tesla.handleStreamEvent(event);
  assert.equal(gladys.last(`${site}:home-energy`), undefined);
  assert.equal(gladys.last(`${site}:grid-import-energy`), 2.59, 'the other indexes are published');
  // Turned on later: it starts from what was accumulated, not from zero.
  await tesla.reconfigure(normalizeConfig({ access_token: 'test-token', home_energy_index: true }));
  const home = gladys.discovered
    .find((d) => d.external_id === site)
    .features.find((f) => f.external_id === `${site}:home-energy`);
  assert.ok(home, 'offered in the Discovery tab once enabled');
  gladys.createAll();
  await tesla.deviceCreated(gladys.devices.find((d) => d.external_id === site));
  assert.equal(gladys.last(`${site}:home-energy`), 19.92);
  await tesla.stop();
});

test('a site in Backup-only mode shows it in the widget', async () => {
  const { tesla } = await setup();
  await tesla.handleStreamEvent({
    site_id: SITES.POWERWALL_3,
    site_info: { default_real_mode: 'backup', backup_reserve_percent: 100 },
  });
  const content = await createWidgets(tesla).energy_flow.get({
    settings: { device: siteId(SITES.POWERWALL_3) },
  });
  const rows = content.components.find((c) => c.type === 'status').items;
  assert.deepEqual(rows.find((r) => r.icon === 'sliders').value, {
    en: 'Backup-only',
    fr: 'Secours uniquement',
  });
  await tesla.stop();
});

test('a solar-only site gets no battery index', async () => {
  const { gladys, tesla } = await setup();
  const site = siteId(SITES.SOLAR);
  await tesla.handleStreamEvent({
    site_id: SITES.SOLAR,
    date: '2026-10-01',
    totals: { total_solar_generation: 21000, total_battery_charge: 0, total_home_usage: 9000 },
  });
  assert.equal(gladys.last(`${site}:solar-energy`), 21);
  assert.equal(gladys.last(`${site}:battery-charge-energy`), undefined);
  await tesla.stop();
});

test('fallback reads: only awake cars the stream is silent about', async () => {
  const { tesla, client, clock } = await setup({ config: { vehicle_refresh_minutes: '30' } });
  const reads = () => client.count('vehicleData');
  const start = reads();
  // Model Y streams; Model 3 is online but silent; S and X sleep.
  clock.t += 10 * MINUTE;
  await tesla.handleStreamEvent({ vin: VINS.MODEL_Y, data: { BatteryLevel: 60 } });
  clock.t += 25 * MINUTE;
  await tesla.handleStreamEvent({ vin: VINS.MODEL_Y, data: { BatteryLevel: 61 } });
  await tesla.tick();
  const readVins = client.calls
    .slice(-5)
    .filter((c) => c.name === 'vehicleData')
    .map((c) => c.args[0]);
  assert.deepEqual(readVins, [VINS.MODEL_3], 'only the silent awake car is read');
  assert.equal(reads(), start + 1);
  // Right after: nothing is due.
  await tesla.tick();
  assert.equal(reads(), start + 1);
  assert.equal(client.count('vehicleCommand'), 0, 'never woken');
  await tesla.stop();
});

test('fallback reads can be turned off', async () => {
  const { tesla, client, clock } = await setup({ config: { vehicle_refresh_minutes: '0' } });
  const start = client.count('vehicleData');
  clock.t += 120 * MINUTE;
  await tesla.tick();
  assert.equal(client.count('vehicleData'), start);
  await tesla.stop();
});

test('stream down: products and sites are read slowly instead', async () => {
  const { tesla, client, clock, stream } = await setup();
  stream.disconnect();
  const products = client.count('products');
  const lives = client.count('siteLiveStatus');
  clock.t += 5 * MINUTE;
  await tesla.tick();
  assert.equal(client.count('siteLiveStatus'), lives, 'not before 10 minutes');
  clock.t += 11 * MINUTE;
  await tesla.tick();
  assert.equal(client.count('products'), products + 1);
  assert.equal(client.count('siteLiveStatus'), lives + 3);
  await tesla.stop();
});

test('out of credits: the fallback reads pause for an hour', async () => {
  const { tesla, client, clock } = await setup();
  client.failWith(
    'vehicleData',
    new TeslemetryError('no credits', { kind: 'credits', status: 402 }),
  );
  clock.t += 31 * MINUTE;
  await tesla.tick();
  const after = client.count('vehicleData');
  clock.t += 31 * MINUTE;
  await tesla.tick();
  assert.equal(client.count('vehicleData'), after, 'paused');
  client.failWith('vehicleData', null);
  clock.t += 31 * MINUTE;
  await tesla.tick();
  assert.ok(client.count('vehicleData') > after, 'resumed after the pause');
  await tesla.stop();
});

test('commands: Fleet API call, then the state without waiting for the stream', async () => {
  const { gladys, tesla, client } = await setup();
  const modelY = vehicleId(VINS.MODEL_Y);
  await tesla.setValue({ external_id: modelY }, { external_id: `${modelY}:charge-limit` }, 90);
  assert.deepEqual(client.calls.at(-1), {
    name: 'vehicleCommand',
    args: [VINS.MODEL_Y, 'set_charge_limit', { percent: 90 }],
  });
  assert.equal(gladys.last(`${modelY}:charge-limit`), 90);
  // °F feature: Tesla wants °C.
  await tesla.setValue(
    { external_id: modelY },
    { external_id: `${modelY}:target-temperature` },
    72,
  );
  assert.deepEqual(client.calls.at(-1).args, [
    VINS.MODEL_Y,
    'set_temps',
    { driver_temp: 22, passenger_temp: 22 },
  ]);
  assert.equal(gladys.last(`${modelY}:target-temperature`), 71.6);
  await tesla.setValue({ external_id: modelY }, { external_id: `${modelY}:charging` }, 0);
  assert.equal(client.calls.at(-1).args[1], 'charge_stop');
  assert.equal(gladys.last(`${modelY}:charging`), 0);
  await assert.rejects(
    tesla.setValue(
      { external_id: modelY },
      { external_id: `${modelY}:odometer`, name: 'Odometer' },
      1,
    ),
    /read-only/,
  );
  const site = siteId(SITES.POWERWALL_2);
  await tesla.setValue(
    { external_id: site },
    { external_id: `${site}:operation-mode` },
    'autonomous',
  );
  assert.deepEqual(client.calls.at(-1).args, [
    SITES.POWERWALL_2,
    'operation',
    { default_real_mode: 'autonomous' },
  ]);
  assert.deepEqual(gladys.last(`${site}:operation-mode`), { text: 'autonomous' });
  await tesla.stop();
});

test('a command to a sleeping car is acknowledged before Gladys gives up', async () => {
  const client = createFakeClient();
  let release;
  client.vehicleCommand = (vin, name) => {
    client.calls.push({ name: 'vehicleCommand', args: [vin, name] });
    return new Promise((resolve) => {
      release = () => resolve({ result: true });
    });
  };
  const { gladys, tesla } = await setup({ client });
  const modelS = vehicleId(VINS.MODEL_S);
  const started = Date.now();
  await tesla.setValue({ external_id: modelS }, { external_id: `${modelS}:climate` }, 1, {
    deadlineMs: 20,
  });
  assert.ok(Date.now() - started < 1000, 'resolved at the deadline, not when the car woke');
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gladys.last(`${modelS}:climate`), 1, 'published once Tesla confirmed');
  assert.equal(gladys.last(`${modelS}:awake`), 1);
  await tesla.stop();
});

test('values follow the unit of the CREATED device', async () => {
  // Created in miles, then the user switches the integration to metric: until
  // they accept the update, Gladys still stores miles.
  const { gladys, tesla } = await setup({ config: { units: 'imperial' } });
  const modelX = vehicleId(VINS.MODEL_X);
  await tesla.reconfigure(normalizeConfig({ access_token: 'test-token', units: 'metric' }));
  const rangeFeature = gladys.discovered
    .find((d) => d.external_id === modelX)
    .features.find((f) => f.external_id === `${modelX}:range`);
  assert.equal(rangeFeature.unit, 'km', 'the discovery proposes km');
  await tesla.handleStreamEvent({ vin: VINS.MODEL_X, data: { RatedRange: 100 } });
  assert.equal(gladys.last(`${modelX}:range`), 100, 'published in the miles Gladys stores');
  await tesla.stop();
});

test('streaming fields are added to a car that streams, never replaced', async () => {
  const client = createFakeClient({ streaming: new Set([VINS.MODEL_3, VINS.MODEL_Y]) });
  const { tesla } = await setup({ client });
  const added = client.calls.filter((c) => c.name === 'addStreamingFields');
  assert.deepEqual(added.map((c) => c.args[0]).sort(), [VINS.MODEL_3, VINS.MODEL_Y].sort());
  // BatteryLevel is already streamed (at its own interval): left untouched.
  assert.ok(!('BatteryLevel' in added[0].args[1]));
  assert.ok('DetailedChargeState' in added[0].args[1]);
  await tesla.stop();
});

test('connection status: missing token, refused token', async () => {
  const gladys = createFakeGladys();
  const tesla = createTesla({
    gladys,
    store: createMemoryStore(),
    logger: silent,
    clientFactory: () => assert.fail('no client without a token'),
    streamFactory: createFakeStreamFactory(),
  });
  await tesla.start(normalizeConfig({}));
  assert.equal(gladys.connectionStatuses.at(-1).connected, false);
  assert.match(gladys.connectionStatuses.at(-1).message.en, /access token/);
  await tesla.stop();

  const client = createFakeClient();
  client.failWith('products', new TeslemetryError('401', { kind: 'auth', status: 401 }));
  const refused = await setup({ client, created: false });
  assert.equal(refused.gladys.connectionStatuses.at(-1).connected, false);
  assert.match(refused.gladys.connectionStatuses.at(-1).message.fr, /refusé/);
  await refused.tesla.stop();
});

test('the connection test summarizes the account', async () => {
  const { tesla } = await setup();
  const message = await tesla.testConnection();
  assert.match(message.en, /4 vehicle\(s\), 3 energy site\(s\)/);
  assert.match(message.fr, /Flux temps réel connecté/);
  await tesla.stop();
});

test('scene action: backup reserve', async () => {
  const { gladys, tesla, client } = await setup();
  const actions = createSceneActions(tesla);
  const outputs = await actions.set_backup_reserve({
    fields: { device: siteId(SITES.POWERWALL_3), percent: 100 },
  });
  assert.deepEqual(outputs, { backup_reserve: 100 });
  assert.deepEqual(client.calls.at(-1).args, [
    SITES.POWERWALL_3,
    'backup',
    { backup_reserve_percent: 100 },
  ]);
  await assert.rejects(
    actions.set_backup_reserve({ fields: { device: siteId(SITES.SOLAR), percent: 50 } }),
    /no Powerwall/,
  );
  await assert.rejects(
    actions.set_backup_reserve({ fields: { device: vehicleId(VINS.MODEL_3), percent: 50 } }),
    /energy site/,
  );
  assert.ok(gladys.widgetRefreshes.includes('energy_flow'));
  await tesla.stop();
});

test('widgets: valid content within the budget, bound to existing features', async () => {
  const { gladys, tesla, client } = await setup();
  const widgets = createWidgets(tesla);
  const featureIds = new Set(
    gladys.discovered.flatMap((d) => d.features.map((f) => f.external_id)),
  );
  const check = (content) => {
    assert.deepEqual(validateWidgetContent(content), [], JSON.stringify(content));
    for (const component of content.components) {
      for (const ref of [component.device_feature, ...(component.device_features ?? [])]) {
        if (ref) assert.ok(featureIds.has(ref), `${ref} is not a published feature`);
      }
    }
    return content;
  };
  for (const vin of Object.values(VINS)) {
    check(await widgets.vehicle.get({ settings: { device: vehicleId(vin) } }));
  }
  for (const id of [SITES.POWERWALL_2, SITES.POWERWALL_3, SITES.SOLAR]) {
    check(await widgets.energy_flow.get({ settings: { device: siteId(id) } }));
  }
  check(await widgets.vehicle.get({ settings: {} }));
  check(await widgets.vehicle.get({ settings: { device: siteId(SITES.SOLAR) } }));
  check(await widgets.energy_flow.get({ settings: { device: vehicleId(VINS.MODEL_3) } }));

  // Model Y is charging and locked: stop charging, unlock behind a confirmation.
  const modelY = await widgets.vehicle.get({ settings: { device: vehicleId(VINS.MODEL_Y) } });
  const actions = modelY.components.filter((c) => c.type === 'button').map((c) => c.action);
  assert.deepEqual(
    actions.map((a) => a.key),
    ['climate_on', 'charge_stop', 'unlock'],
  );
  assert.equal(actions[2].confirm, true);
  // Model S is unplugged: no charging button.
  const modelS = await widgets.vehicle.get({ settings: { device: vehicleId(VINS.MODEL_S) } });
  assert.ok(!modelS.components.some((c) => c.action?.key?.startsWith('charge')));

  const toast = await widgets.vehicle.action({
    actionKey: 'climate_on',
    settings: { device: vehicleId(VINS.MODEL_Y) },
  });
  assert.equal(toast.en, 'Climate starting');
  assert.deepEqual(client.calls.at(-1).args, [VINS.MODEL_Y, 'auto_conditioning_start', undefined]);
  await assert.rejects(
    widgets.vehicle.action({
      actionKey: 'self_destruct',
      settings: { device: vehicleId(VINS.MODEL_Y) },
    }),
  );
  await tesla.stop();
});

test('widgets are nudged when their computed rows change, at most once per 10 s', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { gladys, tesla, clock } = await setup();
  // Device creation nudged every widget; flush the trailing nudges.
  clock.t += 10 * 1000;
  t.mock.timers.tick(10 * 1000);
  gladys.widgetRefreshes.length = 0;

  clock.t += 60 * 1000;
  await tesla.handleStreamEvent({ vin: VINS.MODEL_3, data: { Locked: true } });
  assert.deepEqual(gladys.widgetRefreshes, ['vehicle'], 'computed row changed: nudged now');
  // A battery change is a live tile: no nudge.
  await tesla.handleStreamEvent({ vin: VINS.MODEL_3, data: { BatteryLevel: 12 } });
  assert.deepEqual(gladys.widgetRefreshes, ['vehicle']);
  // Two more changes within the core's 10 s window: one trailing nudge.
  await tesla.handleStreamEvent({ vin: VINS.MODEL_3, data: { Locked: false } });
  await tesla.handleStreamEvent({
    vin: VINS.MODEL_3,
    data: { SentryMode: 'SentryModeStateArmed' },
  });
  assert.deepEqual(gladys.widgetRefreshes, ['vehicle']);
  clock.t += 10 * 1000;
  t.mock.timers.tick(10 * 1000);
  assert.deepEqual(gladys.widgetRefreshes, ['vehicle', 'vehicle']);
  await tesla.stop();
});

// --- Wall Connector, moved to its own integration ----------------------------

const WALL_CONNECTOR_DEVICE = 'ext:tesla:wall-connector:TESTWC0000EU01';

test('a Wall Connector set up in 1.1.0: a clear notice, no crash, no charger read', async () => {
  const store = createMemoryStore({
    version: 1,
    vehicles: {},
    sites: {},
    wallConnectors: { TESTWC0000EU01: { host: '192.0.2.10', energyKwh: 386.204 } },
  });
  const { gladys, tesla, clock } = await setup({
    store,
    config: { wall_connectors: '192.0.2.10' },
  });
  const status = gladys.connectionStatuses.at(-1);
  assert.equal(status.connected, true);
  assert.match(status.message.en, /own integration, Tesla Wall Connector/);
  assert.match(status.message.fr, /propre intégration, Tesla Wall Connector/);
  assert.equal(store.data.wallConnectors, undefined, 'the charger memory is dropped');
  assert.ok(!gladys.discovered.some((d) => d.external_id === WALL_CONNECTOR_DEVICE));
  // The charger device Gladys already has is simply not ours any more.
  const device = { external_id: WALL_CONNECTOR_DEVICE };
  await tesla.deviceCreated(device);
  await tesla.poll(device);
  await assert.rejects(
    tesla.runCommand(device, { external_id: `${WALL_CONNECTOR_DEVICE}:power` }, 1),
    /No command/,
  );
  await tesla.stop();
  // After 30 days, the notice is gone.
  clock.t += 31 * 24 * 60 * 60 * 1000;
  await tesla.start(normalizeConfig({ access_token: 'test-token', wall_connectors: '192.0.2.10' }));
  assert.equal(gladys.connectionStatuses.at(-1).message, undefined);
  await tesla.stop();
});

test('a Wall Connector without a Teslemetry token: the notice comes first', async () => {
  const gladys = createFakeGladys();
  const tesla = createTesla({
    gladys,
    store: createMemoryStore(),
    logger: silent,
    clientFactory: () => createFakeClient(),
    streamFactory: createFakeStreamFactory(),
  });
  await tesla.start(normalizeConfig({ wall_connectors: '192.0.2.10' }));
  const status = gladys.connectionStatuses.at(-1);
  assert.equal(status.connected, false);
  assert.match(status.message.en, /^The Wall Connector now has its own integration.*access token/);
  await tesla.stop();
});

test('no Wall Connector ever set up: no notice', async () => {
  const { gladys, tesla } = await setup();
  assert.equal(gladys.connectionStatuses.at(-1).message, undefined);
  await tesla.stop();
});
