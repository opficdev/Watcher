import test from "node:test"
import assert from "node:assert/strict"
import { build } from "../../src/ai/predictionPairEvidenceBuilder.js"
import type { BranchComparisonPair } from "../../src/branches/types.js"
import type {
  GitMergeCodeContextPairResult,
  GitMergeTreePairResult,
  MergeCodeContextEvidence,
  MergeCodeContextKind
} from "../../src/git/types.js"
import type {
  BranchConflictGraphEdge,
  BranchConflictGraphEdgeReasonCode
} from "../../src/risks/types.js"

// 확정 conflict 조합의 merge 상태와 네 version 코드 문맥을 evidence로 구성하는지 확인
test("builds confirmed conflict pair evidence", () => {
  const pair = comparisonPair()
  const edge = graphEdge(pair, "confirmed_conflict", ["confirmed_conflict"])
  const context = codeEvidence(pair, "confirmed_conflict")
  const payload = build(
    edge,
    mergeResult(pair, "confirmed_conflict"),
    codeContextResult(pair, context)
  )

  assert.deepEqual(payload.pair, pair)
  assert.equal(payload.targetStatus, "confirmed_conflict")
  assert.deepEqual(payload.reasons, edge.reasons)
  assert.deepEqual(payload.branches, {
    left: {
      name: "feature/left",
      commitOid: "left-oid"
    },
    right: {
      name: "feature/right",
      commitOid: "right-oid"
    }
  })
  assert.deepEqual(payload.merge, {
    status: "confirmed_conflict",
    mergedTreeOid: "merged-tree-oid",
    conflictFiles: ["src/value.ts"],
    conflicts: [{
      paths: ["src/value.ts"],
      type: "content"
    }]
  })
  assert.equal(payload.codeContext.status, "available")
  assert.deepEqual(payload.codeContext.overlapFiles, ["src/value.ts"])
  assert.deepEqual(payload.codeContext.evidence, [context])
})

// 같은 hunk가 겹친 clean merge 조합을 potential overlap evidence로 구분하는지 확인
test("builds potential overlap pair evidence", () => {
  const pair = comparisonPair()
  const context = codeEvidence(pair, "clean_hunk_overlap")
  const payload = build(
    graphEdge(pair, "potential_overlap", [
      "same_hunk_overlap",
      "same_file_overlap"
    ]),
    mergeResult(pair, "clean"),
    codeContextResult(pair, context)
  )

  assert.equal(payload.targetStatus, "potential_overlap")
  assert.equal(payload.merge.status, "clean")
  assert.deepEqual(payload.merge.conflictFiles, [])
  assert.equal(payload.codeContext.evidence[0]?.kind, "clean_hunk_overlap")
})

// 확정 conflict의 코드 문맥이 없거나 실패해도 조합 evidence 자체는 유지하는지 확인
test("keeps confirmed conflict evidence when code context is unavailable", () => {
  const pair = comparisonPair()
  const edge = graphEdge(pair, "confirmed_conflict", ["confirmed_conflict"])
  const merge = mergeResult(pair, "confirmed_conflict")
  const missing = build(edge, merge)
  const failed = build(edge, merge, {
    pair,
    overlapFiles: [],
    evidence: [],
    errorMessage: "code context failed"
  })

  assert.deepEqual(missing.codeContext, {
    status: "missing",
    overlapFiles: [],
    evidence: []
  })
  assert.deepEqual(failed.codeContext, {
    status: "failed",
    overlapFiles: [],
    evidence: [],
    errorMessage: "code context failed"
  })
})

// edge와 다른 좌우 순서나 branch 조합의 merge/code evidence 혼입을 거부하는지 확인
test("rejects mismatched ordered branch pair evidence", () => {
  const pair = comparisonPair()
  const edge = graphEdge(pair, "confirmed_conflict", ["confirmed_conflict"])
  const merge = mergeResult(pair, "confirmed_conflict")
  const reversed = comparisonPair("feature/right", "feature/left")
  const other = comparisonPair("feature/left", "feature/other")

  assert.throws(
    () => build(edge, mergeResult(reversed, "confirmed_conflict")),
    /matching ordered branch pair/
  )
  assert.throws(
    () => build(edge, merge, codeContextResult(other, codeEvidence(other))),
    /matching ordered branch pair/
  )
  assert.throws(
    () => build(edge, merge, {
      pair,
      overlapFiles: ["src/value.ts"],
      evidence: [codeEvidence(other)]
    }),
    /matching ordered branch pair/
  )
})

// 선택 대상이 아닌 edge와 edge 상태에 맞지 않는 merge 결과를 거부하는지 확인
test("rejects unselected edges and mismatched merge status", () => {
  const pair = comparisonPair()

  assert.throws(
    () => build(
      graphEdge(pair, "clean", ["clean_merge"]),
      mergeResult(pair, "clean")
    ),
    /requires selected branch pair/
  )
  assert.throws(
    () => build(
      graphEdge(pair, "potential_overlap", ["same_file_overlap"]),
      mergeResult(pair, "clean")
    ),
    /requires selected branch pair/
  )
  assert.throws(
    () => build(
      graphEdge(pair, "confirmed_conflict", ["confirmed_conflict"]),
      mergeResult(pair, "clean")
    ),
    /matching merge status/
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

// 테스트할 graph edge와 reason 구성
function graphEdge(
  pair: BranchComparisonPair,
  status: BranchConflictGraphEdge["status"],
  reasonCodes: BranchConflictGraphEdgeReasonCode[]
): BranchConflictGraphEdge {
  return {
    pair,
    status,
    reasons: reasonCodes.map(code => ({
      code,
      files: code === "clean_merge" ? undefined : ["src/value.ts"]
    }))
  }
}

// 테스트할 clean 또는 confirmed conflict merge 결과 구성
function mergeResult(
  pair: BranchComparisonPair,
  status: "clean" | "confirmed_conflict"
): GitMergeTreePairResult {
  const confirmed = status === "confirmed_conflict"

  return {
    pair,
    status,
    leftCommitOid: "left-oid",
    rightCommitOid: "right-oid",
    mergedTreeOid: "merged-tree-oid",
    conflictFiles: confirmed ? ["src/value.ts"] : [],
    conflicts: confirmed
      ? [{
        paths: ["src/value.ts"],
        type: "content"
      }]
      : []
  }
}

// 코드 문맥 하나를 포함하는 테스트용 조합 결과 구성
function codeContextResult(
  pair: BranchComparisonPair,
  evidence: MergeCodeContextEvidence
): GitMergeCodeContextPairResult {
  return {
    pair,
    overlapFiles: ["src/value.ts"],
    evidence: [evidence]
  }
}

// 네 version의 commit metadata와 snippet을 포함하는 테스트용 evidence 구성
function codeEvidence(
  pair: BranchComparisonPair,
  kind: MergeCodeContextKind = "confirmed_conflict"
): MergeCodeContextEvidence {
  return {
    pair,
    kind,
    filePath: "src/value.ts",
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
    baseSnippet: snippet("base"),
    leftSnippet: snippet("left"),
    rightSnippet: snippet("right"),
    mergedSnippet: snippet("merged")
  }
}

// 한 줄 text file을 표현하는 테스트용 snippet 구성
function snippet(content: string) {
  return {
    status: "text" as const,
    filePath: "src/value.ts",
    content,
    startLine: 1,
    endLine: 1,
    truncated: false
  }
}
