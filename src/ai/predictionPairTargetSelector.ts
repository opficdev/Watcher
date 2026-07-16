import type { BranchConflictGraphEdge } from "../risks/types.js"

// 확정 conflict와 critical potential overlap 조합만 AI 분석 대상으로 선별
export function select(
  edges: BranchConflictGraphEdge[]
): BranchConflictGraphEdge[] {
  return edges.filter(isTarget)
}

function isTarget(edge: BranchConflictGraphEdge): boolean {
  if (edge.status === "confirmed_conflict") {
    return true
  }

  return edge.status === "potential_overlap" &&
    edge.reasons.some(reason => reason.code === "same_hunk_overlap")
}
