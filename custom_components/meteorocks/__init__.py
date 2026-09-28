"""The Meteo.rocks integration."""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import (
    CONF_API_KEY,
    CONF_LATITUDE,
    CONF_LONGITUDE,
    Platform,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import MeteorocksApiClient
from .const import (
    CARD_FILENAME,
    CONF_BASE_URL,
    CONF_LANGUAGE,
    CONF_UPDATE_INTERVAL,
    DEFAULT_BASE_URL,
    DEFAULT_LANGUAGE,
    DEFAULT_UPDATE_INTERVAL,
    DOMAIN,
    STATIC_URL_BASE,
    VERSION,
)
from .coordinator import MeteorocksCoordinator
from .http import MeteorocksDataView

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.SENSOR, Platform.WEATHER]

type MeteorocksConfigEntry = ConfigEntry[MeteorocksCoordinator]


async def async_setup_entry(hass: HomeAssistant, entry: MeteorocksConfigEntry) -> bool:
    await _async_register_shared(hass)

    api = MeteorocksApiClient(
        async_get_clientsession(hass),
        entry.data.get(CONF_BASE_URL, DEFAULT_BASE_URL),
        entry.data[CONF_API_KEY],
        entry.data[CONF_LATITUDE],
        entry.data[CONF_LONGITUDE],
        lang=entry.options.get(CONF_LANGUAGE, DEFAULT_LANGUAGE),
    )
    coordinator = MeteorocksCoordinator(
        hass,
        entry,
        api,
        entry.options.get(CONF_UPDATE_INTERVAL, DEFAULT_UPDATE_INTERVAL),
    )
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_options_updated))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: MeteorocksConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


async def _async_options_updated(hass: HomeAssistant, entry: MeteorocksConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def _async_register_shared(hass: HomeAssistant) -> None:
    """One-time registration of the static card dir, the data view and the
    Lovelace resource. Runs on first entry setup."""
    if hass.data.get(f"{DOMAIN}_shared_registered"):
        return
    hass.data[f"{DOMAIN}_shared_registered"] = True

    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                STATIC_URL_BASE,
                str(Path(__file__).parent / "www"),
                cache_headers=True,
            )
        ]
    )
    hass.http.register_view(MeteorocksDataView())
    hass.async_create_task(_async_register_lovelace_resource(hass))


async def _async_register_lovelace_resource(hass: HomeAssistant) -> None:
    """Auto-add the bundled card as a Lovelace module resource (storage mode).

    Best-effort: the resource collection API is internal and has shifted across
    HA releases, so any failure only logs — YAML-mode users add the resource by
    hand as documented in the README.
    """
    url = f"{STATIC_URL_BASE}/{CARD_FILENAME}?v={VERSION}"
    try:
        lovelace = hass.data.get("lovelace")
        if lovelace is None:
            return
        # hass.data["lovelace"] is a dict up to HA 2025.1 and a dataclass later.
        if isinstance(lovelace, dict):
            resources = lovelace.get("resources")
        else:
            resources = getattr(lovelace, "resources", None)
        # Only the storage-mode collection accepts new items. Checked on the
        # collection itself: the dataclass' "mode" field was renamed to
        # "resource_mode" in HA 2026, which made a mode check skip registration.
        if resources is None or not hasattr(resources, "async_create_item"):
            _LOGGER.debug("Lovelace resources not in storage mode; add the card resource manually")
            return
        if not resources.loaded:
            await resources.async_load()
            # Same as HA core does after loading; otherwise the collection is
            # loaded again on its first use.
            resources.loaded = True

        for item in resources.async_items():
            if item.get("url", "").split("?")[0] == f"{STATIC_URL_BASE}/{CARD_FILENAME}":
                if item["url"] != url:
                    await resources.async_update_item(item["id"], {"url": url})
                    _LOGGER.debug("Updated Lovelace resource to %s", url)
                return
        await resources.async_create_item({"res_type": "module", "url": url})
        _LOGGER.debug("Registered Lovelace resource %s", url)
    except Exception:  # noqa: BLE001
        _LOGGER.warning(
            "Could not register the meteorocks-card Lovelace resource automatically; "
            "add %s as a module resource manually",
            url,
            exc_info=True,
        )
