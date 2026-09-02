# Prompt - Join an existing repo/platform

Context to load:
- `docs/ENGINEERING_GUIDE.md`
- `docs/GSD_CORE.md`
- `process/rules/non-negotiables.md`
- repo `AGENTS.md` (if present)
- `.planning/ROADMAP.md`, `.planning/STATE.md` (if present)
- last 2-3 `.planning/phases/*` files (if present)

Prompt to run:

I am joining this repository mid-stream.

Step 1 - Classify:
- Case A: compliant repo (`AGENTS.md` + `.planning/` usable)
- Case B: inherited/non-standard

Step 2 - Reconstruct state:
- where roadmap is going
- where current phase is
- what last decisions were and why

Step 3 - Output next safe phase entry plan with concrete commands and files.

Step 4 - If Case B, draft a truthful baseline `AGENTS.md` and characterisation-test plan before any behavior changes.

Constraints:
- do not code in this step;
- flag missing governance docs as first blocker;
- keep recommendations aligned to parent platform boundaries.
