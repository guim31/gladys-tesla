import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHARGING_STATION_STATE,
  VEHICLE_FEATURES as F,
  STREAMING_FIELDS,
  buildVehicleDevice,
  hasTirePressures,
  isPlugged,
  snapshotFromStreamData,
  snapshotFromVehicleData,
  vehicleCommand,
  vehicleModel,
  vehicleStates,
} from '../src/devices/vehicle.js';
import { vehicleUnits } from '../src/units.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { fixture } from './helpers/fakeTeslemetry.js';

const statesOf = (snapshot, units = { distance: 'km', temperature: 'celsius' }) => {
  const unitOf = (key) =>
    [F.RANGE, F.ODOMETER].includes(key) ? units.distance : units.temperature;
  return Object.fromEntries(vehicleStates(snapshot, unitOf).map(({ key, value }) => [key, value]));
};

test('model from the vehicle config, else from the VIN', () => {
  assert.equal(vehicleModel({ vehicle_config: { car_type: 'modely' } }), 'Model Y');
  assert.equal(vehicleModel({ vehicle_config: { car_type: 'models2' } }), 'Model S');
  assert.equal(vehicleModel({ vehicle_config: { car_type: 'cybertruck' } }), 'Cybertruck');
  assert.equal(vehicleModel({ vin: '5YJXTEST0FAKE0004' }), 'Model X');
  assert.equal(vehicleModel({ vin: '12345' }), 'Tesla');
});

test('vehicle_data of a Model Y charging in the US', () => {
  const snapshot = snapshotFromVehicleData(fixture('vehicle_data_modely').response);
  assert.equal(snapshot.online, true);
  assert.equal(snapshot.chargingState, 'Charging');
  assert.equal(snapshot.chargePowerKw, 11);
  assert.equal(snapshot.distanceUnit, 'mi');
  assert.equal(snapshot.temperatureUnit, 'F');
  const states = statesOf(snapshot, vehicleUnits('auto', snapshot));
  assert.equal(states[F.RANGE], 167); // miles, as the car shows them
  assert.equal(states[F.ODOMETER], 18343);
  assert.equal(states[F.INSIDE_TEMPERATURE], 70.5); // 21.4 °C
  assert.equal(states[F.CHARGING_STATE], CHARGING_STATION_STATE.CHARGING);
  assert.equal(states[F.CHARGING], 1);
  assert.equal(states[F.PLUGGED], 1);
  assert.equal(states[F.LOCKED], 1);
  assert.equal(states[F.SENTRY_MODE], 1);
});

test('metric units convert the miles Tesla always answers', () => {
  const snapshot = snapshotFromVehicleData(fixture('vehicle_data_modely').response);
  const states = statesOf(snapshot, vehicleUnits('metric', snapshot));
  assert.equal(states[F.RANGE], 269); // 167.35 mi
  assert.equal(states[F.INSIDE_TEMPERATURE], 21.4);
});

test('a sleeping car: last known values, awake = 0, no charge power', () => {
  const snapshot = snapshotFromVehicleData(fixture('vehicle_data_models').response);
  const states = statesOf(snapshot);
  assert.equal(states[F.AWAKE], 0);
  assert.equal(states[F.PLUGGED], 0);
  assert.equal(states[F.CHARGE_POWER], 0);
  assert.equal(states[F.CHARGING_STATE], CHARGING_STATION_STATE.IDLE);
  // No reading at all is published rather than a made-up one.
  assert.equal(states[F.INSIDE_TEMPERATURE], undefined);
});

test('stream deltas: typed and string-encoded values, enum prefixes', () => {
  const first = snapshotFromStreamData({
    BatteryLevel: '79.6',
    DetailedChargeState: 'DetailedChargeStateCharging',
    ACChargingPower: 7.2,
    DCChargingPower: 0,
    HvacPower: 'HvacPowerStatePrecondition',
    Locked: 'false',
    SentryMode: 'SentryModeStateIdle',
    SettingDistanceUnit: 'DistanceUnitKilometers',
  });
  assert.equal(first.batteryLevel, 79.6);
  assert.equal(first.chargingState, 'Charging');
  assert.equal(first.chargePowerKw, 7.2);
  assert.equal(first.climateOn, true);
  assert.equal(first.locked, false);
  assert.equal(first.sentry, true, 'Idle means Sentry Mode is on, waiting');
  assert.equal(first.distanceUnit, 'km');
  assert.equal(first.online, true);
  // AC/DC power is not reset when the session ends: gated by the state.
  const ended = snapshotFromStreamData(
    { DetailedChargeState: 'DetailedChargeStateComplete' },
    first,
  );
  assert.equal(ended.chargePowerKw, 0);
  assert.equal(ended.acPowerKw, 7.2);
  // A supercharger session: DC power.
  const dc = snapshotFromStreamData(
    {
      DetailedChargeState: 'DetailedChargeStateCharging',
      DCChargingPower: 148.2,
      ACChargingPower: 0,
    },
    ended,
  );
  assert.equal(dc.chargePowerKw, 148.2);
});

