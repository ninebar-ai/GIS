# GSD Core Quick Reference (GIS)

Aligned with `gsd-core-next` command model.

## Install

```bash
npx @opengsd/gsd-core@latest
```

Then choose runtime + project scope in installer prompts.

## Start Commands

- New project: `/gsd-new-project`
- Existing repository onboarding: `/gsd-onboard`
- State-aware launcher: `/gsd-next`

## Standard Phase Loop

```bash
/gsd-discuss-phase <N>
/gsd-plan-phase <N> --mvp
/gsd-execute-phase <N>
/gsd-verify-work <N>
/gsd-ship <N>
```

## High-Value Utility Commands

```bash
/gsd-progress --next
/gsd-map-codebase
/gsd-ingest-docs
/gsd-pause-work --report
/gsd-resume-work
/gsd-code-review <N>
```

## Planning Artifacts to Keep Current

- `.planning/PROJECT.md`
- `.planning/REQUIREMENTS.md`
- `.planning/ROADMAP.md`
- `.planning/STATE.md`
- `.planning/CONTEXT.md` or `continue-here.md` (when used)
- `.planning/phases/<N>/PLAN.md`
- `.planning/phases/<N>/VERIFICATION.md`
- `.planning/handoffs/*.md`

## Repo-Specific Notes

- Keep deterministic parser coverage for core GIS commands.
- Preserve data provenance fields in ingest/runtime outputs.
- Keep platform convergence explicit in phase notes and PR narratives.
