import type { AiPredictionPairResult } from "../ai/types.js"
import { compareBranchNames } from "../branches/branchPairBuilder.js"
import type { BranchComparisonPair } from "../branches/types.js"
import type { GitMergeTreePairResult } from "../git/types.js"
import type {
  BranchConflictGraphEdge,
  BranchConflictGraphEdgeStatus
} from "../risks/types.js"
import type {
  BranchPairMergeRiskReport,
  BranchPairMergeRiskReportAiAnalysis,
  BranchPairMergeRiskReportBranchImpact,
  BranchPairMergeRiskReportExcludedBranch,
  BranchPairMergeRiskReportInput,
  BranchPairMergeRiskReportMergeError,
  BranchPairMergeRiskReportPairItem
} from "./branchPairTypes.js"

const dayMilliseconds = 24 * 60 * 60 * 1_000

// branch 조합 분석 결과를 표시 목적의 report 모델로 구성
export function build(
  input: BranchPairMergeRiskReportInput
): BranchPairMergeRiskReport {
  const edges = normalizedEdges(input.graph.edges)
  const mergeResultByPair = firstMergeResultByPair(input.mergeResults)
  const aiResultByPair = firstResultByPair(input.aiResults)
  const confirmedConflicts = pairItemsFor(
    edges,
    "confirmed_conflict",
    mergeResultByPair,
    aiResultByPair
  )
  const potentialRisks = pairItemsFor(
    edges,
    "potential_overlap",
    mergeResultByPair,
    aiResultByPair
  )

  return {
    baseBranch: input.graph.baseBranch,
    generatedAt: new Date(input.generatedAt),
    activePeriod: {
      dayCount: input.activeBranchWindowDays,
      since: new Date(
        input.generatedAt.getTime() - input.activeBranchWindowDays * dayMilliseconds
      ),
      until: new Date(input.generatedAt)
    },
    discoveredBranchCount: input.discoveredBranchCount,
    watchedBranchCount: new Set(
      input.watchedBranches.map(branch => branch.name)
    ).size,
    comparisonPairCount: edges.length,
    confirmedConflicts,
    potentialRisks,
    branchImpacts: branchImpactsFor(
      input.watchedBranches.map(branch => branch.name),
      confirmedConflicts,
      potentialRisks
    ),
    cleanPairCount: edges.filter(edge => edge.status === "clean").length,
    excludedBranches: reportableExclusions(input.excludedBranches),
    mergeErrors: mergeErrorsFor(edges)
  }
}

// 지정 상태의 edge를 commit과 AI 결과가 결합된 report 항목으로 변환
function pairItemsFor(
  edges: BranchConflictGraphEdge[],
  status: Extract<
    BranchConflictGraphEdgeStatus,
    "confirmed_conflict" | "potential_overlap"
  >,
  mergeResultByPair: ReadonlyMap<string, NormalizedMergeResult>,
  aiResultByPair: ReadonlyMap<string, AiPredictionPairResult>
): BranchPairMergeRiskReportPairItem[] {
  return edges
    .filter(edge => edge.status === status)
    .map(edge => pairItemFor(
      edge,
      status,
      mergeResultByPair.get(keyFor(edge.pair)),
      aiResultByPair.get(keyFor(edge.pair))
    ))
}

// 정규화된 branch 순서에 맞춰 조합 하나의 상세 항목을 구성
function pairItemFor(
  edge: BranchConflictGraphEdge,
  status: BranchPairMergeRiskReportPairItem["status"],
  normalizedMergeResult: NormalizedMergeResult | undefined,
  aiResult: AiPredictionPairResult | undefined
): BranchPairMergeRiskReportPairItem {
  const result = normalizedMergeResult?.result
  const reversed = normalizedMergeResult?.reversed ?? false

  return {
    pair: edge.pair,
    status,
    reasons: edge.reasons,
    conflicts: result?.conflicts ?? [],
    leftCommitOid: reversed ? result?.rightCommitOid : result?.leftCommitOid,
    rightCommitOid: reversed ? result?.leftCommitOid : result?.rightCommitOid,
    aiAnalysis: aiAnalysisFor(aiResult)
  }
}

// AI 실행 결과의 predicted, failed, skipped 상태를 report 모델로 변환
function aiAnalysisFor(
  result: AiPredictionPairResult | undefined
): BranchPairMergeRiskReportAiAnalysis {
  if (!result) {
    return {
      status: "skipped",
      reason: "not_target"
    }
  }

  if (result.status === "failed") {
    return {
      status: "failed",
      errorMessage: result.errorMessage
    }
  }

  return {
    status: "predicted",
    response: result.response
  }
}

