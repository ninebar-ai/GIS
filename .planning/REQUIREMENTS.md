# REQUIREMENTS

## Functional

1. Deterministic map/copilot commands for common workflows.
2. Stable neighbor workflow with auditable exports.
3. Reliable fallback behavior for unknown prompts.
4. Clear onboarding, join, handoff, and review process documentation.

## Architecture

1. Preserve intent contract while refactoring internals.
2. Align GIS integration to parent platform service boundaries.
3. Use PostGIS for operational geospatial entities and queries.
4. Use hybrid strategy for massive telemetry (object store + tiled delivery).

## Delivery process

1. Use `.planning` phase records for substantial work.
2. Keep docs synchronized with behavior changes.
3. Include verification evidence before marking phase complete.
