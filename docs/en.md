# Tesla (Teslemetry and Wall Connector)

Follow and control your Tesla cars, your Powerwall and your solar panels from
Gladys: battery, range, charging, climate, locks, Sentry Mode, and the energy
flows of your home in real time. A **Tesla Wall Connector (gen 3)** is read
directly on your home network: no Teslemetry, no subscription.

> **Developed without the hardware: feedback welcome.** This integration was
> built without a car, a Powerwall or a Teslemetry account, and tested on
> sample API answers adapted from the Home Assistant Teslemetry integration's
> tests and the Tesla Fleet API documentation. The Wall Connector support was
> built without a charger, on the sample answers of the `tesla-wall-connector`
> library's tests. If something looks wrong, please say so on the Gladys forum.

This integration is not affiliated with Tesla, Inc. or Teslemetry.

## How it connects

Tesla's official API (the Fleet API) is meant for developers: each user would
have to register a developer application, host a public key on a web domain
and sign every command. **Teslemetry** does all of that for you and gives you a
single access token. It is a **paid service** with a subscription per vehicle
and per energy site (see [teslemetry.com/pricing](https://teslemetry.com/pricing)),
with a monthly allowance of command credits included.

Reading data **never wakes your car**. A sleeping car keeps its last known
values in Gladys; only a command you send (start charging, climate, lock…)
wakes it up.

## What you need

- Gladys **5.1** or later.
- For a **Wall Connector only**: nothing else than its address on your network
  (see [Your Wall Connector](#your-wall-connector-local-no-subscription)). The
  rest of this list is for the cars and the Powerwall.
- A [Teslemetry](https://teslemetry.com) account linked to your Tesla account,
  with a subscription for each car and energy site you want in Gladys.
- For commands: the Teslemetry **virtual key** added to each car (Teslemetry
  guides you through it, it takes a minute from the Tesla app).
- For real-time car data: Fleet Telemetry streaming, which recent cars support
  (it needs a recent software version; pre-2021 Model S and Model X do not
  stream). Cars without streaming still work, from Teslemetry's cached data.

## Setup

1. In the Teslemetry console, create an **access token** with access to your
   vehicles and energy sites. Copy it.
2. In Gladys, open the **Configuration** tab of the Tesla integration, paste
   the token in **Teslemetry access token**, check the other settings, save.
3. Open the **Discovery** tab: each car and each energy site is listed. Add the
   ones you want.
4. Optional: click **Test the connection** to see what Teslemetry gives access
   to, and whether the real-time stream is connected.

The integration also turns on, in Teslemetry, the streaming of the few car
values it reads (battery, range, charging, climate, locks, Sentry Mode,
odometer, display units). It only adds fields, it never removes yours.

### Settings

| Setting                                               | What it does                                                                                                                                                                                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Units**                                             | Units of distances and temperatures **as stored and compared by scenes**: the car's own display setting (default), miles and °F, or kilometers and °C. The dashboard always shows each user's preferred units, whatever you pick. |
| **Device names language**                             | English or French names for the features of new devices. Gladys keeps a feature's name once the device is created.                                                                                                                |
| **Backup refresh of the cars**                        | How often an **awake** car that streams nothing is read (30 or 60 minutes, or never). Never while the car sleeps.                                                                                                                 |
| **Send the home consumption to the energy dashboard** | Off by default. Adds the home consumption index to Powerwall sites (see below).                                                                                                                                                   |
| **Wall Connector addresses**                          | IP address (or host name) of each Wall Connector gen 3, separated by commas. With only this filled in, the Teslemetry token can stay empty.                                                                                       |

Changing **Units** on a car you already added: the Discovery tab offers an
**Update** for it. Until you accept, the car keeps being published in its
former units, so nothing gets mixed up.

## Your cars

| Feature                      | Details                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| Battery level                | %                                                                                  |
| Range                        | Rated range, in miles or km                                                        |
| Charging state               | Charging, connected, paused by the car, paused by the charger (no power), idle     |
| Charging power               | kW, AC or DC (Supercharger)                                                        |
| Charge limit                 | 50 to 100 %, **adjustable**                                                        |
| Charging                     | **Start / stop** charging                                                          |
| Charging current             | Amps requested from the charger, **adjustable** (handy to charge on solar surplus) |
| Plugged in                   | Yes / no                                                                           |
| Climate                      | **On / off**                                                                       |
| Climate set temperature      | **Adjustable**, 59–82 °F (15–28 °C)                                                |
| Inside / outside temperature | °F or °C                                                                           |
| Locked                       | **Lock / unlock**                                                                  |
| Sentry Mode                  | **On / off**                                                                       |
| Odometer                     | Miles or km                                                                        |
| Online (awake)               | On when the car is awake, off while it sleeps or is out of coverage                |

The car's location is **never read** by this version of the integration.

## Your Powerwall and solar panels

Each energy site gets the features of what it has: a solar-only site has no
battery features, a Powerwall without panels no solar ones.

| Feature                        | Details                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| Solar production               | W                                                                                       |
| Home consumption               | W, as measured by the gateway                                                           |
| Grid (import +, export −)      | W, **signed**: positive when you draw from the grid, negative when you send power to it |
| Battery charging / discharging | W, two features (both positive)                                                         |
| Powerwall charge               | %                                                                                       |
| Grid connected                 | Off during an outage (the house runs on the Powerwall)                                  |
| Operation mode                 | Self-Powered or Time-Based Control, **adjustable**                                      |
| Energy indexes                 | Cumulative kWh: solar production, grid import and export, battery (home: see below)     |

Backup-only is not offered: Tesla withdrew it on many sites. A site set to it
from the Tesla app shows "Backup-only" in the energy widget.

The **home consumption index** is **off by default**: turn on **Send the home
consumption to the energy dashboard** in the settings, then accept the
**Update** of the site in the Discovery tab. Gladys then computes the
consumption per half hour and its cost from it, with your energy contract.
Gladys attaches it to the main electric meter you set in the energy settings:
if your utility meter is already in Gladys, the Powerwall measures the same
house, so leave the option off rather than counting the house twice. The
index keeps counting while the option is off, so turning it on later does not
start from zero. The indexes start counting when the
integration is installed: Tesla does not give lifetime totals, they are built
from the daily totals Teslemetry streams.

## Your Wall Connector (local, no subscription)

The **Tesla Wall Connector gen 3** answers on your home network, without an
account and without a password. Gladys reads it there directly: no Teslemetry,
no subscription, no cloud. This works on its own (leave the Teslemetry token
empty) or next to your cars.

1. Find the charger's IP address in your router (it is on your Wi-Fi), and
   give it a **fixed address** there, so it does not change.
2. In the **Configuration** tab, type it in **Wall Connector addresses**
   (several chargers: separate them with commas), save.
3. Click **Test the Wall Connectors**: each address shows the charger's serial
   number end, firmware and state, or why it does not answer.
4. Add the charger from the **Discovery** tab.

The charger is identified by its serial number: if its IP address changes,
type the new one and the same device goes on, with its history.

| Feature                | Details                                                                   |
| ---------------------- | ------------------------------------------------------------------------- |
| Connector              | Available, occupied (a car is plugged in), unavailable, faulted           |
| Charging state         | Charging, vehicle connected, paused by the car, idle                      |
| Status                 | The charger's own state in words (ready, negotiating, charging finished…) |
| Charging power         | W                                                                         |
| Session energy         | kWh delivered since the car was plugged in                                |
| Total energy delivered | Cumulative kWh index, for the Gladys energy dashboard                     |
| Grid voltage, current  | V, A                                                                      |
| Handle temperature     | °C, or °F on a North American charger (or as set in **Units**)            |

It is read every **15 seconds** (the lifetime counter every minute), and only
what changed is sent to Gladys. After three missed reads in a row the charger
shows as unreachable.

The **total energy** index is the charger's own lifetime counter. Gladys
derives the consumption per half hour and its cost from it, and files it under
your main electric meter: the charger is one of the loads of the house, it is
not counted twice.

The charger reports voltages and currents, not the power: it is computed per
phase (three-phase in Europe), or as grid voltage × current on a North
American 240 V split-phase supply (recognized by its 60 Hz grid).

## Dashboard

Three widgets (Gladys 5.1+), each set up with the device it shows:

- **Tesla vehicle**: battery, range, charging power and cabin temperature in
  real time, the charging, climate, locks, Sentry Mode and online status, and
  buttons to start or stop the climate, start or stop charging (when the car is
  plugged in), lock or unlock (unlocking asks for a confirmation).
- **Tesla energy flow**: solar, home, grid and Powerwall in real time, the last
  24 hours as a chart, the grid status, operation mode, backup reserve and
  Storm Watch.
- **Tesla Wall Connector**: charging power, session and total energy, current,
  the charger's state, the plugged car and the session duration. No button: the
  charger's local API only reads.

## Scenes

Triggers (each one optionally limited to one car, charger or energy site):

- **Tesla started charging**, **Tesla charging complete**,
  **Tesla plugged in**, **Tesla unplugged** — seen by a car (with its battery
  level) or by a Wall Connector (with the session energy, in kWh).
- **Grid outage (Powerwall)** and **Grid restored (Powerwall)** — with the
  Powerwall charge, and whether the outage is an intentional "go off-grid".

Action:

- **Set the Powerwall backup reserve** — for example 100 % when a storm is
  announced, back to 20 % after.

Every car feature above can also be used in scenes the usual way ("when the
battery is below 30 %", "start the climate at 7:30", "set the charge limit to
90 %"…).

## Data freshness and Teslemetry costs

What follows are Teslemetry's published rules (2026). **They could not be
measured on a real account during development**: to see your own costs, the
integration writes a line in its logs for every billed call, with your
remaining balance (`Teslemetry credits: … cost 1, balance 498`), and **Test the
connection** shows the balance.

| What                                                    | When                                                                     | Cost                                                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Real-time stream (cars, Powerwall, daily energy totals) | Continuously, one connection for the whole account                       | Included in the subscriptions, no credit                                                                    |
| Car read at startup                                     | Once per car when the integration starts                                 | Free from Teslemetry's cache; up to 2 credits if the car is awake and its cache older than about 20 minutes |
| Backup car read                                         | An awake car that streamed nothing for the chosen delay (30 min default) | Same as above. Never for a sleeping car, and never for a car that streams                                   |
| Vehicle list, Powerwall status                          | Every 15 / 10 minutes, **only while the stream is down**                 | Expected free (read calls, unverified)                                                                      |
| Command (charge, climate, lock, charge limit, reserve…) | When you ask                                                             | 1 credit; if the car sleeps, it is woken first (about 20 more credits)                                      |

In practice, with a streaming car, the integration's own cost is the commands
you send. Teslemetry's monthly allowance is 500 credits per vehicle and per
energy site: about 500 commands to an awake car, or about 24 to a sleeping one.
Gladys acknowledges a command after 4 seconds even if the car is still waking
up; the command goes on and its result shows when the car answers.

## Limitations

- Developed without a car, a Powerwall or a Teslemetry account (see above).
- No location, no navigation, no trunk, windows or seat heaters in this version.
- Gladys has no signed battery power: the Powerwall power is split into
  "charging" and "discharging". The backup reserve has no device feature
  either: it is shown in the energy widget and set with the scene action.
- Older cars without Fleet Telemetry are refreshed from Teslemetry's cache
  only (every 30 or 60 minutes while awake).
- Feature names are set when the device is created and do not follow later
  language changes.
- The Wall Connector is read-only: its local API does not start, stop or limit
  a charge (do it from the car). Only the gen 3 has this local API; the gen 2
  and the Universal Wall Connector are not supported. Developed without a
  charger: the power computation and the states await a field check.

## Troubleshooting

- **"Teslemetry refused the access token"**: the token was mistyped, revoked
  or expired. Create a new one in the Teslemetry console.
- **"A subscription is required"**: the car or site has no active Teslemetry
  subscription.
- **A command fails with "vehicle unavailable"**: the car is out of coverage,
  or the virtual key is not installed on it.
- **Car values only change every 30 minutes**: the car does not stream. Check
  that streaming is on for it in the Teslemetry console and that its software
  is up to date.
- **A Wall Connector does not answer**: check its IP address in your router and
  that it is on the Wi-Fi; click **Test the Wall
  Connectors**. Gladys must be on the same network.
- The integration logs everything it does: open its logs from the Gladys UI,
  with `LOG_LEVEL=debug` for the full detail. Tokens are never logged.