// 감시 branch별 확정 conflict와 잠재 위험 조합을 집계
function branchImpactsFor(
  watchedBranchNames: string[],
  confirmedConflicts: BranchPairMergeRiskReportPairItem[],
  potentialRisks: BranchPairMergeRiskReportPairItem[]
): BranchPairMergeRiskReportBranchImpact[] {
  return sortedUnique(watchedBranchNames)
    .map(branchName => ({
      branchName,
      confirmedConflictPairs: relatedPairsFor(branchName, confirmedConflicts),
      potentialRiskPairs: relatedPairsFor(branchName, potentialRisks)
    }))
    .filter(impact =>
      impact.confirmedConflictPairs.length !== 0 ||
      impact.potentialRiskPairs.length !== 0
    )
}

// 지정 branch가 포함된 report 항목에서 branch 조합만 추출
function relatedPairsFor(
  branchName: string,
  items: BranchPairMergeRiskReportPairItem[]
): BranchComparisonPair[] {
  return items
    .filter(item => includesBranch(item.pair, branchName))
    .map(item => item.pair)
}

// branch 조합에 지정 branch가 포함되는지 확인
function includesBranch(
  pair: BranchComparisonPair,
  branchName: string
): boolean {
  return pair.leftBranchName === branchName || pair.rightBranchName === branchName
}

// 활성 기간과 최대 개수 기준으로 제외된 branch만 이름순으로 구성
function reportableExclusions(
  excludedBranches: BranchPairMergeRiskReportInput["excludedBranches"]
): BranchPairMergeRiskReportExcludedBranch[] {
  return excludedBranches
    .filter((branch): branch is typeof branch & {
      reason: BranchPairMergeRiskReportExcludedBranch["reason"]
    } => branch.reason === "stale_branch" || branch.reason === "branch_limit")
    .map(branch => ({
      name: branch.name,
      reason: branch.reason
    }))
    .sort((branch, other) => compareBranchNames(branch.name, other.name))
}

// 분석 실패 edge를 오류 원인과 메시지가 포함된 report 항목으로 변환
function mergeErrorsFor(
  edges: BranchConflictGraphEdge[]
): BranchPairMergeRiskReportMergeError[] {
  return edges
    .filter(edge => edge.status === "error")
    .map(edge => ({
      pair: edge.pair,
      reasons: edge.reasons,
      errorMessage: edge.errorMessage ?? "branch pair merge analysis failed"
    }))
}

// 반대 방향 중복과 자기 조합을 제거하고 branch 이름순으로 edge를 정렬
function normalizedEdges(
  edges: BranchConflictGraphEdge[]
): BranchConflictGraphEdge[] {
  const edgeByPair = new Map<string, BranchConflictGraphEdge>()

  for (const edge of edges) {
    const pair = normalizedPair(edge.pair)

    if (pair.leftBranchName === pair.rightBranchName) {
      continue
    }

    const key = keyFor(pair)

    if (!edgeByPair.has(key)) {
      edgeByPair.set(key, {
        ...edge,
        pair
      })
    }
  }

  return [...edgeByPair.values()].sort((edge, other) =>
    comparePairs(edge.pair, other.pair)
  )
}

type NormalizedMergeResult = {
  result: GitMergeTreePairResult
  reversed: boolean
}

// 조합별 첫 merge 결과와 정규화 과정의 방향 전환 여부를 기록
function firstMergeResultByPair(
  results: GitMergeTreePairResult[]
): Map<string, NormalizedMergeResult> {
  const resultByPair = new Map<string, NormalizedMergeResult>()

  for (const result of results) {
    const pair = normalizedPair(result.pair)
    const key = keyFor(pair)

    if (!resultByPair.has(key)) {
      resultByPair.set(key, {
        result,
        reversed: pair.leftBranchName !== result.pair.leftBranchName
      })
    }
  }

  return resultByPair
}

// branch 조합별 첫 결과를 정규화된 key로 구성
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

// branch 이름 비교 순서에 맞춰 조합의 좌우 방향을 정규화
function normalizedPair(pair: BranchComparisonPair): BranchComparisonPair {
  return compareBranchNames(pair.leftBranchName, pair.rightBranchName) <= 0
    ? pair
    : {
      leftBranchName: pair.rightBranchName,
      rightBranchName: pair.leftBranchName
    }
}

// 정규화된 branch 조합을 충돌 없는 map key로 변환
function keyFor(pair: BranchComparisonPair): string {
  return `${pair.leftBranchName}\u0000${pair.rightBranchName}`
}

// branch 조합을 왼쪽 이름과 오른쪽 이름 순서로 비교
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

// 중복 문자열을 제거하고 실행 환경에 무관한 이름순으로 정렬
function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort(compareBranchNames)
}
