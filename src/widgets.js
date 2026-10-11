// -----------------------------------------------------------------------------
// Dashboard widgets (SDK v0.14+, Gladys 5.1+).
//
//   - `vehicle`: one car — live tiles (battery, range, charging power, cabin
//     temperature), a status list, and buttons for climate, charging and locks;
//   - `energy_flow`: one energy site — live tiles for every flow, the last
//     24 hours as a chart, and the site's state (grid, mode, backup reserve).
//
// The tiles and the chart are bound to device features: they move in real time
// and Gladys converts their unit to the viewer's preference (miles, °F...).
// The status rows and the button labels are computed here: the runtime nudges
// the widgets when they change (src/tesla.js), the TTL is a safety net.
// Budget of the core: 8 components, 6 tiles, 1 status, 4 buttons, 2 texts.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { VEHICLE_FEATURES } from './devices/vehicle.js';
import { OPERATION_MODE_LABELS, SITE_FEATURES } from './devices/energySite.js';
import { WIDGET_KEYS } from './tesla.js';
import { both } from './i18n.js';

const pickDevice = {
  en: 'Choose a device in the widget settings.',
  fr: 'Choisissez un appareil dans les réglages du widget.',
  de: 'Wähle ein Gerät in den Widget-Einstellungen.',
  es: 'Elija un dispositivo en los ajustes del widget.',
};

function message(text) {
  return { ttl_seconds: 300, components: [{ type: 'text', variant: 'body', text }] };
}

const percent = (value) => (Number.isFinite(value) ? `${Math.round(value)} %` : '—');

// Charge session as one status row.
function chargeRow(snapshot, plugged) {
  const label = { en: 'Charging', fr: 'Charge', de: 'Laden', es: 'Carga' };
  switch (snapshot.chargingState) {
    case 'Charging':
    case 'Starting':
      return {
        label,
        icon: 'zap',
        value: { en: 'Charging', fr: 'En charge', de: 'Lädt', es: 'Cargando' },
        color: WIDGET_COLORS.SUCCESS,
      };
    case 'Complete':
      return {
        label,
        icon: 'battery',
        value: { en: 'Complete', fr: 'Terminée', de: 'Abgeschlossen', es: 'Completada' },
        color: WIDGET_COLORS.INFO,
      };
    case 'Stopped':
      return {
        label,
        icon: 'pause',
        value: { en: 'Stopped', fr: 'Arrêtée', de: 'Gestoppt', es: 'Detenida' },
        color: WIDGET_COLORS.WARNING,
      };
    case 'NoPower':
      return {
        label,
        icon: 'alert-triangle',
        value: { en: 'No power', fr: 'Pas de courant', de: 'Kein Strom', es: 'Sin corriente' },
        color: WIDGET_COLORS.DANGER,
      };
    default:
      return plugged === false
        ? {
            label,
            icon: 'battery',
            value: { en: 'Unplugged', fr: 'Débranchée', de: 'Abgesteckt', es: 'Desenchufado' },
            color: WIDGET_COLORS.NEUTRAL,
          }
        : { label, icon: 'battery', value: '—', color: WIDGET_COLORS.NEUTRAL };
  }
}

