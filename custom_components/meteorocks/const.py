"""Constants for the Meteo.rocks integration."""

from __future__ import annotations

DOMAIN = "meteorocks"
VERSION = "1.0.3"
ATTRIBUTION = "Data provided by meteo.rocks"

DEFAULT_BASE_URL = "https://meteo.rocks"
DEFAULT_NAME = "Meteo.rocks"
DEFAULT_LANGUAGE = "bg"
DEFAULT_UPDATE_INTERVAL = 60
MIN_UPDATE_INTERVAL = 30
MAX_UPDATE_INTERVAL = 600

CONF_BASE_URL = "base_url"
CONF_POI = "poi"
CONF_LANGUAGE = "language"
CONF_UPDATE_INTERVAL = "update_interval"

LANGUAGES = ["bg", "en"]

CHANNELS = ["current", "forecast", "nowcasting"]

# URL prefix the integration's www/ directory is served under.
STATIC_URL_BASE = "/meteorocks_static"
CARD_FILENAME = "meteorocks-card.js"

# Payload `weathericon` (Meteocons name) -> Home Assistant weather condition.
# Covers every icon the site's providers emit (s/pix/meteocons/*.svg).
CONDITION_MAP: dict[str, str | None] = {
    "clear-day": "sunny",
    "clear-night": "clear-night",
    "mostly-clear-day": "sunny",
    "mostly-clear-night": "clear-night",
    "partly-cloudy-day": "partlycloudy",
    "partly-cloudy-night": "partlycloudy",
    "cloudy": "cloudy",
    "overcast": "cloudy",
    "overcast-day": "cloudy",
    "overcast-night": "cloudy",
    "fog-day": "fog",
    "fog-night": "fog",
    "mist": "fog",
    "haze-day": "fog",
    "haze-night": "fog",
    "drizzle": "rainy",
    "rain": "rainy",
    "partly-cloudy-day-drizzle": "rainy",
    "partly-cloudy-night-drizzle": "rainy",
    "partly-cloudy-day-rain": "rainy",
    "partly-cloudy-night-rain": "rainy",
    "overcast-day-rain": "rainy",
    "overcast-night-rain": "rainy",
    "extreme-rain": "pouring",
    "sleet": "snowy-rainy",
    "snow": "snowy",
    "extreme-snow": "snowy",
    "wind-snow": "snowy",
    "partly-cloudy-day-snow": "snowy",
    "partly-cloudy-night-snow": "snowy",
    "overcast-day-snow": "snowy",
    "overcast-night-snow": "snowy",
    "hail": "hail",
    "partly-cloudy-day-hail": "hail",
    "partly-cloudy-night-hail": "hail",
    "thunderstorms-day": "lightning",
    "thunderstorms-night": "lightning",
    "thunderstorms-rain": "lightning-rainy",
    "thunderstorms-extreme-rain": "lightning-rainy",
    "wind": "windy",
    "not-available": None,
}


def as_float(value, default: float = 0.0) -> float:
    """Parse a payload number that may be a formatted string or the '&#45;' dash."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return default
