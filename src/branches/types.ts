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

export type BranchContext = {
  baseBranch: string
  name: string
  headSha: string
  author?: string
  updatedAt?: Date
  checks: BranchCheckMetadata[]
  pullRequest?: BranchPullRequestMetadata
}
