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
    recommendedActions: [{
      title: "base branch rebase",
      description: "shared.ts 변경을 먼저 rebase해 실제 conflict 여부를 확인함",
      priority: "high",
      files: ["src/shared.ts"]
    }]
  })

  assert.equal(prediction.branchName, "feature/watch")
  assert.equal(prediction.recommendedActions[0]?.priority, "high")
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

// batch prediction 일부가 잘못되어도 유효한 prediction은 유지되는지 확인
test("keeps valid predictions when batch contains invalid item", () => {
  const predictions = validateAiPredictionBatchResponse({
    predictions: [
      validResponse("feature/a"),
      {
        branchName: "feature/b",
        baseBranch: "main",
        prediction: "shared module 변경 의도가 겹쳐 rebase 우선 확인이 필요함",
        recommendedActions: [{
          title: "base branch rebase",
          description: "shared.ts 변경을 먼저 rebase해 실제 conflict 여부를 확인함",
          priority: "urgent"
        }]
      }
    ]
  })

  assert.deepEqual(predictions.map(prediction => prediction.branchName), ["feature/a"])
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

// recommendedActions가 누락되거나 null이면 빈 배열로 보정되는지 확인
test("defaults nullish recommended actions", () => {
  const prediction = validateAiPredictionResponse({
    branchName: "feature/watch",
    baseBranch: "main",
    prediction: "shared module 변경 의도가 겹쳐 rebase 우선 확인이 필요함",
    recommendedActions: null
  })

  assert.deepEqual(prediction.recommendedActions, [])
})

// recommendedActions가 배열이 아닌 값이면 AI 응답을 거부하는지 확인
test("rejects non-array recommended actions", () => {
  assert.throws(
    () => validateAiPredictionResponse({
      ...validResponse(),
      recommendedActions: "none"
    }),
    /recommendedActions/
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
    recommendedActions: [{
      title: "base branch rebase",
      description: "shared.ts 변경을 먼저 rebase해 실제 conflict 여부를 확인함",
      priority: "high",
      files: ["src/shared.ts"]
    }]
  }
}
