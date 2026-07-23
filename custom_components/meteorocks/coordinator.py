"""Data update coordinator for the Meteo.rocks integration."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import MeteorocksApiClient, MeteorocksApiError, MeteorocksAuthError
from .const import CHANNELS, DOMAIN

_LOGGER = logging.getLogger(__name__)

# channel name -> (payload key holding the change key, request parameter name)
CHANGE_KEYS = {
    "current": ("key", "current_key"),
    "forecast": ("lastmodelrun", "forecast_lastmodelrun"),
    "nowcasting": ("timestamp_start", "nowcasting_timestart"),
}


@dataclass
class MeteorocksData:
    """Latest full payloads of all channels."""

    current: dict[str, Any] = field(default_factory=dict)
    forecast: dict[str, Any] = field(default_factory=dict)
    nowcasting: dict[str, Any] = field(default_factory=dict)
    sat24url: str | None = None
    servertime: int = 0
    # Bumped only when a channel actually changed; the card watches this via the
    # weather entity's data_version attribute and refetches on change.
    version: int = 0


class MeteorocksCoordinator(DataUpdateCoordinator[MeteorocksData]):
    """Polls the public API, replaying change keys for cheap unchanged answers."""

    config_entry: ConfigEntry

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        api: MeteorocksApiClient,
        update_interval: int,
    ) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN} {entry.title}",
            config_entry=entry,
            update_interval=timedelta(seconds=update_interval),
        )
        self.api = api

    async def _async_update_data(self) -> MeteorocksData:
        state: dict[str, Any] = {}
        if self.data:
            for channel, (payload_key, param) in CHANGE_KEYS.items():
                value = getattr(self.data, channel).get(payload_key, 0)
                if value:
                    state[param] = value

        try:
            raw = await self.api.fetch(CHANNELS, state)
        except MeteorocksAuthError as err:
            raise ConfigEntryAuthFailed from err
        except MeteorocksApiError as err:
            raise UpdateFailed(str(err)) from err

        changed = False
        merged: dict[str, dict[str, Any]] = {}
        for name in CHANNELS:
            payload = raw.get("channels", {}).get(name)
            previous = getattr(self.data, name) if self.data else {}
            if not isinstance(payload, dict) or payload.get("error"):
                # Never wipe last-known-good data on a channel error.
                if isinstance(payload, dict):
                    _LOGGER.debug("Channel %s error: %s", name, payload.get("error"))
                merged[name] = previous
            elif payload.get("unchanged"):
                # Freshened fields (lastmodelrunsince etc.) ride along on
                # unchanged responses — merge them into the kept payload.
                kept = dict(previous)
                kept.update({k: v for k, v in payload.items() if k != "unchanged"})
                merged[name] = kept
            else:
                merged[name] = payload
                changed = True

        sat24url = raw.get("sat24url")
        if sat24url and sat24url.startswith("/"):
            sat24url = f"{self.api.base_url}{sat24url}"

        version = self.data.version if self.data else 0
        if changed or not self.data:
            version += 1

        return MeteorocksData(
            current=merged["current"],
            forecast=merged["forecast"],
            nowcasting=merged["nowcasting"],
            sat24url=sat24url,
            servertime=raw.get("servertime", 0),
            version=version,
        )
