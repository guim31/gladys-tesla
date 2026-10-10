import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, normalizeConfig, vehicleRefreshMs } from '../src/config.js';
import { createStore } from '../src/store.js';
import { vehicleUnits } from '../src/units.js';

test('defaults when nothing is configured', () => {
  const expected = { ...DEFAULT_CONFIG, wall_connectors_moved: false };
  assert.deepEqual(normalizeConfig(), expected);
  assert.deepEqual(normalizeConfig(undefined), expected);
});

test('Wall Connector addresses left over from 1.1.0 are only noticed', () => {
  assert.equal(normalizeConfig({ wall_connectors: '192.0.2.10' }).wall_connectors_moved, true);
  assert.equal(normalizeConfig({ wall_connectors: '  ' }).wall_connectors_moved, false);
  assert.equal(normalizeConfig({ wall_connectors: '192.0.2.10' }).wall_connectors, undefined);
});

test('a pasted token is cleaned, unknown choices fall back', () => {
  const config = normalizeConfig({
    access_token: '  Bearer abc123\n',
    units: 'furlongs',
    language: 'de',
    vehicle_refresh_minutes: 7,
  });
  assert.equal(config.access_token, 'abc123');
  assert.equal(config.units, 'auto');
  assert.equal(config.language, 'en');
  assert.equal(config.vehicle_refresh_minutes, '30');
  assert.equal(vehicleRefreshMs(normalizeConfig({ vehicle_refresh_minutes: 60 })), 60 * 60 * 1000);
  // 15 minutes was withdrawn (it may keep a car awake): an old value becomes 30.
  assert.equal(normalizeConfig({ vehicle_refresh_minutes: '15' }).vehicle_refresh_minutes, '30');
  assert.equal(vehicleRefreshMs(normalizeConfig({ vehicle_refresh_minutes: '0' })), 0);
});

test('auto units follow the car display, distance and temperature apart', () => {
  // A UK car: miles and °C.
  assert.deepEqual(vehicleUnits('auto', { distanceUnit: 'mi', temperatureUnit: 'C' }), {
    distance: 'mile',
    temperature: 'celsius',
  });
  assert.deepEqual(vehicleUnits('auto', {}), { distance: 'km', temperature: 'celsius' });
  assert.deepEqual(vehicleUnits('imperial', { distanceUnit: 'km' }), {
    distance: 'mile',
    temperature: 'fahrenheit',
  });
});

test('the store survives a restart and ignores a corrupt file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gladys-tesla-'));
  try {
    const store = createStore({ dir });
    await store.load();
    store.data.sites[1] = { gridConnected: true };
    await store.flush();
    const again = createStore({ dir });
    assert.deepEqual((await again.load()).sites, { 1: { gridConnected: true } });
    // No temporary file left behind.
    await assert.rejects(readFile(join(dir, 'tesla-state.json.tmp')));
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'tesla-state.json'), '{not json');
    assert.deepEqual((await createStore({ dir }).load()).sites, {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
