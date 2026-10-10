// -----------------------------------------------------------------------------
// Texts that leave the container.
//
// A `device` integration does not receive the language of the user (a widget
// request does): device and feature names follow the `language` setting of the
// integration, and are frozen by Gladys once the device is created. Widget
// contents and action messages use multi-language objects instead, so the
// core picks the viewer's language.
// -----------------------------------------------------------------------------

const TEXTS = {
  // Vehicle features
  batteryLevel: { en: 'Battery level', fr: 'Niveau de batterie' },
  range: { en: 'Range', fr: 'Autonomie' },
  chargingState: { en: 'Charging state', fr: 'État de charge' },
  chargePower: { en: 'Charging power', fr: 'Puissance de charge' },
  chargeLimit: { en: 'Charge limit', fr: 'Limite de charge' },
  charging: { en: 'Charging', fr: 'Charge' },
  chargeCurrent: { en: 'Charging current', fr: 'Courant de charge' },
  plugged: { en: 'Plugged in', fr: 'Branchée' },
  climate: { en: 'Climate', fr: 'Climatisation' },
  insideTemp: { en: 'Inside temperature', fr: 'Température intérieure' },
  outsideTemp: { en: 'Outside temperature', fr: 'Température extérieure' },
  targetTemp: { en: 'Climate set temperature', fr: 'Consigne de climatisation' },
  locked: { en: 'Locked', fr: 'Verrouillage' },
  sentry: { en: 'Sentry Mode', fr: 'Mode Sentinelle' },
  odometer: { en: 'Odometer', fr: 'Kilométrage' },
  awake: { en: 'Online (awake)', fr: 'En ligne (réveillée)' },
  // Energy site features
  solarPower: { en: 'Solar production', fr: 'Production solaire' },
  homePower: { en: 'Home consumption', fr: 'Consommation de la maison' },
  gridPower: { en: 'Grid (import +, export −)', fr: 'Réseau (soutirage +, injection −)' },
  batteryChargePower: { en: 'Battery charging', fr: 'Charge de la batterie' },
  batteryDischargePower: { en: 'Battery discharging', fr: 'Décharge de la batterie' },
  siteBatteryLevel: { en: 'Powerwall charge', fr: 'Charge du Powerwall' },
  gridConnected: { en: 'Grid connected', fr: 'Réseau présent' },
  operationMode: { en: 'Operation mode', fr: 'Mode de fonctionnement' },
  homeEnergy: { en: 'Home consumption index', fr: 'Index de consommation' },
  solarEnergy: { en: 'Solar production index', fr: 'Index de production solaire' },
  gridImportEnergy: { en: 'Grid import index', fr: 'Index de soutirage' },
  gridExportEnergy: { en: 'Grid export index', fr: "Index d'injection" },
  batteryChargeEnergy: { en: 'Battery charge index', fr: 'Index de charge batterie' },
  batteryDischargeEnergy: { en: 'Battery discharge index', fr: 'Index de décharge batterie' },
  // Operation modes (Tesla app names)
  modeSelfConsumption: { en: 'Self-Powered', fr: 'Autoconsommation' },
  modeAutonomous: { en: 'Time-Based Control', fr: 'Contrôle horaire' },
  modeBackup: { en: 'Backup-only', fr: 'Secours uniquement' },
  // Wall Connector features
  wcConnectorStatus: { en: 'Connector', fr: 'Connecteur' },
  wcChargingState: { en: 'Charging state', fr: 'État de charge' },
  wcStatus: { en: 'Status', fr: 'Statut' },
  wcPower: { en: 'Charging power', fr: 'Puissance de charge' },
  wcSessionEnergy: { en: 'Session energy', fr: 'Énergie de la session' },
  wcEnergy: { en: 'Total energy delivered', fr: 'Énergie totale délivrée' },
  wcVoltage: { en: 'Grid voltage', fr: 'Tension du réseau' },
  wcCurrent: { en: 'Vehicle current', fr: 'Courant du véhicule' },
  wcHandleTemperature: { en: 'Handle temperature', fr: 'Température de la poignée' },
  // Device name fallbacks
  energySite: { en: 'Tesla energy site', fr: 'Site énergie Tesla' },
};

/** Text in one language (device and feature names). */
export function t(language, key) {
  const entry = TEXTS[key];
  if (!entry) throw new Error(`Unknown text key: ${key}`);
  return entry[language] ?? entry.en;
}

/** Both languages, for the multi-language objects the core localizes. */
export function both(key) {
  const entry = TEXTS[key];
  if (!entry) throw new Error(`Unknown text key: ${key}`);
  return { ...entry };
}
