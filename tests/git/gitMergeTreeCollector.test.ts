import test from "node:test"
import assert from "node:assert/strict"
import { build as buildPairs } from "../../src/branches/branchPairBuilder.js"
import { build as buildRounds } from "../../src/branches/branchRoundBuilder.js"
import { collect } from "../../src/git/gitMergeTreeCollector.js"
import type {
  BranchComparisonPair,
  BranchComparisonRound,
  BranchContext
} from "../../src/branches/types.js"
import type {
  GitMergeTreeCollectorDependencies,
  GitMergeTreePairResult
} from "../../src/git/types.js"

// availableParallelism과 고정 상한 중 작은 값만큼 라운드를 병렬 실행하는지 확인
test("limits parallel rounds to available processors and fixed cap", async () => {
  for (const scenario of [{ available: 2, expected: 2 }, { available: 8, expected: 4 }]) {
    const pairs = buildPairs("main", Array.from({ length: 8 }, (_, index) =>
      branch(`feature/${index}`)
    ))
    let active = 0
    let maximum = 0
    let fetchCount = 0
    let resolveCount = 0
    let supportCount = 0

    const results = await collect(pairs, baseOptions(), {
      fetchRemoteBranches: async () => {
        fetchCount += 1
      },
      resolveCommitOids: async (_repositoryPath, _remote, names) => {
        resolveCount += 1
        return commitOidsFor(names)
      },
      supportsMergeTreeStdin: async () => {
        supportCount += 1
        return true
      },
      collectRound: async round => {
        active += 1
        maximum = Math.max(maximum, active)
        await delay(10)
        active -= 1
        return cleanResults(round)
      },
      availableParallelism: () => scenario.available
    })

    assert.equal(maximum, scenario.expected)
    assert.equal(fetchCount, 1)
    assert.equal(resolveCount, 1)
    assert.equal(supportCount, 1)
    assert.equal(results.length, pairs.length)
  }
})

// 라운드 완료 순서와 무관하게 #42 조합 순서로 결과를 반환하는지 확인
test("restores results to pair input order", async () => {
  const pairs = buildPairs("main", Array.from({ length: 6 }, (_, index) =>
    branch(`feature/${index}`)
  ))
  const roundCount = buildRounds(pairs).length

  const results = await collect(pairs, baseOptions(), dependencies({
    collectRound: async round => {
      await delay((roundCount - round.roundIndex) * 5)
      return cleanResults(round)
    },
    availableParallelism: () => 4
  }))

  assert.deepEqual(results.map(result => result.pair), pairs)
})

// 실패한 라운드만 이분하고 단일 실패 조합을 다른 결과에서 격리하는지 확인
test("isolates one failed pair by splitting only its round", async () => {
  const pairs = buildPairs("main", [
    branch("feature/a"),
    branch("feature/b"),
    branch("feature/c")
  ])
  const target = pairs[0]!
  const attempts: BranchComparisonPair[][] = []

  const results = await collect(pairs, baseOptions(), dependencies({
    collectRound: async round => {
      attempts.push(round.pairs)

      if (round.pairs.some(pair => keyFor(pair) === keyFor(target))) {
        throw new Error("target merge failed")
      }

      return cleanResults(round)
    },
    availableParallelism: () => 1
  }))
  const failed = results.filter(result => result.status === "merge_check_failed")

  assert.deepEqual(failed.map(result => result.pair), [target])
  assert.equal(failed[0]?.errorMessage, "target merge failed")
  assert.equal(failed[0]?.failureStage, "merge")
  assert.equal(results.filter(result => result.status === "clean").length, pairs.length - 1)
  assert.equal(attempts.some(attempt => attempt.length === 2 &&
    attempt.some(pair => keyFor(pair) === keyFor(target))
  ), true)
  assert.equal(attempts.some(attempt => attempt.length === 1 &&
    keyFor(attempt[0]!) === keyFor(target)
  ), true)
})

