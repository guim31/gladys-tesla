import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SITE_FEATURES as F,
  backupReserveCommand,
  buildEnergySiteDevice,
  energySiteStates,
  isUsefulSite,
  operationModeCommand,
  siteComponents,
  siteModel,
  snapshotFromLiveStatus,
  snapshotFromSiteInfo,
} from '../src/devices/energySite.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { SITES, fixture } from './helpers/fakeTeslemetry.js';

const products = fixture('products').response;
const product = (id) => products.find((p) => p.energy_site_id === id);
const statesOf = (snapshot, components) =>
  Object.fromEntries(energySiteStates(snapshot, components).map(({ key, value }) => [key, value]));

test('components and model of each fixture site', () => {
  const pw2 = fixture('site_info_powerwall2').response;
  assert.deepEqual(siteComponents(product(SITES.POWERWALL_2), pw2), {
    battery: true,
    solar: true,
    grid: true,
    load: true,
  });
  assert.equal(siteModel(product(SITES.POWERWALL_2), pw2), 'Powerwall 2');
  const pw3 = fixture('site_info_powerwall3').response;
  assert.equal(siteComponents(product(SITES.POWERWALL_3), pw3).solar, false);
  assert.equal(siteModel(product(SITES.POWERWALL_3), pw3), 'Powerwall 3');
  assert.equal(siteComponents(product(SITES.SOLAR)).battery, false);
  assert.equal(isUsefulSite(product(SITES.EMPTY)), false, 'a site measuring nothing is skipped');
});

test('battery power is split by sign: positive = discharging', () => {
  const live = snapshotFromLiveStatus(fixture('live_status_powerwall2').response);
  const states = statesOf(live, siteComponents(product(SITES.POWERWALL_2)));
  assert.equal(states[F.BATTERY_DISCHARGE_POWER], 5060);
  assert.equal(states[F.BATTERY_CHARGE_POWER], 0);
  assert.equal(states[F.SOLAR_POWER], 1185);
  assert.equal(states[F.HOME_POWER], 6245);
  assert.equal(states[F.BATTERY_LEVEL], 95.5);
  assert.equal(states[F.GRID_CONNECTED], 1);
  // Powerwall 3 charging from the grid at night.
  const night = snapshotFromLiveStatus(fixture('live_status_powerwall3').response);
  const pw3 = statesOf(night, siteComponents(product(SITES.POWERWALL_3)));
  assert.equal(pw3[F.BATTERY_CHARGE_POWER], 2100);
  assert.equal(pw3[F.BATTERY_DISCHARGE_POWER], 0);
  assert.equal(pw3[F.GRID_POWER], 3450, 'importing: positive');
  assert.equal(pw3[F.SOLAR_POWER], undefined, 'no solar on this site');
});

test('grid power keeps its sign: exporting is negative', () => {
  const live = snapshotFromLiveStatus(fixture('live_status_solar').response);
  const states = statesOf(live, siteComponents(product(SITES.SOLAR)));
  assert.equal(states[F.GRID_POWER], -2170);
  assert.equal(states[F.BATTERY_LEVEL], undefined);
});

test('grid outage and operation mode', () => {
  const outage = snapshotFromLiveStatus({
    grid_status: 'Inactive',
    island_status: 'off_grid_unintentional',
  });
  assert.equal(outage.gridConnected, false);
  const info = snapshotFromSiteInfo(fixture('site_info_powerwall3').response);
  assert.deepEqual(info, { backupReserve: 30, operationMode: 'autonomous' });
  const states = statesOf({ ...outage, ...info }, siteComponents(product(SITES.POWERWALL_3)));
  assert.equal(states[F.GRID_CONNECTED], 0);
  assert.deepEqual(states[F.OPERATION_MODE], { text: 'autonomous' });
});

test('operation mode is a text select with the Tesla app modes', () => {
  const gladys = createFakeGladys();
  const device = buildEnergySiteDevice(gladys, product(SITES.POWERWALL_2), { language: 'fr' });
  const mode = device.features.find((f) => f.external_id.endsWith(`:${F.OPERATION_MODE}`));
  assert.equal(mode.category, 'text');
  assert.equal(mode.type, 'select');
  assert.deepEqual(
    mode.supported_options.map((o) => o.value),
    ['self_consumption', 'autonomous'],
  );
  assert.ok(mode.supported_options.every((o) => o.label));
  assert.deepEqual(operationModeCommand('autonomous'), {
    command: 'operation',
    body: { default_real_mode: 'autonomous' },
  });
  assert.throws(() => operationModeCommand('turbo'));
  // "Backup-only" is not offered: Tesla withdrew it on many sites.
  assert.throws(() => operationModeCommand('backup'));
  const backup = statesOf({ operationMode: 'backup' }, siteComponents(product(SITES.POWERWALL_2)));
  assert.equal(backup[F.OPERATION_MODE], undefined, 'no value outside the offered options');
});

test('backup reserve command', () => {
  assert.deepEqual(backupReserveCommand(100), {
    command: 'backup',
    body: { backup_reserve_percent: 100 },
  });
  assert.throws(() => backupReserveCommand(101));
  assert.throws(() => backupReserveCommand('abc'));
});

test('the home index is opt-in, an energy-sensor index (Gladys derives consumption and cost)', () => {
  const gladys = createFakeGladys();
  const byDefault = buildEnergySiteDevice(gladys, product(SITES.POWERWALL_2), { language: 'en' });
  assert.ok(
    byDefault.features.every((f) => !f.external_id.endsWith(`:${F.HOME_ENERGY}`)),
    'off by default: Gladys would attach it to the main meter and count the house twice',
  );
  assert.ok(byDefault.features.some((f) => f.external_id.endsWith(`:${F.SOLAR_ENERGY}`)));
  const device = buildEnergySiteDevice(gladys, product(SITES.POWERWALL_2), {
    language: 'en',
    homeEnergyIndex: true,
  });
  const home = device.features.find((f) => f.external_id.endsWith(`:${F.HOME_ENERGY}`));
  assert.equal(`${home.category}/${home.type}`, 'energy-sensor/index');
  assert.equal(home.unit, 'kilowatt-hour');
  // Never the derived 30-minute features: they are the core's.
  assert.ok(device.features.every((f) => !f.type.startsWith('thirty-minutes')));
});
