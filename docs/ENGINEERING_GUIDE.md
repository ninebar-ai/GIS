# Engineering Guide

Repository-level engineering contract for GIS work.

## Scope and Architecture Boundary

- Product runtime code belongs in `product/`.
- Process/governance assets belong in `process/`.
- Architecture and operational docs belong in `docs/`.
- GIS stays a domain instrument and must not re-implement parent control-plane services.

## Core Principles

1. Deterministic-first behavior for known map/Copilot commands.
2. Evidence over assumptions: claims require reproducible verification.
3. Provenance retention: data origin must remain visible from ingest to runtime.
4. Scale-aware changes: always note impact on million-point telemetry workflows.
5. Contract stability: preserve user-facing behavior while evolving internals.

## Definition of Done

A substantial change is done only when all are true:
- implementation is complete and behaves as intended;
- verification is recorded in `.planning/phases/<N>/VERIFICATION.md`;
- `.planning/STATE.md` reflects the new truth;
- docs are updated for any behavior/path/contract change;
- risks and rollback notes are explicit for non-trivial changes.

## Review Priorities

1. Regression and correctness risk.
2. Data lineage/integrity risk.
3. Security and tenancy boundary risk.
4. Scale and operability risk.
5. Missing tests or missing verification evidence.

Use `process/rules/review-checklist.md` for standard gate checks.

## GSD Phase Loop Expectations

Follow the five-step loop from gsd-core-next:
1. Discuss
2. Plan
3. Execute
4. Verify
5. Ship

Preferred entry commands:
- greenfield: `/gsd-new-project`
- existing repo: `/gsd-onboard`
- smart next action: `/gsd-next`

## Required Process Assets

- Prompts: `process/prompts/*`
- Rules: `process/rules/*`
- Templates: `process/templates/*`
- Operating playbook: `process/USAGE.md`
- Active state: `.planning/STATE.md`

## GIS-to-Platform Direction

- Frontend target: parent console conventions (React + TypeScript shell).
- API target: converge on platform service boundaries (`geo-api`, identity/model gateway integrations).
- Data target: PostGIS for operational entities, hybrid serving for heavy telemetry.
