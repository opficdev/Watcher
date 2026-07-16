import type { BranchComparisonPair } from "../branches/types.js"

export type GitMergeSignalStatus =
  | "clean"
  | "confirmed_conflict"
  | "merge_check_failed"

export type GitMergeTreeConflict = {
  paths: string[]
  type: string
}

export type GitMergeTreePairResult = {
  pair: BranchComparisonPair
  status: GitMergeSignalStatus
  mergedTreeOid?: string
  conflictFiles: string[]
  conflicts: GitMergeTreeConflict[]
  errorMessage?: string
}

export type GitMergeSignal = {
  status: GitMergeSignalStatus
  baseBranch: string
  branchName: string
  mergeBaseSha?: string
  changedFiles: string[]
  conflictFiles: string[]
  errorMessage?: string
}

export type GitMergeSignalCollectionOptions = {
  repositoryPath: string
  remoteName?: string
  worktreeRoot?: string
}
