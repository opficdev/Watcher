export type GitMergeSignalStatus =
  | "clean"
  | "confirmed_conflict"
  | "merge_check_failed"

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