// 지원하지 않는 Git에서는 모든 조합에 같은 진단을 남기고 라운드를 실행하지 않는지 확인
test("returns the same diagnostic when merge-tree stdin is unsupported", async () => {
  const pairs = buildPairs("main", [branch("feature/a"), branch("feature/b")])
  let roundCount = 0

  const results = await collect(pairs, baseOptions(), dependencies({
    supportsMergeTreeStdin: async () => false,
    collectRound: async round => {
      roundCount += 1
      return cleanResults(round)
    }
  }))

  assert.equal(roundCount, 0)
  assert.equal(results.every(result => result.status === "merge_check_failed"), true)
  assert.equal(results.every(result => result.failureStage === "preparation"), true)
  assert.equal(new Set(results.map(result => result.errorMessage)).size, 1)
  assert.match(results[0]?.errorMessage ?? "", /not supported/)
})

// OID가 없는 branch 관련 조합만 실패시키고 나머지 조합은 수집하는지 확인
test("isolates pairs with missing remote branch OID", async () => {
  const pairs = buildPairs("main", [branch("feature/a"), branch("feature/missing")])

  const results = await collect(pairs, baseOptions(), dependencies({
    resolveCommitOids: async (_repositoryPath, _remote, names) =>
      commitOidsFor(names.filter(name => name !== "feature/missing"))
  }))

  assert.equal(results.find(result =>
    result.pair.leftBranchName === "feature/a" &&
    result.pair.rightBranchName === "main"
  )?.status, "clean")
  assert.equal(results.filter(result =>
    result.pair.leftBranchName === "feature/missing" ||
    result.pair.rightBranchName === "feature/missing"
  ).every(result =>
    result.status === "merge_check_failed" &&
    result.failureStage === "preparation"
  ), true)
})

// fetch 실패를 모든 조합의 preparation 실패로 분류하는지 확인
test("marks fetch failures as preparation failures", async () => {
  const pairs = buildPairs("main", [branch("feature/a"), branch("feature/b")])

  const results = await collect(pairs, baseOptions(), dependencies({
    fetchRemoteBranches: async () => {
      throw new Error("fetch failed")
    }
  }))

  assert.equal(results.every(result =>
    result.status === "merge_check_failed" &&
    result.failureStage === "preparation"
  ), true)
})

// 빈 조합에서는 fetch, 지원 확인, 라운드 process를 실행하지 않는지 확인
test("does not run Git operations without pairs", async () => {
  let operationCount = 0

  const results = await collect([], baseOptions(), {
    fetchRemoteBranches: async () => {
      operationCount += 1
    },
    resolveCommitOids: async () => {
      operationCount += 1
      return new Map()
    },
    supportsMergeTreeStdin: async () => {
      operationCount += 1
      return true
    },
    collectRound: async () => {
      operationCount += 1
      return []
    },
    availableParallelism: () => 4
  })

  assert.deepEqual(results, [])
  assert.equal(operationCount, 0)
})

function dependencies(
  overrides: Partial<GitMergeTreeCollectorDependencies> = {}
): GitMergeTreeCollectorDependencies {
  return {
    fetchRemoteBranches: async () => {},
    resolveCommitOids: async (_repositoryPath, _remote, names) => commitOidsFor(names),
    supportsMergeTreeStdin: async () => true,
    collectRound: async round => cleanResults(round),
    availableParallelism: () => 4,
    ...overrides
  }
}

function cleanResults(round: BranchComparisonRound): GitMergeTreePairResult[] {
  return round.pairs.map(pair => ({
    pair,
    status: "clean",
    mergedTreeOid: "1".repeat(40),
    conflictFiles: [],
    conflicts: []
  }))
}

function commitOidsFor(names: string[]): ReadonlyMap<string, string> {
  return new Map(names.map((name, index) => [
    name,
    String(index + 1).repeat(40).slice(0, 40)
  ]))
}

function baseOptions(): {
  repositoryPath: string
  remoteName: string
} {
  return {
    repositoryPath: "/tmp/repository",
    remoteName: "origin"
  }
}

function branch(name: string): BranchContext {
  return {
    baseBranch: "main",
    name,
    headSha: `${name}-sha`,
    checks: []
  }
}

function keyFor(pair: BranchComparisonPair): string {
  return [pair.leftBranchName, pair.rightBranchName].sort().join("\u0000")
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}