function vehicleContent(view) {
  const { device, snapshot, plugged } = view;
  const ref = (key) => `${device.external_id}:${key}`;
  const onOff = (value, on, off) => (value === true ? on : value === false ? off : '—');
  const components = [
    {
      type: 'value',
      label: { en: 'Battery', fr: 'Batterie', de: 'Batterie', es: 'Batería' },
      icon: 'battery',
      device_feature: ref(VEHICLE_FEATURES.BATTERY_LEVEL),
    },
    {
      type: 'value',
      label: { en: 'Range', fr: 'Autonomie', de: 'Reichweite', es: 'Autonomía' },
      icon: 'navigation',
      device_feature: ref(VEHICLE_FEATURES.RANGE),
    },
    {
      type: 'value',
      label: { en: 'Charging power', fr: 'Puissance', de: 'Ladeleistung', es: 'Potencia' },
      icon: 'zap',
      device_feature: ref(VEHICLE_FEATURES.CHARGE_POWER),
    },
    {
      type: 'value',
      label: { en: 'Cabin', fr: 'Habitacle', de: 'Innenraum', es: 'Habitáculo' },
      icon: 'thermometer',
      device_feature: ref(VEHICLE_FEATURES.INSIDE_TEMPERATURE),
    },
    {
      type: 'status',
      items: [
        chargeRow(snapshot, plugged),
        {
          label: {
            en: 'Charge limit',
            fr: 'Limite de charge',
            de: 'Ladegrenze',
            es: 'Límite de carga',
          },
          icon: 'sliders',
          value: percent(snapshot.chargeLimit),
          color: WIDGET_COLORS.NEUTRAL,
        },
        {
          label: { en: 'Climate', fr: 'Climatisation', de: 'Klimaanlage', es: 'Climatización' },
          icon: 'wind',
          value: onOff(
            snapshot.climateOn,
            { en: 'On', fr: 'En marche', de: 'An', es: 'Encendida' },
            { en: 'Off', fr: 'Arrêtée', de: 'Aus', es: 'Apagada' },
          ),
          color: snapshot.climateOn ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
        },
        {
          label: { en: 'Doors', fr: 'Portes', de: 'Türen', es: 'Puertas' },
          icon: snapshot.locked === false ? 'unlock' : 'lock',
          value: onOff(
            snapshot.locked,
            { en: 'Locked', fr: 'Verrouillées', de: 'Verriegelt', es: 'Bloqueadas' },
            { en: 'Unlocked', fr: 'Déverrouillées', de: 'Entriegelt', es: 'Desbloqueadas' },
          ),
          color: snapshot.locked === false ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
        },
        {
          label: both('sentry'),
          icon: 'eye',
          value: onOff(
            snapshot.sentry,
            { en: 'On', fr: 'Activé', de: 'An', es: 'Activado' },
            { en: 'Off', fr: 'Désactivé', de: 'Aus', es: 'Desactivado' },
          ),
          color: snapshot.sentry ? WIDGET_COLORS.INFO : WIDGET_COLORS.NEUTRAL,
        },
        {
          label: { en: 'Vehicle', fr: 'Véhicule', de: 'Fahrzeug', es: 'Vehículo' },
          icon: snapshot.online ? 'wifi' : 'moon',
          value: onOff(
            snapshot.online,
            { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' },
            { en: 'Asleep', fr: 'Endormie', de: 'Schläft', es: 'Dormido' },
          ),
          color: snapshot.online ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
        },
      ],
    },
  ];
  // Buttons: one per order, labelled with what a tap does now.
  components.push(
    snapshot.climateOn
      ? {
          type: 'button',
          label: { en: 'Stop climate', fr: 'Arrêter la clim', de: 'Klima aus', es: 'Apagar clima' },
          icon: 'wind',
          action: { key: 'climate_off' },
        }
      : {
          type: 'button',
          label: {
            en: 'Start climate',
            fr: 'Lancer la clim',
            de: 'Klima an',
            es: 'Encender clima',
          },
          icon: 'wind',
          action: { key: 'climate_on' },
        },
  );
  if (snapshot.chargingState === 'Charging' || snapshot.chargingState === 'Starting') {
    components.push({
      type: 'button',
      label: {
        en: 'Stop charging',
        fr: 'Arrêter la charge',
        de: 'Laden stoppen',
        es: 'Detener carga',
      },
      icon: 'zap-off',
      action: { key: 'charge_stop' },
    });
  } else if (plugged) {
    components.push({
      type: 'button',
      label: {
        en: 'Start charging',
        fr: 'Lancer la charge',
        de: 'Laden starten',
        es: 'Iniciar carga',
      },
      icon: 'zap',
      action: { key: 'charge_start' },
    });
  }
  components.push(
    snapshot.locked === false
      ? {
          type: 'button',
          label: { en: 'Lock', fr: 'Verrouiller', de: 'Verriegeln', es: 'Bloquear' },
          icon: 'lock',
          action: { key: 'lock' },
        }
      : {
          type: 'button',
          label: { en: 'Unlock', fr: 'Déverrouiller', de: 'Entriegeln', es: 'Desbloquear' },
          icon: 'unlock',
          style: 'danger',
          // A dashboard can hang on a wall: unlocking asks first.
          action: { key: 'unlock', confirm: true },
        },
  );
  return { ttl_seconds: 300, components };
}

// Widget action key → [feature, value, toast].
const VEHICLE_ACTIONS = {
  climate_on: [
    VEHICLE_FEATURES.CLIMATE,
    1,
    {
      en: 'Climate starting',
      fr: 'Climatisation lancée',
      de: 'Klimaanlage startet',
      es: 'Climatización encendida',
    },
  ],
  climate_off: [
    VEHICLE_FEATURES.CLIMATE,
    0,
    {
      en: 'Climate stopped',
      fr: 'Climatisation arrêtée',
      de: 'Klimaanlage gestoppt',
      es: 'Climatización apagada',
    },
  ],
  charge_start: [
    VEHICLE_FEATURES.CHARGING,
    1,
    { en: 'Charging starting', fr: 'Charge lancée', de: 'Laden startet', es: 'Carga iniciada' },
  ],
  charge_stop: [
    VEHICLE_FEATURES.CHARGING,
    0,
    { en: 'Charging stopped', fr: 'Charge arrêtée', de: 'Laden gestoppt', es: 'Carga detenida' },
  ],
  lock: [
    VEHICLE_FEATURES.LOCKED,
    1,
    {
      en: 'Vehicle locked',
      fr: 'Véhicule verrouillé',
      de: 'Fahrzeug verriegelt',
      es: 'Vehículo bloqueado',
    },
  ],
  unlock: [
    VEHICLE_FEATURES.LOCKED,
    0,
    {
      en: 'Vehicle unlocked',
      fr: 'Véhicule déverrouillé',
      de: 'Fahrzeug entriegelt',
      es: 'Vehículo desbloqueado',
    },
  ],
};

function gridRow(snapshot) {
  const label = { en: 'Grid', fr: 'Réseau', de: 'Netz', es: 'Red' };
  if (snapshot.gridConnected === true) {
    return {
      label,
      icon: 'zap',
      value: { en: 'Connected', fr: 'Présent', de: 'Verbunden', es: 'Conectada' },
      color: WIDGET_COLORS.SUCCESS,
    };
  }
  if (snapshot.gridConnected === false) {
    return snapshot.islandStatus === 'off_grid_intentional'
      ? {
          label,
          icon: 'zap-off',
          value: {
            en: 'Off-grid (manual)',
            fr: 'Hors réseau (manuel)',
            de: 'Netzunabhängig (manuell)',
            es: 'Sin red (manual)',
          },
          color: WIDGET_COLORS.WARNING,
        }
      : {
          label,
          icon: 'zap-off',
          value: { en: 'Outage', fr: 'Coupure', de: 'Ausfall', es: 'Corte' },
          color: WIDGET_COLORS.DANGER,
        };
  }
  return { label, icon: 'zap', value: '—', color: WIDGET_COLORS.NEUTRAL };
}

function energyFlowContent(view) {
  const { device, snapshot, components: has } = view;
  const ref = (key) => `${device.external_id}:${key}`;
  const exists = new Set(device.features.map((f) => f.external_id));
  const tile = (key, label, icon) =>
    exists.has(ref(key)) ? { type: 'value', label, icon, device_feature: ref(key) } : null;
  const tiles = [
    tile(
      SITE_FEATURES.SOLAR_POWER,
      { en: 'Solar', fr: 'Solaire', de: 'Solar', es: 'Solar' },
      'sun',
    ),
    tile(SITE_FEATURES.HOME_POWER, { en: 'Home', fr: 'Maison', de: 'Haus', es: 'Casa' }, 'home'),
    tile(SITE_FEATURES.GRID_POWER, { en: 'Grid', fr: 'Réseau', de: 'Netz', es: 'Red' }, 'activity'),
    tile(
      SITE_FEATURES.BATTERY_LEVEL,
      { en: 'Powerwall', fr: 'Powerwall', de: 'Powerwall', es: 'Powerwall' },
      'battery',
    ),
    tile(
      SITE_FEATURES.BATTERY_CHARGE_POWER,
      { en: 'Charging', fr: 'Charge', de: 'Laden', es: 'Carga' },
      'battery-charging',
    ),
    tile(
      SITE_FEATURES.BATTERY_DISCHARGE_POWER,
      { en: 'Discharging', fr: 'Décharge', de: 'Entladen', es: 'Descarga' },
      'zap',
    ),
  ].filter(Boolean);
  const series = [SITE_FEATURES.SOLAR_POWER, SITE_FEATURES.HOME_POWER, SITE_FEATURES.GRID_POWER]
    .map(ref)
    .filter((id) => exists.has(id));
  const items = [gridRow(snapshot)];
  if (has.battery) {
    const mode = OPERATION_MODE_LABELS[snapshot.operationMode];
    items.push(
      {
        label: both('operationMode'),
        icon: 'sliders',
        value: mode ? both(mode) : '—',
        color: WIDGET_COLORS.NEUTRAL,
      },
      {
        label: {
          en: 'Backup reserve',
          fr: 'Réserve de secours',
          de: 'Notstromreserve',
          es: 'Reserva de respaldo',
        },
        icon: 'shield',
        value: percent(snapshot.backupReserve),
        color: WIDGET_COLORS.NEUTRAL,
      },
    );
    if (snapshot.stormModeActive) {
      items.push({
        label: {
          en: 'Storm Watch',
          fr: 'Alerte tempête',
          de: 'Sturmwarnung',
          es: 'Alerta de tormenta',
        },
        icon: 'cloud-lightning',
        value: { en: 'Active', fr: 'Active', de: 'Aktiv', es: 'Activa' },
        color: WIDGET_COLORS.WARNING,
      });
    }
  }
  const components = [...tiles];
  if (series.length) {
    components.push({
      type: 'chart',
      chart_type: 'line',
      interval: 'last-day',
      title: {
        en: 'Last 24 hours',
        fr: 'Dernières 24 heures',
        de: 'Letzte 24 Stunden',
        es: 'Últimas 24 horas',
      },
      device_features: series,
    });
  }
  components.push({ type: 'status', items });
  return { ttl_seconds: 300, components };
}

/**
 * Widgets, keyed like the manifest. `tesla` is the runtime (src/tesla.js).
 */
export function createWidgets(tesla) {
  return {
    [WIDGET_KEYS.VEHICLE]: {
      async get({ settings }) {
        const view = settings?.device ? tesla.vehicleView(settings.device) : null;
        if (!view) {
          return message(
            settings?.device
              ? {
                  en: 'This device is not a Tesla vehicle.',
                  fr: "Cet appareil n'est pas un véhicule Tesla.",
                  de: 'Dieses Gerät ist kein Tesla-Fahrzeug.',
                  es: 'Este dispositivo no es un vehículo Tesla.',
                }
              : pickDevice,
          );
        }
        return vehicleContent(view);
      },
      async action({ actionKey, settings }) {
        const order = VEHICLE_ACTIONS[actionKey];
        if (!order) throw new Error(`Unknown action: ${actionKey}`);
        const [feature, value, toast] = order;
        await tesla.vehicleOrder(settings.device, feature, value);
        return toast;
      },
    },
    [WIDGET_KEYS.ENERGY_FLOW]: {
      async get({ settings }) {
        const view = settings?.device ? tesla.siteView(settings.device) : null;
        if (!view) {
          return message(
            settings?.device
              ? {
                  en: 'This device is not a Tesla energy site.',
                  fr: "Cet appareil n'est pas un site d'énergie Tesla.",
                  de: 'Dieses Gerät ist kein Tesla-Energiestandort.',
                  es: 'Este dispositivo no es un sitio de energía Tesla.',
                }
              : pickDevice,
          );
        }
        return energyFlowContent(view);
      },
    },
  };
}
