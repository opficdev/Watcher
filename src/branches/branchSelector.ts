import type {
  BranchContext,
  BranchSelectionOptions,
  RepositoryBranch
} from "./types.js"

export function selectWatchedBranches(
  branches: RepositoryBranch[],
  options: BranchSelectionOptions
): BranchContext[] {
  return branches
    .filter(branch => isWatchableBranch(branch, options))
    .map(branch => ({
      baseBranch: options.baseBranch,
      name: branch.name,
      headSha: branch.sha,
      author: branch.author,
      updatedAt: branch.updatedAt,
      checks: branch.checks ?? [],
      pullRequest: branch.pullRequest
    }))
}

function isWatchableBranch(
  branch: RepositoryBranch,
  options: BranchSelectionOptions
): boolean {
  // base, default branch는 비교 기준이므로 감시 대상에서 제외
  if (branch.name === options.baseBranch || branch.name === options.defaultBranch) {
    return false
  }

  return true
}
