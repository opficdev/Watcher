import type { BranchRisk, BranchRiskAnalysisInput } from "../risks/types.js"
import type { AiPredictionEvidencePayload } from "./types.js"

// deterministic possibility와 원본 분석 입력을 AI prediction용 evidence payload로 결합
export function build(
  input: BranchRiskAnalysisInput,
  possibility: BranchRisk
): AiPredictionEvidencePayload {
  assertMatchingBranch(input, possibility)

  return {
    branch: input.branch,
    possibility,
    gitSignal: input.gitSignal,
    changedHunks: input.changedHunks ?? []
  }
}

// 다른 branch의 possibility가 섞이면 AI prediction 근거가 오염되므로 명시적으로 차단
function assertMatchingBranch(
  input: BranchRiskAnalysisInput,
  possibility: BranchRisk
): void {
  if (input.branch.name !== possibility.branchName ||
      input.branch.baseBranch !== possibility.baseBranch) {
    throw new Error("AI prediction evidence must use matching branch possibility")
  }
}
