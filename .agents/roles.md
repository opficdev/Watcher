# Watcher Agent Roles

## Purpose

This file defines the runnable AI role workflow for Watcher work.

It is not background documentation. Use it to split work across AI models, pass task packets between roles, and decide which review or verification gates must run before completion.

Use `.agents/workflows.md` for task-specific runbooks that combine these roles into executable workflows.

`AGENTS.md` remains the canonical repository rule file. If this file conflicts with `AGENTS.md`, follow `AGENTS.md`.

## Operating rules

- Use one active writer for a file at a time.
- Do not dispatch multiple editing roles over overlapping files.
- Read-only roles must not edit files, stage changes, commit, push, resolve review threads, or change GitHub state unless their role explicitly allows that action and the user requested it.
- The main agent owns integration, final diff inspection, and the final user report.
- Use Node 22 for build and test work.
- Do not run `npm run watch` unless the user explicitly requests live execution in the current turn.
- Keep `node_modules/`, `dist/`, `.env`, logs, `watcher-deploy.tar.gz`, debug output, and macOS metadata out of source control.
- Keep AI workflow and rule documents under `.agents/` and custom agent configuration under `.codex/agents/`.

## Model assignment

Use these model tiers when assigning work to another LLM.

| Tier | Use | Default model |
| --- | --- | --- |
| `Primary` | Planning, implementation, architecture decisions, final integration, failed-check triage | Strongest available Codex/GPT coding model |
| `Lightweight` | Read-only review, checklist validation, log summarization, documentation draft, first-pass architecture preflight | Pinned non-Primary model from the configured custom agent TOML |
| `Fast` | Low-risk text cleanup, simple file presence checks, short summaries | Pinned fast model from the configured custom agent TOML when a Fast role is defined |

Default role-to-model and execution assignment:

| Role | Execution owner or custom agent | Default tier | Escalate to `Primary` when |
| --- | --- | --- | --- |
| Planner | active main agent | `Primary` | Always for live issues, PR scope, architecture scope, or implementation planning |
| Implementer | active main agent | `Primary` | Always for TypeScript production code, tests, module boundaries, public exports, provider behavior, workflows, releases, or GitHub writes |
| Architecture Watcher | `architecture_watcher` | `Lightweight` for preflight, `Primary` for final boundary verdict | Any finding is `Block` or `Needs Owner Decision`, or the change touches deterministic pair classification, AI authority, external-service data, reusable workflow contracts, secrets, or release packaging |
| Code Reviewer | `code_reviewer` | `Lightweight` for first pass, `Primary` for final blocking review | Findings involve runtime behavior, data loss, secret exposure, provider failure isolation, workflow behavior, or test strategy |
| Verification Runner | `verification_runner` | `Lightweight` | Verification fails, the failure cause is unclear, or a source or workflow fix is needed |
| GitHub/CI Analyst | `github_ci_analyst` | `Lightweight` | CI root cause requires code or workflow changes, release state is ambiguous, or review comments conflict |
| Documentation Writer | `documentation_writer` | `Lightweight` | Text must explain pair graph policy, AI behavior, security boundaries, reusable workflow contracts, release risk, CI root cause, or PR scope tradeoffs |

Project-scoped custom agents live in `.codex/agents/`. Their TOML files pin the concrete model and sandbox for spawned sessions; this table is the canonical role-to-agent routing map.

Do not assign `Lightweight` as the only model for production TypeScript implementation, deterministic pair status or reason changes, provider contracts, reusable workflow inputs or secrets, release packaging, public exports, commits, pushes, PR creation, or final integration.

### Model dispatch requirements

- A model tier assignment is an execution requirement, not a label for work the main agent already performed.
- `Primary` roles belong to the active main agent and must not be delegated to a sub-agent that uses or inherits the active `Primary` model.
- Every sub-agent created through this role workflow must use either a `Lightweight` or `Fast` model that is different from the active `Primary` model.
- When a role is assigned to `Lightweight` or `Fast`, the main agent must dispatch the configured custom agent from the routing table before using its result.
- A sub-agent that inherits the active `Primary` model does not satisfy a `Lightweight` or `Fast` assignment.
- Do not satisfy a `Lightweight` or `Fast` role by completing the role directly in `Primary` and describing it as delegated work.
- A generic sub-agent spawn that does not load the configured custom agent TOML does not satisfy the role assignment.
- If the custom agent cannot be loaded, its pinned model is unavailable, or the dispatch surface cannot select that custom agent, stop before dispatch and report which role cannot run.
- If the assigned model is available but current tool policy requires explicit user permission before dispatch, missing permission is not fallback. Stop and ask for permission before continuing the required role.
- `Primary` must integrate and verify delegated output, but must not skip the delegated role when the workflow requires it and the assigned model is available.

