// -----------------------------------------------------------------------------
// Every text that reaches a user exists in the four languages of the Gladys
// interface (English, French, German, Spanish), and no more.
//
// Covered: every multi-language object of the manifest, the text tables of the
// code (feature names, connection messages), and the texts the widgets and the
// connection test build at runtime, over every branch they can take. A source
// scan backs this up: an inline `{ en, fr }` object added later without its
// `de` and `es` fails here even if no test renders it.
//
// German says "du" and Spanish says "usted": a German text with the formal
// "Sie" or "Ihr" (capitalized) is refused.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { TEXTS } from '../src/i18n.js';
import { STATUS_MESSAGES, createTesla } from '../src/tesla.js';
import { createWidgets } from '../src/widgets.js';
import { SITE_FEATURES } from '../src/devices/energySite.js';
import { LANGUAGES, normalizeConfig } from '../src/config.js';
import { TeslemetryError } from '../src/teslemetry/client.js';
import { createLogger } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from './helpers/fakeGladys.js';
import {
  createFakeClient,
  createFakeStreamFactory,
  createMemoryStore,
} from './helpers/fakeTeslemetry.js';

const LANGS = ['en', 'fr', 'de', 'es'];
const FORMAL_GERMAN = /\b(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)\b/;
// Two-letter keys only ever mean a language in this code base.
const isLanguageKey = (key) => /^[a-z]{2}$/.test(key);

