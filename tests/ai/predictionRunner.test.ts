import test from "node:test"
import assert from "node:assert/strict"
import {
  predictMergeRisksWithAi,
  type AiPredictionClient,
  type AiPredictionEvidencePayload,
  type AiPredictionPrompt,
  type BranchContext,
  type BranchRisk,
  type GitMergeSignal
} from "../../src/index.js"

// threshold 이상 branch만 AI client로 prediction을 요청하는지 확인
test("predicts selected merge risk payloads", async () => {
  const client = new AiPredictionClientSpy()
  const results = await predictMergeRisksWithAi([
    payload("feature/low", 20),
    payload("feature/high", 55)
  ], client)

  assert.deepEqual(results.map(result => result.status), ["skipped", "predicted"])
  assert.equal(client.prompts.length, 1)
  const predicted = results[1]
  assert.equal(
    predicted?.status === "predicted" ? predicted.prediction.branchName : undefined,
    "feature/high"
  )
})

// custom threshold를 runner 옵션으로 전달할 수 있는지 확인
test("uses custom prediction threshold", async () => {
  const client = new AiPredictionClientSpy()
  const results = await predictMergeRisksWithAi([
    payload("feature/high", 55),
    payload("feature/critical", 100)
  ], client, {
    minimumScore: 80
  })

  assert.deepEqual(results.map(result => result.status), ["skipped", "predicted"])
  assert.equal(client.prompts.length, 1)
  const predicted = results[1]
  assert.equal(
    predicted?.status === "predicted" ? predicted.prediction.branchName : undefined,
    "feature/critical"
  )
})

// 선택된 branch prediction들이 서로 기다리지 않고 병렬로 시작되는지 확인
test("starts selected predictions in parallel", async () => {
  const client = new DeferredAiPredictionClient()
  const running = predictMergeRisksWithAi([
    payload("feature/a", 55),
    payload("feature/b", 80)
  ], client)

  await client.waitForPrompts(2)
  assert.equal(client.prompts.length, 2)

  client.resolveAll()
  const results = await running
  assert.deepEqual(results.map(result => result.status), ["predicted", "predicted"])
})

// AI client 오류가 전체 실행 실패가 아니라 branch 단위 failed 결과로 기록되는지 확인
test("records failed result when client throws", async () => {
  const client = new AiPredictionClientSpy(new Error("provider failed"))
  const [result] = await predictMergeRisksWithAi([
    payload("feature/high", 55)
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
    payload("feature/high", 55)
  ], client)

  assert.equal(result?.status, "failed")
  assert.match(result?.status === "failed" ? result.errorMessage : "", /confidence/)
})

// prompt builder 옵션이 runner를 통해 AI client까지 전달되는지 확인
test("passes custom system prompt to client", async () => {
  const client = new AiPredictionClientSpy()
  await predictMergeRisksWithAi([
    payload("feature/high", 55)
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

  resolveAll(): void {
    for (const pending of this.pending.splice(0)) {
      pending.resolve(validResponse(branchNameFrom(pending.prompt)))
    }
  }
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
  score: number
): AiPredictionEvidencePayload {
  return {
    branch: branch(branchName),
    possibility: possibility(branchName, score),
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
  score: number
): BranchRisk {
  return {
    branchName,
    baseBranch: "main",
    score,
    status: "high",
    reasons: [{
      code: "same_hunk_overlap",
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
