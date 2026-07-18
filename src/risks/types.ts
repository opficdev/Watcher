import type {
  BranchComparisonPair
} from "../branches/types.js"

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

export type BranchConflictGraphNode = {
  branchName: string
  confirmedConflictCount: number
  potentialOverlapCount: number
  relatedBranchNames: string[]
}

export type BranchConflictGraph = {
  baseBranch: string
  nodes: BranchConflictGraphNode[]
  edges: BranchConflictGraphEdge[]
}
