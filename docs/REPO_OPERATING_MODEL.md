# Repository Operating Model

## Objective

Keep GIS delivery fast, verifiable, and migration-ready through a strict phase workflow and documented provenance.

## Canonical Work Flow

1. Enter via `/gsd-next` or choose a direct command.
2. Confirm active phase scope in `.planning/phases/<N>/PLAN.md`.
3. Implement small, reviewable changes.
4. Record verification in `.planning/phases/<N>/VERIFICATION.md`.
5. Update `.planning/STATE.md`.
6. Open PR with planning + verification context.

## Required Asset Locations

- Runtime code: `product/`
- Process artifacts: `process/`
- Architecture docs: `docs/`
- Planning memory: `.planning/`
- Non-essential local material: `junk/` (ignored)

## Enforcement Points

- `AGENTS.md` defines operating constraints.
- `process/rules/non-negotiables.md` defines hard bars.
- `process/rules/definition-of-done.md` defines completion requirements.
- `process/rules/review-checklist.md` defines reviewer gate behavior.
- `docs/CODEBASE_FILE_CATALOG.md` and `docs/ARCHITECTURE_AND_DATA_PROVENANCE.md` must stay current for structural/data changes.

## Integration Posture

- GIS does not duplicate parent platform control-plane responsibilities.
- Data contracts and intent semantics stay stable during migration.
- Operational geospatial entities converge toward PostGIS-backed services.
