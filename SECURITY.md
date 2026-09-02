# Security Policy

## Reporting

Report vulnerabilities privately to maintainers; do not publish exploit details in public issues.

Include:
- affected files and runtime path (`product/frontend`, `product/backend`, `product/db`);
- impact assessment;
- reproduction steps;
- suggested remediation if available.

## Secure Development Rules

- Never commit secrets, credentials, private keys, or customer data.
- Keep `.env*` local; commit placeholders only (`product/backend/.env.example`).
- Validate external inputs (prompt text, upload payloads, query params).
- Require timeouts and explicit failure paths for outbound calls.
- Preserve deterministic fallback behavior when LLM/API providers fail.

## Data Handling

- Treat telemetry/log artifacts as potentially sensitive.
- Minimize raw data exposure in exported outputs.
- Keep provenance fields intact in published inventory artifacts.

## Dependency Hygiene

- Keep dependencies minimal and justified.
- Review major upgrades for transitive security risk.
- Record notable dependency/runtime changes in `CHANGELOG.md`.
