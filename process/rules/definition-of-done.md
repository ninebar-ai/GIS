# Definition of Done

Done criteria are cumulative by tier.

## Every tier

- [ ] No secrets in git.
- [ ] Dependencies are explicit and reviewed.
- [ ] `README.md` and run instructions are current.
- [ ] Work reproduces on teammate machine from clean state.

## POC adds

- [ ] Happy-path tests for changed entry points.
- [ ] Useful error responses (no raw stack traces to user).
- [ ] `AGENTS.md` and `.planning/STATE.md` are updated.
- [ ] Verification evidence recorded in `.planning/phases/<N>/VERIFICATION.md`.
- [ ] Scale implications are noted when touching data/rendering/API behavior.

## Platform adds

- [ ] CI coverage floor met.
- [ ] Structured logging/tracing for changed services.
- [ ] Input validation and auth checks tested.
- [ ] Migrations reversible and rollout-safe.
- [ ] Alerting/runbook impact documented.

## Repo-specific architecture bar

- [ ] No duplicate control-plane services added in GIS.
- [ ] GIS changes align to parent platform integration path.
- [ ] PostGIS used for operational geospatial entities where applicable.
- [ ] Massive telemetry path uses hybrid serving (not raw DB dump to UI).
