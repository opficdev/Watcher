import assert from "node:assert/strict"
import test from "node:test"
import type { BranchComparisonPair } from "../../src/branches/types.js"
import type {
  GitMergeCodeContextPairResult,
  GitMergeTreePairResult,
  MergeCodeContextEvidence,
  MergeCodeContextKind
} from "../../src/git/types.js"
import type {
  BranchConflictGraphEdge,
  BranchConflictGraphEdgeReasonCode,
  BranchConflictGraphEdgeStatus
} from "../../src/risks/types.js"
import { build } from "../../src/ai/predictionPairRequestBuilder.js"

// 위험한 조합만 기존 순서대로 하나의 요청 입력씩 구성하는지 확인
test("builds one request payload per selected branch pair", () => {
  const confirmedPair = comparisonPair("feature/confirmed-left", "feature/confirmed-right")
  const overlapPair = comparisonPair("feature/overlap-left", "feature/overlap-right")
  const sameFilePair = comparisonPair("feature/file-left", "feature/file-right")
  const cleanPair = comparisonPair("feature/clean-left", "feature/clean-right")
  const errorPair = comparisonPair("feature/error-left", "feature/error-right")
  const edges = [
    graphEdge(confirmedPair, "confirmed_conflict", ["confirmed_conflict"]),
    graphEdge(cleanPair, "clean", ["clean_merge"]),
    graphEdge(overlapPair, "potential_overlap", [
      "same_hunk_overlap",
      "same_file_overlap"
    ]),
    graphEdge(errorPair, "error", ["merge_check_failed"]),
    graphEdge(sameFilePair, "potential_overlap", ["same_file_overlap"])
  ]
  const payloads = build(
    edges,
    [
      mergeResult(overlapPair, "clean"),
      mergeResult(confirmedPair, "confirmed_conflict")
    ],
    [
      codeContextResult(overlapPair, "src/overlap.ts", "clean_hunk_overlap"),
      codeContextResult(confirmedPair, "src/confirmed.ts")
    ]
  )

  assert.deepEqual(payloads.map(payload => payload.pair), [
    confirmedPair,
    overlapPair
  ])
  assert.deepEqual(payloads.map(payload => payload.targetStatus), [
    "confirmed_conflict",
    "potential_overlap"
  ])
  assert.deepEqual(
    payloads.map(payload => payload.codeContext.evidence[0]?.filePath),
    ["src/confirmed.ts", "src/overlap.ts"]
  )
})

// 코드 문맥 결과 순서와 관계없이 ordered pair별 evidence가 격리되는지 확인
test("isolates code context for each ordered branch pair", () => {
  const firstPair = comparisonPair("feature/first-left", "feature/first-right")
  const secondPair = comparisonPair("feature/second-left", "feature/second-right")
  const payloads = build(
    [
      graphEdge(firstPair, "confirmed_conflict", ["confirmed_conflict"]),
      graphEdge(secondPair, "confirmed_conflict", ["confirmed_conflict"])
    ],
    [
      mergeResult(firstPair, "confirmed_conflict"),
      mergeResult(secondPair, "confirmed_conflict")
    ],
    [
      codeContextResult(secondPair, "src/second.ts"),
      codeContextResult(firstPair, "src/first.ts")
    ]
  )

  assert.equal(payloads[0]?.codeContext.evidence[0]?.filePath, "src/first.ts")
  assert.equal(payloads[1]?.codeContext.evidence[0]?.filePath, "src/second.ts")
})

// 코드 문맥 결과가 없어도 confirmed conflict 요청 입력을 유지하는지 확인
test("keeps confirmed conflict payload when code context is missing", () => {
  const pair = comparisonPair()
  const payloads = build(
    [graphEdge(pair, "confirmed_conflict", ["confirmed_conflict"])],
    [mergeResult(pair, "confirmed_conflict")]
  )

  assert.equal(payloads.length, 1)
  assert.equal(payloads[0]?.codeContext.status, "missing")
})

