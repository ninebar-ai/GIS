# Review checklist

Use this checklist on every PR after CI and automated review.

## Before reading the diff

- [ ] Read the explain-back first (summary, assumptions, plan gaps).
- [ ] Check size (roughly >400 changed lines should be split).
- [ ] Check plan match against `.planning/phases/<N>/PLAN.md`.
- [ ] Check declared risk areas in PR template.

## Must-read areas

- [ ] Auth, permissions, tenancy boundaries
- [ ] Migrations/schema changes
- [ ] External writes and failure paths
- [ ] Prompt/tool behavior changes
- [ ] Dependency changes
- [ ] Tests (behavioral, not only mocks)

## Agent-specific failure hunt

- [ ] Invented/nonexistent package
- [ ] Scope creep beyond plan
- [ ] Silent exception swallowing
- [ ] Missing timeout/error path on external calls
- [ ] Hardcoded config values
- [ ] Happy-path-only logic
- [ ] Reimplemented existing helper unnecessarily

## Non-negotiables audit

Check pass/fail/n-a for each item in `process/rules/non-negotiables.md`.

## Verdict

- APPROVE
- REQUEST CHANGES
- SEND BACK (too large / mis-scoped / missing explain-back)

## Final checks

- [ ] Would this diff make `AGENTS.md` inaccurate? Update in same PR if yes.
- [ ] Are docs/planning files updated (`STATE.md`, verification, changelog)?
