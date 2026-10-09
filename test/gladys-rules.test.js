// -----------------------------------------------------------------------------
// Conformity with the Gladys core (mandatory test of this integration series).
//
// Every device the integration discovers from realistic fixtures — Model 3 /
// Y / S / X, Powerwall 2 with solar, Powerwall 3 without, a solar-only site —
// is checked against test/fixtures/gladys-feature-table.json, a table taken
// from the Gladys core code. Do not relax this test to make it pass: fix the
// integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createTesla } from '../src/tesla.js';
import { normalizeConfig } from '../src/config.js';
import { createLogger } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from './helpers/fakeGladys.js';
import {
  createFakeClient,
  createFakeStreamFactory,
  createMemoryStore,
} from './helpers/fakeTeslemetry.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);
const silent = createLogger({ level: 'silent' });

async function discover(configOverrides) {
  const gladys = createFakeGladys();
  const tesla = createTesla({
    gladys,
    store: createMemoryStore(),
    logger: silent,
    clientFactory: () => createFakeClient(),
    streamFactory: createFakeStreamFactory(),
  });
  await tesla.start(normalizeConfig({ access_token: 'test-token', ...configOverrides }));
  await tesla.stop();
  return gladys.discovered;
}

const CONFIGS = [
  { units: 'auto', language: 'en' },
  { units: 'metric', language: 'fr' },
  { units: 'imperial', language: 'en' },
];

for (const config of CONFIGS) {
  const label = `${config.units}/${config.language}`;
  const devices = await discover(config);

  test(`[${label}] every model of the fixtures is discovered`, () => {
    const models = devices.map((d) => d.model).sort();
    assert.deepEqual(models, [
      'Model 3',
      'Model S',
      'Model X',
      'Model Y',
      'Powerwall 2',
      'Powerwall 3',
      'Solar',
    ]);
  });

  for (const device of devices) {
    const name = `[${label}] ${device.model} "${device.name}"`;

    test(`${name}: category/type couples exist in Gladys, with labels and icon`, () => {
      for (const feature of device.features) {
        const pair = `${feature.category}/${feature.type}`;
        const entry = table.pairs[pair];
        assert.ok(entry, `${feature.external_id}: ${pair} is not a couple Gladys knows`);
        assert.ok(entry.label_en && entry.label_fr, `${pair} has no label in the Gladys front`);
        assert.ok(entry.icon, `${pair} has no icon in the Gladys front`);
      }
    });

    test(`${name}: should_poll if and only if poll_frequency, in milliseconds`, () => {
      const hasFrequency = device.poll_frequency !== undefined;
      assert.equal(device.should_poll === true, hasFrequency, 'should_poll ⇔ poll_frequency');
      if (hasFrequency) {
        assert.ok(
          table.poll_frequencies_ms.includes(device.poll_frequency),
          `poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
        );
      }
    });

    test(`${name}: min/max numbers, boolean flags, known units`, () => {
      for (const feature of device.features) {
        const id = feature.external_id;
        assert.equal(typeof feature.min, 'number', `${id}: min must be a number`);
        assert.equal(typeof feature.max, 'number', `${id}: max must be a number`);
        assert.ok(feature.min <= feature.max, `${id}: min > max`);
        assert.equal(typeof feature.read_only, 'boolean', `${id}: read_only`);
        assert.equal(typeof feature.has_feedback, 'boolean', `${id}: has_feedback`);
        if (feature.unit !== undefined) {
          assert.ok(table.units.includes(feature.unit), `${id}: unknown unit ${feature.unit}`);
          const allowed = table.units_by_category[feature.category];
          if (Array.isArray(allowed) && allowed.every((u) => typeof u === 'string')) {
            assert.ok(
              allowed.includes(feature.unit),
              `${id}: unit ${feature.unit} not offered for ${feature.category}`,
            );
          }
        }
      }
    });

    test(`${name}: unique feature external_ids and distinct names`, () => {
      const ids = device.features.map((f) => f.external_id);
      assert.equal(new Set(ids).size, ids.length, 'duplicate feature external_id');
      const names = device.features.map((f) => f.name);
      assert.equal(new Set(names).size, names.length, 'two features share a name');
      for (const id of ids) {
        assert.ok(
          id.startsWith(`${device.external_id}:`),
          `${id} is not under ${device.external_id}`,
        );
      }
    });

    test(`${name}: signed powers have symmetric bounds`, () => {
      // A gauge places its needle with (value - min) / (max - min): a signed
      // flow (import/export) needs bounds centered on zero. Temperatures are
      // signed too, but have no "zero flow" to center.
      const powers = device.features.filter(
        (f) => f.min < 0 && ['watt', 'kilowatt'].includes(f.unit),
      );
      for (const feature of powers) {
        assert.equal(feature.min, -feature.max, `${feature.external_id}: bounds not symmetric`);
      }
    });
  }
}
