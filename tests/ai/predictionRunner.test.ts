import test from "node:test"
import assert from "node:assert/strict"
import {
  BranchRiskStatus,
  predictMergeRisksWithAi,
  type AiPredictionClient,
  type AiPredictionEvidencePayload,
  type AiPredictionPrompt,
  type BranchContext,
  type BranchRisk,
  type BranchRiskReasonCode,
  type GitMergeSignal
} from "../../src/index.js"

// critical branch만 한 번의 batch AI client 호출로 prediction을 요청하는지 확인
test("predicts selected critical merge risk payloads", async () => {
  const client = new AiPredictionClientSpy()
  const results = await predictMergeRisksWithAi([
    payload("feature/high", 55, BranchRiskStatus.High),
    payload("feature/critical", 100, BranchRiskStatus.Critical)
  ], client)

  assert.deepEqual(results.map(result => result.status), ["skipped", "predicted"])
  assert.equal(client.prompts.length, 1)
  assert.equal(client.prompts[0]?.responseShape, "predictionBatch")
  const predicted = results[1]
  assert.equal(
    predicted?.status === "predicted" ? predicted.prediction.branchName : undefined,
    "feature/critical"
  )
})

// score가 높아도 critical status가 아니면 AI prediction을 생략하는지 확인
test("skips non-critical payloads", async () => {
  const client = new AiPredictionClientSpy()
  const results = await predictMergeRisksWithAi([
    payload("feature/high", 90, BranchRiskStatus.High)
  ], client)

  assert.deepEqual(results.map(result => result.status), ["skipped"])
  assert.equal(results[0]?.status === "skipped" ? results[0].reason : undefined, "not_target")
  assert.equal(client.prompts.length, 0)
})

// 이미 Git conflict가 확정된 branch는 AI prediction을 생략하고 확정 충돌 사유를 기록하는지 확인
test("records confirmed conflict skip reason", async () => {
  const client = new AiPredictionClientSpy()
  const [result] = await predictMergeRisksWithAi([
    payload("feature/conflict", 100, BranchRiskStatus.Critical, "confirmed_conflict")
  ], client)

  assert.equal(result?.status, "skipped")
  assert.equal(result?.status === "skipped" ? result.reason : undefined, "confirmed_conflict")
  assert.equal(client.prompts.length, 0)
})

// 여러 critical branch를 한 번의 AI 응답으로 다시 branch별 결과에 매칭하는지 확인
test("maps batch prediction response to selected payload order", async () => {
  const client = new AiPredictionClientSpy({
    predictions: [
      validResponse("feature/b"),
      validResponse("feature/a")
    ]
  })
  const results = await predictMergeRisksWithAi([
    payload("feature/a", 100, BranchRiskStatus.Critical),
    payload("feature/b", 100, BranchRiskStatus.Critical)
  ], client)

  assert.deepEqual(results.map(result => result.status), ["predicted", "predicted"])
  assert.equal(
    results[0]?.status === "predicted" ? results[0].prediction.branchName : undefined,
    "feature/a"
  )
  assert.equal(
    results[1]?.status === "predicted" ? results[1].prediction.branchName : undefined,
    "feature/b"
  )
  assert.equal(client.prompts.length, 1)
})

// AI client 오류가 전체 실행 실패가 아니라 선택된 branch 단위 failed 결과로 기록되는지 확인
test("records failed result when client throws", async () => {
  const client = new AiPredictionClientSpy(new Error("provider failed"))
  const results = await predictMergeRisksWithAi([
    payload("feature/a", 100, BranchRiskStatus.Critical),
    payload("feature/b", 100, BranchRiskStatus.Critical)
  ], client)

  assert.deepEqual(results.map(result => result.status), ["failed", "failed"])
  assert.match(results[0]?.status === "failed" ? results[0].errorMessage : "", /provider failed/)
  assert.match(results[1]?.status === "failed" ? results[1].errorMessage : "", /provider failed/)
})

