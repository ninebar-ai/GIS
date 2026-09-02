# Prompt - Handoff to teammate

Context to load:
- `docs/ENGINEERING_GUIDE.md`
- `docs/GSD_CORE.md`
- `process/templates/HANDOFF.md`
- `.planning/STATE.md`
- current and recent phase plan/verification files

Prompt to run:

I am handing this work to a teammate.

Step 1 - Check handoff readiness:
- task boundary status
- uncommitted/unpushed work
- stale state file detection

Step 2 - Summarize what `.planning` already captures.

Step 3 - Interview for what `.planning` misses:
- tried and rejected options
- in-flight details
- blockers
- access requirements
- landmines
- open questions with owners

Step 4 - Generate handoff file using `process/templates/HANDOFF.md` at:
`.planning/handoffs/YYYY-MM-DD-<from>-to-<to>.md`

Step 5 - Run pre-file checklist and remind to run:
`/gsd-pause-work --report`