const manifest = JSON.parse(
  readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

/**
 * Every multi-language object found under `root`, with its path. An object
 * counts as multi-language as soon as one of its keys is a language code.
 */
function collect(root, path = '$', found = []) {
  if (Array.isArray(root)) {
    root.forEach((item, i) => collect(item, `${path}[${i}]`, found));
  } else if (root && typeof root === 'object') {
    if (Object.keys(root).some(isLanguageKey)) found.push({ path, text: root });
    else for (const [key, value] of Object.entries(root)) collect(value, `${path}.${key}`, found);
  }
  return found;
}

/** Problems of one multi-language object, `max` being its length limit. */
function problems({ path, text }, max) {
  const issues = [];
  const keys = Object.keys(text).sort();
  if (keys.join() !== [...LANGS].sort().join()) {
    issues.push(`${path}: languages ${keys.join(', ')} instead of ${LANGS.join(', ')}`);
  }
  for (const lang of LANGS) {
    const value = text[lang];
    if (typeof value !== 'string' || value.trim() === '') {
      issues.push(`${path}.${lang}: empty or missing`);
    } else if (value.length > max) {
      issues.push(`${path}.${lang}: ${value.length} characters, ${max} at most`);
    }
  }
  if (typeof text.de === 'string' && FORMAL_GERMAN.test(text.de)) {
    issues.push(`${path}.de: formal German ("Sie"/"Ihr"), say "du": ${text.de}`);
  }
  return issues;
}

function check(entries, maxFor) {
  assert.ok(entries.length > 0, 'nothing to check');
  const issues = entries.flatMap((entry) => problems(entry, maxFor(entry)));
  assert.deepEqual(issues, []);
}

// Length limits of the manifest texts, by the key holding them.
function manifestMax({ path }) {
  if (path === '$.description') return 100; // store catalog
  if (/\.description$/.test(path)) return 600;
  return 80; // labels, placeholders, option names
}

test('every manifest text exists in en, fr, de and es', () => {
  const entries = collect(manifest);
  // Guard against a walk that silently finds nothing: the manifest has
  // dozens of texts.
  assert.ok(entries.length >= 60, `only ${entries.length} texts found`);
  check(entries, manifestMax);
});

test('the feature names language offers every language of the tables', () => {
  const field = manifest.config_schema.find((f) => f.key === 'language');
  assert.deepEqual(field.options.map((o) => o.value).sort(), [...LANGS].sort());
  assert.deepEqual([...LANGUAGES].sort(), [...LANGS].sort());
});

test('feature and device names exist in every language, short', () => {
  check(
    Object.entries(TEXTS).map(([key, text]) => ({ path: `TEXTS.${key}`, text })),
    () => 40,
  );
});

test('connection messages exist in every language', () => {
  check(
    Object.entries(STATUS_MESSAGES).map(([key, text]) => ({
      path: `STATUS_MESSAGES.${key}`,
      text,
    })),
    () => 200,
  );
});

// --- Widgets, over every branch ------------------------------------------------

const VEHICLE = 'ext:tesla:vehicle:TEST';
const SITE = 'ext:tesla:energy-site:1';

const vehicleSnapshots = [
  ...['Charging', 'Starting', 'Complete', 'Stopped', 'NoPower', 'Disconnected', undefined].map(
    (chargingState) => ({ chargingState }),
  ),
  ...[true, false, undefined].map((flag) => ({
    climateOn: flag,
    locked: flag,
    sentry: flag,
    online: flag,
    chargeLimit: 80,
  })),
];
const siteSnapshots = [
  ...[true, false, undefined].map((gridConnected) => ({ gridConnected })),
  { gridConnected: false, islandStatus: 'off_grid_intentional' },
  ...['self_consumption', 'autonomous', 'backup', 'unknown'].map((operationMode) => ({
    operationMode,
    backupReserve: 20,
    stormModeActive: true,
  })),
];

function fakeRuntime(view) {
  return {
    vehicleView: (id) => (id === VEHICLE ? view.vehicle : null),
    siteView: (id) => (id === SITE ? view.site : null),
    vehicleOrder: async () => {},
  };
}

// Widget texts: tile and button labels stay short, status values hold 40
// characters (core limit), toasts are cut at 200.
function widgetMax({ path }) {
  if (/\.value$/.test(path)) return 40;
  if (/^toast/.test(path)) return 200;
  if (/\.text$/.test(path)) return 200;
  return 24;
}

test('widget contents and toasts exist in every language, over every state', async () => {
  const entries = [];
  const siteFeatures = Object.values(SITE_FEATURES).map((key) => ({
    external_id: `${SITE}:${key}`,
  }));
  for (const plugged of [true, false, undefined]) {
    for (const snapshot of vehicleSnapshots) {
      const widgets = createWidgets(
        fakeRuntime({ vehicle: { device: { external_id: VEHICLE }, snapshot, plugged } }),
      );
      const content = await widgets.vehicle.get({ settings: { device: VEHICLE } });
      entries.push(...collect(content, 'vehicle'));
    }
  }
  for (const battery of [true, false]) {
    for (const snapshot of siteSnapshots) {
      const widgets = createWidgets(
        fakeRuntime({
          site: {
            device: { external_id: SITE, features: siteFeatures },
            snapshot,
            components: { battery },
          },
        }),
      );
      const content = await widgets.energy_flow.get({ settings: { device: SITE } });
      entries.push(...collect(content, 'energy_flow'));
    }
  }
  // Messages: no device chosen, a device of the other kind.
  const empty = createWidgets(fakeRuntime({}));
  for (const [key, settings] of [
    ['vehicle', {}],
    ['vehicle', { device: SITE }],
    ['energy_flow', {}],
    ['energy_flow', { device: VEHICLE }],
  ]) {
    entries.push(...collect(await empty[key].get({ settings }), `${key}-message`));
  }
  const widgets = createWidgets(fakeRuntime({}));
  for (const actionKey of [
    'climate_on',
    'climate_off',
    'charge_start',
    'charge_stop',
    'lock',
    'unlock',
  ]) {
    const toast = await widgets.vehicle.action({ actionKey, settings: { device: VEHICLE } });
    entries.push({ path: `toast.${actionKey}`, text: toast });
  }
  check(entries, widgetMax);
  // The walk did reach the texts of every component kind.
  for (const kind of ['label', 'value', 'title', 'text']) {
    assert.ok(
      entries.some((e) => e.path.endsWith(`.${kind}`)),
      `no widget ${kind} checked`,
    );
  }
});

test('the connection test and the connection status answer in every language', async () => {
  const entries = [];
  // Connected, with a credit balance.
  const client = createFakeClient();
  const tesla = await start(client, { access_token: 'token' });
  entries.push({ path: 'testConnection.ok', text: await tesla.testConnection() });
  await tesla.stop();
  // Refused token, from a Wall Connector user of 1.1.0 (notice + message).
  const refused = createFakeClient();
  refused.failWith('products', new TeslemetryError('401', { kind: 'auth', status: 401 }));
  const gladys = createFakeGladys();
  const moved = await start(
    refused,
    { access_token: 'token', wall_connectors: '192.0.2.10' },
    gladys,
  );
  entries.push({ path: 'testConnection.auth', text: await moved.testConnection() });
  for (const [i, status] of gladys.connectionStatuses.entries()) {
    if (status.message) entries.push({ path: `connectionStatus[${i}]`, text: status.message });
  }
  await moved.stop();
  assert.ok(entries.length >= 3);
  check(entries, () => 300);
});

async function start(client, config, gladys = createFakeGladys()) {
  const tesla = createTesla({
    gladys,
    store: createMemoryStore(),
    logger: createLogger({ level: 'silent' }),
    clientFactory: () => client,
    streamFactory: createFakeStreamFactory(),
  });
  await tesla.start(normalizeConfig(config));
  return tesla;
}

// --- Source scan ---------------------------------------------------------------

test('every inline multi-language object in the source has its four languages', () => {
  const files = [
    new URL('../index.js', import.meta.url),
    ...readdirSync(new URL('../src/', import.meta.url), { recursive: true })
      .filter((name) => name.endsWith('.js'))
      .map((name) => new URL(`../src/${name}`, import.meta.url)),
  ];
  const issues = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const counts = Object.fromEntries(
      LANGS.map((lang) => [lang, (source.match(new RegExp(`\\b${lang}: `, 'g')) ?? []).length]),
    );
    if (new Set(Object.values(counts)).size !== 1) {
      issues.push(`${file.pathname.split('/').slice(-2).join('/')}: ${JSON.stringify(counts)}`);
    }
    // A text picked by a language test escapes the multi-language objects.
    if (/language\s*===\s*'(fr|en|de|es)'/.test(source)) {
      issues.push(`${file.pathname}: text chosen by a language test`);
    }
  }
  assert.deepEqual(issues, []);
});
