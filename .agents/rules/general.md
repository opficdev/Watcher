# Watcher General Agent Rules

## Logic preservation and optimization

- Reuse the existing program logic as-is whenever possible.
- Change logic only when the new approach produces exactly the same result and strictly improves time or space complexity.
- If there is no clear complexity improvement, keep the original logic.

## Code modification response style

- When asked to modify code, return only the precise changed locations and the modified code for those locations.
- Do not include full files, unrelated code, or explanatory text unless explicitly requested.
- You do not need to paste code in the prompt after updating it in the repository.

## TypeScript style

- Keep `tsconfig.json` strict-mode compatibility.
- Preserve the repository's ESM and `NodeNext` module conventions.
- Use `import type` when an import is used only as a type.
- Follow the existing no-semicolon style.
- Name implementation types with their full role or type name in camel case.
- Use the shortest clear local variable name unless it conflicts or becomes unclear in the same scope.

## External effects and secrets

- Do not run `npm run watch` unless the user explicitly requests it in the current turn.
- Treat GitHub, OpenAI, Discord, release, tag, PR, issue, and comment operations as external effects.
- Do not hardcode or print `GITHUB_TOKEN`, `WATCHER_GITHUB_TOKEN`, `OPENAI_API_KEY`, or `DISCORD_WEBHOOK_URL`.
- Preserve explicit environment-variable fallback behavior.
- Do not add secrets, raw file contents, or raw diff bodies to debug artifacts.

## Documentation placement

- Keep AI workflow and rule documents under `.agents/`.
- Keep custom agent configuration under `.codex/agents/`.
- Do not add app-repository, Swift, iOS, Firebase, or Simulator rules to this repository.

## Repository-local rules

- Watcher-specific working rules belong in this repository, not in global agent memory.
- Treat `AGENTS.md` and the routed `.agents/` documents as the canonical Watcher AI working rules.
- If global memory conflicts with this repository, follow the repository.
