import type {
  BranchContext,
  BranchSelectionOptions,
  RepositoryBranch
} from "./types.js"

export function selectWatchedBranches(
  branches: RepositoryBranch[],
  options: BranchSelectionOptions
): BranchContext[] {
  const now = options.now ?? new Date()
  const includeRegexes = options.includePatterns?.map(wildcardToRegExp) ?? []
  const excludeRegexes = options.excludePatterns?.map(wildcardToRegExp) ?? []

  return branches
    .filter(branch => isWatchableBranch(branch, options, now, includeRegexes, excludeRegexes))
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
  options: BranchSelectionOptions,
  now: Date,
  includeRegexes: RegExp[],
  excludeRegexes: RegExp[]
): boolean {
  // base, default branch는 비교 기준이므로 감시 대상에서 제외
  if (branch.name === options.baseBranch || branch.name === options.defaultBranch) {
    return false
  }

  // include pattern이 있으면 명시적으로 포함된 branch만 감시
  if (includeRegexes.length &&
      !matchesAnyRegex(branch.name, includeRegexes)) {
    return false
  }

  // exclude pattern은 include 결과보다 우선해 noise branch를 제거
  if (excludeRegexes.length &&
      matchesAnyRegex(branch.name, excludeRegexes)) {
    return false
  }

  // 오래 갱신되지 않은 branch는 merge conflict 가능성 알림 대상에서 제외
  if (isStale(branch, options.staleDays, now)) {
    return false
  }

  return true
}

function isStale(
  branch: RepositoryBranch,
  staleDays: number | undefined, now: Date
): boolean {
  if (!staleDays || !branch.updatedAt) {
    return false
  }

  const staleTime = now.getTime() - staleDays * 24 * 60 * 60 * 1000
  return branch.updatedAt.getTime() < staleTime
}

function matchesAnyRegex(
  value: string,
  regexes: RegExp[]
): boolean {
  return regexes.some(regex => regex.test(value))
}

function wildcardToRegExp(pattern: string): RegExp {
  // 현재 설정 계약은 단순 wildcard만 지원
  const escaped = pattern
    .split("*")
    .map(escapeRegExp)
    .join(".*")

  return new RegExp(`^${escaped}$`)
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
}
