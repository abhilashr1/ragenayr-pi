---
name: task
description: Turn an implementation requirement into an execution-ready plan, write it to a markdown task document, delegate implementation to a worker model (default opencode-go/deepseek-v4-pro), then have the original/main model review the resulting diff against the plan, manually fix issues, validate, and summarize. Use when the user asks to implement a feature/change through a planned handoff workflow.
---

# Task

Plan, delegate, review, fix, and summarize an implementation task.

This skill is an orchestrated implementation workflow:

1. The **main/orchestrating model** plans and owns decisions. Preferred model: `openai-codex/gpt-5.5` with `high` thinking.
2. The plan is written to a markdown document.
3. A single implementation worker applies the plan. Preferred worker model: `opencode-go/deepseek-v4-pro`.
4. The main/orchestrating model reviews the worker's diff against the plan, manually fixes any issues, validates, and summarizes.

## Non-negotiables

- Keep the main model in charge of product, architecture, scope, and final quality.
- Use exactly one writer worker for the initial implementation. Do not launch parallel writers into the same worktree.
- The implementation worker must use `model: "opencode-go/deepseek-v4-pro"` unless that model is unavailable; if unavailable, ask before substituting `deepseek-v4-flash` or another opencode-go model.
- The main/orchestrating model performs the final review and any fix-up edits manually with normal tools (`read`, `edit`, `write`, `bash`). Do not outsource final acceptance.
- Always create/update a markdown task plan before implementation.
- Do not silently expand scope. Ask the user before product, architecture, migration, security, or dependency decisions that are not implied by the requirement.

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

### 3. Delegate implementation to DeepSeek worker

Use the `pi-subagents` workflow if available. The parent/orchestrator should launch one worker with a concrete handoff and model override:

```typescript
subagent({
  agent: "worker",
  model: "opencode-go/deepseek-v4-pro",
  task: "Implement the task plan at <PLAN_PATH>.\n\nHard constraints:\n- Follow the plan and validation contract.\n- Stay inside approved scope.\n- Use existing repo conventions.\n- Do not make product/architecture/dependency/migration/security decisions beyond the plan; stop and report if one is needed.\n\nReturn a handoff with:\n- changed files\n- what was implemented\n- any deviations from the plan and why\n- commands run with exit codes\n- validation evidence\n- remaining issues or decisions needed",
  async: true,
  context: "fork"
})
```

If `subagent` is unavailable, stop after writing the task document and tell the user the exact worker handoff prompt to run manually. Do not pretend implementation happened.

While the worker runs, the main model may read code, prepare validation, or refine review checklists, but must not edit the same files concurrently.

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

### 5. Final self-review

After manual fixes, inspect the final diff again. For complex/risky changes, optionally run fresh-context review-only subagents for focused validation, but the main model still owns final acceptance.

Minimum final checks:

```bash
git status --short
git diff --stat
git diff --check
```

Run project-specific tests/lints/typechecks when appropriate and reasonably scoped.

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

## Validation
- `<command>` — <result>

## Remaining notes
- <risks, follow-ups, skipped checks, or `None`>
```

Keep the final summary concise. Mention the worker model used and any substitution if `opencode-go/deepseek-v4-pro` was unavailable.
