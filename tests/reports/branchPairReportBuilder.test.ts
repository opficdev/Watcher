import test from "node:test"
import assert from "node:assert/strict"
import {
  buildBranchPairMergeRiskReport,
  type AiConfirmedConflictResponse,
  type AiCleanOverlapResponse,
  type AiPredictionPairResult,
  type BranchComparisonPair,
  type BranchConflictGraph,
  type BranchConflictGraphEdge,
  type BranchContext,
  type ExcludedBranch,
  type GitMergeTreePairResult
} from "../../src/index.js"

const generatedAt = new Date("2026-07-17T00:00:00.000Z")

// 요약과 위험 section을 branch 조합 기준으로 구성하는지 확인
test("builds branch pair summary and risk sections", () => {
  const confirmedPair = pair("feature/a", "main")
  const predictedPair = pair("feature/a", "feature/b")
  const failedPair = pair("feature/b", "feature/c")
  const skippedPair = pair("feature/c", "main")
  const graph = conflictGraph([
    edge(confirmedPair, "confirmed_conflict", "confirmed_conflict", ["src/a.ts"]),
    edge(predictedPair, "potential_overlap", "same_hunk_overlap", ["src/b.ts"]),
    edge(failedPair, "potential_overlap", "same_file_overlap", ["src/c.ts"]),
    edge(skippedPair, "potential_overlap", "same_file_overlap", ["src/d.ts"]),
    edge(pair("feature/a", "feature/c"), "clean", "clean_merge"),
    {
      pair: pair("feature/b", "main"),
      status: "error",
      reasons: [{ code: "merge_check_failed" }],
      errorMessage: "merge-tree failed"
    }
  ])

  const report = buildBranchPairMergeRiskReport({
    generatedAt,
    activeBranchWindowDays: 14,
    discoveredBranchCount: 8,
    watchedBranches: [branch("feature/a"), branch("feature/b"), branch("feature/c")],
    excludedBranches: [],
    graph,
    mergeResults: [
      mergeResult(pair("main", "feature/a"), "confirmed_conflict", {
        leftCommitOid: "main-oid",
        rightCommitOid: "feature-a-oid",
        conflictFiles: ["src/a.ts"],
        conflicts: [{ paths: ["src/a.ts"], type: "content" }]
      }),
      mergeResult(predictedPair, "clean", {
        leftCommitOid: "feature-a-oid",
        rightCommitOid: "feature-b-oid"
      }),
      mergeResult(failedPair, "clean"),
      mergeResult(skippedPair, "clean")
    ],
    aiResults: [
      predictedAiResult(confirmedPair, confirmedResponse(confirmedPair)),
      predictedAiResult(predictedPair, cleanOverlapResponse(predictedPair)),
      {
        status: "failed",
        pair: failedPair,
        errorMessage: "provider failed"
      }
    ]
  })

  assert.equal(report.baseBranch, "main")
  assert.deepEqual(report.activePeriod, {
    dayCount: 14,
    since: new Date("2026-07-03T00:00:00.000Z"),
    until: generatedAt
  })
  assert.equal(report.discoveredBranchCount, 8)
  assert.equal(report.watchedBranchCount, 3)
  assert.equal(report.comparisonPairCount, 6)
  assert.equal(report.cleanPairCount, 1)
  assert.equal(report.confirmedConflicts.length, 1)
  assert.deepEqual(report.confirmedConflicts[0], {
    pair: confirmedPair,
    status: "confirmed_conflict",
    reasons: [{ code: "confirmed_conflict", files: ["src/a.ts"] }],
    conflicts: [{ paths: ["src/a.ts"], type: "content" }],
    leftCommitOid: "feature-a-oid",
    rightCommitOid: "main-oid",
    aiAnalysis: {
      status: "predicted",
      response: confirmedResponse(confirmedPair)
    }
  })
  assert.deepEqual(
    report.potentialRisks.map(item => item.aiAnalysis.status),
    ["predicted", "failed", "skipped"]
  )
  assert.deepEqual(report.potentialRisks[2]?.aiAnalysis, {
    status: "skipped",
    reason: "not_target"
  })
  assert.deepEqual(report.mergeErrors, [{
    pair: pair("feature/b", "main"),
    reasons: [{ code: "merge_check_failed" }],
    errorMessage: "merge-tree failed"
  }])
})

