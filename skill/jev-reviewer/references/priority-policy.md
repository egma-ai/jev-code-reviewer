# Priority policy

Jev-Reviewer uses these default meanings. Repository configuration may make them stricter.

## P0 — human review required

Use for changes where a plausible defect has high impact or automated evidence is insufficient. Typical signals include authentication or authorization, secrets or privacy, payments, destructive operations, migrations, data integrity, concurrency, missing relevant tests, incomplete context, or high classification uncertainty.

## P1 — human review recommended

Use for meaningful business logic, API or schema behavior, error handling, state transitions, non-mechanical refactors, or changes with useful but incomplete verification.

## P2 — mechanical or well-supported

Use only for low-risk, well-supported changes such as formatting, generated output, documentation, mechanical renames, or repetitive type propagation. P2 requires sufficient context and passing relevant checks. Any sensitive boundary, failed check, missing evidence, or meaningful uncertainty should escalate the change.

## Changing policy

Change `config/policy.json`, add a repository `.jev-reviewer.json`, or pass a policy file with `--policy`. Keep risk policy separate from display preferences such as which groups are expanded by default. Do not weaken repository review requirements merely to reduce the number of visible P0 or P1 cards.