// 선택된 조합의 merge 누락과 edge, merge, 코드 문맥 중복을 거부하는지 확인
test("rejects missing and duplicate ordered pair inputs", () => {
  const pair = comparisonPair()
  const edge = graphEdge(pair, "confirmed_conflict", ["confirmed_conflict"])
  const merge = mergeResult(pair, "confirmed_conflict")
  const context = codeContextResult(pair, "src/value.ts")

  assert.throws(
    () => build([edge], []),
    /requires merge result for selected branch pair/
  )
  assert.throws(
    () => build([edge, edge], [merge]),
    /requires unique selected branch pair/
  )
  assert.throws(
    () => build([edge], [merge, merge]),
    /requires unique merge result/
  )
  assert.throws(
    () => build([edge], [merge], [context, context]),
    /requires unique code context result/
  )
})

// 테스트용 ordered branch 조합 구성
function comparisonPair(
  leftBranchName = "feature/left",
  rightBranchName = "feature/right"
): BranchComparisonPair {
  return {
    leftBranchName,
    rightBranchName
  }
}

// 상태와 reason을 포함하는 테스트용 graph edge 구성
function graphEdge(
  pair: BranchComparisonPair,
  status: BranchConflictGraphEdgeStatus,
  reasonCodes: BranchConflictGraphEdgeReasonCode[]
): BranchConflictGraphEdge {
  return {
    pair,
    status,
    reasons: reasonCodes.map(code => ({ code })),
    ...(status === "error" ? { errorMessage: "merge failed" } : {})
  }
}

// 선택된 조합의 테스트용 merge 결과 구성
function mergeResult(
  pair: BranchComparisonPair,
  status: "clean" | "confirmed_conflict"
): GitMergeTreePairResult {
  return {
    pair,
    status,
    leftCommitOid: `${pair.leftBranchName}-oid`,
    rightCommitOid: `${pair.rightBranchName}-oid`,
    mergedTreeOid: "merged-tree-oid",
    conflictFiles: status === "confirmed_conflict" ? ["src/value.ts"] : [],
    conflicts: status === "confirmed_conflict"
      ? [{ paths: ["src/value.ts"], type: "content" }]
      : []
  }
}

// 한 조합의 파일과 코드 문맥을 포함하는 테스트용 결과 구성
function codeContextResult(
  pair: BranchComparisonPair,
  filePath: string,
  kind: MergeCodeContextKind = "confirmed_conflict"
): GitMergeCodeContextPairResult {
  return {
    pair,
    overlapFiles: [filePath],
    evidence: [codeEvidence(pair, filePath, kind)]
  }
}

// 네 version snippet을 포함하는 테스트용 코드 evidence 구성
function codeEvidence(
  pair: BranchComparisonPair,
  filePath: string,
  kind: MergeCodeContextKind
): MergeCodeContextEvidence {
  return {
    pair,
    kind,
    filePath,
    mergeBaseOid: "base-oid",
    mergedTreeOid: "merged-tree-oid",
    baseCommit: {
      role: "base",
      oid: "base-oid",
      author: "opfic",
      committedAt: "2026-07-17T00:00:00.000Z",
      subject: "base"
    },
    leftCommit: {
      role: "left",
      branchName: pair.leftBranchName,
      oid: "left-oid",
      author: "opfic",
      committedAt: "2026-07-17T00:01:00.000Z",
      subject: "left"
    },
    rightCommit: {
      role: "right",
      branchName: pair.rightBranchName,
      oid: "right-oid",
      author: "opfic",
      committedAt: "2026-07-17T00:02:00.000Z",
      subject: "right"
    },
    baseSnippet: snippet(filePath, "base"),
    leftSnippet: snippet(filePath, "left"),
    rightSnippet: snippet(filePath, "right"),
    mergedSnippet: snippet(filePath, "merged")
  }
}

// 한 줄 text file을 표현하는 테스트용 snippet 구성
function snippet(filePath: string, content: string) {
  return {
    status: "text" as const,
    filePath,
    content,
    startLine: 1,
    endLine: 1,
    truncated: false
  }
}
