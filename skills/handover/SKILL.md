---
name: handover
description: Create or refresh a compact handover.md in the current working directory that summarizes the current session, decisions, agreements, changes, open questions, and next steps. Use when the user wants to preserve just enough context for a future session to continue without context pollution.
---

# Handover

Create a high-density `handover.md` for the next session. The goal is not to archive the conversation; it is to preserve the minimum useful state needed to resume work safely.

## Output target

- Always write the handover to `handover.md` in the current working directory.
- Prefer replacing the file with the latest complete handover rather than appending duplicate history.
- If an existing `handover.md` contains still-relevant context not present in the current session, carry it forward only if it is necessary for resuming work.

## Core rules

- Keep it as small as possible while preserving maximum information density.
- Include decisions and agreements explicitly.
- Include unresolved questions, assumptions, blockers, and next actions only when they affect the next session.
- Omit conversational filler, false starts, redundant details, and implementation trivia that can be recovered from the code.
- Prefer concrete nouns, file paths, commands, and short bullets over prose.
- Do not invent decisions. If something was discussed but not decided, put it under `Open questions` or omit it.
- If the session made code or document changes, include the affected paths and the intent of each change.
- If tests or commands were run, include only the meaningful result, especially failures or commands the next session should rerun.

## Workflow

1. Review the current session context available to you.
2. Check the current working directory and existing `handover.md` if present.
3. If files were changed in the session, use `git status --short` and inspect relevant diffs when needed to verify paths and intent.
4. Write or overwrite `handover.md` with a compact summary.
5. Report briefly that `handover.md` was updated and mention the most important next action, if any.

## Format

Use this template, deleting empty sections unless their absence would be misleading:

```md
# Handover

## Goal
- <what we were trying to accomplish>

## Current state
- <where things stand now>

## Decisions
- <decision> — <why / consequence if useful>

## Agreements
- <working agreements, constraints, preferences, definitions>

## Changes
- `<path>` — <what changed and why>

## Open questions
- <question / ambiguity / blocker>

## Next
- <smallest useful next step>

## Verification
- `<command>` — <result>
```

## Compression guidance

- Target 1 screen when possible.
- Use one bullet per fact.
- Merge related facts into a single bullet when it improves density.
- Prefer `Decided X because Y` over paragraphs of rationale.
- Prefer `Next: run X; then edit Y` over broad project plans.
- Keep only the latest relevant state; do not preserve obsolete intermediate plans.
