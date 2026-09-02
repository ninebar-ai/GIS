# Pull Request template

## What and why

<What behavior changed and why>

## Phase context

- Plan: `.planning/phases/<N>/PLAN.md`
- Verification: `.planning/phases/<N>/VERIFICATION.md`
- Tier: Platform | POC | Spike

## Agent explain-back

Paste:
- five-bullet change summary
- assumptions made
- what from plan was not done

## Risk areas touched

- [ ] Auth/permissions/tenancy
- [ ] Migrations/schema
- [ ] External writes
- [ ] Prompt/tool behavior
- [ ] Dependencies
- [ ] None

## Checklist

- [ ] Matches plan scope (no silent scope expansion)
- [ ] Tests cover behavior, not only mocks
- [ ] No secrets/customer data leakage
- [ ] `AGENTS.md` still accurate
- [ ] Docs/planning files updated
