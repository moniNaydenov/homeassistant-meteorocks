"""Client for the meteo.rocks public API (s/api/public.php)."""

from __future__ import annotations

import asyncio
from typing import Any

import aiohttp

from .const import CHANNELS


class MeteorocksApiError(Exception):
    """Generic API error."""


class MeteorocksAuthError(MeteorocksApiError):
    """Invalid or inactive API key."""


class MeteorocksChannelError(MeteorocksApiError):
    """The key lacks access to a required channel."""


class MeteorocksApiClient:
    """Thin async client around the key-gated public endpoint.

    The endpoint serves named channels in one request; channel state parameters
    are flat-prefixed with the channel name (current_key, forecast_lastmodelrun,
    nowcasting_timestart) and let the server answer {unchanged: true} cheaply.
    """

    def __init__(
        self,
        session: aiohttp.ClientSession,
        base_url: str,
        api_key: str,
        lat: float,
        lon: float,
        poi: int | None = None,
        lang: str = "bg",
    ) -> None:
        self._session = session
        self.base_url = base_url.rstrip("/")
        self._api_key = api_key
        self.lat = lat
        self.lon = lon
        self.poi = poi
        self.lang = lang

    async def fetch(
        self, channels: list[str], state: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """Fetch the given channels, replaying last-seen change keys from state."""
        params: dict[str, str] = {
            "channels": ",".join(channels),
            "lat": f"{self.lat}",
            "lon": f"{self.lon}",
            "lang": self.lang,
        }
        if self.poi:
            params["poi"] = str(self.poi)
        for key, value in (state or {}).items():
            params[key] = str(value)

        try:
            async with self._session.get(
                f"{self.base_url}/s/api/public.php",
                params=params,
                headers={"X-API-Key": self._api_key},
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                if resp.status == 401:
                    raise MeteorocksAuthError("Invalid or missing API key")
                if resp.status != 200:
                    raise MeteorocksApiError(f"HTTP {resp.status}")
                data = await resp.json(content_type=None)
        except (aiohttp.ClientError, asyncio.TimeoutError) as err:
            raise MeteorocksApiError(f"Connection error: {err}") from err

        if not isinstance(data, dict) or not data.get("success"):
            raise MeteorocksApiError("Malformed API response")
        return data

    async def async_validate(self) -> None:
        """Validate the key and its channel grants (used by the config flow)."""
        data = await self.fetch(CHANNELS)
        for name in CHANNELS:
            payload = data.get("channels", {}).get(name)
            if isinstance(payload, dict) and payload.get("error") == "Access denied for this channel":
                raise MeteorocksChannelError(name)
