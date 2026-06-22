import test from "node:test"
import assert from "node:assert/strict"
import {
  BranchRiskStatus,
  DEFAULT_AI_PREDICTION_TARGET_STATUS,
  selectAiPredictionTargets,
  type AiPredictionEvidencePayload,
  type BranchContext,
  type BranchRisk,
  type GitMergeSignal
} from "../../src/index.js"

// 기본 기준으로 critical possibility만 AI prediction 대상으로 선택하는지 확인
test("selects critical targets by default", () => {
  const selected = selectAiPredictionTargets([
    payload("feature/low", 20, BranchRiskStatus.Low),
    payload("feature/high", 55, BranchRiskStatus.High),
    payload("feature/critical", 100, DEFAULT_AI_PREDICTION_TARGET_STATUS)
  ])

  assert.deepEqual(selected.map(target => target.branch.name), ["feature/critical"])
})

// score가 높아도 critical status가 아니면 Gemini 호출 대상에서 제외되는지 확인
test("skips high score non-critical targets", () => {
  const selected = selectAiPredictionTargets([
    payload("feature/high", 90, BranchRiskStatus.High)
  ])

  assert.deepEqual(selected, [])
})

// critical status면 score 값과 별개로 AI prediction 대상에 포함되는지 확인
test("includes critical status targets", () => {
  const selected = selectAiPredictionTargets([
    payload("feature/critical", 80, BranchRiskStatus.Critical)
  ])

  assert.deepEqual(selected.map(target => target.branch.name), ["feature/critical"])
})

function payload(
  branchName: string,
  score: number,
  status: BranchRiskStatus
): AiPredictionEvidencePayload {
  return {
    branch: branch(branchName),
    possibility: possibility(branchName, score, status),
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
  status: BranchRiskStatus
): BranchRisk {
  return {
    branchName,
    baseBranch: "main",
    score,
    status,
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
