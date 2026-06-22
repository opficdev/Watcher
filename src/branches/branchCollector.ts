import { select } from "./branchSelector.js"
import type { BranchContext, BranchSelectionOptions, RepositoryBranch } from "./types.js"

export type BranchSource = {
  listBranches(): Promise<RepositoryBranch[]>
}

export async function collectBranchContexts(
  source: BranchSource,
  options: BranchSelectionOptions
): Promise<BranchContext[]> {
  const branches = await source.listBranches()
  return select(branches, options)
}
