import test from "node:test"
import assert from "node:assert/strict"
import type {
  AiPrediction,
  AiPredictionEvidencePayload,
  BranchContext,
  BranchRisk,
  GitMergeSignal
} from "../../src/index.js"

// AI prediction이 deterministic possibility를 덮어쓰지 않고 별도 결과로 표현되는지 확인
test("models ai prediction separately from deterministic possibility", () => {
  const prediction: AiPrediction = {
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
  }

  assert.equal(prediction.branchName, "feature/watch")
  assert.equal(prediction.confidence, 82)
  assert.equal(prediction.recommendedActions[0]?.priority, "high")
})

// AI에 정제된 deterministic evidence payload를 전달할 수 있는지 확인
test("models ai prediction evidence payload", () => {
  const evidence: AiPredictionEvidencePayload = {
    branch: branch(),
    possibility: possibility(),
    gitSignal: gitSignal(),
    changedHunks: [{
      filePath: "src/shared.ts",
      startLine: 12,
      endLine: 24
    }]
  }

  assert.equal(evidence.possibility.score, 55)
  assert.equal(evidence.gitSignal.changedFiles[0], "src/shared.ts")
})

function branch(): BranchContext {
  return {
    baseBranch: "main",
    name: "feature/watch",
    headSha: "feature-watch-sha",
    checks: []
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
    changedFiles: ["src/shared.ts"],
    conflictFiles: []
  }
}
