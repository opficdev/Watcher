import type {
  BranchComparisonPair
} from "../branches/types.js"
import type {
  GitMergeSignalStatus,
  GitMergeTreeConflict,
  MergeCodeContextEvidence
} from "../git/types.js"
import type {
  BranchConflictGraphEdgeReason,
  BranchConflictGraphEdgeStatus
} from "../risks/types.js"

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

// branch 조합 prompt 생성 시점의 ordered pair와 prompt 정보
export type AiPredictionPairPromptDebugEvent = {
  targetPair: BranchComparisonPair
  prompt: AiPredictionPrompt
}

// branch 조합 provider response 수신 시점의 ordered pair와 원본 응답
export type AiPredictionPairResponseDebugEvent = {
  targetPair: BranchComparisonPair
  response: unknown
}

// branch 조합 provider 호출 또는 응답 검증 실패 정보
export type AiPredictionPairFailureDebugEvent = {
  targetPair: BranchComparisonPair
  errorMessage: string
}

// branch 조합 AI 실행 단계별 debug event를 받는 observer
export type AiPredictionPairDebugObserver = {
  onPromptBuilt?(event: AiPredictionPairPromptDebugEvent): void | Promise<void>
  onResponseReceived?(event: AiPredictionPairResponseDebugEvent): void | Promise<void>
  onPredictionFailed?(event: AiPredictionPairFailureDebugEvent): void | Promise<void>
}

// AI provider에 전달할 system/user prompt 묶음
export type AiPredictionPrompt = {
  systemPrompt: string
  userPrompt: string
  responseShape: AiPredictionPromptResponseShape
}

// provider가 structured output schema를 고를 때 사용할 응답 형태
export type AiPredictionPromptResponseShape =
  | "predictionPairConfirmedConflict"
  | "predictionPairCleanOverlap"

// prompt 호출자가 provider나 실행 환경에 맞게 system prompt를 교체하기 위한 설정
export type AiPredictionPromptBuildOptions = {
  systemPrompt?: string
}

// branch 조합 prompt와 debug observer를 함께 조정하기 위한 실행 설정
export type AiPredictionPairRunOptions = AiPredictionPromptBuildOptions & {
  debugObserver?: AiPredictionPairDebugObserver
}

// provider별 AI 호출 구현이 맞춰야 하는 최소 interface
export type AiPredictionClient = {
  predict(prompt: AiPredictionPrompt): Promise<unknown>
}
