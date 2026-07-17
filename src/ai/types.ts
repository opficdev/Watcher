import type {
  BranchComparisonPair,
  BranchContext
} from "../branches/types.js"
import type {
  GitMergeSignal,
  GitMergeSignalStatus,
  GitMergeTreeConflict,
  MergeCodeContextEvidence
} from "../git/types.js"
import type {
  BranchChangedHunk,
  BranchConflictGraphEdgeReason,
  BranchConflictGraphEdgeStatus,
  BranchRisk
} from "../risks/types.js"

// AI prediction 생성에 사용할 deterministic 분석 근거 묶음
export type AiPredictionEvidencePayload = {
  branch: BranchContext
  possibility: BranchRisk
  gitSignal: GitMergeSignal
  changedHunks: BranchChangedHunk[]
}

// AI가 분석할 수 있는 확정 conflict와 critical potential overlap 상태
export type AiPredictionPairTargetStatus = Extract<
  BranchConflictGraphEdgeStatus,
  "confirmed_conflict" | "potential_overlap"
>

// AI evidence에 포함할 수 있는 성공한 merge 수집 상태
export type AiPredictionPairMergeStatus = Exclude<
  GitMergeSignalStatus,
  "merge_check_failed"
>

// branch 조합의 한쪽 branch 이름과 수집된 commit OID
export type AiPredictionPairBranchMetadata = {
  name: string
  commitOid?: string
}

// branch 조합 코드 문맥의 수집 결과 상태
export type AiPredictionPairCodeContextStatus =
  | "available"
  | "missing"
  | "failed"

// branch 조합에서 겹친 파일과 수집된 코드 문맥 또는 실패 정보
export type AiPredictionPairCodeContext = {
  status: AiPredictionPairCodeContextStatus
  overlapFiles: string[]
  evidence: MergeCodeContextEvidence[]
  // 조합 상한 안에 포함된 file과 hunk 수
  includedFileCount: number
  includedHunkCount: number
  // 조합 상한으로 누락된 file과 hunk 수
  omittedFileCount: number
  omittedHunkCount: number
  errorMessage?: string
}

// 위험한 branch 조합 하나에 속한 deterministic 상태와 코드 문맥 묶음
export type AiPredictionPairEvidencePayload = {
  pair: BranchComparisonPair
  targetStatus: AiPredictionPairTargetStatus
  reasons: BranchConflictGraphEdgeReason[]
  branches: {
    left: AiPredictionPairBranchMetadata
    right: AiPredictionPairBranchMetadata
  }
  merge: {
    status: AiPredictionPairMergeStatus
    mergedTreeOid?: string
    conflictFiles: string[]
    conflicts: GitMergeTreeConflict[]
  }
  codeContext: AiPredictionPairCodeContext
}

// branch 조합을 반영할 merge 또는 rebase 작업 순서
export type AiPredictionPairIntegrationOrder = {
  strategy: "merge" | "rebase"
  firstBranchName: string
  secondBranchName: string
  reason: string
  steps: string[]
}

// 확정 conflict를 해결하기 위한 파일별 patch 제안
export type AiPredictionPairPatch = {
  filePath: string
  patch: string
  reason: string
}

// clean overlap 이후 동작 회귀를 예방하기 위한 확인 항목
export type AiPredictionPairPreventiveAction = {
  title: string
  description: string
  files: string[]
}

// 확정 conflict 원인과 구체적인 해결 patch
export type AiConfirmedConflictResponse = {
  kind: "confirmed_conflict"
  pair: BranchComparisonPair
  conflictCause: {
    summary: string
    files: string[]
  }
  integrationOrder: AiPredictionPairIntegrationOrder
  patches: AiPredictionPairPatch[]
}

// 현재 merge 가능한 overlap의 예방 조치와 반영 순서
export type AiCleanOverlapResponse = {
  kind: "clean_overlap"
  pair: BranchComparisonPair
  overlapCause: {
    summary: string
    files: string[]
  }
  integrationOrder: AiPredictionPairIntegrationOrder
  preventiveActions: AiPredictionPairPreventiveAction[]
}

// branch 조합의 deterministic merge 상태에 맞는 AI 응답
export type AiPredictionPairResponse =
  | AiConfirmedConflictResponse
  | AiCleanOverlapResponse

// branch 조합 하나에 대한 AI 실행 결과
export type AiPredictionPairResult =
  | AiPredictionPairPredictedResult
  | AiPredictionPairFailedResult

export type AiPredictionPairPredictedResult = {
  status: "predicted"
  pair: BranchComparisonPair
  response: AiPredictionPairResponse
}

export type AiPredictionPairFailedResult = {
  status: "failed"
  pair: BranchComparisonPair
  errorMessage: string
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
  | "predictionPairConfirmedConflict"
  | "predictionPairCleanOverlap"

// prompt 호출자가 provider나 실행 환경에 맞게 system prompt를 교체하기 위한 설정
export type AiPredictionPromptBuildOptions = {
  systemPrompt?: string
}

// provider별 AI 호출 구현이 맞춰야 하는 최소 interface
export type AiPredictionClient = {
  predict(prompt: AiPredictionPrompt): Promise<unknown>
}

export type AiPredictionDebugTarget = {
  branchName: string
  baseBranch: string
}

export type AiPredictionPromptDebugEvent = {
  targetBranches: AiPredictionDebugTarget[]
  prompt: AiPredictionPrompt
}

export type AiPredictionResponseDebugEvent = {
  targetBranches: AiPredictionDebugTarget[]
  response: unknown
}

export type AiPredictionFailureDebugEvent = {
  targetBranches: AiPredictionDebugTarget[]
  errorMessage: string
}

export type AiPredictionDebugObserver = {
  onPromptBuilt?(event: AiPredictionPromptDebugEvent): void | Promise<void>
  onResponseReceived?(event: AiPredictionResponseDebugEvent): void | Promise<void>
  onPredictionFailed?(event: AiPredictionFailureDebugEvent): void | Promise<void>
}

// AI prediction runner가 prompt 생성과 debug 기록을 조정하기 위한 설정
export type AiPredictionRunOptions = AiPredictionPromptBuildOptions & {
  debugObserver?: AiPredictionDebugObserver
}

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
  recommendedActions: AiRecommendedAction[]
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
