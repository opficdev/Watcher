import type { BranchComparisonPair } from "../branches/types.js"
import type {
  GitMergeCodeContextPairResult,
  GitMergeTreePairResult
} from "../git/types.js"
import type { BranchConflictGraphEdge } from "../risks/types.js"
import { build as buildEvidence } from "./predictionPairEvidenceBuilder.js"
import { select } from "./predictionPairTargetSelector.js"
import type { AiPredictionPairEvidencePayload } from "./types.js"

// graph, merge, 코드 문맥 결과를 선택된 branch 조합별 AI 요청 입력으로 조립
export function build(
  edges: BranchConflictGraphEdge[],
  mergeResults: GitMergeTreePairResult[],
  codeContextResults: GitMergeCodeContextPairResult[] = []
): AiPredictionPairEvidencePayload[] {
  const targets = select(edges)
  const mergeIndex = indexByPair(
    mergeResults,
    "AI prediction pair request requires unique merge result"
  )
  const contextIndex = indexByPair(
    codeContextResults,
    "AI prediction pair request requires unique code context result"
  )
  const seenKeys = new Set<string>()

  return targets.map(edge => {
    const key = pairKeyFor(edge.pair)

    if (seenKeys.has(key)) {
      throw new Error(
        "AI prediction pair request requires unique selected branch pair"
      )
    }

    seenKeys.add(key)

    const merge = mergeIndex.get(key)

    if (!merge) {
      throw new Error(
        "AI prediction pair request requires merge result for selected branch pair"
      )
    }

    return buildEvidence(edge, merge, contextIndex.get(key))
  })
}

// ordered pair별 결과를 색인하고 같은 조합의 중복 결과 거부
function indexByPair<T extends { pair: BranchComparisonPair }>(
  results: T[],
  duplicateErrorMessage: string
): Map<string, T> {
  const index = new Map<string, T>()

  for (const result of results) {
    const key = pairKeyFor(result.pair)

    if (index.has(key)) {
      throw new Error(duplicateErrorMessage)
    }

    index.set(key, result)
  }

  return index
}

// 좌우 branch 순서를 보존하는 충돌 없는 조합 key 구성
function pairKeyFor(pair: BranchComparisonPair): string {
  return `${pair.leftBranchName}\u0000${pair.rightBranchName}`
}
