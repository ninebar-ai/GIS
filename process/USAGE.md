# Usage Playbook

Use this file for day-one and day-two execution in this repo.

## Prerequisites

- Git
- Node 18+ (frontend build/dev)
- Python 3.11+ (backend/ingest)
- Cursor or equivalent agent runtime

## Standard Start

1. Read `README.md`.
2. Read `AGENTS.md`.
3. Read `docs/ENGINEERING_GUIDE.md`.
4. Read `docs/GSD_CORE.md`.
5. Check `.planning/STATE.md`.

## Choose Your Path

- Path A: scaffold new slice (`process/prompts/scaffold-poc.md`)
- Path B: join existing work (`process/prompts/join-platform.md`)
- Path C: handoff (`process/prompts/handoff.md`)
- Path D: review (`process/prompts/review-changes.md`)

## Path A (Scaffold)

Load:
- `docs/ENGINEERING_GUIDE.md`
- `docs/GSD_CORE.md`
- `process/rules/non-negotiables.md`
- `process/rules/definition-of-done.md`
- `process/templates/project-brief.md`
- `process/templates/AGENTS.md`
- `process/templates/CLAUDE.md`

Then run prompt: `process/prompts/scaffold-poc.md`.

## Path B (Join)

Load:
- `docs/ENGINEERING_GUIDE.md`
- `docs/GSD_CORE.md`
- `process/rules/non-negotiables.md`
- `AGENTS.md`
- `.planning/ROADMAP.md`
- `.planning/STATE.md`
- recent `.planning/phases/*`

Then run prompt: `process/prompts/join-platform.md`.

## Path C (Handoff)

Load:
- `docs/ENGINEERING_GUIDE.md`
- `docs/GSD_CORE.md`
- `process/templates/HANDOFF.md`
- `.planning/STATE.md`
- active/recent phase files

Then run prompt: `process/prompts/handoff.md`.

## Path D (Review)

Load:
- `docs/ENGINEERING_GUIDE.md`
- `process/rules/review-checklist.md`
- `process/rules/non-negotiables.md`
- target diff/PR
- active phase plan

Then run prompt: `process/prompts/review-changes.md`.

## Local Runtime Commands

- Build frontend: `cd product/frontend && npm run build`
- Run backend: `python product/backend/serve.py`
- Re-ingest: `python product/db/ingest.py`
