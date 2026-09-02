# Repository Structure and Move Map

## Canonical Tree

```text
GIS/
  product/
    frontend/
    backend/
    db/
  process/
    USAGE.md
    APPROACH.md
    prompts/
    rules/
    templates/
  docs/
    architecture/
    CODEBASE_FILE_CATALOG.md
    ARCHITECTURE_AND_DATA_PROVENANCE.md
    ENGINEERING_GUIDE.md
    GSD_CORE.md
    REPO_OPERATING_MODEL.md
  assets/
    ideation/
  .planning/
  junk/
```

## Old -> New Move Map

### Runtime Product

- `ns-qaw-a/frontend` -> `product/frontend`
- `ns-qaw-a/backend` -> `product/backend`
- `ns-qaw-a/db` -> `product/db`
- `ns-qaw-a/.env.example` -> `product/backend/.env.example`
- `ns-qaw-a/requirements.txt` -> `product/backend/requirements.txt`

### Architecture and Ideation

- `STACK.md` -> `docs/architecture/STACK.md`
- `V1_HLD.md` -> `docs/architecture/V1_HLD.md`
- `V1_LLD.md` -> `docs/architecture/V1_LLD.md`
- `mapsheetzero.html` -> `assets/ideation/mapsheetzero.html`
- `engineering-guide-infographic.html` -> `assets/ideation/engineering-guide-infographic.html`

### Process and Workflow Assets

- `USAGE.md` -> `process/USAGE.md`
- `APPROACH.md` -> `process/APPROACH.md`
- `prompts/*` -> `process/prompts/*`
- `rules/*` -> `process/rules/*`
- `templates/*` -> `process/templates/*`

Compatibility pointers remain at repository root for `USAGE.md` and `APPROACH.md`.

## Notes

- The redesign keeps runtime behavior intact by preserving internal `frontend`/`backend`/`db` relative paths.
- Root-level governance files remain (`README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`) as stable entrypoints.
- Non-essential local artifacts are isolated under `junk/` and excluded via `.gitignore`.
