export type BranchPullRequestMetadata = {
  number: number
  title: string
  url: string
  author?: string
}

export type BranchCheckMetadata = {
  name: string
  status: string
  conclusion?: string
}

export type RepositoryBranch = {
  name: string
  sha: string
  author?: string
  updatedAt?: Date
  checks?: BranchCheckMetadata[]
  pullRequest?: BranchPullRequestMetadata
}

export type BranchSelectionOptions = {
  baseBranch: string
  defaultBranch?: string
}

export type BranchExclusionReason =
  | "base_branch"
  | "default_branch"
  | "stale_branch"
  | "branch_limit"

export type ExcludedBranch = {
  name: string
  sha: string
  reason: BranchExclusionReason
}

export type BranchSelectionResult = {
  selected: BranchContext[]
  excluded: ExcludedBranch[]
}

export type BranchComparisonPair = {
  leftBranchName: string
  rightBranchName: string
}

export type BranchComparisonRound = {
  roundIndex: number
  pairs: BranchComparisonPair[]
}

export type BranchContext = {
  baseBranch: string
  name: string
  headSha: string
  author?: string
  updatedAt?: Date
  checks: BranchCheckMetadata[]
  pullRequest?: BranchPullRequestMetadata
}
