import test from "node:test"
import assert from "node:assert/strict"
import { selectWatchedBranches } from "../../src/branches/branchSelector.js"
import type { RepositoryBranch } from "../../src/branches/types.js"

// base, default branch가 감시 대상에서 제외되는지 확인
test("excludes base and default branches", () => {
  const selected = selectWatchedBranches([
    branch("main"),
    branch("develop"),
    branch("feature/watch")
  ], {
    baseBranch: "develop",
    defaultBranch: "main"
  })

  assert.deepEqual(selected.map(branch => branch.name), ["feature/watch"])
})

// include pattern에 맞는 branch만 감시 대상으로 선택되는지 확인
test("selects branches with include patterns", () => {
  const selected = selectWatchedBranches([
    branch("feature/watch"),
    branch("fix/webhook"),
    branch("docs/readme")
  ], {
    baseBranch: "main",
    includePatterns: ["feature/*", "fix/*"]
  })

  assert.deepEqual(selected.map(branch => branch.name), ["feature/watch", "fix/webhook"])
})

// exclude pattern에 맞는 branch가 감시 대상에서 제외되는지 확인
test("excludes branches with exclude patterns", () => {
  const selected = selectWatchedBranches([
    branch("feature/watch"),
    branch("release/1.0"),
    branch("bot/dependency")
  ], {
    baseBranch: "main",
    excludePatterns: ["release/*", "bot/*"]
  })

  assert.deepEqual(selected.map(branch => branch.name), ["feature/watch"])
})

// staleDays 기준보다 오래된 branch가 감시 대상에서 제외되는지 확인
test("excludes stale branches", () => {
  const selected = selectWatchedBranches([
    branch("feature/recent", new Date("2026-06-20T00:00:00.000Z")),
    branch("feature/stale", new Date("2026-06-01T00:00:00.000Z"))
  ], {
    baseBranch: "main",
    now: new Date("2026-06-21T00:00:00.000Z"),
    staleDays: 7
  })

  assert.deepEqual(selected.map(branch => branch.name), ["feature/recent"])
})

// 연결된 Pull Request metadata가 optional 정보로 유지되는지 확인
test("keeps pull request metadata optional", () => {
  const selected = selectWatchedBranches([
    {
      ...branch("feature/watch"),
      pullRequest: {
        number: 12,
        title: "Branch metadata",
        url: "https://github.com/opficdev/Watcher/pull/12"
      }
    }
  ], {
    baseBranch: "main"
  })

  assert.equal(selected[0]?.pullRequest?.number, 12)
})

function branch(name: string, updatedAt?: Date): RepositoryBranch {
  return {
    name,
    sha: `${name}-sha`,
    author: "opfic",
    updatedAt
  }
}
