# Watcher Agent Workflows

## Purpose

This file defines executable AI workflows for Watcher work.

Use this after reading `AGENTS.md` and `.agents/roles.md`. `.agents/roles.md` defines what each role may do. This file defines how to combine those roles for common project tasks.

If this file conflicts with `AGENTS.md`, follow `AGENTS.md`.

## Main-agent protocol

The main agent must run every workflow with this protocol.

1. Read `AGENTS.md`, then `.agents/roles.md`, then this file.
2. Select one workflow from this file.
3. Create the task packet.
4. Assign only the roles required by the selected workflow.
5. Assign each role a model tier from `.agents/roles.md`.
6. Keep `Primary` roles with the active main agent.
7. Find the exact custom agent name in `.agents/roles.md` and its matching `.codex/agents/<name>.toml` before dispatching a `Lightweight` or `Fast` role.
8. Create the role as a side task connected to the current main task with `spawn_agent.task_name` set to that exact name, or use `Option-Command-S` from the UI sidebar for the same connected dispatch surface.
9. Do not use external `codex exec`, a separate user-owned `create_thread`, or an arbitrary `task_name` for repository role dispatch.
10. Reuse the existing role agent with `followup_task` when assigning later work to the same role.
11. Return every delegated role result to the current main task for `Primary` review and integration.
12. Do not complete a required `Lightweight` or `Fast` role directly in `Primary`, and do not substitute a generic sub-agent for the configured custom agent.
13. Dispatch read-only `Lightweight` or `Fast` roles in parallel only when they do not depend on unfinished edits.
14. Keep `Primary` editing roles sequential unless the files and ownership boundaries are disjoint.
15. Integrate role outputs.
16. Escalate any `Lightweight` or `Fast` blocker to a `Primary` model before editing.
17. Run completion gates.
18. Report changed files, architecture decision, verification result, delegated roles, model tiers used, and unresolved decisions.

Do not skip the task packet. The task packet is the contract between models.

## Universal stop conditions

Stop and ask the user before editing when:

- The task packet conflicts with `AGENTS.md`.
- The requested fix requires changing deterministic pair statuses, reason precedence, AI authority, data exposure, secret handling, public workflow inputs, release packaging, or public exports without an explicit contract.
- A role needs to call live GitHub, OpenAI, Discord, workflow dispatch, tag, release, PR, issue, or comment operations without current-turn authorization.
- A required `Lightweight` or `Fast` custom agent cannot be loaded or selected through the connected side-task surface with its exact `task_name`, its pinned model is unavailable, or current tool policy requires user permission that has not been granted.
- The current issue or PR scope is unclear after live GitHub inspection.
- Two editing roles would touch the same file.
- A read-only role reports `Block` or `Needs Owner Decision`.
- Verification fails for a reason that suggests a scope, product-policy, security, workflow-contract, or release decision.

Do not apply the custom-agent stop condition only because external `codex exec`, a separate `create_thread`, or an arbitrary `task_name` failed. Retry through the connected side-task surface with the exact configured name first.

## Workflow selection

| User request | Workflow |
| --- | --- |
| "이슈 구현", issue number, feature, bug fix | Issue-driven implementation |
| Deterministic pair graph, AI, external service, reusable workflow, release, public export, architecture docs | Architecture-sensitive implementation |
| PR review comment, unresolved thread, requested changes | Review-thread follow-up |
| Failing GitHub Actions, CI log, reusable workflow, release failure | CI failure triage |
| PR body, release note, README, issue wording | Documentation-only writing |
| AI role, AGENTS, workflow, or architecture-rule docs | AI workflow maintenance |

## Issue-driven implementation

Use when implementing a live issue or user-scoped code change.

### Role order

1. GitHub/CI Analyst, if live issue or PR state matters.
2. Planner.
3. Architecture Watcher, if `Architecture risk` is `possible` or `confirmed`.
4. Implementer.
5. Code Reviewer.
6. Verification Runner.
7. Documentation Writer, if PR, release, README, or issue text is needed.

### Task packet source

