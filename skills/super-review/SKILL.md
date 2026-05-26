---
name: super-review
description: Perform a senior/principal engineer in-depth review of a GitHub or Bitbucket branch, PR URL, compare URL, repo URL plus branch, or branch name. Creates an isolated git worktree, checks out the target branch, compares it against the appropriate base, inspects code deeply for bugs, risks, conventions, and best-practice deviations, and returns a polished review in-chat only without posting comments remotely.
---

# Super Review

Act as a senior/principal software engineer reviewing a branch against its codebase. Be skeptical, precise, and evidence-backed.

Review along three independent axes so one kind of pass does not hide another kind of failure:

- **Code quality / risk** — correctness, safety, security, maintainability, performance, and testability.
- **Standards** — whether the diff follows documented repo standards, conventions, architecture decisions, and machine-enforced config.
- **Spec** — whether the diff implements the originating issue/PRD/spec without missing requirements or scope creep.

## Non-negotiables

- Do **not** post comments to GitHub, Bitbucket, or any remote review system.
- Do **not** push, amend, rebase, or mutate the reviewed branch.
- Always create and use an isolated git worktree (or a disposable clone plus worktree for an external repo) before reading/reviewing the branch.
- Review the branch diff against the correct base, but also read enough surrounding code to judge conventions and architecture.
- Return the final review in the chat/screen in a beautified format.

## Inputs supported

The user may provide:

- A branch name for the current repository, e.g. `feature/payments-retry`.
- A GitHub or Bitbucket repository URL plus an optional branch name.
- A GitHub/Bitbucket branch URL, PR URL, or compare URL when available.

If the target branch or base cannot be determined confidently, ask one concise clarifying question before proceeding.

## Workflow

### 1. Resolve repository, target branch, and base

1. Capture current directory and repository state:
   - `pwd`
   - `git rev-parse --show-toplevel`
   - `git status --short --branch`
   - `git remote -v`
2. Determine the target repository:
   - If only a branch name is provided, use the current git repository.
   - If a repo/PR/branch URL is provided, derive the clone URL and host (`github.com`, Bitbucket Cloud, or Bitbucket Server/Data Center).
3. Determine the target branch:
   - From explicit user text first.
   - From URL path patterns such as GitHub `/tree/<branch>`, GitHub PR refs, Bitbucket `/branch/<branch>`, or compare URLs.
   - For GitHub PR URLs, prefer `gh pr view <url> --json headRefName,baseRefName,headRepository,headRepositoryOwner` when `gh` is available; otherwise fetch/read `refs/pull/<number>/head` and ask for the base if needed.
   - For Bitbucket PR URLs, use available URL/API metadata when authenticated; otherwise ask for the source branch/base if not obvious.
   - If unavailable, ask the user for the branch.
4. Determine the base branch:
   - Prefer PR/compare metadata if available.
   - Else use the remote default branch from `origin/HEAD`.
   - Else fall back to `main`, then `master` if present.
   - State the chosen base in the final review.

### 2. Create an isolated worktree

For the current repository:

```bash
ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
git fetch --all --prune
SAFE_BRANCH=$(printf '%s' "$TARGET_BRANCH" | tr '/:@ ' '----')
WT="../$(basename "$ROOT")-review-$SAFE_BRANCH"
git worktree add "$WT" "$TARGET_BRANCH" || git worktree add "$WT" "origin/$TARGET_BRANCH"
cd "$WT"
```

For an external repository URL:

```bash
CACHE="${TMPDIR:-/tmp}/pi-super-review"
mkdir -p "$CACHE"
if [ -d "$CACHE/$REPO_SLUG/.git" ]; then
  cd "$CACHE/$REPO_SLUG"
  git fetch --all --prune
else
  git clone "$REPO_URL" "$CACHE/$REPO_SLUG"
  cd "$CACHE/$REPO_SLUG"
  git fetch --all --prune
fi
SAFE_BRANCH=$(printf '%s' "$TARGET_BRANCH" | tr '/:@ ' '----')
git worktree add "../$REPO_SLUG-review-$SAFE_BRANCH" "$TARGET_BRANCH" || git worktree add "../$REPO_SLUG-review-$SAFE_BRANCH" "origin/$TARGET_BRANCH"
cd "../$REPO_SLUG-review-$SAFE_BRANCH"
```

If the worktree already exists, inspect it with `git status --short --branch`; reuse it only if it is clean and on the intended branch, otherwise choose a new unique path.

### 3. Build the review context

Pin the comparison point once and use a three-dot diff so the review is against the merge base:

