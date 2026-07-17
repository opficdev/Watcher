import test from "node:test"
import assert from "node:assert/strict"
import { validate } from "../../src/ai/predictionPairResponseValidator.js"
import type {
  AiCleanOverlapResponse,
  AiConfirmedConflictResponse,
  AiPredictionPairEvidencePayload,
  AiPredictionPairTargetStatus
} from "../../src/ai/types.js"

// 확정 conflict 응답을 요청 evidence와 대조해 검증
test("validates confirmed conflict pair response", () => {
  const input = payload("confirmed_conflict")
  const response = confirmedConflictResponse()

  assert.deepEqual(validate(response, input), response)
})

// clean overlap 응답을 요청 evidence와 대조해 검증
test("validates clean overlap pair response", () => {
  const input = payload("potential_overlap")
  const response = cleanOverlapResponse()

  assert.deepEqual(validate(response, input), response)
})

// 응답 상태와 ordered pair가 요청과 다르면 거부
test("rejects mismatched pair response kind and ordered pair", () => {
  assert.throws(() => validate(
    cleanOverlapResponse(),
    payload("confirmed_conflict")
  ), /must be confirmed_conflict/)

  assert.throws(() => validate({
    ...confirmedConflictResponse(),
    pair: {
      leftBranchName: "feature/b",
      rightBranchName: "feature/a"
    }
  }, payload("confirmed_conflict")), /matching ordered branch pair/)
})

// 작업 순서에 대상 밖 branch나 같은 branch가 들어가면 거부
test("rejects invalid pair integration order", () => {
  assert.throws(() => validate({
    ...confirmedConflictResponse(),
    integrationOrder: {
      ...confirmedConflictResponse().integrationOrder,
      secondBranchName: "feature/c"
    }
  }, payload("confirmed_conflict")), /must use both target branches/)

  assert.throws(() => validate({
    ...cleanOverlapResponse(),
    integrationOrder: {
      ...cleanOverlapResponse().integrationOrder,
      secondBranchName: "feature/a"
    }
  }, payload("potential_overlap")), /must use both target branches/)
})

// 제공된 evidence에 없는 원인, patch, 예방 조치 파일을 거부
test("rejects files outside pair evidence", () => {
  assert.throws(() => validate({
    ...confirmedConflictResponse(),
    patches: [{
      filePath: "src/unknown.ts",
      patch: "@@ -1 +1 @@",
      reason: "제공되지 않은 파일"
    }]
  }, payload("confirmed_conflict")), /must use provided evidence files/)

  assert.throws(() => validate({
    ...cleanOverlapResponse(),
    overlapCause: {
      summary: "제공되지 않은 파일",
      files: ["src/unknown.ts"]
    }
  }, payload("potential_overlap")), /must use provided evidence files/)
})

// 상태별 해결 제안 배열이 비어 있으면 거부
test("rejects empty pair resolution suggestions", () => {
  assert.throws(() => validate({
    ...confirmedConflictResponse(),
    patches: []
  }, payload("confirmed_conflict")), /must be a non-empty array/)

  assert.throws(() => validate({
    ...cleanOverlapResponse(),
    preventiveActions: []
  }, payload("potential_overlap")), /must be a non-empty array/)
})

// 다른 상태의 field가 섞인 응답을 거부
test("rejects fields outside pair response schema", () => {
  assert.throws(() => validate({
    ...cleanOverlapResponse(),
    patches: []
  }, payload("potential_overlap")), /contains unsupported fields/)
})

function confirmedConflictResponse(): AiConfirmedConflictResponse {
  return {
    kind: "confirmed_conflict",
    pair: {
      leftBranchName: "feature/a",
      rightBranchName: "feature/b"
    },
    conflictCause: {
      summary: "두 branch가 같은 조건문을 다르게 수정함",
      files: ["src/shared.ts"]
    },
    integrationOrder: {
      strategy: "rebase",
      firstBranchName: "feature/a",
      secondBranchName: "feature/b",
      reason: "구조 변경을 먼저 반영해야 함",
      steps: ["feature/a 반영", "feature/b rebase"]
    },
    patches: [{
      filePath: "src/shared.ts",
      patch: "@@ -1 +1 @@\n-old\n+new",
      reason: "두 변경 의도를 함께 보존함"
    }]
  }
}

function cleanOverlapResponse(): AiCleanOverlapResponse {
  return {
    kind: "clean_overlap",
    pair: {
      leftBranchName: "feature/a",
      rightBranchName: "feature/b"
    },
    overlapCause: {
      summary: "같은 함수의 인접한 조건을 수정함",
      files: ["src/shared.ts"]
    },
    integrationOrder: {
      strategy: "merge",
      firstBranchName: "feature/a",
      secondBranchName: "feature/b",
      reason: "첫 변경 이후 통합 동작을 확인함",
      steps: ["feature/a merge", "feature/b 갱신"]
    },
    preventiveActions: [{
      title: "통합 동작 테스트",
      description: "두 조건이 함께 실행되는 경우를 확인함",
      files: ["src/shared.ts"]
    }]
  }
}

function payload(
  targetStatus: AiPredictionPairTargetStatus
): AiPredictionPairEvidencePayload {
  const confirmedConflict = targetStatus === "confirmed_conflict"

  return {
    pair: {
      leftBranchName: "feature/a",
      rightBranchName: "feature/b"
    },
    targetStatus,
    reasons: [{
      code: confirmedConflict ? "confirmed_conflict" : "same_hunk_overlap",
      files: ["src/shared.ts"]
    }],
    branches: {
      left: {
        name: "feature/a",
        commitOid: "a".repeat(40)
      },
      right: {
        name: "feature/b",
        commitOid: "b".repeat(40)
      }
    },
    merge: {
      status: confirmedConflict ? "confirmed_conflict" : "clean",
      mergedTreeOid: "c".repeat(40),
      conflictFiles: confirmedConflict ? ["src/shared.ts"] : [],
      conflicts: confirmedConflict
        ? [{ paths: ["src/shared.ts"], type: "content" }]
        : []
    },
    codeContext: {
      status: "available",
      overlapFiles: ["src/shared.ts"],
      evidence: [],
      includedFileCount: 0,
      includedHunkCount: 0,
      omittedFileCount: 0,
      omittedHunkCount: 0
    }
  }
}
