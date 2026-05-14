---
name: answer
description: Answer questions about the current repository's codebase or business logic with evidence-backed file:line citations. Use when the user asks how code works, where logic lives, why behavior happens, what business rules apply, or needs targeted investigation across related sibling repositories.
---

# Answer Codebase Questions

Answer the user's question by investigating the codebase. You are answering and explaining, not changing implementation, unless the user explicitly asks for code edits.

## Core rules

- Prefer evidence over memory. Search and inspect files before answering.
- Cite every substantive claim about code behavior or business logic with `file:line` or `file:start-end` references.
- Cite only lines you actually inspected. Do not invent references.
- Keep line ranges tight, usually 1-10 lines.
- If the evidence is incomplete, say so explicitly and list what you searched.
- Do not dump large code blocks. Summarize the behavior and cite the source lines.

## Workflow

### 1. Understand the question

Identify:

- the domain terms in the question
- likely code terms, aliases, table names, event names, API routes, commands, jobs, tests, and config keys
- whether the question asks for current behavior, intended business rules, ownership/location, or historical rationale

Ask a clarifying question only if the request is too ambiguous to search effectively. Otherwise state any assumption briefly and proceed.

### 2. Establish the primary repo

Treat the current working directory as the primary repository. If possible, find its root:

```bash
git rev-parse --show-toplevel
```

Before deep searching, read lightweight orientation docs when present and relevant:

- `README.md`
- `CONTEXT.md`
- `CONTEXT-MAP.md`
- `docs/adr/*.md`
- package or workspace manifests

### 3. Search the primary repo first

Use targeted searches with line numbers, for example:

```bash
rg -n "term|alias|RouteName|EventName" .
rg -n "class|function|def|interface|type" src tests
rg -n "business term|error message|config key|table_name" .
```

Exclude generated and dependency directories unless the question specifically concerns them, e.g. `.git`, `node_modules`, `dist`, `build`, `coverage`, `.next`, `vendor`, `target`, `tmp`.

Follow the code path far enough to answer confidently:

- entrypoints/controllers/handlers/commands
- domain/application logic
- persistence/query code
- event/job integrations
- validations and error handling
- tests that encode the rule

Tests may support an answer, but distinguish production behavior from test expectations.

### 4. Search sibling repositories only when needed

Search related repositories in the same parent directory when the primary repo is insufficient, for example when:

- the primary repo imports a package or service that is not defined locally
- config, docs, generated clients, routes, events, or schemas point to another repo
- the question spans multiple services or business contexts
- the answer is clearly incomplete without upstream/downstream behavior

Limit the scope to sibling git repositories under the primary repo's parent directory. Prefer targeted candidate selection over broad scanning:

```bash
root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
parent=$(dirname "$root")
for d in "$parent"/*; do test -d "$d/.git" && printf '%s\n' "$d"; done
```

Rank sibling candidates by repo name, import paths, package names, API/event/schema names, and docs references. Then run targeted `rg -n` searches in those repos. Cite sibling results using paths relative to the primary repo, e.g. `../orders-service/src/foo.ts:42`.

If many sibling repos could be relevant and there is no clear signal, do not brute-force the whole parent tree. Say what was found in the primary repo and ask which related repo to inspect.

### 5. Get exact line references

`rg -n` is usually enough for direct hits. When you need exact nearby line ranges, use the bundled helper from this skill:

```bash
./scripts/line-ref.py path/to/file 10 25
```

Resolve `./scripts/line-ref.py` relative to this skill directory. Use it only for files you need to cite or verify.

### 6. Present the answer

Use this structure:

1. **Short answer** — 1-3 sentences.
2. **Evidence** — bullets explaining the reasoning, each with source references.
3. **Sources** — compact list of cited files/line ranges if the answer used many citations.
4. **Gaps / confidence** — only when relevant; mention missing evidence, ambiguous ownership, or sibling repos not searched.

For simple questions, merge sections 2 and 3 and keep the response concise.
