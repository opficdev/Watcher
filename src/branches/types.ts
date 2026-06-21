export type BranchPullRequestMetadata = {
  number: number
  title: string
  url: string
}

export type RepositoryBranch = {
  name: string
  sha: string
  author?: string
  updatedAt?: Date
  pullRequest?: BranchPullRequestMetadata
}

export type BranchSelectionOptions = {
  baseBranch: string
  defaultBranch?: string
  includePatterns?: string[]
  excludePatterns?: string[]
  staleDays?: number
  now?: Date
}

export type BranchContext = {
  name: string
  sha: string
  author?: string
  updatedAt?: Date
  pullRequest?: BranchPullRequestMetadata
}
