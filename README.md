# NineOne GIS Repository

Production-oriented GIS workbench for Tokyo RAN planning and QA, with deterministic Copilot commands and optional LLM fallback.

## Canonical Repository Layout

```text
GIS/
  product/                 # Runtime code and deploy artifacts
    frontend/              # React + TypeScript + Vite UI (MapLibre + deck.gl)
    backend/               # Python proxy/API host
    db/                    # Ingest + published runtime artifacts
  process/                 # Prompts, rules, templates, usage playbooks
  docs/                    # Architecture, operations, and file catalogs
  assets/                  # Non-runtime visual/ideation references
  .planning/               # Committed project memory and phase records
  junk/                    # Non-essential local artifacts (gitignored)
```

Detailed old->new move map: `docs/REPO_STRUCTURE.md`.

## Five-Minute Local Run

1. Install frontend dependencies:
   - `cd product/frontend`
   - `npm install`
2. Build frontend:
   - `npm run build`
3. Run backend from repo root:
   - `python product/backend/serve.py`
4. Open `http://127.0.0.1:8765/`.

Optional dev mode:
- Terminal A: `cd product/backend && python serve.py`
- Terminal B: `cd product/frontend && npm run dev`

## Entry Points

- `AGENTS.md` - repository operating contract for agents and humans.
- `process/USAGE.md` - scaffold/join/handoff/review workflows.
- `docs/GSD_CORE.md` - GSD command quick reference aligned with `gsd-core-next`.
- `docs/ENGINEERING_GUIDE.md` - engineering bars and quality gates.
- `docs/CODEBASE_FILE_CATALOG.md` - tracked-file purpose/data/provenance catalog.
- `docs/ARCHITECTURE_AND_DATA_PROVENANCE.md` - end-to-end lineage and runtime architecture.

## Product Runtime Overview

- `product/frontend` renders map, layers, telemetry visualization, and Copilot UI using React + TypeScript shell components.
- `product/backend/serve.py` serves built frontend, published data, `/api/chat*`, and proxies `/geo/*`.
- `product/db/ingest.py` transforms raw `data/` inputs into published runtime artifacts.
- `product/db/published` is the fallback/offline runtime source when `geo-api` is unavailable.

## Data and Provenance

- Raw source folders remain under `data/` (gitignored).
- Published runtime artifacts are committed in `product/db/published/`.
- Provenance fields in `inventory.json` preserve source dataset lineage per record/field.
- PostGIS load path is provided by `product/db/load_postgis.py`.

## Governance and Process

- Workflow assets live under `process/`:
  - `process/prompts/*`
  - `process/rules/*`
  - `process/templates/*`
- Planning records must stay current in `.planning/STATE.md` and active phase files.
- Contribution and security standards:
  - `CONTRIBUTING.md`
  - `SECURITY.md`
  - `CHANGELOG.md`
