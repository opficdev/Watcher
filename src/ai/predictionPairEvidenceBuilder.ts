import { Buffer } from "node:buffer"
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

// 한 branch 조합에 포함할 수 있는 코드 원문의 UTF-8 byte 상한
const CODE_CONTEXT_MAX_BYTES = 128 * 1024

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
      evidence: [],
      includedFileCount: 0,
      includedHunkCount: 0,
      omittedFileCount: 0,
      omittedHunkCount: 0
    }
  }

  if (result.errorMessage) {
    return {
      status: "failed",
      overlapFiles: [],
      evidence: [],
      includedFileCount: 0,
      includedHunkCount: 0,
      omittedFileCount: 0,
      omittedHunkCount: 0,
      errorMessage: result.errorMessage
    }
  }

  const limited = limitedCodeContextFor(result.evidence)

  return {
    status: "available",
    overlapFiles: result.overlapFiles,
    ...limited
  }
}

// evidence 순서를 유지하며 hunk의 네 version을 분리하지 않고 조합 상한 적용
function limitedCodeContextFor(evidence: MergeCodeContextEvidence[]) {
  let includedByteCount = 0
  let includedHunkCount = 0

  for (const item of evidence) {
    const byteCount = rawCodeByteCountFor(item)

    if (CODE_CONTEXT_MAX_BYTES < includedByteCount + byteCount) {
      break
    }

    includedByteCount += byteCount
    includedHunkCount += 1
  }

  const includedEvidence = evidence.slice(0, includedHunkCount)
  const omittedEvidence = evidence.slice(includedHunkCount)

  return {
    evidence: includedEvidence,
    includedFileCount: uniqueFileCountFor(includedEvidence),
    includedHunkCount,
    omittedFileCount: uniqueFileCountFor(omittedEvidence),
    omittedHunkCount: omittedEvidence.length
  }
}

// 한 hunk의 base, left, right, merged 코드 원문 UTF-8 byte 합산
function rawCodeByteCountFor(evidence: MergeCodeContextEvidence): number {
  const snippets = [
    evidence.baseSnippet,
    evidence.leftSnippet,
    evidence.rightSnippet,
    evidence.mergedSnippet
  ]

  return snippets.reduce(
    (byteCount, snippet) => byteCount + (
      typeof snippet.content === "string"
        ? Buffer.byteLength(snippet.content, "utf8")
        : 0
    ),
    0
  )
}

// evidence 목록에 포함된 중복 없는 file 수 계산
function uniqueFileCountFor(evidence: MergeCodeContextEvidence[]): number {
  return new Set(evidence.map(item => item.filePath)).size
}
