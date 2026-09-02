# NineOne GIS — Tokyo RAN Workbench

A geospatial workbench for visualizing and analyzing a radio access network (RAN) around Tokyo — cell sites, coverage measurements, drive-test traces — with a natural-language Copilot built on top of the map.

The repo tracks only the runtime code and the data artifacts needed to run it: `product/` and this README. Docs, planning records, and process templates exist locally under `ignored/` but are gitignored (see `.gitignore`).

## Layout

```text
GIS/
  product/
    frontend/   React + TypeScript + Vite UI (MapLibre GL + deck.gl)
    backend/    Python HTTP server: static hosting, LLM proxy, geo-api proxy
    db/         Offline ETL (ingest.py) + published/ runtime data artifacts
```

## Running it locally

1. Build the frontend:
   ```bash
   cd product/frontend
   npm install
   npm run build
   ```
2. Run the backend from the repo root:
   ```bash
   python product/backend/serve.py
   ```
3. Open `http://127.0.0.1:8765/`.

Dev mode (hot reload):
- Terminal A: `cd product/backend && python serve.py`
- Terminal B: `cd product/frontend && npm run dev` (Vite dev server on `:5173`, proxies `/api/*`, `/geo/*`, `/published/*` to the backend)

## How it works

**Frontend (`product/frontend/src/`)** — React only boots the page; the app itself is an imperative event loop, not typical React state/props.

- `main.tsx` → `App.tsx` mounts the DOM shell, then calls `bootLegacyApp()`
- `legacyApp.ts` is the core: loads data, creates the map, wires up every interaction handler, and runs `paint()` to rebuild derived data and re-render on change
- `workbench/state.ts` holds one global mutable `state` object (inventory, active filters/"recipe", selection, map instance, chat transcript) with a pub/sub (`subscribe()` / `notify()`)
- `map/` manages the MapLibre GL map and deck.gl layers — sector "lobes", RSRP coverage clouds, drive-test points, planned sites — plus click/hover/measurement interaction
- `chat/` is the Copilot: parses natural-language input, builds a prompt from current map state, streams the request to the backend, and interprets the JSON response as a `CopilotIntent` that mutates state (select a site, apply a filter, fly the camera, etc.)
- `data.ts` loads inventory from the live geo-api if available, otherwise falls back to the published static files
- `heavy.ts` unpacks binary RSRP measurement blobs into GPU-friendly float arrays

**Backend (`product/backend/serve.py`)** — a single-file Python `http.server`, no framework:
- Serves the built frontend (`product/frontend/dist/`) and the published data artifacts (`product/db/published/`)
- Proxies chat requests to OpenAI or Anthropic (`/api/chat`, `/api/chat/stream`), keeping a small in-memory (non-persistent) chat history per user
- Proxies `/geo/*` to an optional PostGIS-backed geo-API, injecting tenant headers

**Data pipeline (`product/db/`)** — offline ETL, run manually:
- `ingest.py` reads raw RMI site/cell inventory, Groundhog RSRP measurements, and drive-test traces, filters to the Tokyo bounding box, and writes `inventory.json`, `gh.bin`, `dt.bin`, `dt_paths.geojson` into `published/`
- `published/` is committed — it's the offline-first data source the frontend uses by default
- `load_postgis.py` optionally loads the same artifacts into PostGIS for the geo-api service; PostGIS is a performance upgrade, not a requirement

### Request flow (map interaction)

1. User clicks the map or changes a filter → handler in `legacyApp.ts` fires
2. Handler mutates `state.recipe` / `state.selected` in `workbench/state.ts`
3. `paint()` re-filters the inventory, rebuilds sector polygons (`lobes.ts`) and other GeoJSON, pushes new data into the deck.gl layers
4. Non-map UI (legend, chips, HUD) updates via direct DOM manipulation
5. `notify()` bumps a revision counter so subscribers refresh

### Chat flow

1. User question → `chat/client.ts` streams to `/api/chat/stream`
2. Backend proxies to OpenAI/Anthropic and streams the response back (SSE)
3. Response is parsed as a structured `CopilotIntent` and validated
4. Intent is applied to the same global `state`, triggering a repaint

## Stack

- **Frontend**: TypeScript, React 18, Vite, MapLibre GL, deck.gl, Turf.js, Vitest
- **Backend**: Python 3.11+, stdlib `http.server` (no framework), `openai` SDK, direct HTTPS calls to Anthropic
- **Data**: PostgreSQL + PostGIS (optional), SQLAlchemy, psycopg, H3 spatial indexing

## Environment variables (backend)

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `8765` | Server port |
| `HOST` | `127.0.0.1` | Bind address |
| `OPENAI_API_KEY` | — | OpenAI auth (or per-request `X-OpenAI-Key` header) |
| `ANTHROPIC_API_KEY` | — | Anthropic auth (or per-request `X-Anthropic-Key` header) |
| `CLAUDE_MODEL` | `claude-3-5-sonnet-latest` | Anthropic model |
| `CLAUDE_MAX_TOKENS` | `700` | Anthropic response cap |
| `CHAT_MEMORY_MAX_MESSAGES` | `12` | Per-user chat history length |
| `GEO_API_URL` | `http://127.0.0.1:8013` | Optional PostGIS-backed geo-api |
| `GEO_ORG_ID` / `GEO_WORKSPACE_ID` | `demo` / `tokyo` | Tenant headers for geo-api |
| `OPENAI_TIMEOUT_S` / `OPENAI_STREAM_TIMEOUT_S` | `60` / `90` | OpenAI request timeouts |
| `ANTHROPIC_TIMEOUT_S` | `60` | Anthropic request timeout |
| `GEO_TIMEOUT_S` | `20` | Geo-api request timeout |
| `POSTGRES_URL` | — | Only needed for `product/db/load_postgis.py` |

Backend reads these from `product/backend/.env` if present (see `.env.example`).

## Data & provenance

- Raw source datasets live under `data/` locally and are gitignored (large, not needed to run the app).
- `product/db/published/` is committed — it's the canonical offline runtime data (sites, cells, measurement clouds, routes).
- `inventory.json` records carry per-field provenance (`{ value, source, measuredAt }`) back to their source dataset.

## Notes

- No authentication — LLM API keys come from env vars or request headers; `user_id` only buckets chat history, it isn't an identity check.
- Chat memory is in-process and ephemeral — lost on backend restart.
- No CI pipeline is configured in this tree.
