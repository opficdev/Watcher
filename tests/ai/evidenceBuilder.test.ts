import test from "node:test"
import assert from "node:assert/strict"
import {
  buildAiPredictionEvidencePayload,
  type BranchContext,
  type BranchRisk,
  type BranchRiskAnalysisInput,
  type GitMergeSignal
} from "../../src/index.js"

// deterministic possibility와 branch 분석 입력을 AI prediction evidence로 결합하는지 확인
test("builds ai prediction evidence payload", () => {
  const input = analysisInput("feature/watch", [{
    filePath: "src/shared.ts",
    startLine: 12,
    endLine: 24
  }])
  const evidence = buildAiPredictionEvidencePayload(input, possibility("feature/watch"))

  assert.equal(evidence.branch.name, "feature/watch")
  assert.equal(evidence.possibility.score, 55)
  assert.equal(evidence.gitSignal.changedFiles[0], "src/shared.ts")
  assert.equal(evidence.changedHunks[0]?.filePath, "src/shared.ts")
})

// changedHunks가 없는 branch도 빈 배열 evidence로 안정적으로 변환되는지 확인
test("uses empty changed hunks when input has no hunks", () => {
  const evidence = buildAiPredictionEvidencePayload(
    analysisInput("feature/watch"),
    possibility("feature/watch")
  )

  assert.deepEqual(evidence.changedHunks, [])
})

// 다른 branch의 possibility가 섞이면 AI prediction 근거 오염을 막는지 확인
test("rejects mismatched branch possibility", () => {
  assert.throws(
    () => buildAiPredictionEvidencePayload(
      analysisInput("feature/watch"),
      possibility("feature/other")
    ),
    /matching branch possibility/
  )
})

function analysisInput(
  branchName: string,
  changedHunks: BranchRiskAnalysisInput["changedHunks"] = undefined
): BranchRiskAnalysisInput {
  const context = branch(branchName)

  return {
    branch: context,
    gitSignal: gitSignal(branchName),
    changedHunks
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

function gitSignal(branchName: string): GitMergeSignal {
  return {
    status: "clean",
    baseBranch: "main",
    branchName,
    changedFiles: ["src/shared.ts"],
    conflictFiles: []
  }
}

function possibility(branchName: string): BranchRisk {
  return {
    branchName,
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
