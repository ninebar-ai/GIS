# AGENTS

Repository operating contract for AI agents and human contributors.

## Mission

Ship reliable GIS capabilities without breaking platform alignment:
- deterministic-first map and Copilot behavior;
- explicit provenance for telecom data;
- phase-scoped execution with verification evidence.

## Runtime Layout

- `product/frontend` - browser workbench (MapLibre + deck.gl + Turf).
- `product/backend` - Python host/proxy for frontend, Copilot, and `geo-api`.
- `product/db` - ingest pipeline and published artifacts.
- `docs` - architecture and operational documentation.
- `process` - prompts, templates, non-negotiables, and playbooks.
- `.planning` - committed cross-session memory.

## Session Read Order

1. `README.md`
2. `process/USAGE.md`
3. `docs/GSD_CORE.md`
4. `docs/ENGINEERING_GUIDE.md`
5. `process/rules/non-negotiables.md`
6. `.planning/ROADMAP.md`
7. `.planning/STATE.md`
8. active `.planning/phases/<N>/PLAN.md`

## Commands

- Run backend: `python product/backend/serve.py`
- Build frontend: `cd product/frontend && npm run build`
- Load PostGIS from publish: `python product/db/load_postgis.py`
- Re-ingest from raw data: `python product/db/ingest.py`

## GSD Commands (aligned with gsd-core-next)

- Bootstrap: `/gsd-new-project` or `/gsd-onboard`
- Plan loop: `/gsd-discuss-phase <N>`, `/gsd-plan-phase <N> --mvp`, `/gsd-execute-phase <N>`
- Verify/ship: `/gsd-verify-work <N>`, `/gsd-ship <N>`
- Navigation: `/gsd-next`, `/gsd-progress --next`, `/gsd-pause-work --report`, `/gsd-resume-work`

## Non-Negotiables

1. Never invent packages, services, or APIs.
2. Keep scope inside the approved phase boundary.
3. Never edit tests to force green; fix behavior instead.
4. Never commit secrets or customer-sensitive data.
5. Every external call must have timeout + explicit error handling.
6. Every new endpoint must define validation and test coverage.
7. No silent exception swallowing.
8. Configuration belongs in environment variables.
9. Data/schema migrations must be additive and reversible.
10. Escalate refactor when files pass 400 lines or duplication repeats.

## Integration Guardrails

- Do not clone parent control-plane services inside GIS.
- Keep user-visible intent contracts stable while changing internals.
- Use PostGIS for operational geospatial entities and query workflows.
- Use hybrid telemetry serving (object storage + tiles/chunks), not raw heavy dumps from DB to browser.
