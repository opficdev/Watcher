import type { BranchComparisonPair } from "../branches/types.js"
import type {
  GitMergeCodeContextPairResult,
  GitMergeTreePairResult,
  MergeCodeContextEvidence
} from "../git/types.js"
import type { BranchConflictGraphEdge } from "../risks/types.js"
import type {
  AiPredictionPairCodeContext,
  AiPredictionPairEvidencePayload,
  AiPredictionPairMergeStatus,
  AiPredictionPairTargetStatus
} from "./types.js"

// 선택된 branch 조합의 graph, merge, 코드 문맥을 하나의 AI evidence로 구성
export function build(
  edge: BranchConflictGraphEdge,
  mergeResult: GitMergeTreePairResult,
  codeContextResult?: GitMergeCodeContextPairResult
): AiPredictionPairEvidencePayload {
  const targetStatus = targetStatusFor(edge)

  assertMatchingPair(edge.pair, mergeResult.pair)
  assertMatchingCodeContext(edge.pair, codeContextResult)

  const mergeStatus = mergeStatusFor(targetStatus, mergeResult)

  return {
    pair: edge.pair,
    targetStatus,
    reasons: edge.reasons,
    branches: {
      left: {
        name: edge.pair.leftBranchName,
        commitOid: mergeResult.leftCommitOid
      },
      right: {
        name: edge.pair.rightBranchName,
        commitOid: mergeResult.rightCommitOid
      }
    },
    merge: {
      status: mergeStatus,
      mergedTreeOid: mergeResult.mergedTreeOid,
      conflictFiles: mergeResult.conflictFiles,
      conflicts: mergeResult.conflicts
    },
    codeContext: codeContextFor(codeContextResult)
  }
}

// graph edge가 확정 conflict 또는 critical potential overlap 대상인지 검증
function targetStatusFor(
  edge: BranchConflictGraphEdge
): AiPredictionPairTargetStatus {
  if (edge.status === "confirmed_conflict") {
    return edge.status
  }

  if (
    edge.status === "potential_overlap" &&
    edge.reasons.some(reason => reason.code === "same_hunk_overlap")
  ) {
    return edge.status
  }

  throw new Error("AI prediction pair evidence requires selected branch pair")
}

// graph target 상태와 실제 merge 수집 상태가 일치하는지 검증
function mergeStatusFor(
  targetStatus: AiPredictionPairTargetStatus,
  mergeResult: GitMergeTreePairResult
): AiPredictionPairMergeStatus {
  if (mergeResult.status === "merge_check_failed") {
    throw new Error("AI prediction pair evidence requires successful merge collection")
  }

  const matchesTarget = targetStatus === "confirmed_conflict"
    ? mergeResult.status === "confirmed_conflict"
    : mergeResult.status === "clean"

  if (!matchesTarget) {
    throw new Error("AI prediction pair evidence must use matching merge status")
  }

  return mergeResult.status
}

// code context 결과와 내부 evidence가 같은 ordered pair에 속하는지 검증
function assertMatchingCodeContext(
  pair: BranchComparisonPair,
  result: GitMergeCodeContextPairResult | undefined
): void {
  if (!result) {
    return
  }

  assertMatchingPair(pair, result.pair)

  for (const evidence of result.evidence) {
    assertMatchingEvidence(pair, evidence)
  }
}

// 코드 문맥 하나가 대상 ordered pair에 속하는지 검증
function assertMatchingEvidence(
  pair: BranchComparisonPair,
  evidence: MergeCodeContextEvidence
): void {
  assertMatchingPair(pair, evidence.pair)
}

// 두 branch 조합의 좌우 이름과 순서가 모두 같은지 검증
function assertMatchingPair(
  pair: BranchComparisonPair,
  candidate: BranchComparisonPair
): void {
  if (
    pair.leftBranchName !== candidate.leftBranchName ||
    pair.rightBranchName !== candidate.rightBranchName
  ) {
    throw new Error(
      "AI prediction pair evidence must use matching ordered branch pair"
    )
  }
}

// code context 수집 결과를 available, missing, failed 상태로 변환
function codeContextFor(
  result: GitMergeCodeContextPairResult | undefined
): AiPredictionPairCodeContext {
  if (!result) {
    return {
      status: "missing",
      overlapFiles: [],
      evidence: []
    }
  }

  if (result.errorMessage) {
    return {
      status: "failed",
      overlapFiles: [],
      evidence: [],
      errorMessage: result.errorMessage
    }
  }

  return {
    status: "available",
    overlapFiles: result.overlapFiles,
    evidence: result.evidence
  }
}