// 반대 방향 중복 조합을 한 번만 집계하고 base row를 만들지 않는지 확인
test("deduplicates pairs and builds watched branch impacts", () => {
  const graph = conflictGraph([
    edge(pair("feature/a", "main"), "confirmed_conflict", "confirmed_conflict"),
    edge(pair("main", "feature/a"), "confirmed_conflict", "confirmed_conflict"),
    edge(pair("feature/b", "feature/a"), "potential_overlap", "same_file_overlap")
  ])

  const report = buildBranchPairMergeRiskReport({
    generatedAt,
    activeBranchWindowDays: 14,
    discoveredBranchCount: 3,
    watchedBranches: [branch("feature/b"), branch("feature/a")],
    excludedBranches: [],
    graph,
    mergeResults: [],
    aiResults: []
  })

  assert.equal(report.comparisonPairCount, 2)
  assert.equal(report.confirmedConflicts.length, 1)
  assert.deepEqual(report.branchImpacts, [{
    branchName: "feature/a",
    confirmedConflictPairs: [pair("feature/a", "main")],
    potentialRiskPairs: [pair("feature/a", "feature/b")]
  }, {
    branchName: "feature/b",
    confirmedConflictPairs: [],
    potentialRiskPairs: [pair("feature/a", "feature/b")]
  }])
  assert.equal(
    report.branchImpacts.some(impact => impact.branchName === "main"),
    false
  )
})

// stale과 branch limit 제외 사유만 report에 남기는지 확인
test("keeps reportable branch exclusions in deterministic order", () => {
  const excludedBranches: ExcludedBranch[] = [{
    name: "main",
    sha: "main-sha",
    reason: "base_branch"
  }, {
    name: "feature/z",
    sha: "feature-z-sha",
    reason: "stale_branch"
  }, {
    name: "feature/a",
    sha: "feature-a-sha",
    reason: "branch_limit"
  }, {
    name: "develop",
    sha: "develop-sha",
    reason: "default_branch"
  }]

  const report = buildBranchPairMergeRiskReport({
    generatedAt,
    activeBranchWindowDays: 14,
    discoveredBranchCount: 4,
    watchedBranches: [],
    excludedBranches,
    graph: conflictGraph([]),
    mergeResults: [],
    aiResults: []
  })

  assert.deepEqual(report.excludedBranches, [{
    name: "feature/a",
    reason: "branch_limit"
  }, {
    name: "feature/z",
    reason: "stale_branch"
  }])
})

function branch(name: string): BranchContext {
  return {
    baseBranch: "main",
    name,
    headSha: `${name}-sha`,
    checks: []
  }
}

function pair(
  leftBranchName: string,
  rightBranchName: string
): BranchComparisonPair {
  return {
    leftBranchName,
    rightBranchName
  }
}

function edge(
  branchPair: BranchComparisonPair,
  status: BranchConflictGraphEdge["status"],
  reasonCode: BranchConflictGraphEdge["reasons"][number]["code"],
  files?: string[]
): BranchConflictGraphEdge {
  return {
    pair: branchPair,
    status,
    reasons: [{ code: reasonCode, files }]
  }
}

function conflictGraph(edges: BranchConflictGraphEdge[]): BranchConflictGraph {
  return {
    baseBranch: "main",
    nodes: [],
    edges
  }
}

function mergeResult(
  branchPair: BranchComparisonPair,
  status: GitMergeTreePairResult["status"],
  overrides: Partial<GitMergeTreePairResult> = {}
): GitMergeTreePairResult {
  return {
    pair: branchPair,
    status,
    conflictFiles: [],
    conflicts: [],
    ...overrides
  }
}

function predictedAiResult(
  branchPair: BranchComparisonPair,
  response: AiConfirmedConflictResponse | AiCleanOverlapResponse
): AiPredictionPairResult {
  return {
    status: "predicted",
    pair: branchPair,
    response
  }
}

function confirmedResponse(
  branchPair: BranchComparisonPair
): AiConfirmedConflictResponse {
  return {
    kind: "confirmed_conflict",
    pair: branchPair,
    conflictCause: {
      summary: "같은 조건을 다르게 수정함",
      files: ["src/a.ts"]
    },
    integrationOrder: {
      strategy: "rebase",
      firstBranchName: branchPair.leftBranchName,
      secondBranchName: branchPair.rightBranchName,
      reason: "첫 변경을 기준으로 정리함",
      steps: ["첫 branch 반영", "두 번째 branch rebase"]
    },
    patches: [{
      filePath: "src/a.ts",
      patch: "@@ -1 +1 @@\n-old\n+new",
      reason: "두 변경 의도를 보존함"
    }]
  }
}

function cleanOverlapResponse(
  branchPair: BranchComparisonPair
): AiCleanOverlapResponse {
  return {
    kind: "clean_overlap",
    pair: branchPair,
    overlapCause: {
      summary: "같은 파일의 인접 코드를 수정함",
      files: ["src/b.ts"]
    },
    integrationOrder: {
      strategy: "merge",
      firstBranchName: branchPair.leftBranchName,
      secondBranchName: branchPair.rightBranchName,
      reason: "현재 순서로 통합 가능함",
      steps: ["첫 branch merge", "두 번째 branch merge"]
    },
    preventiveActions: [{
      title: "통합 동작 확인",
      description: "두 변경이 함께 동작하는지 확인함",
      files: ["src/b.ts"]
    }]
  }
}
