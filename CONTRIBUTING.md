# Contributing

## Working Model

- Work in small, phase-scoped slices tied to `.planning/phases/<N>/PLAN.md`.
- Record verification in `.planning/phases/<N>/VERIFICATION.md`.
- Update `.planning/STATE.md` after substantial changes.
- Keep architecture decisions aligned to parent platform boundaries.

## Read Before Coding

- `README.md`
- `AGENTS.md`
- `process/USAGE.md`
- `process/rules/non-negotiables.md`
- `process/rules/definition-of-done.md`
- `process/rules/review-checklist.md`

## Paths

- Product code: `product/`
- Governance assets: `process/`
- Architecture docs: `docs/`
- Planning memory: `.planning/`

## Branching and Commits

- One branch per phase slice or focused fix.
- Keep commits atomic and reviewable.
- Suggested prefixes:
  - `feat(gis):`
  - `fix(copilot):`
  - `refactor(map):`
  - `docs(repo):`

## Pull Request Requirements

- Scope matches active phase plan.
- Verification evidence included.
- Docs/process updates included when behavior or contracts changed.
- `CHANGELOG.md` updated for notable changes.

## Handoff Standard

- Use `process/templates/HANDOFF.md`.
- Save handoff files to `.planning/handoffs/YYYY-MM-DD-<from>-to-<to>.md`.
- Include tried-and-rejected options and current blockers.