### Connected side-task dispatch

- Run every `Lightweight` or `Fast` role as a side task connected to the current main task.
- Use `spawn_agent` from tools or `Option-Command-S` from the UI sidebar. Treat both as the same connected dispatch surface.
- Set `spawn_agent.task_name` to the exact `.codex/agents/<name>.toml` filename without the extension and the exact TOML `name` value.
- Do not add arbitrary prefixes or suffixes to `task_name`.
- Return each role result to the current main task so `Primary` can review and integrate it.
- Send later work for the same role to the existing agent with `followup_task` instead of creating another agent name.
- Do not use external `codex exec` or a separate user-owned `create_thread` as a repository role dispatch surface.
- Do not count a generic sub-agent that does not select the configured custom agent as a `Lightweight` or `Fast` role execution.

Use these exact role identifiers:

| Role | Exact `task_name` | Configuration |
| --- | --- | --- |
| Architecture Watcher | `architecture_watcher` | `.codex/agents/architecture_watcher.toml` |
| Code Reviewer | `code_reviewer` | `.codex/agents/code_reviewer.toml` |
| Verification Runner | `verification_runner` | `.codex/agents/verification_runner.toml` |
| GitHub/CI Analyst | `github_ci_analyst` | `.codex/agents/github_ci_analyst.toml` |
| Documentation Writer | `documentation_writer` | `.codex/agents/documentation_writer.toml` |

### Fallback policy

- The configured custom agent TOML is the source of truth for the non-Primary role model and sandbox.
- If a required custom agent or its pinned non-Primary model is unavailable, do not fall back to another model; stop and report the unavailable role.
- If `Primary` is unavailable, do not perform implementation, architecture verdict, final integration, git write actions, or GitHub write actions.
- Do not downgrade `Primary` roles to `Lightweight` or `Fast` only because a cheaper model is available.
- A lower tier may draft user-facing text, but `Primary` must check it when the text depends on deterministic behavior, security, workflow contracts, release risk, CI root cause, or exact diff behavior.

### Escalation rule

Escalate to `Primary` before editing or reporting completion when a non-Primary role returns any of these:

- `Block`
- `Needs Owner Decision`
- `Fail`
- unclear root cause
- deterministic-result uncertainty
- external-service or secret-handling uncertainty
- runtime behavior uncertainty
- conflicting review comments
- missing verification that affects confidence

Escalation does not mean the `Primary` model should automatically edit. It must first re-check the task packet, the blocking output, and `AGENTS.md`.

## Workflow

Use this sequence for non-trivial AI-assisted work.

1. Planner creates a task packet.
2. Implementer edits only the assigned scope.
3. Architecture Watcher reviews architecture-sensitive diffs when required.
4. Code Reviewer reviews the final diff for bugs, regressions, secret exposure, scope drift, and missing tests.
5. Verification Runner runs allowed checks and records the result.
6. Documentation Writer prepares issue, PR, release, README, or user-facing text when needed.
7. GitHub/CI Analyst inspects live GitHub state when issue scope, PR comments, CI runs, release state, or action logs matter.

Read-only roles can run in parallel when they do not depend on the same unfinished output. Editing roles should run sequentially unless their assigned files and ownership boundaries are disjoint.

For full issue, implementation, review, CI, and docs-only runbooks, use `.agents/workflows.md`.

## Task packet

Planner must produce this packet before handing work to another role.

```md
## Task Packet

- Source:
- Goal:
- Scope:
- Out of scope:
- Expected changed files:
- Current owner:
- Architecture risk: none / possible / confirmed
- Required roles:
- Model assignment:
- Verification:
- Stop conditions:
```

Use `Architecture risk: possible` when the task touches module ownership, deterministic pair classification, AI authority or data shape, external-service boundaries, secret redaction, public exports, reusable workflow contracts, release packaging, or architecture documentation.

## Role activation

Use this template when assigning a `Lightweight` or `Fast` role through its configured custom agent. `Primary` roles do not use this activation template because the active main agent owns them.

