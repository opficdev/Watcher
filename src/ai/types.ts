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

// AI provider에 전달할 system/user prompt 묶음
export type AiPredictionPrompt = {
  systemPrompt: string
  userPrompt: string
  responseShape?: AiPredictionPromptResponseShape
}

// provider가 structured output schema를 고를 때 사용할 응답 형태
export type AiPredictionPromptResponseShape =
  | "prediction"
  | "predictionBatch"

// prompt 호출자가 provider나 실행 환경에 맞게 system prompt를 교체하기 위한 설정
export type AiPredictionPromptBuildOptions = {
  systemPrompt?: string
}

// provider별 AI 호출 구현이 맞춰야 하는 최소 interface
export type AiPredictionClient = {
  predict(prompt: AiPredictionPrompt): Promise<unknown>
}

// AI prediction runner가 prompt 생성을 조정하기 위한 설정
export type AiPredictionRunOptions = AiPredictionPromptBuildOptions

// branch별 AI prediction 실행 결과
export type AiPredictionResult =
  | AiPredictionPredictedResult
  | AiPredictionSkippedResult
  | AiPredictionFailedResult

export type AiPredictionPredictedResult = {
  status: "predicted"
  branchName: string
  baseBranch: string
  prediction: AiPrediction
}

export type AiPredictionSkippedResult = {
  status: "skipped"
  branchName: string
  baseBranch: string
  reason: "not_target" | "confirmed_conflict"
}

export type AiPredictionFailedResult = {
  status: "failed"
  branchName: string
  baseBranch: string
  errorMessage: string
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
