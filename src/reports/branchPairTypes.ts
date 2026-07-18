import type {
  AiPredictionPairResponse,
  AiPredictionPairResult
} from "../ai/types.js"
import type {
  BranchComparisonPair,
  BranchContext,
  ExcludedBranch
} from "../branches/types.js"
import type {
  GitMergeTreeConflict,
  GitMergeTreePairResult
} from "../git/types.js"
import type {
  BranchConflictGraph,
  BranchConflictGraphEdgeReason,
  BranchConflictGraphEdgeStatus
} from "../risks/types.js"

// branch 조합 report가 다루는 활성 branch 기간
export type BranchPairMergeRiskReportActivePeriod = {
  dayCount: number
  since: Date
  until: Date
}

// AI 실행 여부와 결과를 deterministic 조합 결과와 분리해 표현
export type BranchPairMergeRiskReportAiAnalysis =
  | {
    status: "predicted"
    response: AiPredictionPairResponse
  }
  | {
    status: "skipped"
    reason: "not_target"
  }
  | {
    status: "failed"
    errorMessage: string
  }

// 확정 conflict 또는 잠재 위험 조합의 report 항목
export type BranchPairMergeRiskReportPairItem = {
  pair: BranchComparisonPair
  status: Extract<
    BranchConflictGraphEdgeStatus,
    "confirmed_conflict" | "potential_overlap"
  >
  reasons: BranchConflictGraphEdgeReason[]
  conflicts: GitMergeTreeConflict[]
  leftCommitOid?: string
  rightCommitOid?: string
  aiAnalysis: BranchPairMergeRiskReportAiAnalysis
}

// 감시 branch 하나에 영향을 주는 위험 조합 집계
export type BranchPairMergeRiskReportBranchImpact = {
  branchName: string
  confirmedConflictPairs: BranchComparisonPair[]
  potentialRiskPairs: BranchComparisonPair[]
}

// report에 표시할 활성 기간 또는 개수 제한 제외 항목
export type BranchPairMergeRiskReportExcludedBranch = {
  name: string
  reason: Extract<ExcludedBranch["reason"], "stale_branch" | "branch_limit">
}

// 조합 분석에 실패한 branch와 실패 원인
export type BranchPairMergeRiskReportMergeError = {
  pair: BranchComparisonPair
  reasons: BranchConflictGraphEdgeReason[]
  errorMessage: string
}

// branch 조합 중심 merge risk report 전체 모델
export type BranchPairMergeRiskReport = {
  baseBranch: string
  generatedAt: Date
  activePeriod: BranchPairMergeRiskReportActivePeriod
  discoveredBranchCount: number
  watchedBranchCount: number
  comparisonPairCount: number
  confirmedConflicts: BranchPairMergeRiskReportPairItem[]
  potentialRisks: BranchPairMergeRiskReportPairItem[]
  branchImpacts: BranchPairMergeRiskReportBranchImpact[]
  cleanPairCount: number
  excludedBranches: BranchPairMergeRiskReportExcludedBranch[]
  mergeErrors: BranchPairMergeRiskReportMergeError[]
}

// report builder에 필요한 수집 결과와 branch 선택 정보
export type BranchPairMergeRiskReportInput = {
  generatedAt: Date
  activeBranchWindowDays: number
  discoveredBranchCount: number
  watchedBranches: BranchContext[]
  excludedBranches: ExcludedBranch[]
  graph: BranchConflictGraph
  mergeResults: GitMergeTreePairResult[]
  aiResults: AiPredictionPairResult[]
}