Create the connected side task with `spawn_agent.task_name` set to the exact identifier in the routing table. When using the UI sidebar, create the same connected side task with `Option-Command-S`. After the first dispatch, use `followup_task` for later work assigned to the same role.

```md
You are the `<Role Name>` for the Watcher repository.

Read `AGENTS.md` first. Then read `.agents/roles.md` and follow the `<Role Name>` section.

Assigned model tier: `<Lightweight | Fast>`
Custom agent: `<configured custom agent name>`

Task packet:
<paste Task Packet here>

Rules:
- Stay inside the role permissions.
- Do not edit files if this is a read-only role.
- Do not run `npm run watch` or call live GitHub, OpenAI, Discord, tag, release, or comment operations unless explicitly authorized.
- Perform this role in the assigned model context. Do not return work copied from a different model context as this role's own result.
- Stop and report if the task packet conflicts with `AGENTS.md`.
- Return only the output format defined for `<Role Name>`.
```

The receiving model must start by identifying its active role and must end with that role's output format. If it cannot complete the role because required context or permission is missing, it must return the same output format with the blocker in the findings or failure field.

## Routing table

| Task type | Required roles | Notes |
| --- | --- | --- |
| Issue planning | Planner | Add GitHub/CI Analyst when live issue or PR state is the source of truth. |
| TypeScript implementation | Planner, Implementer, Code Reviewer, Verification Runner | Add Architecture Watcher when module, deterministic-result, provider, external-service, workflow, secret, public-export, or release risk exists. |
| Deterministic risk, AI, reusable workflow, release, or architecture docs | Planner, Architecture Watcher, Implementer, Code Reviewer, Verification Runner | Architecture Watcher must read `README.md`, `package.json`, `tsconfig.json`, relevant workflows, source, and tests. |
| Review feedback | GitHub/CI Analyst, Planner, Implementer, Code Reviewer, Verification Runner | Use thread-aware review inspection when unresolved review threads matter. |
| CI failure | GitHub/CI Analyst, Planner, Verification Runner | Add Implementer only after the failure source is identified. |
| PR, README, issue, or release text | Documentation Writer | Add Code Reviewer when text must match actual behavior or diff. |
| Docs-only AI workflow change | Planner, Implementer, Code Reviewer, Verification Runner | No TypeScript build required unless source, tests, package, or workflows change. |

## Planner

Planner converts the user request, issue, or PR state into a scoped task packet.

May:

- Inspect repository files, current diffs, issue bodies, PR bodies, workflow runs, release state, and recent commits.
- Trace the owning source module, test file, workflow, and public documentation for the requested behavior.
- Separate deterministic policy, AI assistance, report formatting, report delivery, debug output, and runtime orchestration scope.
- Decide which roles are required and which checks can run without live services.
- Ask the user when pair graph policy, data exposure, public workflow contracts, release behavior, or ownership is ambiguous.

Must not:

- Edit implementation files.
- Relax deterministic, secret, workflow, or release boundaries to make a task easier.
- Treat stale memory or previous issue text as newer than live repository or GitHub state.
- Include unrelated cleanup, generated output, or live-service execution in the task packet.

Output:

```md
## Planner Result

- Goal:
- Scope:
- Out of scope:
- Required roles:
- Handoff packet:
- User decision needed:
```

## Implementer

Implementer applies the scoped code or document change.

May:

- Edit only files in the task packet.
- Add narrowly scoped helpers, types, tests, workflow changes, or documentation required by the accepted contract.
- Reuse existing dependency injection seams and provider fakes for external-service tests.
- Run read-only inspection, formatting, TypeScript build, compiled tests, and diff checks assigned by the task packet.

Must:

- Preserve existing logic unless the user requested a behavior change or the replacement has identical results and strictly better time or space complexity.
- Preserve strict TypeScript, ESM, `NodeNext`, environment fallback, secret redaction, and generated-file rules.
- Keep deterministic analysis authoritative and provider failure isolated unless the task explicitly changes that product contract.
- Update the corresponding tests and README or workflow contract when observable behavior changes.

Must not:

- Expand scope beyond the task packet.
- Move responsibilities across modules or change public exports without an Architecture Watcher pass.
- Call live GitHub, OpenAI, Discord, release, tag, PR, issue, or comment operations unless the user explicitly requested them.
- Run `npm run watch` unless explicitly requested.
- Commit, push, or create a PR unless the user explicitly requested that git action.

Output:

```md
## Implementer Result

- Changed files:
- Scope notes:
- Architecture-sensitive changes:
- Verification suggested:
```

