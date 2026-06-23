import test, { mock } from "node:test"
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

// critical branch만 AI client로 prediction을 요청하는지 확인
test("predicts selected critical merge risk payloads", async () => {
  const client = new AiPredictionClientSpy()
  const results = await predictMergeRisksWithAi([
    payload("feature/high", 55, BranchRiskStatus.High),
    payload("feature/critical", 100, BranchRiskStatus.Critical)
  ], client)

  assert.deepEqual(results.map(result => result.status), ["skipped", "predicted"])
  assert.equal(client.prompts.length, 1)
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

// Gemini 무료 등급의 일시 실패를 줄이기 위해 선택된 branch prediction을 순차 실행하는지 확인
test("runs selected predictions sequentially", async () => {
  mock.timers.enable({ apis: ["setTimeout"] })
  const client = new DeferredAiPredictionClient()

  try {
    const running = predictMergeRisksWithAi([
      payload("feature/a", 100, BranchRiskStatus.Critical),
      payload("feature/b", 100, BranchRiskStatus.Critical)
    ], client)

    await client.waitForPrompts(1)
    assert.equal(client.prompts.length, 1)

    client.resolveNext()
    await flushTasks()
    mock.timers.tick(60000)
    await flushTasks()
    assert.equal(client.prompts.length, 2)

    client.resolveNext()
    const results = await running
    assert.deepEqual(results.map(result => result.status), ["predicted", "predicted"])
  } finally {
    mock.timers.reset()
  }
})

// 선택된 AI 호출 사이에 내부 기본 간격을 두는지 확인
test("waits between selected predictions", async () => {
  mock.timers.enable({ apis: ["setTimeout"] })
  const client = new DeferredAiPredictionClient()

  try {
    const running = predictMergeRisksWithAi([
      payload("feature/a", 100, BranchRiskStatus.Critical),
      payload("feature/b", 100, BranchRiskStatus.Critical)
    ], client)

    await client.waitForPrompts(1)
    client.resolveNext()
    await flushTasks()

    mock.timers.tick(59999)
    await flushTasks()
    assert.equal(client.prompts.length, 1)

    mock.timers.tick(1)
    await flushTasks()
    assert.equal(client.prompts.length, 2)

    client.resolveNext()
    await running
    assert.equal(client.prompts.length, 2)
  } finally {
    mock.timers.reset()
  }
})

// AI client 오류가 전체 실행 실패가 아니라 branch 단위 failed 결과로 기록되는지 확인
test("records failed result when client throws", async () => {
  const client = new AiPredictionClientSpy(new Error("provider failed"))
  const [result] = await predictMergeRisksWithAi([
    payload("feature/critical", 100, BranchRiskStatus.Critical)
  ], client)

  assert.equal(result?.status, "failed")
  assert.match(result?.status === "failed" ? result.errorMessage : "", /provider failed/)
})

// schema validation 실패가 branch 단위 failed 결과로 기록되는지 확인
test("records failed result when response is invalid", async () => {
  const client = new AiPredictionClientSpy({
    branchName: "feature/high",
    baseBranch: "main",
    prediction: "invalid confidence",
    confidence: 120,
    recommendedActions: [],
    falsePositiveNotes: []
  })
  const [result] = await predictMergeRisksWithAi([
    payload("feature/critical", 100, BranchRiskStatus.Critical)
  ], client)

  assert.equal(result?.status, "failed")
  assert.match(result?.status === "failed" ? result.errorMessage : "", /confidence/)
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

    return this.response ?? validResponse(branchNameFrom(prompt))
  }
}

class DeferredAiPredictionClient implements AiPredictionClient {
  prompts: AiPredictionPrompt[] = []
  private promptWaiters: Array<() => void> = []
  private pending: Array<{
    prompt: AiPredictionPrompt
    resolve: (value: unknown) => void
  }> = []

  async predict(prompt: AiPredictionPrompt): Promise<unknown> {
    this.prompts.push(prompt)
    this.promptWaiters.splice(0).forEach(resolve => resolve())

    return new Promise(resolve => {
      this.pending.push({ prompt, resolve })
    })
  }

  async waitForPrompts(count: number): Promise<void> {
    while (this.prompts.length < count) {
      await new Promise<void>(resolve => {
        this.promptWaiters.push(resolve)
      })
    }
  }

  resolveNext(): void {
    const pending = this.pending.shift()

    if (!pending) {
      throw new Error("No pending AI prediction")
    }

    pending.resolve(validResponse(branchNameFrom(pending.prompt)))
  }
}

function flushTasks(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}

function branchNameFrom(prompt: AiPredictionPrompt): string {
  const evidence = JSON.parse(prompt.userPrompt) as {
    branch: {
      name: string
    }
  }

  return evidence.branch.name
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
