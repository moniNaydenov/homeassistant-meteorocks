# Meteo.rocks for Home Assistant

A Home Assistant integration for [meteo.rocks](https://meteo.rocks) — Bulgarian weather
station network and forecasting platform. Uses the key-gated public API and ships with a
custom Lovelace card that replicates the site's forecast page: current conditions,
30-minute precipitation nowcast, multi-day/hourly forecast, the animated nowcasting radar
map and the satellite image.

## What you get

- **Weather entity** with current conditions plus daily and hourly forecasts
  (works with any standard weather card and `weather.get_forecasts`).
- **Sensors**: temperature, pressure, wind speed/gust/bearing, condition text,
  precipitation in the next hour, rain warning level and text, sunrise/sunset,
  moon phase, plus diagnostics (model run age, nowcast start).
- **`meteorocks-card`**: a custom Lovelace card with the exact meteo.rocks look —
  Meteocons icons, temperature-ramp chips, wind gauge, nowcast bar chart,
  day/hour forecast tables, Leaflet radar map with frame animation, sat24 image.

## Requirements

- Home Assistant 2024.12 or newer.
- A meteo.rocks **API key** with access to the `current`, `forecast` and `nowcasting`
  channels. Keys are issued by the site administrators — contact meteo.rocks.

## Installation

### HACS (recommended)

1. HACS → Integrations → ⋮ → *Custom repositories*.
2. Add `https://github.com/moninaydenov/homeassistant-meteorocks` as an **Integration**.
3. Install *Meteo.rocks*, restart Home Assistant.

### Manual

Copy `custom_components/meteorocks/` into your HA `config/custom_components/` directory
and restart.

## Configuration

Settings → Devices & Services → **Add Integration** → *Meteo.rocks*.

| Field | Meaning |
|---|---|
| API key | Your meteo.rocks API key |
| Location | Picked on the map; snaps to the nearest point of interest server-side |
| Name | Entity/device name (e.g. the town) |
| Data language | Bulgarian (default) or English — affects all texts in payloads and the card |
| Site URL | Leave `https://meteo.rocks` unless you run your own instance |

Options (gear icon on the integration): polling interval (30–600 s, default 60) and
language. Polling uses the API's change-key convention, so unchanged polls are cheap —
one metered API call per poll regardless of how many channels are requested.

## The card

The integration serves and auto-registers the card when Lovelace runs in storage mode
(the default). Add it from the card picker (*Meteo.rocks*) — the visual editor lets you
pick the weather entity, the appearance (auto/dark/light), whether the current-conditions
icon is animated, and toggle each section (current weather, 30-min rain, forecast, radar
map, satellite) **per card**, so you can e.g. place one card with only the map and
another with only the current conditions.

The equivalent YAML:

```yaml
type: custom:meteorocks-card
entity: weather.meteo_rocks
# optional:
dark_mode: auto        # auto (follow HA theme) | true | false
animated_icons: false  # animate the current-conditions icon (see below)
sections:              # all default to true
  current: true
  nowcast: true
  forecast: true
  map: true
  satellite: true
tap_action:            # standard HA action; default: more-info on the weather entity
  action: more-info
hold_action:           # default: none
  action: none
```

`tap_action`/`hold_action` accept every standard Home Assistant action (`more-info`,
`navigate`, `url`, `perform-action`, `assist`, `none`, ...). They fire on the sections
that have no controls of their own — the current-conditions card, the nowcast bar chart
and the satellite image. The forecast tables, the radar map and its timeline keep their
built-in interactions (day selection, pan/zoom, frame stepping).

`animated_icons` is off by default: the animated Meteocons icon is redrawn by the
browser every frame for as long as the card is on screen, which is a constant CPU
load on wall tablets and kiosk displays. The static icon costs nothing once drawn.

If you manage Lovelace resources in YAML mode, add the resource manually:

```yaml
lovelace:
  resources:
    - url: /meteorocks_static/meteorocks-card.js
      type: module
```

## Notes

- The radar map loads tiles from `tiles.meteo.rocks` and OpenStreetMap directly in the
  browser; everything else flows through Home Assistant (the card never calls the
  meteo.rocks API from the browser).
- If the API key is deactivated, the integration raises a re-authentication flow.
- The integration icon and logo ship in `custom_components/meteorocks/brand/` and show up
  on Home Assistant 2026.3 or newer; older versions show a generic placeholder.

## License

MIT. Bundled assets: [Leaflet](https://leafletjs.com) (BSD-2-Clause),
[Meteocons](https://bas.dev/work/meteocons) by Bas Milius (MIT).
