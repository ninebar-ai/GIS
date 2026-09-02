# NS-QAW V1 Low-Level Design (LLD)

## 1) Purpose
This document specifies module-level behavior, runtime contracts, and render/control flows for V1 (`A1-A3 + B1`) in `product/`.

## 2) File-Level Architecture
```mermaid
flowchart LR
  IDX["index.html"] --> APP["app.js"]
  APP --> MAP["map.js"]
  APP --> FIL["filters.js"]
  APP --> CHAT["chat.js"]
  APP --> NB["neighbors.js"]
  APP --> TOOLS["tools.js"]
  MAP --> HV["heavy.js"]
  APP --> LOB["lobes.js"]
```

## 3) Module Responsibilities

## 3.1 `index.html`
- Provides shell primitives:
  - top rail, tools, view switch, basemap selector
  - left drawer (`rail`), right drawer (`copilot`)
  - center map stage, context strip, telemetry footer
- mounts module entrypoint `app.js?v=*`.

## 3.2 `app.js`
- Owns global state:
  - `inv`, `recipe`, `selected`, `section`, `neighbors`
  - `tool`, `measurePts`, `userFc`, `geo`, `map`
  - `heavy.gh`, `heavy.dt`, `dtPaths`, `holesFc`
- Key methods:
  - `boot()`: load inventory/heavy assets; map create + bind.
  - `paint()`: compute filtered model and re-render map/UI.
  - `ask()`: Copilot command entrypoint.
  - `startNeighbors()/startNeighborsPin()`: B1 session open.

## 3.3 `map.js`
- map setup and source/layer creation.
- style-safe basemap switching (`setBasemap(...)`).
- vector painting via `dressAndPaint(...)`.
- export visibility projection via `visibleLayers(...)`.

## 3.4 `heavy.js`
- parses packed float arrays from `gh.bin` / `dt.bin`.
- renders deck.gl overlays:
  - GH: hex/heat/scatter/contour
  - DT: scatter points
- manual pick bridge to probe details.

## 3.5 `filters.js`
- `defaultRecipe()`, `applyRecipe(...)`, facet rendering.
- chip generation and chip dismissal.

## 3.6 `chat.js`
- `contextChips(...)`: deterministic quick actions by section.
- `parseAsk(...)`: maps command text to `recipe|action|help`.
- `resolveReferences(...)`: rewrites follow-ups (`that site`, ordinal picks, area/alarm references) to explicit site IDs where possible.
- `interpretWithStream(...)`: local parser first, then `/api/chat/stream` fallback with progressive deltas.
- per-user identity + local reference context persistence.

## 3.7 `neighbors.js`
- Tier-1 candidate generation and distance/geometry checks.
- monitored set state, event trail, and audit exports.

## 3.8 `ingest.py`
- source normalization and publish artifacts:
  - `inventory.json`
  - `gh.bin`, `dt.bin`
  - `dt_paths.geojson`
  - `ingest-report.json`

## 3.9 `serve.py`
- static file host + chat API surface:
  - `POST /api/chat`
  - `POST /api/chat/stream` (SSE)
  - `GET /api/chat/memory`
  - `POST /api/chat/reset`
- OpenAI primary + Claude fallback.
- per-user memory merge and turn persistence.

## 4) Runtime State Model
```mermaid
classDiagram
  class State {
    +inv
    +recipe
    +selected
    +section
    +neighbors
    +tool
    +measurePts
    +userFc
    +geo
    +map
    +heavy
    +dtPaths
    +holesFc
    +cursor
    +frameMs
  }
  class Recipe {
    +tech[]
    +band[]
    +siteType[]
    +status[]
    +carrier[]
    +morphology[]
    +view
    +plannedLayer
    +sectorsLayer
    +spiderLayer
    +ghLayer
    +dtLayer
    +holesLayer
    +ghContourLayer
    +vocLayer
  }
  State --> Recipe : contains
```

## 5) Boot and Initialization Flow
```mermaid
sequenceDiagram
  participant B as Browser
  participant A as app.js
  participant I as inventory.json
  participant H as heavy.js
  participant M as map.js
  B->>A: boot()
  A->>I: fetch inventory.json
  A->>H: loadPacked(gh.bin)
  A->>H: loadPacked(dt.bin)
  A->>I: fetch dt_paths.geojson
  A->>M: createMap(...)
  A->>M: bind UI/map events
  A->>A: paint()
```

## 6) Paint Pipeline
```mermaid
flowchart TB
  P0["paint()"] --> P1["applyRecipe(inv, recipe)"]
  P1 --> P2["withNeighbors(...) merge"]
  P2 --> P3["buildGeo(...) + plannedFc"]
  P3 --> P4["dressAndPaint(map, geo, recipe, extras)"]
  P4 --> P5["Map sources setData(...)"]
  P4 --> P6["paintHeavy(map, {gh, dt, recipe})"]
  P0 --> P7["renderFacets/renderChips/renderCard/renderContextStrip/updateHud"]
```

