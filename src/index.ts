export const watcherRuntimeName = "Watcher"

export function watcherRuntimeDescription(): string {
  return `${watcherRuntimeName} merge conflict probability automation`
}

export { collectBranchContexts } from "./branches/branchCollector.js"
export { selectWatchedBranches } from "./branches/branchSelector.js"
export type { BranchSource } from "./branches/branchCollector.js"
export type {
  BranchContext,
  BranchCheckMetadata,
  BranchPullRequestMetadata,
  BranchSelectionOptions,
  RepositoryBranch
} from "./branches/types.js"
