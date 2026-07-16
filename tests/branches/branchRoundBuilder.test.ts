import test from "node:test"
import assert from "node:assert/strict"
import { build as buildPairs } from "../../src/branches/branchPairBuilder.js"
import { build } from "../../src/branches/branchRoundBuilder.js"
import type { BranchComparisonPair, BranchContext } from "../../src/branches/types.js"

// 비교 조합이 없으면 라운드를 만들지 않는지 확인
test("returns no rounds without pairs", () => {
  assert.deepEqual(build([]), [])
})

// 홀수 branch에서는 매 라운드마다 한 branch가 쉬면서 모든 조합을 배치하는지 확인
test("builds circle rounds for odd branch count", () => {
  const pairs = buildPairs("main", [
    branch("feature/a"),
    branch("feature/b")
  ])
  const rounds = build(pairs)

  assert.equal(rounds.length, 3)
  assert.deepEqual(rounds.map(round => round.roundIndex), [0, 1, 2])
  assert.deepEqual(rounds.flatMap(round => round.pairs).sort(comparePairs), pairs)
  assert.equal(rounds.every(round => round.pairs.length === 1), true)
})

// 짝수 branch에서는 휴식 자리 없이 라운드마다 모든 branch를 한 번씩 배치하는지 확인
test("builds circle rounds for even branch count", () => {
  const pairs = buildPairs("main", [
    branch("feature/a"),
    branch("feature/b"),
    branch("feature/c")
  ])
  const rounds = build(pairs)

  assert.equal(rounds.length, 3)
  assert.equal(rounds.every(round => round.pairs.length === 2), true)

  for (const round of rounds) {
    const names = round.pairs.flatMap(pair => [
      pair.leftBranchName,
      pair.rightBranchName
    ])

    assert.equal(new Set(names).size, names.length)
  }
})

// 입력 순서와 조합 방향이 달라도 같은 라운드를 구성하는지 확인
test("builds deterministic rounds independent of pair input order", () => {
  const pairs = buildPairs("main", [
    branch("feature/a"),
    branch("feature/b"),
    branch("feature/c")
  ])
  const reordered = [...pairs].reverse().map((pair, index) => index % 2 === 0
    ? {
      leftBranchName: pair.rightBranchName,
      rightBranchName: pair.leftBranchName
    }
    : pair
  )

  assert.deepEqual(build(reordered), build(pairs))
})

// 한 라운드에서 같은 branch가 두 조합에 포함되지 않는지 확인
test("does not repeat a branch in the same round", () => {
  const rounds = build(buildPairs("main", Array.from({ length: 8 }, (_, index) =>
    branch(`feature/${index}`)
  )))

  for (const round of rounds) {
    const names = round.pairs.flatMap(pair => [
      pair.leftBranchName,
      pair.rightBranchName
    ])

    assert.equal(new Set(names).size, names.length)
  }
})

// 31개 branch의 465개 조합을 31개 라운드에 정확히 한 번씩 배치하는지 확인
test("builds 31 rounds for 31 branches and 465 pairs", () => {
  const pairs = buildPairs("main", Array.from({ length: 30 }, (_, index) =>
    branch(`feature/${String(index).padStart(2, "0")}`)
  ))
  const rounds = build(pairs)
  const scheduled = rounds.flatMap(round => round.pairs)

  assert.equal(rounds.length, 31)
  assert.equal(rounds.every(round => round.pairs.length === 15), true)
  assert.equal(scheduled.length, 465)
  assert.equal(new Set(scheduled.map(keyFor)).size, 465)
  assert.deepEqual([...scheduled].sort(comparePairs), pairs)
})

function branch(name: string): BranchContext {
  return {
    baseBranch: "main",
    name,
    headSha: `${name}-sha`,
    checks: []
  }
}

function comparePairs(pair: BranchComparisonPair, other: BranchComparisonPair): number {
  return keyFor(pair).localeCompare(keyFor(other))
}

function keyFor(pair: BranchComparisonPair): string {
  return `${pair.leftBranchName}\u0000${pair.rightBranchName}`
}
