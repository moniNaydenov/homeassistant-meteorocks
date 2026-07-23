"""Config flow for the Meteo.rocks integration."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.const import (
    CONF_API_KEY,
    CONF_LATITUDE,
    CONF_LOCATION,
    CONF_LONGITUDE,
    CONF_NAME,
)
from homeassistant.core import callback
from homeassistant.helpers import selector
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import (
    MeteorocksApiClient,
    MeteorocksApiError,
    MeteorocksAuthError,
    MeteorocksChannelError,
)
from .const import (
    CONF_BASE_URL,
    CONF_LANGUAGE,
    CONF_UPDATE_INTERVAL,
    DEFAULT_BASE_URL,
    DEFAULT_LANGUAGE,
    DEFAULT_NAME,
    DEFAULT_UPDATE_INTERVAL,
    DOMAIN,
    LANGUAGES,
    MAX_UPDATE_INTERVAL,
    MIN_UPDATE_INTERVAL,
)

_LOGGER = logging.getLogger(__name__)


class MeteorocksConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle the initial and reauth config flows."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        errors: dict[str, str] = {}

        if user_input is not None:
            location = user_input[CONF_LOCATION]
            lat = round(location[CONF_LATITUDE], 4)
            lon = round(location[CONF_LONGITUDE], 4)
            error = await self._validate(
                user_input[CONF_BASE_URL], user_input[CONF_API_KEY],
                lat, lon, user_input[CONF_LANGUAGE],
            )
            if error:
                errors["base"] = error
            else:
                await self.async_set_unique_id(f"{lat:.4f}-{lon:.4f}")
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title=user_input[CONF_NAME],
                    data={
                        CONF_API_KEY: user_input[CONF_API_KEY],
                        CONF_LATITUDE: lat,
                        CONF_LONGITUDE: lon,
                        CONF_BASE_URL: user_input[CONF_BASE_URL].rstrip("/"),
                    },
                    options={
                        CONF_LANGUAGE: user_input[CONF_LANGUAGE],
                        CONF_UPDATE_INTERVAL: DEFAULT_UPDATE_INTERVAL,
                    },
                )

        defaults = user_input or {}
        schema = vol.Schema(
            {
                vol.Required(
                    CONF_API_KEY, default=defaults.get(CONF_API_KEY, "")
                ): selector.TextSelector(),
                vol.Required(
                    CONF_LOCATION,
                    default=defaults.get(
                        CONF_LOCATION,
                        {
                            CONF_LATITUDE: self.hass.config.latitude,
                            CONF_LONGITUDE: self.hass.config.longitude,
                        },
                    ),
                ): selector.LocationSelector(),
                vol.Required(
                    CONF_NAME, default=defaults.get(CONF_NAME, DEFAULT_NAME)
                ): selector.TextSelector(),
                vol.Required(
                    CONF_LANGUAGE, default=defaults.get(CONF_LANGUAGE, DEFAULT_LANGUAGE)
                ): selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        options=LANGUAGES,
                        translation_key="language",
                    )
                ),
                vol.Required(
                    CONF_BASE_URL, default=defaults.get(CONF_BASE_URL, DEFAULT_BASE_URL)
                ): selector.TextSelector(),
            }
        )
        return self.async_show_form(step_id="user", data_schema=schema, errors=errors)

    async def async_step_reauth(
        self, entry_data: dict[str, Any]
    ) -> ConfigFlowResult:
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        entry = self._get_reauth_entry()

        if user_input is not None:
            error = await self._validate(
                entry.data[CONF_BASE_URL],
                user_input[CONF_API_KEY],
                entry.data[CONF_LATITUDE],
                entry.data[CONF_LONGITUDE],
                entry.options.get(CONF_LANGUAGE, DEFAULT_LANGUAGE),
            )
            if error:
                errors["base"] = error
            else:
                return self.async_update_reload_and_abort(
                    entry, data_updates={CONF_API_KEY: user_input[CONF_API_KEY]}
                )

        return self.async_show_form(
            step_id="reauth_confirm",
            data_schema=vol.Schema(
                {vol.Required(CONF_API_KEY): selector.TextSelector()}
            ),
            errors=errors,
        )

    async def _validate(
        self, base_url: str, api_key: str, lat: float, lon: float, lang: str
    ) -> str | None:
        client = MeteorocksApiClient(
            async_get_clientsession(self.hass),
            base_url, api_key, lat, lon, lang=lang,
        )
        try:
            await client.async_validate()
        except MeteorocksAuthError:
            return "invalid_auth"
        except MeteorocksChannelError:
            return "no_channel_access"
        except MeteorocksApiError:
            return "cannot_connect"
        except Exception:  # noqa: BLE001
            _LOGGER.exception("Unexpected error validating API key")
            return "unknown"
        return None

    @staticmethod
    @callback
    def async_get_options_flow(config_entry) -> "MeteorocksOptionsFlow":
        return MeteorocksOptionsFlow()


class MeteorocksOptionsFlow(OptionsFlow):
    """Options: polling interval and payload language."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=user_input)

        options = self.config_entry.options
        schema = vol.Schema(
            {
                vol.Required(
                    CONF_UPDATE_INTERVAL,
                    default=options.get(CONF_UPDATE_INTERVAL, DEFAULT_UPDATE_INTERVAL),
                ): selector.NumberSelector(
                    selector.NumberSelectorConfig(
                        min=MIN_UPDATE_INTERVAL,
                        max=MAX_UPDATE_INTERVAL,
                        step=10,
                        unit_of_measurement="s",
                        mode=selector.NumberSelectorMode.BOX,
                    )
                ),
                vol.Required(
                    CONF_LANGUAGE,
                    default=options.get(CONF_LANGUAGE, DEFAULT_LANGUAGE),
                ): selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        options=LANGUAGES,
                        translation_key="language",
                    )
                ),
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)
