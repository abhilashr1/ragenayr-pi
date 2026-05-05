# Tmux Subagent Extension

Delegate tasks to specialized subagents running in **tmux windows** for full observability and persistence.

## Features

- **Tmux windows** — Each subagent gets its own tmux window
- **Live status** — Window titles show ⏳/✓/✗ status
- **Parallel & chain** — Run multiple agents concurrently or in sequence
- **Persistent** — Subagents survive even if the parent pi session ends
- **Observable** — Attach to the tmux session to watch agents work in real time

## Installation

These files were placed automatically:

```
~/.pi/agent/extensions/subagent-tmux/
├── index.ts       # Main extension
├── agents.ts      # Agent discovery
~/.pi/agent/agents/
├── scout.md       # Fast recon
├── planner.md     # Implementation planner
├── worker.md      # General purpose
├── reviewer.md    # Code reviewer
~/.pi/agent/prompts/
├── answer.md      # scout → answer
├── plan.md        # scout → planner
└── implement.md   # scout → planner → worker
```

## Usage

### Workflow Prompts

| Command | What it does |
|---------|-------------|
| `/answer <question>` | Searches the codebase and answers your question |
| `/plan <task>` | Searches the codebase and creates an implementation plan (broken into sub-agent-sized tasks) |
| `/implement <task>` | Searches, plans, and implements via sub-agents |

Examples:
```
/answer how does the auth middleware work?
/plan add rate limiting to the API
/implement refactor the session store to use Redis
```

### Direct tool calls

You can also call `subagent_tmux` directly for custom flows:

```
Use subagent_tmux with agent "scout" to find all authentication code
Run 2 scouts in parallel in tmux: one to find models, one to find providers
Use a chain with subagent_tmux: scout find auth code, then worker implement OAuth
```

### Subagent tool modes

| Mode | Parameters | Description |
|------|-----------|-------------|
| Single | `{ agent, task }` | One agent, one task |
| Parallel | `{ tasks: [...] }` | Multiple agents run concurrently (max 8, 4 concurrent) |
| Chain | `{ chain: [...] }` | Sequential with `{previous}` placeholder |

## Commands

| Command | Description |
|---------|-------------|
| `/subagent-tmux-attach` | Attach to the subagent tmux session |
| `/subagent-tmux-list` | List active subagent windows |
| `/subagent-tmux-kill` | Kill the subagent tmux session |

## Tmux session

Subagents run in a dedicated tmux session named `pi-subagents-<pid>`.

Attach manually:
```bash
tmux attach -t pi-subagents-<pid>
```

Or use `/subagent-tmux-attach` from pi.

## Agent definitions

Agents are markdown files with YAML frontmatter in `~/.pi/agent/agents/` or `.pi/agents/`:

```markdown
---
name: my-agent
description: What this agent does
tools: read, grep, find, ls
model: claude-sonnet-4-7
---

System prompt for the agent goes here.
```

## Security

- Only user-level agents (`~/.pi/agent/agents/`) are loaded by default
- Set `agentScope: "both"` to include project-local agents (`.pi/agents/`)
- You will be prompted before running project-local agents
