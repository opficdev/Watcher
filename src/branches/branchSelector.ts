import type {
  BranchContext,
  BranchExclusionReason,
  BranchSelectionResult,
  BranchSelectionOptions,
  ExcludedBranch,
  RepositoryBranch
} from "./types.js"

const activeBranchWindowMilliseconds = 14 * 24 * 60 * 60 * 1_000
const maximumActiveBranchCount = 30

export function select(
  branches: RepositoryBranch[],
  options: BranchSelectionOptions
): BranchContext[] {
  return selectWithReasons(branches, options).selected
}

export function selectWithReasons(
  branches: RepositoryBranch[],
  options: BranchSelectionOptions,
  currentTime = new Date()
): BranchSelectionResult {
  const selected: BranchContext[] = []
  const excluded: ExcludedBranch[] = []
  const activeBranchCutoff = new Date(
    currentTime.getTime() - activeBranchWindowMilliseconds
  )
  const activeBranches: RepositoryBranch[] = []

  for (const branch of branches) {
    const reason = exclusionReasonFor(branch, options, activeBranchCutoff)

    if (reason) {
      excluded.push(excludedBranchFor(branch, reason))
      continue
    }

    activeBranches.push(branch)
  }

  activeBranches.sort(compareActiveBranches)

  for (const [index, branch] of activeBranches.entries()) {
    if (maximumActiveBranchCount <= index) {
      excluded.push(excludedBranchFor(branch, "branch_limit"))
      continue
    }

    selected.push(branchContextFor(branch, options))
  }

  return {
    selected,
    excluded
  }
}

function excludedBranchFor(
  branch: RepositoryBranch,
  reason: BranchExclusionReason
): ExcludedBranch {
  return {
    name: branch.name,
    sha: branch.sha,
    reason
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
  options: BranchSelectionOptions,
  activeBranchCutoff: Date
): BranchExclusionReason | undefined {
  // base, default branch는 비교 기준이므로 감시 대상에서 제외
  if (branch.name === options.baseBranch) {
    return "base_branch"
  }

  if (branch.name === options.defaultBranch) {
    return "default_branch"
  }

  const updatedTime = branch.updatedAt?.getTime()
  if (
    updatedTime === undefined ||
    Number.isNaN(updatedTime) ||
    updatedTime < activeBranchCutoff.getTime()
  ) {
    return "stale_branch"
  }

  return undefined
}

function compareActiveBranches(
  branch: RepositoryBranch,
  other: RepositoryBranch
): number {
  const branchTime = branch.updatedAt!.getTime()
  const otherTime = other.updatedAt!.getTime()

  if (branchTime !== otherTime) {
    return otherTime - branchTime
  }

  if (branch.name < other.name) {
    return -1
  }

  if (other.name < branch.name) {
    return 1
  }

  return 0
}
