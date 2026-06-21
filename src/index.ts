export const watcherRuntimeName = "Watcher"

export function watcherRuntimeDescription(): string {
  return `${watcherRuntimeName} merge conflict probability automation`
}

export { selectWatchedBranches } from "./branches/branchSelector.js"
export type {
  BranchContext,
  BranchPullRequestMetadata,
  BranchSelectionOptions,
  RepositoryBranch
} from "./branches/types.js"
