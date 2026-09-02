# DB and Data Pipeline

Offline ingest and publish path for GIS runtime artifacts.

## Files

- `ingest.py` - transforms raw Tokyo datasets into publish artifacts.
- `load_postgis.py` - loads published artifacts into PostGIS via platform repository loader.
- `published/` - runtime artifacts consumed by frontend/backend fallback path.

## Run

- Rebuild publish artifacts: `python product/db/ingest.py`
- Load publish to PostGIS: `python product/db/load_postgis.py`

## Published Artifacts

- `inventory.json` - canonical sites/cells/alarms metadata with provenance.
- `gh.bin` - packed Groundhog measurement points.
- `dt.bin` - packed drive-test measurement points.
- `dt_paths.geojson` - drive-test route geometry.
- `ingest-report.json` - ingest stats and source counters.
