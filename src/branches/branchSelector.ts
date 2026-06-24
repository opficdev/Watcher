import type {
  BranchContext,
  BranchExclusionReason,
  BranchSelectionResult,
  BranchSelectionOptions,
  ExcludedBranch,
  RepositoryBranch
} from "./types.js"

export function select(
  branches: RepositoryBranch[],
  options: BranchSelectionOptions
): BranchContext[] {
  return selectWithReasons(branches, options).selected
}

export function selectWithReasons(
  branches: RepositoryBranch[],
  options: BranchSelectionOptions
): BranchSelectionResult {
  const selected: BranchContext[] = []
  const excluded: ExcludedBranch[] = []

  for (const branch of branches) {
    const reason = exclusionReasonFor(branch, options)

    if (reason) {
      excluded.push({
        name: branch.name,
        sha: branch.sha,
        reason
      })
      continue
    }

    selected.push(branchContextFor(branch, options))
  }

  return {
    selected,
    excluded
  }
}

function branchContextFor(
  branch: RepositoryBranch,
  options: BranchSelectionOptions
): BranchContext {
  return {
    baseBranch: options.baseBranch,
    name: branch.name,
    headSha: branch.sha,
    author: branch.author,
    updatedAt: branch.updatedAt,
    checks: branch.checks ?? [],
    pullRequest: branch.pullRequest
  }
}

function exclusionReasonFor(
  branch: RepositoryBranch,
  options: BranchSelectionOptions
): BranchExclusionReason | undefined {
  // base, default branch는 비교 기준이므로 감시 대상에서 제외
  if (branch.name === options.baseBranch) {
    return "base_branch"
  }

  if (branch.name === options.defaultBranch) {
    return "default_branch"
  }

  return undefined
}
