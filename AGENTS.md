# Agent instructions

## Coding delegation

Delegate coding tasks (writing/editing code, tests, refactors, bug fixes) to a
sub-agent sized to the task's complexity rather than always using the most capable
model available. Reserve the largest model for planning, review, and genuinely hard
reasoning (tricky architecture, subtle concurrency/security bugs, ambiguous
requirements). Research/exploration-only work is unaffected.

## Documentation

Comments and docs are reviewed by the `technical-writer` agent (`.claude/agents/`):
accurate against the code, current, and signal rather than noise. Run it after a
feature lands or before a release. It never changes code behaviour.

## Don't cut corners on completion

- Never mark a task complete without pasting the actual command output that proves
  it — a claim without output is not verification.
- If a test is inconvenient, fix the code. Never edit, weaken, or delete a test to
  make it pass.
- Do not narrow scope silently. If part of what was asked can't be done, say so
  explicitly rather than delivering less and calling it done.
- Prefer a different model as reviewer than the one that implemented, for
  high-stakes changes, when more than one is actually available.

## Architecture decisions

Record non-obvious architecture/design decisions as ADRs under `docs/decisions/`,
one file per decision (`NNNN-short-title.md`), immutable once written — a changed
mind gets a new ADR marked "supersedes ADR-NNNN," not an edit to the old one. Before
proposing an architectural change, check whether `docs/decisions/` already has a
ruling on it. Use the template at `docs/decisions/template.md`.
