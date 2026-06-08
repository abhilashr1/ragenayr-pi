# ragenayr-pi

Personal Pi package with extensions, skills, prompts, and themes.

## Install

```bash
pi install git:github.com/abhilashr1/ragenayr-pi
```

## Sync updates (one command)

Use the sync script from your repo clone:

```bash
~/code/ragenayr-pi/pisync.sh
```

What it does:
- pulls latest repo changes
- syncs local Pi resources (`extensions`, `prompts`, `skills`, `themes`) into the repo
- commits and pushes only if changes exist
- runs `pi update --extensions`

## Extensions

- `provider-usage-status` — Adds a status line item showing provider limits/usage.
  - auto-detects `5h` and `weekly` from provider response headers when available
  - optional usage API polling via env vars:
    - `PI_USAGE_ENDPOINT_OPENAI`, `PI_USAGE_TOKEN_OPENAI`
    - `PI_USAGE_ENDPOINT_OPENCODE`, `PI_USAGE_TOKEN_OPENCODE`
    - `PI_USAGE_ENDPOINT_CURSOR`, `PI_USAGE_TOKEN_CURSOR` (optional; otherwise Cursor usage status is hidden when no limit data is exposed)
  - opencode-go fallback estimate (when no limits API exists):
    - `PI_OPENCODE_LIMIT_5H_USD` (default `12`)
    - `PI_OPENCODE_LIMIT_WEEKLY_USD` (default `30`)
    - `PI_OPENCODE_INPUT_PRICE_PER_M` (default `2.5` — $/M tokens)
    - `PI_OPENCODE_OUTPUT_PRICE_PER_M` (default `10` — $/M tokens)
  - expected endpoint JSON shape:
    - `{ "windows": { "5h": { "limit": 200, "used": 10 }, "weekly": { "limit": 1000, "used": 55 } } }`

## Available skills

- `/answer <question>` — Prompt shortcut that uses the `answer` skill to answer codebase or business-logic questions with sourced `file:line` references.
- `/skill:answer <question>` — Searches the current repo first, then related sibling repos when needed, and cites evidence for each answer.
- `/skill:super-review <branch-or-url>` — Creates an isolated worktree for a GitHub/Bitbucket branch or branch name, reviews changes against the base like a senior/principal engineer, and returns the review in-chat only.
- `/skill:task <requirement>` — Writes a detailed implementation plan to markdown, delegates implementation to `opencode-go/deepseek-v4-pro`, then has the main model review/fix the diff and summarize.
- `/skill:worker <task>` — Quick model-switching shim: delegates the current request to the builtin `worker` subagent using `opencode-go/deepseek-v4-pro`, then returns the result.
- `/skill:grill` — Grilling session that challenges plans against the domain model, sharpens terminology, and updates `CONTEXT.md`/ADRs inline.
- `/skill:handover` — Writes a compact `handover.md` with session decisions, agreements, current state, and next steps.
- `/skill:improve-architecture` — Finds deepening opportunities to improve testability, locality, leverage, and AI-navigability.
