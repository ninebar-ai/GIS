# Changelog

All notable changes to this repository are listed here.

## [Unreleased]

### Changed
- Reorganized runtime into canonical `product/frontend`, `product/backend`, and `product/db`.
- Moved architecture references to `docs/architecture/`.
- Moved ideation artifacts to `assets/ideation/`.
- Moved workflow prompts, rules, templates, and usage playbooks under `process/`.
- Updated run commands, governance docs, and ownership paths to match the new structure.

### Added
- `docs/CODEBASE_FILE_CATALOG.md` (tracked file purpose/data/provenance catalog).
- `docs/ARCHITECTURE_AND_DATA_PROVENANCE.md` (data lineage and runtime architecture).
- `docs/REPO_STRUCTURE.md` (canonical tree and old->new move map).
- Product sub-READMEs under:
  - `product/frontend/README.md`
  - `product/backend/README.md`
  - `product/db/README.md`
- `junk/` policy for non-essential local artifacts.
