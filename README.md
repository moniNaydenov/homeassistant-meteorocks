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
(the default). Add it to a dashboard:

```yaml
type: custom:meteorocks-card
entity: weather.meteo_rocks
# optional:
dark_mode: auto        # auto (follow HA theme) | true | false
sections:              # all default to true
  current: true
  nowcast: true
  forecast: true
  map: true
  satellite: true
```

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

## License

MIT. Bundled assets: [Leaflet](https://leafletjs.com) (BSD-2-Clause),
[Meteocons](https://bas.dev/work/meteocons) by Bas Milius (MIT).
