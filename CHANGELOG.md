# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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

[Unreleased]: https://github.com/guim31/gladys-tesla/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-tesla/releases/tag/v1.0.1
