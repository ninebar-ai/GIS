# NS-QAW V1 High-Level Design (HLD)

## 1) Purpose
This document defines the V1 architecture for the Tokyo RF GIS workbench in `ns-qaw-a`.

V1 delivery scope:
- A1: Site and layer visualization
- A2: Sector/azimuth rendering
- A3: Basic map operations and exports
- B1: New-site + Tier-1 neighbor workflow via map + Copilot

## 2) Product Principles
- **Instrument-first UX:** map is the decision mechanism, not a passive layer catalog.
- **Deterministic controls:** every UI command maps to a concrete recipe/session mutation.
- **Low-latency rendering:** vector for structured entities, GPU overlays for dense points.
- **Traceable actions:** site/neighbor decisions must be exportable and replayable.
- **Context-safe Copilot:** follow-up prompts must resolve deterministically to concrete site IDs where possible.

## 3) Scope and Boundaries
### In Scope
- Filters, layer toggles, site and sector rendering.
- Basemap switching and 2D/3D mode switch.
- Search, ruler/radius, import/export/snapshot.
- Copilot starter chips + parser-driven commands + streamed fallback.
- Neighbor session lifecycle (auto-propose, manual adjust, audit export).
- Per-user Copilot memory/session continuity and reset/inspect controls.

### Out of Scope
- B2+ KPI timeline analytics and alarm blast-radius scoring.
- UE trace playback and full KG traversal workflows.
- Automated RCA recommendation beyond current intent verbs.

## 4) Deployment Context
```mermaid
flowchart TB
  ENG["RF Engineer Browser"] --> APP["ns-qaw-a web app"]
  APP --> STATIC["Static assets (index/app/map/etc.)"]
  APP --> INV["inventory.json"]
  APP --> HEAVY["gh.bin + dt.bin + dt_paths.geojson"]
  APP --> CHAT["/api/chat optional fallback via serve.py"]
  DATA["Raw CSV/JSON drops"] --> INGEST["ingest.py (offline publish)"]
  INGEST --> INV
  INGEST --> HEAVY
```

## 5) Architecture Overview
```mermaid
flowchart LR
  subgraph Publish["Offline Publish Pipeline"]
    RAW["RMI CSV/JSON"] --> ING["ingest.py"]
    ING --> INV["inventory.json"]
    ING --> GH["gh.bin"]
    ING --> DT["dt.bin"]
    ING --> DTP["dt_paths.geojson"]
    ING --> RPT["ingest-report.json"]
  end

  subgraph Runtime["Runtime Browser System"]
    APP["app.js"]
    MAP["map.js"]
    HV["heavy.js"]
    FIL["filters.js"]
    CHT["chat.js"]
    NB["neighbors.js"]
    TOOLS["tools.js"]
  end

  INV --> APP
  GH --> HV
  DT --> HV
  DTP --> APP
  APP --> MAP
  APP --> FIL
  APP --> CHT
  APP --> NB
  APP --> TOOLS
  MAP --> HV
```

## 6) Functional Surfaces
```mermaid
flowchart LR
  TOP["Top Command Rail\nSearch, Layers, Copilot, Tools, 2D/3D, Basemap"] --> CORE["Orchestration State (app.js)"]
  LEFT["Left Drawer (rail)\nLayer stack + filters"] --> CORE
  RIGHT["Right Drawer (copilot)\nStarters + prompt + run log"] --> CORE
  MAPVIEW["Center Map\nMapLibre + deck.gl"] --> CORE
  CARD["Site/Neighbor card"] --> CORE
  CORE --> EXPORT["GeoJSON/KML/PNG + Audit JSON/CSV"]
```

## 7) Data Partitioning Strategy
```mermaid
flowchart LR
  A["Structured entities\nsites/cells/neighbors/planned"] --> VEC["MapLibre vector sources/layers"]
  B["Dense measurements\nGH/DT points"] --> GPU["deck.gl overlay (heat/hex/scatter)"]
  C["DT routes\nLineString geometry"] --> LINE["MapLibre dt-path layer"]
  D["User imports\nGeoJSON/KML"] --> USER["MapLibre user source"]
```

Reasoning:
- keeps interaction fast at V1 densities.
- avoids giant GeoJSON for measurement clouds.
- permits route path rendering while retaining DT point samples.

