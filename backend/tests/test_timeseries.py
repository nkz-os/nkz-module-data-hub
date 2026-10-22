"""
Unit tests for the timeseries BFF — specifically the data-shape contract
between _fetch_from_parcel_weather_api and the frontend worker parser.

Run:  cd backend && python -m pytest tests/ -v
"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from app.api.timeseries import _fetch_from_parcel_weather_api, _NGSI_LD_TO_DB_COLUMN


class TestFetchFromParcelWeatherApi:
    """Verify the JSON shape contract between BFF and worker."""

    @pytest.mark.asyncio
    async def test_empty_observations_returns_empty_timestamps_and_values(self):
        """When the parcel API returns no observations, we get empty arrays."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"observations": [], "downscaling": "none"}

        with patch("app.api.timeseries.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get.return_value = mock_response
            result = await _fetch_from_parcel_weather_api(
                entity_id="urn:ngsi-ld:AgriParcel:test",
                attrs="temp_avg",
                time_from="2024-01-01T00:00:00Z",
                time_to="2024-01-02T00:00:00Z",
                headers={},
            )

        assert result["timestamps"] == []
        assert result["values"] == []
        assert result["_source"] == "parcel_weather_api"

    @pytest.mark.asyncio
    async def test_single_attr_returns_flat_values_array(self):
        """
        Regression test for Bug 2: single attribute must return
        { timestamps: [...], values: [...] } — NOT { values: { "temp_avg": [...] } }.
        The frontend worker's parseSingleSeriesPayload expects Array.isArray(payload.values).
        """
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "observations": [
                {"observed_at": "2024-06-04T00:00:00Z", "temp_avg": 20.5},
                {"observed_at": "2024-06-04T01:00:00Z", "temp_avg": 21.0},
                {"observed_at": "2024-06-04T02:00:00Z", "temp_avg": 19.8},
            ],
            "downscaling": "idw",
        }

        with patch("app.api.timeseries.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get.return_value = mock_response
            result = await _fetch_from_parcel_weather_api(
                entity_id="urn:ngsi-ld:AgriParcel:test",
                attrs="temp_avg",
                time_from=None,
                time_to=None,
                headers={},
            )

        # The values key MUST be a flat array, not a dict.
        assert isinstance(result["values"], list), (
            f"Expected flat array, got {type(result['values'])}. "
            "Worker parseSingleSeriesPayload checks Array.isArray(payload.values)."
        )
        assert result["values"] == [20.5, 21.0, 19.8]
        assert len(result["timestamps"]) == 3

    @pytest.mark.asyncio
    async def test_multi_attr_returns_value_0_value_1_format(self):
        """
        Multi-attribute query must return { timestamps, value_0, value_1, ... }
        matching the _reader_json_to_frontend_json convention, so the frontend
        can consume multi-series aligned data without a dict-nesting mismatch.
        """
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "observations": [
                {"observed_at": "2024-06-04T00:00:00Z", "temp_avg": 20.5, "humidity_avg": 65.0},
                {"observed_at": "2024-06-04T01:00:00Z", "temp_avg": 21.0, "humidity_avg": 63.0},
            ],
            "downscaling": "idw",
        }

        with patch("app.api.timeseries.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get.return_value = mock_response
            result = await _fetch_from_parcel_weather_api(
                entity_id="urn:ngsi-ld:AgriParcel:test",
                attrs="temp_avg,humidity_avg",
                time_from=None,
                time_to=None,
                headers={},
            )

        # Multi-attr: no top-level "values" key; instead value_0, value_1.
        assert "values" not in result, "Multi-attr must NOT use 'values' key"
        assert result["value_0"] == [20.5, 21.0]
        assert result["value_1"] == [65.0, 63.0]
        assert len(result["timestamps"]) == 2

    @pytest.mark.asyncio
    async def test_ngsi_ld_attribute_name_mapping(self):
        """NGSI-LD names (e.g. temperature) are mapped to DB columns (temp_avg)."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "observations": [
                {"observed_at": "2024-06-04T00:00:00Z", "temp_avg": 22.0},
            ],
            "downscaling": "idw",
        }

        with patch("app.api.timeseries.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get.return_value = mock_response
            result = await _fetch_from_parcel_weather_api(
                entity_id="urn:ngsi-ld:AgriParcel:test",
                attrs="temperature",  # NGSI-LD name
                time_from=None,
                time_to=None,
                headers={},
            )

        assert result["values"] == [22.0]

    @pytest.mark.asyncio
    async def test_null_values_preserved_in_series(self):
        """Null observations must remain in the array (frontend handles NaN gaps)."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "observations": [
                {"observed_at": "2024-06-04T00:00:00Z", "temp_avg": 20.5},
                {"observed_at": "2024-06-04T01:00:00Z", "temp_avg": None},
                {"observed_at": "2024-06-04T02:00:00Z", "temp_avg": 19.8},
            ],
            "downscaling": "none",
        }

        with patch("app.api.timeseries.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get.return_value = mock_response
            result = await _fetch_from_parcel_weather_api(
                entity_id="urn:ngsi-ld:AgriParcel:test",
                attrs="temp_avg",
                time_from=None,
                time_to=None,
                headers={},
            )

        assert result["values"] == [20.5, None, 19.8]

    @pytest.mark.asyncio
    async def test_api_error_returns_empty(self):
        """When parcel API returns >= 400, return empty timestamps/values."""
        mock_response = MagicMock()
        mock_response.status_code = 502

        with patch("app.api.timeseries.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get.return_value = mock_response
            result = await _fetch_from_parcel_weather_api(
                entity_id="urn:ngsi-ld:AgriParcel:test",
                attrs="temp_avg",
                time_from=None,
                time_to=None,
                headers={},
            )

        assert result["timestamps"] == []
        assert result["values"] == []