## 7) Basemap Switch Control Flow
```mermaid
flowchart TB
  C0["basemap change event"] --> C1["setBasemap(map, styleName, after)"]
  C1 --> C2["map.setStyle(...)"]
  C2 --> C3{"style loaded?"}
  C3 -- no --> C4["wait style.load or idle or fallback timer"]
  C4 --> C3
  C3 -- yes --> C5["unsubscribe listeners"]
  C5 --> C6["after() -> paint()"]
```

## 8) Copilot Intent Resolution
```mermaid
stateDiagram-v2
  [*] --> StarterClick
  [*] --> FreeText
  StarterClick --> Ask
  FreeText --> Ask
  Ask --> ResolveRefs
  ResolveRefs --> Interpret
  Interpret --> LocalParse
  LocalParse --> RecipeIntent
  LocalParse --> ActionIntent
  LocalParse --> HelpIntent
  HelpIntent --> StreamFallback
  StreamFallback --> QAIntent
  RecipeIntent --> Repaint
  ActionIntent --> Repaint
  QAIntent --> LogOnly
```

## 9) B1 New-Site Neighbor Session
```mermaid
sequenceDiagram
  participant U as User
  participant A as app.js
  participant N as neighbors.js
  U->>A: Drop pin or select site + Tier-1
  A->>N: tier1CandidatesAt(...) / tier1Candidates(...)
  N-->>A: candidate list
  A->>A: state.neighbors = session
  U->>A: add/remove monitored sectors
  A->>N: appendEvent(...)
  A->>N: persistNeighbors(...)
  U->>A: export audit
  A->>N: auditPayload()/auditCsv()
```

## 10) Layer Composition Rules
```mermaid
flowchart LR
  R["recipe"] --> L1["sites/cells vector layers"]
  R --> L2["planned layer"]
  R --> L3["dt-path line layer"]
  R --> L4["deck DT points"]
  R --> L5["deck GH layers"]
  R --> L6["holes/contours"]
  S["neighbor session"] --> L7["neighbors + candidate overlays"]
```

## 11) Ingest Publish Pipeline Detail
```mermaid
flowchart TB
  SRC1["Plan rows + annotated sites + alarms"] --> NORM["Site/Cell normalization"]
  SRC2["GH csv files"] --> GHPTS["ingest_points_from_csv"]
  SRC3["DT csv files"] --> DTPTS["ingest_points_from_csv"]
  SRC3 --> DTRT["build_dt_paths -> LineString features"]
  GHPTS --> GHBIN["write_packed(gh.bin)"]
  DTPTS --> DTBIN["write_packed(dt.bin)"]
  DTRT --> DTF["dt_paths.geojson"]
  NORM --> INV["inventory.json"]
  GHBIN --> INV
  DTBIN --> INV
  DTF --> INV
  INV --> RPT["ingest-report.json metrics"]
```

## 12) Export Behavior
```mermaid
flowchart LR
  V["visibleLayers(geo, recipe, userFc, extras)"] --> GJ["GeoJSON export"]
  V --> KML["KML export"]
  SNAP["snapshotCanvas(map)"] --> PNG["PNG export"]
  NB["auditPayload/auditCsv"] --> AUD["Neighbor audit exports"]
```

Notes:
- GH/DT sample points remain GPU assets (not dumped as giant vector exports).
- DT route vectors (`dt-paths`) are exportable when enabled by recipe.

## 13) Error and Fallback Paths
```mermaid
flowchart TB
  E1["Missing asset file"] --> F1["empty FeatureCollection / zero points fallback"]
  E2["deck overlay attach fail"] --> F2["vector map still renders"]
  E3["unmatched Copilot prompt"] --> F3["streaming LLM fallback via /api/chat/stream"]
  E5["reference phrase unresolved"] --> F5["fallback to selected/last site or keep context"]
  E4["style reload race"] --> F4["setBasemap style-ready gating"]
```

## 14) Performance Controls
- packed float32 assets for high-density measurements.
- zoom-aware GH rendering strategy (hex/heat/scatter split).
- DT route compaction in ingest to bound line complexity.
- centralized `paint()` pipeline to limit render drift.

## 15) LLD Acceptance Checklist
- `boot()` loads `inventory.json`, packed binaries, and DT routes.
- `dtLayer` displays DT line routes + DT points.
- basemap switch keeps overlays and selections without refresh.
- Copilot chips trigger deterministic recipe/action transitions.
- Unknown prompts stream from `/api/chat/stream` without blocking UI.
- per-user session memory is isolated and resettable via API/UI controls.
- follow-up references (`that site`, `second one`, area/alarm form) resolve consistently.
- neighbor session persists and exports auditable trail.
- vector exports reflect active recipe and include DT route vectors.
