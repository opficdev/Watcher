import test from "node:test"
import assert from "node:assert/strict"
import { build } from "../../src/branches/branchPairBuilder.js"
import type { BranchContext } from "../../src/branches/types.js"

// 활성 branch가 없으면 비교 조합을 만들지 않는지 확인
test("returns no pairs without active branches", () => {
  assert.deepEqual(build("main", []), [])
})

// base branch와 활성 branch 하나를 한 번만 조합하는지 확인
test("pairs the base branch with one active branch", () => {
  assert.deepEqual(build("develop", [branch("feature/watch", "develop")]), [{
    leftBranchName: "develop",
    rightBranchName: "feature/watch"
  }])
})

// 중복 이름과 자기 자신 조합을 제외하고 방향 없는 조합만 만드는지 확인
test("excludes duplicate, self, and reversed pairs", () => {
  const pairs = build("main", [
    branch("feature/b"),
    branch("feature/a"),
    branch("feature/a"),
    branch("main")
  ])

  assert.deepEqual(pairs, [{
    leftBranchName: "feature/a",
    rightBranchName: "feature/b"
  }, {
    leftBranchName: "feature/a",
    rightBranchName: "main"
  }, {
    leftBranchName: "feature/b",
    rightBranchName: "main"
  }])
})

// 입력 순서와 무관하게 branch 이름 기준의 같은 조합 순서를 만드는지 확인
test("builds pairs in deterministic branch name order", () => {
  const pairs = build("main", [
    branch("feature/z"),
    branch("feature/a"),
    branch("feature/m")
  ])
  const reorderedPairs = build("main", [
    branch("feature/m"),
    branch("feature/z"),
    branch("feature/a")
  ])

  assert.deepEqual(reorderedPairs, pairs)
  assert.deepEqual(pairs[0], {
    leftBranchName: "feature/a",
    rightBranchName: "feature/m"
  })
  assert.deepEqual(pairs.at(-1), {
    leftBranchName: "feature/z",
    rightBranchName: "main"
  })
})

// 지역화 규칙이 아닌 문자열 비교로 대소문자 branch 순서를 고정하는지 확인
test("uses non-localized string comparison", () => {
  const pairs = build("main", [
    branch("feature/a"),
    branch("feature/Z")
  ])

  assert.deepEqual(pairs, [{
    leftBranchName: "feature/Z",
    rightBranchName: "feature/a"
  }, {
    leftBranchName: "feature/Z",
    rightBranchName: "main"
  }, {
    leftBranchName: "feature/a",
    rightBranchName: "main"
  }])
})

// 활성 branch 30개와 base branch에서 최대 465개 조합을 만드는지 확인
test("builds 465 pairs for 30 active branches", () => {
  const branches = Array.from({ length: 30 }, (_, index) =>
    branch(`feature/${String(index).padStart(2, "0")}`)
  )

  const pairs = build("main", branches)

  assert.equal(pairs.length, 465)
  assert.equal(new Set(pairs.map(pair =>
    `${pair.leftBranchName}\u0000${pair.rightBranchName}`
  )).size, 465)
})

function branch(name: string, baseBranch = "main"): BranchContext {
  return {
    baseBranch,
    name,
    headSha: `${name}-sha`,
    checks: []
  }
}
