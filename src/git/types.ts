import type {
  BranchComparisonPair,
  BranchComparisonRound
} from "../branches/types.js"

export type GitMergeSignalStatus =
  | "clean"
  | "confirmed_conflict"
  | "merge_check_failed"

export type GitMergeTreeConflict = {
  paths: string[]
  type: string
}

export type GitMergeTreeFailureStage = "preparation" | "merge"

export type GitMergeTreePairResult = {
  pair: BranchComparisonPair
  status: GitMergeSignalStatus
  mergedTreeOid?: string
  conflictFiles: string[]
  conflicts: GitMergeTreeConflict[]
  errorMessage?: string
  failureStage?: GitMergeTreeFailureStage
}

export type GitMergeTreeRoundCollectionOptions = {
  repositoryPath: string
  commitOidByBranch: ReadonlyMap<string, string>
  stderrLimit?: number
}

export type GitMergeTreeRoundCollector = (
  round: BranchComparisonRound,
  options: GitMergeTreeRoundCollectionOptions
) => Promise<GitMergeTreePairResult[]>

export type GitMergeTreeCollectionOptions = {
  repositoryPath: string
  remoteName?: string
  stderrLimit?: number
}

export type GitMergeTreeCollectorDependencies = {
  fetchRemoteBranches(repositoryPath: string, remote: string): Promise<void>
  resolveCommitOids(
    repositoryPath: string,
    remote: string,
    branchNames: string[]
  ): Promise<ReadonlyMap<string, string>>
  supportsMergeTreeStdin(repositoryPath: string): Promise<boolean>
  collectRound: GitMergeTreeRoundCollector
  availableParallelism(): number
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
