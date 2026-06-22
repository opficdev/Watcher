import test from "node:test"
import assert from "node:assert/strict"
import {
  selectAiPredictionTargets,
  type AiPredictionEvidencePayload,
  type BranchContext,
  type BranchRisk,
  type GitMergeSignal
} from "../../src/index.js"

// 기본 기준으로 medium 이상 score만 AI prediction 대상으로 선택하는지 확인
test("selects medium or higher score targets by default", () => {
  const selected = selectAiPredictionTargets([
    payload("feature/low", 20),
    payload("feature/medium", 25),
    payload("feature/high", 55)
  ])

  assert.deepEqual(selected.map(target => target.branch.name), [
    "feature/medium",
    "feature/high"
  ])
})

// caller가 지정한 minimumScore 기준으로 AI prediction 대상을 제한하는지 확인
test("selects targets with custom minimum score", () => {
  const selected = selectAiPredictionTargets([
    payload("feature/medium", 25),
    payload("feature/high", 55),
    payload("feature/critical", 100)
  ], {
    minimumScore: 80
  })

  assert.deepEqual(selected.map(target => target.branch.name), ["feature/critical"])
})

// threshold와 같은 score는 AI prediction 대상에 포함되는지 확인
test("includes targets at the minimum score boundary", () => {
  const selected = selectAiPredictionTargets([
    payload("feature/boundary", 50)
  ], {
    minimumScore: 50
  })

  assert.deepEqual(selected.map(target => target.branch.name), ["feature/boundary"])
})

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
    status: "medium",
    reasons: [{
      code: "merge_check_failed",
      message: "virtual merge 확인에 실패함",
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
