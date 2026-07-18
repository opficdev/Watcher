import type {
  BranchContext,
  BranchExclusionReason,
  BranchSelectionResult,
  BranchSelectionOptions,
  ExcludedBranch,
  RepositoryBranch
} from "./types.js"

export const ACTIVE_BRANCH_WINDOW_DAYS = 14

const activeBranchWindowMilliseconds =
  ACTIVE_BRANCH_WINDOW_DAYS * 24 * 60 * 60 * 1_000
const maximumActiveBranchCount = 30

// 제외 사유가 필요 없는 호출자를 위해 선택된 BranchContext 목록만 반환
export function select(
  branches: RepositoryBranch[],
  options: BranchSelectionOptions
): BranchContext[] {
  return selectWithReasons(branches, options).selected
}

// 활성 기간과 최대 개수 기준을 적용해 선택 branch와 제외 사유를 함께 구성
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

// 제외된 branch의 식별 정보와 제외 사유를 기록할 모델로 변환
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

// 감시 대상으로 선택된 branch를 분석 단계의 BranchContext로 변환
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

// base, default, 갱신 시각 기준으로 branch의 제외 사유를 결정
function exclusionReasonFor(
  branch: RepositoryBranch,
  options: BranchSelectionOptions,
  activeBranchCutoff: Date
): BranchExclusionReason | undefined {
  // base branch는 조합에 별도 포함하고 default branch는 감시하지 않으므로 선택에서 제외
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

// 활성 branch를 최근 갱신 순으로 정렬하고 동률이면 이름 순으로 정렬
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
