# Watcher Workflow Rules

This reference holds Watcher-specific working rules that should live with the project, not in global agent memory.

## Canonical source

- Treat this repository's `AGENTS.md` and routed `.agents/` documents as the canonical Watcher working rules.
- Treat `package.json`, `tsconfig.json`, `.github/workflows/*`, and `.github/pull_request_template.md` as the local source of truth.
- Use global memory only as historical context. If global memory conflicts with this repository, follow the repository.

## Build and verification

- Use Node 22.
- Prefer `npm ci` when dependencies must be installed.
- Run `npm run build` before `npm test` because tests execute compiled JavaScript from `dist/tests`.
- For a targeted test, build first and then run the matching compiled test with `node --test`.
- Do not run `npm run watch` unless the user explicitly requests live execution in the current turn.
- Do not treat an existing `dist/` result as proof that the current TypeScript source passes.
- Keep strict-mode, ESM, and `NodeNext` compatibility.
- Report exact commands and whether each command passed, failed, or was not run.

## Generated and local files

- Do not commit `node_modules/`, `dist/`, `.env`, logs, macOS metadata, `watcher-deploy.tar.gz`, or temporary debug artifacts.
- Build output may be recreated and should not be included in review scope.
- Check `git status --short` before staging or reporting completion.

## GitHub Actions

- CI should run for pull requests, not every branch push.
- PR branch updates are covered by the `pull_request` workflow.
- Keep Node and action runtime versions aligned with GitHub runtime requirements.
- Preserve reusable workflow input, secret, permission, source-resolution, and artifact contracts unless the task explicitly changes them.
- Preserve manual semantic-version validation, build/test ordering, tag checks, package contents, and release asset naming in `release.yml` unless the task explicitly changes release behavior.
- Do not run or dispatch workflows unless the user explicitly requests that GitHub write action.

## CI diagnosis

- Inspect the failing run, job, step, and relevant log excerpt before proposing a change.
- Separate dependency installation, TypeScript build, test, reusable-workflow runtime, token permission, provider, report channel, artifact upload, and release failures.
- Reproduce locally with `npm run build` and `npm test` when the failure can be checked without live services.
- Do not run `npm run watch` as a local reproduction unless the user explicitly requests it and supplies the required environment context.
- Do not edit workflow files until the failing step and contract are identified.

## PR and review handling

- Write Watcher PR and review text in Korean and end sentences in noun form.
- Follow `.github/pull_request_template.md` for PR body structure.
- Base PR text on the actual branch diff and live issue or PR state.
- If the user asks for PR content only, return the Markdown directly and do not create files.
- Use thread-aware inspection when unresolved GitHub review threads matter.
- Verify each suggestion against the current code, tests, and diff before accepting it.
- Apply only accepted fixes and keep unrelated cleanup out of the diff.

## Commit guidance

- Commit messages must start with a prefix such as `feat`, `fix`, `refactor`, or `chore`.
- Write commit message prose in Korean.
- Keep implementation names, file paths, commands, branch names, workflow names, issue numbers, and commit hashes in their original form.
- Do not write a commit message body.
- Commit only files related to the current change.
- Check `git status --short` before staging.
- Do not stage, commit, push, create a PR, reply, resolve a thread, tag, or release unless the user explicitly requests that action.

## Consumer workflow contract

- Treat `.github/workflows/merge-risk-watch.yml` and the corresponding README sections as one consumer-facing contract.
- Keep `repository`, `base_branch`, `default_branch`, `watcher_version`, and `upload_debug_artifact` aligned across workflow and documentation.
- Keep `watcher_github_token`, `openai_api_key`, and optional `discord_webhook_url` aligned with runtime environment mapping.
- Preserve release-tag asset download and branch/SHA source-build fallback behavior unless the change explicitly revises it.
- Update consumer examples only when their public contract changes.

## Release work

- Treat release creation, tag creation, tag push, and asset upload as external writes requiring explicit user authorization.
- Verify semantic version format and existing tags before release actions.
- Run `npm run build` and `npm test` before claiming release readiness.
- Keep `watcher-deploy.tar.gz` limited to the files expected by the reusable workflow.
- Do not commit the release archive or `dist/`.

## Documentation alignment

- Update README behavior descriptions when public inputs, secrets, environment variables, pair graph policy, AI behavior, debug artifacts, report behavior, or release behavior changes.
- Do not update README for an internal refactor that leaves the documented contract unchanged.
- Keep AI workflow documents under `.agents/` and custom agent configurations under `.codex/agents/`.