```md
## Task Packet

- Source: <issue URL, PR URL, or user request>
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

### Execution

- Planner must identify the owning module, input and output contract, external effects, source files, tests, and documentation before Implementer edits TypeScript.
- Implementer must edit only files listed in the task packet unless Planner updates the packet.
- Behavior changes must include tests for success, boundary, and failure or fallback cases that are relevant to the contract.
- Code Reviewer must check deterministic result drift, provider failure isolation, secret exposure, workflow contract drift, and scope drift before style concerns.
- Verification Runner must build fresh TypeScript output before running compiled tests.
- Do not use `npm run watch` to prove implementation correctness unless the user explicitly requests a live integration run.

### Completion

Report:

```md
## Workflow Result

- Workflow: Issue-driven implementation
- Changed files:
- Architecture decision:
- Verification:
- Remaining decisions:
```

## Architecture-sensitive implementation

Use when the task touches module ownership, dependency direction, deterministic risk results, AI target or provider behavior, external-service data, secret redaction, debug artifacts, reusable workflow contracts, CI or release behavior, public exports, or architecture documentation.

### Role order

1. Planner.
2. Architecture Watcher before editing.
3. Implementer, only after Architecture Watcher returns `Pass`.
4. Architecture Watcher after editing, if ownership, dependency, deterministic, AI, external-effect, workflow, release, or public contracts changed.
5. Code Reviewer.
6. Verification Runner.

### Architecture Watcher gate

Architecture Watcher must return:

- `Pass` before Implementer edits.
- `Block` when the requested change violates current rules.
- `Needs Owner Decision` when the repository rules require user confirmation.

Implementer must not proceed on `Block` or `Needs Owner Decision`.

### Required inspection

- Relevant source imports and module ownership.
- Existing source and tests for the changed contract.
- Deterministic pair status, reason, precedence, and same-input behavior.
- AI target selection, evidence shape, prompt, response validation, pair failure isolation, and request ordering.
- GitHub, OpenAI, Discord, environment-variable, child-process, filesystem, and debug-artifact data flow.
- `package.json`, `tsconfig.json`, `src/index.ts`, `README.md`, and relevant `.github/workflows/*` when affected.
- Reusable workflow inputs, secrets, permissions, source resolution, and release asset compatibility.

### Completion

Report:

```md
## Workflow Result

- Workflow: Architecture-sensitive implementation
- Architecture Watcher verdict:
- Changed files:
- Boundary decision:
- Verification:
- Remaining decisions:
```

## Review-thread follow-up

Use when the user asks to address PR review comments or unresolved review threads.

### Role order

1. GitHub/CI Analyst.
2. Planner.
3. Architecture Watcher, if a requested fix touches architecture-sensitive areas.
4. Implementer.
5. Code Reviewer.
6. Verification Runner.
7. GitHub/CI Analyst, only if the user requested replies or thread resolution.

### Execution

- GitHub/CI Analyst must use thread-aware inspection when unresolved review threads matter.
- Planner must classify each comment as required, optional, already handled, rejected, or needing owner decision.
- Planner must map accepted comments to concrete source, test, workflow, or documentation files.
- Implementer must apply only accepted fixes.
- Code Reviewer must verify that the final diff addresses accepted comments without unrelated cleanup or contract drift.
- Verification Runner must run fresh build and tests for TypeScript changes and docs checks for documentation-only changes.
- GitHub/CI Analyst must mirror the existing PR reply style when replying and must change GitHub state only when explicitly authorized.

### Completion

Report:

```md
## Workflow Result

- Workflow: Review-thread follow-up
- Addressed comments:
- Deferred or rejected comments:
- Changed files:
- Verification:
- GitHub actions:
```

## CI failure triage

Use when GitHub Actions CI, `merge-risk-watch.yml`, debug artifact upload, or `release.yml` fails.

### Role order

1. GitHub/CI Analyst.
2. Planner.
3. Verification Runner, if a local reproduction is possible without live services.
4. Implementer, only after a concrete root cause is identified.
5. Code Reviewer.
6. Verification Runner.

### Execution

- GitHub/CI Analyst must inspect the failing run, job, step, and relevant log excerpt before proposing fixes.
- Planner must separate dependency installation, TypeScript build, test, reusable-workflow source resolution, checkout or token permission, OpenAI, Discord, artifact upload, tag, and release failures.
- Verification Runner must use Node 22, run `npm run build`, then `npm test` when local source verification applies.
- Live provider, consumer repository, permission, workflow dispatch, or release reproduction requires explicit user authorization.
- Implementer must not edit workflow files until the failing step and contract are identified.
- Verification Runner must not treat CI polling as a substitute for local verification when local checks are available.

### Completion

Report:

```md
## Workflow Result

- Workflow: CI failure triage
- Failing run:
- Root cause:
- Changed files:
- Verification:
- Remaining CI risk:
```

## Documentation-only writing

Use for PR body, issue text, release note, README wording, review reply draft, consumer workflow guidance, or user-facing explanation.

### Role order

1. Documentation Writer.
2. Code Reviewer, if wording must match a diff or runtime contract.
3. GitHub/CI Analyst, if live issue, PR, workflow run, tag, or release state matters.
4. Verification Runner, for file presence, Markdown, link, and diff checks when files changed.

### Execution

- Documentation Writer must inspect the actual diff and current implementation before writing PR, release, or behavior text.
- When live state matters, GitHub/CI Analyst must provide the issue, PR, run, tag, or release source before the draft is finalized.
- When the Documentation Writer role is required, the main agent must dispatch the draft through `documentation_writer` before writing the final response.
- If dispatch requires explicit user permission and it has not been granted, ask before drafting, returning, or posting the Documentation Writer output.
- `Primary` must review the output against `.github/pull_request_template.md`, issue scope, implementation, tests, workflows, and actual diff.
- Keep deterministic pair results separate from AI prediction and do not claim live-service verification that was not run.
- If the user asks only for text, return text directly and do not create files.
- If documentation files are changed, keep the change scoped to the requested document.

### Completion

Report:

```md
## Workflow Result

- Workflow: Documentation-only writing
- Target:
- Changed files:
- Source checked:
- Verification:
```

## AI workflow maintenance

Use for `AGENTS.md`, `.agents/roles.md`, this file, `.agents/rules`, or `.codex/agents` role-routing changes.

### Role order

1. Planner.
2. Implementer.
3. Code Reviewer.
4. Verification Runner.

Architecture Watcher is required only if the change modifies ownership maps, deterministic or AI boundaries, external-service or secret rules, reusable workflow contracts, release contracts, ambiguity gates, or architecture rules.

### Execution

- Keep `AGENTS.md` as the short repository-root AI workflow entrypoint.
- Do not add app-repository, Swift, iOS, Firebase, or Simulator rules.
- `.agents/roles.md` defines role permissions, model routing, output formats, and task packet shape.
- `.agents/workflows.md` defines executable role sequences.
- `.agents/rules/general.md` defines logic preservation, response style, TypeScript style, external effects, and documentation placement.
- `.agents/rules/architecture.md` defines Watcher ownership, deterministic and AI boundaries, service effects, reusable workflow contracts, release contracts, and ambiguity gates.
- `.agents/rules/project-workflows.md` defines build, test, CI, PR, commit, release, and documentation-delivery rules.
- `.codex/agents/*.toml` must use the exact role identifiers from `.agents/roles.md`.
- Preserve the approved reference document structure and role names when that is the task contract; adapt only Watcher-specific duties and examples.

### Verification

Verification Runner must run:

```sh
git diff --check -- AGENTS.md .agents .codex/agents
python_path=""
for candidate in python3.14 python3.13 python3.12 python3.11 /opt/homebrew/bin/python3 python3; do
	if candidate_path="$(command -v "$candidate" 2>/dev/null)" && "$candidate_path" -c 'import tomllib' 2>/dev/null; then
		python_path="$candidate_path"
		break
	fi
done
test -n "$python_path"
"$python_path" -c 'import pathlib, tomllib; [tomllib.loads(path.read_text()) for path in pathlib.Path(".codex/agents").glob("*.toml")]'
rg -n 'gpt-5\.3-codex-spark|\bPrimary\b|\bLightweight\b|\bFast\b' --glob '*.md' --glob '*.toml' AGENTS.md .agents .codex/agents
git status --short
```

If only Markdown and TOML AI workflow files changed, no TypeScript build is required.

### Completion

Report:

```md
## Workflow Result

- Workflow: AI workflow maintenance
- Changed files:
- Operational change:
- Verification:
- Remaining decisions:
```

## Parallel dispatch guide

Use only side tasks connected to the current main task for parallel role dispatch. Create them with exact configured custom agent names through `spawn_agent` or with `Option-Command-S` in the UI sidebar.

Parallelize only these combinations:

- GitHub/CI Analyst reading live GitHub state while Planner inspects local files.
- Architecture Watcher reviewing boundaries while Code Reviewer reviews non-architecture risks after the diff is complete.
- Documentation Writer drafting PR or release text while Verification Runner runs checks, after the diff is stable.

Do not parallelize:

- Two Implementers over overlapping files.
- Implementer and Code Reviewer before Implementer finishes the diff.
- Verification Runner before the relevant files are saved.
- GitHub write actions with local code edits.
- Any role that would run `npm run watch` with another role changing runtime code or environment contracts.

## Role prompt snippets

Use the activation template from `.agents/roles.md`, then set `<Role Name>` to one of:

- `Planner`
- `Implementer`
- `Architecture Watcher`
- `Code Reviewer`
- `Verification Runner`
- `GitHub/CI Analyst`
- `Documentation Writer`

Include the selected workflow name in the task packet `Source` or `Goal` field so the receiving model can align its output to this runbook.

## Task packet examples

### Issue-driven implementation example

```md
## Task Packet

- Source: https://github.com/opficdev/Watcher/issues/41
- Goal: Define AI agent roles and executable role-based workflows for Watcher.
- Scope: Update root AI workflow files and custom agent configuration only.
- Out of scope: TypeScript source, tests, package scripts, GitHub Actions, README, live services, git and GitHub writes.
- Expected changed files: `AGENTS.md`, `.agents/roles.md`, `.agents/workflows.md`, `.agents/rules/*.md`, `.codex/agents/*.toml`
- Current owner: repository workflow documentation
- Architecture risk: possible
- Required roles: Planner, Architecture Watcher, Implementer, Code Reviewer, Verification Runner
- Model assignment: Planner=Primary, Architecture Watcher=architecture_watcher (Lightweight), Implementer=Primary, Code Reviewer=code_reviewer (Lightweight), Verification Runner=verification_runner (Lightweight)
- Custom agent `task_name`: Architecture Watcher=`architecture_watcher`, Code Reviewer=`code_reviewer`, Verification Runner=`verification_runner`
- Result recipient: `Primary` of the current main task
- Verification: diff check, TOML parsing, exact role and model scan, `git status --short`
- Stop conditions: role-name changes, README changes, TypeScript or workflow changes, public consumer contract changes, live-service execution
```

### Review-thread follow-up example

```md
## Task Packet

- Source: <PR URL or review thread URL>
- Goal: Address accepted review feedback without expanding PR scope.
- Scope: Apply only required review fixes confirmed by GitHub/CI Analyst and Planner.
- Out of scope: Optional suggestions, unrelated cleanup, new pair classification or architecture policy, live `npm run watch`, release actions.
- Expected changed files: <filled by Planner after reading threads>
- Current owner: <module and contract identified by Planner>
- Architecture risk: none / possible / confirmed
- Required roles: GitHub/CI Analyst, Planner, Implementer, Code Reviewer, Verification Runner
- Model assignment: GitHub/CI Analyst=github_ci_analyst (Lightweight), Planner=Primary, Implementer=Primary, Code Reviewer=code_reviewer (Lightweight) -> Primary if blocking, Verification Runner=verification_runner (Lightweight)
- Custom agent `task_name`: GitHub/CI Analyst=`github_ci_analyst`, Code Reviewer=`code_reviewer`, Verification Runner=`verification_runner`
- Result recipient: `Primary` of the current main task
- Verification: `npm run build`, `npm test`, and workflow or docs checks when applicable
- Stop conditions: unresolved thread requires owner decision, fix changes deterministic or public workflow behavior, two comments conflict, CI failure source is unrelated to review feedback
```
