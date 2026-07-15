# Watcher Agent Instructions

## Scope

- These instructions apply only to the repository root.
- Read every route that matches the current task. Routes are cumulative.

## Required routing

| Task | Required document |
| --- | --- |
| Every task | `.agents/rules/general.md` |
| Non-trivial planning, implementation, review, or verification | `.agents/roles.md` |
| Repeatable role-based execution | `.agents/workflows.md` |
| Module ownership, dependency direction, deterministic analysis, external-service boundaries, reusable workflow contracts, secrets, or release packaging | `.agents/rules/architecture.md` |
| PR, review thread, commit, CI, verification, release, or GitHub Actions work | `.agents/rules/project-workflows.md` |

## Routing rules

- `AGENTS.md` is the repository entrypoint and routing source.
- `.agents/rules/general.md` applies to every task.
- Read all matching task-specific documents before planning, editing, reviewing, or verifying.
- For architecture work, also read `README.md`, `package.json`, `tsconfig.json`, and the relevant `.github/workflows/*` files before editing.
- For a delegated role, read `.agents/roles.md` and follow the assigned role section and output format.
- Use `.agents/workflows.md` when the task matches one of its executable workflows.
- If repository-local instructions conflict with global memory, follow the repository-local instructions.
