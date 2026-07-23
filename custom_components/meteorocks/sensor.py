"""Sensors derived from the meteo.rocks channel payloads."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.const import (
    DEGREE,
    EntityCategory,
    UnitOfPrecipitationDepth,
    UnitOfPressure,
    UnitOfSpeed,
    UnitOfTemperature,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import dt as dt_util

from .const import ATTRIBUTION, DOMAIN, as_float
from .coordinator import MeteorocksCoordinator, MeteorocksData


def _current(data: MeteorocksData) -> dict[str, Any]:
    return data.current.get("current") or {}


def _buckets(data: MeteorocksData) -> list[dict[str, Any]]:
    table = data.nowcasting.get("table") or {}
    return table.get("data") or []


def _time_today(value: str | None) -> datetime | None:
    """Parse a payload 'HH:MM' into today's local datetime."""
    if not value or ":" not in value:
        return None
    try:
        hour, minute = (int(part) for part in value.split(":", 1))
    except ValueError:
        return None
    return dt_util.start_of_local_day().replace(hour=hour, minute=minute)


def _warning_bucket(data: MeteorocksData) -> dict[str, Any]:
    worst: dict[str, Any] = {}
    for bucket in _buckets(data):
        if int(bucket.get("warninglevel", 0)) > int(worst.get("warninglevel", 0)):
            worst = bucket
    return worst


@dataclass(frozen=True, kw_only=True)
class MeteorocksSensorDescription(SensorEntityDescription):
    value_fn: Callable[[MeteorocksData], Any]


SENSORS: tuple[MeteorocksSensorDescription, ...] = (
    MeteorocksSensorDescription(
        key="temperature",
        device_class=SensorDeviceClass.TEMPERATURE,
        state_class=SensorStateClass.MEASUREMENT,
        native_unit_of_measurement=UnitOfTemperature.CELSIUS,
        value_fn=lambda data: as_float(_current(data).get("temp"), None),
    ),
    MeteorocksSensorDescription(
        key="pressure",
        device_class=SensorDeviceClass.ATMOSPHERIC_PRESSURE,
        state_class=SensorStateClass.MEASUREMENT,
        native_unit_of_measurement=UnitOfPressure.HPA,
        value_fn=lambda data: as_float(_current(data).get("pressure"), None),
    ),
    MeteorocksSensorDescription(
        key="wind_speed",
        translation_key="wind_speed",
        device_class=SensorDeviceClass.WIND_SPEED,
        state_class=SensorStateClass.MEASUREMENT,
        native_unit_of_measurement=UnitOfSpeed.METERS_PER_SECOND,
        value_fn=lambda data: as_float(_current(data).get("windspeed_average"), None),
    ),
    MeteorocksSensorDescription(
        key="wind_gust",
        translation_key="wind_gust",
        device_class=SensorDeviceClass.WIND_SPEED,
        state_class=SensorStateClass.MEASUREMENT,
        native_unit_of_measurement=UnitOfSpeed.METERS_PER_SECOND,
        value_fn=lambda data: as_float(_current(data).get("windspeed_max"), None),
    ),
    MeteorocksSensorDescription(
        key="wind_bearing",
        translation_key="wind_bearing",
        state_class=SensorStateClass.MEASUREMENT,
        native_unit_of_measurement=DEGREE,
        icon="mdi:compass",
        value_fn=lambda data: (
            as_float(_current(data).get("winddirection"), 0.0) % 360
            if _current(data).get("winddirection") is not None
            else None
        ),
    ),
    MeteorocksSensorDescription(
        key="condition",
        translation_key="condition",
        icon="mdi:weather-partly-cloudy",
        value_fn=lambda data: _current(data).get("weatherstring"),
    ),
    MeteorocksSensorDescription(
        key="precipitation_next_hour",
        translation_key="precipitation_next_hour",
        device_class=SensorDeviceClass.PRECIPITATION,
        state_class=SensorStateClass.MEASUREMENT,
        native_unit_of_measurement=UnitOfPrecipitationDepth.MILLIMETERS,
        suggested_display_precision=1,
        value_fn=lambda data: (
            round(sum(as_float(b.get("value")) for b in _buckets(data)[:6]), 2)
            if _buckets(data)
            else None
        ),
    ),
    MeteorocksSensorDescription(
        key="rain_warning_level",
        translation_key="rain_warning_level",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:weather-pouring",
        value_fn=lambda data: (
            max((int(b.get("warninglevel", 0)) for b in _buckets(data)), default=None)
            if _buckets(data)
            else None
        ),
    ),
    MeteorocksSensorDescription(
        key="rain_warning_text",
        translation_key="rain_warning_text",
        icon="mdi:alert-outline",
        value_fn=lambda data: _warning_bucket(data).get("warningtext"),
    ),
    MeteorocksSensorDescription(
        key="sunrise",
        translation_key="sunrise",
        device_class=SensorDeviceClass.TIMESTAMP,
        icon="mdi:weather-sunset-up",
        value_fn=lambda data: _time_today(_current(data).get("sunrise")),
    ),
    MeteorocksSensorDescription(
        key="sunset",
        translation_key="sunset",
        device_class=SensorDeviceClass.TIMESTAMP,
        icon="mdi:weather-sunset-down",
        value_fn=lambda data: _time_today(_current(data).get("sunset")),
    ),
    MeteorocksSensorDescription(
        key="moon_phase",
        translation_key="moon_phase",
        icon="mdi:moon-waxing-crescent",
        value_fn=lambda data: _current(data).get("moonphase"),
    ),
    MeteorocksSensorDescription(
        key="forecast_model_run",
        translation_key="forecast_model_run",
        entity_category=EntityCategory.DIAGNOSTIC,
        icon="mdi:update",
        value_fn=lambda data: data.forecast.get("lastmodelrunsince"),
    ),
    MeteorocksSensorDescription(
        key="nowcast_start",
        translation_key="nowcast_start",
        device_class=SensorDeviceClass.TIMESTAMP,
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda data: (
            dt_util.utc_from_timestamp(data.nowcasting["timestamp_start"])
            if data.nowcasting.get("timestamp_start")
            else None
        ),
    ),
)


async def async_setup_entry(
    hass: HomeAssistant, entry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator: MeteorocksCoordinator = entry.runtime_data
    async_add_entities(
        MeteorocksSensor(coordinator, entry, description) for description in SENSORS
    )


class MeteorocksSensor(CoordinatorEntity[MeteorocksCoordinator], SensorEntity):
    _attr_attribution = ATTRIBUTION
    _attr_has_entity_name = True

    entity_description: MeteorocksSensorDescription

    def __init__(
        self,
        coordinator: MeteorocksCoordinator,
        entry,
        description: MeteorocksSensorDescription,
    ) -> None:
        super().__init__(coordinator)
        self.entity_description = description
        self._attr_unique_id = f"{entry.entry_id}_{description.key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name=entry.title,
            manufacturer="meteo.rocks",
            entry_type=DeviceEntryType.SERVICE,
            configuration_url=coordinator.api.base_url,
        )

    @property
    def native_value(self):
        return self.entity_description.value_fn(self.coordinator.data)
