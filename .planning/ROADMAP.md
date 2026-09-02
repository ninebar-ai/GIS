# ROADMAP

## Phase 1 - Documentation and process normalization

- Add engineering kit scaffolding (`USAGE`, `docs`, `prompts`, `templates`, `rules`, `.planning`).
- Define repo-level standards for onboarding, handoff, and review.
- Add architecture alignment notes for parent platform integration.

## Phase 2 - Copilot and map behavior hardening

- Keep deterministic parser coverage for critical workflows.
- Maintain fallback robustness and context continuity.
- Expand regression checks for key prompts and camera behavior.

## Phase 3 - Platform integration preparation

- Define API convergence from `serve.py` to platform `geo-api` + Brain services.
- Define UI convergence plan toward parent `console` stack.
- Formalize data split: PostGIS operational entities + telemetry delivery pipeline.

## Phase 4 - Production-scale readiness

- Introduce scalable deployment plan (AWS/GCP reference architectures).
- Add observability/SLO checkpoints.
- Validate million-scale map and telemetry serving assumptions.
