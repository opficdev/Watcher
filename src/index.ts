export const watcherRuntimeName = "Watcher"

export function watcherRuntimeDescription(): string {
  return `${watcherRuntimeName} merge conflict probability automation`
}

export { collectBranchContexts } from "./branches/branchCollector.js"
export { selectWatchedBranches } from "./branches/branchSelector.js"
export { collectGitMergeSignal } from "./git/gitMergeSignalCollector.js"
export { analyzeBranchMergeRisks } from "./risks/riskAnalyzer.js"

export type { BranchSource } from "./branches/branchCollector.js"

export type {
  BranchContext,
  BranchCheckMetadata,
  BranchPullRequestMetadata,
  BranchSelectionOptions,
  RepositoryBranch
} from "./branches/types.js"

export type {
  GitMergeSignal,
  GitMergeSignalCollectionOptions,
  GitMergeSignalStatus
} from "./git/types.js"

export type {
  BranchChangedHunk,
  BranchRisk,
  BranchRiskAnalysisInput,
  BranchRiskAnalysisOptions,
  BranchRiskReason,
  BranchRiskReasonCode,
  BranchRiskStatus
} from "./risks/types.js"
