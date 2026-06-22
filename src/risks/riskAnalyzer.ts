import type { BranchCheckMetadata } from "../branches/types.js"
import type {
  BranchChangedHunk,
  BranchRisk,
  BranchRiskAnalysisInput,
  BranchRiskAnalysisOptions,
  BranchRiskReason,
  BranchRiskStatus
} from "./types.js"

// risk score는 report에서 비교하기 쉽도록 0-100 범위로 제한
const MAX_SCORE = 100

// 각 rule이 branch risk score에 더하는 가중치
const SCORE = {
  confirmedConflict: 100,
  mergeCheckFailed: 25,
  sameHunkOverlap: 35,
  sameFileOverlap: 20,
  failedCheck: 15,
  criticalFileChanged: 15
} as const

// GitHub check conclusion 중 merge risk를 높이는 실패 계열 상태
const failedCheckConclusions = new Set([
  "action_required",
  "cancelled",
  "failure",
  "timed_out"
])

// branch별 git/check/overlap signal을 deterministic risk score와 reason으로 변환
export function analyzeBranchMergeRisks(
  inputs: BranchRiskAnalysisInput[],
  options: BranchRiskAnalysisOptions = {}
): BranchRisk[] {
  // 전체 branch 입력을 먼저 훑어 branch 간 파일/hunk overlap을 계산
  const fileOverlaps = buildFileOverlaps(inputs)
  const hunkOverlaps = buildHunkOverlaps(inputs)
  // repository마다 민감한 파일을 설정으로 주입할 수 있도록 wildcard를 정규식으로 변환
  const criticalRegexes = options.criticalFilePatterns?.map(wildcardToRegExp) ?? []

  return inputs.map(input => {
    // 개별 branch에 적용되는 rule reason 목록
    const reasons = buildReasons({
      input,
      fileOverlaps: fileOverlaps.get(input.branch.name) ?? new Map(),
      hunkOverlaps: hunkOverlaps.get(input.branch.name) ?? new Map(),
      criticalRegexes
    })
    // reason별 점수를 합산하되 최대 100점을 넘지 않도록 제한
    const score = Math.min(
      MAX_SCORE,
      reasons.reduce((total, reason) => total + reason.scoreImpact, 0)
    )

    return {
      branchName: input.branch.name,
      baseBranch: input.branch.baseBranch,
      score,
      status: statusForScore(score),
      reasons
    }
  })
}

// 단일 branch에 적용되는 risk reason을 우선순위 순서대로 생성
function buildReasons(input: {
  input: BranchRiskAnalysisInput
  fileOverlaps: Map<string, Set<string>>
  hunkOverlaps: Map<string, Set<string>>
  criticalRegexes: RegExp[]
}): BranchRiskReason[] {
  // matched rule이 없으면 clean_merge reason을 넣기 위해 누적
  const reasons: BranchRiskReason[] = []

  if (input.input.gitSignal.status === "confirmed_conflict") {
    return [
      {
        code: "confirmed_conflict",
        message: "virtual merge에서 conflict가 확인됨",
        scoreImpact: SCORE.confirmedConflict,
        files: input.input.gitSignal.conflictFiles
      }
    ]
  }

  if (input.input.gitSignal.status === "merge_check_failed") {
    reasons.push({
      code: "merge_check_failed",
      message: "virtual merge 확인에 실패함",
      scoreImpact: SCORE.mergeCheckFailed
    })
  }

  // 같은 line range까지 겹치는 파일은 same file보다 강한 signal로 먼저 기록
  const hunkOverlapFiles = [...input.hunkOverlaps.keys()].sort()
  if (0 < hunkOverlapFiles.length) {
    reasons.push({
      code: "same_hunk_overlap",
      message: "다른 branch와 같은 hunk를 수정함",
      scoreImpact: SCORE.sameHunkOverlap,
      files: hunkOverlapFiles,
      branches: branchesFor(input.hunkOverlaps)
    })
  }

  // 다른 branch와 같은 파일을 수정하면 conflict 가능성을 높이는 약한 signal로 기록
  const fileOverlapFiles = [...input.fileOverlaps.keys()].sort()
  if (0 < fileOverlapFiles.length) {
    reasons.push({
      code: "same_file_overlap",
      message: "다른 branch와 같은 파일을 수정함",
      scoreImpact: SCORE.sameFileOverlap,
      files: fileOverlapFiles,
      branches: branchesFor(input.fileOverlaps)
    })
  }

  // branch metadata에 실패한 check가 있으면 merge 준비 상태가 나쁜 signal로 기록
  const failedChecks = input.input.branch.checks.filter(isFailedCheck)
  if (0 < failedChecks.length) {
    reasons.push({
      code: "failed_check",
      message: "실패한 check metadata가 존재함",
      scoreImpact: SCORE.failedCheck,
      checks: failedChecks.map(check => check.name).sort()
    })
  }

  // repository별 critical file pattern과 매칭되는 변경 파일을 기록
  const criticalFiles = input.input.gitSignal.changedFiles
    .filter(file => input.criticalRegexes.some(regex => regex.test(file)))
    .sort()
  if (0 < criticalFiles.length) {
    reasons.push({
      code: "critical_file_changed",
      message: "critical file pattern에 해당하는 파일을 수정함",
      scoreImpact: SCORE.criticalFileChanged,
      files: criticalFiles
    })
  }

  if (reasons.length === 0) {
    reasons.push({
      code: "clean_merge",
      message: "virtual merge에서 conflict가 확인되지 않음",
      scoreImpact: 0
    })
  }

  return reasons
}

