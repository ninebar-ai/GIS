# The ten non-negotiables

These apply to every repository and every tier.

1. **Never invent a library.** If unsure a package exists, stop and ask.
2. **Never widen scope beyond the plan.** Extra ideas go in PR notes, not the diff.
3. **Never edit a test to make it pass.** Fix code, or flag the test as wrong.
4. **No secrets, keys, or customer data** in code, prompts, logs, traces, or planning docs.
5. **Every external call has a timeout and an explicit error path.**
6. **Every new endpoint has input validation and a test.**
7. **No silent exception swallowing.**
8. **Configuration comes from the environment.** Never hardcode.
9. **Migrations are additive and reversible.** Destructive changes need sign-off.
10. **If a file passes 400 lines, or a block is copied for the third time,** propose refactor.

## Repo addendum (GIS + platform integration)

- Keep deterministic copilot/map behavior for known commands.
- No fabricated telecom entities/data in user-visible outputs.
- Use PostGIS for operational geospatial entities; use hybrid telemetry serving for massive data.
- Update `.planning/STATE.md` and phase verification records on substantial changes.
