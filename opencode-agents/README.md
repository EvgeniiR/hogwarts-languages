# Hogwarts Español — Agent Workflow

Every non-trivial task MUST follow this cycle. Do NOT skip steps.

```
CLARIFY → DESIGN → DESIGN-REVIEW → (loop until agree) → PLAN → CODER → REVIEWER → (loop until clean)
```

## Phase 0: Clarify requirements

Dispatch `@clarify` (`deepseek-v4-pro`) to transform the feature request into a detailed requirements spec:

- Restates the problem, decomposes into functional requirements.
- Identifies codebase constraints (from AGENTS.md file-layout, state shape, module rules).
- Maps data/persistence impact: new `S`/`R` fields, storage keys touched, existing state read/modified.
- Identifies cross-cutting concerns: window bindings, new overlays, new module files, circular import risks.
- Produces specific clarifying questions for the user (`[Q-UI]`, `[Q-BEHAVIOR]`, `[Q-DATA]`, `[Q-SCOPE]`).

**Loop:** The primary agent relays questions to the user, feeds answers back to `@clarify`. Repeat until the spec has zero open questions OR remaining questions are acceptable. **Max 3 rounds.**

## Phase 1: Design

Dispatch `@designer` (`deepseek-v4-pro`) with the finalized requirements spec to produce a concrete design:

1. List every file that needs changes in dependency order (leaf modules first).
2. Specify exact state changes: new `S`/`R` fields, types, defaults, migration rules.
3. Map the module dependency graph — confirm no circular imports.
4. Identify risks, edge cases, and a verification plan.

**Output:** a structured design document with file-by-file change plan.

## Phase 2: Design review

Dispatch `@design-reviewer` (`deepseek-v4-flash`) to inspect the design:

- Checks state correctness (boolean guards, `saveS()` calls, pruning limits).
- Validates module graph (no circular imports, leaf modules stay clean).
- Verifies HTML/JS bindings (every `onclick` → `window` binding).
- Checks conventions (CSS location, no new abstractions, correct edit order).
- Probes edge cases (empty state, first load, API down, mobile, quota exceeded).

**Verdict:** one of:
- ✅ **APPROVED** — proceed to Phase 3 (Plan).
- ⚠️ **NEEDS REVISION** — primary agent feeds issues back to `@designer`. Loop.
- ❓ **NEEDS USER INPUT** — primary agent relays questions to user.

**Hard cap:** max 3 design-review cycles. If still not approved, present remaining issues as a risk assessment.

## Phase 3: Plan

The primary agent (`build`, powered by `deepseek-v4-pro`) takes the approved design and produces a numbered implementation task list:

1. Break the design into discrete, ordered tasks.
2. Each task specifies the file(s) to edit and what to change.
3. Tasks are ordered by dependency (leaf modules first).

**Output:** a numbered task list committed to `todowrite`.

## Phase 4: Code with @coder

Dispatch each task to the `@coder` subagent (`deepseek-v4-flash`):

- `@coder` loads only the files it needs (per file-layout table).
- Edits are targeted — use Edit, never rewrite whole files.
- After every JS batch: `bash scripts/check.sh`.
- `@coder` marks its task `completed` in the todo list when done.

## Phase 5: Review with @reviewer

After all @coder tasks for a unit of work are done, dispatch `@reviewer` (`deepseek-v4-flash`) to inspect the diff. When tasks are interdependent (task B builds on task A's output), consider dispatching `@reviewer` after each task to catch compound issues early.

1. `git diff` — examine every changed line.
2. `bash scripts/check.sh` — syntax + import graph.
3. Scan for common pitfalls (boolean truthiness, missing `window` bindings, circular imports, comments, CSS location).
4. Auto-fix simple issues (syntax, imports, typos, conventions).
5. Report semantic issues that need human judgment.

## Phase 6: Auto-fix loop

If `@reviewer` found and auto-fixed issues:
- Re-run `bash scripts/check.sh` to confirm clean.
- If fixes introduced new problems, loop back to @coder for the affected file.

If `@reviewer` flagged semantic issues:
- The primary agent evaluates and either fixes directly or loops back to @coder.

**Exit condition:** `check.sh` passes + reviewer reports no remaining issues (either fixed or flagged for follow-up).

## Model assignments

| Role | Model | Why |
|------|-------|-----|
| @clarify (subagent) | `deepseek/deepseek-v4-pro` | Strong reasoning for requirements analysis and gap detection |
| @designer (subagent) | `deepseek/deepseek-v4-pro` | Strong reasoning for architecture decisions and file planning |
| @design-reviewer (subagent) | `deepseek/deepseek-v4-flash` | Fast systematic checklist against codebase constraints |
| Plan / Build (primary) | `deepseek/deepseek-v4-pro` | Strong reasoning for architecture decisions |
| @coder (subagent) | `deepseek/deepseek-v4-flash` | Fast, precise edits, cost-efficient |
| @reviewer (subagent) | `deepseek/deepseek-v4-flash` | Fast diff scanning, systematic checklist |