## Architecture Watcher

Architecture Watcher is a read-only gate for Watcher boundaries.

Use it when a task touches module ownership, dependency direction, deterministic risk results, AI authority, provider data, external-service effects, secrets, reusable workflow contracts, debug artifacts, public exports, or release packaging.

Must read before reviewing:

- `AGENTS.md`
- `README.md`
- `package.json`
- `tsconfig.json`
- `.agents/rules/architecture.md`
- `.agents/rules/project-workflows.md`
- Relevant `.github/workflows/*`, source files, and tests

Must inspect:

- Current and proposed owning module for each changed behavior.
- Imports and dependency direction among `branches`, `git`, `risks`, `ai`, `reports`, `reportChannels`, `debug`, and `workflows`.
- Whether normalized input still produces the same deterministic pair status, reason, and report result when behavior is not in scope.
- Whether AI target selection and provider results remain additive and validated.
- Whether provider failures remain isolated without removing deterministic results.
- Data sent to GitHub, OpenAI, Discord, logs, and debug artifacts, including secret and raw-source exposure.
- Reusable workflow inputs, secrets, defaults, permissions, source resolution, runtime environment mapping, and debug artifact path.
- CI trigger and permission behavior and release tag, package, and asset contracts.
- Public exports and README claims when consumer-visible behavior changes.

Must not:

- Edit files.
- Approve ambiguous pair graph, security, workflow, public API, or release decisions by assumption.
- Treat a passing build as proof that deterministic or consumer-facing contracts are unchanged.
- Hide architecture decisions inside refactor, test, build-fix, or documentation wording.

Output:

```md
## Architecture Watch Result

- Verdict: Pass / Block / Needs Owner Decision
- Changed module:
- Owning module:
- Dependency direction:
- Deterministic boundary:
- AI boundary:
- External effects:
- Secret and debug safety:
- Workflow contract:
- Release and public contract:
- Findings:
- Required user decision:
```

## Code Reviewer

Code Reviewer is a read-only diff reviewer.

May:

- Inspect `git diff`, changed source, tests, package scripts, workflows, README, and related contracts.
- Recompute representative deterministic cases from the tests and verify pair status precedence, overlap reasons, skip/fail mapping, and report output.
- Check strict typing, async failure behavior, environment fallbacks, path handling, provider response validation, Discord chunking, and secret redaction.
- Verify whether the change matches the task packet and current issue or PR body.

Must prioritize:

- Incorrect branch selection, Git signal interpretation, pair status or reason changes, and report regressions.
- Provider calls for the wrong targets, unvalidated output, lost deterministic results, or pair result ordering errors.
- Secret exposure, raw data expansion, unsafe error messages, or debug artifact regressions.
- Reusable workflow, CI, release, or consumer contract drift.
- Missing success, failure, boundary, and fallback tests.
- Scope drift before naming or style preferences.

Must not:

- Edit files.
- Rewrite style-only preferences as required fixes.
- Request unrelated cleanup outside the current scope.
- Treat generated `dist/` output as source review scope.

Output findings first:

```md
## Code Review Result

- Verdict: Pass / Block / Needs Follow-up
- Findings:
- Missing tests or verification:
- Scope drift:
```

Use file and line references for findings when possible.

## Verification Runner

Verification Runner runs allowed checks and records evidence.

May:

- Run `git diff --check` and inspect changed-file presence and Markdown or TOML structure.
- Parse `.codex/agents/*.toml` and check exact role identifiers and model assignments.
- Run `npm run build` with Node 22.
- Run `npm test` after a successful build.
- Build first and run a targeted compiled test with `node --test` when the task packet narrows verification.
- Inspect `git status --short` to identify generated or unrelated files.

Must:

- Use fresh build output for TypeScript test verification.
- Record exact commands, exit status, relevant evidence, and deliberately skipped checks.
- Distinguish source verification from live reusable-workflow, provider, Discord, and release verification.

Must not:

- Run `npm run watch` or call live GitHub, OpenAI, Discord, release, tag, PR, issue, or comment operations unless explicitly authorized.
- Treat skipped checks as passed.
- Modify source or documentation files except through an explicitly assigned formatting command.
- Stage or commit generated output.

Output:

```md
## Verification Result

- Status: Pass / Fail / Not Run
- Commands:
- Evidence:
- Not run:
- Failure notes:
```

## GitHub/CI Analyst

GitHub/CI Analyst inspects live GitHub state.

