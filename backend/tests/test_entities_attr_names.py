"""
Entity tree attribute names are passed to the timeseries-reader unchanged.

The reader is the single resolver of attribute names (NGSI-LD name or legacy
weather column); the BFF must not keep its own copy of that mapping.

Run:  cd backend && python -m pytest tests/ -v
"""

from app.api.entities import _norm_entity


def _weather_observed() -> dict:
    return {
        "id": "urn:ngsi-ld:WeatherObserved:station-1",
        "type": "WeatherObserved",
        "temperature": {"type": "Property", "value": 21.5},
        "precipitation": {"type": "Property", "value": 0.2},
        "deltaT": {"type": "Property", "value": 3.1},
        "https://saref.etsi.org/core/Temperature": {"type": "Property", "value": 20.0},
        "location": {"type": "GeoProperty", "value": {"type": "Point", "coordinates": [0, 0]}},
    }


def test_attribute_names_are_not_rewritten_to_weather_columns():
    names = {a["name"] for a in _norm_entity(_weather_observed(), "WeatherObserved")["attributes"]}
    assert {"temperature", "precipitation", "deltaT"} <= names
    assert not names & {"temp_avg", "precip_mm", "delta_t"}


def test_uri_attribute_uses_last_segment():
    names = {a["name"] for a in _norm_entity(_weather_observed(), "WeatherObserved")["attributes"]}
    assert "Temperature" in names
