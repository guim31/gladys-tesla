// -----------------------------------------------------------------------------
// Entry point: SDK wiring only. Everything Tesla lives in src/tesla.js.
//
// The Gladys supervisor injects GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN
// and GLADYS_INTEGRATION_SELECTOR; `new GladysIntegration()` reads them.
// Every handler is registered BEFORE connect().
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import { createStore } from './src/store.js';
import { createTesla } from './src/tesla.js';
import { createWidgets } from './src/widgets.js';
import { createSceneActions } from './src/scenes.js';

const gladys = new GladysIntegration();
const store = createStore({ logger });
const tesla = createTesla({ gladys, store });
let started = false;

gladys.onScanRequest(() => tesla.scan());

// Gladys acks a device command within 5 s: past 4 s (a sleeping car being
// woken first), the command is acknowledged and finishes in the background.
gladys.onSetValue((device, feature, value) =>
  tesla.setValue(device, feature, value, { deadlineMs: 4000 }),
);

// No device is published with `should_poll`: the runtime keeps its own pace
// (stream + slow fallback). Kept as a cheap republication of known values.
gladys.onPoll((device) => tesla.poll(device));

// Gladys drops the states of a feature that does not exist yet: send them
// again now that it does, and let the widgets bind to it.
gladys.onDeviceCreated((device) => tesla.deviceCreated(device));
gladys.onDeviceUpdated((device) => tesla.deviceCreated(device));

gladys.onAction('test_connection', () => tesla.testConnection());

for (const [key, handler] of Object.entries(createSceneActions(tesla))) {
  gladys.onSceneAction(key, (fields) => handler({ fields }));
}

for (const [key, widget] of Object.entries(createWidgets(tesla))) {
  gladys.onWidgetGet(key, (request) => widget.get(request));
  if (typeof widget.action === 'function') {
    gladys.onWidgetAction(key, (actionKey, params, { settings }) =>
      widget.action({ actionKey, params, settings }),
    );
  }
}

gladys.onConfigUpdated(async (newConfig) => {
  logger.info('Configuration updated');
  await tesla.reconfigure(normalizeConfig(newConfig));
});

gladys.on('connected', async () => {
  try {
    if (!started) {
      started = true;
      await store.load();
      await tesla.start(normalizeConfig(await gladys.getConfig()));
    } else {
      // Reconnected to Gladys: what was published while disconnected was lost.
      await tesla.resync();
    }
  } catch (err) {
    logger.error('Initialization failed', err);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
      })
      .catch(() => {});
  }
});

gladys.handleShutdown(async (signal) => {
  logger.info(`Received ${signal}, stopping`);
  await tesla.stop();
});

logger.info('Starting the Tesla integration (Teslemetry)...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
