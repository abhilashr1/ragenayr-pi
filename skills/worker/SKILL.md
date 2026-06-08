---
name: worker
description: Delegate the current chat request to the builtin worker subagent using the opencode-go/deepseek-v4-pro model, then return the worker's result. Use for quick task switching when the user wants DeepSeek V4 Pro to execute a coding, repo, or shell task.
---

# Worker

Delegate the user's current request to a single `worker` subagent running DeepSeek V4 Pro, then report the result back to the user.

## Intent

This skill is a lightweight model-switching shim. The parent/orchestrating model should avoid doing the requested work itself except to package the handoff, launch the worker, and relay/summarize the result.

## Workflow

1. Identify the concrete task from the current user message and any immediately relevant chat context.
2. Use the `subagent(...)` tool, not a shell command, to delegate.
3. Before launching, run:

   ```typescript
   subagent({ action: "list" })
   ```

   Confirm that an executable `worker` agent exists.
4. Launch exactly one worker with:

   ```typescript
   subagent({
     agent: "worker",
     model: "opencode-go/deepseek-v4-pro",
     context: "fork",
     task: "<handoff prompt>"
   })
   ```

5. Return the worker's final result to the user. Keep the summary concise, but include changed files, commands run, validation results, and residual risks when the worker reports them.

## Handoff prompt template

Use a compact prompt like:

```text
Execute this user request using the current repository and inherited chat context:

<exact user request>

Constraints:
- Use the current working directory unless the request says otherwise.
- For code changes, edit files directly and do not commit, push, or stage changes unless explicitly requested.
- Run the most relevant validation you can reasonably run for the change, or explain why validation was not run.
- Stop and report if the request requires an unapproved product, architecture, destructive, credential, or external-service decision.

Return:
- What you did or found.
- Files changed, if any.
- Commands run and their results, if any.
- Validation evidence.
- Residual risks or follow-up needed.
```

## Defaults and fallbacks

- Use `model: "opencode-go/deepseek-v4-pro"` exactly.
- If that model is unavailable, ask the user before substituting another model such as `deepseek-v4-flash`.
- Prefer a foreground/blocking subagent call for quick tasks so the result can be returned immediately.
- If the task is clearly long-running, it is acceptable to launch with `async: true`, give the user the run id, and resume or poll status when the result is needed.
- If forked context fails because the parent session is not persisted, retry with `context: "fresh"` and include all necessary context explicitly in the task prompt.

## Safety

- Use only one writer worker in the active worktree.
- Do not edit the same worktree in the parent while the worker is running.
- Do not launch parallel workers unless the user explicitly asks for isolated parallel attempts and worktree isolation is configured.
- The parent owns final communication to the user; do not claim independent review unless an actual review was performed.
