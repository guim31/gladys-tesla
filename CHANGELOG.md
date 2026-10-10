# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Changed

- The integration is now named **Teslemetry**, after the service it goes
  through (other Tesla services may get their own integration). The devices,
  their history, scenes and dashboards are unchanged.
- The Teslemetry access token is required again.

### Removed

- The Tesla Wall Connector, which moves to its own integration, **Tesla Wall
  Connector** (same device ids): the _Wall Connector addresses_ setting, the
  _Test the Wall Connectors_ action, the _Tesla Wall Connector_ widget and the
  four _Wall Connector_ scene triggers. A charger set up in 1.1.0 brings a
  reminder in the logs and the connection status for 30 days; its device is
  left alone.

## [1.1.0] - 2026-10-10

### Added

- Tesla Wall Connector gen 3, read locally on the home network, without
  Teslemetry and without a subscription: connector and charging state, status,
  charging power, session energy, a total energy index for the Gladys energy
  dashboard, grid voltage, vehicle current and handle temperature. One device
  per charger, identified by its serial number.
- A _Wall Connector addresses_ setting and a _Test the Wall Connectors_ action.
- A _Tesla Wall Connector_ dashboard widget.
- Wall Connector scene triggers, with the session energy: _car plugged in_,
  _car unplugged_, _started charging_, _charging finished_. The car triggers
  are unchanged.

### Changed

- The Teslemetry access token is optional: with only Wall Connectors
  configured, the integration publishes only them.

## [1.0.1] - 2026-10-09

### Added

- Tesla vehicles through Teslemetry: battery level, range, charging state and
  power, charge limit and charging current (adjustable), start / stop charging,
  plugged in, climate on / off and set temperature, inside and outside
  temperatures, lock / unlock, Sentry Mode, odometer, online or asleep. Units
  follow the car's display (miles / °F or km / °C) unless set otherwise.
- Tesla energy sites (Powerwall, solar): solar production, home consumption,
  signed grid power, battery charging and discharging, Powerwall charge, grid
  presence, operation mode (Self-Powered or Time-Based Control, adjustable) and
  cumulative kWh indexes. An optional home consumption index (off by default)
  feeds the Gladys energy dashboard.
- Real-time updates through the Teslemetry stream; reading never wakes a car.
- Dashboard widgets: _Tesla vehicle_ and _Tesla energy flow_.
- Scene triggers: charging started, charging complete, plugged in, unplugged,
  grid outage, grid restored. Scene action: set the Powerwall backup reserve.
- A _Test the connection_ action, showing the vehicles, energy sites, stream
  status and Teslemetry credit balance.

[Unreleased]: https://github.com/guim31/gladys-tesla/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/guim31/gladys-tesla/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/guim31/gladys-tesla/releases/tag/v1.0.1
