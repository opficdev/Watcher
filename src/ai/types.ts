import type { BranchContext } from "../branches/types.js"
import type { GitMergeSignal } from "../git/types.js"
import type { BranchChangedHunk, BranchRisk } from "../risks/types.js"

// AI prediction 생성에 사용할 deterministic 분석 근거 묶음
export type AiPredictionEvidencePayload = {
  branch: BranchContext
  possibility: BranchRisk
  gitSignal: GitMergeSignal
  changedHunks: BranchChangedHunk[]
}

// AI prediction 비용을 줄이기 위해 deterministic score 기준으로 대상 branch를 제한하는 설정
export type AiPredictionTargetSelectionOptions = {
  minimumScore?: number
}

// AI가 deterministic possibility를 덮어쓰지 않고 추가로 제공하는 예측 결과
export type AiPrediction = {
  branchName: string
  baseBranch: string
  prediction: string
  confidence: number
  recommendedActions: AiRecommendedAction[]
  falsePositiveNotes: string[]
}

// AI가 제안하는 다음 action과 그 action이 필요한 근거
export type AiRecommendedAction = {
  title: string
  description: string
  priority: AiRecommendedActionPriority
  files?: string[]
}

// report에서 action 정렬과 표시 강도를 결정하기 위한 우선순위
export type AiRecommendedActionPriority =
  | "low"
  | "medium"
  | "high"
