import test from "node:test"
import assert from "node:assert/strict"
import {
  validateAiPredictionBatchResponse,
  validateAiPredictionResponse
} from "../../src/index.js"

// AI prediction JSON이 기대한 모델이면 그대로 통과하는지 확인
test("validates ai prediction response", () => {
  const prediction = validateAiPredictionResponse({
    branchName: "feature/watch",
    baseBranch: "main",
    prediction: "shared module 변경 의도가 겹쳐 rebase 우선 확인이 필요함",
    confidence: 82,
    recommendedActions: [{
      title: "base branch rebase",
      description: "shared.ts 변경을 먼저 rebase해 실제 conflict 여부를 확인함",
      priority: "high",
      files: ["src/shared.ts"]
    }],
    falsePositiveNotes: ["서로 다른 export만 수정했다면 실제 conflict 가능성은 낮아질 수 있음"]
  })

  assert.equal(prediction.branchName, "feature/watch")
  assert.equal(prediction.confidence, 82)
  assert.equal(prediction.recommendedActions[0]?.priority, "high")
  assert.deepEqual(prediction.falsePositiveNotes, [
    "서로 다른 export만 수정했다면 실제 conflict 가능성은 낮아질 수 있음"
  ])
})

// batch AI prediction JSON이 branch별 prediction 배열이면 그대로 통과하는지 확인
test("validates ai prediction batch response", () => {
  const predictions = validateAiPredictionBatchResponse({
    predictions: [
      validResponse("feature/a"),
      validResponse("feature/b")
    ]
  })

  assert.deepEqual(predictions.map(prediction => prediction.branchName), [
    "feature/a",
    "feature/b"
  ])
})

// confidence가 0-100 범위를 벗어나면 AI 응답을 거부하는지 확인
test("rejects confidence outside report range", () => {
  assert.throws(
    () => validateAiPredictionResponse({
      ...validResponse(),
      confidence: 120
    }),
    /confidence/
  )
})

// confidence가 소수면 report 의미가 모호하므로 AI 응답을 거부하는지 확인
test("rejects fractional confidence", () => {
  assert.throws(
    () => validateAiPredictionResponse({
      ...validResponse(),
      confidence: 0.98
    }),
    /integer/
  )
})

// action priority가 허용된 값이 아니면 AI 응답을 거부하는지 확인
test("rejects invalid action priority", () => {
  assert.throws(
    () => validateAiPredictionResponse({
      ...validResponse(),
      recommendedActions: [{
        title: "check files",
        description: "shared.ts 확인",
        priority: "urgent"
      }]
    }),
    /priority/
  )
})

// optional 배열 field가 누락되거나 null이면 빈 배열로 보정되는지 확인
test("defaults nullish optional arrays", () => {
  const prediction = validateAiPredictionResponse({
    branchName: "feature/watch",
    baseBranch: "main",
    prediction: "shared module 변경 의도가 겹쳐 rebase 우선 확인이 필요함",
    confidence: 82,
    recommendedActions: null
  })

  assert.deepEqual(prediction.recommendedActions, [])
  assert.deepEqual(prediction.falsePositiveNotes, [])
})

// optional 배열 field가 배열이 아닌 값이면 AI 응답을 거부하는지 확인
test("rejects non-array optional arrays", () => {
  assert.throws(
    () => validateAiPredictionResponse({
      ...validResponse(),
      falsePositiveNotes: "none"
    }),
    /falsePositiveNotes/
  )
})

// action files가 null이면 optional field 없음으로 처리하는지 확인
test("defaults null action files", () => {
  const prediction = validateAiPredictionResponse({
    ...validResponse(),
    recommendedActions: [{
      title: "check files",
      description: "shared.ts 확인",
      priority: "medium",
      files: null
    }]
  })

  assert.equal(prediction.recommendedActions[0]?.files, undefined)
})

// files가 있으면 string 배열이어야 하는지 확인
test("rejects non-string action files", () => {
  assert.throws(
    () => validateAiPredictionResponse({
      ...validResponse(),
      recommendedActions: [{
        title: "check files",
        description: "shared.ts 확인",
        priority: "medium",
        files: ["src/shared.ts", 10]
      }]
    }),
    /files\[1\]/
  )
})

function validResponse(branchName = "feature/watch"): Record<string, unknown> {
  return {
    branchName,
    baseBranch: "main",
    prediction: "shared module 변경 의도가 겹쳐 rebase 우선 확인이 필요함",
    confidence: 82,
    recommendedActions: [{
      title: "base branch rebase",
      description: "shared.ts 변경을 먼저 rebase해 실제 conflict 여부를 확인함",
      priority: "high",
      files: ["src/shared.ts"]
    }],
    falsePositiveNotes: []
  }
}
