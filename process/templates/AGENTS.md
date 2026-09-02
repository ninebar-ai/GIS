# AGENTS.md template

## Project

<One-paragraph project description>

- Tier: Platform | POC | Spike
- Owner: <name>
- GSD Core version: <pin>

## Commands

- Install/bootstrap:
- Run:
- Test:
- Lint:
- Migrate:

## Layout

- Main app path(s):
- Domain/services path(s):
- Repositories/data access path(s):
- Tests:
- `.planning/`:

## Stack - approved libraries only

List approved runtime libraries here. Additions require explicit review.

## Non-negotiables

Copy from `process/rules/non-negotiables.md` verbatim.

## Never touch without asking

- security and secret files
- production migrations
- deployed infra workflows

## Project-specific rules

Add concrete constraints here (legacy zones, strict contracts, no-touch modules).
