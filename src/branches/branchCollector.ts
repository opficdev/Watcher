import { select } from "./branchSelector.js"
import type { BranchContext, BranchSelectionOptions, RepositoryBranch } from "./types.js"

export type BranchSource = {
  listBranches(): Promise<RepositoryBranch[]>
}

// BranchSource에서 branch를 수집하고 감시 대상 BranchContext만 반환
export async function collectBranchContexts(
  source: BranchSource,
  options: BranchSelectionOptions
): Promise<BranchContext[]> {
  const branches = await source.listBranches()
  return select(branches, options)
}
