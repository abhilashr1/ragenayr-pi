---
name: task
description: Turn an implementation requirement into an execution-ready plan, write it to a markdown task document, delegate implementation to a worker model (default opencode-go/deepseek-v4-pro), have the original/main model review and validate the diff, run super-review on the resulting changes, delegate review-driven fixes to DeepSeek V4 Pro subagents, then summarize and offer safe cleanup of any created worktrees. Use when the user asks to implement a feature/change through a planned handoff workflow.
---

# Task

Plan, delegate, review, fix, and summarize an implementation task.

This skill is an orchestrated implementation workflow:

1. The **main/orchestrating model** plans and owns decisions. Preferred model: `openai-codex/gpt-5.5` with `high` thinking.
2. The plan is written to a markdown document.
3. A single implementation worker applies the plan. Preferred worker model: `opencode-go/deepseek-v4-pro`.
4. The main/orchestrating model reviews the worker's diff against the plan, manually fixes any immediate issues, and validates.
5. The main/orchestrating model runs the `super-review` skill on the resulting current changes.
6. Actionable super-review findings are fixed by DeepSeek V4 Pro fix subagents, with the main model triaging, reviewing, validating, and owning final acceptance.
7. The main/orchestrating model summarizes and offers safe cleanup of any created worktrees.

## Non-negotiables

- Keep the main model in charge of product, architecture, scope, and final quality.
- Use exactly one writer worker for the initial implementation. Do not launch parallel writers into the same worktree.
- The implementation worker must use `model: "opencode-go/deepseek-v4-pro"` unless that model is unavailable; if unavailable, ask before substituting `deepseek-v4-flash` or another opencode-go model.
- Use the `subagent(...)` tool (from the `pi-subagents` package) to delegate implementation. Do **not** run `pi -p` synchronously inside a bash call — that hides live output, risks blind timeouts, and prevents progress visibility.
- Launch the worker async and poll its progress via `subagent({ action: "status", id: "..." })` or by checking `git diff --stat` on the active worktree. The async completion mechanism delivers the worker's handoff naturally; do not hard-kill with a fixed timeout.
- The main/orchestrating model performs review, triage, validation, and final acceptance. It may delegate concrete super-review remediation to DeepSeek V4 Pro fix subagents, but must not outsource final acceptance.
- Always create/update a markdown task plan before implementation.
- After the implementation and main-model review/fixes, run the `super-review` skill on the actual current changes before finalizing.
- Super-review remediation workers must use `model: "opencode-go/deepseek-v4-pro"` unless that model is unavailable; if unavailable, ask before substituting.
- Do not launch parallel writer/fix agents into the same worktree. Prefer sequential fix agents in the active worktree; only use parallel fix agents when each has an isolated worktree and the main model will reconcile the results.
- Do not silently expand scope. Ask the user before product, architecture, migration, security, or dependency decisions that are not implied by the requirement or required by a high-confidence super-review finding.
- Do not automatically delete review/fix worktrees. At the end, state whether each created worktree appears safe to delete and offer the cleanup command or ask for permission to remove it.

## Inputs

The user provides a requirement, for example:

```text
/skill:task Add CSV export to the reports page with a download button and tests.
```

Treat invocation of this skill as approval to implement after necessary clarification. Ask clarifying questions only when the requirement, acceptance criteria, risk, or scope is ambiguous enough that implementation would require guessing.

## Task document location

Create a task document at:

```text
docs/tasks/YYYY-MM-DD-<short-slug>.md
```

If the repository strongly prefers another planning location (`.scratch/`, `planning/`, `docs/agents/`, etc.), use the repo convention and state the path.

Prefer replacing the document only when re-running the same task; otherwise create a new dated file. Keep it detailed enough for a different model to implement without the conversation, but compact enough to review.

## Workflow

### 1. Understand and clarify

1. Inspect current repo state:
   - `pwd`
   - `git status --short --branch`
   - `git rev-parse --show-toplevel`
2. Read relevant docs and conventions when present:
   - `README*`, `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, `CONTRIBUTING.md`.
   - `docs/adr/`, `docs/tasks/`, `docs/agents/`, style/standards docs.
   - package/build/test/lint/typecheck configs.
3. Search the codebase for existing patterns, nearby features, call sites, tests, and naming conventions.
4. Ask concise clarification questions only for decisions that materially affect implementation. Otherwise continue.

### 2. Write the task plan markdown

The task document must include these sections:

```md
# Task: <short title>

## Requirement
- <user requirement in precise language>

## Goals
- <observable outcomes>

## Non-goals
- <explicitly excluded scope>

## Current context
- <important repo facts, existing patterns, conventions, and constraints>

## Files likely to change
- `<path>` — <why this file likely changes>

## Implementation plan
1. <step>
2. <step>
3. <step>

## Validation contract
- <commands/tests/checks/user flows the worker should run>
- <manual evidence expected if automated validation is unavailable>

## Risks and edge cases
- <risk> — <mitigation>

## Worker handoff prompt
<compact implementation prompt the worker can follow without reading the chat>