```bash
git status --short --branch
git log --oneline --decorate --max-count=20
git log --oneline --decorate "$BASE_BRANCH"..HEAD || git log --oneline --decorate "origin/$BASE_BRANCH"..HEAD
git diff --stat "$BASE_BRANCH"...HEAD || git diff --stat "origin/$BASE_BRANCH"...HEAD
git diff --name-status "$BASE_BRANCH"...HEAD || git diff --name-status "origin/$BASE_BRANCH"...HEAD
git diff "$BASE_BRANCH"...HEAD || git diff "origin/$BASE_BRANCH"...HEAD
```

Then read every changed file unless the diff is too large to fit; if coverage is partial, state that explicitly in the final review. Read relevant nearby code, call sites, tests, and project docs/configuration before forming opinions.

### 4. Identify spec and standards sources

Look for the originating spec in this order:

1. Issue/PR references in commit messages or branch names (`#123`, `Closes #45`, Jira keys, Linear IDs, Bitbucket PR IDs).
2. A path or issue/PR URL the user passed.
3. Matching PRD/spec docs under `docs/`, `specs/`, `.scratch/`, tickets, or project planning folders.
4. If no spec is available, continue the review but mark the Spec axis as `No spec found` rather than inventing requirements.

Look for standards sources that define how this repo expects code to be written:

- `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `README*`.
- `CONTEXT.md`, `CONTEXT-MAP.md`, per-directory context files, and `docs/adr/`.
- `STYLE.md`, `STANDARDS.md`, `STYLEGUIDE.md`, engineering docs, review checklists.
- `.editorconfig`, lint/format/typecheck configs, `tsconfig.json`, package/build/test configs. Note these, but do not waste review space restating what tooling already enforces unless the branch bypasses or weakens it.

If subagents are available, consider running independent Standards and Spec passes so their context does not bias the main code-quality review. Otherwise do these passes sequentially and keep the findings separated in the final report.

When useful, run lightweight verification commands that are obvious for the project (for example `npm test`, `npm run lint`, `pytest`, `go test ./...`, `cargo test`). Avoid expensive/destructive commands unless the user asked for them.

### 5. Review depth checklist

Look for:

- Correctness bugs, edge cases, race conditions, state leaks, error handling gaps, null/undefined handling, time/date issues, and concurrency issues.
- Security/privacy risks, authz/authn mistakes, injection, secret handling, unsafe logging, and dependency risk.
- Data integrity and migration/backward-compatibility risks.
- Performance, scalability, memory, network, and database query issues.
- API/contract compatibility and behavior changes.
- Spec conformance: missing requirements, partial implementations, wrong behavior, unrequested behavior, and scope creep.
- Standards conformance: documented rules, ADR violations, domain-language drift, and convention mismatches that tooling will not catch.
- Test coverage gaps and missing regression tests.
- Maintainability, readability, naming, layering, coupling, and code locality issues.
- Deviations from current codebase conventions, style, architecture, domain language, and quality bar.
- Over-engineering or under-engineering relative to the surrounding code.

Prefer findings that are actionable and tied to real code evidence. Do not invent issues. If no high-confidence issues exist, say so and mention residual risks.

## Final response format

Return only the review; do not include raw command dumps unless they matter.

```md
# Super Review: <target branch> vs <base branch>

## Summary
- <1-3 bullets: overall assessment, risk level, merge readiness>

## Scope Reviewed
- Repository: `<repo>`
- Worktree: `<path>`
- Base: `<base ref>`
- Head: `<head sha>`
- Changed files: <count / highlights>
- Verification: `<command>` — <result>, or `Not run — <reason>`

## Review Axes
- Code quality / risk: <pass/fail/concerns in one line>
- Standards: <pass/fail/concerns; cite standards sources used or `No standards docs found`>
- Spec: <pass/fail/concerns; cite spec source used or `No spec found`>

## Findings

### High
1. **<title>** — `<file:line>`
   - Issue: <what is wrong>
   - Impact: <why it matters>
   - Recommendation: <specific fix>

### Medium
...

### Low / Nits
...

## Standards Notes
- <documented standard violations or judgement calls; cite the standard file when possible, or `No material standards issues found`>

## Spec Notes
- <missing requirements, scope creep, or implementation mismatches; quote/cite the spec when possible, or `No spec available`>

## Best-Practice / Convention Notes
- <only if useful>

## Test Gaps
- <specific missing tests or `No material gaps found`>

## Questions / Assumptions
- <only genuine blockers or assumptions>

## Overall Recommendation
- <Approve / Approve with nits / Request changes / Needs follow-up>, with one short rationale.
```

Severity guidance:

- **High**: likely bug, security/data-loss risk, production incident risk, broken contract, or must-fix before merge.
- **Medium**: meaningful maintainability/test/correctness risk that should be fixed soon or before merge depending on context.
- **Low/Nit**: polish, readability, small convention mismatch.
