import test from "node:test"
import assert from "node:assert/strict"
import {
  predictBranchPairsWithAi,
  type AiCleanOverlapResponse,
  type AiConfirmedConflictResponse,
  type AiPredictionClient,
  type AiPredictionPairEvidencePayload,
  type AiPredictionPairDebugObserver,
  type AiPredictionPairFailureDebugEvent,
  type AiPredictionPairPromptDebugEvent,
  type AiPredictionPairResponseDebugEvent,
  type AiPredictionPairTargetStatus,
  type AiPredictionPrompt,
  type BranchComparisonPair
} from "../../src/index.js"

// branch 조합마다 provider를 한 번 호출하고 입력 순서로 결과 반환
test("predicts branch pairs sequentially in input order", async () => {
  const inputs = [
    payload("feature/a", "feature/b", "confirmed_conflict"),
    payload("feature/c", "feature/d", "potential_overlap")
  ]
  const snapshot = JSON.stringify(inputs)
  const client = new AiPredictionClientSpy()

  const results = await predictBranchPairsWithAi(inputs, client)

  assert.deepEqual(results.map(result => result.status), ["predicted", "predicted"])
  assert.deepEqual(results.map(result => result.pair), inputs.map(input => input.pair))
  assert.deepEqual(client.prompts.map(prompt => prompt.responseShape), [
    "predictionPairConfirmedConflict",
    "predictionPairCleanOverlap"
  ])
  assert.equal(JSON.stringify(inputs), snapshot)
})

// 한 조합의 provider 실패 후 다음 조합을 계속 처리
test("isolates provider failure to one branch pair", async () => {
  const inputs = [
    payload("feature/a", "feature/b", "confirmed_conflict"),
    payload("feature/c", "feature/d", "potential_overlap")
  ]
  const client = new AiPredictionClientSpy([
    new Error("provider failed"),
    cleanOverlapResponse(inputs[1]!.pair)
  ])

  const results = await predictBranchPairsWithAi(inputs, client)

  assert.deepEqual(results.map(result => result.status), ["failed", "predicted"])
  assert.match(
    results[0]?.status === "failed" ? results[0].errorMessage : "",
    /provider failed/
  )
  assert.equal(client.prompts.length, 2)
})

// 한 조합의 validation 실패 후 유효한 다음 응답 유지
test("isolates validation failure to one branch pair", async () => {
  const inputs = [
    payload("feature/a", "feature/b", "confirmed_conflict"),
    payload("feature/c", "feature/d", "potential_overlap")
  ]
  const client = new AiPredictionClientSpy([
    cleanOverlapResponse(inputs[0]!.pair),
    cleanOverlapResponse(inputs[1]!.pair)
  ])

  const results = await predictBranchPairsWithAi(inputs, client)

  assert.deepEqual(results.map(result => result.status), ["failed", "predicted"])
  assert.match(
    results[0]?.status === "failed" ? results[0].errorMessage : "",
    /must be confirmed_conflict/
  )
})

// 모든 provider 호출이 실패해도 조합별 failed 결과를 반환
test("returns failed result for every pair when provider is unavailable", async () => {
  const inputs = [
    payload("feature/a", "feature/b", "confirmed_conflict"),
    payload("feature/c", "feature/d", "potential_overlap")
  ]
  const client = new AiPredictionClientSpy([
    new Error("provider unavailable"),
    new Error("provider unavailable")
  ])

  const results = await predictBranchPairsWithAi(inputs, client)

  assert.deepEqual(results.map(result => result.status), ["failed", "failed"])
  assert.equal(client.prompts.length, 2)
})

// pair별 prompt와 response를 ordered targetPair metadata와 함께 통지
test("notifies pair debug observer with prompt and response", async () => {
  const input = payload("feature/a", "feature/b", "potential_overlap")
  const observer = new AiPredictionPairDebugObserverSpy()

  const results = await predictBranchPairsWithAi(
    [input],
    new AiPredictionClientSpy(),
    { debugObserver: observer }
  )

  assert.equal(results[0]?.status, "predicted")
  assert.deepEqual(observer.promptEvents.map(event => event.targetPair), [input.pair])
  assert.deepEqual(observer.responseEvents.map(event => event.targetPair), [input.pair])
  assert.equal(observer.promptEvents[0]?.prompt.responseShape, "predictionPairCleanOverlap")
  assert.deepEqual(observer.responseEvents[0]?.response, cleanOverlapResponse(input.pair))
  assert.deepEqual(observer.failureEvents, [])
})

// provider와 response validation 실패를 pair별 failure event로 통지
test("notifies pair debug observer when prediction fails", async () => {
  const providerInput = payload("feature/a", "feature/b", "potential_overlap")
  const validationInput = payload("feature/c", "feature/d", "confirmed_conflict")
  const observer = new AiPredictionPairDebugObserverSpy()
  const client = new AiPredictionClientSpy([
    new Error("provider failed"),
    cleanOverlapResponse(validationInput.pair)
  ])

  const results = await predictBranchPairsWithAi(
    [providerInput, validationInput],
    client,
    { debugObserver: observer }
  )

  assert.deepEqual(results.map(result => result.status), ["failed", "failed"])
  assert.deepEqual(observer.failureEvents.map(event => event.targetPair), [
    providerInput.pair,
    validationInput.pair
  ])
  assert.match(observer.failureEvents[0]?.errorMessage ?? "", /provider failed/)
  assert.match(
    observer.failureEvents[1]?.errorMessage ?? "",
    /must be confirmed_conflict/
  )
})