## Main-model review checklist
- Requirement satisfied?
- Only planned scope changed?
- Conventions followed?
- Tests/validation adequate?
- No obvious regressions, security/privacy issues, or dead code?
```

The `Files likely to change` list should be based on code inspection, not guesses. It can include `unknown yet` only when discovery genuinely depends on implementation.

### 3. Delegate implementation to DeepSeek worker via subagent

Launch the worker using the `subagent(...)` tool. This gives live progress, natural completion, and no blind timeouts.

**Launch the worker:**

```typescript
subagent({
  agent: "worker",
  model: "opencode-go/deepseek-v4-pro",
  task: "Implement the task plan at <PLAN_PATH>.\n\nHard constraints:\n- Follow the plan and validation contract.\n- Stay inside approved scope.\n- Use existing repo conventions.\n- Do not make product/architecture/dependency/migration/security decisions beyond the plan; stop and report if one is needed.\n\nReturn a handoff with:\n- changed files\n- what was implemented\n- any deviations from the plan and why\n- commands run with exit codes\n- validation evidence\n- remaining issues or decisions needed",
  async: true,
  context: "fork"
})
```

**Poll progress while the worker runs:**

After launching, the parent/orchestrator must not sit idle or apply a blind timeout. Instead, poll the worker every ~30–60 seconds:

```typescript
subagent({ action: "status", id: "<run-id>" })
```

Also check the active worktree for accumulating changes:

```bash
git status --short
git diff --stat
git diff --check
```

These checks give the user same-page visibility: they see the worker is alive, what files are changing, and whether the diff looks healthy.

If the status poll shows the worker is stuck (no git activity, no log changes, no tool output across a reasonable idle window of ~180–300s), report that to the user and ask whether to wait longer, interrupt, or retry with tighter scope. Do not hard-kill the worker without asking.

**When the worker completes:**

The async completion delivers the worker's handoff into the parent session. If you were polling status, call `status` one final time or wait for the async delivery to arrive.

If the `subagent` tool is unavailable, stop after writing the task document and tell the user the exact worker handoff prompt to run manually. Do **not** fall back to synchronous `pi -p` in bash.

### 4. Review the worker result against the plan

After the worker finishes:

1. Inspect:
   - `git status --short`
   - `git diff --stat`
   - `git diff`
   - changed files and relevant surrounding code
2. Compare the diff to the task document:
   - Every goal is implemented.
   - Non-goals are respected.
   - Files changed are expected or justified.
   - Tests and validation match the validation contract.
   - Existing conventions and architecture are preserved.
3. Run focused validation commands when practical.
4. If there are issues, the main model fixes them manually using normal file-editing tools.
5. If a required fix involves unapproved scope/product/architecture/dependency/migration/security decisions, ask the user before proceeding.

### 5. Super-review gate and remediation

After the main-model review/fixes and focused validation, run the `super-review` skill on the resulting current changes.

Before invoking super-review, make sure the review target represents the actual current task diff, not merely a stale branch tip. Provide the task plan path and the intended base/reference if useful. If the super-review flow creates an isolated worktree, record its path from the review output for final cleanup guidance.

Triage the super-review result:

1. Classify findings as:
   - must-fix now: high-confidence High/Medium findings that are in scope.
   - optional/follow-up: Low/nits, ambiguous findings, or items outside the approved scope.
   - rejected: findings that are incorrect, already mitigated, or conflict with project constraints; briefly note why.
2. For each must-fix-now item or coherent group of independent items, create a DeepSeek V4 Pro fix subagent.
3. Keep the main model in charge: review each fix-agent diff, run focused validation, and manually repair anything the agent misses.
4. If a finding requires unapproved product, architecture, dependency, migration, or security decisions, ask the user before fixing.

**Launch a fix subagent:**

```typescript
subagent({
  agent: "worker",
  model: "opencode-go/deepseek-v4-pro",
  task: "Fix only these super-review finding(s) from the current task diff:\n\n<FINDINGS>\n\nContext:\n- Task plan: <PLAN_PATH>\n- Super-review summary: <SUMMARY_OR_PATH>\n\nHard constraints:\n- Stay inside the finding(s) and approved task scope.\n- Follow existing repo conventions.\n- Do not make product/architecture/dependency/migration/security decisions beyond the approved scope; stop and report if one is needed.\n- Return changed files, fixes made, commands run with exit codes, validation evidence, and remaining issues.",
  async: true,
  context: "fork"
})
```

Prefer sequential fix subagents in the active worktree so diffs are easy to review. If multiple fixes are truly independent and parallel work is worth it, use isolated worktrees for each writer, then have the main model reconcile/port the accepted changes back into the active task worktree before final validation.

### 6. Final self-review and cleanup offer

After super-review remediation, inspect the final diff again. For complex/risky changes, optionally run fresh-context review-only subagents for focused validation, but the main model still owns final acceptance.

Minimum final checks:

```bash
git status --short
git diff --stat
git diff --check
```

Run project-specific tests/lints/typechecks when appropriate and reasonably scoped.

For every review/fix worktree created during the workflow:

1. Check whether it is safe to delete:
   - `git -C <WORKTREE> status --short --branch`
   - confirm there are no unique, unported changes needed from that worktree.
2. Do not delete automatically unless the user explicitly asks.
3. In the final response, state one of:
   - safe to delete, with `git worktree remove <WORKTREE>`.
   - not safe to delete yet, with the reason.
   - no extra worktrees were created.

## Final response format

```md
# Task Complete: <title>

## Plan
- Task doc: `<path>`
- Requirement: <one-line requirement>

## Implemented
- `<path>` — <what changed>

## Main-model review and fixes
- <issues found during review and how they were fixed, or `No plan deviations found`>

## Super-review and remediation
- Super-review: <overall recommendation or `No actionable findings`>
- DeepSeek fix subagents: <count and summary, or `None needed`>
- Findings deferred/rejected: <brief reasons, or `None`>

## Validation
- `<command>` — <result>

## Worktree cleanup option
- <`No extra worktrees created` OR `<path>` — safe/not safe to delete; command/next step>

## Remaining notes
- <risks, follow-ups, skipped checks, or `None`>
```

Keep the final summary concise. Mention the worker model used and any substitution if `opencode-go/deepseek-v4-pro` was unavailable.
