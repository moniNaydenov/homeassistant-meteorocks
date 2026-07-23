"""Authenticated HTTP view serving coordinator data to the Lovelace card.

The public API has no CORS headers and the payloads are far too large for
entity attributes, so the card fetches the full channel payloads from this
view (HA session auth via hass.callApi) instead.
"""

from __future__ import annotations

from http import HTTPStatus

from homeassistant.components.http import HomeAssistantView
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import CONF_LATITUDE, CONF_LONGITUDE

from .const import DOMAIN


class MeteorocksDataView(HomeAssistantView):
    url = "/api/meteorocks/{entry_id}/data"
    name = "api:meteorocks:data"
    requires_auth = True

    async def get(self, request, entry_id: str):
        hass = request.app["hass"]
        entry = hass.config_entries.async_get_entry(entry_id)
        if (
            entry is None
            or entry.domain != DOMAIN
            or entry.state is not ConfigEntryState.LOADED
        ):
            return self.json_message("Unknown config entry", HTTPStatus.NOT_FOUND)

        coordinator = entry.runtime_data
        data = coordinator.data
        if data is None:
            return self.json_message("No data yet", HTTPStatus.SERVICE_UNAVAILABLE)

        return self.json(
            {
                "version": data.version,
                "servertime": data.servertime,
                "sat24url": data.sat24url,
                "current": data.current,
                "forecast": data.forecast,
                "nowcasting": data.nowcasting,
                "base_url": coordinator.api.base_url,
                "name": entry.title,
                "lat": entry.data[CONF_LATITUDE],
                "lon": entry.data[CONF_LONGITUDE],
                "language": coordinator.api.lang,
            }
        )
