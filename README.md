# Tesla for Gladys Assistant (Teslemetry and Wall Connector)

A [Gladys Assistant](https://gladysassistant.com) external integration for
**Tesla cars, Powerwall and solar**, through
[Teslemetry](https://teslemetry.com), a relay of the official Tesla Fleet API,
and for the **Tesla Wall Connector gen 3**, read locally on the home network
with no account and no subscription.

> **Developed without the hardware: feedback welcome.** No car, Powerwall or
> Teslemetry account was used. The tests run on fixtures adapted from the test
> data of the Home Assistant Teslemetry integration and of the
> `teslemetry-stream` library, completed by hand after the Tesla Fleet API
> documentation (anonymized: fake VINs, identifiers and names). The Wall
> Connector support was built without a charger, on the sample answers of the
> `tesla-wall-connector` library's tests (anonymized serial numbers and
> addresses). Reports from owners are very welcome on the Gladys forum.

**Not affiliated with Tesla, Inc. or Teslemetry.** Tesla, Powerwall, Model 3,
Model Y, Model S, Model X and Cybertruck are trademarks of Tesla, Inc.

## What it does

**Cars** (Model 3, Model Y, Model S, Model X, Cybertruck): battery level,
range, charging state and power, charge limit and charging current
(adjustable), start / stop charging, plugged in, climate on / off and set
temperature, inside and outside temperatures, lock / unlock, Sentry Mode,
odometer, online or asleep. Distances and temperatures in miles and °F or in
km and °C, following the car's display by default. The car's location is never
read.

**Energy sites** (Powerwall 2, Powerwall 3, Powerwall+, solar-only sites):
solar production, home consumption, signed grid power (import +, export −),
battery charging and discharging, Powerwall charge, grid presence, operation
mode (adjustable), and cumulative kWh indexes. An optional home consumption
index (off by default, to avoid counting the house twice next to a utility
meter) feeds the Gladys energy dashboard (30-minute consumption and cost are
derived by Gladys).

**Wall Connector gen 3** (local, works without Teslemetry): connector and
charging state, status text, charging power, session energy, a lifetime kWh
index for the Gladys energy dashboard, grid voltage, vehicle current, handle
temperature. Read every 15 s on the home network; identified by its serial
number, not its IP address. Read-only (its local API takes no command).

**Dashboard widgets** (Gladys 5.1+): a _Tesla vehicle_ card, a _Tesla energy
flow_ card and a _Tesla Wall Connector_ card. **Scene triggers**: charging
started / complete, plugged in / unplugged (for a car, and the same four for a
Wall Connector), grid outage / restored. **Scene action**: set the Powerwall backup
reserve.

The user documentation, with the full feature list, the setup and the costs, is
in [`docs/en.md`](docs/en.md) ([`docs/fr.md`](docs/fr.md) in French); Gladys
links to it from the integration's Configuration screen.

## Prerequisites

- Gladys **5.1.0** or later.
- Wall Connector only: its IP address on the home network, nothing else.
- Cars and energy sites: a Teslemetry account (paid subscription per vehicle and per energy site)
  linked to the Tesla account, and an access token from the Teslemetry
  console.
- For commands, the Teslemetry virtual key installed on each car.

## Installation

From Gladys: **Integrations → Store → Tesla → Install**, then, in the
**Configuration** tab, paste the Teslemetry access token and/or the Wall
Connector addresses, and add the discovered devices from the **Discovery**
tab.

## How it works

Why Teslemetry: the Fleet API requires every user to register a Tesla
developer application, host a public key on a domain and sign commands.
Teslemetry handles all of it behind a single token.

- One **Server-Sent Events stream** (`https://api.teslemetry.com/sse`) carries
  the whole account in real time: Fleet Telemetry deltas pushed by the cars,
  their online / asleep state, the Powerwall `live_status` and `site_info`,
  the daily energy totals and the credit balance. Streaming is included in the
  Teslemetry subscriptions.
- **REST reads** only at startup (Teslemetry's cached `vehicle_data`, which
  never wakes a car) and as a slow fallback: an awake car that streams nothing
  is read every 30 or 60 minutes (configurable), the products and the
  energy sites every 15 / 10 minutes while the stream is down.
- **Commands** go through the Fleet API endpoints relayed by Teslemetry, which
  signs them and wakes the car when needed. Nothing else ever wakes a car.
- Only **changed** states are published to Gladys, and every state is
  re-published when a device is created (Gladys drops the states of features
  that do not exist yet).
- Cumulative **energy indexes** are rebuilt from the daily totals and
  persisted under `/data`, so a restart never resets them.
- **Wall Connectors** answer `http://<address>/api/1/vitals`, `/lifetime` and
  `/version` on the home network, without authentication (gen 3 firmware). The
  client repairs the firmware's known JSON glitches (`nan` values, a missing
  closing brace), reads every 15 s, flags a charger unreachable after 3 missed
  reads (transport badge), and publishes the device under its serial number.
  Without a Teslemetry token, no Teslemetry client nor stream is started.

