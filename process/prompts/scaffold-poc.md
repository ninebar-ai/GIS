# Prompt - Scaffold a new POC

Context to load before running:
- `docs/ENGINEERING_GUIDE.md`
- `docs/GSD_CORE.md`
- `process/rules/non-negotiables.md`
- `process/rules/definition-of-done.md`
- `process/templates/project-brief.md`
- `process/templates/AGENTS.md`
- `process/templates/CLAUDE.md`

Prompt to run:

I am scaffolding a new POC slice in this GIS repo.

Step 1 - Ask the day-0 questionnaire from `process/templates/project-brief.md` one question at a time.
Step 2 - Fill the brief and derive tier/template/storage decisions.
Step 3 - Draft `AGENTS.md` from template with the ten non-negotiables included.
Step 4 - Draft `CLAUDE.md` from template.
Step 5 - Provide the exact bootstrap command sequence, including:
- `npx @opengsd/gsd-core@latest`
- `/gsd-new-project`
- first phase loop commands

Constraints:
- do not scaffold production code in this step;
- stop if Q10 (good-answer examples) is incomplete;
- keep scope within one phase boundary;
- align with parent platform integration path.
