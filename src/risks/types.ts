import type {
  BranchComparisonPair,
  BranchContext
} from "../branches/types.js"
import type { GitMergeSignal } from "../git/types.js"

// report와 후속 action 추천에서 사용할 branch risk 단계
export const BranchRiskStatus = {
  Low: "low",
  Medium: "medium",
  High: "high",
  Critical: "critical"
} as const

export type BranchRiskStatus = typeof BranchRiskStatus[keyof typeof BranchRiskStatus]

// risk reason을 deterministic하게 분류하기 위한 rule code
export type BranchRiskReasonCode =
  | "clean_merge"
  | "confirmed_conflict"
  | "merge_check_failed"
  | "same_file_overlap"
  | "same_hunk_overlap"
  | "failed_check"
  | "critical_file_changed"

// 같은 파일 안에서 수정된 line range를 표현하는 Git diff hunk metadata
export type BranchChangedHunk = {
  filePath: string
  startLine: number
  endLine: number
}

// risk analyzer가 branch 하나를 평가할 때 필요한 입력 묶음
export type BranchRiskAnalysisInput = {
  branch: BranchContext
  gitSignal: GitMergeSignal
  changedHunks?: BranchChangedHunk[]
}

// repository별로 risk rule을 조정하기 위한 설정
export type BranchRiskAnalysisOptions = {
  criticalFilePatterns?: string[]
}

// score가 올라간 이유와 report에 보여줄 근거 metadata
export type BranchRiskReason = {
  code: BranchRiskReasonCode
  message: string
  scoreImpact: number
  files?: string[]
  branches?: string[]
  checks?: string[]
}

// branch 하나에 대한 최종 merge conflict 가능성 분석 결과
export type BranchRisk = {
  branchName: string
  baseBranch: string
  score: number
  status: BranchRiskStatus
  reasons: BranchRiskReason[]
}

export type BranchConflictGraphEdgeStatus =
  | "confirmed_conflict"
  | "error"
  | "potential_overlap"
  | "clean"

export type BranchConflictGraphEdgeReasonCode =
  | "confirmed_conflict"
  | "merge_check_failed"
  | "code_context_failed"
  | "same_hunk_overlap"
  | "same_file_overlap"
  | "clean_merge"

export type BranchConflictGraphEdgeReason = {
  code: BranchConflictGraphEdgeReasonCode
  files?: string[]
}

export type BranchConflictGraphEdge = {
  pair: BranchComparisonPair
  status: BranchConflictGraphEdgeStatus
  reasons: BranchConflictGraphEdgeReason[]
  errorMessage?: string
}
