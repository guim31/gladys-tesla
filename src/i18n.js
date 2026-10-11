// -----------------------------------------------------------------------------
// Texts that leave the container.
//
// A `device` integration does not receive the language of the user (a widget
// request does): device and feature names follow the `language` setting of the
// integration, and are frozen by Gladys once the device is created. Widget
// contents and action messages use multi-language objects instead, so the
// core picks the viewer's language.
// -----------------------------------------------------------------------------

export const TEXTS = {
  // Vehicle features
  batteryLevel: {
    en: 'Battery level',
    fr: 'Niveau de batterie',
    de: 'Batteriestand',
    es: 'Nivel de batería',
  },
  range: { en: 'Range', fr: 'Autonomie', de: 'Reichweite', es: 'Autonomía' },
  chargingState: {
    en: 'Charging state',
    fr: 'État de charge',
    de: 'Ladestatus',
    es: 'Estado de carga',
  },
  chargePower: {
    en: 'Charging power',
    fr: 'Puissance de charge',
    de: 'Ladeleistung',
    es: 'Potencia de carga',
  },
  chargeLimit: {
    en: 'Charge limit',
    fr: 'Limite de charge',
    de: 'Ladegrenze',
    es: 'Límite de carga',
  },
  charging: { en: 'Charging', fr: 'Charge', de: 'Laden', es: 'Carga' },
  chargeCurrent: {
    en: 'Charging current',
    fr: 'Courant de charge',
    de: 'Ladestrom',
    es: 'Corriente de carga',
  },
  plugged: { en: 'Plugged in', fr: 'Branchée', de: 'Angeschlossen', es: 'Enchufado' },
  climate: { en: 'Climate', fr: 'Climatisation', de: 'Klimaanlage', es: 'Climatización' },
  insideTemp: {
    en: 'Inside temperature',
    fr: 'Température intérieure',
    de: 'Innentemperatur',
    es: 'Temperatura interior',
  },
  outsideTemp: {
    en: 'Outside temperature',
    fr: 'Température extérieure',
    de: 'Außentemperatur',
    es: 'Temperatura exterior',
  },
  targetTemp: {
    en: 'Climate set temperature',
    fr: 'Consigne de climatisation',
    de: 'Klima-Solltemperatur',
    es: 'Consigna de climatización',
  },
  locked: { en: 'Locked', fr: 'Verrouillage', de: 'Verriegelung', es: 'Bloqueo' },
  sentry: { en: 'Sentry Mode', fr: 'Mode Sentinelle', de: 'Wächter-Modus', es: 'Modo Centinela' },
  odometer: { en: 'Odometer', fr: 'Kilométrage', de: 'Kilometerzähler', es: 'Cuentakilómetros' },
  awake: {
    en: 'Online (awake)',
    fr: 'En ligne (réveillée)',
    de: 'Online (wach)',
    es: 'En línea (despierto)',
  },
  // Energy site features
  solarPower: {
    en: 'Solar production',
    fr: 'Production solaire',
    de: 'Solarproduktion',
    es: 'Producción solar',
  },
  homePower: {
    en: 'Home consumption',
    fr: 'Consommation de la maison',
    de: 'Hausverbrauch',
    es: 'Consumo de la casa',
  },
  gridPower: {
    en: 'Grid (import +, export −)',
    fr: 'Réseau (soutirage +, injection −)',
    de: 'Netz (Bezug +, Einspeisung −)',
    es: 'Red (importación +, exportación −)',
  },
  batteryChargePower: {
    en: 'Battery charging',
    fr: 'Charge de la batterie',
    de: 'Batterieladung',
    es: 'Carga de la batería',
  },
  batteryDischargePower: {
    en: 'Battery discharging',
    fr: 'Décharge de la batterie',
    de: 'Batterieentladung',
    es: 'Descarga de la batería',
  },
  siteBatteryLevel: {
    en: 'Powerwall charge',
    fr: 'Charge du Powerwall',
    de: 'Powerwall-Ladestand',
    es: 'Carga del Powerwall',
  },
  gridConnected: {
    en: 'Grid connected',
    fr: 'Réseau présent',
    de: 'Netz verbunden',
    es: 'Red conectada',
  },
  operationMode: {
    en: 'Operation mode',
    fr: 'Mode de fonctionnement',
    de: 'Betriebsmodus',
    es: 'Modo de funcionamiento',
  },
  homeEnergy: {
    en: 'Home consumption index',
    fr: 'Index de consommation',
    de: 'Verbrauchszähler',
    es: 'Índice de consumo',
  },
  solarEnergy: {
    en: 'Solar production index',
    fr: 'Index de production solaire',
    de: 'Solarproduktionszähler',
    es: 'Índice de producción solar',
  },
  gridImportEnergy: {
    en: 'Grid import index',
    fr: 'Index de soutirage',
    de: 'Netzbezugszähler',
    es: 'Índice de importación de la red',
  },
  gridExportEnergy: {
    en: 'Grid export index',
    fr: "Index d'injection",
    de: 'Netzeinspeisezähler',
    es: 'Índice de exportación de la red',
  },
  batteryChargeEnergy: {
    en: 'Battery charge index',
    fr: 'Index de charge batterie',
    de: 'Batterie-Ladezähler',
    es: 'Índice de carga de la batería',
  },
  batteryDischargeEnergy: {
    en: 'Battery discharge index',
    fr: 'Index de décharge batterie',
    de: 'Batterie-Entladezähler',
    es: 'Índice de descarga de la batería',
  },
  // Operation modes (Tesla app names)
  modeSelfConsumption: {
    en: 'Self-Powered',
    fr: 'Autoconsommation',
    de: 'Eigenverbrauch',
    es: 'Autoconsumo',
  },
  modeAutonomous: {
    en: 'Time-Based Control',
    fr: 'Contrôle horaire',
    de: 'Zeitbasierte Steuerung',
    es: 'Control basado en horario',
  },
  modeBackup: {
    en: 'Backup-only',
    fr: 'Secours uniquement',
    de: 'Nur Notstrom',
    es: 'Solo respaldo',
  },
  // Device name fallbacks
  energySite: {
    en: 'Tesla energy site',
    fr: 'Site énergie Tesla',
    de: 'Tesla-Energiestandort',
    es: 'Sitio de energía Tesla',
  },
};

/** Text in one language (device and feature names). */
export function t(language, key) {
  const entry = TEXTS[key];
  if (!entry) throw new Error(`Unknown text key: ${key}`);
  return entry[language] ?? entry.en;
}

/** Every language, for the multi-language objects the core localizes. */
export function both(key) {
  const entry = TEXTS[key];
  if (!entry) throw new Error(`Unknown text key: ${key}`);
  return { ...entry };
}
