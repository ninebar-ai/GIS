# Prompt - Review changes against standards

Context to load:
- `docs/ENGINEERING_GUIDE.md`
- `process/rules/review-checklist.md`
- `process/rules/non-negotiables.md`
- target diff/PR
- `.planning/phases/<N>/PLAN.md`

Prompt to run:

Review this diff as an adversarial second-model reviewer.

Step 1 - Gate check:
- diff size (~400 line cap guideline)
- explain-back present
- plan-match check

Step 2 - Deep review on risky categories:
- auth/permissions
- migrations/schema
- external writes/error paths
- prompts/tools
- dependencies
- tests (behavior vs mock-only)

Step 3 - Explicit non-negotiables audit (pass/fail/n-a per rule).

Step 4 - Output verdict:
- APPROVE
- REQUEST CHANGES
- SEND BACK (too large/mis-scoped/missing gate artifacts)

Output format:
- Severity-ranked findings with file references
- Open questions
- Final verdict and required actions
