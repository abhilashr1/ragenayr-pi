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
  - opencode-go fallback estimate (when no limits API exists):
    - `PI_OPENCODE_LIMIT_5H_USD` (default `12`)
    - `PI_OPENCODE_LIMIT_WEEKLY_USD` (default `30`)
    - `PI_OPENCODE_INPUT_PRICE_PER_M` (default `2.5` — $/M tokens)
    - `PI_OPENCODE_OUTPUT_PRICE_PER_M` (default `10` — $/M tokens)
  - expected endpoint JSON shape:
    - `{ "windows": { "5h": { "limit": 200, "used": 10 }, "weekly": { "limit": 1000, "used": 55 } } }`

## Available skills

- `/skill:grill` — Grilling session that challenges plans against the domain model, sharpens terminology, and updates `CONTEXT.md`/ADRs inline.
- `/skill:improve-architecture` — Finds deepening opportunities to improve testability, locality, leverage, and AI-navigability.
