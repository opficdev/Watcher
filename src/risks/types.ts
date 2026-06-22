import type { BranchContext } from "../branches/types.js"
import type { GitMergeSignal } from "../git/types.js"

export type BranchRiskStatus =
  | "low"
  | "medium"
  | "high"
  | "critical"

export type BranchRiskReasonCode =
  | "clean_merge"
  | "confirmed_conflict"
  | "merge_check_failed"
  | "same_file_overlap"
  | "same_hunk_overlap"
  | "failed_check"
  | "critical_file_changed"

export type BranchChangedHunk = {
  filePath: string
  startLine: number
  endLine: number
}

export type BranchRiskAnalysisInput = {
  branch: BranchContext
  gitSignal: GitMergeSignal
  changedHunks?: BranchChangedHunk[]
}

export type BranchRiskAnalysisOptions = {
  criticalFilePatterns?: string[]
}

export type BranchRiskReason = {
  code: BranchRiskReasonCode
  message: string
  scoreImpact: number
  files?: string[]
  branches?: string[]
  checks?: string[]
}

export type BranchRisk = {
  branchName: string
  baseBranch: string
  score: number
  status: BranchRiskStatus
  reasons: BranchRiskReason[]
}