test('stream values that are null or Unknown keep the previous value', () => {
  const previous = { chargingState: 'Stopped', batteryLevel: 50 };
  const next = snapshotFromStreamData(
    { DetailedChargeState: 'DetailedChargeStateUnknown', BatteryLevel: null },
    previous,
  );
  assert.equal(next.chargingState, 'Stopped');
  assert.equal(next.batteryLevel, 50);
});

test('plugged in: every state but Disconnected', () => {
  assert.equal(isPlugged({ chargingState: 'Stopped' }), true);
  assert.equal(isPlugged({ chargingState: 'Complete' }), true);
  assert.equal(isPlugged({ chargingState: 'Disconnected' }), false);
  assert.equal(isPlugged({}), null);
});

test('commands map to the Fleet API, bounded like Tesla bounds them', () => {
  assert.deepEqual(vehicleCommand(F.CHARGING, 1).command, 'charge_start');
  assert.deepEqual(vehicleCommand(F.CHARGING, 0).command, 'charge_stop');
  assert.deepEqual(vehicleCommand(F.CHARGE_LIMIT, 120).body, { percent: 100 });
  assert.deepEqual(vehicleCommand(F.CHARGE_LIMIT, 20).body, { percent: 50 });
  assert.deepEqual(vehicleCommand(F.CHARGE_CURRENT, 32.4).body, { charging_amps: 32 });
  // Clamped to what the charger plugged in allows.
  assert.deepEqual(vehicleCommand(F.CHARGE_CURRENT, 40, undefined, { chargeCurrentMax: 16 }).body, {
    charging_amps: 16,
  });
  assert.deepEqual(vehicleCommand(F.CHARGE_CURRENT, 80).body, { charging_amps: 48 });
  assert.equal(vehicleCommand(F.CLIMATE, 1).command, 'auto_conditioning_start');
  assert.equal(vehicleCommand(F.LOCKED, 0).command, 'door_unlock');
  assert.deepEqual(vehicleCommand(F.SENTRY_MODE, 1).body, { on: true });
  // 70 °F → 21 °C, half-degree steps.
  assert.deepEqual(vehicleCommand(F.TARGET_TEMPERATURE, 70, 'fahrenheit').body, {
    driver_temp: 21,
    passenger_temp: 21,
  });
  assert.deepEqual(vehicleCommand(F.TARGET_TEMPERATURE, 35, 'celsius').body.driver_temp, 28);
  assert.equal(vehicleCommand(F.ODOMETER, 1), null, 'read-only features have no command');
  assert.throws(() => vehicleCommand(F.CHARGE_LIMIT, 'abc'));
});

test('the device keys its external ids on the VIN, never on the name', () => {
  const gladys = createFakeGladys();
  const product = fixture('products').response[0];
  const device = buildVehicleDevice(gladys, product, {
    language: 'en',
    units: vehicleUnits('metric'),
  });
  assert.equal(device.external_id, `ext:tesla:vehicle:${product.vin}`);
  const renamed = buildVehicleDevice(
    gladys,
    { ...product, display_name: 'Other name' },
    { language: 'fr', units: vehicleUnits('imperial') },
  );
  assert.deepEqual(
    renamed.features.map((f) => f.external_id),
    device.features.map((f) => f.external_id),
  );
  assert.equal(device.should_poll, false, 'the runtime keeps its own pace');
  assert.equal(device.poll_frequency, undefined);
  const current = device.features.find((f) => f.external_id.endsWith(`:${F.CHARGE_CURRENT}`));
  assert.equal(current.max, 48, 'fixed: does not follow the charger plugged in');
  const onOtherCharger = buildVehicleDevice(gladys, product, {
    language: 'en',
    units: vehicleUnits('metric'),
  });
  assert.deepEqual(onOtherCharger, device, 'the structure does not depend on live values');
});

// --- Tyre pressures ----------------------------------------------------------

const tirePressureOf = (snapshot, unit) =>
  Object.fromEntries(
    vehicleStates(snapshot, () => unit)
      .filter(({ key }) => key.startsWith('tire-pressure'))
      .map(({ key, value }) => [key, value]),
  );

