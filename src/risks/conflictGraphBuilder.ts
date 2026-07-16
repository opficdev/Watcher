import { compareBranchNames } from "../branches/branchPairBuilder.js"
import type { BranchComparisonPair } from "../branches/types.js"
import type {
  GitMergeCodeContextPairResult,
  GitMergeTreePairResult
} from "../git/types.js"
import type {
  BranchConflictGraphEdge,
  BranchConflictGraphEdgeReason
} from "./types.js"

// 입력 branch 조합만 중복 없이 정규화해 충돌 관계 edge로 분류
export function buildEdges(
  pairs: BranchComparisonPair[],
  mergeResults: GitMergeTreePairResult[],
  codeContextResults: GitMergeCodeContextPairResult[]
): BranchConflictGraphEdge[] {
  const mergeResultByPair = firstResultByPair(mergeResults)
  const codeContextResultByPair = firstResultByPair(codeContextResults)

  return normalizedPairs(pairs).map(pair => edgeFor(
    pair,
    mergeResultByPair.get(keyFor(pair)),
    codeContextResultByPair.get(keyFor(pair))
  ))
}

function edgeFor(
  pair: BranchComparisonPair,
  mergeResult: GitMergeTreePairResult | undefined,
  codeContextResult: GitMergeCodeContextPairResult | undefined
): BranchConflictGraphEdge {
  if (!mergeResult) {
    return errorEdge(
      pair,
      "merge_check_failed",
      "merge-tree result is missing for branch pair"
    )
  }

  if (mergeResult.status === "confirmed_conflict") {
    return {
      pair,
      status: "confirmed_conflict",
      reasons: [reasonWithFiles(
        "confirmed_conflict",
        mergeResult.conflictFiles
      )]
    }
  }

  if (mergeResult.status === "merge_check_failed") {
    return errorEdge(
      pair,
      "merge_check_failed",
      mergeResult.errorMessage ?? "merge-tree collection failed for branch pair"
    )
  }

  if (!codeContextResult) {
    return errorEdge(
      pair,
      "code_context_failed",
      "code context result is missing for branch pair"
    )
  }

  if (codeContextResult.errorMessage) {
    return errorEdge(
      pair,
      "code_context_failed",
      codeContextResult.errorMessage
    )
  }

  const hunkFiles = sortedUnique(codeContextResult.evidence
    .filter(evidence => evidence.kind === "clean_hunk_overlap")
    .map(evidence => evidence.filePath))
  const overlapFiles = sortedUnique(codeContextResult.overlapFiles)
  const reasons: BranchConflictGraphEdgeReason[] = []

  if (hunkFiles.length) {
    reasons.push(reasonWithFiles("same_hunk_overlap", hunkFiles))
  }

  if (overlapFiles.length) {
    reasons.push(reasonWithFiles("same_file_overlap", overlapFiles))
  }

  if (reasons.length) {
    return {
      pair,
      status: "potential_overlap",
      reasons
    }
  }

  return {
    pair,
    status: "clean",
    reasons: [{ code: "clean_merge" }]
  }
}

function errorEdge(
  pair: BranchComparisonPair,
  code: "merge_check_failed" | "code_context_failed",
  errorMessage: string
): BranchConflictGraphEdge {
  return {
    pair,
    status: "error",
    reasons: [{ code }],
    errorMessage
  }
}

function reasonWithFiles(
  code: "confirmed_conflict" | "same_hunk_overlap" | "same_file_overlap",
  files: string[]
): BranchConflictGraphEdgeReason {
  return {
    code,
    files: sortedUnique(files)
  }
}

function normalizedPairs(pairs: BranchComparisonPair[]): BranchComparisonPair[] {
  const pairByKey = new Map<string, BranchComparisonPair>()

  for (const pair of pairs) {
    const normalized = normalizedPair(pair)

    if (normalized.leftBranchName === normalized.rightBranchName) {
      continue
    }

    pairByKey.set(keyFor(normalized), normalized)
  }

  return [...pairByKey.values()].sort(comparePairs)
}

function firstResultByPair<T extends { pair: BranchComparisonPair }>(
  results: T[]
): Map<string, T> {
  const resultByPair = new Map<string, T>()

  for (const result of results) {
    const key = keyFor(normalizedPair(result.pair))

    if (!resultByPair.has(key)) {
      resultByPair.set(key, result)
    }
  }

  return resultByPair
}

function normalizedPair(pair: BranchComparisonPair): BranchComparisonPair {
  return compareBranchNames(pair.leftBranchName, pair.rightBranchName) <= 0
    ? pair
    : {
      leftBranchName: pair.rightBranchName,
      rightBranchName: pair.leftBranchName
    }
}

function keyFor(pair: BranchComparisonPair): string {
  return `${pair.leftBranchName}\u0000${pair.rightBranchName}`
}

function comparePairs(
  pair: BranchComparisonPair,
  other: BranchComparisonPair
): number {
  const leftComparison = compareBranchNames(
    pair.leftBranchName,
    other.leftBranchName
  )

  return leftComparison || compareBranchNames(
    pair.rightBranchName,
    other.rightBranchName
  )
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort(compareBranchNames)
}
