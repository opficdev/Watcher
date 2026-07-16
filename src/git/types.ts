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
  leftCommitOid?: string
  rightCommitOid?: string
  mergedTreeOid?: string
  conflictFiles: string[]
  conflicts: GitMergeTreeConflict[]
  errorMessage?: string
  failureStage?: GitMergeTreeFailureStage
}

export type MergeCodeContextKind =
  | "confirmed_conflict"
  | "clean_hunk_overlap"

export type MergeCodeContextFileStatus =
  | "text"
  | "binary"
  | "deleted"
  | "missing"

export type MergeCodeContextLineRange = {
  startLine: number
  endLine: number
}

export type GitObjectSnippetRequest = {
  key: string
  objectOid: string
  filePath: string
  range: MergeCodeContextLineRange
}

export type MergeCodeContextSnippet = {
  status: MergeCodeContextFileStatus
  filePath: string
  content?: string
  startLine?: number
  endLine?: number
  truncated: boolean
}

export type MergeCodeContextCommitMetadata = {
  role: "base" | "left" | "right"
  branchName?: string
  oid: string
  author: string
  committedAt: string
  subject: string
}

export type MergeCodeContextEvidence = {
  pair: BranchComparisonPair
  kind: MergeCodeContextKind
  filePath: string
  mergeBaseOid: string
  mergedTreeOid: string
  baseCommit: MergeCodeContextCommitMetadata
  leftCommit: MergeCodeContextCommitMetadata
  rightCommit: MergeCodeContextCommitMetadata
  baseSnippet: MergeCodeContextSnippet
  leftSnippet: MergeCodeContextSnippet
  rightSnippet: MergeCodeContextSnippet
  mergedSnippet: MergeCodeContextSnippet
}

export type GitMergeCodeContextPairResult = {
  pair: BranchComparisonPair
  evidence: MergeCodeContextEvidence[]
  errorMessage?: string
}

export type GitDiffHunk = {
  oldStartLine: number
  oldLineCount: number
  newStartLine: number
  newLineCount: number
}

export type MergeCodeContextRegion = {
  filePath: string
  baseRange: MergeCodeContextLineRange
  leftRange: MergeCodeContextLineRange
  rightRange: MergeCodeContextLineRange
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
