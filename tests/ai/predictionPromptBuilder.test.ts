import test from "node:test"
import assert from "node:assert/strict"
import {
  DEFAULT_AI_PREDICTION_SYSTEM_PROMPT,
  buildAiPredictionPrompt,
  type AiPredictionEvidencePayload,
  type BranchContext,
  type BranchRisk,
  type GitMergeSignal
} from "../../src/index.js"

// AI prompt가 deterministic score를 덮어쓰지 말라는 계약을 포함하는지 확인
test("builds prompt that preserves deterministic possibility", () => {
  const prompt = buildAiPredictionPrompt(payload())

  assert.equal(prompt.systemPrompt, DEFAULT_AI_PREDICTION_SYSTEM_PROMPT)
  assert.match(prompt.systemPrompt, /Do not recalculate or overwrite/)
  assert.match(prompt.systemPrompt, /Do not describe the deterministic score as a probability/)
  assert.match(prompt.systemPrompt, /Avoid phrases such as guaranteed, will cause, or will result/)
  assert.match(prompt.systemPrompt, /Write prediction, recommended action titles, descriptions, and false positive notes in Korean/)
  assert.match(prompt.systemPrompt, /Return only JSON/)
  assert.match(prompt.systemPrompt, /Use 98 for high confidence, not 0\.98 or 1/)
  assert.match(prompt.systemPrompt, /recommendedActions/)
})

// user prompt가 raw diff 대신 정제된 evidence만 JSON으로 전달하는지 확인
test("builds user prompt with structured evidence", () => {
  const prompt = buildAiPredictionPrompt(payload())
  const evidence = JSON.parse(prompt.userPrompt) as Record<string, unknown>
  const branch = evidence.branch as Record<string, unknown>
  const possibility = evidence.deterministicPossibility as Record<string, unknown>
  const gitSignal = evidence.gitSignal as Record<string, unknown>
  const changedHunks = evidence.changedHunks as Record<string, unknown>[]

  assert.equal(branch.name, "feature/watch")
  assert.equal(branch.updatedAt, "2026-06-22T00:00:00.000Z")
  assert.equal(possibility.score, 55)
  assert.deepEqual(gitSignal.changedFiles, ["src/shared.ts"])
  assert.equal(changedHunks[0]?.filePath, "src/shared.ts")
})

// prompt 출력이 provider와 무관한 system/user 문자열로만 구성되는지 확인
test("keeps prompt provider agnostic", () => {
  const prompt = buildAiPredictionPrompt(payload())

  assert.equal(typeof prompt.systemPrompt, "string")
  assert.equal(typeof prompt.userPrompt, "string")
  assert.equal("model" in prompt, false)
})

// 실행 환경에 따라 system prompt를 교체할 수 있는지 확인
test("allows caller provided system prompt", () => {
  const prompt = buildAiPredictionPrompt(payload(), {
    systemPrompt: "Return only compact JSON."
  })

  assert.equal(prompt.systemPrompt, "Return only compact JSON.")
})

function payload(): AiPredictionEvidencePayload {
  return {
    branch: branch(),
    possibility: possibility(),
    gitSignal: gitSignal(),
    changedHunks: [{
      filePath: "src/shared.ts",
      startLine: 12,
      endLine: 24
    }]
  }
}

function branch(): BranchContext {
  return {
    baseBranch: "main",
    name: "feature/watch",
    headSha: "feature-watch-sha",
    author: "opfic",
    updatedAt: new Date("2026-06-22T00:00:00.000Z"),
    checks: [{
      name: "CI",
      status: "completed",
      conclusion: "failure"
    }],
    pullRequest: {
      number: 15,
      title: "AI prediction",
      url: "https://github.com/opficdev/Watcher/pull/15"
    }
  }
}

function possibility(): BranchRisk {
  return {
    branchName: "feature/watch",
    baseBranch: "main",
    score: 55,
    status: "high",
    reasons: [{
      code: "same_hunk_overlap",
      message: "다른 branch와 같은 hunk를 수정함",
      scoreImpact: 35,
      files: ["src/shared.ts"]
    }]
  }
}

function gitSignal(): GitMergeSignal {
  return {
    status: "clean",
    baseBranch: "main",
    branchName: "feature/watch",
    mergeBaseSha: "merge-base-sha",
    changedFiles: ["src/shared.ts"],
    conflictFiles: []
  }
}