test('tyre pressures and TPMS warnings from vehicle_data, in bar', () => {
  const snapshot = snapshotFromVehicleData(fixture('vehicle_data_model3').response);
  assert.equal(snapshot.tirePressureFl, 2.775);
  assert.equal(snapshot.tirePressureFr, 2.8);
  assert.equal(snapshot.tirePressureLow, false);
  assert.equal(snapshot.pressureUnit, 'psi'); // gui_tirepressure_units "Psi"
  assert.ok(hasTirePressures(snapshot));
  assert.deepEqual(tirePressureOf(snapshot, 'bar'), {
    [F.TIRE_PRESSURE_FRONT_LEFT]: 2.78,
    [F.TIRE_PRESSURE_FRONT_RIGHT]: 2.8,
    [F.TIRE_PRESSURE_REAR_LEFT]: 2.78,
    [F.TIRE_PRESSURE_REAR_RIGHT]: 2.78,
    [F.TIRE_PRESSURE_LOW]: 0,
  });
  const psi = tirePressureOf(snapshot, 'psi');
  assert.equal(psi[F.TIRE_PRESSURE_FRONT_RIGHT], 40.6); // 2.8 bar
  assert.equal(tirePressureOf(snapshot, 'kPa')[F.TIRE_PRESSURE_FRONT_RIGHT], 280);
});

test('one soft or hard TPMS warning raises the low pressure alert', () => {
  const data = fixture('vehicle_data_model3').response;
  for (const field of ['tpms_soft_warning_rl', 'tpms_hard_warning_fr']) {
    const warned = {
      ...data,
      vehicle_state: { ...data.vehicle_state, [field]: true },
    };
    assert.equal(snapshotFromVehicleData(warned).tirePressureLow, true, field);
  }
});

test('a car without TPMS data publishes no tyre feature', () => {
  const data = fixture('vehicle_data_model3').response;
  const vehicleState = Object.fromEntries(
    Object.entries(data.vehicle_state).filter(([key]) => !key.startsWith('tpms_')),
  );
  const snapshot = snapshotFromVehicleData({ ...data, vehicle_state: vehicleState });
  assert.equal(hasTirePressures(snapshot), false);
  assert.equal(snapshot.tirePressureLow, undefined);
  assert.deepEqual(tirePressureOf(snapshot, 'bar'), {});
  const gladys = createFakeGladys();
  const device = buildVehicleDevice(gladys, fixture('products').response[0], {
    language: 'en',
    units: vehicleUnits('metric'),
  });
  assert.ok(!device.features.some((f) => f.external_id.includes(':tire-pressure')));
});

test('tyre features: four pressures and the alert, keys and bounds', () => {
  const gladys = createFakeGladys();
  const product = fixture('products').response[0];
  const build = (units) =>
    buildVehicleDevice(gladys, product, {
      language: 'fr',
      units: vehicleUnits(units),
      tires: true,
      tireWarning: true,
    });
  const device = build('metric');
  const tires = device.features.filter((f) => f.type === 'tire-pressure');
  assert.deepEqual(
    tires.map((f) => f.external_id.split(':').pop()),
    [
      'tire-pressure-front-left',
      'tire-pressure-front-right',
      'tire-pressure-rear-left',
      'tire-pressure-rear-right',
    ],
  );
  for (const f of tires) {
    assert.equal(f.category, 'electrical-vehicle-state');
    assert.equal(f.unit, 'bar');
    assert.equal(f.min, 0);
    assert.equal(f.max, 5);
    assert.equal(f.read_only, true);
    assert.equal(f.has_feedback, false);
  }
  assert.equal(tires[0].name, 'Pression pneu avant gauche');
  const low = device.features.find((f) => f.external_id.endsWith(':tire-pressure-low'));
  assert.equal(low.category, 'input');
  assert.equal(low.type, 'binary');
  assert.equal(low.has_feedback, false);
  const imperial = build('imperial').features.find((f) => f.type === 'tire-pressure');
  assert.equal(imperial.unit, 'psi');
  assert.equal(imperial.max, 70);
  // Existing features keep their ids: the tyres only add.
  const without = buildVehicleDevice(gladys, product, {
    language: 'fr',
    units: vehicleUnits('metric'),
  });
  assert.deepEqual(
    device.features.slice(0, without.features.length).map((f) => f.external_id),
    without.features.map((f) => f.external_id),
  );
});

test('tyre pressures from the stream, and the car pressure unit', () => {
  const snapshot = snapshotFromStreamData(
    {
      TpmsPressureFl: 2.9,
      TpmsPressureRr: '2.85',
      SettingTirePressureUnit: 'PressureUnitBar',
    },
    { tirePressureFr: 2.8, pressureUnit: 'psi' },
  );
  assert.equal(snapshot.tirePressureFl, 2.9);
  assert.equal(snapshot.tirePressureFr, 2.8, 'previous value kept');
  assert.equal(snapshot.tirePressureRr, 2.85);
  assert.equal(snapshot.pressureUnit, 'bar');
  for (const field of [
    'TpmsPressureFl',
    'TpmsPressureFr',
    'TpmsPressureRl',
    'TpmsPressureRr',
    'SettingTirePressureUnit',
  ]) {
    assert.ok(STREAMING_FIELDS.includes(field), field);
  }
});
