"""Weather entity backed by the meteo.rocks current + forecast channels."""

from __future__ import annotations

import time
from typing import Any

from homeassistant.components.weather import (
    Forecast,
    WeatherEntity,
    WeatherEntityFeature,
)
from homeassistant.const import (
    UnitOfPrecipitationDepth,
    UnitOfPressure,
    UnitOfSpeed,
    UnitOfTemperature,
)
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import dt as dt_util

from .const import ATTRIBUTION, CONDITION_MAP, DOMAIN, as_float
from .coordinator import MeteorocksCoordinator


async def async_setup_entry(
    hass: HomeAssistant, entry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities([MeteorocksWeather(entry.runtime_data, entry)])


class MeteorocksWeather(CoordinatorEntity[MeteorocksCoordinator], WeatherEntity):
    _attr_attribution = ATTRIBUTION
    _attr_has_entity_name = True
    _attr_name = None
    _attr_native_temperature_unit = UnitOfTemperature.CELSIUS
    _attr_native_pressure_unit = UnitOfPressure.HPA
    _attr_native_wind_speed_unit = UnitOfSpeed.METERS_PER_SECOND
    _attr_native_precipitation_unit = UnitOfPrecipitationDepth.MILLIMETERS
    _attr_supported_features = (
        WeatherEntityFeature.FORECAST_DAILY | WeatherEntityFeature.FORECAST_HOURLY
    )

    def __init__(self, coordinator: MeteorocksCoordinator, entry) -> None:
        super().__init__(coordinator)
        self._entry = entry
        self._attr_unique_id = f"{entry.entry_id}_weather"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name=entry.title,
            manufacturer="meteo.rocks",
            entry_type=DeviceEntryType.SERVICE,
            configuration_url=coordinator.api.base_url,
        )

    @property
    def _current(self) -> dict[str, Any]:
        return self.coordinator.data.current.get("current") or {}

    @property
    def condition(self) -> str | None:
        return CONDITION_MAP.get(self._current.get("weathericon", ""))

    @property
    def native_temperature(self) -> float | None:
        temp = self._current.get("temp")
        return as_float(temp, None) if temp is not None else None

    @property
    def native_pressure(self) -> float | None:
        pressure = self._current.get("pressure")
        return as_float(pressure, None) if pressure is not None else None

    @property
    def native_wind_speed(self) -> float | None:
        speed = self._current.get("windspeed_average")
        return as_float(speed, None) if speed is not None else None

    @property
    def native_wind_gust_speed(self) -> float | None:
        speed = self._current.get("windspeed_max")
        return as_float(speed, None) if speed is not None else None

    @property
    def wind_bearing(self) -> float | None:
        bearing = self._current.get("winddirection")
        if bearing is None:
            return None
        return as_float(bearing, 0.0) % 360

    @property
    def humidity(self) -> float | None:
        # The current channel carries no humidity; use the forecast bucket
        # covering the current hour.
        bucket = self._bucket_for_now()
        if bucket and bucket.get("humidity") is not None:
            return as_float(bucket["humidity"], None)
        return None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {
            "weathericon": self._current.get("weathericon"),
            "meteorocks_entry_id": self._entry.entry_id,
            "data_version": self.coordinator.data.version,
        }

    def _days(self) -> list[dict[str, Any]]:
        data = self.coordinator.data.forecast.get("data") or {}
        return data.get("days") or []

    def _bucket_for_now(self) -> dict[str, Any] | None:
        now = time.time()
        for day in self._days():
            for hour in day.get("hours") or []:
                if hour.get("timestamp", 0) <= now < hour.get("timestamp_end", 0):
                    return hour
        return None

    @callback
    def _handle_coordinator_update(self) -> None:
        super()._handle_coordinator_update()
        # Push new forecasts to subscribers of weather.get_forecasts.
        self.hass.async_create_task(self.async_update_listeners(("daily", "hourly")))

    async def async_forecast_daily(self) -> list[Forecast] | None:
        forecasts = []
        for day in self._days():
            forecasts.append(
                Forecast(
                    datetime=dt_util.utc_from_timestamp(day["timestamp"]).isoformat(),
                    condition=CONDITION_MAP.get(day.get("weathericon", "")),
                    native_temperature=as_float(day.get("temp_max"), None),
                    native_templow=as_float(day.get("temp_min"), None),
                    native_precipitation=as_float(day.get("rainfall")),
                    precipitation_probability=day.get("probability"),
                    native_wind_speed=as_float(day.get("windspeed_average"), None),
                    wind_bearing=as_float(day.get("winddirection"), 0.0) % 360,
                    native_pressure=as_float(day.get("pressure"), None),
                    humidity=day.get("humidity"),
                )
            )
        return forecasts or None

    async def async_forecast_hourly(self) -> list[Forecast] | None:
        now = time.time()
        forecasts = []
        for day in self._days():
            for hour in day.get("hours") or []:
                if hour.get("timestamp_end", 0) < now:
                    continue
                forecasts.append(
                    Forecast(
                        datetime=dt_util.utc_from_timestamp(hour["timestamp"]).isoformat(),
                        condition=CONDITION_MAP.get(hour.get("weathericon", "")),
                        native_temperature=as_float(hour.get("temp"), None),
                        native_precipitation=as_float(hour.get("rainfall")),
                        precipitation_probability=hour.get("probability"),
                        native_wind_speed=as_float(hour.get("windspeed_average"), None),
                        wind_bearing=as_float(hour.get("winddirection"), 0.0) % 360,
                        native_pressure=as_float(hour.get("pressure"), None),
                        humidity=hour.get("humidity"),
                        is_daytime=not hour.get("is_night", False),
                    )
                )
        return forecasts or None
