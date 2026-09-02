# Phase 1 PLAN - Documentation and process normalization

## Objective

Standardize engineering workflow documentation so new and existing contributors can scaffold, join, handoff, and review work consistently with AI agents.

## Atomic tasks

1. Create `USAGE.md` walkthrough.
2. Add `docs/GSD_CORE.md` quick reference.
3. Add `docs/ENGINEERING_GUIDE.md` repo standards.
4. Add `prompts/` for paths A-D.
5. Add full `templates/` set (`AGENTS`, `CLAUDE`, `HANDOFF`, `PULL_REQUEST`, `ADR`, `project-brief`).
6. Add `rules/` set (`non-negotiables`, `definition-of-done`, `review-checklist`).
7. Initialize `.planning` baseline files.
8. Update root `README.md` to expose kit and standards.
9. Add repository hygiene docs and PR/issue templates.
10. Gitignore external `engineering-kit/` bundle.

## Risks

- Overly generic docs may not help real repo workflows.
- Missing references to parent platform stack may cause divergence.

## Verification criteria

- All listed files exist and are readable.
- README points to kit entry points.
- Team can run one simulated flow each for join, handoff, and review using prompt files.
