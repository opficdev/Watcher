import test from "node:test"
import assert from "node:assert/strict"
import { select } from "../../src/ai/predictionPairTargetSelector.js"
import type {
  BranchConflictGraphEdge,
  BranchConflictGraphEdgeReasonCode,
  BranchConflictGraphEdgeStatus
} from "../../src/risks/types.js"

// 확정 conflict 조합은 다른 signal과 관계없이 AI 분석 대상에 포함하는지 확인
test("includes confirmed conflict pairs", () => {
  const target = edge(
    "feature/conflict-a",
    "feature/conflict-b",
    "confirmed_conflict",
    ["confirmed_conflict"]
  )

  assert.deepEqual(select([target]), [target])
})

// 같은 hunk가 겹치는 potential overlap 조합을 critical 대상으로 포함하는지 확인
test("includes critical potential overlap pairs", () => {
  const target = edge(
    "feature/overlap-a",
    "feature/overlap-b",
    "potential_overlap",
    ["same_hunk_overlap", "same_file_overlap"]
  )

  assert.deepEqual(select([target]), [target])
})

// 같은 파일만 겹치는 potential overlap 조합은 AI 분석 대상에서 제외하는지 확인
test("excludes same-file-only potential overlap pairs", () => {
  const candidate = edge(
    "feature/file-a",
    "feature/file-b",
    "potential_overlap",
    ["same_file_overlap"]
  )

  assert.deepEqual(select([candidate]), [])
})

// 제외 대상을 제거하면서 기존 graph edge 순서를 유지하는지 확인
test("excludes clean and error pairs while preserving target order", () => {
  const first = edge(
    "feature/first-a",
    "feature/first-b",
    "confirmed_conflict",
    ["confirmed_conflict"]
  )
  const second = edge(
    "feature/second-a",
    "feature/second-b",
    "potential_overlap",
    ["same_hunk_overlap", "same_file_overlap"]
  )

  const selected = select([
    edge("feature/clean-a", "feature/clean-b", "clean", ["clean_merge"]),
    first,
    edge("feature/error-a", "feature/error-b", "error", ["merge_check_failed"]),
    second
  ])

  assert.deepEqual(selected, [first, second])
})

function edge(
  leftBranchName: string,
  rightBranchName: string,
  status: BranchConflictGraphEdgeStatus,
  reasonCodes: BranchConflictGraphEdgeReasonCode[]
): BranchConflictGraphEdge {
  return {
    pair: {
      leftBranchName,
      rightBranchName
    },
    status,
    reasons: reasonCodes.map(code => ({ code })),
    ...(status === "error"
      ? { errorMessage: "branch pair collection failed" }
      : {})
  }
}
