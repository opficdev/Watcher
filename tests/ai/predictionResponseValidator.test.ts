import test from "node:test"
import assert from "node:assert/strict"
import { validateAiPredictionResponse } from "../../src/index.js"

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

// falsePositiveNotes가 배열이 아니면 AI 응답을 거부하는지 확인
test("rejects non-array false positive notes", () => {
  assert.throws(
    () => validateAiPredictionResponse({
      ...validResponse(),
      falsePositiveNotes: "none"
    }),
    /falsePositiveNotes/
  )
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

function validResponse(): Record<string, unknown> {
  return {
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
    falsePositiveNotes: []
  }
}