```
index.js                   SDK wiring only
src/tesla.js               runtime: discovery, stream, fallback reads, commands, triggers
src/teslemetry/client.js   REST client (errors classified, token never logged)
src/teslemetry/stream.js   SSE client (reconnect with backoff, idle timeout)
src/devices/vehicle.js     car features, parsing (vehicle_data + stream), commands
src/devices/energySite.js  energy site features, parsing (live_status, site_info)
src/devices/wallConnector.js  Wall Connector features, power, charge session states
src/wallConnector/client.js   Wall Connector local HTTP client (JSON quirks, addresses)
src/energyIndex.js         cumulative kWh indexes from daily totals
src/widgets.js             dashboard widgets
src/scenes.js              scene action
src/triggers.js            scene triggers (transitions)
src/store.js               JSON persistence under /data
test/                      node --test, fixtures in test/fixtures/{teslemetry,wall-connector}/
```

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store .   # store admission checks
```

`test/gladys-rules.test.js` checks every discovered device (several car models,
Powerwall 2 and 3, with and without solar, Wall Connectors in Europe and North
America, with and without a Teslemetry token) against the feature table of the
Gladys core (`test/fixtures/gladys-feature-table.json`). Tests never touch the
network. To run against a real Gladys:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="tesla" \
DATA_DIR=./data LOG_LEVEL=debug \
npm start
```

## Releasing

Releases are cut by the **Release** workflow (Actions → Release): it bumps the
version in `package.json` and the manifest, moves the `## [Unreleased]` section
of [`CHANGELOG.md`](CHANGELOG.md), tags, builds the multi-arch image to
`ghcr.io/guim31/gladys-tesla` and publishes the GitHub Release. Never edit the
versions by hand.

> A hand-pushed tag (`git tag vX.Y.Z && git push --tags`) triggers the same
> build and GitHub Release, but does not touch the files: bump `version` in
> `package.json` and in `gladys-assistant-integration.json` (with the
> `docker_image` tag) and commit it **before** tagging.

## Credits

- Started from the official
  [Gladys JavaScript integration template](https://github.com/GladysAssistant/integration-template-js)
  and built on [`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).
- The API behavior, field names and test fixtures follow the
  [Home Assistant Teslemetry integration](https://github.com/home-assistant/core/tree/dev/homeassistant/components/teslemetry)
  (Apache 2.0, by Brett Adams, @Bre77, and the Home Assistant contributors), and the
  [`tesla-fleet-api`](https://github.com/Teslemetry/python-tesla-fleet-api) and
  [`teslemetry-stream`](https://github.com/Teslemetry/python-teslemetry-stream)
  Python libraries (Apache 2.0, Brett Adams / Teslemetry). Fixtures derived from their tests
  are anonymized (fake VINs, identifiers and names).
- The Wall Connector local API, its quirks and test answers follow the
  [`tesla-wall-connector`](https://github.com/einarhauks/tesla-wall-connector)
  Python library (MIT; its license, which covers the fixtures derived from its
  tests, is in [`test/fixtures/wall-connector/LICENSE`](test/fixtures/wall-connector/LICENSE)) and the
  [Home Assistant Tesla Wall Connector integration](https://github.com/home-assistant/core/tree/dev/homeassistant/components/tesla_wall_connector)
  (Apache 2.0, @einarhauks, @sarabveer and the Home Assistant contributors).
- Tesla Fleet API documentation: <https://developer.tesla.com/docs/fleet-api>.

## License

Apache-2.0
