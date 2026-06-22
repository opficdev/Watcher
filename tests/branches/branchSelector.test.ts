import test from "node:test"
import assert from "node:assert/strict"
import { select } from "../../src/branches/branchSelector.js"
import type { RepositoryBranch } from "../../src/branches/types.js"

// base, default branch가 감시 대상에서 제외되는지 확인
test("excludes base and default branches", () => {
  const selected = select([
    branch("main"),
    branch("develop"),
    branch("feature/watch")
  ], {
    baseBranch: "develop",
    defaultBranch: "main"
  })

  assert.deepEqual(selected.map(branch => branch.name), ["feature/watch"])
})

// base/default branch를 제외한 모든 branch가 감시 대상으로 유지되는지 확인
test("selects every non-base branch", () => {
  const selected = select([
    branch("feature/watch"),
    branch("fix/webhook"),
    branch("release/1.0"),
    branch("bot/dependency")
  ], {
    baseBranch: "main"
  })

  assert.deepEqual(selected.map(branch => branch.name), [
    "feature/watch",
    "fix/webhook",
    "release/1.0",
    "bot/dependency"
  ])
})

// 연결된 Pull Request metadata가 optional 정보로 유지되는지 확인
test("keeps pull request metadata optional", () => {
  const selected = select([
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

// 선택된 branch가 이후 분석에 필요한 base/head/check metadata를 포함하는지 확인
test("builds branch context metadata", () => {
  const selected = select([
    {
      ...branch("feature/watch"),
      checks: [
        {
          name: "CI",
          status: "completed",
          conclusion: "success"
        }
      ]
    }
  ], {
    baseBranch: "main"
  })

  assert.equal(selected[0]?.baseBranch, "main")
  assert.equal(selected[0]?.headSha, "feature/watch-sha")
  assert.deepEqual(selected[0]?.checks, [
    {
      name: "CI",
      status: "completed",
      conclusion: "success"
    }
  ])
})

function branch(name: string, updatedAt?: Date): RepositoryBranch {
  return {
    name,
    sha: `${name}-sha`,
    author: "opfic",
    updatedAt
  }
}
