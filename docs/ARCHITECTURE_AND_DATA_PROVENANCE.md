# Architecture and Data Provenance

## 1) Runtime Architecture

The GIS repository is organized around three runtime domains:

- `product/frontend`: React + TypeScript browser workbench and Copilot client.
- `product/backend`: Python host for static assets, chat proxy, and geo-api proxy.
- `product/db`: ingest pipeline and published fallback artifacts.

Support domains:
- `docs`: architecture and process documentation.
- `process`: prompts/rules/templates for delivery workflow.
- `.planning`: phase memory and handoff records.

## 2) End-to-End Data Lineage

### Raw Inputs (authoritative source locations)

- `data/RMI Datasets*/RMI Datasets/*` (gitignored):
  - cell plan CSVs and related planning exports.
  - drive-test CSV traces.
  - Groundhog measurement CSV sets.
- Structured auxiliary files discovered/consumed by ingest:
  - site annotations (`sites_annotated.json` when present in source bundles).
  - alarm feed snapshots (`alarms_active.json` when present in source bundles).
  - clock/timestamp source (`tok-fm` metadata field and ingest-time capture).

These raw inputs are intentionally excluded from git tracking due size/sensitivity/volatility.

### Transform Stage

`product/db/ingest.py` performs:

1. Source discovery and fallback selection for expected CSV/JSON feeds.
2. Data normalization:
   - numeric conversion and field shaping;
   - status mapping (`on-air`, `planned`, `partial`, `locked`);
   - technology/band/site-type mapping and cleanup.
3. Geographic filtering:
   - Tokyo bounding-box enforcement for heavy telemetry.
4. Heavy-data packing:
   - writes float32 little-endian triplets `(lng, lat, rsrp)` for GH/DT.
5. Route derivation:
   - builds DT route GeoJSON features from DT traces.
6. Provenance stamping:
   - writes source attribution and measured timestamps in inventory fields.
7. Ingest reporting:
   - outputs source counts, cap effects, and summary diagnostics.

### Published Artifacts

Artifacts written to `product/db/published/`:

- `inventory.json`
  - Canonical site/cell inventory.
  - Includes status, alarms, timing, and source-tagged fields.
- `gh.bin`
  - Groundhog point cloud in packed binary triplets.
- `dt.bin`
  - Drive-test point cloud in packed binary triplets.
- `dt_paths.geojson`
  - Drive-test route line geometry and route-level properties.
- `ingest-report.json`
  - Provenance and ingest quality diagnostics.

## 3) Runtime Consumption

### Frontend (`product/frontend/src/data.js`)

- Loads `inventory.json` through backend `/published/` path.
- Loads `gh.bin` and `dt.bin` via `heavy.js`.
- Loads `dt_paths.geojson` for route overlays.
- Probes `geo-api` through `/geo/*` and uses file fallback when unavailable.

### Backend (`product/backend/serve.py`)

- Serves built frontend (`product/frontend/dist`).
- Serves published artifacts (`product/db/published/*`).
- Proxies `GET /geo/*` to `GEO_API_URL` with server-side tenant headers:
  - `X-Org-Id`
  - `X-Workspace-Id`
- Hosts Copilot routes:
  - `POST /api/chat`
  - `POST /api/chat/stream`
  - `GET /api/chat/memory`
  - `POST /api/chat/reset`

### PostGIS Path (`product/db/load_postgis.py`)

- Reads published artifacts (not raw source datasets).
- Normalizes inventory and telemetry rows.
- Delegates DB writes to parent platform loader (`repositories.geo.loader`).
- Uses environment-scoped tenant identifiers (`GEO_ORG_ID`, `GEO_WORKSPACE_ID`).

## 4) Provenance Matrix

| Artifact | Produced by | Source location(s) | Primary consumers |
|---|---|---|---|
| `product/db/published/inventory.json` | `product/db/ingest.py` | `data/RMI Datasets*/RMI Datasets/*` + annotation/alarm/time inputs | frontend runtime, backend fallback, PostGIS loader |
| `product/db/published/gh.bin` | `product/db/ingest.py` | Groundhog CSV measurements under `data/` bundles | frontend deck.gl layers, PostGIS loader |
| `product/db/published/dt.bin` | `product/db/ingest.py` | Drive-test CSV measurements under `data/` bundles | frontend deck.gl layers, PostGIS loader |
| `product/db/published/dt_paths.geojson` | `product/db/ingest.py` | Drive-test trace CSVs under `data/` bundles | frontend route overlays, PostGIS loader |
| `product/db/published/ingest-report.json` | `product/db/ingest.py` | ingest run metadata + source counters | operators and QA verification |

## 5) Data Classification and Handling Notes

- Raw source datasets in `data/` are considered operationally sensitive and untracked.
- Published artifacts are commit-tracked for deterministic local demo/runtime behavior.
- Provenance labels are preserved to avoid fabricated/opaque map outputs.
- Copilot memory in `serve.py` is in-process only (ephemeral) and tied to `user_id`.

## 6) Integration Direction (Parent Platform)

- Operational geospatial entities: PostGIS-backed service path (`geo-api`).
- Heavy telemetry at scale: hybrid serving path (object storage + tile/chunk APIs), not monolithic DB-to-browser dumps.
- GIS remains a domain workbench while control-plane responsibilities stay in parent platform services.
