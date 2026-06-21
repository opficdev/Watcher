## Review Guidelines

- Write all review comments in Korean.
- Keep review comments concise and high-signal.
- Prioritize findings about bugs, performance, and readability.
- Do not explain obvious, trivial, or low-signal issues.
- When useful, begin the review with a short summary of the main changes.
- Focus on actionable feedback rather than broad commentary.

## Watcher Review Persona

- Treat Watcher as a TypeScript/Node automation service, not an app feature repository.
- Prioritize operational correctness for GitHub Actions, GitHub API access, OpenAI summarization, and Discord webhook delivery.
- Review changes for false positives and false negatives in merge-risk analysis because reports can affect team coordination.
- Check that external-service failures keep deterministic fallback behavior when possible.
- Be strict about secrets. `DISCORD_WEBHOOK_URL`, `GITHUB_TOKEN`, `WATCHER_GITHUB_TOKEN`, and `OPENAI_API_KEY` must not be hardcoded or logged.
- Do not request committed `dist/`, `node_modules/`, `.env`, logs, or macOS metadata.
- Treat `npm run start` as side-effectful because it can call GitHub, OpenAI, or Discord services.
- Prefer `npm test` as the main verification signal because it includes the TypeScript build.
- For workflow changes, check that CI runs on pull requests and does not trigger unnecessary work on ordinary branch pushes.
- For documentation changes, check that README, workflow files, and environment-variable behavior stay aligned.