// debug observer 실패가 provider 결과와 다음 pair 실행을 중단하지 않도록 격리
test("continues pair prediction when debug observer throws", async () => {
  const inputs = [
    payload("feature/a", "feature/b", "potential_overlap"),
    payload("feature/c", "feature/d", "confirmed_conflict")
  ]
  const observer: AiPredictionPairDebugObserver = {
    onPromptBuilt: () => {
      throw new Error("prompt observer failed")
    },
    onResponseReceived: () => {
      throw new Error("response observer failed")
    },
    onPredictionFailed: () => {
      throw new Error("failure observer failed")
    }
  }
  const client = new AiPredictionClientSpy([
    cleanOverlapResponse(inputs[0]!.pair),
    new Error("provider failed")
  ])

  const results = await predictBranchPairsWithAi(inputs, client, {
    debugObserver: observer
  })

  assert.deepEqual(results.map(result => result.status), ["predicted", "failed"])
  assert.equal(client.prompts.length, 2)
})

class AiPredictionPairDebugObserverSpy implements AiPredictionPairDebugObserver {
  promptEvents: AiPredictionPairPromptDebugEvent[] = []
  responseEvents: AiPredictionPairResponseDebugEvent[] = []
  failureEvents: AiPredictionPairFailureDebugEvent[] = []

  onPromptBuilt(event: AiPredictionPairPromptDebugEvent): void {
    this.promptEvents.push(event)
  }

  onResponseReceived(event: AiPredictionPairResponseDebugEvent): void {
    this.responseEvents.push(event)
  }

  onPredictionFailed(event: AiPredictionPairFailureDebugEvent): void {
    this.failureEvents.push(event)
  }
}

class AiPredictionClientSpy implements AiPredictionClient {
  prompts: AiPredictionPrompt[] = []
  private responseIndex = 0

  constructor(private readonly responses: Array<unknown | Error> = []) {}

  async predict(prompt: AiPredictionPrompt): Promise<unknown> {
    this.prompts.push(prompt)
    const configured = this.responses[this.responseIndex]
    this.responseIndex += 1

    if (configured instanceof Error) {
      throw configured
    }

    return configured ?? responseFor(prompt)
  }
}

function responseFor(prompt: AiPredictionPrompt): unknown {
  const input = JSON.parse(prompt.userPrompt) as AiPredictionPairEvidencePayload

  return prompt.responseShape === "predictionPairConfirmedConflict"
    ? confirmedConflictResponse(input.pair)
    : cleanOverlapResponse(input.pair)
}

function confirmedConflictResponse(
  pair: BranchComparisonPair
): AiConfirmedConflictResponse {
  return {
    kind: "confirmed_conflict",
    pair,
    conflictCause: {
      summary: "두 branch가 같은 조건문을 다르게 수정함",
      files: ["src/shared.ts"]
    },
    integrationOrder: {
      strategy: "rebase",
      firstBranchName: pair.leftBranchName,
      secondBranchName: pair.rightBranchName,
      reason: "구조 변경을 먼저 반영해야 함",
      steps: ["첫 branch 반영", "두 번째 branch rebase"]
    },
    patches: [{
      filePath: "src/shared.ts",
      patch: "@@ -1 +1 @@\n-old\n+new",
      reason: "두 변경 의도를 함께 보존함"
    }]
  }
}

function cleanOverlapResponse(
  pair: BranchComparisonPair
): AiCleanOverlapResponse {
  return {
    kind: "clean_overlap",
    pair,
    overlapCause: {
      summary: "같은 함수의 인접한 조건을 수정함",
      files: ["src/shared.ts"]
    },
    integrationOrder: {
      strategy: "merge",
      firstBranchName: pair.leftBranchName,
      secondBranchName: pair.rightBranchName,
      reason: "첫 변경 이후 통합 동작을 확인함",
      steps: ["첫 branch merge", "두 번째 branch 갱신"]
    },
    preventiveActions: [{
      title: "통합 동작 테스트",
      description: "두 조건이 함께 실행되는 경우를 확인함",
      files: ["src/shared.ts"]
    }]
  }
}

function payload(
  leftBranchName: string,
  rightBranchName: string,
  targetStatus: AiPredictionPairTargetStatus
): AiPredictionPairEvidencePayload {
  const confirmedConflict = targetStatus === "confirmed_conflict"

  return {
    pair: {
      leftBranchName,
      rightBranchName
    },
    targetStatus,
    reasons: [{
      code: confirmedConflict ? "confirmed_conflict" : "same_hunk_overlap",
      files: ["src/shared.ts"]
    }],
    branches: {
      left: {
        name: leftBranchName,
        commitOid: "a".repeat(40)
      },
      right: {
        name: rightBranchName,
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