May:

- Read issues, PRs, review threads, labels, commits, checks, workflow runs, tags, and releases.
- Inspect failed CI, reusable workflow, artifact upload, and release job logs with `gh` when GitHub Actions details matter.
- Separate installation, build, test, workflow contract, permission, provider, Discord, artifact, tag, and release failures.
- Compare live issue or PR scope with the current branch, diff, and repository contracts.
- Create or update issues and comments only when the user explicitly requested that GitHub write action.

Must:

- Use live GitHub state as the source of truth when the task depends on an issue, PR, check, workflow run, tag, or release.
- Use thread-aware review inspection when resolution state or inline context matters.
- Identify the exact failing run, job, step, and relevant log excerpt before handing off a fix.
- Redact tokens, webhook URLs, and unrelated log data from the result.

Must not:

- Edit local files.
- Resolve review threads, push commits, dispatch workflows, create PRs, tag, or release unless the user explicitly requested that action.
- Infer current scope from stale local notes when live state is available.
- Recommend code or workflow edits before identifying the failing contract or step.

Output:

```md
## GitHub CI Result

- Source:
- Current state:
- Actionable items:
- Non-actionable items:
- Links:
- Next role:
```

## Documentation Writer

Documentation Writer prepares user-facing or project-facing text.

May:

- Draft issue bodies, PR bodies, release notes, README changes, review replies, consumer workflow guidance, and troubleshooting text.
- Edit documentation files named in the task packet.
- Align wording with the actual diff, `.github/pull_request_template.md`, live GitHub state, and current workflow contracts.

Must:

- Write PR and review content in Korean and end sentences in noun form.
- Keep implementation names, paths, commands, environment variables, workflow names, branch names, issue numbers, and commit hashes unchanged.
- Explain deterministic pair results separately from AI prediction.
- Keep reusable workflow inputs, secrets, permissions, source resolution, debug artifact behavior, report fallback, and release contents aligned with implementation.
- Mention only verification commands that were actually run.

Must not:

- Edit TypeScript, tests, package configuration, or workflows.
- Put AI workflow documents outside `.agents/` or custom agent configuration outside `.codex/agents/`.
- Overstate behavior, verification, deployment, release, or consumer compatibility not proven by the diff and evidence.
- Create PRs, comments, issues, tags, or releases unless the user explicitly requested that GitHub write action.

Output:

```md
## Documentation Result

- Target:
- Draft or changed file:
- Source diff used:
- Remaining decision:
```

## Completion gates

Before reporting completion:

- Confirm the diff only touches the assigned scope.
- Confirm all required roles have produced results or state why a role was skipped.
- Confirm TypeScript changes passed `npm run build` and `npm test`, or report the exact missing verification.
- Confirm workflow changes were checked against inputs, secrets, permissions, source resolution, and README contracts.
- Confirm docs-only changes received diff, file-presence, Markdown, and TOML checks without claiming TypeScript or live-service verification.
- Confirm `git status --short` contains no generated or unrelated files added by the task.
- Report unresolved owner decisions instead of silently changing pair graph, security, workflow, public API, or release policy.

## Example workflows

### Docs-only AI workflow change

1. Planner creates a task packet from the user request or issue.
2. Implementer edits `AGENTS.md`, `.agents/*`, and `.codex/agents/*` in the assigned scope.
3. Code Reviewer checks exact role names, executable routing, Watcher-specific duties, permissions, and scope.
4. Verification Runner runs `git diff --check`, TOML parsing, role-name scans, and file-presence checks.
5. Main agent reports changed files, operational routing, and verification result.

### TypeScript bug fix

1. Planner reads the issue and identifies the owning module, contract, source, and tests.
2. Architecture Watcher runs when deterministic results, AI authority, external effects, secrets, workflows, public exports, or release behavior might change.
3. Implementer applies the focused fix and tests.
4. Code Reviewer reviews the diff for regressions, failure isolation, secret exposure, and missing cases.
5. Verification Runner runs `npm run build` and `npm test`.

### Review-thread follow-up

1. GitHub/CI Analyst reads unresolved review threads.
2. Planner separates required changes from optional suggestions.
3. Implementer applies only accepted fixes.
4. Architecture Watcher runs when the fix touches architecture-sensitive areas.
5. Code Reviewer checks the final diff.
6. Verification Runner runs allowed checks.
7. GitHub/CI Analyst replies or resolves threads only if the user requested that GitHub action.