// 변경 파일이 둘 이상의 branch에 등장하는지 계산
function buildFileOverlaps(
  inputs: BranchRiskAnalysisInput[]
): Map<string, Map<string, Set<string>>> {
  // 파일별로 해당 파일을 수정한 branch 목록을 수집
  const fileToBranches = new Map<string, Set<string>>()

  for (const input of inputs) {
    for (const file of input.gitSignal.changedFiles) {
      const branches = fileToBranches.get(file) ?? new Set<string>()
      branches.add(input.branch.name)
      fileToBranches.set(file, branches)
    }
  }

  // branch별로 겹친 파일과 상대 branch 목록을 재구성
  const overlaps = new Map<string, Map<string, Set<string>>>()

  for (const [file, branches] of fileToBranches) {
    if (branches.size < 2) {
      continue
    }

    for (const branch of branches) {
      const branchOverlaps = overlaps.get(branch) ?? new Map<string, Set<string>>()
      branchOverlaps.set(file, without(branches, branch))
      overlaps.set(branch, branchOverlaps)
    }
  }

  return overlaps
}

// branch 쌍을 비교해 같은 파일의 line range가 겹치는 hunk를 계산
function buildHunkOverlaps(
  inputs: BranchRiskAnalysisInput[]
): Map<string, Map<string, Set<string>>> {
  // branch -> file -> overlapping branch 목록
  const overlaps = new Map<string, Map<string, Set<string>>>()

  for (const input of inputs) {
    for (const other of inputs) {
      if (input.branch.name === other.branch.name) {
        continue
      }

      const overlappingFiles = overlappingHunkFiles(
        input.changedHunks ?? [],
        other.changedHunks ?? []
      )

      for (const file of overlappingFiles) {
        const branchOverlaps = overlaps.get(input.branch.name) ?? new Map<string, Set<string>>()
        const branches = branchOverlaps.get(file) ?? new Set<string>()
        branches.add(other.branch.name)
        branchOverlaps.set(file, branches)
        overlaps.set(input.branch.name, branchOverlaps)
      }
    }
  }

  return overlaps
}

// 두 branch의 hunk 목록 중 line range가 겹치는 파일 목록을 반환
function overlappingHunkFiles(
  hunks: BranchChangedHunk[],
  otherHunks: BranchChangedHunk[]
): string[] {
  // 같은 파일에서 여러 hunk가 겹쳐도 reason에는 파일을 한 번만 표시
  const files = new Set<string>()

  for (const hunk of hunks) {
    for (const other of otherHunks) {
      if (hunk.filePath === other.filePath && overlapsLineRange(hunk, other)) {
        files.add(hunk.filePath)
      }
    }
  }

  return [...files]
}

// 두 line range가 서로 겹치는지 확인
function overlapsLineRange(
  hunk: BranchChangedHunk,
  other: BranchChangedHunk
): boolean {
  return hunk.startLine <= other.endLine && other.startLine <= hunk.endLine
}

// overlap map에 들어 있는 상대 branch 목록을 중복 없이 정렬
function branchesFor(overlaps: Map<string, Set<string>>): string[] {
  return [...new Set([...overlaps.values()].flatMap(branches => [...branches]))].sort()
}

// 현재 branch를 제외한 나머지 branch 목록을 Set으로 반환
function without(branches: Set<string>, current: string): Set<string> {
  return new Set([...branches].filter(branch => branch !== current))
}

// GitHub check metadata가 실패 계열 conclusion인지 확인
function isFailedCheck(check: BranchCheckMetadata): boolean {
  return Boolean(check.conclusion && failedCheckConclusions.has(check.conclusion))
}

// score 구간을 사람이 읽을 수 있는 risk status로 변환
function statusForScore(score: number): BranchRiskStatus {
  if (80 <= score) {
    return "critical"
  }

  if (50 <= score) {
    return "high"
  }

  if (25 <= score) {
    return "medium"
  }

  return "low"
}

// critical file pattern을 경로 전체에 매칭되는 정규식으로 변환
function wildcardToRegExp(pattern: string): RegExp {
  // **는 경로 구분자를 포함하고, *는 단일 path segment 내부만 매칭
  const segments: string[] = []

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]
    const next = pattern[index + 1]

    if (character === "*" && next === "*") {
      segments.push(".*")
      index += 1
      continue
    }

    if (character === "*") {
      segments.push("[^/]*")
      continue
    }

    segments.push(escapeRegExp(character ?? ""))
  }

  return new RegExp(`^${segments.join("")}$`)
}

// wildcard가 아닌 문자를 정규식 literal로 안전하게 이스케이프
function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
}
