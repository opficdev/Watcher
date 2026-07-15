import test from "node:test"
import assert from "node:assert/strict"
import { select, selectWithReasons } from "../../src/branches/branchSelector.js"
import type { RepositoryBranch } from "../../src/branches/types.js"

const dayMilliseconds = 24 * 60 * 60 * 1_000
const currentTime = new Date()

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

// base/default branch 제외 사유를 debug artifact에 남길 수 있는지 확인
test("records branch exclusion reasons", () => {
  const result = selectWithReasons([
    branchWithoutUpdatedAt("main"),
    branch("develop", new Date(currentTime.getTime() - 15 * dayMilliseconds)),
    branch("feature/watch")
  ], {
    baseBranch: "develop",
    defaultBranch: "main"
  }, currentTime)

  assert.deepEqual(result.selected.map(branch => branch.name), ["feature/watch"])
  assert.deepEqual(result.excluded, [{
    name: "main",
    sha: "main-sha",
    reason: "default_branch"
  }, {
    name: "develop",
    sha: "develop-sha",
    reason: "base_branch"
  }])
})

// base/default branch를 제외한 모든 branch가 감시 대상으로 유지되는지 확인
test("selects every active non-base branch", () => {
  const selected = select([
    branch("feature/watch"),
    branch("fix/webhook"),
    branch("release/1.0"),
    branch("bot/dependency")
  ], {
    baseBranch: "main"
  })

  assert.deepEqual(selected.map(branch => branch.name), [
    "bot/dependency",
    "feature/watch",
    "fix/webhook",
    "release/1.0"
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

// 14일 경계는 포함하고 더 오래되었거나 시각이 없는 branch는 제외하는지 확인
test("selects branches updated within the inclusive 14 day window", () => {
  const result = selectWithReasons([
    branch("feature/boundary", new Date(currentTime.getTime() - 14 * dayMilliseconds)),
    branch("feature/stale", new Date(currentTime.getTime() - 14 * dayMilliseconds - 1)),
    branchWithoutUpdatedAt("feature/missing")
  ], {
    baseBranch: "main"
  }, currentTime)

  assert.deepEqual(result.selected.map(branch => branch.name), ["feature/boundary"])
  assert.deepEqual(result.excluded, [{
    name: "feature/stale",
    sha: "feature/stale-sha",
    reason: "stale_branch"
  }, {
    name: "feature/missing",
    sha: "feature/missing-sha",
    reason: "stale_branch"
  }])
})

// 최근 갱신 순으로 정렬하고 같은 시각은 branch 이름 순으로 정렬하는지 확인
test("sorts active branches by updated time and branch name", () => {
  const selected = select([
    branch("feature/older", new Date(currentTime.getTime() - dayMilliseconds)),
    branch("feature/ä"),
    branch("feature/z"),
    branch("feature/a")
  ], {
    baseBranch: "main"
  })

  assert.deepEqual(selected.map(branch => branch.name), [
    "feature/a",
    "feature/z",
    "feature/ä",
    "feature/older"
  ])
})

// 최근 branch 30개만 선택하고 나머지 branch 제외 사유를 남기는지 확인
test("limits active branches and records overflow reasons", () => {
  const branches = Array.from({ length: 31 }, (_, index) => branch(
    `feature/${String(index).padStart(2, "0")}`,
    new Date(currentTime.getTime() - index * 1_000)
  ))

  const result = selectWithReasons(branches, {
    baseBranch: "main"
  }, currentTime)

  assert.equal(result.selected.length, 30)
  assert.deepEqual(result.selected.map(branch => branch.name), branches
    .slice(0, 30)
    .map(branch => branch.name))
  assert.deepEqual(result.excluded, [{
    name: "feature/30",
    sha: "feature/30-sha",
    reason: "branch_limit"
  }])
})

function branch(name: string, updatedAt: Date | undefined = currentTime): RepositoryBranch {
  return {
    name,
    sha: `${name}-sha`,
    author: "opfic",
    updatedAt
  }
}

function branchWithoutUpdatedAt(name: string): RepositoryBranch {
  return {
    name,
    sha: `${name}-sha`,
    author: "opfic"
  }
}