## 8) State Model (High-Level)
```mermaid
stateDiagram-v2
  [*] --> Booting
  Booting --> Ready: inventory + map init
  Ready --> Filtering: recipe change
  Ready --> Selecting: map/site click
  Ready --> NeighborSession: drop/new-site or tier1 start
  Filtering --> Ready: paint complete
  Selecting --> Ready: card/context updated
  NeighborSession --> Ready: clear/escape/session end
  Ready --> BasemapReload: basemap switch
  BasemapReload --> Ready: style-ready repaint
```

## 9) Basemap Resilience Design
```mermaid
sequenceDiagram
  participant U as User
  participant APP as app.js
  participant MAP as map.js
  participant ML as MapLibre
  U->>APP: change basemap
  APP->>MAP: setBasemap(name, afterPaint)
  MAP->>ML: setStyle(...)
  MAP->>ML: wait for style.load/idle/fallback timer
  ML-->>MAP: style ready
  MAP-->>APP: callback
  APP->>MAP: paint() via dressAndPaint(...)
```

This design matches the current anti-regression fix for disappearing overlays on style switch.

## 10) Copilot Architecture (V1)
```mermaid
flowchart LR
  CHIP["Starter chip click"] --> ASK["ask(q)"]
  FREE["Manual prompt"] --> ASK
  ASK --> INT["interpretWithStream(text, inv, selected)"]
  INT --> RESOLVE["Reference resolver\n(that site / second one / area / alarm)"]
  RESOLVE --> PARSE["parseAsk(...) local deterministic parser"]
  PARSE -->|intent recipe| REC["state.recipe update"]
  PARSE -->|intent action| ACT["selection/neighbor action"]
  PARSE -->|help/unknown| LLM["/api/chat/stream via serve.py"]
  LLM --> HELP["streamed QA narration"]
  REC --> PAINT["paint()"]
  ACT --> PAINT
  HELP --> LOG["Copilot log"]
```

### 10.1 Copilot Session Isolation
```mermaid
flowchart TB
  U["Browser user"] --> ID["stable user_id (localStorage)"]
  ID --> API["serve.py"]
  API --> MEM["in-memory session bucket per user_id"]
  MEM --> CHAT["/api/chat + /api/chat/stream context merge"]
  U --> CTRL["Clear / Reset memory controls"]
  CTRL --> API
```

## 11) B1 Workflow Architecture
```mermaid
flowchart TB
  START["Select site or drop pin"] --> CAND["tier1Candidates / tier1CandidatesAt"]
  CAND --> PROPOSE["Auto proposed monitored set"]
  PROPOSE --> ADJUST["Manual add/remove neighbors"]
  ADJUST --> PERSIST["persistNeighbors(sessionKey)"]
  ADJUST --> AUDIT["appendEvent trail"]
  AUDIT --> EXPORT["auditPayload / auditCsv export"]
```

## 12) Key NFRs
- **Performance:** map interaction remains fluid with GH/DT overlays enabled.
- **Consistency:** terminology and commands stay aligned (`Copilot`, `Layers`, `New site`).
- **Reliability:** basemap change does not require full refresh.
- **Auditability:** neighbor decisions are reproducible from exported trail.
- **Context continuity:** Copilot preserves per-user context across follow-up prompts.

## 13) Risks and Controls
```mermaid
flowchart TB
  R1["Schema drift in source CSVs"] --> M1["Tolerant ingest parsing + metadata counts"]
  R2["Style-reload race"] --> M2["Style-ready gates before repaint"]
  R3["Intent ambiguity"] --> M3["Strict chip ask values + deterministic parseAsk patterns"]
  R4["Heavy render pressure"] --> M4["GPU overlays + route simplification"]
```

## 14) V1 Acceptance Criteria
- A1/A2/A3/B1 workflows operate without page reload.
- `dtLayer` shows DT points and DT routes together.
- basemap switch preserves visible layers and selection context.
- Copilot starters route to intended section/action consistently.
- Unknown Copilot prompts stream progressive responses.
- Follow-up phrases (`that site`, `second one`, `one with VSWR alarm`) resolve to stable context targets.
- Tier-1 audit export yields deterministic JSON/CSV traces.