// schema validation 실패가 branch 단위 failed 결과로 기록되는지 확인
test("records failed result when response is invalid", async () => {
  const client = new AiPredictionClientSpy({
    predictions: [{
      branchName: "feature/critical",
      baseBranch: "main",
      prediction: "invalid confidence",
      confidence: 120,
      recommendedActions: [],
      falsePositiveNotes: []
    }]
  })
  const [result] = await predictMergeRisksWithAi([
    payload("feature/critical", 100, BranchRiskStatus.Critical)
  ], client)

  assert.equal(result?.status, "failed")
  assert.match(result?.status === "failed" ? result.errorMessage : "", /AI prediction response is missing/)
})

// batch 응답 중 일부만 검증에 실패하면 해당 branch만 failed 처리하는지 확인
test("keeps valid batch predictions when one response item is invalid", async () => {
  const client = new AiPredictionClientSpy({
    predictions: [
      validResponse("feature/a"),
      {
        ...(validResponse("feature/b") as Record<string, unknown>),
        confidence: 120
      }
    ]
  })
  const results = await predictMergeRisksWithAi([
    payload("feature/a", 100, BranchRiskStatus.Critical),
    payload("feature/b", 100, BranchRiskStatus.Critical)
  ], client)

  assert.equal(results[0]?.status, "predicted")
  assert.equal(results[1]?.status, "failed")
  assert.match(results[1]?.status === "failed" ? results[1].errorMessage : "", /AI prediction response is missing/)
})

// prompt builder 옵션이 runner를 통해 AI client까지 전달되는지 확인
test("passes custom system prompt to client", async () => {
  const client = new AiPredictionClientSpy()
  await predictMergeRisksWithAi([
    payload("feature/critical", 100, BranchRiskStatus.Critical)
  ], client, {
    systemPrompt: "Return compact JSON."
  })

  assert.equal(client.prompts[0]?.systemPrompt, "Return compact JSON.")
})

class AiPredictionClientSpy implements AiPredictionClient {
  prompts: AiPredictionPrompt[] = []

  constructor(private readonly response?: unknown) {}

  async predict(prompt: AiPredictionPrompt): Promise<unknown> {
    this.prompts.push(prompt)

    if (this.response instanceof Error) {
      throw this.response
    }

    return this.response ?? validBatchResponse(branchNamesFrom(prompt))
  }
}

function branchNamesFrom(prompt: AiPredictionPrompt): string[] {
  const evidence = JSON.parse(prompt.userPrompt) as {
    branches: Array<{
      branch: {
        name: string
      }
    }>
  }

  return evidence.branches.map(branch => branch.branch.name)
}

function payload(
  branchName: string,
  score: number,
  status: BranchRiskStatus,
  reasonCode: BranchRiskReasonCode = "same_hunk_overlap"
): AiPredictionEvidencePayload {
  return {
    branch: branch(branchName),
    possibility: possibility(branchName, score, status, reasonCode),
    gitSignal: gitSignal(branchName),
    changedHunks: []
  }
}

function branch(name: string): BranchContext {
  return {
    baseBranch: "main",
    name,
    headSha: `${name}-sha`,
    checks: []
  }
}

function possibility(
  branchName: string,
  score: number,
  status: BranchRiskStatus,
  reasonCode: BranchRiskReasonCode
): BranchRisk {
  return {
    branchName,
    baseBranch: "main",
    score,
    status,
    reasons: [{
      code: reasonCode,
      message: "다른 branch와 같은 hunk를 수정함",
      scoreImpact: score
    }]
  }
}

function gitSignal(branchName: string): GitMergeSignal {
  return {
    status: "clean",
    baseBranch: "main",
    branchName,
    changedFiles: ["src/shared.ts"],
    conflictFiles: []
  }
}

function validBatchResponse(branchNames: string[]): unknown {
  return {
    predictions: branchNames.map(validResponse)
  }
}

function validResponse(branchName: string): unknown {
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
