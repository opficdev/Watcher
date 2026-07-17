import test from "node:test"
import assert from "node:assert/strict"
import { build } from "../../src/ai/predictionPairPromptBuilder.js"
import {
  DEFAULT_AI_CLEAN_OVERLAP_SYSTEM_PROMPT,
  DEFAULT_AI_CONFIRMED_CONFLICT_SYSTEM_PROMPT
} from "../../src/ai/predictionPairPromptTemplates.js"
import type {
  AiPredictionPairEvidencePayload,
  AiPredictionPairTargetStatus
} from "../../src/ai/types.js"

// 확정 conflict evidence를 patch 전용 prompt로 구성
test("builds confirmed conflict pair prompt", () => {
  const input = payload("confirmed_conflict")
  const prompt = build(input)

  assert.equal(prompt.systemPrompt, DEFAULT_AI_CONFIRMED_CONFLICT_SYSTEM_PROMPT)
  assert.equal(prompt.responseShape, "predictionPairConfirmedConflict")
  assert.deepEqual(JSON.parse(prompt.userPrompt), input)
})

// clean overlap evidence를 예방 조치 전용 prompt로 구성
test("builds clean overlap pair prompt", () => {
  const input = payload("potential_overlap")
  const prompt = build(input)

  assert.equal(prompt.systemPrompt, DEFAULT_AI_CLEAN_OVERLAP_SYSTEM_PROMPT)
  assert.equal(prompt.responseShape, "predictionPairCleanOverlap")
  assert.match(prompt.systemPrompt, /not a confirmed conflict/)
  assert.deepEqual(JSON.parse(prompt.userPrompt), input)
})

// 호출자가 상태별 기본 prompt를 교체할 수 있도록 기존 option 유지
test("uses caller provided pair system prompt", () => {
  const prompt = build(payload("confirmed_conflict"), {
    systemPrompt: "Return compact JSON."
  })

  assert.equal(prompt.systemPrompt, "Return compact JSON.")
  assert.equal(prompt.responseShape, "predictionPairConfirmedConflict")
})

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
